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
import { createHash, randomBytes } from 'node:crypto';
import {
  accessSync, chmodSync, closeSync, constants as fsConstants, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLimiter, clientIp } from './ratelimit.js';
import { sameOrigin } from './feedback.js';
import { tx } from './db.js';
import { idOf, billingOf, TERMS_MESSAGE } from './billing.js';
import { isDeletedLicence } from './store.js';
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
// Stripe takes up to 1,200 characters; this is about 340.
export function mandateText(cls, { goalUsd = DEFAULT_GOAL_USD, deadlineAt } = {}) {
  const at = deadlineAt ?? foundersEnv({}).deadlineAt;
  const charge = cls === 'ten' ? `${usd(CLASSES.ten.usd)} once for this five-year seat` : `${usd(CLASSES.founder.usd)} a year for this founder seat`;
  return `You are saving a card. We charge ${charge}, only when founders reach ${usd(goalUsd)}, and no later than ${fmtDay(at)}. `
    + `If the goal is not reached by then, we delete the card and you pay nothing. If the card fails, you get 3 days to pay by link. `
    + `You can give up your seat before the charge by emailing ${CONTACT}.`;
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

// Every private field, the charge-day ones (migrations/022) too: a seat that opens again
// keeps nothing of the last holder (Privacy: the Stripe ids are cleared on release).
const FREE = `status = 'open', held_until = NULL, hold_token = NULL, hold_key = NULL, checkout_session_id = NULL, stripe_customer_id = NULL,
  setup_intent_id = NULL, payment_method_id = NULL, card_fingerprint = NULL, email = NULL, handle = NULL, mandate_at = NULL,
  mandate_ip = NULL, livemode = NULL, terms_version = NULL,
  charge_state = NULL, payment_intent_id = NULL, subscription_id = NULL, licence_id = NULL, charged_at = NULL, fail_code = NULL,
  pay_hash = NULL, pay_expires_at = NULL, pay_session_id = NULL, pay_revealed_at = NULL, claim_hash = NULL, claim_expires_at = NULL`;

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
    // migrations/022: charge day. founders_state is one row per mode.
    state: db.prepare('SELECT * FROM founders_state WHERE livemode = ?'),
    stateRow: db.prepare('INSERT OR IGNORE INTO founders_state (livemode) VALUES (?)'),
    freeze: db.prepare('UPDATE founders_state SET frozen_at = COALESCE(frozen_at, ?) WHERE livemode = ?'),
    started: db.prepare('UPDATE founders_state SET charge_started_at = COALESCE(charge_started_at, ?) WHERE livemode = ?'),
    golive: db.prepare('UPDATE founders_state SET golive_at = @at WHERE livemode = @lm AND (golive_at IS NULL OR golive_at = @at)'),
    openHolds: db.prepare("SELECT COUNT(*) AS n FROM founders_seats WHERE status = 'held' AND held_until > ? AND livemode = ?"),
    // The charge takes the seats of exactly this mode: never a row with no mode recorded.
    committedHere: db.prepare("SELECT * FROM founders_seats WHERE status = 'committed' AND livemode = ? ORDER BY seat"),
    committedOther: db.prepare("SELECT seat, livemode FROM founders_seats WHERE status = 'committed' AND (livemode IS NULL OR livemode != ?) ORDER BY seat"),
    startCharging: db.prepare(`UPDATE founders_seats SET payment_intent_id = ?, charge_state = 'charging', updated_at = ?
      WHERE seat = ? AND status = 'committed' AND charge_state IS NULL AND livemode = ?`),
    failed: db.prepare(`UPDATE founders_seats SET charge_state = 'failed', fail_code = @code, pay_hash = @hash, pay_expires_at = @until, updated_at = @t
      WHERE seat = @seat AND status = 'committed' AND charge_state = 'charging' AND payment_intent_id = @pi`),
    charged: db.prepare(`UPDATE founders_seats SET charge_state = 'charged', charged_at = @t, licence_id = @lic, claim_hash = @hash, claim_expires_at = @until,
      payment_intent_id = @pi, payment_method_id = COALESCE(@pm, payment_method_id), card_fingerprint = COALESCE(@fp, card_fingerprint),
      pay_expires_at = NULL, updated_at = @t WHERE seat = @seat AND status = 'committed'`),
    byClaim: db.prepare('SELECT * FROM founders_seats WHERE claim_hash = ?'),
    byPay: db.prepare('SELECT * FROM founders_seats WHERE pay_hash = ?'),
    setPaySession: db.prepare("UPDATE founders_seats SET pay_session_id = ?, updated_at = ? WHERE seat = ? AND charge_state = 'failed' AND pay_hash = ?"),
    unpaid: db.prepare("UPDATE founders_seats SET charge_state = 'unpaid', updated_at = ? WHERE seat = ? AND status = 'committed' AND charge_state = 'failed'"),
    revealed: db.prepare(`UPDATE founders_seats SET pay_revealed_at = ? WHERE seat = ? AND status = 'committed' AND charge_state = 'charged'
      AND pay_session_id = ? AND pay_revealed_at IS NULL`),
    setSub: db.prepare("UPDATE founders_seats SET subscription_id = ?, updated_at = ? WHERE seat = ? AND charge_state = 'charged' AND subscription_id IS NULL"),
  };
  // Seats closed for the charge (migrations/022 founders_state.frozen_at), read fresh: the
  // charge script runs in another process.
  const frozenNow = () => Number.isFinite(q.state.get(lm)?.frozen_at);
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
        // Charge day: no new holds once the seats are frozen (checked in the same
        // transaction, so a freeze in another process is never missed).
        if (frozenNow()) throw new FoundersError('frozen', FROZEN_MESSAGE, 410);
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
        // Charge day has begun: a card saved now gets no seat (given back, like after the
        // deadline), in the same transaction as the freeze check.
        if (frozenNow()) return { given: markGiven(c.sessionId, 'ended', ids) };
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
    // inside(row): more writes for the same transaction (a charged seat's licence ends).
    release(seat, { inside = null } = {}) {
      return tx(db, () => {
        const r = q.one.get(seat);
        if (!r) return null;
        if (inside) inside(r);
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

    // ---- charge day (migrations/022) ------------------------------------------------
    // { livemode, frozen_at, charge_started_at, golive_at } of this mode (all null at first).
    state() { return q.state.get(lm) || { livemode: lm, frozen_at: null, charge_started_at: null, golive_at: null }; },
    frozen: frozenNow,
    // Seats close for the charge, for good (durable: isOpen, checkout and commit read it).
    freeze(t = now()) { tx(db, () => { q.stateRow.run(lm); q.freeze.run(t, lm); }); return this.state(); },
    chargeStarted(t = now()) { tx(db, () => { q.stateRow.run(lm); q.started.run(t, lm); }); return this.state(); },
    // The go-live day. -> false when another day is already set.
    setGolive(at) { return tx(db, () => { q.stateRow.run(lm); return Number(q.golive.run({ at, lm }).changes) > 0; }); },
    // Checkouts still open in this mode (their hold has not run out).
    openHolds(t = now()) { return q.openHolds.get(t, lm).n; },
    committedHere() { return q.committedHere.all(lm); },
    committedOther() { return q.committedOther.all(lm); },
    // Step 1 of a charge: the PaymentIntent's id is saved before it is confirmed. Only a
    // committed seat of this mode that has none. -> true when saved.
    startCharging(seat, paymentIntentId) { return Number(q.startCharging.run(paymentIntentId, now(), seat, lm).changes) > 0; },
    byClaimHash(h) { return h ? q.byClaim.get(h) || null : null; },
    byPayHash(h) { return h ? q.byPay.get(h) || null : null; },
    setPaySession(seat, payHash, sessionId) { return Number(q.setPaySession.run(sessionId, now(), seat, payHash).changes) > 0; },
    markUnpaid(seat) { return Number(q.unpaid.run(now(), seat).changes) > 0; },
    markRevealed(seat, sessionId) { return Number(q.revealed.run(now(), seat, sessionId).changes) > 0; },
    // For the engine below, inside its own transactions.
    q,
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

// Seats closed for the charge, for good: true from charge day on, for weeks after it too.
export const FROZEN_MESSAGE = 'Seats are closed. Founders reached the goal.';

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
// charge: the charge-day context (createChargeContext) for pay-link payments; without it
// a pay-link event is retried (500) rather than dropped.
export async function handleFoundersEvent(event, { founders, tips = null, stripe, log = console, charge = null }) {
  const obj = event?.data?.object;
  const at = Number.isFinite(event?.created) ? event.created * 1000 : Date.now();
  switch (event?.type) {
    case 'checkout.session.completed':
      // A pay link (charge day, a failed card), before tips and Pro.
      if (isFoundersPaySession(obj)) {
        if (!charge) throw new Error('founders pay link: the charge context is not set up');
        return applyPaySession(obj, charge);
      }
      if (founders && isFoundersSession(obj)) return commitSession(obj, { founders, stripe, log, at });
      if (tips?.isTipSession(obj)) return tips.fromSession(obj, { at });
      return null;
    case 'checkout.session.expired':
      if (isFoundersPaySession(obj)) return 'founders_pay_expired';
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

// ---- charge day -----------------------------------------------------------------------
// The goal is reached: every committed seat is charged once (scripts/founders.js charge),
// a failed card gets a 3-day pay link, a paid seat gets a Pro licence and a link to
// collect its key, and on go-live day (scripts/founders.js golive) the founder seats get
// their yearly renewal and the five-year seats their end date. Nothing here runs by itself.
//
// Tokens (claim and pay links): 32 random bytes, base64url, in the URL fragment only
// (#claim=, #pay=). The database keeps their SHA-256 hash; the token itself goes only into
// the email waiting in the outbox. No founders key is ever stored: the licence is made with
// a key hash nobody can match, and the claim makes a fresh key (rotateKey) each time.

const DAY = 24 * HOUR;
export const PAY_WINDOW_MS = 3 * DAY;
// The Terms say the key link works 30 days; 2 more cover the time the email waits.
export const CLAIM_MS = 32 * DAY;
export const CLAIM_DAYS_SHOWN = 30;
// The pay-link success page shows a key once, within 24 hours of the payment.
export const PAID_REVEAL_MS = 24 * HOUR;
// A pay Checkout Session lives at least 30 minutes (Stripe's least; one more for clock
// differences) and at most a little under Stripe's 24 hours, never past the pay link.
export const PAY_SESSION_MIN_MS = 31 * MIN;
export const PAY_SESSION_MAX_MS = 24 * HOUR - 5 * MIN;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex');
const ENDED_SUB = new Set(['canceled', 'incomplete_expired']);

// The amount of a seat, in cents, from its class: never from Stripe or the browser.
export const seatCents = (seat) => CLASSES[classOf(seat)].usd * 100;
export const chargeDescription = (seat) => `Bloombroke founders seat ${seat} (${classOf(seat) === 'ten' ? 'five-year seat' : 'founder seat, first year'})`;

// One calendar year (or n) later, same time of day, UTC. Feb 29 moves to Mar 1.
export function addYears(ms, n) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}
// 'YYYY-MM-DD' -> the start of that day UTC (ms), or null.
export function parseDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(at);
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? at : null;
}
// 'Dec 18, 2026, 14:05 UTC'
export const fmtTime = (ms) => { const d = new Date(ms); return `${fmtDay(ms)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`; };

// The founder seat's renewal price: STRIPE_FOUNDERS_PRICE_ID (live) or _TEST (test mode),
// made by scripts/stripe-setup.js.
export const foundersPriceName = (mode) => (mode === 'test' ? 'STRIPE_FOUNDERS_PRICE_ID_TEST' : 'STRIPE_FOUNDERS_PRICE_ID');
export const foundersPriceId = (env, mode) => String(env?.[foundersPriceName(mode)] || '').trim() || null;
export const FOUNDERS_PRICE = { unit_amount: CLASSES.founder.usd * 100, currency: 'usd', interval: 'year', lookup_key: 'bb_founders_seat_yearly' };

// The renewal price is ours and right: $420 USD a year, the founders metadata, this mode.
// -> null when it is, else what is wrong (no ids, no secrets).
export async function checkFoundersPrice(stripe, priceId, livemode) {
  if (!priceId) return 'STRIPE_FOUNDERS_PRICE_ID is not set (run scripts/stripe-setup.js)';
  let p;
  try { p = await stripe.prices.retrieve(priceId); } catch (err) { return `the founders price could not be read (${err?.code || err?.message})`; }
  if (p?.unit_amount !== FOUNDERS_PRICE.unit_amount || p?.currency !== 'usd') return 'the founders price is not $420 USD';
  if (p?.recurring?.interval !== 'year' || (p?.recurring?.interval_count ?? 1) !== 1) return 'the founders price is not yearly';
  if (!isFoundersObject(p)) return 'the founders price does not carry the founders metadata';
  if (p.active === false) return 'the founders price is archived';
  if (typeof p.livemode === 'boolean' && (p.livemode ? 1 : 0) !== livemode) return 'the founders price is from the other Stripe mode';
  return null;
}

// ---- the outbox: emails waiting to be sent ----------------------------------------------
// One JSON file per day and writer (charge, golive, pay, ...): an array of
// { kind, seat, to, subject, text }. The folder is outside the repo and outside every
// backed-up path (FOUNDERS_OUTBOX_DIR, default /root/bb-outbox), mode 700, files 600. The
// files are never printed: scripts/founders.js outbox shows them with the tokens hidden,
// scripts/send-outbox.cjs sends them, and then they are deleted.

export const DEFAULT_OUTBOX_DIR = '/root/bb-outbox';
export const EMAIL_KINDS = ['charge', 'failed', 'key', 'golive'];
export const OUTBOX_FILE_RE = /^founders-\d{8}-[a-z]+\.json$/;
// A file taken for sending (scripts/founders.js outbox --take): renamed so no writer
// adds to it again; the next email starts a new file.
export const TAKEN_PREFIX = '.sending-';
const LOCK_STALE_MS = 30 * 1000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

export function createOutbox({ dir = null, source = 'app', now = () => Date.now(), repo = REPO } = {}) {
  const folder = path.resolve(dir || DEFAULT_OUTBOX_DIR);
  if (!/^[a-z]+$/.test(source)) throw new Error('outbox: bad source name');
  const inside = (a, b) => a === b || a.startsWith(b + path.sep);
  // One writer at a time across processes (the app's pay webhook, the scripts, a take):
  // a lock file made with O_EXCL. A lock older than 30 seconds is from a dead process.
  // Synchronous; waits up to about half a second, then throws (the caller retries).
  const locked = (fn) => {
    const lock = path.join(folder, '.lock');
    let fd = null;
    for (let i = 0; i < 50 && fd === null; i++) {
      try { fd = openSync(lock, 'wx', 0o600); } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
        try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock); } catch { /* gone meanwhile */ }
        pause(10);
      }
    }
    if (fd === null) throw new Error('outbox: busy, try again');
    try { return fn(); } finally { closeSync(fd); try { unlinkSync(lock); } catch { /* already gone */ } }
  };
  return {
    dir: folder,
    file() { return path.join(folder, `founders-${ymd(now())}-${source}.json`); },
    // The folder can take files: outside the repo, made (mode 700), writable. Throws.
    check() {
      if (inside(folder, path.resolve(repo))) throw new Error('outbox: the folder is inside the repo; set FOUNDERS_OUTBOX_DIR outside it');
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      accessSync(folder, fsConstants.W_OK);
      return folder;
    },
    // Add one email. Synchronous, so it can sit inside a database transaction: if it
    // throws, the transaction rolls back and the seat is not marked.
    append(entry) {
      if (inside(folder, path.resolve(repo))) throw new Error('outbox: the folder is inside the repo; set FOUNDERS_OUTBOX_DIR outside it');
      const e = { kind: entry?.kind, seat: entry?.seat, to: entry?.to, subject: entry?.subject, text: entry?.text };
      if (!EMAIL_KINDS.includes(e.kind) || !isSeat(e.seat) || typeof e.to !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(e.to)
        || typeof e.subject !== 'string' || !e.subject || typeof e.text !== 'string' || !e.text) throw new Error('outbox: bad email');
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const f = this.file();
      return locked(() => {
        let list = [];
        // A parse error would quote the file (tokens): a fixed message instead.
        if (existsSync(f)) { try { list = JSON.parse(readFileSync(f, 'utf8')); } catch { throw new Error('outbox: the file cannot be read as JSON'); } }
        if (!Array.isArray(list)) throw new Error('outbox: the file is not a list');
        list.push(e);
        const tmp = `${f}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
        writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
        renameSync(tmp, f);
        chmodSync(f, 0o600);
        return f;
      });
    },
    // Take one waiting file for sending: renamed to .sending-<name> under the lock, so a
    // writer never adds to it (or brings it back) while it is sent. -> the new path.
    take(name) {
      if (!OUTBOX_FILE_RE.test(String(name || ''))) throw new Error('outbox: name a waiting file, like founders-20261201-charge.json');
      const from = path.join(folder, name);
      const to = path.join(folder, `${TAKEN_PREFIX}${name}`);
      return locked(() => {
        if (!existsSync(from)) throw new Error(`outbox: no file ${name}`);
        if (existsSync(to)) throw new Error(`outbox: ${TAKEN_PREFIX}${name} is already being sent; finish that first`);
        renameSync(from, to);
        chmodSync(to, 0o600);
        return to;
      });
    },
  };
}

// The four founders emails. Plain words, no tokens anywhere but the link.
const SIGN = '\n\nMax\nBloombroke';
const seatLine = (seat) => `founders seat ${seat} (${CLASSES[classOf(seat)].name})`;
function goliveLines(seat, goliveAt) {
  if (classOf(seat) === 'ten') {
    return goliveAt ? `Pro goes live on ${fmtDay(goliveAt)}. Your five-year seat gives you Pro until ${fmtDay(addYears(goliveAt, 5))}. It does not renew.`
      : 'We will email you the day Pro goes live. Your five-year seat gives you Pro for five years from that day. It does not renew.';
  }
  return goliveAt ? `Pro goes live on ${fmtDay(goliveAt)}. Your seat renews on ${fmtDay(addYears(goliveAt, 1))} at ${usd(CLASSES.founder.usd)} for the year.`
    : `We will email you the day Pro goes live. Your seat renews one year after that day, at ${usd(CLASSES.founder.usd)} a year.`;
}
const claimUrl = (publicUrl, token) => `${publicUrl.replace(/\/+$/, '')}/founders#claim=${token}`;
const payUrl = (publicUrl, token) => `${publicUrl.replace(/\/+$/, '')}/founders#pay=${token}`;
const keyBlock = (url) => `Get your Pro key here. The link works for ${CLAIM_DAYS_SHOWN} days:\n${url}\n\n`
  + 'Each time you open the link, you get a new key and the old one stops working.';

export function chargeEmail({ seat, to, token, publicUrl, goliveAt = null }) {
  return {
    kind: 'charge', seat, to,
    subject: `Founders seat ${seat} is paid: get your Pro key`,
    text: `Hi,\n\nFounders reached the goal, so today we charged ${usd(CLASSES[classOf(seat)].usd)} for ${seatLine(seat)}. Stripe sends the receipt.\n\n`
      + `${keyBlock(claimUrl(publicUrl, token))}\n\n${goliveLines(seat, goliveAt)}\n\n`
      + `After ${CLAIM_DAYS_SHOWN} days, email ${CONTACT} for a new link.${SIGN}`,
  };
}

export function failedEmail({ seat, to, token, publicUrl, payUntil }) {
  return {
    kind: 'failed', seat, to,
    subject: `Founders seat ${seat}: the card did not go through`,
    text: `Hi,\n\nFounders reached the goal, so today we tried to charge ${usd(CLASSES[classOf(seat)].usd)} for ${seatLine(seat)}. The card did not go through.\n\n`
      + `You can pay by card here until ${fmtTime(payUntil)}:\n${payUrl(publicUrl, token)}\n\n`
      + `If it is not paid by then, the seat is given back and we delete your saved card.${SIGN}`,
  };
}

export function keyEmail({ seat, to, token, publicUrl, goliveAt = null }) {
  return {
    kind: 'key', seat, to,
    subject: `Founders seat ${seat} is paid: get your Pro key`,
    text: `Hi,\n\nThank you. We received ${usd(CLASSES[classOf(seat)].usd)} for ${seatLine(seat)}. Stripe sends the receipt.\n\n`
      + `${keyBlock(claimUrl(publicUrl, token))}\n\n${goliveLines(seat, goliveAt)}\n\n`
      + `After ${CLAIM_DAYS_SHOWN} days, email ${CONTACT} for a new link.${SIGN}`,
  };
}

export function goliveEmail({ seat, to, goliveAt }) {
  const body = classOf(seat) === 'ten'
    ? `Your five-year seat (seat ${seat}) gives you Pro until ${fmtDay(addYears(goliveAt, 5))}. It does not renew, and we will not charge you again.`
    : `Your founder seat (seat ${seat}) renews on ${fmtDay(addYears(goliveAt, 1))} at ${usd(CLASSES.founder.usd)}, then each year at ${usd(CLASSES.founder.usd)} while you keep it. `
      + 'To stop the renewal, type PRO on bloombroke.com and press CANCEL before that day.';
  return { kind: 'golive', seat, to, subject: `Bloombroke Pro goes live on ${fmtDay(goliveAt)}`, text: `Hi,\n\nBloombroke Pro goes live on ${fmtDay(goliveAt)}.\n\n${body}${SIGN}` };
}

// The outbox preview (scripts/founders.js outbox): every token hidden.
export const redactTokens = (text) => String(text).replace(/#(claim|pay)=[A-Za-z0-9_-]+/g, '#$1=[REDACTED]');

// ---- marking a seat --------------------------------------------------------------------
// ctx (createChargeContext): { db, store, licences, outbox, stripe, now, log, publicUrl,
// priceId, busy }.

export function createChargeContext({ db, stripe = null, licences, livemode = 1, now = () => Date.now(), log = console, publicUrl = 'https://bloombroke.com',
  priceId = null, outbox, deadlineAt = foundersEnv({}).deadlineAt, store = null }) {
  if (!licences) throw new Error('charge: the licence store is needed');
  const s = store || createFoundersStore(db, { now, livemode, deadlineAt });
  return { db, stripe, licences, store: s, lm: s.livemode, outbox, now, log, publicUrl, priceId, busy: new Set() };
}

const sameMode = (row, lm) => row?.livemode === lm;

// Paid (charge day or pay link): in ONE transaction the Pro licence is made (or the one
// the seat has is kept), the seat is marked charged with a fresh claim token, and the
// email with that token goes into the outbox. from: 'charging' (the charge-day
// PaymentIntent must be the stored one) or 'failed' (the pay-link session must be the
// stored one). -> { charged, licenceId } | { already } (this payment was applied before)
// | { conflict } (the seat is not in that state: nothing changed).
export function markCharged(ctx, { seat, from, paymentIntentId, paySessionId = null, paymentMethodId = null, fingerprint = null }) {
  const { db, store, licences, outbox, now, publicUrl, lm } = ctx;
  return tx(db, () => {
    const row = store.seat(seat);
    if (row?.status === 'committed' && row.charge_state === 'charged' && row.payment_intent_id === paymentIntentId) return { already: true, licenceId: row.licence_id };
    const ok = row && row.status === 'committed' && sameMode(row, lm) && (from === 'charging'
      ? row.charge_state === 'charging' && row.payment_intent_id === paymentIntentId
      : from === 'failed' && row.charge_state === 'failed' && Boolean(paySessionId) && row.pay_session_id === paySessionId);
    if (!ok) return { conflict: true };
    const goliveAt = store.state().golive_at ?? null;
    // ensureFounderLicence: idempotent, a seat that has a licence keeps it.
    let lic = row.licence_id ? licences.findById(row.licence_id) : null;
    if (!lic) {
      lic = licences.insertFounderLicence({
        customerId: row.stripe_customer_id, termsAcceptedAt: row.mandate_at, termsVersion: row.terms_version, livemode: row.livemode,
        // Paid after go-live: a five-year seat's end is known now.
        termEndsAt: goliveAt && row.class === 'ten' ? addYears(goliveAt, 5) : null,
      });
    }
    const token = newToken();
    const t = now();
    store.q.charged.run({ t, lic: lic.id, hash: tokenHash(token), until: t + CLAIM_MS, pi: paymentIntentId, pm: paymentMethodId, fp: fingerprint, seat });
    const mail = from === 'charging' ? chargeEmail : keyEmail;
    outbox.append(mail({ seat, to: row.email, token, publicUrl, goliveAt }));
    return { charged: true, licenceId: lic.id };
  });
}

// The card failed on charge day: a 3-day pay link, and its email, in one transaction.
// -> true when marked.
export function markFailed(ctx, { seat, paymentIntentId, failCode }) {
  const { db, store, outbox, now, publicUrl, lm } = ctx;
  return tx(db, () => {
    const row = store.seat(seat);
    if (!row || !sameMode(row, lm)) return false;
    const token = newToken();
    const t = now();
    const until = t + PAY_WINDOW_MS;
    const code = String(failCode || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) || null;
    if (!store.q.failed.run({ code, hash: tokenHash(token), until, t, seat, pi: paymentIntentId }).changes) return false;
    outbox.append(failedEmail({ seat, to: row.email, token, publicUrl, payUntil: until }));
    return true;
  });
}

// Go-live for one charged seat. A five-year seat: its end (go-live + 5 years). A founder
// seat: its yearly renewal subscription, anchored one calendar year after go-live with
// nothing charged now; an existing founders subscription of that seat is used instead
// of making a second. email: put a go-live email in the outbox when this call did it.
// -> 'term' | 'renewal' (done now) | 'already' | 'deleted' (the account was deleted: no
// renewal is made) | 'not_charged' | 'no_golive'. Throws on a Stripe failure (nothing
// saved; run it again).
export async function goliveSeat(ctx, seat, { email = false } = {}) {
  const { db, store, licences, stripe, outbox, lm, now } = ctx;
  const goliveAt = store.state().golive_at;
  if (!Number.isFinite(goliveAt)) return 'no_golive';
  const row = store.seat(seat);
  if (!row || row.status !== 'committed' || row.charge_state !== 'charged' || !sameMode(row, lm) || !row.licence_id) return 'not_charged';
  const lic = licences.findById(row.licence_id);
  if (!lic) return 'not_charged';
  if (row.class === 'ten') {
    if (Number.isFinite(lic.term_ends_at)) return 'already';
    return tx(db, () => {
      if (!licences.setTermEnd(lic.id, addYears(goliveAt, 5))) return 'already';
      if (email) outbox.append(goliveEmail({ seat, to: row.email, goliveAt }));
      return 'term';
    });
  }
  if (row.subscription_id) return 'already';
  if (isDeletedLicence(lic)) return 'deleted';
  if (!stripe) throw new Error('no Stripe key');
  const anchor = addYears(goliveAt, 1);
  if (anchor <= now()) throw new Error('the renewal date has passed');
  const metadata = { ...FOUNDERS_METADATA, kind: 'renewal', seat: String(seat), class: 'founder', terms_version: String(row.terms_version || TERMS_VERSION) };
  let sub = null;
  for await (const s of stripe.subscriptions.list({ customer: row.stripe_customer_id, status: 'all', limit: 100 })) {
    if (isFoundersObject(s) && s.metadata?.kind === 'renewal' && s.metadata?.seat === String(seat)) { sub = s; break; }
  }
  if (!sub) {
    const err = await checkFoundersPrice(stripe, ctx.priceId, lm);
    if (err) throw new Error(err);
    sub = await stripe.subscriptions.create({
      customer: row.stripe_customer_id,
      items: [{ price: ctx.priceId, quantity: 1 }],
      default_payment_method: row.payment_method_id,
      payment_settings: { payment_method_types: ['card'] },
      billing_cycle_anchor: Math.floor(anchor / 1000),
      proration_behavior: 'none',
      description: `Bloombroke founders seat ${seat} (founder seat, yearly renewal)`,
      metadata,
    }, { idempotencyKey: `bb-founders-sub-${lm}-${seat}-${goliveAt}` });
  }
  const done = tx(db, () => {
    if (!store.q.setSub.run(sub.id, now(), seat).changes) return false;
    licences.attachFounderSubscription(lic.id, sub.id, sub.status);
    if (email) outbox.append(goliveEmail({ seat, to: row.email, goliveAt }));
    return true;
  });
  // "Renews ..." on PRO and ME, from the subscription itself.
  licences.setBilling(lic.id, billingOf(sub));
  if (ENDED_SUB.has(sub.status)) licences.setStatus(lic.id, 'canceled');
  return done ? 'renewal' : 'already';
}

// ---- the pay link -----------------------------------------------------------------------

export const isFoundersPaySession = (s) => Boolean(s && s.mode === 'payment' && isFoundersObject(s) && s.metadata?.kind === 'pay');

// The Checkout Session of a pay link: the seat's customer, its class amount, cards only,
// the card kept for the renewal, a receipt, the Terms box, and never open past the link.
export function payCheckoutParams({ row, publicUrl, at }) {
  const base = publicUrl.replace(/\/+$/, '');
  const seat = row.seat;
  const cls = classOf(seat);
  const metadata = { ...FOUNDERS_METADATA, kind: 'pay', seat: String(seat), class: cls, terms_version: String(row.terms_version || TERMS_VERSION) };
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    customer: row.stripe_customer_id,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: seatCents(seat), product_data: { name: `Bloombroke founders seat ${seat} (${CLASSES[cls].name})` } } }],
    payment_intent_data: { setup_future_usage: 'off_session', receipt_email: row.email, description: chargeDescription(seat), metadata: { ...metadata } },
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: TERMS_MESSAGE } },
    expires_at: Math.floor(Math.min(row.pay_expires_at, at + PAY_SESSION_MAX_MS) / 1000),
    metadata,
    success_url: `${base}/founders?paid=${seat}&s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/founders`,
  };
}

// A paid pay-link session against the seat: 'apply' | 'already' (applied before) |
// 'pending' (not paid yet) | 'wrong_mode' | 'refund' with why (late or mismatched: the
// seat is charged or given back, another session, the wrong amount or currency).
export function payDecision(session, row, lm) {
  if (session?.status !== 'complete' || session?.payment_status !== 'paid') return { action: 'pending' };
  if (typeof session.livemode !== 'boolean' || (session.livemode ? 1 : 0) !== lm) return { action: 'wrong_mode' };
  const pi = idOf(session.payment_intent);
  const seat = Number(session.metadata?.seat);
  if (row && row.charge_state === 'charged' && row.pay_session_id === session.id && row.payment_intent_id === pi) return { action: 'already' };
  if (!isSeat(seat) || !row) return { action: 'refund', why: 'no_seat' };
  if (session.metadata?.class !== classOf(seat)) return { action: 'refund', why: 'class' };
  if (session.currency !== 'usd') return { action: 'refund', why: 'currency' };
  if (session.amount_total !== seatCents(seat)) return { action: 'refund', why: 'amount' };
  if (row.status !== 'committed' || row.charge_state !== 'failed' || !sameMode(row, lm)) return { action: 'refund', why: 'state' };
  if (row.pay_session_id !== session.id) return { action: 'refund', why: 'session' };
  return { action: 'apply' };
}

// A late or mismatched pay-link payment back in full. Idempotent (the key names the
// PaymentIntent and the reason; one already refunded is fine).
export async function refundPayment(stripe, paymentIntentId, { seat = null, why = '' } = {}) {
  if (!paymentIntentId) throw new Error('no PaymentIntent to refund');
  try {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, metadata: { ...FOUNDERS_METADATA, kind: 'pay_refund', seat: String(seat ?? ''), why: String(why).slice(0, 40) } },
      { idempotencyKey: `bb-founders-refund-${paymentIntentId}-${String(why).replace(/[^a-z_]/g, '')}` },
    );
    return 'refunded';
  } catch (err) {
    if (err?.code === 'charge_already_refunded') return 'already';
    throw err;
  }
}

// A completed pay-link session (the webhook, the success page or reconcile, whichever
// comes first): the guards, then the same transaction as a charge-day success with the
// card just used (the failed one comes off). Anything late or mismatched is refunded in
// full. -> 'founders_paid' | 'founders_pay_already' | 'founders_pay_pending' |
// 'founders_pay_refunded' | 'founders_pay_wrong_mode'. Throws on a Stripe failure, and
// NotYet while another call works on the same seat, so the webhook is retried.
export async function applyPaySession(session, ctx) {
  const { store, stripe, log, lm } = ctx;
  if (!isFoundersPaySession(session)) return null;
  const seat = Number(session.metadata?.seat);
  const key = isSeat(seat) ? seat : 0;
  if (ctx.busy.has(key)) throw new NotYet('this seat is being applied');
  ctx.busy.add(key);
  // A refund that fails is logged loudly and thrown: the webhook answers 500 and Stripe
  // sends the event again (for up to 3 days), so it is never dropped silently.
  const refund = async (piId, why) => {
    try {
      await refundPayment(stripe, piId, { seat, why });
    } catch (err) {
      log.error(`[founders] REFUND FAILED seat ${isSeat(seat) ? seat : '?'} (${why}): ${err?.type || ''} ${err?.code || err?.message || ''}. Stripe will retry; refund it by hand if this repeats.`);
      throw err;
    }
    log.log(`[founders] a pay-link payment was refunded in full (${why}), seat ${isSeat(seat) ? seat : '?'}`);
    return 'founders_pay_refunded';
  };
  try {
    const row = isSeat(seat) ? store.seat(seat) : null;
    const d = payDecision(session, row, lm);
    if (d.action === 'pending') return 'founders_pay_pending';
    if (d.action === 'already') return 'founders_pay_already';
    if (d.action === 'wrong_mode') {
      log.error('[founders] a pay session of the other Stripe mode: not applied, not refunded with this key');
      return 'founders_pay_wrong_mode';
    }
    const piId = idOf(session.payment_intent);
    if (d.action === 'refund') return await refund(piId, d.why);
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
    if (pi.status !== 'succeeded') throw new NotYet(`PaymentIntent ${pi.status}`);
    if (pi.amount_received !== seatCents(seat) || pi.currency !== 'usd') return await refund(piId, 'amount');
    const pmId = idOf(pi.payment_method);
    const fingerprint = typeof pi.payment_method === 'object' ? pi.payment_method?.card?.fingerprint || null : null;
    const out = markCharged(ctx, { seat, from: 'failed', paymentIntentId: piId, paySessionId: session.id, paymentMethodId: pmId, fingerprint });
    if (out.already) return 'founders_pay_already';
    if (out.conflict) {
      // The seat changed since the checks (given back a moment ago): the money goes back.
      return await refund(piId, 'state');
    }
    // The card that failed on charge day comes off; the new one stays for the renewal.
    if (row.payment_method_id && row.payment_method_id !== pmId) {
      try { await detach(stripe, row.payment_method_id); } catch (err) { log.error(`[founders] seat ${seat}: the old card could not be detached:`, err?.message); }
    }
    // Paid after go-live: the go-live step for this seat at once (the key email already
    // says the dates). A failure is logged; scripts/founders.js golive finishes it.
    try { await goliveSeat(ctx, seat); } catch (err) { log.error(`[founders] seat ${seat}: paid after go-live, renewal not set up yet (run golive again):`, err?.message); }
    log.log(`[founders] seat ${seat} paid by link`);
    return 'founders_paid';
  } finally {
    ctx.busy.delete(key);
  }
}

// ---- the runtime object and the routes ------------------------------------------------

// The founders seats as the server uses them: the store, the config, the public status
// and the success-page check. stripe: null when Stripe is not configured (closed).
// licences: the Pro licence store (pro/store.js createStore), for charge day (the pay
// link, the claim). Without it the charge-day routes answer 503.
export function createFounders({ db, stripe = null, env = process.env, mode = 'live', webhookReady = false, now = () => Date.now(), log = console, licences = null }) {
  const cfg = foundersEnv(env);
  const store = createFoundersStore(db, { now, livemode: mode === 'live' ? 1 : 0, deadlineAt: cfg.deadlineAt });
  const ready = Boolean(stripe && webhookReady);
  if (cfg.open && !ready) log.error('[founders] FOUNDERS=open but Stripe is not configured: seats stay closed');
  const confirmLimit = createLimiter({ max: 30, windowMs: 10 * MIN, now });
  const charge = licences ? createChargeContext({
    db, stripe, licences, store, now, log, publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', priceId: foundersPriceId(env, mode),
    outbox: createOutbox({ dir: env.FOUNDERS_OUTBOX_DIR || null, source: 'pay', now }),
  }) : null;
  // The pay webhook writes key emails to the outbox: say so loudly at start if it cannot.
  if (charge) {
    try { charge.outbox.check(); } catch (err) {
      log.error(`[founders] OUTBOX NOT WRITABLE (${charge.outbox.dir}): ${err.message}. Pay-link payments will fail and be retried until this is fixed (FOUNDERS_OUTBOX_DIR).`);
    }
  }
  const f = {
    cfg, store, stripe, mode, charge,
    // Seats can be saved right now: open, before the deadline, and not frozen for the
    // charge (migrations/022, read from the database every time).
    isOpen: (t = now()) => cfg.open && ready && t <= cfg.deadlineAt && !store.frozen(),
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
    if (founders.store.frozen()) return fail(res, 410, 'frozen', FROZEN_MESSAGE);
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

  // ---- charge day: the claim link, the pay link, the pay-link success page ----------
  // Same origin, JSON, at most 20 tries per 10 minutes per address. The tokens come in
  // the body (the page reads them from the URL fragment), never in a URL or a log line.
  const tokenLimit = createLimiter({ max: 20, windowMs: 10 * MIN, now });
  const charge = founders.charge;
  const lm = founders.store.livemode;
  const json = express.json({ limit: '1kb' });
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const gate = (req, res, { needsStripe = true } = {}) => {
    if (!sameOrigin(req, publicUrl)) { fail(res, 403, 'cross_origin', 'Open the link on bloombroke.com.'); return false; }
    if (!charge || (needsStripe && !founders.stripe)) { fail(res, 503, 'unavailable', 'This is taking a break. Try again in a minute.'); return false; }
    const r = tokenLimit.hit(clientIp(req));
    if (!r.ok) { res.set('Retry-After', String(r.retryAfter)); fail(res, 429, 'rate_limited', 'Too many tries. Wait a few minutes and try again.'); return false; }
    return true;
  };
  const LOST = `This link does not work. Email ${CONTACT}.`;
  const ENDED_LINK = `This link has run out. Email ${CONTACT}.`;
  const SEAT_PAID = 'This seat is paid. Check your email for the link to your key.';

  // POST /api/founders/claim { token } -> { key, seat }: a new Pro key for a charged seat,
  // each time (the old key stops). The link works CLAIM_MS from when it was made.
  app.post('/api/founders/claim', noStore, json, (req, res) => {
    if (!gate(req, res, { needsStripe: false })) return;
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!TOKEN_RE.test(token)) return fail(res, 400, 'bad_token', LOST);
    const row = founders.store.byClaimHash(tokenHash(token));
    if (!row || row.status !== 'committed' || row.charge_state !== 'charged' || row.livemode !== lm || !row.licence_id) return fail(res, 404, 'not_found', LOST);
    if (!(now() < row.claim_expires_at)) return fail(res, 410, 'expired', ENDED_LINK);
    const lic = charge.licences.findById(row.licence_id);
    if (!lic || isDeletedLicence(lic)) return fail(res, 410, 'deleted', `This seat's account was deleted. Email ${CONTACT}.`);
    const out = charge.licences.rotateKey(lic.id);
    res.json({ key: out.key, seat: row.seat, class: row.class });
  });

  // POST /api/founders/pay { token, peek? } -> { url } of a Stripe Checkout Session for a
  // seat whose card failed (reused while it is open), or with peek: { seat, class, usd,
  // payUntil } for the page, without a session.
  const paying = new Set();
  app.post('/api/founders/pay', noStore, json, async (req, res) => {
    if (!gate(req, res)) return;
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!TOKEN_RE.test(token)) return fail(res, 400, 'bad_token', LOST);
    const row = founders.store.byPayHash(tokenHash(token));
    // A charged seat keeps its pay hash (markCharged), so its pay link says it is paid.
    if (row && row.status === 'committed' && row.charge_state === 'charged' && row.livemode === lm) return fail(res, 409, 'paid', SEAT_PAID);
    if (!row || row.status !== 'committed' || row.charge_state !== 'failed' || row.livemode !== lm) return fail(res, 404, 'not_found', LOST);
    const t = now();
    if (!(row.pay_expires_at - t >= PAY_SESSION_MIN_MS)) return fail(res, 410, 'expired', ENDED_LINK);
    // payUntil: the last moment this route still opens a checkout (the page shows it).
    const info = { seat: row.seat, class: row.class, usd: CLASSES[row.class].usd, payUntil: new Date(row.pay_expires_at - PAY_SESSION_MIN_MS).toISOString() };
    if (req.body?.peek === true) return res.json(info);
    if (paying.has(row.seat)) return fail(res, 409, 'busy', 'Opening checkout. Try again in a moment.');
    paying.add(row.seat);
    try {
      if (row.pay_session_id) {
        const open = await founders.stripe.checkout.sessions.retrieve(row.pay_session_id);
        if (open?.status === 'complete') return fail(res, 409, 'paid', SEAT_PAID);
        if (open?.status === 'open' && open.expires_at * 1000 > t + MIN) return res.json({ ...info, url: open.url });
      }
      // The key names the minute and the params use the start of that minute, so a retry
      // within it gets the same session and a later one a new key (never the same key with
      // other params). A stray session is harmless: only the stored one is ever applied,
      // and a payment on any other is refunded.
      const minute = Math.floor(t / MIN) * MIN;
      const session = await founders.stripe.checkout.sessions.create(
        payCheckoutParams({ row, publicUrl: base, at: minute }),
        { idempotencyKey: `bb-founders-pay-${lm}-${row.seat}-${row.pay_hash.slice(0, 16)}-${row.pay_session_id || 'first'}-${minute / MIN}` },
      );
      if (!founders.store.setPaySession(row.seat, row.pay_hash, session.id)) return fail(res, 409, 'changed', LOST);
      res.json({ ...info, url: session.url });
    } catch (err) {
      log.error('[founders] pay', err?.message);
      fail(res, 503, 'unavailable', 'Checkout is taking a break. Try again in a minute.');
    } finally {
      paying.delete(row.seat);
    }
  });

  // POST /api/founders/paid { s, seat } -> { key, seat }: back from a paid pay-link
  // checkout. Once, within 24 hours of the payment, for that session only; a fresh key
  // (the claim email works too). If the webhook is late, the session is applied here.
  app.post('/api/founders/paid', noStore, json, async (req, res) => {
    if (!gate(req, res)) return;
    const s = typeof req.body?.s === 'string' ? req.body.s : '';
    const seat = Number(req.body?.seat);
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(s) || !isSeat(seat)) return fail(res, 400, 'bad_request', LOST);
    let row = founders.store.seat(seat);
    if (row && row.pay_session_id !== s) {
      // A paid session that is not the stored one (a stray second checkout, or paid after
      // the seat was charged or given back): the webhook refunds it in full. Say so.
      let other = null;
      try { other = await founders.stripe.checkout.sessions.retrieve(s); } catch { other = null; }
      if (isFoundersPaySession(other) && Number(other.metadata?.seat) === seat && payDecision(other, row, lm).action === 'refund') {
        return fail(res, 409, 'refunding', 'This payment was not needed and is being refunded in full. Check your email for the right link.');
      }
      return fail(res, 404, 'not_found', LOST);
    }
    if (!row || row.livemode !== lm || row.status !== 'committed') return fail(res, 404, 'not_found', LOST);
    if (row.charge_state === 'failed') {
      try {
        const session = await founders.stripe.checkout.sessions.retrieve(s);
        await applyPaySession(session, charge);
      } catch (err) {
        if (!(err instanceof NotYet)) log.error('[founders] paid', err?.message);
        return res.status(202).json({ pending: true });
      }
      row = founders.store.seat(seat);
    }
    if (row?.charge_state !== 'charged' || row.pay_session_id !== s) return res.status(202).json({ pending: true });
    const SHOWN = 'This key was shown once already. Use the link in your email.';
    if (row.pay_revealed_at || !(now() - row.charged_at < PAID_REVEAL_MS)) return fail(res, 410, 'shown', SHOWN);
    const lic = charge.licences.findById(row.licence_id);
    if (!lic || isDeletedLicence(lic)) return fail(res, 410, 'deleted', `This seat's account was deleted. Email ${CONTACT}.`);
    if (!founders.store.markRevealed(seat, s)) return fail(res, 410, 'shown', SHOWN);
    const out = charge.licences.rotateKey(lic.id);
    res.json({ key: out.key, seat });
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
