// FOUNDERS SEATS: licensed live prices cost $15,300 a year. Pro stays closed until
// founders commit $17,640. A founder saves a card now (Stripe Checkout in setup mode);
// nobody is charged until the committed seats reach the goal, and no later than the
// deadline. If the goal is missed, every saved card is deleted and nobody pays.
// Data: migrations/020_founders.sql. The charge itself is a later script, not here.
//
//   GET  /api/founders/status     the public state: goal, committed dollars, seats (number,
//                                 class, status, handle) and the release log. Never an
//                                 email, a Stripe id or a card fingerprint.
//   POST /api/founders/checkout   same origin, JSON { seat } or { class: ten|founder } ->
//                                 { url } of a Stripe Checkout Session (setup mode)
//
// Seats 1 to 10 are ten-year seats ($1,420 once, 10 years of Pro); 11 to 42 founder seats
// ($420 a year, the price kept while the seat is kept). The bar counts dollars.
//
// Environment (.env.example):
//   FOUNDERS=open          seats can be saved; anything else: the page shows "Seats open soon."
//   FOUNDERS_GOAL_USD      default 17640
//   FOUNDERS_DEADLINE      YYYY-MM-DD, default 2026-12-15; the end of that day, UTC
//
// Money rules: the client only names a seat or a class; the class and the amount come
// from the seat number here. Every Stripe write carries an idempotency key, and every
// object we make carries metadata site=bloombroke (the Stripe account is shared).
// Webhook events reach handleFoundersEvent through pro/billing.js handleEvent (the one
// endpoint, its signature checked in pro/routes.js).

import express from 'express';
import { randomBytes } from 'node:crypto';
import { createLimiter, clientIp } from './ratelimit.js';
import { sameOrigin } from './feedback.js';
import { tx } from './db.js';
import { idOf, TERMS_MESSAGE } from './billing.js';
import { cleanWords } from './tips.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const SITE = 'bloombroke';
export const FOUNDERS_METADATA = { site: SITE, product: 'founders' };
export const SEATS_TOTAL = 42;
export const CLASSES = {
  ten: { usd: 1420, first: 1, last: 10, name: 'ten-year seat' },
  founder: { usd: 420, first: 11, last: 42, name: 'founder seat' },
};
export const DATA_COST_USD = 15300;
export const DEFAULT_GOAL_USD = 17640;
export const DEFAULT_DEADLINE = '2026-12-15';
export const CONTACT = 'hello@bloombroke.com';

// The Stripe Checkout Session lives 31 minutes (Stripe's least is 30). The seat is held 2
// minutes longer, so it never opens to someone else while its checkout can still finish.
export const SESSION_MS = 31 * MIN;
export const HOLD_MS = SESSION_MS + 2 * MIN;

// Per client IP: 10 checkouts an hour. For the whole site: 300 a day.
export const PER_IP = 10;
export const PER_DAY = 300;

export const classOf = (seat) => (seat >= CLASSES.ten.first && seat <= CLASSES.ten.last ? 'ten' : 'founder');
export const isSeat = (v) => Number.isInteger(v) && v >= 1 && v <= SEATS_TOTAL;

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
export const fmtUsd = usd;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 'Dec 15, 2026' and 'Nov 3' (UTC).
export const fmtDay = (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
export const fmtShort = (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

// The environment -> { open, goalUsd, deadline: 'YYYY-MM-DD', deadlineAt: ms (the last
// millisecond of that day, UTC) }. A value that does not parse falls back to the default.
export function foundersEnv(env = process.env) {
  const open = String(env.FOUNDERS || '').trim().toLowerCase() === 'open';
  const g = String(env.FOUNDERS_GOAL_USD || '').trim();
  const goalUsd = /^[1-9]\d{0,7}$/.test(g) ? Number(g) : DEFAULT_GOAL_USD;
  let deadline = String(env.FOUNDERS_DEADLINE || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
  const valid = m && (() => { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; })();
  if (!valid) { deadline = DEFAULT_DEADLINE; m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline); }
  const deadlineAt = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999);
  return { open, goalUsd, deadline, deadlineAt };
}

// What the buyer reads above Stripe's button: the mandate, with the amount of the class.
// Stripe takes up to 1,200 characters; this is about 330.
export function mandateText(cls, { goalUsd = DEFAULT_GOAL_USD, deadlineAt } = {}) {
  const at = deadlineAt ?? foundersEnv({}).deadlineAt;
  const charge = cls === 'ten' ? `${usd(CLASSES.ten.usd)} once for this ten-year seat` : `${usd(CLASSES.founder.usd)} a year for this founder seat`;
  return `You are saving a card. We charge ${charge}, only when founders reach ${usd(goalUsd)}, and no later than ${fmtDay(at)}. `
    + `If the goal is not reached by then, we delete the card and you pay nothing. You can give up your seat before the charge by emailing ${CONTACT}.`;
}

// An X handle as typed -> the handle to show, or null. A leading @ is dropped; 1 to 15
// letters, digits or _ only; nothing staff-like or rude (pro/tips.js cleanWords).
export function cleanHandle(v) {
  if (typeof v !== 'string') return null;
  const h = v.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
  return cleanWords(h.replace(/_/g, ' ')) ? h : null;
}

// A Checkout Session's custom field value, or null.
export function customField(session, key) {
  const f = (session?.custom_fields || []).find((x) => x?.key === key);
  const v = f?.text?.value ?? f?.dropdown?.value ?? null;
  return typeof v === 'string' ? v : null;
}

export class FoundersError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const FREE = `status = 'open', held_until = NULL, hold_token = NULL, checkout_session_id = NULL, stripe_customer_id = NULL,
  setup_intent_id = NULL, payment_method_id = NULL, card_fingerprint = NULL, email = NULL, handle = NULL, mandate_at = NULL,
  mandate_ip = NULL, livemode = NULL`;

// The seats table. Every method is synchronous; holds that ran out go back to open on
// every read (and on checkout.session.expired).
export function createFoundersStore(db, { now = () => Date.now() } = {}) {
  const q = {
    expire: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE status = 'held' AND held_until <= ?`),
    all: db.prepare('SELECT seat, class, status, handle FROM founders_seats ORDER BY seat'),
    one: db.prepare('SELECT * FROM founders_seats WHERE seat = ?'),
    firstOpen: db.prepare("SELECT seat FROM founders_seats WHERE class = ? AND status = 'open' ORDER BY seat LIMIT 1"),
    hold: db.prepare("UPDATE founders_seats SET status = 'held', held_until = ?, hold_token = ?, mandate_ip = ?, checkout_session_id = NULL, updated_at = ? WHERE seat = ? AND status = 'open'"),
    attach: db.prepare("UPDATE founders_seats SET checkout_session_id = ?, updated_at = ? WHERE seat = ? AND hold_token = ? AND status = 'held'"),
    dropHold: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE seat = ? AND hold_token = ? AND status = 'held'`),
    dropSession: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE checkout_session_id = ? AND status = 'held'`),
    bySession: db.prepare('SELECT * FROM founders_seats WHERE checkout_session_id = ?'),
    bySetupIntent: db.prepare("SELECT seat FROM founders_seats WHERE setup_intent_id = ? AND status = 'committed'"),
    dup: db.prepare("SELECT seat FROM founders_seats WHERE status = 'committed' AND (email = ? OR card_fingerprint = ?)"),
    commit: db.prepare(`UPDATE founders_seats SET status = 'committed', held_until = NULL, hold_token = NULL, checkout_session_id = ?,
      stripe_customer_id = ?, setup_intent_id = ?, payment_method_id = ?, card_fingerprint = ?, email = ?, handle = ?, mandate_at = ?,
      mandate_ip = COALESCE(?, mandate_ip), livemode = ?, updated_at = ? WHERE seat = ?`),
    release: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE seat = ?`),
    log: db.prepare('INSERT INTO founders_log (at, text) VALUES (?, ?)'),
    logs: db.prepare('SELECT at, text FROM founders_log ORDER BY at DESC, id DESC LIMIT ?'),
    list: db.prepare('SELECT * FROM founders_seats ORDER BY seat'),
  };
  const expire = () => q.expire.run(now(), now()).changes;
  return {
    expire,
    // [{ seat, class, status, handle }]: the public view. A handle only on a committed seat.
    seats() {
      expire();
      return q.all.all().map((r) => ({ seat: r.seat, class: r.class, status: r.status === 'released' ? 'open' : r.status, handle: r.status === 'committed' ? r.handle : null }));
    },
    // { committedUsd, seatsTaken, held }: committed seats only count; a hold does not.
    totals(seats = this.seats()) {
      const done = seats.filter((s) => s.status === 'committed');
      return { committedUsd: done.reduce((n, s) => n + CLASSES[s.class].usd, 0), seatsTaken: done.length, held: seats.filter((s) => s.status === 'held').length };
    },
    // Hold one seat for a checkout: { seat } or the lowest open seat of { cls }. Throws
    // FoundersError('taken' | 'full'). One transaction, so two buyers never hold one seat.
    hold({ seat = null, cls = null, ip = null } = {}) {
      return tx(db, () => {
        expire();
        let n = seat;
        if (n === null) {
          const r = q.firstOpen.get(cls);
          if (!r) throw new FoundersError('full', cls === 'ten' ? 'Every ten-year seat is taken.' : 'Every founder seat is taken.');
          n = r.seat;
        }
        const token = randomBytes(12).toString('hex');
        const t = now();
        if (!q.hold.run(t + HOLD_MS, token, ip ? String(ip).slice(0, 64) : null, t, n).changes) throw new FoundersError('taken', 'That seat is taken. Pick another.');
        return { seat: n, cls: classOf(n), token, heldUntil: t + HOLD_MS };
      });
    },
    attachSession(seat, token, sessionId) { return q.attach.run(sessionId, now(), seat, token).changes > 0; },
    dropHold(seat, token) { return q.dropHold.run(now(), seat, token).changes > 0; },
    // checkout.session.expired: that session's hold ends now.
    dropSession(sessionId) { return q.dropSession.run(now(), sessionId).changes > 0; },
    bySession(sessionId) { return sessionId ? q.bySession.get(sessionId) || null : null; },
    bySetupIntent(id) { return id ? q.bySetupIntent.get(id)?.seat ?? null : null; },
    // A saved card for a session -> { seat } | { already: seat } | { dup: seat } | { full: true }.
    // One committed seat per email and per card. The session's own held seat, or (if that
    // hold is gone, which the grace minutes should prevent) the lowest open seat of the
    // same class. A duplicate or a full class releases the session's hold.
    commit(c) {
      return tx(db, () => {
        const mine = q.bySession.get(c.sessionId);
        if (mine?.status === 'committed') return { already: mine.seat };
        const dup = q.dup.get(c.email ?? null, c.fingerprint ?? null);
        if (dup) {
          if (mine?.status === 'held') q.dropSession.run(now(), c.sessionId);
          return { dup: dup.seat };
        }
        let seat = mine?.status === 'held' ? mine.seat : null;
        if (seat === null) {
          expire();
          seat = q.firstOpen.get(c.cls)?.seat ?? null;
          if (seat === null) return { full: true };
        }
        q.commit.run(c.sessionId, c.customer ?? null, c.setupIntent ?? null, c.paymentMethod ?? null, c.fingerprint ?? null, c.email ?? null,
          c.handle ?? null, c.mandateAt ?? now(), c.mandateIp ?? null, c.livemode === undefined || c.livemode === null ? null : c.livemode ? 1 : 0, now(), seat);
        return { seat };
      });
    },
    // scripts/founders.js: a committed seat given up before the charge. Back to open, every
    // private field cleared, one public log line ("Seat 12 released Nov 3.").
    release(seat) {
      return tx(db, () => {
        const r = q.one.get(seat);
        if (!r) return null;
        q.release.run(now(), seat);
        if (r.status === 'committed') q.log.run(now(), `Seat ${seat} released ${fmtShort(now())}.`);
        return r;
      });
    },
    seat(n) { return q.one.get(n) || null; },
    logs(limit = 20) { return q.logs.all(limit); },
    list() { expire(); return q.list.all(); },
  };
}

// ---- Stripe ---------------------------------------------------------------------------

export const HANDLE_FIELD = 'xhandle';
export const HANDLE_LABEL = 'X handle (optional, shown on your seat)';

// The Checkout Session for one held seat. Setup mode: a card is saved, nothing is charged.
export function foundersCheckoutParams({ seat, publicUrl, at, cfg }) {
  const base = publicUrl.replace(/\/+$/, '');
  const cls = classOf(seat);
  const metadata = { ...FOUNDERS_METADATA, seat: String(seat), class: cls };
  return {
    mode: 'setup',
    payment_method_types: ['card'],
    customer_creation: 'always',
    success_url: `${base}/founders?seat=${seat}&s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/founders`,
    expires_at: Math.floor((at + SESSION_MS) / 1000),
    metadata,
    setup_intent_data: { metadata: { ...metadata }, description: `Bloombroke founders seat ${seat} (${CLASSES[cls].name})` },
    custom_fields: [{
      key: HANDLE_FIELD, type: 'text', optional: true,
      label: { type: 'custom', custom: HANDLE_LABEL },
      text: { maximum_length: 16 },
    }],
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      terms_of_service_acceptance: { message: TERMS_MESSAGE },
      submit: { message: mandateText(cls, cfg) },
    },
  };
}

export const isFoundersObject = (o) => o?.metadata?.site === SITE && o?.metadata?.product === FOUNDERS_METADATA.product;
export const isFoundersSession = (s) => Boolean(s && s.mode === 'setup' && isFoundersObject(s));

const notThere = (err) => err?.statusCode === 404 || err?.code === 'resource_missing' || err?.code === 'payment_method_unexpected_state';

// The card of a duplicate or a seat that could not be given: taken off the customer at
// Stripe, so it can never be charged. Idempotent; a card already detached is fine.
async function detach(stripe, pm) {
  if (!pm) return;
  try {
    await stripe.paymentMethods.detach(pm, {}, { idempotencyKey: `bb-founders-detach-${pm}` });
  } catch (err) {
    if (!notThere(err)) throw err;
  }
}

// A completed setup-mode session -> 'founders_committed' | 'founders_already' |
// 'founders_duplicate' | 'founders_full' | 'founders_pending'. Used by the webhook and by
// the success page, whichever runs first. Throws on a Stripe failure, so the webhook is
// retried.
export async function commitSession(session, { founders, stripe, log = console, at = Date.now() }) {
  if (!isFoundersSession(session) || session.status !== 'complete') return 'founders_pending';
  const known = founders.bySession(session.id);
  if (known?.status === 'committed') return 'founders_already';
  const siId = idOf(session.setup_intent);
  if (!siId) return 'founders_pending';
  const si = await stripe.setupIntents.retrieve(siId, { expand: ['payment_method', 'mandate'] });
  if (si.status !== 'succeeded') return 'founders_pending';
  const pm = typeof si.payment_method === 'object' && si.payment_method ? si.payment_method : null;
  const pmId = idOf(si.payment_method);
  const mandate = typeof si.mandate === 'object' && si.mandate ? si.mandate : null;
  const accepted = mandate?.customer_acceptance;
  const email = String(session.customer_details?.email || pm?.billing_details?.email || '').trim().toLowerCase().slice(0, 254) || null;
  const metaSeat = Number(session.metadata?.seat);
  const cls = isSeat(metaSeat) ? classOf(metaSeat) : (session.metadata?.class === 'ten' ? 'ten' : 'founder');
  const out = founders.commit({
    sessionId: session.id,
    cls,
    customer: idOf(session.customer) || idOf(si.customer),
    setupIntent: si.id,
    paymentMethod: pmId,
    fingerprint: pm?.card?.fingerprint || null,
    email,
    handle: cleanHandle(customField(session, HANDLE_FIELD)),
    mandateAt: Number.isFinite(accepted?.accepted_at) ? accepted.accepted_at * 1000 : at,
    mandateIp: accepted?.online?.ip_address || null,
    livemode: typeof session.livemode === 'boolean' ? session.livemode : null,
  });
  if (out.already) return 'founders_already';
  if (out.dup || out.full) {
    // Counts only in the log: never the address or the card.
    log.log(`[founders] ${out.dup ? 'a second seat for the same email or card' : 'no free seat in that class'}: card detached, hold released`);
    await detach(stripe, pmId);
    return out.dup ? 'founders_duplicate' : 'founders_full';
  }
  // Tag the customer and the card, so the shared account can tell them apart. Not fatal.
  const metadata = { ...FOUNDERS_METADATA, seat: String(out.seat), class: classOf(out.seat) };
  const customer = idOf(session.customer) || idOf(si.customer);
  const tags = [];
  if (customer) tags.push(stripe.customers.update(customer, { metadata }, { idempotencyKey: `bb-founders-customer-${customer}-${out.seat}` }));
  if (pmId) tags.push(stripe.paymentMethods.update(pmId, { metadata }, { idempotencyKey: `bb-founders-pm-${pmId}-${out.seat}` }));
  for (const r of await Promise.allSettled(tags)) if (r.status === 'rejected') log.error('[founders] could not tag a Stripe object:', r.reason?.message);
  return 'founders_committed';
}

// One verified webhook event -> a result string, or null when it is not a founders (or
// tip) event, so pro/billing.js goes on with its own.
export async function handleFoundersEvent(event, { founders, tips = null, stripe, log = console }) {
  const obj = event?.data?.object;
  const at = Number.isFinite(event?.created) ? event.created * 1000 : Date.now();
  switch (event?.type) {
    case 'checkout.session.completed':
      if (founders && isFoundersSession(obj)) return commitSession(obj, { founders, stripe, log, at });
      if (tips?.isTipSession(obj)) return tips.fromSession(obj, { at });
      return null;
    case 'checkout.session.expired':
      if (founders && isFoundersSession(obj)) return founders.dropSession(obj.id) ? 'founders_released' : 'founders_expired';
      if (tips?.isTipSession(obj)) return 'tip_expired';
      return null;
    // Checkout's session event does the work (it has the email and the handle). This one
    // only confirms: the seat is already committed, or the session event will do it.
    case 'setup_intent.succeeded':
      if (founders && isFoundersObject(obj)) return founders.bySetupIntent(obj.id) ? 'founders_already' : 'founders_wait';
      return null;
    default:
      return null;
  }
}

// The events the founders seats and tips need on the webhook endpoint, on top of Pro's.
export const FOUNDERS_WEBHOOK_EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'setup_intent.succeeded'];

// ---- the runtime object and the routes ------------------------------------------------

// The founders seats as the server uses them: the store, the config, the public status
// and the success-page check. stripe: null when Stripe is not configured (closed).
export function createFounders({ db, stripe = null, env = process.env, mode = 'live', webhookReady = false, now = () => Date.now(), log = console }) {
  const cfg = foundersEnv(env);
  const store = createFoundersStore(db, { now });
  const ready = Boolean(stripe && webhookReady);
  if (cfg.open && !ready) log.error('[founders] FOUNDERS=open but Stripe is not configured: seats stay closed');
  const confirmLimit = createLimiter({ max: 30, windowMs: 10 * MIN, now });
  const f = {
    cfg, store, stripe, mode,
    // Seats can be saved right now.
    isOpen: (t = now()) => cfg.open && ready && t <= cfg.deadlineAt,
    ended: (t = now()) => t > cfg.deadlineAt,
    testMode: () => cfg.open && mode === 'test',
    // The public state. Nothing private: numbers, classes, statuses, handles, the log.
    status(t = now()) {
      const seats = store.seats();
      const tot = store.totals(seats);
      return {
        open: f.isOpen(t), testMode: f.testMode(), ended: f.ended(t),
        goalUsd: cfg.goalUsd, committedUsd: tot.committedUsd, seatsTaken: tot.seatsTaken, seatsTotal: SEATS_TOTAL,
        deadline: cfg.deadline, seats,
        log: store.logs(20).map((r) => ({ at: new Date(r.at).toISOString(), text: r.text })),
      };
    },
    // The success page (?s=cs_...): { seat } when that checkout's seat is committed,
    // { pending: true } while Stripe has not said so, { failed: true } when the checkout
    // ended without a seat (one seat per person). Asks Stripe only while the seat is held
    // by that session, at most 30 times per 10 minutes per IP.
    async confirm(sessionId, ip = 'unknown') {
      if (!/^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(String(sessionId || ''))) return null;
      const row = store.bySession(sessionId);
      if (row?.status === 'committed') return { seat: row.seat };
      if (!stripe) return row ? { pending: true } : null;
      if (!confirmLimit.hit(ip).ok) return { pending: true };
      let session;
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
      } catch (err) {
        if (notThere(err)) return null;
        log.error('[founders] confirm', err.message);
        return { pending: true };
      }
      if (!isFoundersSession(session)) return null;
      if (session.status !== 'complete') return row ? { pending: true } : null;
      try {
        const r = await commitSession(session, { founders: store, stripe, log, at: now() });
        if (r === 'founders_duplicate' || r === 'founders_full') return { failed: true };
      } catch (err) {
        log.error('[founders] confirm commit', err.message);
        return { pending: true };
      }
      const after = store.bySession(sessionId);
      return after?.status === 'committed' ? { seat: after.seat } : { failed: true };
    },
  };
  return f;
}

export function mountFounders(app, {
  founders, publicUrl = 'https://bloombroke.com', now = () => Date.now(), log = console,
  limiter = createLimiter({ max: PER_IP, windowMs: HOUR, now }),
  daily = createLimiter({ max: PER_DAY, windowMs: DAY, now, maxKeys: 1 }),
}) {
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  const base = publicUrl.replace(/\/+$/, '');

  app.get('/api/founders/status', (req, res) => {
    let body;
    try { body = founders.status(now()); } catch (err) {
      log.error('[founders] status', err.message);
      res.set('Cache-Control', 'no-store');
      return fail(res, 503, 'unavailable', 'The seat count is taking a break.');
    }
    res.set('Cache-Control', 'public, max-age=30');
    res.json(body);
  });

  app.post('/api/founders/checkout', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, express.json({ limit: '1kb' }), async (req, res) => {
    if (!sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Save a seat from bloombroke.com.');
    const t = now();
    if (founders.ended(t)) return fail(res, 410, 'ended', 'Founders seats are closed.');
    if (!founders.isOpen(t)) return fail(res, 503, 'closed', 'Seats open soon.');
    const r = limiter.hit(clientIp(req));
    if (!r.ok) {
      res.set('Retry-After', String(r.retryAfter));
      return fail(res, 429, 'rate_limited', 'Too many tries. Wait an hour and try again.');
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    let seat = null;
    let cls = null;
    if (body.seat !== undefined && body.seat !== null) {
      seat = Number(body.seat);
      if (!isSeat(seat) || String(body.seat).trim() !== String(seat)) return fail(res, 400, 'bad_seat', 'Pick a seat from 1 to 42.');
    } else if (body.class === 'ten' || body.class === 'founder') cls = body.class;
    else return fail(res, 400, 'bad_request', 'Pick a seat.');
    const d = daily.hit('all');
    if (!d.ok) {
      res.set('Retry-After', String(d.retryAfter));
      return fail(res, 429, 'busy', 'Too many checkouts today. Try again tomorrow.');
    }
    let held;
    try {
      held = founders.store.hold({ seat, cls, ip: rawIp(req) });
    } catch (err) {
      if (err instanceof FoundersError) return fail(res, err.status, err.code, err.message);
      log.error('[founders] hold', err.message);
      return fail(res, 503, 'unavailable', 'Could not hold that seat. Try again in a minute.');
    }
    try {
      const session = await founders.stripe.checkout.sessions.create(
        foundersCheckoutParams({ seat: held.seat, publicUrl: base, at: t, cfg: founders.cfg }),
        { idempotencyKey: `bb-founders-checkout-${held.seat}-${held.token}` },
      );
      founders.store.attachSession(held.seat, held.token, session.id);
      res.json({ url: session.url, seat: held.seat });
    } catch (err) {
      founders.store.dropHold(held.seat, held.token);
      log.error('[founders] checkout', err.message);
      fail(res, 503, 'unavailable', 'Checkout is taking a break. Try again in a minute.');
    }
  });

  app.use('/api/founders', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large') return fail(res, 413, 'too_large', 'That request is too large.');
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_json', 'That is not valid JSON.');
    log.error('[founders]', err?.message);
    return fail(res, 500, 'error', 'Something went wrong. Try again in a minute.');
  });
}

// The address that started a checkout, for the mandate record: behind the local proxy
// (Cloudflare tunnel) CF-Connecting-IP, else the socket's. Not the rate-limit bucket.
export function rawIp(req) {
  const peer = req.socket?.remoteAddress || '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const cf = req.get?.('cf-connecting-ip');
  if (loopback && cf && cf.length <= 64) return cf.trim();
  return String(req.ip || peer || '').slice(0, 64) || null;
}
