// Pro storage: licences, processed Stripe events and synced documents.

import { tx } from './db.js';
import { generateKey, hashKey, last4, encryptReveal, decryptReveal, REVEAL_MS } from './licence.js';

export const MAX_SYNC_BYTES = 64 * 1024;
export const MAX_SYNC_DOCS = 16;
export const DOC_NAME_RE = /^[a-z][a-z0-9_.-]{0,31}$/;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const EVENT_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createStore(db, { aesKey = null, now = () => Date.now(), rand } = {}) {
  const q = {
    byHash: db.prepare('SELECT * FROM licences WHERE key_hash = ?'),
    bySub: db.prepare('SELECT * FROM licences WHERE stripe_subscription_id = ?'),
    bySession: db.prepare('SELECT * FROM licences WHERE checkout_session_id = ?'),
    byId: db.prepare('SELECT * FROM licences WHERE id = ?'),
    insert: db.prepare(`INSERT INTO licences
      (key_hash, last4, stripe_customer_id, stripe_subscription_id, checkout_session_id, status, past_due_since, created_at, updated_at, reveal_ciphertext, reveal_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    status: db.prepare(`UPDATE licences SET
      status = ?,
      past_due_since = CASE WHEN ? = 'past_due' THEN COALESCE(past_due_since, ?) ELSE NULL END,
      stripe_customer_id = COALESCE(stripe_customer_id, ?),
      updated_at = ?
      WHERE id = ?`),
    eventSeen: db.prepare('SELECT 1 FROM stripe_events WHERE id = ?'),
    eventMark: db.prepare('INSERT OR IGNORE INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)'),
    eventPrune: db.prepare('DELETE FROM stripe_events WHERE processed_at < ?'),
    purge: db.prepare('UPDATE licences SET reveal_ciphertext = NULL WHERE reveal_ciphertext IS NOT NULL AND reveal_expires_at <= ?'),
    docs: db.prepare('SELECT name, data, updated_at FROM sync_docs WHERE licence_id = ? ORDER BY name'),
    docPut: db.prepare(`INSERT INTO sync_docs (licence_id, name, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (licence_id, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
  };

  function setStatus(id, status, at = now()) {
    q.status.run(status, status, at, null, now(), id);
    return q.byId.get(id);
  }

  return {
    findByKey(key) { return q.byHash.get(hashKey(key)) || null; },
    findBySubscription(id) { return q.bySub.get(id) || null; },
    findBySession(id) { return q.bySession.get(id) || null; },

    // The one way a licence is made, from the webhook or from the success page, whichever
    // comes first. Idempotent per subscription and per checkout session: a second call
    // returns the same licence and never a second key.
    // Returns { licence, created, key } where key is set only when this call created it.
    ensureLicence({ sessionId, customerId, subscriptionId, status }) {
      if (!aesKey) throw new Error('PRO_SECRET is not set');
      if (!sessionId || !subscriptionId || !status) throw new Error('ensureLicence: missing fields');
      return tx(db, () => {
        const existing = q.bySub.get(subscriptionId) || q.bySession.get(sessionId);
        if (existing) {
          const licence = existing.status === status ? existing : setStatus(existing.id, status);
          return { licence, created: false };
        }
        let key;
        let hash;
        do { key = generateKey(rand); hash = hashKey(key); } while (q.byHash.get(hash));
        const t = now();
        const cipher = encryptReveal(aesKey, key, sessionId);
        const r = q.insert.run(hash, last4(key), customerId || null, subscriptionId, sessionId, status,
          status === 'past_due' ? t : null, t, t, cipher, t + REVEAL_MS);
        return { licence: q.byId.get(r.lastInsertRowid), created: true, key };
      });
    },

    setStatus,

    // The full key for the success page: only for this checkout session, and only within
    // 24 hours of the licence being made. Returns { key, licence } or { expired, licence } or null.
    reveal(sessionId) {
      const lic = q.bySession.get(sessionId);
      if (!lic) return null;
      const t = now();
      if (!aesKey || !lic.reveal_ciphertext || t >= lic.reveal_expires_at || t >= lic.created_at + REVEAL_MS) {
        return { expired: true, licence: lic };
      }
      return { key: decryptReveal(aesKey, lic.reveal_ciphertext, sessionId), licence: lic };
    },

    purgeReveals() { return Number(q.purge.run(now()).changes); },

    isEventProcessed(id) { return Boolean(q.eventSeen.get(id)); },
    markEventProcessed(id, type) {
      q.eventMark.run(id, type, now());
    },
    pruneEvents() { return Number(q.eventPrune.run(now() - EVENT_KEEP_MS).changes); },

    getDocs(licenceId) {
      const out = {};
      for (const r of q.docs.all(licenceId)) out[r.name] = { data: JSON.parse(r.data), updatedAt: r.updated_at };
      return out;
    },

    // Last write wins per document, by updatedAt. The whole set for a licence stays
    // under 64 KB. Throws SyncError for bad input or a set that would be too big.
    putDocs(licenceId, docs) {
      if (!docs || typeof docs !== 'object' || Array.isArray(docs)) throw new SyncError('bad_request', 'Send { docs: { name: { data, updatedAt } } }.');
      const names = Object.keys(docs);
      if (names.length > MAX_SYNC_DOCS) throw new SyncError('bad_request', `At most ${MAX_SYNC_DOCS} documents.`);
      const t = now();
      const incoming = [];
      for (const name of names) {
        const d = docs[name];
        if (!DOC_NAME_RE.test(name)) throw new SyncError('bad_request', 'Bad document name.');
        if (!d || typeof d !== 'object' || !('data' in d)) throw new SyncError('bad_request', 'Each document needs data and updatedAt.');
        let at = d.updatedAt;
        if (!Number.isFinite(at) || at <= 0) throw new SyncError('bad_request', 'updatedAt must be a time in milliseconds.');
        if (at > t + CLOCK_SKEW_MS) at = t; // a clock far in the future must not win forever
        const data = JSON.stringify(d.data);
        if (data === undefined) throw new SyncError('bad_request', 'Bad document data.');
        incoming.push({ name, data, at: Math.floor(at) });
      }
      return tx(db, () => {
        const current = new Map(q.docs.all(licenceId).map((r) => [r.name, r]));
        const writes = incoming.filter((d) => !current.has(d.name) || d.at > current.get(d.name).updated_at);
        const next = new Map([...current].map(([n, r]) => [n, r.data]));
        for (const w of writes) next.set(w.name, w.data);
        if (next.size > MAX_SYNC_DOCS) throw new SyncError('bad_request', `At most ${MAX_SYNC_DOCS} documents.`);
        let bytes = 0;
        for (const [n, data] of next) bytes += Buffer.byteLength(n) + Buffer.byteLength(data);
        if (bytes > MAX_SYNC_BYTES) throw new SyncError('too_large', 'Synced data is capped at 64 KB.');
        for (const w of writes) q.docPut.run(licenceId, w.name, w.data, w.at);
        return writes.map((w) => w.name);
      });
    },
  };
}
