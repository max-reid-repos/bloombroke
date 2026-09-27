// Pro storage: licences, processed Stripe events and synced documents.

import { tx } from './db.js';
import {
  generateKey, hashKey, last4, encryptReveal, decryptReveal, REVEAL_MS,
  generateGiftCode, GIFT_MS, GIFT_CODE_MS, MAX_GIFTS, ACTIVE_STATUSES, isGiftLicence,
} from './licence.js';

export const MAX_SYNC_BYTES = 64 * 1024;
export const MAX_SYNC_DOCS = 16;
export const DOC_NAME_RE = /^[a-z][a-z0-9_.-]{0,31}$/;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const EVENT_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const ENDED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
// Subscription ended for good: synced data goes 30 days after (Privacy Policy).
const ENDED_SQL = "('canceled', 'unpaid')";
const endedAt = (status, t) => (status === 'canceled' || status === 'unpaid' ? t : null);
// The next seat number, read inside the same transaction as the insert. Seats are never
// reused: seat_high (migration 009) remembers the highest seat ever given, even after
// old licence rows are deleted.
const NEXT_SEAT = '(SELECT MAX(COALESCE((SELECT n FROM seat_high WHERE id = 1), 0), COALESCE((SELECT MAX(seat) FROM licences), 0)) + 1)';
// Records: licence rows 5 years after the licence ended, gift code rows 12 months after
// they were used or expired (Privacy Policy).
export const RECORD_KEEP_MS = 5 * 365 * 24 * 60 * 60 * 1000;
export const GIFT_RECORD_KEEP_MS = 365 * 24 * 60 * 60 * 1000;
const INTERVALS = new Set(['month', 'year']);

// A gift code in a listing: never the code, only its last 4 characters and its state.
export function giftState(g, t) {
  if (g.redeemed_at) return 'redeemed';
  return t >= g.expires_at ? 'expired' : 'unused';
}

export class GiftError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

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
    byCustomer: db.prepare('SELECT * FROM licences WHERE stripe_customer_id = ? ORDER BY id'),
    attach: db.prepare(`UPDATE licences SET
      stripe_subscription_id = ?, status = ?,
      past_due_since = CASE WHEN ? = 'past_due' THEN ? ELSE NULL END,
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      terms_accepted_at = COALESCE(?, terms_accepted_at),
      terms_version = COALESCE(?, terms_version),
      livemode = COALESCE(?, livemode),
      ended_at = NULL,
      gift_expires_at = NULL,
      updated_at = ?
      WHERE id = ?`),
    billing: db.prepare('UPDATE licences SET cancel_at_period_end = ?, current_period_end = ?, cancel_at = ?, billing_interval = COALESCE(?, billing_interval) WHERE id = ?'),
    rotate: db.prepare('UPDATE licences SET key_hash = ?, last4 = ?, reveal_ciphertext = NULL, updated_at = ? WHERE id = ?'),
    forget: db.prepare('UPDATE licences SET reveal_ciphertext = NULL WHERE checkout_session_id = ? AND key_hash = ? AND reveal_ciphertext IS NOT NULL'),
    insert: db.prepare(`INSERT INTO licences
      (key_hash, last4, stripe_customer_id, stripe_subscription_id, checkout_session_id, status, past_due_since, created_at, updated_at, reveal_ciphertext, reveal_expires_at, terms_accepted_at, terms_version, livemode, ended_at, seat)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_SEAT})`),
    // A gift licence: its own key and seat, no Stripe ids, Pro until gift_expires_at.
    insertGiftLicence: db.prepare(`INSERT INTO licences
      (key_hash, last4, status, created_at, updated_at, livemode, gift_expires_at, seat)
      VALUES (?, ?, 'gift', ?, ?, ?, ?, ${NEXT_SEAT})`),
    giftByHash: db.prepare('SELECT * FROM gift_codes WHERE code_hash = ?'),
    giftsOf: db.prepare('SELECT * FROM gift_codes WHERE giver_licence_id = ? ORDER BY created_at DESC, id DESC'),
    // Codes that use up one of the 3: redeemed, or not yet expired.
    giftsHeld: db.prepare('SELECT COUNT(*) AS n FROM gift_codes WHERE giver_licence_id = ? AND (redeemed_at IS NOT NULL OR expires_at > ?)'),
    giftInsert: db.prepare('INSERT INTO gift_codes (code_hash, last4, giver_licence_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    giftById: db.prepare('SELECT * FROM gift_codes WHERE id = ?'),
    // The one write that uses a code: only while it is unused and not expired.
    giftUse: db.prepare('UPDATE gift_codes SET redeemed_at = ?, redeemed_licence_id = ? WHERE id = ? AND redeemed_at IS NULL AND expires_at > ?'),
    oldGifts: db.prepare(`DELETE FROM gift_codes WHERE
      (redeemed_at IS NOT NULL AND redeemed_at <= ?) OR (redeemed_at IS NULL AND expires_at <= ?)`),
    // A licence goes once it ended over 5 years ago: a paid one cancelled or unpaid, a gift
    // one whose month ran out. Never while a gift code row still points at it.
    oldLicences: db.prepare(`DELETE FROM licences WHERE (
        (status IN ${ENDED_SQL} AND ended_at IS NOT NULL AND ended_at <= ?)
        OR (gift_expires_at IS NOT NULL AND stripe_subscription_id IS NULL AND gift_expires_at <= ?)
      ) AND NOT EXISTS (SELECT 1 FROM gift_codes g WHERE g.giver_licence_id = licences.id OR g.redeemed_licence_id = licences.id)`),
    endedGiftDocs: db.prepare(`DELETE FROM sync_docs WHERE licence_id IN
      (SELECT id FROM licences WHERE gift_expires_at IS NOT NULL AND stripe_subscription_id IS NULL AND gift_expires_at <= ?)`),
    terms: db.prepare('UPDATE licences SET terms_accepted_at = ?, terms_version = ? WHERE id = ? AND terms_accepted_at IS NULL'),
    status: db.prepare(`UPDATE licences SET
      status = ?,
      past_due_since = CASE WHEN ? = 'past_due' THEN COALESCE(past_due_since, ?) ELSE NULL END,
      stripe_customer_id = COALESCE(stripe_customer_id, ?),
      ended_at = CASE WHEN ? IN ${ENDED_SQL} THEN COALESCE(ended_at, ?) ELSE NULL END,
      updated_at = ?
      WHERE id = ?`),
    endedDocs: db.prepare(`DELETE FROM sync_docs WHERE licence_id IN
      (SELECT id FROM licences WHERE status IN ${ENDED_SQL} AND ended_at IS NOT NULL AND ended_at <= ?)`),
    endedReveals: db.prepare(`UPDATE licences SET reveal_ciphertext = NULL
      WHERE reveal_ciphertext IS NOT NULL AND status IN ${ENDED_SQL} AND ended_at IS NOT NULL AND ended_at <= ?`),
    eventSeen: db.prepare('SELECT 1 FROM stripe_events WHERE id = ?'),
    eventMark: db.prepare('INSERT OR IGNORE INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)'),
    eventPrune: db.prepare('DELETE FROM stripe_events WHERE processed_at < ?'),
    purge: db.prepare('UPDATE licences SET reveal_ciphertext = NULL WHERE reveal_ciphertext IS NOT NULL AND reveal_expires_at <= ?'),
    docs: db.prepare('SELECT name, data, updated_at FROM sync_docs WHERE licence_id = ? ORDER BY name'),
    docPut: db.prepare(`INSERT INTO sync_docs (licence_id, name, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (licence_id, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
  };

  function setStatus(id, status, at = now()) {
    q.status.run(status, status, at, null, status, now(), now(), id);
    return q.byId.get(id);
  }

  return {
    findByKey(key) { return q.byHash.get(hashKey(key)) || null; },
    findBySubscription(id) { return q.bySub.get(id) || null; },
    findBySession(id) { return q.bySession.get(id) || null; },
    findById(id) { return q.byId.get(id) || null; },
    findByCustomer(id) { return q.byCustomer.all(id); },

    // The one way a licence is made, from the webhook or from the success page, whichever
    // comes first. Idempotent per subscription and per checkout session: a second call
    // returns the same licence and never a second key.
    // termsAcceptedAt: when the buyer agreed to the Terms at checkout (ms), or null.
    // licenceId: set for a REACTIVATE checkout (client_reference_id). The new subscription
    // then moves onto that same licence: same key, same synced data.
    // Returns { licence, created, reactivated, key } where key is set only when this call created it.
    // termsVersion: which Terms (TERMS_VERSION) were accepted. livemode: true for a live
    // checkout, false for a test (demo) one, null when unknown.
    ensureLicence({ sessionId, customerId, subscriptionId, status, termsAcceptedAt = null, termsVersion = null, licenceId = null, livemode = null }) {
      const live = livemode === null || livemode === undefined ? null : livemode ? 1 : 0;
      const version = termsAcceptedAt ? termsVersion : null;
      if (!aesKey) throw new Error('PRO_SECRET is not set');
      if (!sessionId || !subscriptionId || !status) throw new Error('ensureLicence: missing fields');
      return tx(db, () => {
        const existing = q.bySub.get(subscriptionId) || q.bySession.get(sessionId);
        if (existing) {
          if (termsAcceptedAt && !existing.terms_accepted_at) q.terms.run(termsAcceptedAt, version, existing.id);
          const licence = existing.status === status ? q.byId.get(existing.id) : setStatus(existing.id, status);
          return { licence, created: false };
        }
        const target = licenceId ? q.byId.get(licenceId) : null;
        if (target) {
          const t = now();
          q.attach.run(subscriptionId, status, status, t, customerId || null, termsAcceptedAt || null, version, live, t, target.id);
          return { licence: q.byId.get(target.id), created: false, reactivated: true, previousSubscription: target.stripe_subscription_id };
        }
        let key;
        let hash;
        do { key = generateKey(rand); hash = hashKey(key); } while (q.byHash.get(hash));
        const t = now();
        const cipher = encryptReveal(aesKey, key, sessionId);
        const r = q.insert.run(hash, last4(key), customerId || null, subscriptionId, sessionId, status,
          status === 'past_due' ? t : null, t, t, cipher, t + REVEAL_MS, termsAcceptedAt || null, version, live, endedAt(status, t));
        return { licence: q.byId.get(r.lastInsertRowid), created: true, key };
      });
    },

    setStatus,

    // Renewal facts from a fresh Stripe subscription: { cancelAtPeriodEnd, currentPeriodEnd, cancelAt }.
    setBilling(id, b) {
      const interval = INTERVALS.has(b.interval) ? b.interval : null;
      q.billing.run(b.cancelAtPeriodEnd ? 1 : 0, b.currentPeriodEnd ?? null, b.cancelAt ?? null, interval, id);
      return q.byId.get(id);
    },

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

    // Daily: licences whose subscription ended (canceled or unpaid) over 30 days ago lose
    // their synced documents and any reveal copy. The licence row itself stays, so the key
    // can still REACTIVATE. Returns counts only.
    purgeEnded() {
      const before = now() - ENDED_KEEP_MS;
      return tx(db, () => ({
        docs: Number(q.endedDocs.run(before).changes) + Number(q.endedGiftDocs.run(before).changes),
        reveals: Number(q.endedReveals.run(before).changes),
      }));
    },

    // Daily: gift code rows used or expired over 12 months ago, then licence rows (with
    // their synced data) whose licence ended over 5 years ago. Returns counts only.
    purgeRecords() {
      const t = now();
      return tx(db, () => {
        const g = t - GIFT_RECORD_KEEP_MS;
        const gifts = Number(q.oldGifts.run(g, g).changes);
        const l = t - RECORD_KEEP_MS;
        const licences = Number(q.oldLicences.run(l, l).changes);
        return { gifts, licences };
      });
    },

    // ---- gifts ------------------------------------------------------------------------
    // The route checks the giver may make gifts (a paid, active licence); this counts.

    // { gifts: [{ last4, createdAt, expiresAt, redeemedAt, state }], held, left }
    listGifts(licenceId) {
      const t = now();
      const rows = q.giftsOf.all(licenceId);
      const held = Number(q.giftsHeld.get(licenceId, t).n);
      return {
        gifts: rows.map((g) => ({ last4: g.last4, createdAt: g.created_at, expiresAt: g.expires_at, redeemedAt: g.redeemed_at ?? null, state: giftState(g, t) })),
        held,
        left: Math.max(0, MAX_GIFTS - held),
      };
    },

    // A new code for this licence, or GiftError('limit') when 3 are redeemed or unused.
    // Returns { code, gift }: the code in full, this one time only.
    createGift(licenceId) {
      return tx(db, () => {
        if (!q.byId.get(licenceId)) throw new Error('no such licence');
        const t = now();
        if (Number(q.giftsHeld.get(licenceId, t).n) >= MAX_GIFTS) throw new GiftError('limit', `You have made ${MAX_GIFTS} gift codes. A code that expires unused frees its place.`);
        let code;
        let hash;
        do { code = generateGiftCode(rand); hash = hashKey(code); } while (q.giftByHash.get(hash));
        const r = q.giftInsert.run(hash, last4(code), licenceId, t, t + GIFT_CODE_MS);
        const g = q.giftById.get(r.lastInsertRowid);
        return { code, gift: { last4: g.last4, createdAt: g.created_at, expiresAt: g.expires_at, redeemedAt: null, state: 'unused' } };
      });
    },

    // Use a code: one new licence with its own key and seat, Pro for 30 days, in one
    // transaction, so a code can never make two licences. Throws GiftError('bad_code' |
    // 'used' | 'expired'). Returns { key, licence }: the key in full, this one time only.
    redeemGift(code) {
      return tx(db, () => {
        const g = q.giftByHash.get(hashKey(code));
        if (!g) throw new GiftError('bad_code', 'That gift code is not valid. Check it and try again.');
        const t = now();
        if (g.redeemed_at) throw new GiftError('used', 'That gift code has already been used.');
        if (t >= g.expires_at) throw new GiftError('expired', 'That gift code has expired.');
        const giver = q.byId.get(g.giver_licence_id);
        // A code works only while the paid subscription that made it is active.
        if (!giver || isGiftLicence(giver) || !giver.stripe_subscription_id || !ACTIVE_STATUSES.has(giver.status)) {
          throw new GiftError('giver_inactive', 'This gift code no longer works: the Pro subscription that made it is not active.');
        }
        let key;
        let hash;
        do { key = generateKey(rand); hash = hashKey(key); } while (q.byHash.get(hash));
        const live = giver?.livemode === 0 || giver?.livemode === 1 ? giver.livemode : null;
        const r = q.insertGiftLicence.run(hash, last4(key), t, t, live, t + GIFT_MS);
        if (Number(q.giftUse.run(t, r.lastInsertRowid, g.id, t).changes) !== 1) throw new GiftError('used', 'That gift code has already been used.');
        return { key, licence: q.byId.get(r.lastInsertRowid) };
      });
    },

    // The browser saved the key: wipe the reveal copy now. Needs the key itself.
    forgetReveal(sessionId, key) { return Number(q.forget.run(sessionId, hashKey(key)).changes) > 0; },

    // A lost key: give the licence a new one. The old key stops working at once.
    rotateKey(licenceId) {
      return tx(db, () => {
        if (!q.byId.get(licenceId)) throw new Error('no such licence');
        let key;
        let hash;
        do { key = generateKey(rand); hash = hashKey(key); } while (q.byHash.get(hash));
        q.rotate.run(hash, last4(key), now(), licenceId);
        return { key, licence: q.byId.get(licenceId) };
      });
    },

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
        // Strictly newer wins. On a tie the server copy stays, even if it differs; the
        // client sees it in the reply and adopts it.
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
