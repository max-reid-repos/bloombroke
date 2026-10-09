// PRO WAITLIST: while checkout is closed (PRO_CHECKOUT=closed), PRO asks for an email
// address, to send one email when Pro opens. Stored in the Pro database
// (migrations/019_waitlist.sql). No third-party calls, no email is sent from here, and the
// address never goes to analytics. No IP address is stored: the rate limit holds it in
// memory for up to an hour, then forgets it.
//
//   POST /api/pro/waitlist   same origin only, JSON { email, hp } -> { ok: true }
//   POST /api/pro/waitlist?source=guide   the same, for the BUILD GUIDE list (/guide):
//                            one email when the guide is ready. Open whatever PRO_CHECKOUT
//                            says; the same limits, honeypot and same-origin rule.
//   The FOUNDERS list (source 'founders') has its own route, POST /api/founders/reserve
//   (pro/founders.js), open while founders seats can be saved, whatever PRO_CHECKOUT says.
//   It runs the same sign-up (signUp below): the same checks, limits and answers.
//
// email: trimmed, lower-cased, at most 254 characters, a plain address. hp: a honeypot
// field that people never see; a bot that fills it gets { ok: true } and nothing is
// stored. An address already on the list gets the same { ok: true }, so the answer never
// says who is on it. With checkout open the route is 404, as if it did not exist.
// A sign-up is not logged; error logs carry the error only, never the address.

import express from 'express';
import { createLimiter, clientIp } from './ratelimit.js';
import { sameOrigin } from './feedback.js';

export const MAX_EMAIL = 254;
export const SOURCE = 'pro-soon';
// The lists: 'pro-soon' (PRO's "Pro opens soon."), 'guide' (the /guide page) and
// 'founders' (the founders page: "Not ready to save a card?", migrations/023). One
// address may be on each; scripts/waitlist.js prints one list at a time (--source).
export const GUIDE = 'guide';
export const FOUNDERS_LIST = 'founders';
export const SOURCES = [SOURCE, GUIDE, FOUNDERS_LIST];
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Per client IP: 5 tries an hour, right or wrong. For the whole site: 500 new
// sign-ups a day (a flood fills the list no faster than that).
export const PER_IP = 5;
export const PER_DAY = 500;

// A plain address: a local part that starts with a letter or digit, then the usual
// characters (no trailing or double dot), then a domain of letters, digits and hyphens
// with a letter TLD. Lower case only (normalizeEmail lower-cases first). Addresses with
// other characters are refused. Starting with a letter or digit also means no stored
// address can read as a spreadsheet formula in the owner's CSV (scripts/waitlist.js).
const LOCAL_RE = /^[a-z0-9][a-z0-9!#$%&'*+/=?^_`{|}~-]*(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class WaitlistError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const BAD_EMAIL = 'That email address does not look right.';

// Any value -> the address to store, or throws WaitlistError('bad_email').
export function normalizeEmail(v) {
  if (typeof v !== 'string') throw new WaitlistError('bad_email', BAD_EMAIL);
  const e = v.trim().toLowerCase();
  if (!e || e.length > MAX_EMAIL) throw new WaitlistError('bad_email', BAD_EMAIL);
  const at = e.lastIndexOf('@');
  if (at < 1 || e.indexOf('@') !== at) throw new WaitlistError('bad_email', BAD_EMAIL);
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (local.length > 64 || domain.length > 253 || !LOCAL_RE.test(local) || !DOMAIN_RE.test(domain)) throw new WaitlistError('bad_email', BAD_EMAIL);
  return e;
}

export function createWaitlistStore(db, { now = () => Date.now() } = {}) {
  // A new address is added. One that is on the list stays as it was. One taken off
  // (deleted_at set) and given again is back on, as a new sign-up.
  const add = db.prepare(`INSERT INTO waitlist (email, created_at, source) VALUES (?, ?, ?)
    ON CONFLICT(email, source) DO UPDATE SET created_at = excluded.created_at, deleted_at = NULL, notified_at = NULL
    WHERE waitlist.deleted_at IS NOT NULL`);
  return {
    // -> true when the address is new on that list (source: one of SOURCES).
    add(email, source = SOURCE) { return add.run(email, now(), SOURCES.includes(source) ? source : SOURCE).changes > 0; },
    count(source = SOURCE) { return db.prepare('SELECT COUNT(*) AS n FROM waitlist WHERE deleted_at IS NULL AND source = ?').get(source).n; },
    // The whole of one list, deleted (rows taken off included). -> how many rows went.
    clear(source) { return SOURCES.includes(source) ? Number(db.prepare('DELETE FROM waitlist WHERE source = ?').run(source).changes) : 0; },
  };
}

// The sign-up itself, after express.json: same origin, the limits, the address, the
// honeypot, then the store. sourceOf(req): the list to add to. Shared by the Pro and
// guide lists here and the founders list (pro/founders.js POST /api/founders/reserve).
export function signUp({ store, sourceOf, publicUrl, limiter, daily, log = console, crossOrigin = 'Join from bloombroke.com.' }) {
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  const ok = (res) => res.json({ ok: true });
  return (req, res) => {
    if (!sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', crossOrigin);
    // Every try counts, right or wrong.
    const r = limiter.hit(clientIp(req));
    if (!r.ok) {
      res.set('Retry-After', String(r.retryAfter));
      return fail(res, 429, 'rate_limited', 'Too many tries. Wait an hour and try again.');
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, 400, 'bad_request', 'Send { email }.');
    let email;
    try {
      email = normalizeEmail(body.email);
    } catch (err) {
      if (err instanceof WaitlistError) return fail(res, 400, err.code, err.message);
      throw err;
    }
    // The honeypot: people never see this field. Say done, keep nothing.
    if (body.hp !== undefined && body.hp !== null && body.hp !== '') return ok(res);
    const d = daily.hit('all');
    if (!d.ok) {
      res.set('Retry-After', String(d.retryAfter));
      return fail(res, 429, 'busy', 'The list is full for today. Try again tomorrow.');
    }
    try {
      store.add(email, sourceOf(req));
    } catch (err) {
      log.error('[waitlist]', err.message);
      return fail(res, 503, 'unavailable', 'Could not save that. Try again in a minute.');
    }
    return ok(res);
  };
}

export function mountWaitlist(app, {
  store, checkoutClosed = false, publicUrl = 'https://bloombroke.com', now = () => Date.now(),
  limiter = createLimiter({ max: PER_IP, windowMs: HOUR, now }),
  daily = createLimiter({ max: PER_DAY, windowMs: DAY, now, maxKeys: 1 }),
  log = console,
}) {
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  // ?source=guide: the BUILD GUIDE list. Anything else in source: 404.
  const sourceOf = (req) => (req.query?.source === undefined ? SOURCE : req.query.source === GUIDE ? GUIDE : null);
  app.post('/api/pro/waitlist', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Checkout open: there is no Pro list to join (the guide list stays open). Before the
    // body is even read.
    const source = sourceOf(req);
    if (!source || (source === SOURCE && !checkoutClosed)) return fail(res, 404, 'not_found', 'No such endpoint.');
    next();
  }, express.json({ limit: '1kb' }), signUp({ store, sourceOf, publicUrl, limiter, daily, log }));
  app.use('/api/pro/waitlist', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large') return fail(res, 413, 'too_large', 'That request is too large.');
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_json', 'That is not valid JSON.');
    log.error('[waitlist]', err?.message);
    return fail(res, 500, 'error', 'Something went wrong. Try again in a minute.');
  });
}
