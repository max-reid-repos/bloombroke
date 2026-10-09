#!/usr/bin/env node
// ADMIN ONLY. The FOUNDERS SEATS table (pro/founders.js), on the server.
//
//   node scripts/founders.js list [--db path]           every seat, with its email: local only
//   node scripts/founders.js export [--db path]         the committed seats as CSV
//   node scripts/founders.js release <seat> [--execute] [--live] [--env path] [--db path]
//   node scripts/founders.js reset-test [--execute] [--db path]
//
// Charge day (migrations/022). Each is a dry run unless --execute; a live key needs --live too:
//   node scripts/founders.js charge [--execute] [--live] [--env path] [--db path] [--outbox dir]
//   node scripts/founders.js golive --date YYYY-MM-DD [--execute] [--live] [--env path] [--db path] [--outbox dir]
//   node scripts/founders.js reconcile [--execute] [--live] [--env path] [--db path] [--outbox dir]
//   node scripts/founders.js expire-unpaid [--execute] [--live] [--env path] [--db path] [--outbox dir]
//   node scripts/founders.js outbox [--take <file>] [--env path] [--outbox dir]
//
// release: a founder gave up the seat before the charge (by email). Dry run by default:
// it says what it would do. With --execute it takes the saved card off (detach, so it can
// never be charged), deletes the Stripe customer (only one tagged site=bloombroke,
// product=founders), puts the seat back to open with every private field cleared, and
// writes one public log line ("Seat 12 released Nov 3."). A seat being charged right now
// ('charging') is never released.
// reset-test: before live keys go in, every test-mode seat (livemode 0) back to open and
// the test log lines and test tips deleted. No Stripe calls (test objects stay in test
// mode). The server already ignores test rows with a live key; this clears them.
// A live key needs --live as well. The Stripe call carries an idempotency key, so a run
// that stops half way can be run again.
//
// charge: once the committed seats reach the goal, on or before the deadline, every seat
// of the key's mode is charged once, in seat order. --execute first freezes the seats
// (no new holds or commits, durable in the database), then waits for no checkout to be
// open. Per seat: the PaymentIntent is made unconfirmed and its id saved, then confirmed
// off-session. Paid: a Pro licence and a claim link (email in the outbox). Card failed: a
// 3-day pay link (email in the outbox). Anything else stops the whole run with nothing
// changed for that seat; run it again: a seat with a PaymentIntent is finished from it,
// never charged twice. After the deadline a run only finishes seats already 'charging':
// a PaymentIntent already paid or failed is recorded; one not yet confirmed is cancelled
// and its seat given back (Terms: no charge later than the deadline).
// golive: the day Pro goes live. Founder seats get their $420 yearly renewal, first billed
// one calendar year after that day; five-year seats end five years after it. One go-live
// email per seat goes into the outbox. Run again: done seats are skipped.
// reconcile: paid pay-link checkouts the database has not applied (a missed webhook) are
// applied, or refunded in full when late or mismatched.
// expire-unpaid: reconcile first; then every failed seat whose pay link ran out: card off,
// customer deleted, seat given back.
// outbox: the emails waiting to be sent, with every link token hidden. The outbox folder
// is --outbox, else FOUNDERS_OUTBOX_DIR in the .env, else /root/bb-outbox: outside the
// repo and outside the backups. --take <file> takes one file for sending (renamed to
// .sending-<file>, so nothing more is added to it); scripts/send-outbox.cjs sends that
// file; then delete it.
//
// The database is --db, else PRO_DB_PATH (from the environment or the .env next to
// server.js), else var/pro.db. The Stripe keys come from --env, else that .env.
// Every command needs migration 022 (start the server on this code once first).

import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dbPath } from './feedback-export.js';
import { createStripe, stripeEnv, idOf } from '../pro/billing.js';
import { createStore } from '../pro/store.js';
import {
  createFoundersStore, removeCustomer, CLASSES, isSeat, fmtUsd, fmtDay, fmtTime, foundersEnv, createChargeContext, createOutbox,
  markCharged, markFailed, goliveSeat, checkFoundersPrice, foundersPriceId, applyPaySession, payDecision, isFoundersPaySession,
  chargeDescription, seatCents, addYears, parseDay, redactTokens, OUTBOX_FILE_RE, TAKEN_PREFIX, DEFAULT_OUTBOX_DIR, FOUNDERS_METADATA, SITE, NotYet,
} from '../pro/founders.js';
import { randomBytes } from 'node:crypto';
import { csvField } from './waitlist.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const MIGRATION_022 = '022_founders_charge.sql';
const COMMANDS = ['list', 'export', 'release', 'reset-test', 'charge', 'golive', 'reconcile', 'expire-unpaid', 'outbox'];
const STRIPE_COMMANDS = new Set(['release', 'charge', 'golive', 'reconcile', 'expire-unpaid']);

// argv -> { cmd, seat, execute, live, db, env } (plus date, outbox when given) or { error }.
export function parseArgs(argv) {
  const out = { cmd: null, seat: null, execute: false, live: false, db: null, env: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') out.execute = true;
    else if (a === '--live') out.live = true;
    else if (a === '--db' || a === '--env' || a === '--outbox' || a === '--date' || a === '--take') {
      const v = argv[++i];
      if (!v) return { error: `${a} takes a ${a === '--date' ? 'day' : 'path'}` };
      out[a.slice(2)] = v;
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else if (!out.cmd) out.cmd = a;
    else if (out.cmd === 'release' && out.seat === null) {
      const n = Number(a);
      if (!isSeat(n)) return { error: 'release takes a seat number from 1 to 42' };
      out.seat = n;
    } else return { error: `unexpected ${a}` };
  }
  if (!COMMANDS.includes(out.cmd)) return { error: `say ${COMMANDS.slice(0, -1).join(', ')} or ${COMMANDS.at(-1)}` };
  if (out.cmd === 'release' && out.seat === null) return { error: 'release takes a seat number from 1 to 42' };
  if (out.cmd === 'golive' && parseDay(out.date) === null) return { error: 'golive takes --date YYYY-MM-DD' };
  if (out.date !== undefined && out.cmd !== 'golive') return { error: '--date is for golive only' };
  if (out.take !== undefined && out.cmd !== 'outbox') return { error: '--take is for outbox only' };
  return out;
}

// The database has the charge-day columns (migrations/022)?
export function hasMigration022(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()) return false;
  return Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(MIGRATION_022));
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : '');

export function listText(rows) {
  const lines = rows.map((r) => `${String(r.seat).padStart(2)}  ${r.class.padEnd(7)}  ${r.status.padEnd(9)}  ${r.email || ''}${r.handle ? `  @${r.handle}` : ''}${r.charge_state ? `  [${r.charge_state}]` : ''}`);
  const done = rows.filter((r) => r.status === 'committed');
  const usd = done.reduce((n, r) => n + CLASSES[r.class].usd, 0);
  return `${lines.join('\n')}\n\n${done.length} committed, ${fmtUsd(usd)}.\n`;
}

export function exportCsv(rows) {
  const out = ['seat,class,email,handle,stripe_customer_id,committed_at,mandate_ip,livemode'];
  for (const r of rows.filter((x) => x.status === 'committed')) {
    out.push([r.seat, r.class, r.email, r.handle, r.stripe_customer_id, iso(r.mandate_at), r.mandate_ip, r.livemode].map(csvField).join(','));
  }
  return `${out.join('\n')}\n`;
}

// release one seat. With execute false nothing changes. -> { done, text }.
export async function release({ db, stripe = null, seat, execute = false, now = () => Date.now() }) {
  const store = createFoundersStore(db, { now });
  const r = store.seat(seat);
  if (!r) return { done: false, text: `No seat ${seat}.` };
  if (r.status !== 'committed') return { done: false, text: `Seat ${seat} is ${r.status}: nothing to release.` };
  // A PaymentIntent is in flight: finish it first (charge), never drop it half way.
  if (r.charge_state === 'charging') return { done: false, text: `Seat ${seat} is being charged right now: run charge again to finish it first. Nothing changed.` };
  if (r.charge_state === 'charged' && execute && !stripe) return { done: false, text: 'No Stripe key: cannot remove the card. Nothing changed.' };
  const paid = r.charge_state === 'charged'
    ? ` Seat ${seat} was charged: release does NOT refund. Refund the payment in the Stripe dashboard. Its Pro licence ${execute ? 'is' : 'would be'} ended now.` : '';
  if (!execute) return { done: false, text: `Dry run: seat ${seat} (${r.class}) would be released, its card ${r.payment_method_id ? 'detached' : '(none on file)'} and its Stripe customer ${r.stripe_customer_id ? 'deleted' : '(none on file)'}, and the log would say it. Add --execute.${paid}` };
  let customer = 'none';
  if (r.payment_method_id || r.stripe_customer_id) {
    if (!stripe) return { done: false, text: 'No Stripe key: cannot remove the card. Nothing changed.' };
    try {
      await detachCard(stripe, r.payment_method_id);
      customer = await removeCustomer(stripe, r.stripe_customer_id, { requireTag: true });
    } catch (err) {
      return { done: false, text: `Stripe said: ${err.message}. Nothing changed here; run it again.` };
    }
  }
  // A charged seat's Pro licence ends in the same transaction ('canceled', ended now).
  const licences = r.licence_id ? createStore(db, { now }) : null;
  store.release(seat, { inside: (row) => { if (licences && row.licence_id && licences.findById(row.licence_id)) licences.setStatus(row.licence_id, 'canceled'); } });
  const note = customer === 'not_ours' ? ' The Stripe customer was not tagged as ours, so it was left: check it by hand.' : '';
  return { done: true, text: `Seat ${seat} released: card detached, customer ${customer === 'deleted' || customer === 'gone' ? 'deleted' : 'kept'}, seat open, log written.${note}${paid}` };
}

async function detachCard(stripe, pm) {
  if (!pm) return;
  try {
    await stripe.paymentMethods.detach(pm, {}, { idempotencyKey: `bb-founders-detach-${pm}` });
  } catch (err) {
    const gone = err?.statusCode === 404 || err?.code === 'resource_missing' || err?.code === 'payment_method_unexpected_state';
    if (!gone) throw err;
  }
}

// reset-test: the test-mode rows. -> { done, text }.
export function resetTest({ db, execute = false }) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM founders_seats WHERE livemode = 0').get().n;
  const t = db.prepare('SELECT COUNT(*) AS n FROM tips WHERE livemode = 0').get().n;
  if (!execute) return { done: false, text: `Dry run: ${n} test seats would go back to open and ${t} test tips would be deleted. Add --execute.` };
  const out = createFoundersStore(db).resetTest();
  return { done: true, text: `Reset: ${out.seats} test seats open, ${out.log} test log lines and ${out.tips} test tips deleted.` };
}

// ---- charge day ------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const modeName = (lm) => (lm ? 'live' : 'test');
// 'ann@example.com' -> 'a**@example.com'
export const maskEmail = (e) => {
  const [user, host] = String(e || '').split('@');
  if (!host) return '(no email)';
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(user.length - 1, 6)))}@${host}`;
};
// What Stripe said, for the owner: the error type and codes, never a token.
const errText = (err) => [err?.type, err?.code, err?.decline_code].filter(Boolean).join(' ') || String(err?.message || 'an unknown error').slice(0, 200);
const isCardError = (err) => err?.type === 'StripeCardError' || err?.rawType === 'card_error';

// Stops the whole run. The seat it names is left exactly as it was.
export class ChargeStop extends Error {}
const stop = (seat, msg) => new ChargeStop(`seat ${seat}: ${msg}`);

// The charge-day PaymentIntent of a seat: unconfirmed, cards only, off-session on confirm.
export function chargeParams(row) {
  return {
    amount: seatCents(row.seat),
    currency: 'usd',
    customer: row.stripe_customer_id,
    payment_method: row.payment_method_id,
    payment_method_types: ['card'],
    confirm: false,
    receipt_email: row.email,
    description: chargeDescription(row.seat),
    metadata: { ...FOUNDERS_METADATA, kind: 'charge', seat: String(row.seat), class: row.class, terms_version: String(row.terms_version || 'unknown') },
  };
}

// Is this PaymentIntent the seat's charge? Anything else stops the run.
function checkIntent(pi, row, lm) {
  const seat = row.seat;
  const pm = idOf(pi?.payment_method);
  if (!pi?.id || pi.metadata?.site !== SITE || pi.metadata?.product !== FOUNDERS_METADATA.product || pi.metadata?.kind !== 'charge' || pi.metadata?.seat !== String(seat)) throw stop(seat, 'the PaymentIntent is not this seat\'s charge');
  if (pi.amount !== seatCents(seat) || pi.currency !== 'usd') throw stop(seat, 'the PaymentIntent amount is not the class price');
  if (idOf(pi.customer) !== row.stripe_customer_id || (pm && pm !== row.payment_method_id)) throw stop(seat, 'the PaymentIntent is for another customer or card');
  if (typeof pi.livemode === 'boolean' && (pi.livemode ? 1 : 0) !== lm) throw stop(seat, 'the PaymentIntent is from the other Stripe mode');
}

// A PaymentIntent made for this seat before (its id was never saved: the run stopped
// between the two steps): found by its metadata, so no second one is made.
async function findSeatIntent(ctx, row) {
  const found = [];
  for await (const p of ctx.stripe.paymentIntents.list({ customer: row.stripe_customer_id, limit: 100 })) {
    if (p?.metadata?.site === SITE && p.metadata?.product === FOUNDERS_METADATA.product && p.metadata?.kind === 'charge' && p.metadata?.seat === String(row.seat) && p.status !== 'canceled') found.push(p);
  }
  if (found.length > 1) throw stop(row.seat, `${found.length} PaymentIntents exist for this seat: check them in the dashboard`);
  return found[0] || null;
}

const releaseCmd = (seat) => `node scripts/founders.js release ${seat} --execute --live`;

// A seat given back: card detached, Stripe customer deleted (only one tagged as ours),
// seat open with every private field cleared, one public log line. -> the customer result.
async function giveBack(ctx, row) {
  await detachCard(ctx.stripe, row.payment_method_id);
  const customer = await removeCustomer(ctx.stripe, row.stripe_customer_id, { requireTag: true });
  ctx.store.release(row.seat);
  return customer === 'not_ours' ? 'customer NOT deleted (not tagged as ours): delete it by hand' : 'customer deleted';
}

// A PaymentIntent that must never charge (a failed card, or after the deadline): cancelled
// at Stripe. Idempotent; one already cancelled is fine. Throws on other errors.
async function cancelIntent(stripe, piId) {
  try {
    await stripe.paymentIntents.cancel(piId, {}, { idempotencyKey: `bb-founders-cancel-${piId}` });
  } catch (err) {
    if (err?.code === 'payment_intent_unexpected_state' && err?.payment_intent?.status === 'canceled') return;
    throw err;
  }
}

// One seat, from where it is: NULL -> make the PaymentIntent, save it ('charging'), confirm;
// 'charging' -> read the stored one, confirm it if it still needs it. Then charged, failed,
// or a stop. After the deadline (afterDeadline) a PaymentIntent not confirmed yet is never
// confirmed: it is cancelled and the seat given back. runId: this run's own part of the
// confirm idempotency key (a replayed Stripe error must not block the seat for 24 hours).
// -> { result: 'charged' | 'failed' | 'released', note? }.
export async function chargeSeat(ctx, row, { afterDeadline = false, runId = randomBytes(6).toString('hex') } = {}) {
  const { stripe, store, lm } = ctx;
  const seat = row.seat;
  if (!row.stripe_customer_id || !row.payment_method_id || !row.email || !row.setup_intent_id) throw stop(seat, 'no customer, card, email or SetupIntent on file');
  // Before any Stripe call, so no PaymentIntent is ever made after the deadline.
  if (afterDeadline && row.charge_state === null) throw stop(seat, `after the deadline a seat is never started or charged: release it by hand (${releaseCmd(seat)})`);
  let pi;
  try {
    if (row.charge_state === null) {
      pi = await findSeatIntent(ctx, row);
      if (!pi) pi = await stripe.paymentIntents.create(chargeParams(row), { idempotencyKey: `bb-founders-pi-${lm}-${seat}-${row.setup_intent_id}` });
    } else {
      pi = await stripe.paymentIntents.retrieve(row.payment_intent_id);
    }
  } catch (err) {
    if (err instanceof ChargeStop) throw err;
    throw stop(seat, `Stripe said ${errText(err)}`);
  }
  checkIntent(pi, row, lm);
  // Terms: no charge later than the deadline. A PaymentIntent still waiting for its
  // confirm is cancelled, and the seat given back with its card deleted.
  if (afterDeadline && row.charge_state === 'charging' && (pi.status === 'requires_confirmation' || pi.status === 'canceled')) {
    if (pi.status !== 'canceled') {
      try {
        await cancelIntent(stripe, pi.id);
      } catch (err) {
        // Not cancelled (it may have been paid meanwhile): nothing is given back.
        throw stop(seat, `after the deadline, cancelling its PaymentIntent failed: Stripe said ${errText(err)}. The seat stays 'charging' and is not given back; check the PaymentIntent in the dashboard, then run charge again`);
      }
    }
    let given;
    try {
      given = await giveBack(ctx, row);
    } catch (err) {
      throw stop(seat, `after the deadline its PaymentIntent is cancelled (nothing charged), but giving the seat back failed: Stripe said ${errText(err)}. Run charge again to finish giving it back`);
    }
    return { result: 'released', note: ` (after the deadline: not charged, PaymentIntent cancelled, ${given})` };
  }
  // Step 1 done: the id is in the database before anything can charge.
  if (row.charge_state === null && !store.startCharging(seat, pi.id)) throw stop(seat, 'the seat changed during the run');
  let failCode = null;
  if (pi.status === 'requires_confirmation') {
    try {
      pi = await stripe.paymentIntents.confirm(pi.id, { off_session: true }, { idempotencyKey: `bb-founders-confirm-${pi.id}-${runId}` });
    } catch (err) {
      const p = err?.payment_intent;
      if (!isCardError(err) || !p || p.id !== pi.id) throw stop(seat, `Stripe said ${errText(err)}. The seat stays 'charging': run charge again`);
      pi = p;
      failCode = err.decline_code || err.code || null;
    }
  }
  // Saving (the database and the outbox, one transaction) failed: nothing is saved, the
  // seat stays 'charging', and the next run finishes it from the PaymentIntent.
  const save = (fn) => { try { return fn(); } catch (err) { throw stop(seat, `Stripe says ${pi.status}, but saving failed (${err.message}). The seat stays 'charging': fix it, then run charge again`); } };
  if (pi.status === 'succeeded') {
    const out = save(() => markCharged(ctx, { seat, from: 'charging', paymentIntentId: pi.id }));
    if (out.conflict) throw stop(seat, 'paid at Stripe, but the seat changed in the database: check it by hand');
    let note = '';
    if (Number.isFinite(store.state().golive_at)) {
      try { note = ` (go-live: ${await goliveSeat(ctx, seat)})`; } catch (err) { note = ` (paid, but its go-live step failed: ${errText(err)}; run golive again)`; }
    }
    return { result: 'charged', note };
  }
  if (pi.status === 'requires_payment_method' || pi.status === 'requires_action') {
    const code = failCode || pi.last_payment_error?.decline_code || pi.last_payment_error?.code || pi.status;
    if (!save(() => markFailed(ctx, { seat, paymentIntentId: pi.id, failCode: code }))) throw stop(seat, 'the card failed, but the seat changed in the database: check it by hand');
    // That PaymentIntent can never charge now: the pay link makes its own.
    let cancelled = 'PaymentIntent cancelled';
    try { await cancelIntent(stripe, pi.id); } catch (err) { cancelled = `PaymentIntent NOT cancelled (${errText(err)}): cancel it in the dashboard`; }
    return { result: 'failed', note: ` (${String(code).replace(/[^A-Za-z0-9_]/g, '')}; ${cancelled})` };
  }
  throw stop(seat, `the payment is ${pi.status}. The seat stays 'charging': run charge again later`);
}

// The card on file, for the dry run: 'visa 4242, exp 12/2027' (+ a warning when expired).
async function cardText(stripe, pmId, t) {
  if (!stripe) return 'card: (no Stripe key)';
  if (!pmId) return 'card: NONE ON FILE';
  try {
    const pm = await stripe.paymentMethods.retrieve(pmId);
    const c = pm?.card;
    if (!c) return 'card: not a card';
    const expired = Date.UTC(c.exp_year, c.exp_month, 1) <= t; // valid to the end of its month
    return `card: ${c.brand} ${c.last4}, exp ${String(c.exp_month).padStart(2, '0')}/${c.exp_year}${expired ? '  WARNING: EXPIRED' : ''}`;
  } catch (err) {
    return `card: could not read (${errText(err)})`;
  }
}

// After the deadline: the seats never started, by number, and what to do with them.
const neverStarted = (rows) => `After the deadline these seats are never charged: ${rows.map((r) => r.seat).join(', ')}. Release them by hand: ${rows.map((r) => releaseCmd(r.seat)).join('; ')}`;

export const CHECKLIST = [
  'Before --execute (live):',
  '  1. Stripe, Settings, Billing, Customer portal (default): cancel only, at period end; switching plans OFF; changing quantity OFF.',
  '  2. Stripe, Settings, Customer emails: "Successful payments" ON (Stripe sends the receipts).',
  '  3. The restricted live key has Refunds (write) and Billing Portal / Customer portal (write), on top of what it has.',
  '  4. The app can write FOUNDERS_OUTBOX_DIR (default /root/bb-outbox); its start log has no "OUTBOX NOT WRITABLE".',
  '  5. After scripts/stripe-setup.js writes STRIPE_FOUNDERS_PRICE_ID, restart the app so it reads it.',
  '  6. Never run two charge runs at once.',
];

// charge (see the top of this file). -> { code: 0 done | 1 refused | 2 stopped }.
export async function charge({ ctx, cfg, execute = false, print = console.log }) {
  const { store, stripe, now, lm } = ctx;
  const t = now();
  const rows = store.committedHere();
  const total = rows.reduce((n, r) => n + CLASSES[r.class].usd, 0);
  const toStart = rows.filter((r) => r.charge_state === null);
  const toFinish = rows.filter((r) => r.charge_state === 'charging');
  const after = t > cfg.deadlineAt;
  const below = total < cfg.goalUsd;
  const st = store.state();
  print(`Founders charge, ${modeName(lm)} mode${execute ? '' : ' (dry run)'}.`);
  print(`Committed: ${fmtUsd(total)} of the ${fmtUsd(cfg.goalUsd)} goal, ${rows.length} seats. Deadline: ${fmtDay(cfg.deadlineAt)} (end of day UTC)${after ? ', PASSED' : ''}.`);
  print(`Seats ${st.frozen_at ? `frozen since ${iso(st.frozen_at)}` : 'not frozen yet'}; ${store.openHolds(t)} checkouts open.`);
  for (const o of store.committedOther()) print(`seat ${o.seat}: refused, its mode (${o.livemode === null ? 'unknown' : modeName(o.livemode)}) is not this key's.`);
  const canStart = !after && !below;
  const work = rows.filter((r) => r.charge_state === 'charging' || (canStart && r.charge_state === null));
  if (!execute) {
    for (const r of rows) {
      const card = r.charge_state === null || r.charge_state === 'charging' ? `  ${await cardText(stripe, r.payment_method_id, t)}` : '';
      print(`seat ${String(r.seat).padStart(2)}  ${CLASSES[r.class].name.padEnd(14)} ${fmtUsd(CLASSES[r.class].usd).padStart(6)}  ${maskEmail(r.email)}  ${r.charge_state || 'to charge'}${card}`);
    }
    if (!canStart && toStart.length) print(after ? neverStarted(toStart) : 'Below the goal: no seat would be charged.');
    print(`Would charge ${work.length} seats.`);
    for (const line of CHECKLIST) print(line);
    print('Add --execute to charge.');
    return { code: 0 };
  }
  if (!work.length) {
    if (after && toStart.length) print(neverStarted(toStart));
    print(after ? 'After the deadline: nothing is being charged, so nothing to finish. Nothing changed.'
      : below ? 'Below the goal: nothing is charged. Nothing changed.' : 'Nothing to charge. Nothing changed.');
    return { code: toStart.length || below || after ? 1 : 0 };
  }
  try { ctx.outbox.check(); } catch (err) { print(`The outbox does not work: ${err.message}. Nothing changed.`); return { code: 1 }; }
  // Freeze first (durable), then no checkout may still be open.
  store.freeze(t);
  const holds = store.openHolds(now());
  if (holds) {
    print(`Seats are frozen now. ${holds} checkout${holds === 1 ? ' is' : 's are'} still open: wait up to 33 minutes for ${holds === 1 ? 'it' : 'them'} to end, then run charge --execute again. Nothing charged.`);
    return { code: 1 };
  }
  store.chargeStarted(t);
  const counts = { charged: 0, failed: 0, released: 0 };
  const runId = randomBytes(6).toString('hex');
  for (const r of work) {
    try {
      const out = await chargeSeat(ctx, store.seat(r.seat), { afterDeadline: now() > cfg.deadlineAt, runId });
      counts[out.result] += 1;
      print(`seat ${r.seat}: ${out.result}${out.note || ''}`);
    } catch (err) {
      if (!(err instanceof ChargeStop)) throw err;
      print(`STOP. ${err.message}. Nothing more was charged in this run.${now() > cfg.deadlineAt ? '' : ' Fix it, then run charge --execute again.'}`);
      print(`This run: ${counts.charged} charged, ${counts.failed} failed. The emails so far are in the outbox.`);
      return { code: 2 };
    }
  }
  if (after && toStart.length) print(neverStarted(toStart));
  print(`Done: ${counts.charged} charged, ${counts.failed} failed${counts.released ? `, ${counts.released} given back (after the deadline, not charged)` : ''}. Emails are in ${ctx.outbox.dir}: read them with "founders.js outbox".`);
  return { code: 0 };
}

// golive (see the top of this file). -> { code }.
export async function golive({ ctx, date, execute = false, print = console.log }) {
  const { store, stripe, now, lm } = ctx;
  const at = parseDay(date);
  if (at === null) { print('golive takes --date YYYY-MM-DD.'); return { code: 1 }; }
  const st = store.state();
  if (Number.isFinite(st.golive_at) && st.golive_at !== at) { print(`Go-live is already ${fmtDay(st.golive_at)}. Nothing changed.`); return { code: 1 }; }
  if (addYears(at, 1) <= now()) { print('That day is over a year ago: the renewal date would be past. Nothing changed.'); return { code: 1 }; }
  // Stripe refuses a renewal anchor later than the natural next billing date (a year from
  // the day the subscription is made), so go-live is today or a day already past.
  const today = parseDay(new Date(now()).toISOString().slice(0, 10));
  if (at > today) { print(`Go-live cannot be a future day: run golive on ${fmtDay(at)} or later. Nothing changed.`); return { code: 1 }; }
  const rows = store.committedHere().filter((r) => r.charge_state === 'charged');
  const needSubs = rows.some((r) => r.class === 'founder' && !r.subscription_id);
  print(`Founders go-live ${fmtDay(at)}, ${modeName(lm)} mode${execute ? '' : ' (dry run)'}: ${rows.length} charged seats.`);
  if (needSubs) {
    if (!stripe) { print('No Stripe key. Nothing changed.'); return { code: 1 }; }
    const err = await checkFoundersPrice(stripe, ctx.priceId, lm);
    if (err) { print(`Refused: ${err}. Nothing changed.`); return { code: 1 }; }
  }
  const waiting = store.committedHere().filter((r) => r.charge_state === 'failed' || r.charge_state === 'charging').length;
  if (waiting) print(`${waiting} seats are not paid yet (failed or charging): each gets its go-live step when it is paid.`);
  if (!execute) {
    for (const r of rows) {
      const lic = ctx.licences.findById(r.licence_id);
      const what = r.class === 'ten'
        ? (Number.isFinite(lic?.term_ends_at) ? 'done' : `Pro until ${fmtDay(addYears(at, 5))}`)
        : (r.subscription_id ? 'done' : `renewal ${fmtUsd(CLASSES.founder.usd)} on ${fmtDay(addYears(at, 1))}`);
      print(`seat ${String(r.seat).padStart(2)}  ${CLASSES[r.class].name.padEnd(14)} ${maskEmail(r.email)}  ${what}`);
    }
    print('Add --execute to save the day, make the renewals and write the go-live emails.');
    return { code: 0 };
  }
  try { ctx.outbox.check(); } catch (err) { print(`The outbox does not work: ${err.message}. Nothing changed.`); return { code: 1 }; }
  if (!store.setGolive(at)) { print('Go-live was set to another day meanwhile. Nothing changed.'); return { code: 1 }; }
  // Read again after saving the day: a seat paid by link meanwhile gets its step too.
  for (const r of store.committedHere().filter((x) => x.charge_state === 'charged')) {
    let out;
    try {
      out = await goliveSeat(ctx, r.seat, { email: true });
    } catch (err) {
      print(`STOP. seat ${r.seat}: ${errText(err)}. Nothing changed for that seat. Run golive --execute again.`);
      return { code: 2 };
    }
    print(`seat ${r.seat}: ${out === 'deleted' ? 'account deleted, no renewal made' : out}`);
  }
  print(`Done. Go-live emails are in ${ctx.outbox.dir}: read them with "founders.js outbox".`);
  return { code: 0 };
}

// reconcile (see the top of this file). -> { code, applied }.
export async function reconcile({ ctx, execute = false, print = console.log }) {
  const { store, stripe, lm } = ctx;
  const st = store.state();
  if (!Number.isFinite(st.charge_started_at)) { print('No charge run yet, so no pay links: nothing to reconcile.'); return { code: 0, applied: 0 }; }
  if (!stripe) { print('No Stripe key. Nothing changed.'); return { code: 1, applied: 0 }; }
  const since = Math.floor((st.charge_started_at - DAY) / 1000);
  let applied = 0;
  for await (const s of stripe.checkout.sessions.list({ status: 'complete', created: { gte: since }, limit: 100 })) {
    if (Number.isFinite(s?.created) && s.created < since) break;
    if (!isFoundersPaySession(s) || s.payment_status !== 'paid') continue;
    const seat = Number(s.metadata?.seat);
    const d = payDecision(s, isSeat(seat) ? store.seat(seat) : null, lm);
    if (d.action === 'already' || d.action === 'pending') continue;
    if (d.action === 'wrong_mode') { print(`seat ${seat}: a pay session of the other mode: left alone.`); continue; }
    if (d.action === 'refund') {
      const pi = await stripe.paymentIntents.retrieve(idOf(s.payment_intent), { expand: ['latest_charge'] });
      if (pi?.latest_charge?.refunded) continue;
    }
    const label = d.action === 'apply' ? 'paid by link, not applied yet' : `paid by link, late or mismatched (${d.why}): refund in full`;
    if (!execute) { print(`seat ${seat}: ${label}.`); applied += 1; continue; }
    const r = await applyPaySession(s, ctx);
    print(`seat ${seat}: ${label}: ${r}.`);
    applied += 1;
  }
  print(applied ? `${applied} pay-link payments ${execute ? 'handled' : 'to handle (add --execute)'}.` : 'Every paid pay link is applied.');
  return { code: 0, applied };
}

// expire-unpaid (see the top of this file). -> { code }.
export async function expireUnpaid({ ctx, execute = false, print = console.log }) {
  const { store, stripe, now } = ctx;
  if (!stripe) { print('No Stripe key. Nothing changed.'); return { code: 1 }; }
  // The charge run must be finished first: no seat of this mode may still be waiting
  // (NULL) or 'charging'.
  if (Number.isFinite(store.state().charge_started_at)) {
    const open = store.committedHere().filter((r) => r.charge_state === null || r.charge_state === 'charging').map((r) => r.seat);
    if (open.length) {
      const what = now() > ctx.store.deadlineAt
        ? `After the deadline ${open.length === 1 ? 'it is' : 'they are'} never charged: run charge --execute once to finish any 'charging' seat, and release the rest by hand (${open.map(releaseCmd).join('; ')})`
        : `Run charge --execute again first, or release ${open.length === 1 ? 'that seat' : 'those seats'}`;
      print(`Refused: the charge run is not finished (seat${open.length === 1 ? '' : 's'} ${open.join(', ')} not charged yet). ${what}. Nothing changed.`);
      return { code: 1 };
    }
  }
  try {
    const r = await reconcile({ ctx, execute, print });
    if (r.code) return r;
  } catch (err) {
    print(`STOP. Reconcile: ${errText(err)}. Nothing given back. Run it again.`);
    return { code: 2 };
  }
  const t = now();
  const rows = store.committedHere().filter((r) => (r.charge_state === 'failed' && r.pay_expires_at <= t) || r.charge_state === 'unpaid');
  if (!rows.length) { print('No pay link has run out.'); return { code: 0 }; }
  for (const r of rows) {
    try {
      if (r.charge_state === 'failed' && r.pay_session_id) {
        const s = await stripe.checkout.sessions.retrieve(r.pay_session_id);
        if (s?.status === 'open') { print(`seat ${r.seat}: its checkout is still open: run again after it ends.`); continue; }
        if (s?.status === 'complete' && s.payment_status === 'paid') {
          if (!execute) { print(`seat ${r.seat}: paid by link: it would be applied, not given back.`); continue; }
          print(`seat ${r.seat}: paid by link: ${await applyPaySession(s, ctx)}.`);
          continue;
        }
      }
      if (!execute) { print(`seat ${r.seat}: pay link ran out ${iso(r.pay_expires_at)}: card off, customer deleted, seat given back.`); continue; }
      // 'unpaid' first: from here a late pay-link payment is refunded, never applied.
      if (r.charge_state === 'failed' && !store.markUnpaid(r.seat)) { print(`seat ${r.seat}: changed meanwhile, left alone.`); continue; }
      print(`seat ${r.seat}: given back, card off, ${await giveBack(ctx, r)}.`);
    } catch (err) {
      if (err instanceof NotYet) { print(`seat ${r.seat}: busy, run again.`); continue; }
      print(`STOP. seat ${r.seat}: Stripe said ${errText(err)}. Run expire-unpaid again.`);
      return { code: 2 };
    }
  }
  if (!execute) print('Add --execute to give these seats back.');
  return { code: 0 };
}

// outbox --take <file>: renamed to .sending-<file> under the outbox lock, so the app and
// the scripts start a new file and nothing is added to the one being sent. -> its path.
export const takeOutboxFile = (dir, name) => createOutbox({ dir, source: 'take' }).take(name);

// outbox: the waiting emails (and any taken for sending), every link token hidden.
export function outboxPreview(dir) {
  if (!existsSync(dir)) return `No outbox at ${dir}.\n`;
  const files = readdirSync(dir).filter((f) => OUTBOX_FILE_RE.test(f) || (f.startsWith(TAKEN_PREFIX) && OUTBOX_FILE_RE.test(f.slice(TAKEN_PREFIX.length)))).sort();
  if (!files.length) return `The outbox at ${dir} is empty.\n`;
  const out = [];
  for (const f of files) {
    let list;
    try { list = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { out.push(`${f}: cannot be read`); continue; }
    if (!Array.isArray(list)) { out.push(`${f}: not a list`); continue; }
    out.push(`${path.join(dir, f)}: ${list.length} email${list.length === 1 ? '' : 's'}${f.startsWith(TAKEN_PREFIX) ? ' (taken: being sent)' : ''}`);
    for (const e of list) out.push(`\n--- ${e.kind}, seat ${e.seat}, to ${e.to}\nSubject: ${e.subject}\n\n${redactTokens(e.text)}\n`);
  }
  return `${out.join('\n')}\n`;
}

function readEnv(file) {
  const f = path.resolve(file || path.join(ROOT, '.env'));
  return existsSync(f) ? parseEnv(readFileSync(f, 'utf8')) : {};
}

const USAGE = `Usage: node scripts/founders.js list|export [--db path]
       node scripts/founders.js release <seat> [--execute] [--live] [--env path] [--db path]
       node scripts/founders.js reset-test [--execute] [--db path]
       node scripts/founders.js charge [--execute] [--live] [--env path] [--db path] [--outbox dir]
       node scripts/founders.js golive --date YYYY-MM-DD [--execute] [--live] [--env path] [--db path] [--outbox dir]
       node scripts/founders.js reconcile|expire-unpaid [--execute] [--live] [--env path] [--db path] [--outbox dir]
       node scripts/founders.js outbox [--take <file>] [--env path] [--outbox dir]`;

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error);
    console.error(USAGE);
    return 1;
  }
  if (args.cmd === 'outbox') {
    const env = readEnv(args.env);
    const dir = path.resolve(args.outbox || env.FOUNDERS_OUTBOX_DIR || DEFAULT_OUTBOX_DIR);
    if (args.take) {
      try { console.log(`Taken: ${takeOutboxFile(dir, args.take)}. Send that file with scripts/send-outbox.cjs, then delete it here.`); } catch (err) { console.error(err.message); return 1; }
      return 0;
    }
    process.stdout.write(outboxPreview(dir));
    return 0;
  }
  const file = dbPath(args.db);
  if (!existsSync(file)) { console.error(`No database at ${file}.`); return 1; }
  const write = args.execute && args.cmd !== 'list' && args.cmd !== 'export';
  const db = new Database(file, { readonly: !write, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    if (!hasMigration022(db)) { console.error(`The database has no migration ${MIGRATION_022} yet: start the server on this code once first. Nothing changed.`); return 1; }
    // Read-only: a hold that ran out still says held here (the server opens it on its next read).
    if (args.cmd === 'list') { process.stdout.write(listText(db.prepare('SELECT * FROM founders_seats ORDER BY seat').all())); return 0; }
    if (args.cmd === 'export') { process.stdout.write(exportCsv(db.prepare('SELECT * FROM founders_seats ORDER BY seat').all())); return 0; }
    if (args.cmd === 'reset-test') {
      const r = resetTest({ db, execute: args.execute });
      console.log(r.text);
      return 0;
    }
    let stripe = null;
    let env = {};
    let se = null;
    if (write || STRIPE_COMMANDS.has(args.cmd) && args.cmd !== 'release') {
      env = readEnv(args.env);
      se = stripeEnv(env);
      if (se.error) { console.error(se.error); return 1; }
      if (args.execute && se.mode === 'live' && !args.live) { console.error(`This is a live key. Add --live to really ${args.cmd === 'release' ? 'detach the card' : 'do it'}.`); return 1; }
      stripe = se.secretKey ? createStripe(se.secretKey) : null;
    }
    if (args.cmd === 'release') {
      const out = await release({ db, stripe, seat: args.seat, execute: args.execute });
      console.log(out.text);
      return out.done || !args.execute ? 0 : 2;
    }
    const cfg = foundersEnv(env);
    const ctx = createChargeContext({
      db, stripe, licences: createStore(db), livemode: se.mode === 'live' ? 1 : 0, deadlineAt: cfg.deadlineAt,
      publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', priceId: foundersPriceId(env, se.mode),
      outbox: createOutbox({ dir: args.outbox || env.FOUNDERS_OUTBOX_DIR || null, source: args.cmd === 'expire-unpaid' ? 'expire' : args.cmd }),
    });
    const run = { charge: () => charge({ ctx, cfg, execute: args.execute }), golive: () => golive({ ctx, date: args.date, execute: args.execute }),
      reconcile: () => reconcile({ ctx, execute: args.execute }), 'expire-unpaid': () => expireUnpaid({ ctx, execute: args.execute }) }[args.cmd];
    return (await run()).code;
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error('founders failed:', err.message);
    process.exitCode = 1;
  });
}
