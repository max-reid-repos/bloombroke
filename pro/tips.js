// TIPS ("Fuel the feed"): a gift, not a seat. Each paid tip names a small fish in the
// FISHTANK for 365 days. Off unless TIPS=open, and the owner opens it only once licensed
// prices are live (licensed data before any money). With TIPS closed nothing about tips
// shows; fish already paid for keep swimming until they expire.
//
//   POST /api/tips/checkout   same origin, JSON { usd } (5, 10, 20, or 3 to 200 whole
//                             dollars) -> { url } of a Stripe Checkout Session (payment)
//
// The amount the buyer picks is checked here and sent to Stripe as price data; what is
// stored is Stripe's own amount_total from the paid session, never the browser's number.
// The fish name the buyer types is kept raw for review (scripts/fish-review.js); until
// the owner approves it, the fish shows as "Fish #<id>".

import express from 'express';
import { randomBytes } from 'node:crypto';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { createLimiter, clientIp } from './ratelimit.js';
import { sameOrigin } from './feedback.js';
import { TERMS_MESSAGE } from './billing.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const TIP_METADATA = { site: 'bloombroke', product: 'tip' };
export const TIP_AMOUNTS = [5, 10, 20];
export const TIP_MIN = 3;
export const TIP_MAX = 200;
export const BIG_CENTS = 2000; // $20 and up: a bigger fish
export const FISH_DAYS = 365;
export const FISH_LIMIT = 100; // the newest live tip fish in the tank
export const NAME_FIELD = 'fishname';
export const NAME_LABEL = 'Fish name (2 to 16 letters, numbers or spaces)';
export const SUBMIT = 'A tip is a gift, not a seat, and is not refunded. Your fish name shows after a review, for 365 days.';
export const PER_IP = 10;
export const PER_DAY = 300;

export const tipsOpen = (env = process.env) => String(env.TIPS || '').trim().toLowerCase() === 'open';

// Words people see (a fish name, an X handle): nothing rude, nothing that reads as staff
// (admin, support, staff, official, moderator, the site's name). true when fine.
let matcher = null;
const STAFF = ['admin', 'support', 'staff', 'official', 'moderator', 'mod'];
export function cleanWords(text) {
  const low = String(text).toLowerCase();
  if (/bloombroke/.test(low.replace(/\s+/g, ''))) return false;
  if (low.split(/[\s_\d]+/).filter(Boolean).some((w) => STAFF.includes(w) || w.startsWith('admin'))) return false;
  try {
    matcher ||= new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
    return !(matcher.hasMatch(low) || matcher.hasMatch(low.replace(/\s+/g, '')));
  } catch {
    return false; // a broken check refuses
  }
}

// A fish name as typed -> { raw, name }: raw is what is kept for review (control
// characters out, spaces squeezed, 16 characters at most, or null); name is the same text
// when it passes every rule (2 to 16 letters, digits or spaces, no @, no link, nothing
// rude or staff-like), else null. Only an approved name is ever shown.
export function cleanFishName(v) {
  if (typeof v !== 'string') return { raw: null, name: null };
  const raw = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) || null;
  if (!raw) return { raw: null, name: null };
  const ok = raw.length >= 2 && /^[A-Za-z0-9 ]+$/.test(raw) && !/\b(www|http|https|com)\b/i.test(raw) && cleanWords(raw);
  return { raw, name: ok ? raw : null };
}

// The amount in whole dollars, or null.
export function tipUsd(v) {
  const n = typeof v === 'string' && /^\d{1,3}$/.test(v.trim()) ? Number(v) : v;
  return Number.isInteger(n) && n >= TIP_MIN && n <= TIP_MAX ? n : null;
}

export const isTipSession = (s) => Boolean(s && s.mode === 'payment' && s.metadata?.site === TIP_METADATA.site && s.metadata?.product === TIP_METADATA.product);

export function tipCheckoutParams({ usd, publicUrl }) {
  const base = publicUrl.replace(/\/+$/, '');
  const metadata = { ...TIP_METADATA, usd: String(usd) };
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    submit_type: 'pay',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: usd * 100,
        product_data: { name: 'Bloombroke tip: fuel the feed', description: 'A gift, not a seat. Names a fish in the FISHTANK.', metadata: { ...TIP_METADATA } },
      },
    }],
    success_url: `${base}/founders?tip=thanks#fuel`,
    cancel_url: `${base}/founders#fuel`,
    metadata,
    payment_intent_data: { metadata: { ...metadata }, description: 'Bloombroke tip' },
    custom_fields: [{
      key: NAME_FIELD, type: 'text', optional: true,
      label: { type: 'custom', custom: NAME_LABEL },
      text: { minimum_length: 2, maximum_length: 16 },
    }],
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: TERMS_MESSAGE }, submit: { message: SUBMIT } },
  };
}

// livemode: 1 with a live Stripe key, 0 with a test key. The month's sum and the FISHTANK
// read only the tips of that mode, so test tips never show on the live site.
export function createTipsStore(db, { now = () => Date.now(), livemode = 1 } = {}) {
  const lm = livemode ? 1 : 0;
  const MINE = '(livemode IS NULL OR livemode = @lm)';
  const q = {
    add: db.prepare(`INSERT INTO tips (checkout_session_id, amount_cents, currency, fish_name_raw, status, livemode, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT(checkout_session_id) DO NOTHING`),
    month: db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM tips WHERE currency = 'usd' AND created_at >= @from AND ${MINE}`),
    live: db.prepare(`SELECT id, amount_cents, fish_name, status FROM tips WHERE expires_at > @t AND ${MINE} ORDER BY created_at DESC, id DESC LIMIT @limit`),
    one: db.prepare('SELECT * FROM tips WHERE id = ?'),
    pending: db.prepare("SELECT * FROM tips WHERE status = 'pending' ORDER BY id"),
    all: db.prepare('SELECT * FROM tips ORDER BY id'),
    set: db.prepare('UPDATE tips SET status = ?, fish_name = ? WHERE id = ?'),
  };
  return {
    // A paid tip, once per checkout session. -> true when it is new.
    add({ sessionId, amountCents, currency = 'usd', raw = null, livemode = null, at = now() }) {
      return q.add.run(sessionId, amountCents, String(currency || 'usd').toLowerCase(), raw, livemode === null ? null : livemode ? 1 : 0, at, at + FISH_DAYS * DAY).changes > 0;
    },
    // Tips this calendar month (UTC), whole dollars.
    monthUsd(t = now()) {
      const d = new Date(t);
      return Math.round(q.month.get({ from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), lm }).c / 100);
    },
    // The FISHTANK's tip fish, newest first: [{ name, big }]. An approved name, else "Fish #<id>".
    fishtank(t = now(), limit = FISH_LIMIT) {
      return q.live.all({ t, limit, lm }).map((r) => ({ name: r.status === 'approved' && r.fish_name ? r.fish_name : `Fish #${r.id}`, big: r.amount_cents >= BIG_CENTS }));
    },
    one(id) { return q.one.get(id) || null; },
    pending() { return q.pending.all(); },
    all() { return q.all.all(); },
    approve(id, name) { return q.set.run('approved', name, id).changes > 0; },
    remove(id) { return q.set.run('removed', null, id).changes > 0; },
  };
}

// The runtime object: the store, open or not, the webhook side.
export function createTips({ db, stripe = null, env = process.env, mode = 'live', webhookReady = false, now = () => Date.now(), log = console }) {
  const store = createTipsStore(db, { now, livemode: mode === 'live' ? 1 : 0 });
  const ready = Boolean(stripe && webhookReady);
  const wanted = tipsOpen(env);
  if (wanted && !ready) log.error('[tips] TIPS=open but Stripe is not configured: tips stay closed');
  return {
    store, stripe,
    isOpen: () => wanted && ready,
    isTipSession,
    // A paid tip session -> 'tip' | 'tip_already' | 'tip_unpaid'.
    fromSession(s, { at = now() } = {}) {
      if (!isTipSession(s)) return null;
      if (s.status !== 'complete' || s.payment_status !== 'paid' || !(s.amount_total > 0)) return 'tip_unpaid';
      const { raw } = cleanFishName((s.custom_fields || []).find((f) => f?.key === NAME_FIELD)?.text?.value ?? null);
      const added = store.add({ sessionId: s.id, amountCents: s.amount_total, currency: s.currency, raw, livemode: typeof s.livemode === 'boolean' ? s.livemode : null, at });
      return added ? 'tip' : 'tip_already';
    },
    // FISHTANK: the live tip fish (null when there are none, so the tank is unchanged).
    fish(t = now()) {
      try {
        const list = store.fishtank(t);
        return list.length ? list : null;
      } catch (err) {
        log.error('[tips] fishtank', err.message);
        return null;
      }
    },
  };
}

export function mountTips(app, {
  tips, publicUrl = 'https://bloombroke.com', now = () => Date.now(), log = console,
  limiter = createLimiter({ max: PER_IP, windowMs: HOUR, now }),
  daily = createLimiter({ max: PER_DAY, windowMs: DAY, now, maxKeys: 1 }),
}) {
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  const base = publicUrl.replace(/\/+$/, '');
  app.post('/api/tips/checkout', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Closed: as if there were no such thing. Before the body is read.
    if (!tips.isOpen()) return fail(res, 404, 'not_found', 'No such endpoint.');
    next();
  }, express.json({ limit: '1kb' }), async (req, res) => {
    if (!sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Tip from bloombroke.com.');
    const r = limiter.hit(clientIp(req));
    if (!r.ok) {
      res.set('Retry-After', String(r.retryAfter));
      return fail(res, 429, 'rate_limited', 'Too many tries. Wait an hour and try again.');
    }
    const usd = tipUsd(req.body?.usd);
    if (!usd) return fail(res, 400, 'bad_amount', `Pick $${TIP_MIN} to $${TIP_MAX}, in whole dollars.`);
    const d = daily.hit('all');
    if (!d.ok) {
      res.set('Retry-After', String(d.retryAfter));
      return fail(res, 429, 'busy', 'Too many tips today. Try again tomorrow.');
    }
    try {
      const session = await tips.stripe.checkout.sessions.create(tipCheckoutParams({ usd, publicUrl: base }), { idempotencyKey: `bb-tip-checkout-${randomBytes(12).toString('hex')}` });
      res.json({ url: session.url });
    } catch (err) {
      log.error('[tips] checkout', err.message);
      fail(res, 503, 'unavailable', 'Checkout is taking a break. Try again in a minute.');
    }
  });
  app.use('/api/tips', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large') return fail(res, 413, 'too_large', 'That request is too large.');
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_json', 'That is not valid JSON.');
    log.error('[tips]', err?.message);
    return fail(res, 500, 'error', 'Something went wrong. Try again in a minute.');
  });
}
