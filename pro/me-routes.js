// ME routes: your username, name colour and pixel avatar, DOWNLOAD MY DATA and DELETE MY
// ACCOUNT. Mounted from pro/chat-routes.js (mountChat): the profile is the CHAT profile
// row, and the wrong-key limiter is the one Pro and CHAT share, so ME is no third place to
// guess keys. NEW KEY is POST /api/pro/rotate (pro/routes.js).
//
//   GET  /api/me              X-Pro-Key -> { seat, username, color, avatar, status }
//   PUT  /api/me/profile      X-Pro-Key, { username?, color?, avatar? } -> { me }   (active Pro)
//   POST /api/me/export       X-Pro-Key -> a JSON file of what we hold about you
//   POST /api/me/delete       X-Pro-Key, { confirm: 'DELETE' } -> { ok, message }
//
// Every write needs a same-origin browser request; export is a POST for the same reason
// (a browser sends Origin on a POST). Nothing that goes out holds a key, a key hash, a
// licence id or a Stripe id, and every error is a fixed string.

import express from 'express';
import { normalizeKey, isGiftLicence } from './licence.js';
import { publicStatus, KEY_HEADER } from './routes.js';
import { createLimiter, clientIp } from './ratelimit.js';
import { sameOrigin } from './feedback.js';
import { tx } from './db.js';
import { ChatError, cleanUsername, cleanColor, cleanAvatar, DAY_MS } from './chat.js';

const MIN = 60 * 1000;
export const RENEWING = 'Cancel first: press CANCEL. Then delete.';
export const DELETED = 'Your account is deleted. This browser is logged out.';
export const CONFIRM_WORD = 'DELETE';

export function meLimits(now = () => Date.now()) {
  return {
    read: createLimiter({ max: 600, windowMs: 10 * MIN, now }),
    profile: createLimiter({ max: 30, windowMs: 60 * MIN, now }),
    export: createLimiter({ max: 5, windowMs: DAY_MS, now }),
    del: createLimiter({ max: 5, windowMs: DAY_MS, now }),
  };
}

// Would this licence be charged again? A live subscription that is not set to end.
// Gift and demo licences, and a subscription that is cancelled or set to cancel, never are.
export function willRenew(lic, mode = 'live') {
  if (!lic || isGiftLicence(lic) || !lic.stripe_subscription_id) return false;
  if (mode === 'live' && lic.livemode === 0) return false;
  if (lic.cancel_at_period_end || Number.isFinite(lic.cancel_at)) return false;
  return !['canceled', 'incomplete_expired'].includes(lic.status);
}

// What ME shows about the plan: the public status without the key's last characters.
const planOf = (status) => { const { last4, ...rest } = status; return rest; };
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

export function mountMe(app, {
  store, chat, hub = null, guess = createLimiter({ max: 20, windowMs: 15 * MIN }), mode = 'live', publicUrl = 'https://bloombroke.com',
  now = () => Date.now(), log = console, limits = meLimits(now), db, onDelete = () => {}, pingsOf = null,
}) {
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  // The plan as PRO sees it, a founders seat's class too (store.foundersClassOf).
  const classOf = store.foundersClassOf ? (id, lm) => store.foundersClassOf(id, lm) : null;
  const statusOf = (lic) => publicStatus(lic, now(), mode, { classOf });
  const limited = (res, r, message = 'Too many tries. Wait a few minutes and try again.') => {
    res.set('Retry-After', String(r.retryAfter));
    return fail(res, 429, 'rate_limited', message);
  };

  // X-Pro-Key -> the licence, or the error is sent and null returned. A wrong key counts
  // as a guess, like everywhere else.
  function auth(req, res) {
    const ip = clientIp(req);
    if (guess.blocked(ip)) { limited(res, guess.hit(ip)); return null; }
    const key = normalizeKey(req.get(KEY_HEADER) || '');
    const lic = key ? store.findByKey(key) : null;
    if (!lic) {
      guess.hit(ip);
      fail(res, 401, 'bad_key', 'That key is not valid. Check it and try LOGIN again.');
      return null;
    }
    return lic;
  }
  const meOf = (lic) => {
    const p = chat.profile(lic.id);
    return { seat: Number.isInteger(lic.seat) ? lic.seat : null, username: p.username, color: p.color, avatar: p.avatar };
  };

  const r = express.Router();
  r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Use ME on bloombroke.com.');
    next();
  });
  const body = express.json({ limit: '1kb' });

  r.get('/', (req, res) => {
    const lic = auth(req, res);
    if (!lic) return;
    const hit = limits.read.hit(`lic:${lic.id}`);
    if (!hit.ok) return limited(res, hit);
    res.json({ ...meOf(lic), status: planOf(statusOf(lic)) });
  });

  r.put('/profile', body, (req, res) => {
    const lic = auth(req, res);
    if (!lic) return;
    if (!publicStatus(lic, now(), mode).active) return fail(res, 402, 'not_active', 'Username, colour and avatar come with Pro.');
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || !['username', 'color', 'avatar'].some((k) => k in b)) {
      return fail(res, 400, 'bad_request', 'Send { username, color, avatar }.');
    }
    const hit = limits.profile.hit(`lic:${lic.id}`);
    if (!hit.ok) return limited(res, hit);
    const patch = {};
    if ('username' in b) patch.username = cleanUsername(b.username);
    if ('color' in b) patch.color = cleanColor(b.color);
    if ('avatar' in b) patch.avatar = cleanAvatar(b.avatar);
    const p = chat.setProfile(lic.id, patch);
    // Your other tabs and CHAT redraw; the people you chat with see it on their next load.
    hub?.emit([lic.id], { type: 'rooms' });
    res.json({ me: { seat: p.seat, username: p.name, color: p.color, avatar: p.avatar } });
  });

  // DOWNLOAD MY DATA: a JSON file. You, your plan (no Stripe ids, no key), your synced
  // documents, what CHAT holds about you, and the state of the gift codes you made.
  r.post('/export', (req, res) => {
    const lic = auth(req, res);
    if (!lic) return;
    const hit = limits.export.hit(`lic:${lic.id}`);
    if (!hit.ok) return limited(res, hit, 'That is a lot of downloads for one day. Try again tomorrow.');
    const status = planOf(statusOf(lic));
    const docs = store.getDocs(lic.id);
    const gifts = store.listGifts(lic.id).gifts.map((g) => ({ state: g.state, made: iso(g.createdAt), expires: iso(g.expiresAt), used: iso(g.redeemedAt) }));
    const me = meOf(lic);
    const out = {
      exported_at: new Date(now()).toISOString(),
      seat: me.seat,
      username: me.username,
      colour: me.color,
      avatar: me.avatar,
      plan: {
        ...status,
        started: iso(lic.created_at),
        terms_version: lic.terms_version || null,
        terms_accepted_at: iso(lic.terms_accepted_at),
      },
      synced: Object.fromEntries(Object.entries(docs).map(([name, d]) => [name, { data: d.data, updated_at: iso(d.updatedAt) }])),
      chat: chat.exportOf(lic.id),
      gift_codes: gifts,
    };
    // PINGS (pro/push.js): devices by push service and date, settings, the alert copy.
    if (pingsOf) {
      try { out.pings = pingsOf(lic.id); } catch (err) { log.error('[me] pings export', err?.message); }
    }
    res.set('Content-Disposition', 'attachment; filename="bloombroke-my-data.json"');
    res.type('application/json').send(JSON.stringify(out, null, 2));
  });

  // DELETE MY ACCOUNT. Only when nothing will renew; Stripe is never called here. Your
  // profile, synced documents, CHAT rows and unused gift codes go, and the key stops
  // working. The licence record (seat, dates, Stripe ids) stays for the 5-year rule.
  r.post('/delete', body, (req, res) => {
    const lic = auth(req, res);
    if (!lic) return;
    const hit = limits.del.hit(`lic:${lic.id}`);
    if (!hit.ok) return limited(res, hit);
    if (req.body?.confirm !== CONFIRM_WORD) return fail(res, 400, 'confirm', 'Type DELETE to confirm.');
    if (willRenew(lic, mode)) return fail(res, 409, 'renewing', RENEWING);
    tx(db, () => {
      chat.wipeAccount(lic.id);
      store.closeAccount(lic.id);
    });
    try { onDelete(lic.id); } catch (err) { log.error('[me] drive end', err?.message); }
    hub?.emit([lic.id], { type: 'rooms' });
    res.json({ ok: true, message: DELETED });
  });

  r.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ChatError) return fail(res, err.status, err.code, err.message);
    if (err?.type === 'entity.too.large') return fail(res, 413, 'too_large', 'That request is too large.');
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_json', 'That is not valid JSON.');
    log.error('[me]', err?.message);
    return fail(res, 500, 'error', 'Something went wrong. Try again in a minute.');
  });

  app.use('/api/me', r);
}
