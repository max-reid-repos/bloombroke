// PINGS: Web Push notifications for Pro, when the tab is closed. CHAT message pings and
// closed-tab ALERTS. The sending half is pro/push-send.js; the browser half is
// public/push.js (ME turns it on) and public/sw.js (the service worker that shows them).
//
//   GET  /api/push/key          -> { key }   the public VAPID key (no key needed)
//   GET  /api/push/prefs        X-Pro-Key -> { chat, alerts, show_text, devices }
//   POST /api/push/subscribe    X-Pro-Key, { endpoint, keys: { p256dh, auth } } -> { ok, devices }
//   POST /api/push/unsubscribe  X-Pro-Key, { endpoint } -> { ok }   (any valid key)
//   PUT  /api/push/prefs        X-Pro-Key, { chat?, alerts?, show_text? } -> the prefs
//   PUT  /api/push/alerts       X-Pro-Key, { alerts: [...], endpoint? } -> { ok, count, on }
//   POST /api/push/test         X-Pro-Key -> { ok, sent }   one test ping to every device
//   POST /api/push/resubscribe  { old, sub }  -> { ok }   the service worker, when the browser
//                               replaced a subscription: the old address proves it (no key)
//
// Every route but /key needs an active Pro key (unsubscribe: any valid key, so a lapsed
// plan can still turn a device off); every write needs a same-origin browser request.
// A wrong key counts against the wrong-key limit Pro, CHAT and ME share.
// Without VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the environment the feature is off:
// every route answers 404 push_off, and nothing is sent. Stored rows are still purged.
//
// Environment: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (scripts/vapid-keys.js makes a pair),
// VAPID_SUBJECT (mailto:hello@bloombroke.com by default). PUSH_DEV_HOSTS: development
// only, extra push hosts on this machine (localhost or 127.0.0.1 with a port), for a fake
// push service; never set in production.

import express from 'express';
import { Agent } from 'node:https';
import { tx } from './db.js';
import { normalizeKey } from './licence.js';
import { publicStatus, KEY_HEADER } from './routes.js';
import { createLimiter, clientIp } from './ratelimit.js';
import { sameOrigin } from './feedback.js';
import { isDeletedLicence, DELETED_PREFIX, ENDED_KEEP_MS } from './store.js';
import {
  createSender, createChatPinger, createAlertLoop, TEST_PAYLOAD, SEND_TIMEOUT_MS,
} from './push-send.js';

const MIN = 60 * 1000;
export const MAX_SUBS = 10;
export const MAX_SERVER_ALERTS = 20;
export const MAX_ENDPOINT = 1024;
export const DEFAULT_SUBJECT = 'mailto:hello@bloombroke.com';
export const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
export const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];
export const OFF_MESSAGE = 'Pings are not on at this site.';
const OPS = new Set(['>', '<', '>=', '<=']);
const ALERT_ID_RE = /^[a-z0-9]{1,24}$/; // public/alerts.js cleanAlerts
const SYM_RE = /^[A-Z0-9.&/-]{1,16}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export class PushError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const b64len = (s) => Buffer.from(s, 'base64url').length;

// The VAPID keys from the environment, or null (the feature is off). A key that is not
// the right shape is off too, with a line in the log.
export function pushConfig(env = process.env, log = console) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) return null;
  if (!B64URL_RE.test(publicKey) || b64len(publicKey) !== 65 || !B64URL_RE.test(privateKey) || b64len(privateKey) !== 32) {
    log.error?.('[push] VAPID keys are not valid: pings are off');
    return null;
  }
  const subject = String(env.VAPID_SUBJECT || '').trim() || DEFAULT_SUBJECT;
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    log.error?.('[push] VAPID_SUBJECT must be mailto: or https://: pings are off');
    return null;
  }
  const devHosts = String(env.PUSH_DEV_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
    .filter((h) => /^(localhost|127\.0\.0\.1):\d{2,5}$/.test(h));
  return { publicKey, privateKey, subject, devHosts };
}

// Is this a push service we send to? https, a known host, no user or password, the
// default port. devHosts (development): host:port on this machine.
export function pushHostOk(endpoint, devHosts = []) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (devHosts.includes(u.host.toLowerCase())) return true;
  if (u.port) return false;
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

// { endpoint, keys: { p256dh, auth } } as the browser's PushSubscription.toJSON() gives it.
export function cleanSubscription(body, devHosts = []) {
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT || !pushHostOk(endpoint, devHosts)) {
    throw new PushError('bad_endpoint', 'That push address is not one we send to.');
  }
  // p256dh: an uncompressed P-256 point (65 bytes, 0x04 first); auth: 16 bytes.
  if (typeof p256dh !== 'string' || p256dh.length > 128 || !B64URL_RE.test(p256dh.replace(/=+$/, ''))) throw new PushError('bad_keys', 'The browser keys are missing.');
  if (typeof auth !== 'string' || auth.length > 64 || !B64URL_RE.test(auth.replace(/=+$/, ''))) throw new PushError('bad_keys', 'The browser keys are missing.');
  const key = Buffer.from(p256dh.replace(/=+$/, ''), 'base64url');
  if (key.length !== 65 || key[0] !== 4 || b64len(auth.replace(/=+$/, '')) !== 16) throw new PushError('bad_keys', 'The browser keys are not valid.');
  return { endpoint, p256dh: p256dh.replace(/=+$/, ''), auth: auth.replace(/=+$/, '') };
}

// { chat?, alerts?, show_text? }: booleans only, at least one.
export function cleanPrefsPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PushError('bad_request', 'Send { chat, alerts, show_text }.');
  const out = {};
  for (const k of ['chat', 'alerts', 'show_text']) {
    if (!(k in body)) continue;
    if (typeof body[k] !== 'boolean') throw new PushError('bad_request', 'Each setting is true or false.');
    out[k] = body[k];
  }
  if (!Object.keys(out).length) throw new PushError('bad_request', 'Send { chat, alerts, show_text }.');
  return out;
}

// The browser's price alerts (public/alerts.js), checked like its own cleanAlerts:
// [{ id, sym, op, level, dp?, state, rearmed? }], 20 at most, quote alerts only (a WEIRD
// gauge stays with the tab). Anything malformed refuses the whole list.
export function cleanServerAlerts(list) {
  if (!Array.isArray(list)) throw new PushError('bad_request', 'Send { alerts: [...] }.');
  if (list.length > MAX_SERVER_ALERTS) throw new PushError('too_many', `${MAX_SERVER_ALERTS} alerts at most.`);
  const out = [];
  const ids = new Set();
  for (const a of list) {
    const bad = () => new PushError('bad_alert', 'One of the alerts is not valid.');
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw bad();
    if (typeof a.id !== 'string' || !ALERT_ID_RE.test(a.id) || ids.has(a.id)) throw bad();
    if (a.kind !== undefined && a.kind !== 'quote') throw bad();
    if (typeof a.sym !== 'string' || !SYM_RE.test(a.sym)) throw bad();
    if (!OPS.has(a.op)) throw bad();
    if (typeof a.level !== 'number' || !Number.isFinite(a.level) || Math.abs(a.level) > 1e12) throw bad();
    if (a.state !== 'waiting' && a.state !== 'triggered') throw bad();
    const dp = a.dp === undefined ? 2 : a.dp;
    if (!Number.isInteger(dp) || dp < 0 || dp > 8) throw bad();
    ids.add(a.id);
    out.push({ id: a.id, sym: a.sym, op: a.op, level: a.level, dp, state: a.state, rearmed: a.rearmed === true });
  }
  return out;
}

// A licence whose Pro ended over 30 days ago (store.js purgeEnded, chat-store.js ENDED),
// or an account deleted in ME.
const GONE = `SELECT id FROM licences WHERE
  (status IN ('canceled', 'unpaid') AND ended_at IS NOT NULL AND ended_at <= @before)
  OR (gift_expires_at IS NOT NULL AND stripe_subscription_id IS NULL AND gift_expires_at <= @before)
  OR key_hash LIKE @deleted`;

export function createPushStore(db, { now = () => Date.now() } = {}) {
  const q = {
    subsOf: db.prepare('SELECT * FROM push_subs WHERE licence_id = ? ORDER BY id'),
    count: db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE licence_id = ?'),
    byEndpoint: db.prepare('SELECT * FROM push_subs WHERE endpoint = ?'),
    upsert: db.prepare(`INSERT INTO push_subs (licence_id, endpoint, p256dh, auth, created_at) VALUES (@lic, @endpoint, @p256dh, @auth, @t)
      ON CONFLICT (endpoint) DO UPDATE SET licence_id = excluded.licence_id, p256dh = excluded.p256dh, auth = excluded.auth, fail_count = 0`),
    dropMine: db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND licence_id = ?'),
    drop: db.prepare('DELETE FROM push_subs WHERE id = ?'),
    move: db.prepare('UPDATE push_subs SET endpoint = @endpoint, p256dh = @p256dh, auth = @auth, fail_count = 0 WHERE id = @id'),
    ok: db.prepare('UPDATE push_subs SET last_ok_at = ?, fail_count = 0 WHERE id = ?'),
    fail: db.prepare('UPDATE push_subs SET fail_count = fail_count + 1 WHERE id = ? RETURNING fail_count'),
    prefs: db.prepare('SELECT * FROM push_prefs WHERE licence_id = ?'),
    setPrefs: db.prepare(`INSERT INTO push_prefs (licence_id, chat, alerts, show_text, updated_at) VALUES (@lic, @chat, @alerts, @show_text, @t)
      ON CONFLICT (licence_id) DO UPDATE SET chat = excluded.chat, alerts = excluded.alerts, show_text = excluded.show_text, updated_at = excluded.updated_at`),
    alertsOf: db.prepare('SELECT * FROM server_alerts WHERE licence_id = ? ORDER BY id'),
    addAlert: db.prepare(`INSERT INTO server_alerts (licence_id, client_id, symbol, op, level, dp, armed, created_at, fired_at)
      VALUES (@lic, @id, @sym, @op, @level, @dp, @armed, @t, @fired)`),
    setAlert: db.prepare('UPDATE server_alerts SET dp = @dp, armed = @armed, fired_at = @fired WHERE id = @rid'),
    dropAlert: db.prepare('DELETE FROM server_alerts WHERE id = ?'),
    waiting: db.prepare(`SELECT a.* FROM server_alerts a JOIN push_prefs p ON p.licence_id = a.licence_id AND p.alerts = 1
      WHERE a.fired_at IS NULL AND EXISTS (SELECT 1 FROM push_subs s WHERE s.licence_id = a.licence_id) ORDER BY a.id`),
    arm: db.prepare('UPDATE server_alerts SET armed = 1 WHERE id = ? AND fired_at IS NULL'),
    fire: db.prepare('UPDATE server_alerts SET fired_at = ? WHERE id = ? AND fired_at IS NULL'),
    forgetSubs: db.prepare('DELETE FROM push_subs WHERE licence_id = ?'),
    forgetPrefs: db.prepare('DELETE FROM push_prefs WHERE licence_id = ?'),
    forgetAlerts: db.prepare('DELETE FROM server_alerts WHERE licence_id = ?'),
    goneSubs: db.prepare(`DELETE FROM push_subs WHERE licence_id IN (${GONE})`),
    gonePrefs: db.prepare(`DELETE FROM push_prefs WHERE licence_id IN (${GONE})`),
    goneAlerts: db.prepare(`DELETE FROM server_alerts WHERE licence_id IN (${GONE})`),
  };
  const sameAlert = (row, a) => row.client_id === a.id && row.symbol === a.sym && row.op === a.op && row.level === a.level;
  return {
    subsOf: (lic) => q.subsOf.all(lic),
    hasSubs: (lic) => Number(q.count.get(lic).n) > 0,
    devices: (lic) => Number(q.count.get(lic).n),
    hasEndpoint: (lic, endpoint) => q.byEndpoint.get(endpoint)?.licence_id === lic,
    // A new device, or the same browser again (its keys may have changed). A browser
    // that was another licence's is this licence's now (it logged in with this key).
    subscribe(lic, sub) {
      return tx(db, () => {
        const had = q.byEndpoint.get(sub.endpoint);
        if (had?.licence_id !== lic && Number(q.count.get(lic).n) >= MAX_SUBS) {
          throw new PushError('too_many', `Pings go to ${MAX_SUBS} devices at most. Turn them off on one first.`, 409);
        }
        q.upsert.run({ lic, ...sub, t: now() });
        return Number(q.count.get(lic).n);
      });
    },
    unsubscribe: (lic, endpoint) => Number(q.dropMine.run(endpoint, lic).changes) > 0,
    // The browser replaced a subscription: the old address becomes the new one, for the
    // same licence. False when the old address is not ours (any more).
    move(oldEndpoint, sub) {
      return tx(db, () => {
        const row = q.byEndpoint.get(oldEndpoint);
        if (!row) return false;
        const clash = q.byEndpoint.get(sub.endpoint);
        if (clash && clash.id !== row.id) q.drop.run(clash.id);
        q.move.run({ id: row.id, ...sub });
        return true;
      });
    },
    dropSub: (id) => q.drop.run(id),
    sendOk: (id, t) => q.ok.run(t, id),
    sendFailed: (id) => Number(q.fail.get(id)?.fail_count || 0),
    prefs(lic) {
      const r = q.prefs.get(lic);
      return { chat: Boolean(r?.chat), alerts: Boolean(r?.alerts), show_text: Boolean(r?.show_text) };
    },
    setPrefs(lic, patch) {
      const next = { ...this.prefs(lic), ...patch };
      q.setPrefs.run({ lic, chat: next.chat ? 1 : 0, alerts: next.alerts ? 1 : 0, show_text: next.show_text ? 1 : 0, t: now() });
      return next;
    },
    alertsOf: (lic) => q.alertsOf.all(lic),
    // Closed-tab alerts off: the copy of the alerts goes (the Privacy Policy).
    clearAlerts: (lic) => Number(q.forgetAlerts.run(lic).changes),
    // Replace the licence's server alerts with the browser's list (cleanServerAlerts).
    // New here and TRIGGERED there: it fired in the tab before the server had it, so it
    // never fires here. Already here and TRIGGERED there since: the tab saw the crossing
    // first (its notification stands down), so the server's own check still pings it,
    // once. WAITING there: re-armed, or fired here while the tab was not looking, it
    // waits for a fresh crossing (armed 0); a new one fires when its condition is true.
    replaceAlerts(lic, list) {
      return tx(db, () => {
        const t = now();
        const rows = q.alertsOf.all(lic);
        const kept = new Set();
        for (const a of list) {
          const row = rows.find((r) => !kept.has(r.id) && sameAlert(r, a));
          let fired = null;
          let armed = row ? row.armed : 1;
          if (a.state === 'triggered') fired = row ? row.fired_at : t;
          else if (a.rearmed || row?.fired_at) armed = 0;
          if (row) {
            kept.add(row.id);
            q.setAlert.run({ rid: row.id, dp: a.dp, armed, fired });
          } else {
            q.addAlert.run({ lic, id: a.id, sym: a.sym, op: a.op, level: a.level, dp: a.dp, armed, t, fired });
          }
        }
        for (const r of rows) if (!kept.has(r.id)) q.dropAlert.run(r.id);
        return list.length;
      });
    },
    // DOWNLOAD MY DATA: each device as its push service's host name and when it was
    // added (never the address or the keys), the settings, and the copy of the alerts.
    exportOf(lic) {
      const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
      const host = (e) => { try { return new URL(e).hostname; } catch { return null; } };
      return {
        devices: q.subsOf.all(lic).map((r) => ({ push_service: host(r.endpoint), added: iso(r.created_at), last_ping: iso(r.last_ok_at) })),
        settings: this.prefs(lic),
        alerts: q.alertsOf.all(lic).map((r) => ({ symbol: r.symbol, op: r.op, level: r.level, added: iso(r.created_at), fired: iso(r.fired_at) })),
      };
    },
    waitingAlerts: () => q.waiting.all(),
    armAlert: (id) => q.arm.run(id),
    fireAlert: (id, t) => Number(q.fire.run(t, id).changes) === 1,
    // NEW KEY: every device is logged out, so every subscription goes.
    forgetDevices: (lic) => Number(q.forgetSubs.run(lic).changes),
    // DELETE MY ACCOUNT: everything.
    wipe(lic) {
      return tx(db, () => Number(q.forgetSubs.run(lic).changes) + Number(q.forgetPrefs.run(lic).changes) + Number(q.forgetAlerts.run(lic).changes));
    },
    // Daily (Privacy Policy): every push row of a licence whose Pro ended over 30 days
    // ago, and of a deleted account. Counts only.
    purge(t = now()) {
      const p = { before: t - ENDED_KEEP_MS, deleted: `${DELETED_PREFIX}%` };
      return tx(db, () => ({
        subs: Number(q.goneSubs.run(p).changes),
        prefs: Number(q.gonePrefs.run(p).changes),
        alerts: Number(q.goneAlerts.run(p).changes),
      }));
    },
  };
}

export function pushLimits(now = () => Date.now()) {
  return {
    read: createLimiter({ max: 600, windowMs: 10 * MIN, now }),
    write: createLimiter({ max: 60, windowMs: 60 * MIN, now }),
    alerts: createLimiter({ max: 120, windowMs: 60 * MIN, now }),
    test: createLimiter({ max: 3, windowMs: 60 * MIN, now }),
    // resubscribe, per IP (it has no key).
    resub: createLimiter({ max: 20, windowMs: 60 * MIN, now }),
  };
}

// The real sender: web-push, with this site's VAPID keys. A development host
// (PUSH_DEV_HOSTS) is a local fake push service with a self-signed certificate.
export async function webPushSend(config) {
  const { default: webpush } = await import('web-push');
  const devAgent = config.devHosts.length ? new Agent({ rejectUnauthorized: false }) : null;
  const vapidDetails = { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey };
  return (subscription, body, { ttl, urgency, topic } = {}) => {
    const opts = { vapidDetails, TTL: ttl, urgency, timeout: SEND_TIMEOUT_MS };
    if (topic) opts.topic = topic;
    if (devAgent && config.devHosts.includes(new URL(subscription.endpoint).host)) opts.agent = devAgent;
    return webpush.sendNotification(subscription, body, opts);
  };
}

// deps: db (the Pro database), store (licences), guess (the shared wrong-key limiter),
// mode (the Stripe mode), config (pushConfig, or null: off), send (tests: a fake sender;
// otherwise web-push), getQuoteList (the server's quote function, for ALERTS).
// Returns { enabled, store, sender, onMessage, alerts, forgetDevices, wipe, purge }.
export function mountPush(app, {
  db, store, guess = createLimiter({ max: 20, windowMs: 15 * MIN }), mode = 'live', publicUrl = 'https://bloombroke.com',
  config = null, send = null, getQuoteList = async () => ({ quotes: [] }), now = () => Date.now(), log = console,
  limits = pushLimits(now), alertEveryMs, concurrency,
}) {
  const push = createPushStore(db, { now });
  const base = {
    enabled: false, store: push, sender: null, alerts: null, onMessage: () => 0, exportOf: (lic) => push.exportOf(lic),
    forgetDevices: (lic) => push.forgetDevices(lic), wipe: (lic) => push.wipe(lic), purge: (t) => push.purge(t),
  };
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  if (!config) {
    app.use('/api/push', (req, res) => { res.set('Cache-Control', 'no-store'); fail(res, 404, 'push_off', OFF_MESSAGE); });
    return base;
  }

  // Sending starts once web-push has loaded (a dynamic import); pings asked for before
  // that wait in the queue.
  let sendImpl = send;
  const ready = sendImpl ? Promise.resolve() : webPushSend(config).then((fn) => { sendImpl = fn; });
  ready.catch((err) => log.error?.('[push] web-push did not load:', err?.message));
  const sender = createSender({ store: push, send: async (...a) => { await ready; return sendImpl(...a); }, log, now, concurrency });
  const isActive = (id) => {
    const l = store.findById(id);
    return Boolean(l && !isDeletedLicence(l) && publicStatus(l, now(), mode).active);
  };
  const onMessage = createChatPinger({ store: push, sender, isActive, now });
  const alerts = createAlertLoop({ store: push, sender, getQuoteList, isActive, now, log, everyMs: alertEveryMs });

  const limited = (res, r, message = 'Too many tries. Wait a few minutes and try again.') => {
    res.set('Retry-After', String(r.retryAfter));
    return fail(res, 429, 'rate_limited', message);
  };
  // The licence behind X-Pro-Key; active Pro unless any: true. Or the error is sent.
  function auth(req, res, { any = false } = {}) {
    const ip = clientIp(req);
    if (guess.blocked(ip)) { limited(res, guess.hit(ip)); return null; }
    const key = normalizeKey(req.get(KEY_HEADER) || '');
    const lic = key ? store.findByKey(key) : null;
    if (!lic) {
      guess.hit(ip);
      fail(res, 401, 'bad_key', 'That key is not valid. Check it and try LOGIN again.');
      return null;
    }
    if (!any && !publicStatus(lic, now(), mode).active) { fail(res, 402, 'not_active', 'Pings come with Pro.'); return null; }
    return lic;
  }

  const r = express.Router();
  r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  r.get('/key', (req, res) => res.json({ key: config.publicKey }));
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Use ME on bloombroke.com.');
    next();
  });
  const body = express.json({ limit: '4kb' });

  r.post('/resubscribe', body, (req, res) => {
    const hit = limits.resub.hit(clientIp(req));
    if (!hit.ok) return limited(res, hit);
    const old = req.body?.old;
    if (typeof old !== 'string' || old.length > MAX_ENDPOINT) return fail(res, 400, 'bad_endpoint', 'Send { old, sub }.');
    const sub = cleanSubscription(req.body?.sub, config.devHosts);
    if (!push.move(old, sub)) return fail(res, 404, 'not_found', 'Turn pings on again in ME.');
    res.json({ ok: true });
  });

  const count = (lim, lic, res) => {
    const hit = lim.hit(`lic:${lic.id}`);
    if (!hit.ok) { limited(res, hit); return false; }
    return true;
  };

  r.get('/prefs', (req, res) => {
    const lic = auth(req, res);
    if (!lic || !count(limits.read, lic, res)) return;
    res.json({ ...push.prefs(lic.id), devices: push.devices(lic.id) });
  });

  r.post('/subscribe', body, (req, res) => {
    const lic = auth(req, res);
    if (!lic || !count(limits.write, lic, res)) return;
    const sub = cleanSubscription(req.body, config.devHosts);
    res.json({ ok: true, devices: push.subscribe(lic.id, sub) });
  });

  r.post('/unsubscribe', body, (req, res) => {
    const lic = auth(req, res, { any: true });
    if (!lic || !count(limits.write, lic, res)) return;
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT) return fail(res, 400, 'bad_endpoint', 'Send { endpoint }.');
    push.unsubscribe(lic.id, endpoint);
    res.json({ ok: true });
  });

  r.put('/prefs', body, (req, res) => {
    const lic = auth(req, res);
    if (!lic || !count(limits.write, lic, res)) return;
    const patch = cleanPrefsPatch(req.body);
    const next = push.setPrefs(lic.id, patch);
    if (patch.alerts === false) push.clearAlerts(lic.id);
    res.json({ ...next, devices: push.devices(lic.id) });
  });

  r.put('/alerts', body, (req, res) => {
    const lic = auth(req, res);
    if (!lic || !count(limits.alerts, lic, res)) return;
    const list = cleanServerAlerts(req.body?.alerts);
    const endpoint = req.body?.endpoint;
    if (endpoint !== undefined && (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT)) return fail(res, 400, 'bad_endpoint', 'Send { endpoint }.');
    const n = push.replaceAlerts(lic.id, list);
    // on: this licence's server alerts ping (with an endpoint: this very device).
    const prefs = push.prefs(lic.id);
    const on = prefs.alerts && (endpoint ? push.hasEndpoint(lic.id, endpoint) : push.hasSubs(lic.id));
    res.json({ ok: true, count: n, on });
  });

  r.post('/test', (req, res) => {
    const lic = auth(req, res);
    if (!lic) return;
    const hit = limits.test.hit(`lic:${lic.id}`);
    if (!hit.ok) return limited(res, hit, 'Three test pings an hour. Try again later.');
    const sent = sender.toLicence(lic.id, TEST_PAYLOAD, { ttl: 60, urgency: 'high', topic: 'test' });
    if (!sent) return fail(res, 409, 'no_device', 'Turn pings on first.');
    res.json({ ok: true, sent });
  });

  r.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof PushError) return fail(res, err.status, err.code, err.message);
    if (err?.type === 'entity.too.large') return fail(res, 413, 'too_large', 'That request is too large.');
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_json', 'That is not valid JSON.');
    log.error?.('[push]', err?.message);
    return fail(res, 500, 'error', 'Something went wrong. Try again in a minute.');
  });
  app.use('/api/push', r);

  return { ...base, enabled: true, sender, onMessage, alerts, isActive };
}
