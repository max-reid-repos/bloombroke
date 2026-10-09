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
// Seats 1 to 10 are five-year seats ($1,420 once, 5 years of Pro); 11 to 42 founder seats
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
import { TERMS_VERSION } from '../public/legal-version.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const SITE = 'bloombroke';
export const FOUNDERS_METADATA = { site: SITE, product: 'founders' };
export const SEATS_TOTAL = 42;
// 'ten' is the internal key of the five-year seat (it was a ten-year seat; the key stays,
// migrations/020 checks class IN ('ten','founder')). People only ever see the name.
export const CLASSES = {
  ten: { usd: 1420, first: 1, last: 10, name: 'five-year seat' },
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

// Per client IP: 10 checkouts an hour, and at most 2 seats held at once. For the whole
// site: at most 20 seats held at once (counted from the live holds, so nobody can use up
// a day's quota by starting and dropping checkouts).
export const PER_IP = 10;
export const HOLDS_PER_IP = 2;
export const MAX_HOLDS = 20;

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
  const charge = cls === 'ten' ? `${usd(CLASSES.ten.usd)} once for this five-year seat` : `${usd(CLASSES.founder.usd)} a year for this founder seat`;
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

const FREE = `status = 'open', held_until = NULL, hold_token = NULL, hold_key = NULL, checkout_session_id = NULL, stripe_customer_id = NULL,
  setup_intent_id = NULL, payment_method_id = NULL, card_fingerprint = NULL, email = NULL, handle = NULL, mandate_at = NULL,
  mandate_ip = NULL, livemode = NULL, terms_version = NULL`;

// The rows of this mode: livemode NULL (no mode recorded) or the same as ours. A row held
// or committed in the other mode (test seats once live keys are in) counts as open here.
const MINE = '(livemode IS NULL OR livemode = @lm)';
const FREE_HERE = `(status IN ('open', 'released') OR NOT ${MINE})`;

// The seats table. Every method is synchronous; holds that ran out go back to open on
// every read (and on checkout.session.expired). livemode: 1 with a live Stripe key, 0
// with a test key; every read and write keeps to that mode.
export function createFoundersStore(db, { now = () => Date.now(), livemode = 1, deadlineAt = foundersEnv({}).deadlineAt } = {}) {
  const lm = livemode ? 1 : 0;
  const q = {
    expire: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE status = 'held' AND held_until <= ?`),
    all: db.prepare(`SELECT seat, class, status, handle, NOT ${MINE} AS other FROM founders_seats ORDER BY seat`),
    one: db.prepare('SELECT * FROM founders_seats WHERE seat = ?'),
    firstOpen: db.prepare(`SELECT seat FROM founders_seats WHERE class = @cls AND ${FREE_HERE} ORDER BY seat LIMIT 1`),
    holdsOf: db.prepare(`SELECT COUNT(*) AS n FROM founders_seats WHERE status = 'held' AND hold_key = @key AND ${MINE}`),
    holds: db.prepare(`SELECT COUNT(*) AS n FROM founders_seats WHERE status = 'held' AND ${MINE}`),
    hold: db.prepare(`UPDATE founders_seats SET ${FREE}, status = 'held', held_until = @until, hold_token = @token, hold_key = @key, mandate_ip = @ip,
      livemode = @lm, updated_at = @t WHERE seat = @seat AND ${FREE_HERE}`),
    attach: db.prepare("UPDATE founders_seats SET checkout_session_id = ?, updated_at = ? WHERE seat = ? AND hold_token = ? AND status = 'held'"),
    dropHold: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE seat = ? AND hold_token = ? AND status = 'held'`),
    dropSession: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE checkout_session_id = ? AND status = 'held'`),
    bySession: db.prepare('SELECT * FROM founders_seats WHERE checkout_session_id = ?'),
    bySetupIntent: db.prepare("SELECT seat FROM founders_seats WHERE setup_intent_id = ? AND status = 'committed'"),
    dup: db.prepare(`SELECT seat FROM founders_seats WHERE status = 'committed' AND ${MINE} AND (email = @email OR card_fingerprint = @fp)`),
    commit: db.prepare(`UPDATE founders_seats SET status = 'committed', held_until = NULL, hold_token = NULL, hold_key = NULL, checkout_session_id = ?,
      stripe_customer_id = ?, setup_intent_id = ?, payment_method_id = ?, card_fingerprint = ?, email = ?, handle = ?, mandate_at = ?,
      mandate_ip = COALESCE(?, mandate_ip), livemode = ?, terms_version = ?, updated_at = ? WHERE seat = ?`),
    release: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE seat = ?`),
    log: db.prepare('INSERT INTO founders_log (at, text, livemode) VALUES (?, ?, ?)'),
    logs: db.prepare(`SELECT at, text FROM founders_log WHERE ${MINE} ORDER BY at DESC, id DESC LIMIT @limit`),
    list: db.prepare('SELECT * FROM founders_seats ORDER BY seat'),
    resetSeats: db.prepare(`UPDATE founders_seats SET ${FREE}, updated_at = ? WHERE livemode = 0`),
    resetLog: db.prepare('DELETE FROM founders_log WHERE livemode = 0'),
    resetTips: db.prepare('DELETE FROM tips WHERE livemode = 0'),
    // migrations/021: checkouts given back, never committed later.
    givenBack: db.prepare('SELECT * FROM founders_given_back WHERE checkout_session_id = ?'),
    giveBack: db.prepare(`INSERT OR IGNORE INTO founders_given_back (checkout_session_id, reason, class, payment_method_id, stripe_customer_id, livemode, at)
      VALUES (@id, @reason, @cls, @pm, @customer, @lm, @t)`),
    cleaned: db.prepare('UPDATE founders_given_back SET payment_method_id = NULL, stripe_customer_id = NULL WHERE checkout_session_id = ?'),
  };
  // Record a give-back and let the session's hold go, in the caller's transaction.
  const markGiven = (id, reason, { cls = null, pm = null, customer = null } = {}) => {
    q.giveBack.run({ id, reason, cls, pm, customer, lm, t: now() });
    q.dropSession.run(now(), id);
    return q.givenBack.get(id);
  };
  const expire = () => q.expire.run(now(), now()).changes;
  return {
    expire, livemode: lm, deadlineAt,
    // [{ seat, class, status, handle }]: the public view. A handle only on a committed seat
    // of this mode; a seat of the other mode is open.
    seats() {
      expire();
      return q.all.all({ lm }).map((r) => {
        const status = r.other || r.status === 'released' ? 'open' : r.status;
        return { seat: r.seat, class: r.class, status, handle: status === 'committed' ? r.handle : null };
      });
    },
    // { committedUsd, seatsTaken, held }: committed seats only count; a hold does not.
    totals(seats = this.seats()) {
      const done = seats.filter((s) => s.status === 'committed');
      return { committedUsd: done.reduce((n, s) => n + CLASSES[s.class].usd, 0), seatsTaken: done.length, held: seats.filter((s) => s.status === 'held').length };
    },
    // Hold one seat for a checkout: { seat } or the lowest open seat of { cls }. Throws
    // FoundersError('taken' | 'full'). One transaction, so two buyers never hold one seat.
    // key: the rate-limit bucket of the address (at most HOLDS_PER_IP live holds each); the
    // whole site holds at most MAX_HOLDS seats at once. ip: the address itself, for the
    // mandate record.
    hold({ seat = null, cls = null, ip = null, key = null } = {}) {
      return tx(db, () => {
        expire();
        const k = key ?? ip ?? 'unknown';
        if (q.holdsOf.get({ key: String(k).slice(0, 64), lm }).n >= HOLDS_PER_IP) throw new FoundersError('too_many', 'You have two checkouts open. Finish one, or try again in half an hour.', 429);
        if (q.holds.get({ lm }).n >= MAX_HOLDS) throw new FoundersError('busy', 'Many checkouts are open right now. Try again in a few minutes.', 503);
        let n = seat;
        if (n === null) {
          const r = q.firstOpen.get({ cls, lm });
          if (!r) throw new FoundersError('full', cls === 'ten' ? 'Every five-year seat is taken.' : 'Every founder seat is taken.');
          n = r.seat;
        }
        const token = randomBytes(12).toString('hex');
        const t = now();
        const done = q.hold.run({ until: t + HOLD_MS, token, key: String(k).slice(0, 64), ip: ip ? String(ip).slice(0, 64) : null, lm, t, seat: n }).changes;
        if (!done) throw new FoundersError('taken', 'That seat is taken. Pick another.');
        return { seat: n, cls: classOf(n), token, heldUntil: t + HOLD_MS };
      });
    },
    attachSession(seat, token, sessionId) { return q.attach.run(sessionId, now(), seat, token).changes > 0; },
    dropHold(seat, token) { return q.dropHold.run(now(), seat, token).changes > 0; },
    // checkout.session.expired: that session's hold ends now.
    dropSession(sessionId) { return q.dropSession.run(now(), sessionId).changes > 0; },
    bySession(sessionId) { return sessionId ? q.bySession.get(sessionId) || null : null; },
    bySetupIntent(id) { return id ? q.bySetupIntent.get(id)?.seat ?? null : null; },
    givenBack(sessionId) { return sessionId ? q.givenBack.get(sessionId) || null : null; },
    // A finished checkout that gets no seat (after the deadline, a card already taken off):
    // recorded and its hold let go, in one transaction. -> the given-back row.
    giveBack(sessionId, reason, ids = {}) { return tx(db, () => q.givenBack.get(sessionId) || markGiven(sessionId, reason, ids)); },
    // The card and the customer of a give-back are gone at Stripe: forget their ids.
    cleaned(sessionId) { q.cleaned.run(sessionId); },
    // A saved card for a session -> { seat } | { already: seat } | { dup: seat } | { full: true }.
    // One committed seat per email and per card. The session's own held seat, or (if that
    // hold is gone, which the grace minutes should prevent) the lowest open seat of the
    // same class. A duplicate or a full class releases the session's hold.
    // A session given back before ({ given }) is never committed. A duplicate or a full
    // class is recorded as given back in the same transaction.
    commit(c) {
      return tx(db, () => {
        const mine = q.bySession.get(c.sessionId);
        if (mine?.status === 'committed') return { already: mine.seat };
        const before = q.givenBack.get(c.sessionId);
        if (before) return { given: before };
        const ids = { cls: c.cls, pm: c.paymentMethod ?? null, customer: c.customer ?? null };
        const dup = q.dup.get({ email: c.email ?? null, fp: c.fingerprint ?? null, lm });
        if (dup) return { dup: dup.seat, given: markGiven(c.sessionId, 'duplicate', ids) };
        let seat = mine?.status === 'held' ? mine.seat : null;
        if (seat === null) {
          expire();
          seat = q.firstOpen.get({ cls: c.cls, lm })?.seat ?? null;
          if (seat === null) return { full: true, given: markGiven(c.sessionId, 'full', ids) };
        }
        q.commit.run(c.sessionId, c.customer ?? null, c.setupIntent ?? null, c.paymentMethod ?? null, c.fingerprint ?? null, c.email ?? null,
          c.handle ?? null, c.mandateAt ?? now(), c.mandateIp ?? null, typeof c.livemode === 'boolean' ? (c.livemode ? 1 : 0) : lm, c.termsVersion ?? null, now(), seat);
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
        if (r.status === 'committed') q.log.run(now(), `Seat ${seat} released ${fmtShort(now())}.`, r.livemode);
        return r;
      });
    },
    // scripts/founders.js reset-test: every test-mode seat back to open, its private fields
    // cleared; test log lines and test tips deleted. Live rows are never touched.
    resetTest() {
      return tx(db, () => ({ seats: q.resetSeats.run(now()).changes, log: q.resetLog.run().changes, tips: q.resetTips.run().changes }));
    },
    seat(n) { return q.one.get(n) || null; },
    logs(limit = 20) { return q.logs.all({ lm, limit }); },
    list() { expire(); return q.list.all(); },
  };
}

// ---- Stripe ---------------------------------------------------------------------------

// The handle's custom field key. Stripe allows no custom_fields in setup mode, so
// Checkout does not ask for it now; a session without one commits with no handle.
export const HANDLE_FIELD = 'xhandle';

// The Checkout Session for one held seat. Setup mode: a card is saved, nothing is charged.
// token: the hold's token, in the cancel URL only (pro/founders.js cancel).
export function foundersCheckoutParams({ seat, publicUrl, at, cfg, token = '' }) {
  const base = publicUrl.replace(/\/+$/, '');
  const cls = classOf(seat);
  // terms_version: the Terms the founder agrees to at this checkout (public/legal-version.js).
  const metadata = { ...FOUNDERS_METADATA, seat: String(seat), class: cls, terms_version: TERMS_VERSION };
  return {
    mode: 'setup',
    payment_method_types: ['card'],
    customer_creation: 'always',
    success_url: `${base}/founders?seat=${seat}&s={CHECKOUT_SESSION_ID}`,
    cancel_url: token ? `${base}/founders?release=${seat}.${token}` : `${base}/founders`,
    expires_at: Math.floor((at + SESSION_MS) / 1000),
    metadata,
    setup_intent_data: { metadata: { ...metadata }, description: `Bloombroke founders seat ${seat} (${CLASSES[cls].name})` },
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

// The Stripe customer a founders checkout made: deleted, so its email and card are gone at
// Stripe too (a duplicate, a full class, after the deadline, a released seat). Never a
// customer of another site on the shared account: one whose metadata names another site
// is left alone, and with requireTag (a released seat, tagged when it committed) only a
// customer tagged site=bloombroke product=founders is deleted. Idempotent: an already
// deleted or missing customer is fine.
export async function removeCustomer(stripe, customerId, { requireTag = false } = {}) {
  if (!customerId) return 'none';
  let c;
  try {
    c = await stripe.customers.retrieve(customerId);
  } catch (err) {
    if (notThere(err)) return 'gone';
    throw err;
  }
  if (c?.deleted) return 'gone';
  const site = c?.metadata?.site;
  if (site && site !== SITE) return 'not_ours';
  if (requireTag && !(site === SITE && c?.metadata?.product === FOUNDERS_METADATA.product)) return 'not_ours';
  try {
    await stripe.customers.del(customerId, {}, { idempotencyKey: `bb-founders-delete-${customerId}` });
  } catch (err) {
    if (!notThere(err)) throw err;
  }
  return 'deleted';
}

// A SetupIntent that has not succeeded yet: thrown, so the webhook answers 500 and Stripe
// sends the event again (and setup_intent.succeeded can land it).
export class NotYet extends Error {}

const GIVEN = { duplicate: 'founders_duplicate', full: 'founders_full', ended: 'founders_ended', gone: 'founders_gone' };

// A give-back at Stripe: the card detached and the customer deleted (both idempotent),
// then its ids forgotten. Run again on every retry until both calls went through.
async function finishGiveBack(given, { founders, stripe, log }) {
  if (given.payment_method_id || given.stripe_customer_id) {
    await detach(stripe, given.payment_method_id);
    await removeCustomer(stripe, given.stripe_customer_id);
    founders.cleaned(given.checkout_session_id);
    log.log(`[founders] a checkout given back (${given.reason}): card detached, customer deleted`); // counts only
  }
  return GIVEN[given.reason] || 'founders_gone';
}

// A completed setup-mode session -> 'founders_committed' | 'founders_already' |
// 'founders_duplicate' | 'founders_full' | 'founders_ended' | 'founders_gone' |
// 'founders_pending'. Used by the webhook and by the success page, whichever runs first.
// Throws on a Stripe failure, and NotYet while it cannot decide yet, so the webhook is
// retried. A session given back once (migrations/021) is never committed.
// The deadline is checked against when the buyer agreed: Stripe's mandate time, else the
// webhook event's time (at). The success page has neither (at: null): after the deadline
// it waits for the webhook instead of deciding.
export async function commitSession(session, { founders, stripe, log = console, at = Date.now(), now = Date.now }) {
  if (!isFoundersSession(session) || session.status !== 'complete') return 'founders_pending';
  const known = founders.bySession(session.id);
  if (known?.status === 'committed') return 'founders_already';
  const before = founders.givenBack(session.id);
  if (before) return finishGiveBack(before, { founders, stripe, log });
  const siId = idOf(session.setup_intent);
  if (!siId) throw new NotYet('the session has no SetupIntent yet');
  const si = await stripe.setupIntents.retrieve(siId, { expand: ['payment_method', 'mandate'] });
  if (si.status !== 'succeeded') throw new NotYet(`SetupIntent ${si.status}`);
  const pm = typeof si.payment_method === 'object' && si.payment_method ? si.payment_method : null;
  const pmId = idOf(si.payment_method);
  const customer = idOf(session.customer) || idOf(si.customer);
  const metaSeat = Number(session.metadata?.seat);
  const cls = isSeat(metaSeat) ? classOf(metaSeat) : (session.metadata?.class === 'ten' ? 'ten' : 'founder');
  const ids = { cls, pm: pmId, customer };
  // The card is no longer on a customer (taken off by an earlier give-back): no seat.
  if (pm && 'customer' in pm && !pm.customer) return finishGiveBack(founders.giveBack(session.id, 'gone', ids), { founders, stripe, log });
  const mandate = typeof si.mandate === 'object' && si.mandate ? si.mandate : null;
  const accepted = mandate?.customer_acceptance;
  const agreedAt = Number.isFinite(accepted?.accepted_at) ? accepted.accepted_at * 1000 : at;
  if (agreedAt === null || agreedAt === undefined) {
    if (now() > founders.deadlineAt) throw new NotYet('after the deadline: the webhook decides');
  } else if (agreedAt > founders.deadlineAt) {
    return finishGiveBack(founders.giveBack(session.id, 'ended', ids), { founders, stripe, log });
  }
  const email = String(session.customer_details?.email || pm?.billing_details?.email || '').trim().toLowerCase().slice(0, 254) || null;
  const out = founders.commit({
    sessionId: session.id,
    cls,
    customer,
    setupIntent: si.id,
    paymentMethod: pmId,
    fingerprint: pm?.card?.fingerprint || null,
    email,
    handle: cleanHandle(customField(session, HANDLE_FIELD)),
    mandateAt: agreedAt ?? now(),
    mandateIp: accepted?.online?.ip_address || null,
    livemode: typeof session.livemode === 'boolean' ? session.livemode : null,
    termsVersion: String(session.metadata?.terms_version || TERMS_VERSION).slice(0, 16),
  });
  if (out.already) return 'founders_already';
  if (out.given) return finishGiveBack(out.given, { founders, stripe, log });
  // Tag the customer and the card, so the shared account can tell them apart. Not fatal.
  const metadata = { ...FOUNDERS_METADATA, seat: String(out.seat), class: classOf(out.seat), terms_version: String(session.metadata?.terms_version || TERMS_VERSION) };
  const tags = [];
  if (customer) tags.push(stripe.customers.update(customer, { metadata }, { idempotencyKey: `bb-founders-customer-${customer}-${out.seat}` }));
  if (pmId) tags.push(stripe.paymentMethods.update(pmId, { metadata }, { idempotencyKey: `bb-founders-pm-${pmId}-${out.seat}` }));
  for (const r of await Promise.allSettled(tags)) if (r.status === 'rejected') log.error('[founders] could not tag a Stripe object:', r.reason?.message);
  return 'founders_committed';
}

// setup_intent.succeeded: the session event normally commits (it has the email and the
// handle). If the seat is not committed yet, the session is fetched again (the seat the
// SetupIntent names, held by a checkout) and committed from it, so a late success lands.
async function commitFromSetupIntent(si, { founders, stripe, log, at }) {
  if (founders.bySetupIntent(si.id)) return 'founders_already';
  const seat = Number(si.metadata?.seat);
  const row = isSeat(seat) ? founders.seat(seat) : null;
  if (!row || row.status !== 'held' || !row.checkout_session_id) return 'founders_wait';
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(row.checkout_session_id);
  } catch (err) {
    if (notThere(err)) return 'founders_wait';
    throw err;
  }
  if (!isFoundersSession(session) || session.status !== 'complete' || idOf(session.setup_intent) !== si.id) return 'founders_wait';
  return commitSession(session, { founders, stripe, log, at });
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
    case 'setup_intent.succeeded':
      if (founders && isFoundersObject(obj)) return commitFromSetupIntent(obj, { founders, stripe, log, at });
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
  const store = createFoundersStore(db, { now, livemode: mode === 'live' ? 1 : 0, deadlineAt: cfg.deadlineAt });
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
    // { pending: true } while Stripe has not said so, { failed: 'duplicate' | 'full' |
    // 'ended', cls } when the checkout ended without a seat. Asks Stripe at most 30 times
    // per 10 minutes per IP.
    async confirm(sessionId, ip = 'unknown') {
      if (!/^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(String(sessionId || ''))) return null;
      const row = store.bySession(sessionId);
      if (row?.status === 'committed') return { seat: row.seat };
      const given = store.givenBack(sessionId);
      if (given && !given.payment_method_id && !given.stripe_customer_id) return { failed: given.reason, cls: given.class || 'founder' };
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
      const metaSeat = Number(session.metadata?.seat);
      const cls = isSeat(metaSeat) ? classOf(metaSeat) : 'founder';
      try {
        // at: null: the page has no event time; the mandate time or the webhook decides.
        const r = await commitSession(session, { founders: store, stripe, log, at: null, now });
        const reason = Object.entries(GIVEN).find(([, v]) => v === r)?.[0];
        if (reason) return { failed: reason, cls };
      } catch (err) {
        if (!(err instanceof NotYet)) log.error('[founders] confirm commit', err.message);
        return { pending: true };
      }
      const after = store.bySession(sessionId);
      return after?.status === 'committed' ? { seat: after.seat } : { pending: true };
    },
    // The cancel link (?release=<seat>.<hold token>, only in that checkout's cancel URL):
    // the buyer came back from Stripe without saving a card. If that hold is still theirs
    // and its Checkout Session is still open, the session is expired at Stripe and the seat
    // opens at once, instead of after 33 minutes. -> true when it was let go.
    async cancel(raw, ip = 'unknown') {
      const m = /^([1-9]\d?)\.([0-9a-f]{24})$/.exec(String(raw || ''));
      if (!m || !stripe) return false;
      const seat = Number(m[1]);
      const row = store.seat(seat);
      if (!row || row.status !== 'held' || row.hold_token !== m[2] || !row.checkout_session_id) return false;
      if (!confirmLimit.hit(ip).ok) return false;
      try {
        const session = await stripe.checkout.sessions.retrieve(row.checkout_session_id);
        if (!isFoundersSession(session) || session.status !== 'open') return false;
        await stripe.checkout.sessions.expire(session.id, {}, { idempotencyKey: `bb-founders-expire-${session.id}` });
      } catch (err) {
        log.error('[founders] cancel', err.message);
        return false;
      }
      return store.dropHold(seat, m[2]);
    },
  };
  return f;
}

export function mountFounders(app, {
  founders, publicUrl = 'https://bloombroke.com', now = () => Date.now(), log = console,
  limiter = createLimiter({ max: PER_IP, windowMs: HOUR, now }),
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
    let held;
    try {
      // At most 2 live holds per address and 20 for the site, counted in the hold itself.
      held = founders.store.hold({ seat, cls, ip: rawIp(req), key: clientIp(req) });
    } catch (err) {
      if (err instanceof FoundersError) return fail(res, err.status, err.code, err.message);
      log.error('[founders] hold', err.message);
      return fail(res, 503, 'unavailable', 'Could not hold that seat. Try again in a minute.');
    }
    try {
      const session = await founders.stripe.checkout.sessions.create(
        foundersCheckoutParams({ seat: held.seat, publicUrl: base, at: t, cfg: founders.cfg, token: held.token }),
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
