// FOUNDERS SEATS charge day (pro/founders.js charge-day section, scripts/founders.js
// charge | golive | reconcile | expire-unpaid | outbox, scripts/send-outbox.cjs,
// migrations/022): the two-step charge, fail-closed stops, resume, the freeze, the pay
// link and its webhook guards, the claim, go-live, term licences, the outbox.
// Stripe is an in-memory fake (real webhook signing); nothing here talks to Stripe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Stripe from 'stripe';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, copyFileSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../pro/db.js';
import { createStore, UNCLAIMED_PREFIX } from '../pro/store.js';
import { revealKeyFrom, proAccess, hashKey } from '../pro/licence.js';
import { STRIPE_API_VERSION } from '../pro/billing.js';
import { mountPro, publicStatus } from '../pro/routes.js';
import { willRenew } from '../pro/me-routes.js';
import {
  createFounders, createFoundersStore, mountFounders, handleFoundersEvent, createChargeContext, createOutbox, tokenHash,
  CLAIM_MS, PAY_WINDOW_MS, EMAIL_KINDS, addYears, redactTokens, payCheckoutParams, FOUNDERS_PRICE,
  chargeEmail, failedEmail, keyEmail, goliveEmail, HOLD_MS,
} from '../pro/founders.js';
import * as script from '../scripts/founders.js';
import { setupFounders } from '../scripts/stripe-setup.js';

const require = createRequire(import.meta.url);
const sender = require('../scripts/send-outbox.cjs');

const SECRET = 'whsec_test_dummy_secret_for_unit_tests';
const AES = revealKeyFrom('x'.repeat(40));
const T0 = Date.UTC(2026, 11, 1, 12); // Dec 1, 2026, before the Dec 15 deadline
const DEADLINE = Date.UTC(2026, 11, 15, 23, 59, 59, 999);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const quiet = { log() {}, error() {} };
const ORIGIN = { Origin: 'https://bloombroke.com' };
const PRICE = 'price_founders_yearly';
// Go-live is today or a past day (Stripe's anchor rule): the day after charge day here.
const GOLIVE = Date.UTC(2026, 11, 2);
const GOLIVE_DAY = '2026-12-02';
const AFTER_GOLIVE = GOLIVE + 12 * HOUR;

// ---- the fake Stripe ------------------------------------------------------------------------

function fakeStripe({ live = true, now = () => Date.now() } = {}) {
  const real = new Stripe('sk_test_dummy', { apiVersion: STRIPE_API_VERSION });
  const pis = {};
  const sessions = {};
  const subs = {};
  const refundLog = [];
  const calls = [];
  const idem = new Map();
  const tags = {};
  // What a card does when confirmed: ok | decline | auth | action | processing | apierror | network.
  const cards = {};
  const priceData = { [PRICE]: { id: PRICE, active: true, unit_amount: 42000, currency: 'usd', recurring: { interval: 'year', interval_count: 1 }, metadata: { site: 'bloombroke', product: 'founders' }, livemode: live } };
  let n = 0;
  const id = (p) => `${p}_${String(++n).padStart(12, '0')}`;
  const missing = () => Object.assign(new Error('No such object'), { statusCode: 404, code: 'resource_missing' });
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const gen = (rows) => (async function* () { for (const r of rows) yield copy(r); })();
  // Like Stripe: the same key with other params is an error, never a second object.
  const once = (opts, p, make) => {
    const k = opts?.idempotencyKey;
    const params = JSON.stringify(p);
    if (k && idem.has(k)) {
      const seen = idem.get(k);
      if (seen.params !== params) throw new Stripe.errors.StripeIdempotencyError({ message: 'Keys for idempotent requests can only be used with the same parameters', type: 'idempotency_error' });
      return copy(seen.o);
    }
    const o = make();
    if (k) idem.set(k, { params, o });
    return copy(o);
  };
  const hooks = {};
  return {
    pis, sessions, subs, refundLog, calls, cards, priceData, hooks, tags,
    webhooks: real.webhooks,
    paymentIntents: {
      async create(p, opts) {
        calls.push(['pi.create', p, opts]);
        if (hooks.piCreate) hooks.piCreate(p);
        return once(opts, p, () => {
          const o = { id: id('pi'), object: 'payment_intent', status: 'requires_confirmation', amount: p.amount, currency: p.currency, customer: p.customer,
            payment_method: p.payment_method, metadata: p.metadata, livemode: live, receipt_email: p.receipt_email, description: p.description };
          pis[o.id] = o;
          return o;
        });
      },
      async retrieve(pid, p) {
        calls.push(['pi.retrieve', pid, p]);
        if (hooks.piRetrieve) await hooks.piRetrieve(pid);
        if (!pis[pid]) throw missing();
        const o = copy(pis[pid]);
        if (p?.expand?.includes('latest_charge')) o.latest_charge = { refunded: Boolean(pis[pid].refunded) };
        if (p?.expand?.includes('payment_method') && o.payment_method) o.payment_method = { id: o.payment_method, card: { fingerprint: `fp_${o.payment_method}` } };
        return o;
      },
      async confirm(pid, p, opts) {
        calls.push(['pi.confirm', pid, p, opts]);
        if (hooks.confirm) hooks.confirm(pid);
        const pi = pis[pid];
        if (pi.status !== 'requires_confirmation') {
          throw new Stripe.errors.StripeInvalidRequestError({ message: 'unexpected state', type: 'invalid_request_error', code: 'payment_intent_unexpected_state', payment_intent: copy(pi) });
        }
        const how = cards[pi.payment_method] || 'ok';
        if (how === 'network') throw new Stripe.errors.StripeConnectionError({ message: 'socket hang up' });
        if (how === 'apierror') throw new Stripe.errors.StripeAPIError({ message: 'something broke', type: 'api_error' });
        if (how === 'ratelimit') throw new Stripe.errors.StripeRateLimitError({ message: 'slow down', code: 'rate_limit' });
        if (how === 'ok') { Object.assign(pi, { status: 'succeeded', amount_received: pi.amount }); return copy(pi); }
        if (how === 'action') { pi.status = 'requires_action'; return copy(pi); }
        if (how === 'processing') { pi.status = 'processing'; return copy(pi); }
        const code = how === 'auth' ? 'authentication_required' : 'card_declined';
        const decline = how === 'auth' ? 'authentication_required' : 'generic_decline';
        Object.assign(pi, { status: 'requires_payment_method', payment_method: null, last_payment_error: { code, decline_code: decline } });
        throw new Stripe.errors.StripeCardError({ message: 'Your card was declined.', type: 'card_error', code, decline_code: decline, payment_intent: copy(pi) });
      },
      list({ customer }) { calls.push(['pi.list', customer]); return gen(Object.values(pis).filter((p) => p.customer === customer)); },
      async cancel(pid, p, opts) {
        calls.push(['pi.cancel', pid, opts]);
        if (hooks.cancel) hooks.cancel(pid);
        const pi = pis[pid];
        if (!['requires_confirmation', 'requires_payment_method', 'requires_action'].includes(pi.status)) {
          throw new Stripe.errors.StripeInvalidRequestError({ message: 'unexpected state', type: 'invalid_request_error', code: 'payment_intent_unexpected_state', payment_intent: copy(pi) });
        }
        pi.status = 'canceled';
        return copy(pi);
      },
    },
    paymentMethods: {
      async retrieve(pm) { calls.push(['pm.retrieve', pm]); return { id: pm, card: pm === 'pm_old' ? { brand: 'visa', last4: '0002', exp_month: 1, exp_year: 2025 } : { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } }; },
      async detach(pm, p, opts) { calls.push(['pm.detach', pm, opts]); return { id: pm }; },
      async update(pm, p, opts) { calls.push(['pm.update', pm, p, opts]); return { id: pm }; },
    },
    customers: {
      async retrieve(c) { calls.push(['customer.retrieve', c]); return { id: c, metadata: tags[c] || { site: 'bloombroke', product: 'founders' } }; },
      async del(c, p, opts) { calls.push(['customer.del', c, opts]); return { id: c, deleted: true }; },
      async update(c, p, opts) { calls.push(['customer.update', c, p, opts]); tags[c] = p.metadata; return { id: c }; },
    },
    checkout: {
      sessions: {
        async create(p, opts) {
          calls.push(['checkout.create', p, opts]);
          return once(opts, p, () => {
            const sid = `cs_${live ? 'live' : 'test'}_pay${String(++n).padStart(12, '0')}`;
            const o = { id: sid, object: 'checkout.session', mode: p.mode, status: 'open', metadata: p.metadata, url: `https://checkout.stripe.com/c/pay/${sid}`,
              expires_at: p.expires_at, customer: p.customer, livemode: live, created: Math.floor(now() / 1000), currency: 'usd', amount_total: p.line_items?.[0]?.price_data?.unit_amount ?? null };
            sessions[sid] = o;
            return o;
          });
        },
        async retrieve(sid) { calls.push(['checkout.retrieve', sid]); if (!sessions[sid]) throw missing(); return copy(sessions[sid]); },
        async expire(sid) { calls.push(['checkout.expire', sid]); sessions[sid].status = 'expired'; return copy(sessions[sid]); },
        list(p) { calls.push(['checkout.list', p]); return gen(Object.values(sessions).filter((s) => !p?.status || s.status === p.status).reverse()); },
      },
    },
    subscriptions: {
      list({ customer }) { calls.push(['sub.list', customer]); return gen(Object.values(subs).filter((s) => s.customer === customer)); },
      async create(p, opts) {
        calls.push(['sub.create', p, opts]);
        return once(opts, p, () => {
          const o = { id: id('sub'), object: 'subscription', status: 'active', customer: p.customer, metadata: p.metadata, cancel_at_period_end: false, cancel_at: null, livemode: live,
            items: { data: [{ price: { id: p.items[0].price, recurring: { interval: 'year', interval_count: 1 } }, current_period_end: p.billing_cycle_anchor }] } };
          subs[o.id] = o;
          return o;
        });
      },
      async retrieve(sid) { calls.push(['sub.retrieve', sid]); if (!subs[sid]) throw missing(); return copy(subs[sid]); },
    },
    prices: { async retrieve(pid) { calls.push(['price.retrieve', pid]); if (!priceData[pid]) throw missing(); return copy(priceData[pid]); } },
    refunds: {
      async create(p, opts) {
        calls.push(['refund.create', p, opts]);
        const pi = pis[p.payment_intent];
        if (pi?.refunded) throw Object.assign(new Error('already refunded'), { code: 'charge_already_refunded' });
        if (pi) pi.refunded = true;
        refundLog.push({ p, opts });
        return { id: id('re'), status: 'succeeded' };
      },
    },
  };
}

// A seat with a saved card, as commitSession leaves it.
function commitSeat(db, seat, { email = `f${seat}@example.com`, lm = 1, pm = `pm_${seat}`, cus = `cus_${seat}` } = {}) {
  db.prepare(`UPDATE founders_seats SET status = 'committed', checkout_session_id = ?, stripe_customer_id = ?, setup_intent_id = ?, payment_method_id = ?,
    card_fingerprint = ?, email = ?, mandate_at = ?, livemode = ?, terms_version = '2.2', updated_at = ? WHERE seat = ?`)
    .run(`cs_live_setup${seat}xxxxxxx`, cus, `seti_${seat}`, pm, `fp_${seat}`, email, T0 - DAY, lm, T0 - DAY, seat);
}

const ALL_NEW = ['charge_state', 'payment_intent_id', 'subscription_id', 'licence_id', 'charged_at', 'fail_code', 'pay_hash', 'pay_expires_at', 'pay_session_id', 'pay_revealed_at', 'claim_hash', 'claim_expires_at'];

async function harness({ live = true, goalUsd = 1840, start = T0, http = true } = {}) {
  let t = start;
  const now = () => t;
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-charge-'));
  const outDir = path.join(dir, 'outbox');
  const db = openDb(':memory:');
  const licences = createStore(db, { aesKey: AES, now });
  const stripe = fakeStripe({ live, now });
  const lm = live ? 1 : 0;
  const cfg = { goalUsd, deadlineAt: DEADLINE };
  const ctx = createChargeContext({ db, stripe, licences, livemode: lm, now, log: quiet, priceId: PRICE, outbox: createOutbox({ dir: outDir, source: 'charge', now }), deadlineAt: DEADLINE });
  const lines = [];
  const print = (l) => lines.push(l);
  const logs = [];
  const log = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
  const env = { FOUNDERS: 'open', FOUNDERS_OUTBOX_DIR: outDir, STRIPE_FOUNDERS_PRICE_ID: PRICE, STRIPE_FOUNDERS_PRICE_ID_TEST: PRICE };
  const founders = createFounders({ db, stripe, env, mode: live ? 'live' : 'test', webhookReady: true, now, log, licences });
  let server = null;
  let base = '';
  if (http) {
    const app = express();
    mountPro(app, {
      store: licences, stripe, now, loginDelayMs: 0, log: quiet,
      config: { priceId: 'price_pro', webhookSecret: SECRET, proSecretSet: true, publicUrl: 'https://bloombroke.com', mode: live ? 'live' : 'test', checkoutClosed: true },
      onEvent: (event) => handleFoundersEvent(event, { founders: founders.store, stripe, log: quiet, charge: founders.charge }),
    });
    mountFounders(app, { founders, now, log: quiet });
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  let ipN = 0;
  const req = async (method, url, { body, headers = {}, raw } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'CF-Connecting-IP': `203.0.113.${(++ipN % 200) + 1}`, ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  };
  const post = (url, body) => req('POST', url, { body, headers: ORIGIN });
  let ev = 0;
  const sendEvent = (type, object) => {
    const payload = JSON.stringify({ id: `evt_charge_${++ev}`, type, created: Math.floor(t / 1000), data: { object } });
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) });
    return req('POST', '/api/stripe/webhook', { raw: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig } });
  };
  // Every email waiting in the outbox, oldest file first.
  const mails = () => {
    let files = [];
    try { files = readdirSync(outDir).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
    return files.flatMap((f) => JSON.parse(readFileSync(path.join(outDir, f), 'utf8')));
  };
  const token = (mail, kind) => new RegExp(`#${kind}=([A-Za-z0-9_-]{43})`).exec(mail.text)?.[1];
  const close = async () => { if (server) await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); };
  return {
    db, stripe, licences, ctx, cfg, lines, print, logs, founders, store: ctx.store, req, post, sendEvent, mails, token, outDir, dir, close, now,
    advance(ms) { t += ms; }, set(ms) { t = ms; },
    run: (cmd, extra = {}) => ({
      charge: () => script.charge({ ctx, cfg, print, execute: true, ...extra }),
      dry: () => script.charge({ ctx, cfg, print, execute: false, ...extra }),
      golive: () => script.golive({ ctx, print, execute: true, date: GOLIVE_DAY, ...extra }),
      reconcile: () => script.reconcile({ ctx, print, execute: true, ...extra }),
      expire: () => script.expireUnpaid({ ctx, print, execute: true, ...extra }),
    })[cmd](),
  };
}

// A failed seat with a paid pay-link session (the webhook body), via the real routes.
async function paidPaySession(h, seat) {
  const failed = h.mails().find((m) => m.kind === 'failed' && m.seat === seat);
  const r = await h.post('/api/founders/pay', { token: h.token(failed, 'pay') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sid = h.store.seat(seat).pay_session_id;
  const s = h.stripe.sessions[sid];
  const pi = await h.stripe.paymentIntents.create({ amount: s.amount_total, currency: 'usd', customer: s.customer, payment_method: `pm_new${seat}`, metadata: s.metadata }, {});
  Object.assign(h.stripe.pis[pi.id], { status: 'succeeded', amount_received: s.amount_total });
  Object.assign(s, { status: 'complete', payment_status: 'paid', payment_intent: pi.id });
  return { session: JSON.parse(JSON.stringify(s)), pi: pi.id };
}

// ---- migration 022 and release --------------------------------------------------------

test('migration 022: additive columns and founders_state; release clears every new column (P1)', () => {
  const db = openDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(founders_seats)').all().map((c) => c.name);
  for (const c of ALL_NEW) assert.ok(cols.includes(c), c);
  assert.ok(db.prepare('PRAGMA table_info(licences)').all().some((c) => c.name === 'term_ends_at'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'founders_state'").get());
  assert.throws(() => db.prepare("UPDATE founders_seats SET charge_state = 'paid' WHERE seat = 1").run(), /CHECK/);
  assert.ok(script.hasMigration022(db));
  commitSeat(db, 12);
  db.prepare(`UPDATE founders_seats SET charge_state = 'failed', payment_intent_id = 'pi_1', subscription_id = 'sub_1', licence_id = 3, charged_at = 1, fail_code = 'x',
    pay_hash = 'h1', pay_expires_at = 2, pay_session_id = 'cs_1', pay_revealed_at = 3, claim_hash = 'h2', claim_expires_at = 4 WHERE seat = 12`).run();
  const store = createFoundersStore(db, { now: () => T0 });
  store.release(12);
  const row = store.seat(12);
  assert.equal(row.status, 'open');
  for (const c of ALL_NEW) assert.equal(row[c], null, c);
  assert.equal(row.stripe_customer_id, null);
});

test('scripts/founders.js: refuses to run on a database without migration 022', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-m22-'));
  try {
    const early = path.join(dir, 'mig');
    mkdirSync(early);
    for (const f of readdirSync('migrations').filter((f) => f < '022')) copyFileSync(path.join('migrations', f), path.join(early, f));
    const file = path.join(dir, 'pro.db');
    const db = openDb(file, { migrationsDir: early });
    assert.equal(script.hasMigration022(db), false);
    db.close();
    let err = null;
    try { execFileSync(process.execPath, ['scripts/founders.js', 'list', '--db', file], { stdio: 'pipe' }); } catch (e) { err = e; }
    assert.ok(err, 'exits with an error');
    assert.match(String(err.stderr), /no migration 022_founders_charge\.sql/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the charge ---------------------------------------------------------------------------

test('charge: dry run prints totals, masked emails, cards and the checklist; changes nothing, no tokens', async () => {
  const h = await harness({ http: false });
  try {
    commitSeat(h.db, 1, { email: 'ann@example.com' });
    commitSeat(h.db, 11, { email: 'bob@example.com', pm: 'pm_old' });
    const out = await h.run('dry');
    assert.equal(out.code, 0);
    const text = h.lines.join('\n');
    assert.match(text, /Committed: \$1,840 of the \$1,840 goal, 2 seats/);
    assert.match(text, /Deadline: Dec 15, 2026/);
    assert.match(text, /a\*\*@example\.com/);
    assert.ok(!text.includes('ann@example.com'), 'emails are masked');
    assert.match(text, /visa 4242, exp 12\/2030/);
    assert.match(text, /visa 0002, exp 01\/2025 {2}WARNING: EXPIRED/);
    assert.match(text, /Customer portal \(default\): cancel only, at period end; switching plans OFF; changing quantity OFF/);
    assert.match(text, /"Successful payments" ON/);
    assert.match(text, /Refunds \(write\) and Billing Portal \/ Customer portal \(write\)/);
    assert.match(text, /The app can write FOUNDERS_OUTBOX_DIR/);
    assert.match(text, /writes STRIPE_FOUNDERS_PRICE_ID, restart the app/);
    assert.match(text, /Never run two charge runs at once/);
    assert.match(text, /Would charge 2 seats/);
    assert.equal(h.stripe.calls.filter((c) => !c[0].endsWith('retrieve')).length, 0, 'only reads');
    assert.equal(h.store.frozen(), false);
    assert.equal(h.mails().length, 0);
  } finally { await h.close(); }
});

test('charge: two steps per seat (unconfirmed PI saved as charging, then off-session confirm); licence + claim link; freeze; totals and dedupe still count', async () => {
  const h = await harness();
  try {
    commitSeat(h.db, 1, { email: 'ann@example.com' });
    commitSeat(h.db, 11, { email: 'bob@example.com' });
    const seen = [];
    h.stripe.hooks.confirm = (pid) => { const r = h.store.seat(Number(h.stripe.pis[pid].metadata.seat)); seen.push([r.charge_state, r.payment_intent_id === pid]); };
    const before = h.licences.nextSeat();
    const out = await h.run('charge');
    assert.equal(out.code, 0, h.lines.join('\n'));
    assert.deepEqual(seen, [['charging', true], ['charging', true]], 'saved before confirming');
    const creates = h.stripe.calls.filter((c) => c[0] === 'pi.create');
    assert.equal(creates.length, 2);
    const [p, opts] = creates[0].slice(1);
    assert.deepEqual(p, {
      amount: 142000, currency: 'usd', customer: 'cus_1', payment_method: 'pm_1', payment_method_types: ['card'], confirm: false, receipt_email: 'ann@example.com',
      description: 'Bloombroke founders seat 1 (five-year seat)', metadata: { site: 'bloombroke', product: 'founders', kind: 'charge', seat: '1', class: 'ten', terms_version: '2.2' },
    });
    assert.equal(opts.idempotencyKey, 'bb-founders-pi-1-1-seti_1');
    assert.equal(creates[1][1].amount, 42000);
    assert.equal(creates[1][1].description, 'Bloombroke founders seat 11 (founder seat, first year)');
    const confirms = h.stripe.calls.filter((c) => c[0] === 'pi.confirm');
    assert.deepEqual(confirms[0][2], { off_session: true });
    for (const seat of [1, 11]) {
      const r = h.store.seat(seat);
      assert.equal(r.status, 'committed', 'status stays committed');
      assert.equal(r.charge_state, 'charged');
      assert.equal(r.charged_at, T0);
      assert.equal(r.claim_expires_at, T0 + CLAIM_MS);
      assert.equal(CLAIM_MS, 32 * DAY);
      const lic = h.licences.findById(r.licence_id);
      assert.ok(lic.key_hash.startsWith(UNCLAIMED_PREFIX), 'no key anyone knows');
      assert.equal(lic.last4, '----');
      assert.equal(lic.reveal_ciphertext, null, 'no key copy');
      assert.equal(lic.stripe_subscription_id, null);
      assert.equal(lic.checkout_session_id, null);
      assert.equal(lic.stripe_customer_id, `cus_${seat}`);
      assert.equal(lic.status, 'active');
      assert.equal(lic.livemode, 1);
      assert.equal(lic.terms_version, '2.2');
      assert.equal(lic.terms_accepted_at, T0 - DAY);
      assert.equal(lic.term_ends_at, null, 'no end before go-live');
      assert.ok(proAccess(lic, T0).active);
    }
    assert.equal(h.licences.findById(h.store.seat(1).licence_id).seat, before, 'the next member number');
    // The claim emails: the token only in the link, its hash in the database.
    const mails = h.mails();
    assert.deepEqual(mails.map((m) => [m.kind, m.seat, m.to]), [['charge', 1, 'ann@example.com'], ['charge', 11, 'bob@example.com']]);
    assert.equal(tokenHash(h.token(mails[0], 'claim')), h.store.seat(1).claim_hash);
    assert.match(mails[0].text, /https:\/\/bloombroke\.com\/founders#claim=/);
    const file = path.join(h.outDir, readdirSync(h.outDir)[0]);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(h.outDir).mode & 0o777, 0o700);
    assert.match(path.basename(file), /^founders-20261201-charge\.json$/);
    assert.ok(!h.lines.join('\n').includes(h.token(mails[0], 'claim')), 'tokens never printed');
    // Frozen and started, durably.
    const st = h.store.state();
    assert.equal(st.frozen_at, T0);
    assert.equal(st.charge_started_at, T0);
    // Charged seats still count, and one seat per person still holds.
    const status = h.founders.status();
    assert.equal(status.committedUsd, 1840);
    assert.equal(status.seatsTaken, 2);
    const dup = h.db.prepare("SELECT seat FROM founders_seats WHERE status = 'committed' AND email = 'bob@example.com'").get();
    assert.equal(dup.seat, 11);
    // A re-run charges nothing again.
    const again = await h.run('charge');
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'pi.create').length, 2);
    assert.equal(again.code, 0);
  } finally { await h.close(); }
});

test('charge: a decline and authentication_required mark the seat failed with a 3-day pay link; requires_action too', async () => {
  const h = await harness({ goalUsd: 1000 });
  try {
    commitSeat(h.db, 1, { pm: 'pm_decline' });
    commitSeat(h.db, 11, { pm: 'pm_auth' });
    commitSeat(h.db, 12, { pm: 'pm_action' });
    Object.assign(h.stripe.cards, { pm_decline: 'decline', pm_auth: 'auth', pm_action: 'action' });
    const out = await h.run('charge');
    assert.equal(out.code, 0, h.lines.join('\n'));
    const codes = [1, 11, 12].map((s) => h.store.seat(s));
    assert.deepEqual(codes.map((r) => [r.charge_state, r.fail_code]), [['failed', 'generic_decline'], ['failed', 'authentication_required'], ['failed', 'requires_action']]);
    for (const r of codes) {
      assert.equal(r.status, 'committed');
      assert.equal(r.pay_expires_at, T0 + PAY_WINDOW_MS);
      assert.equal(r.licence_id, null);
    }
    const mails = h.mails();
    assert.deepEqual(mails.map((m) => m.kind), ['failed', 'failed', 'failed']);
    assert.equal(tokenHash(h.token(mails[0], 'pay')), h.store.seat(1).pay_hash);
    assert.match(mails[0].text, /until Dec 4, 2026, 12:00 UTC/);
    assert.match(mails[0].text, /\$1,420 for founders seat 1 \(five-year seat\)/);
    assert.equal(h.founders.status().committedUsd, 1420 + 840, 'failed seats still count until given back');
    // Item 7: each failed PaymentIntent is cancelled, so it can never charge.
    for (const r of codes) assert.equal(h.stripe.pis[r.payment_intent_id].status, 'canceled');
    assert.deepEqual(h.stripe.calls.filter((c) => c[0] === 'pi.cancel').map((c) => c[2].idempotencyKey), codes.map((r) => `bb-founders-cancel-${r.payment_intent_id}`));
    assert.match(h.lines.join('\n'), /seat 1: failed \(generic_decline; PaymentIntent cancelled\)/);
  } finally { await h.close(); }
});

test('charge: a stop after the PI is saved, before confirm: the re-run retrieves and confirms it, never a second PI', async () => {
  const h = await harness();
  try {
    commitSeat(h.db, 1);
    commitSeat(h.db, 11);
    h.stripe.cards.pm_1 = 'network';
    const first = await h.run('charge');
    assert.equal(first.code, 2);
    assert.match(h.lines.join('\n'), /STOP\. seat 1: Stripe said StripeConnectionError/);
    assert.equal(h.store.seat(1).charge_state, 'charging');
    assert.equal(h.store.seat(11).charge_state, null, 'the run stopped: seat 11 untouched');
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'pi.create').length, 1);
    h.stripe.cards.pm_1 = 'ok';
    const second = await h.run('charge');
    assert.equal(second.code, 0, h.lines.join('\n'));
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'pi.create').length, 2, 'one PI per seat');
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'pi.create' && c[1].metadata.seat === '1').length, 1);
    assert.equal(h.store.seat(1).charge_state, 'charged');
    assert.equal(h.store.seat(11).charge_state, 'charged');
  } finally { await h.close(); }
});

test('charge: a stop after confirm, before the database write: the re-run finds it succeeded and marks it, no second charge', async () => {
  const h = await harness();
  try {
    commitSeat(h.db, 1);
    commitSeat(h.db, 11);
    // Seat 1: the PI was made and saved, Stripe confirmed it, then the process died.
    const pi = await h.stripe.paymentIntents.create(script.chargeParams(h.store.seat(1)), { idempotencyKey: 'bb-founders-pi-1-1-seti_1' });
    h.store.startCharging(1, pi.id);
    Object.assign(h.stripe.pis[pi.id], { status: 'succeeded', amount_received: 142000 });
    // Seat 11: made at Stripe, but its id never reached the database.
    const lost = await h.stripe.paymentIntents.create(script.chargeParams(h.store.seat(11)), {});
    h.stripe.calls.length = 0;
    const out = await h.run('charge');
    assert.equal(out.code, 0, h.lines.join('\n'));
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'pi.create').length, 0, 'no new PaymentIntent for either seat');
    assert.deepEqual(h.stripe.calls.filter((c) => c[0] === 'pi.confirm').map((c) => c[1]), [lost.id], 'the paid one is not confirmed again');
    assert.equal(h.store.seat(1).charge_state, 'charged');
    assert.equal(h.store.seat(11).payment_intent_id, lost.id, 'the lost PI is adopted');
    assert.equal(h.store.seat(11).charge_state, 'charged');
  } finally { await h.close(); }
});

test('charge: fail closed: an unknown error, a rate limit or a processing payment stops the whole run; the seat is not changed', async () => {
  const h = await harness({ goalUsd: 400 });
  try {
    commitSeat(h.db, 11);
    commitSeat(h.db, 12);
    // Before step 1: the create fails, the seat stays as it was.
    h.stripe.hooks.piCreate = () => { throw new Stripe.errors.StripePermissionError({ message: 'no permission', code: 'permission_denied' }); };
    assert.equal((await h.run('charge')).code, 2);
    assert.equal(h.store.seat(11).charge_state, null);
    assert.equal(h.store.seat(12).charge_state, null);
    assert.match(h.lines.join('\n'), /STOP\. seat 11: Stripe said StripePermissionError permission_denied/);
    h.stripe.hooks.piCreate = null;
    // After step 1: an API error on confirm leaves 'charging', and nothing more runs.
    h.stripe.cards.pm_11 = 'apierror';
    assert.equal((await h.run('charge')).code, 2);
    assert.equal(h.store.seat(11).charge_state, 'charging');
    assert.equal(h.store.seat(11).fail_code, null);
    assert.equal(h.store.seat(12).charge_state, null);
    h.stripe.cards.pm_11 = 'ratelimit';
    assert.equal((await h.run('charge')).code, 2);
    assert.equal(h.store.seat(11).charge_state, 'charging');
    h.stripe.cards.pm_11 = 'processing';
    assert.equal((await h.run('charge')).code, 2);
    assert.match(h.lines.at(-2), /the payment is processing/);
    assert.equal(h.store.seat(11).charge_state, 'charging');
    assert.equal(h.store.seat(12).charge_state, null);
    assert.equal(h.mails().length, 0);
    // A card error without the PaymentIntent in it is not trusted either.
    h.stripe.pis[h.store.seat(11).payment_intent_id].status = 'requires_confirmation';
    h.stripe.cards.pm_11 = 'ok';
    const realConfirm = h.stripe.paymentIntents.confirm;
    h.stripe.paymentIntents.confirm = async () => { throw new Stripe.errors.StripeCardError({ message: 'declined', type: 'card_error', code: 'card_declined' }); };
    assert.equal((await h.run('charge')).code, 2);
    assert.equal(h.store.seat(11).charge_state, 'charging');
    h.stripe.paymentIntents.confirm = realConfirm;
    assert.equal((await h.run('charge')).code, 0);
    assert.equal(h.store.seat(11).charge_state, 'charged');
    assert.equal(h.store.seat(12).charge_state, 'charged');
  } finally { await h.close(); }
});

test('charge: refused below the goal, after the deadline, and for a seat of the other mode; after the deadline it only finishes charging seats', async () => {
  const h = await harness({ goalUsd: 17640 });
  try {
    commitSeat(h.db, 1);
    commitSeat(h.db, 11);
    commitSeat(h.db, 12, { lm: 0 });
    const below = await h.run('charge');
    assert.equal(below.code, 1);
    assert.match(h.lines.join('\n'), /Below the goal: nothing is charged/);
    assert.match(h.lines.join('\n'), /seat 12: refused, its mode \(test\) is not this key's/);
    assert.equal(h.store.frozen(), false, 'not frozen when refused');
    assert.equal(h.stripe.calls.length, 0);
    h.cfg.goalUsd = 1840;
    // After the deadline: never starts.
    h.set(DEADLINE + 1);
    assert.equal((await h.run('charge')).code, 1);
    assert.match(h.lines.join('\n'), /After the deadline: nothing is being charged/);
    assert.equal(h.stripe.calls.length, 0);
    // Before the deadline: seat 1's run stopped before its confirm; seat 11 was confirmed
    // at Stripe but the run died before saving it; seat 13 never started.
    commitSeat(h.db, 13);
    h.set(T0);
    h.stripe.cards.pm_1 = 'network';
    assert.equal((await h.run('charge')).code, 2);
    assert.equal(h.store.seat(1).charge_state, 'charging');
    const pi1 = h.store.seat(1).payment_intent_id;
    const pi11 = await h.stripe.paymentIntents.create(script.chargeParams(h.store.seat(11)), {});
    h.store.startCharging(11, pi11.id);
    Object.assign(h.stripe.pis[pi11.id], { status: 'succeeded', amount_received: 42000 });
    // After the deadline (item 5): seat 11 is recorded as paid; seat 1 is never confirmed:
    // its PaymentIntent is cancelled and the seat given back; seat 13 is never started.
    h.set(DEADLINE + HOUR);
    h.stripe.cards.pm_1 = 'ok';
    h.stripe.calls.length = 0;
    assert.equal((await h.run('charge')).code, 0, h.lines.join('\n'));
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'pi.confirm').length, 0, 'nothing confirmed after the deadline');
    assert.equal(h.stripe.pis[pi1].status, 'canceled');
    assert.ok(h.stripe.calls.some((c) => c[0] === 'pi.cancel' && c[1] === pi1 && c[2].idempotencyKey === `bb-founders-cancel-${pi1}`));
    assert.equal(h.store.seat(1).status, 'open', 'given back');
    assert.equal(h.store.seat(1).payment_intent_id, null);
    assert.ok(h.stripe.calls.some((c) => c[0] === 'customer.del' && c[1] === 'cus_1'), 'card deleted with the customer');
    assert.match(h.lines.join('\n'), /seat 1: released \(after the deadline: not charged, PaymentIntent cancelled, customer deleted\)/);
    assert.equal(h.store.seat(11).charge_state, 'charged');
    assert.equal(h.store.seat(13).charge_state, null, 'never started after the deadline');
    assert.equal(h.store.seat(12).charge_state, null, 'the other mode is never charged');
    assert.match(h.lines.join('\n'), /After the deadline these seats are never charged: 13\. Release them by hand: node scripts\/founders\.js release 13 --execute --live/);
    assert.ok(!h.stripe.calls.some((c) => c[0] === 'pi.create' || c[0] === 'pi.list'), 'no PaymentIntent is made after the deadline');
    assert.match(h.lines.join('\n'), /1 given back \(after the deadline, not charged\)/);
  } finally { await h.close(); }
});

test('freeze: blocks checkout, new holds and late commits (given back as ended); charge waits for open checkouts', async () => {
  const h = await harness();
  try {
    commitSeat(h.db, 1);
    commitSeat(h.db, 11);
    // A checkout open right now.
    h.founders.store.hold({ seat: 20, key: 'k1' });
    const out = await h.run('charge');
    assert.equal(out.code, 1);
    assert.match(h.lines.join('\n'), /1 checkout is still open: wait up to 33 minutes/);
    assert.ok(h.store.frozen(), 'frozen even though it waited');
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'pi.create').length, 0);
    // Frozen: closed for everyone, durably.
    assert.equal(h.founders.isOpen(), false);
    assert.equal(h.founders.status().open, false);
    const r = await h.post('/api/founders/checkout', { class: 'founder' });
    assert.equal(r.status, 410);
    assert.equal(r.body.error, 'frozen');
    assert.throws(() => h.founders.store.hold({ seat: 21, key: 'k2' }), /Charge day is under way/);
    // A late commit is given back.
    const late = h.founders.store.commit({ sessionId: 'cs_live_latecommit01', cls: 'founder', customer: 'cus_l', paymentMethod: 'pm_l', email: 'late@example.com', livemode: true });
    assert.equal(late.given?.reason, 'ended');
    assert.equal(h.store.seat(20).status, 'held', 'the open hold is not taken by the late session');
    // Once the hold runs out, charge goes ahead.
    h.advance(HOLD_MS + 1);
    assert.equal((await h.run('charge')).code, 0);
    assert.equal(h.store.seat(1).charge_state, 'charged');
  } finally { await h.close(); }
});

// ---- go-live and term licences --------------------------------------------------------------

test('golive: founder seats get one anchored renewal (reused on a re-run), five-year seats an end; setBilling; emails', async () => {
  const h = await harness();
  try {
    commitSeat(h.db, 1);
    commitSeat(h.db, 11, { email: 'bob@example.com' });
    await h.run('charge');
    // Dry run: nothing saved.
    h.set(AFTER_GOLIVE);
    assert.equal((await h.run('golive', { execute: false })).code, 0);
    assert.equal(h.store.state().golive_at, null);
    assert.match(h.lines.join('\n'), /renewal \$420 on Dec 2, 2027/);
    assert.match(h.lines.join('\n'), /Pro until Dec 2, 2031/);
    const out = await h.run('golive');
    assert.equal(out.code, 0, h.lines.join('\n'));
    assert.equal(h.store.state().golive_at, GOLIVE);
    const creates = h.stripe.calls.filter((c) => c[0] === 'sub.create');
    assert.equal(creates.length, 1, 'only the founder seat');
    const [p, opts] = creates[0].slice(1);
    assert.deepEqual(p, {
      customer: 'cus_11', items: [{ price: PRICE, quantity: 1 }], default_payment_method: 'pm_11', payment_settings: { payment_method_types: ['card'] },
      billing_cycle_anchor: Date.UTC(2027, 11, 2) / 1000, proration_behavior: 'none', description: 'Bloombroke founders seat 11 (founder seat, yearly renewal)',
      metadata: { site: 'bloombroke', product: 'founders', kind: 'renewal', seat: '11', class: 'founder', terms_version: '2.2' },
    });
    assert.equal(opts.idempotencyKey, `bb-founders-sub-1-11-${GOLIVE}`);
    const sub = Object.values(h.stripe.subs)[0];
    const r11 = h.store.seat(11);
    assert.equal(r11.subscription_id, sub.id);
    const lic11 = h.licences.findById(r11.licence_id);
    assert.equal(lic11.stripe_subscription_id, sub.id);
    assert.equal(lic11.current_period_end, Date.UTC(2027, 11, 2), 'Renews Dec 2, 2027');
    assert.equal(lic11.billing_interval, 'year');
    assert.equal(lic11.cancel_at_period_end, 0);
    assert.equal(willRenew(lic11), true);
    assert.equal(publicStatus(lic11, T0).currentPeriodEnd, '2027-12-02T00:00:00.000Z');
    const lic1 = h.licences.findById(h.store.seat(1).licence_id);
    assert.equal(lic1.term_ends_at, Date.UTC(2031, 11, 2));
    assert.equal(willRenew(lic1), false);
    // P5: one go-live email per seat.
    const gl = h.mails().filter((m) => m.kind === 'golive');
    assert.deepEqual(gl.map((m) => m.seat), [1, 11]);
    assert.match(gl[1].text, /renews on Dec 2, 2027 at \$420/);
    assert.match(gl[0].text, /Pro until Dec 2, 2031\. It does not renew/);
    // Re-run: nothing new, no second email.
    assert.equal((await h.run('golive')).code, 0);
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'sub.create').length, 1);
    assert.equal(h.mails().filter((m) => m.kind === 'golive').length, 2);
    // Another day is refused.
    assert.equal((await h.run('golive', { date: '2026-11-30' })).code, 1);
  } finally { await h.close(); }
});

test('golive: a subscription made before a crash is reused; a wrong or missing price is refused; a deleted account gets no renewal', async () => {
  const h = await harness();
  try {
    commitSeat(h.db, 1);
    commitSeat(h.db, 11);
    commitSeat(h.db, 12);
    await h.run('charge');
    h.set(AFTER_GOLIVE);
    h.stripe.priceData[PRICE].unit_amount = 4200;
    assert.equal((await h.run('golive')).code, 1);
    assert.match(h.lines.at(-1), /not \$420 USD/);
    h.stripe.priceData[PRICE].unit_amount = 42000;
    h.stripe.priceData[PRICE].metadata = {};
    assert.equal((await h.run('golive')).code, 1);
    assert.match(h.lines.at(-1), /founders metadata/);
    h.stripe.priceData[PRICE].metadata = { site: 'bloombroke', product: 'founders' };
    assert.equal(h.store.state().golive_at, null, 'refused before saving the day');
    // Seat 11's renewal exists at Stripe already (the earlier run died before saving it).
    const made = await h.stripe.subscriptions.create({ customer: 'cus_11', items: [{ price: PRICE }], billing_cycle_anchor: Date.UTC(2027, 11, 2) / 1000,
      metadata: { site: 'bloombroke', product: 'founders', kind: 'renewal', seat: '11', class: 'founder' } }, {});
    // Seat 12 deleted the account (DELETE MY ACCOUNT) before go-live.
    h.licences.closeAccount(h.store.seat(12).licence_id);
    h.stripe.calls.length = 0;
    assert.equal((await h.run('golive')).code, 0, h.lines.join('\n'));
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'sub.create').length, 0);
    assert.equal(h.store.seat(11).subscription_id, made.id);
    assert.equal(h.store.seat(12).subscription_id, null);
    assert.match(h.lines.join('\n'), /seat 12: account deleted, no renewal made/);
  } finally { await h.close(); }
});

test('term licences: a five-year seat is Pro before go-live, during the term, and ends at the term by the daily sweep', async () => {
  const h = await harness({ goalUsd: 1420 });
  try {
    commitSeat(h.db, 1);
    await h.run('charge');
    const id = h.store.seat(1).licence_id;
    let lic = h.licences.findById(id);
    assert.equal(proAccess(lic, T0).active, true, 'before go-live: Pro, no end yet');
    const st0 = publicStatus(lic, T0);
    assert.equal(st0.founders, true);
    assert.equal(st0.canGift, false, 'no gift codes without a subscription');
    assert.equal(st0.cancelAt, undefined);
    h.set(AFTER_GOLIVE);
    await h.run('golive');
    lic = h.licences.findById(id);
    const end = Date.UTC(2031, 11, 2);
    assert.equal(proAccess(lic, end - 1).active, true);
    const st = publicStatus(lic, T0);
    assert.equal(st.termUntil, '2031-12-02T00:00:00.000Z');
    assert.equal(st.cancelAt, st.termUntil, 'reads "ends, no renewal": no CANCEL');
    assert.equal(proAccess(lic, end).active, false, 'off at the end even before the sweep');
    // The sweep: before the end nothing, after it 'canceled' at the term end.
    assert.equal(h.licences.sweepTerms(), 0);
    h.set(end + DAY);
    assert.equal(h.licences.sweepTerms(), 1);
    lic = h.licences.findById(id);
    assert.equal(lic.status, 'canceled');
    assert.equal(lic.ended_at, end);
    assert.equal(proAccess(lic, end + DAY).active, false);
    // The ended licence then follows the normal purge rules (synced data 30 days later).
    h.licences.putDocs(id, { watch: { data: ['AAPL'], updatedAt: end - DAY } });
    h.set(end + 31 * DAY);
    assert.equal(h.licences.purgeEnded().docs, 1);
    // A licence with a subscription is never swept, even with an old end on it.
    h.db.prepare('UPDATE licences SET status = ?, stripe_subscription_id = ?, term_ends_at = ? WHERE id = ?').run('active', 'sub_again', end, id);
    assert.equal(h.licences.sweepTerms(), 0);
  } finally { await h.close(); }
});

test('publicStatus foundersClass: a charged founder seat says founder, a five-year seat says ten (also over GET /api/pro/status)', async () => {
  const h = await harness();
  try {
    commitSeat(h.db, 1);
    commitSeat(h.db, 11);
    await h.run('charge');
    const classOf = h.licences.foundersClassOf;
    const ten = h.licences.findById(h.store.seat(1).licence_id);
    const founder = h.licences.findById(h.store.seat(11).licence_id);
    assert.equal(publicStatus(founder, T0, 'live', { classOf }).foundersClass, 'founder');
    assert.equal(publicStatus(ten, T0, 'live', { classOf }).foundersClass, 'ten');
    assert.equal(publicStatus(ten, T0).foundersClass, undefined, 'no lookup given: no field');
    // Through the route: the claimed key's status carries it.
    const mail = h.mails().find((m) => m.kind === 'charge' && m.seat === 11);
    const claim = await h.post('/api/founders/claim', { token: h.token(mail, 'claim') });
    const st = await h.req('GET', '/api/pro/status', { headers: { 'X-Pro-Key': claim.body.key } });
    assert.equal(st.status, 200);
    assert.equal(st.body.founders, true);
    assert.equal(st.body.foundersClass, 'founder');
  } finally { await h.close(); }
});

test('publicStatus foundersClass: a Pro licence has no field', () => {
  const db = openDb(':memory:');
  const licences = createStore(db, { aesKey: AES, now: () => T0 });
  const pro = { id: 1, status: 'active', stripe_subscription_id: 'sub_1', checkout_session_id: 'cs_1', livemode: 1, last4: 'ABCD' };
  let asked = 0;
  const st = publicStatus(pro, T0, 'live', { classOf: (...a) => { asked++; return licences.foundersClassOf(...a); } });
  assert.equal(st.founders, undefined);
  assert.equal(st.foundersClass, undefined);
  assert.equal(asked, 0, 'only founders licences are looked up');
});

test('publicStatus foundersClass: a seat of the other livemode is not matched', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11);
    await h.run('charge');
    const id = h.store.seat(11).licence_id;
    assert.equal(h.licences.foundersClassOf(id, 1), 'founder');
    assert.equal(h.licences.foundersClassOf(id, 0), null, 'the test-mode lookup does not see a live seat');
    assert.equal(h.licences.foundersClassOf(id, null), null);
    const lic = h.licences.findById(id);
    assert.equal(publicStatus({ ...lic, livemode: 0 }, T0, 'test', { classOf: h.licences.foundersClassOf }).foundersClass, undefined);
  } finally { await h.close(); }
});

test('renewal webhooks reach the founder licence through its subscription; the portal refuses a licence without one', async () => {
  const h = await harness();
  try {
    commitSeat(h.db, 1);
    commitSeat(h.db, 11);
    await h.run('charge');
    // Before go-live: no plan to manage.
    const claim = await h.post('/api/founders/claim', { token: h.token(h.mails()[1], 'claim') });
    const portal = await h.req('POST', '/api/pro/portal', { headers: { 'X-Pro-Key': claim.body.key } });
    assert.equal(portal.status, 409);
    assert.equal(portal.body.error, 'no_subscription');
    h.set(AFTER_GOLIVE);
    await h.run('golive');
    const sub = Object.values(h.stripe.subs)[0];
    sub.status = 'past_due';
    const r = await h.sendEvent('customer.subscription.updated', { id: sub.id, object: 'subscription', metadata: sub.metadata });
    assert.equal(r.status, 200);
    assert.equal(r.body.result, 'updated');
    assert.equal(h.licences.findById(h.store.seat(11).licence_id).status, 'past_due');
  } finally { await h.close(); }
});

// ---- the claim ---------------------------------------------------------------------------------

test('claim: a fresh key each time (the old one stops), the link runs out, wrong tokens and other origins refused', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11);
    await h.run('charge');
    const tok = h.token(h.mails()[0], 'claim');
    const a = await h.post('/api/founders/claim', { token: tok });
    assert.equal(a.status, 200);
    assert.match(a.body.key, /^BB-/);
    assert.equal(a.body.seat, 11);
    const lic = h.licences.findByKey(a.body.key);
    assert.equal(lic.id, h.store.seat(11).licence_id);
    const b = await h.post('/api/founders/claim', { token: tok });
    assert.notEqual(b.body.key, a.body.key);
    assert.equal(h.licences.findByKey(a.body.key), null, 'the old key stops');
    assert.equal(h.licences.findByKey(b.body.key).id, lic.id);
    assert.equal(h.licences.findById(lic.id).reveal_ciphertext, null, 'never stored');
    assert.equal((await h.post('/api/founders/claim', { token: 'x'.repeat(43) })).status, 404);
    assert.equal((await h.post('/api/founders/claim', { token: 'short' })).status, 400);
    assert.equal((await h.req('POST', '/api/founders/claim', { body: { token: tok } })).status, 403, 'same origin only');
    // A deleted account is never brought back by the link.
    h.set(T0 + CLAIM_MS - 1);
    h.licences.closeAccount(lic.id);
    assert.equal((await h.post('/api/founders/claim', { token: tok })).body.error, 'deleted');
    h.set(T0 + CLAIM_MS);
    const late = await h.post('/api/founders/claim', { token: tok });
    assert.equal(late.status, 410);
    assert.equal(late.body.error, 'expired');
  } finally { await h.close(); }
});

// ---- the pay link -------------------------------------------------------------------------------

test('pay link: peek, a card-only Checkout bound to the link, reused while open, a new one after it expires, refused in the last 30 minutes', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad', email: 'bob@example.com' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    const tok = h.token(h.mails()[0], 'pay');
    const peek = await h.post('/api/founders/pay', { token: tok, peek: true });
    assert.deepEqual(peek.body, { seat: 11, class: 'founder', usd: 420, payUntil: new Date(T0 + PAY_WINDOW_MS).toISOString() });
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'checkout.create').length, 0);
    const a = await h.post('/api/founders/pay', { token: tok });
    assert.equal(a.status, 200);
    const [p, opts] = h.stripe.calls.find((c) => c[0] === 'checkout.create').slice(1);
    assert.equal(p.mode, 'payment');
    assert.deepEqual(p.payment_method_types, ['card']);
    assert.equal(p.customer, 'cus_11');
    assert.deepEqual(p.line_items[0].price_data, { currency: 'usd', unit_amount: 42000, product_data: { name: 'Bloombroke founders seat 11 (founder seat)' } });
    assert.equal(p.payment_intent_data.setup_future_usage, 'off_session');
    assert.equal(p.payment_intent_data.receipt_email, 'bob@example.com');
    assert.deepEqual(p.payment_intent_data.metadata, { site: 'bloombroke', product: 'founders', kind: 'pay', seat: '11', class: 'founder', terms_version: '2.2' });
    assert.deepEqual(p.metadata, p.payment_intent_data.metadata);
    assert.deepEqual(p.consent_collection, { terms_of_service: 'required' });
    assert.equal(p.success_url, 'https://bloombroke.com/founders?paid=11&s={CHECKOUT_SESSION_ID}');
    assert.ok(p.expires_at * 1000 <= T0 + PAY_WINDOW_MS, 'never past the pay link');
    assert.ok(p.expires_at * 1000 >= T0 + 30 * MIN, 'Stripe\'s least');
    assert.ok(p.expires_at * 1000 <= T0 + 24 * HOUR, 'Stripe\'s most');
    assert.match(opts.idempotencyKey, new RegExp(`^bb-founders-pay-1-11-[0-9a-f]{16}-first-${T0 / MIN}$`));
    const sid = h.store.seat(11).pay_session_id;
    assert.equal(a.body.url, h.stripe.sessions[sid].url);
    // Open: the same session again.
    const b = await h.post('/api/founders/pay', { token: tok });
    assert.equal(b.body.url, a.body.url);
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'checkout.create').length, 1);
    // Expired: a new one.
    h.stripe.sessions[sid].status = 'expired';
    const c = await h.post('/api/founders/pay', { token: tok });
    assert.notEqual(c.body.url, a.body.url);
    assert.equal(h.stripe.calls.filter((x) => x[0] === 'checkout.create').length, 2);
    // Near the end: the session ends with the link.
    h.set(T0 + PAY_WINDOW_MS - 2 * HOUR);
    h.stripe.sessions[h.store.seat(11).pay_session_id].status = 'expired';
    await h.post('/api/founders/pay', { token: tok });
    const last = h.stripe.calls.filter((x) => x[0] === 'checkout.create').at(-1)[1];
    assert.equal(last.expires_at, Math.floor((T0 + PAY_WINDOW_MS) / 1000));
    h.set(T0 + PAY_WINDOW_MS - 29 * MIN);
    const late = await h.post('/api/founders/pay', { token: tok });
    assert.equal(late.status, 410);
    assert.equal(payCheckoutParams({ row: { ...h.store.seat(11), pay_expires_at: T0 + PAY_WINDOW_MS }, publicUrl: 'https://bloombroke.com', at: T0 }).payment_method_types[0], 'card');
  } finally { await h.close(); }
});

test('pay webhook: a good payment charges the seat with the new card (old one off), emails the key, and the success page shows a key once', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    const { session, pi } = await paidPaySession(h, 11);
    h.advance(10 * MIN);
    const r = await h.sendEvent('checkout.session.completed', session);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.result, 'founders_paid');
    const row = h.store.seat(11);
    assert.equal(row.charge_state, 'charged');
    assert.equal(row.payment_intent_id, pi);
    assert.equal(row.payment_method_id, 'pm_new11');
    assert.equal(row.card_fingerprint, 'fp_pm_new11');
    assert.equal(row.pay_hash, null, 'the pay link stops working');
    assert.ok(h.stripe.calls.some((c) => c[0] === 'pm.detach' && c[1] === 'pm_bad'), 'the failed card comes off');
    // P6: the key email from the app process, its own outbox file.
    const key = h.mails().find((m) => m.kind === 'key');
    assert.ok(key);
    assert.equal(tokenHash(h.token(key, 'claim')), row.claim_hash);
    assert.ok(readdirSync(h.outDir).some((f) => /^founders-\d{8}-pay\.json$/.test(f)));
    // A resent event changes nothing.
    assert.equal((await h.sendEvent('checkout.session.completed', session)).body.result, 'founders_pay_already');
    // P3: the success page, once, for that session only.
    assert.equal((await h.post('/api/founders/paid', { s: 'cs_live_someotherpaysession', seat: 11 })).status, 404);
    const shown = await h.post('/api/founders/paid', { s: session.id, seat: 11 });
    assert.equal(shown.status, 200);
    assert.ok(h.licences.findByKey(shown.body.key));
    assert.equal(h.store.seat(11).pay_revealed_at, h.now());
    assert.equal((await h.post('/api/founders/paid', { s: session.id, seat: 11 })).status, 410);
    assert.equal(h.stripe.refundLog.length, 0);
  } finally { await h.close(); }
});

test('pay success page: if the webhook is late it applies the session itself; no reveal after 24 hours', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    const { session } = await paidPaySession(h, 11);
    h.set(T0 + HOUR);
    const r = await h.post('/api/founders/paid', { s: session.id, seat: 11 });
    assert.equal(r.status, 200, r.text);
    assert.equal(h.store.seat(11).charge_state, 'charged');
    assert.ok(h.licences.findByKey(r.body.key));
    // The webhook then finds it done.
    assert.equal((await h.sendEvent('checkout.session.completed', session)).body.result, 'founders_pay_already');
  } finally { await h.close(); }
  const h2 = await harness({ goalUsd: 420 });
  try {
    commitSeat(h2.db, 11, { pm: 'pm_bad' });
    h2.stripe.cards.pm_bad = 'decline';
    await h2.run('charge');
    const { session } = await paidPaySession(h2, 11);
    await h2.sendEvent('checkout.session.completed', session);
    h2.advance(24 * HOUR);
    assert.equal((await h2.post('/api/founders/paid', { s: session.id, seat: 11 })).status, 410);
  } finally { await h2.close(); }
});

test('pay webhook guards: wrong amount, currency, session or state is refunded in full (P8); a payment after release too', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    for (const s of [11, 12, 13, 14]) { commitSeat(h.db, s, { pm: `pm_bad${s}` }); h.stripe.cards[`pm_bad${s}`] = 'decline'; }
    await h.run('charge');
    const cases = [];
    for (const s of [11, 12, 13, 14]) cases.push(await paidPaySession(h, s));
    const send = (o) => h.sendEvent('checkout.session.completed', o);
    assert.equal((await send({ ...cases[0].session, amount_total: 100 })).body.result, 'founders_pay_refunded');
    assert.equal((await send({ ...cases[1].session, currency: 'eur' })).body.result, 'founders_pay_refunded');
    assert.equal((await send({ ...cases[2].session, id: 'cs_live_notthestoredone1' })).body.result, 'founders_pay_refunded');
    // Seat 14 was given back before the payment landed.
    h.store.markUnpaid(14);
    assert.equal((await send(cases[3].session)).body.result, 'founders_pay_refunded');
    assert.deepEqual(h.stripe.refundLog.map((r) => [r.p.payment_intent, r.opts.idempotencyKey]), cases.map((c, i) => [c.pi, `bb-founders-refund-${c.pi}-${['amount', 'currency', 'session', 'state'][i]}`]));
    assert.deepEqual(h.stripe.refundLog.map((r) => r.p.metadata.why), ['amount', 'currency', 'session', 'state']);
    assert.ok(h.stripe.refundLog.every((r) => r.p.amount === undefined), 'in full');
    for (const s of [11, 12, 13, 14]) assert.notEqual(h.store.seat(s).charge_state, 'charged');
    // A seat already charged on charge day that pays again is refunded too.
    const h2 = await harness({ goalUsd: 420, http: false });
    try {
      commitSeat(h2.db, 11);
      await h2.run('charge');
      const r = await handleFoundersEvent({ type: 'checkout.session.completed', data: { object: {
        id: 'cs_live_latepaysession01', mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 42000, livemode: true,
        payment_intent: 'pi_late', metadata: { site: 'bloombroke', product: 'founders', kind: 'pay', seat: '11', class: 'founder' } } } },
      { founders: h2.founders.store, stripe: h2.stripe, log: quiet, charge: h2.founders.charge });
      assert.equal(r, 'founders_pay_refunded');
      assert.equal(h2.stripe.refundLog[0].p.payment_intent, 'pi_late');
    } finally { await h2.close(); }
  } finally { await h.close(); }
});

test('reconcile: a paid pay session the webhook missed is applied; a refunded one is left; dry run first', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    await paidPaySession(h, 11);
    assert.equal((await h.run('reconcile', { execute: false })).applied, 1);
    assert.match(h.lines.at(-2), /seat 11: paid by link, not applied yet/);
    assert.equal(h.store.seat(11).charge_state, 'failed');
    const out = await h.run('reconcile');
    assert.equal(out.applied, 1);
    assert.equal(h.store.seat(11).charge_state, 'charged');
    assert.ok(h.mails().some((m) => m.kind === 'key'));
    assert.equal((await h.run('reconcile')).applied, 0, 'applied once');
  } finally { await h.close(); }
});

test('expire-unpaid: an unpaid link gives the seat back (card off, customer deleted, every column cleared); a paid one is applied instead', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad11' });
    commitSeat(h.db, 12, { pm: 'pm_bad12' });
    commitSeat(h.db, 13, { pm: 'pm_bad13' });
    Object.assign(h.stripe.cards, { pm_bad11: 'decline', pm_bad12: 'decline', pm_bad13: 'decline' });
    await h.run('charge');
    await paidPaySession(h, 12); // paid, webhook missed
    // Too early: nothing ran out.
    await h.run('expire');
    assert.equal(h.store.seat(11).charge_state, 'failed');
    assert.equal(h.store.seat(12).charge_state, 'charged', 'reconcile ran first');
    h.set(T0 + PAY_WINDOW_MS + 1);
    assert.equal((await h.run('expire', { execute: false })).code, 0);
    assert.equal(h.store.seat(11).charge_state, 'failed', 'dry run');
    assert.equal((await h.run('expire')).code, 0, h.lines.join('\n'));
    for (const s of [11, 13]) {
      const row = h.store.seat(s);
      assert.equal(row.status, 'open');
      for (const c of ALL_NEW) assert.equal(row[c], null, `${s} ${c}`);
      assert.equal(row.stripe_customer_id, null);
      assert.ok(h.stripe.calls.some((c) => c[0] === 'customer.del' && c[1] === `cus_${s}`), 'P2: customer deleted');
      assert.ok(h.stripe.calls.some((c) => c[0] === 'pm.detach' && c[1] === `pm_bad${s}`));
    }
    assert.ok(h.founders.store.logs().some((l) => l.text === 'Seat 11 released Dec 4.'));
    assert.equal(h.store.seat(12).charge_state, 'charged');
    assert.equal(h.founders.status().committedUsd, 420);
  } finally { await h.close(); }
});

test('pay after go-live: a five-year seat gets its end at once, a founder seat its renewal, and the key email says the dates', async () => {
  const h = await harness({ goalUsd: 840 });
  try {
    commitSeat(h.db, 1, { pm: 'pm_bad1' });
    commitSeat(h.db, 11, { pm: 'pm_bad11' });
    commitSeat(h.db, 12);
    Object.assign(h.stripe.cards, { pm_bad1: 'decline', pm_bad11: 'decline' });
    await h.run('charge');
    h.set(AFTER_GOLIVE);
    await h.run('golive');
    for (const s of [1, 11]) {
      const { session } = await paidPaySession(h, s);
      assert.equal((await h.sendEvent('checkout.session.completed', session)).body.result, 'founders_paid');
    }
    const lic1 = h.licences.findById(h.store.seat(1).licence_id);
    assert.equal(lic1.term_ends_at, Date.UTC(2031, 11, 2), 'P10: go-live + 5 years');
    const r11 = h.store.seat(11);
    assert.ok(r11.subscription_id);
    const sub = h.stripe.calls.filter((c) => c[0] === 'sub.create').find((c) => c[1].metadata.seat === '11')[1];
    assert.equal(sub.billing_cycle_anchor, Date.UTC(2027, 11, 2) / 1000, 'P10: go-live + 1 year');
    assert.equal(sub.default_payment_method, 'pm_new11', 'the card just used');
    const keys = h.mails().filter((m) => m.kind === 'key');
    assert.match(keys[0].text, /Pro goes live on Dec 2, 2026\. Your five-year seat gives you Pro until Dec 2, 2031/);
    assert.match(keys[1].text, /Your seat renews on Dec 2, 2027 at \$420/);
  } finally { await h.close(); }
});

// ---- the outbox and the emails ------------------------------------------------------------------

test('outbox: four kinds only, outside the repo, mode 600, preview hides tokens', async () => {
  assert.deepEqual(EMAIL_KINDS, ['charge', 'failed', 'key', 'golive']);
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-outbox-'));
  try {
    const ob = createOutbox({ dir: path.join(dir, 'o'), source: 'charge', now: () => T0 });
    const tok = 'A'.repeat(43);
    assert.throws(() => ob.append({ kind: 'promo', seat: 1, to: 'a@b.co', subject: 's', text: 't' }), /bad email/);
    ob.append(chargeEmail({ seat: 11, to: 'ann@example.com', token: tok, publicUrl: 'https://bloombroke.com' }));
    ob.append(failedEmail({ seat: 1, to: 'bob@example.com', token: tok, publicUrl: 'https://bloombroke.com', payUntil: T0 + PAY_WINDOW_MS }));
    const preview = script.outboxPreview(path.join(dir, 'o'));
    assert.ok(!preview.includes(tok), 'no token in the preview');
    assert.match(preview, /#claim=\[REDACTED\]/);
    assert.match(preview, /#pay=\[REDACTED\]/);
    assert.match(preview, /to ann@example\.com/);
    assert.match(preview, /2 emails/);
    assert.equal(redactTokens(`x #claim=${tok} y`), 'x #claim=[REDACTED] y');
    const inside = createOutbox({ dir: path.resolve('var', 'outbox-test'), source: 'charge' });
    assert.throws(() => inside.append(chargeEmail({ seat: 11, to: 'a@b.co', token: tok, publicUrl: 'https://bloombroke.com' })), /inside the repo/);
    assert.throws(() => inside.check(), /inside the repo/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('emails: plain, short, no em dash, the right facts per kind', () => {
  const u = 'https://bloombroke.com';
  const tok = 'B'.repeat(43);
  const all = [
    chargeEmail({ seat: 11, to: 'a@b.co', token: tok, publicUrl: u }),
    chargeEmail({ seat: 3, to: 'a@b.co', token: tok, publicUrl: u }),
    failedEmail({ seat: 11, to: 'a@b.co', token: tok, publicUrl: u, payUntil: T0 + PAY_WINDOW_MS }),
    keyEmail({ seat: 11, to: 'a@b.co', token: tok, publicUrl: u }),
    goliveEmail({ seat: 11, to: 'a@b.co', goliveAt: GOLIVE }),
    goliveEmail({ seat: 3, to: 'a@b.co', goliveAt: GOLIVE }),
  ];
  for (const m of all) {
    assert.doesNotMatch(m.text + m.subject, /—|–/, 'no dashes');
    assert.doesNotMatch(m.text, /!|amazing|exclusive|limited|hurry/i, 'no hype');
    assert.ok(m.text.split(/\s+/).length < 120, `${m.kind}: short`);
    assert.doesNotMatch(m.text, /bloom berg/i);
  }
  assert.match(all[0].text, /Stripe sends the receipt/);
  assert.match(all[0].text, /works for 30 days/);
  assert.match(all[0].text, /renews one year after that day, at \$420 a year/);
  assert.match(all[1].text, /five years from that day\. It does not renew/);
  assert.match(all[2].text, /If it is not paid by then, the seat is given back and we delete your saved card/);
  assert.match(all[4].subject, /goes live on Dec 2, 2026/);
  assert.doesNotMatch(all[4].text, /receipt/i, 'P9: renewals are never described as sending receipts');
  assert.equal(addYears(Date.UTC(2028, 1, 29), 1), Date.UTC(2029, 2, 1), 'Feb 29 + 1 year is Mar 1');
});

test('scripts/send-outbox.cjs: dry run counts; --send posts each to Cloudflare, takes it out of the file, stops on a failure, never logs bodies', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-send-'));
  try {
    const file = path.join(dir, '.sending-founders-20261201-charge.json');
    const tok = 'C'.repeat(43);
    const list = [
      chargeEmail({ seat: 11, to: 'ann@example.com', token: tok, publicUrl: 'https://bloombroke.com' }),
      failedEmail({ seat: 12, to: 'bob@example.com', token: tok, publicUrl: 'https://bloombroke.com', payUntil: T0 }),
      goliveEmail({ seat: 13, to: 'cy@example.com', goliveAt: GOLIVE }),
    ];
    writeFileSync(file, JSON.stringify(list), { mode: 0o600 });
    const account = 'a'.repeat(32);
    const logs = [];
    const posted = [];
    let failAt = 2;
    const fetchFn = async (url, init) => {
      posted.push({ url, init });
      if (posted.length === failAt) return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ code: 10001, message: 'busy' }] }) };
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };
    const dry = await sender.sendOutbox({ file, token: 'cf_secret_token', accountId: account, fetchFn, log: (l) => logs.push(l) });
    assert.equal(dry.left, 3);
    assert.equal(posted.length, 0);
    const first = await sender.sendOutbox({ file, token: 'cf_secret_token', accountId: account, send: true, fetchFn, log: (l) => logs.push(l) });
    assert.deepEqual([first.sent, first.left], [1, 2]);
    assert.equal(posted[0].url, `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`);
    assert.equal(posted[0].init.method, 'POST');
    assert.equal(posted[0].init.headers.Authorization, 'Bearer cf_secret_token');
    assert.deepEqual(JSON.parse(posted[0].init.body), { to: 'ann@example.com', from: 'Max Reid <hello@bloombroke.com>', reply_to: 'hello@bloombroke.com', subject: list[0].subject, text: list[0].text });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).length, 2, 'the sent one is out of the file');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    failAt = 0;
    const second = await sender.sendOutbox({ file, token: 'cf_secret_token', accountId: account, send: true, fetchFn, log: (l) => logs.push(l) });
    assert.deepEqual([second.sent, second.left], [2, 0]);
    assert.deepEqual(posted.slice(1).map((p) => JSON.parse(p.init.body).to), ['bob@example.com', 'bob@example.com', 'cy@example.com'], 'the failed one is sent again, nothing twice');
    assert.throws(() => statSync(file), /ENOENT/, 'the file is deleted when empty');
    const said = logs.join('\n');
    for (const m of list) { assert.ok(!said.includes(m.subject)); assert.ok(!said.includes(m.to)); }
    assert.ok(!said.includes(tok) && !said.includes('cf_secret_token'));
    assert.match(said, /Cloudflare said 500: 10001 busy/);
    // The token file must be private; the account id is checked.
    const tf = path.join(dir, 'token');
    writeFileSync(tf, 'abc\n', { mode: 0o644 });
    assert.throws(() => sender.readToken(tf), /chmod 600/);
    writeFileSync(tf, 'abc\n', { mode: 0o600 });
    statSync(tf);
    await assert.rejects(sender.sendOutbox({ file, token: 't', accountId: 'nope', fetchFn }), /32 hex/);
    assert.ok(sender.parseArgs(['f.json']).error);
    assert.deepEqual(sender.parseArgs(['f.json', '--token-file', 't', '--send']), { file: 'f.json', tokenFile: 't', accountId: null, send: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stripe setup: the founders product and its $420 yearly price, made once, with the lookup key and metadata', async () => {
  const db = { products: [], prices: [] };
  const created = [];
  let n = 0;
  const stripe = {
    products: { list: () => db.products.filter((p) => p.active), async create(p) { const o = { id: `prod_${++n}`, active: true, ...p }; db.products.push(o); created.push('product'); return o; } },
    prices: { list: ({ product }) => db.prices.filter((p) => p.product === product && p.active), async create(p) { const o = { id: `price_${++n}`, active: true, ...p }; db.prices.push(o); created.push('price'); return o; } },
  };
  // Pro's own product on the same account is not it.
  db.products.push({ id: 'prod_pro', active: true, name: 'Bloombroke Pro', metadata: { site: 'bloombroke', product: 'pro' } });
  const a = await setupFounders({ stripe });
  assert.deepEqual(created, ['product', 'price']);
  const price = db.prices[0];
  assert.deepEqual([price.unit_amount, price.currency, price.recurring, price.lookup_key, price.metadata],
    [42000, 'usd', { interval: 'year', interval_count: 1 }, 'bb_founders_seat_yearly', { site: 'bloombroke', product: 'founders' }]);
  assert.equal(db.products[1].name, 'Bloombroke Pro founder seat');
  assert.equal(a.values.STRIPE_FOUNDERS_PRICE_ID, price.id);
  assert.deepEqual(FOUNDERS_PRICE, { unit_amount: 42000, currency: 'usd', interval: 'year', lookup_key: 'bb_founders_seat_yearly' });
  const b = await setupFounders({ stripe });
  assert.deepEqual(created, ['product', 'price'], 'found on a re-run');
  assert.equal(b.values.STRIPE_FOUNDERS_PRICE_ID, price.id);
  assert.ok(!b.report.join(' ').includes('price_'), 'no ids in the report');
});

test('release: refuses a seat being charged; a charged seat says to refund by hand and its licence ends in the same step', async () => {
  const h = await harness({ goalUsd: 420, http: false });
  try {
    commitSeat(h.db, 12);
    h.db.prepare("UPDATE founders_seats SET charge_state = 'charging', payment_intent_id = 'pi_x' WHERE seat = 12").run();
    const r = await script.release({ db: h.db, stripe: null, seat: 12, execute: true, now: h.now });
    assert.equal(r.done, false);
    assert.match(r.text, /being charged right now/);
    h.db.prepare("UPDATE founders_seats SET charge_state = NULL, payment_intent_id = NULL WHERE seat = 12").run();
    await h.run('charge');
    const licId = h.store.seat(12).licence_id;
    assert.match((await script.release({ db: h.db, seat: 12, now: h.now })).text, /was charged: release does NOT refund\. Refund the payment in the Stripe dashboard/);
    assert.equal(h.licences.findById(licId).status, 'active', 'dry run');
    h.advance(HOUR);
    const out = await script.release({ db: h.db, stripe: h.stripe, seat: 12, execute: true, now: h.now });
    assert.equal(out.done, true, out.text);
    assert.match(out.text, /release does NOT refund/);
    const lic = h.licences.findById(licId);
    assert.equal(lic.status, 'canceled');
    assert.equal(lic.ended_at, h.now());
    assert.equal(proAccess(lic, h.now()).active, false);
    assert.equal(h.store.seat(12).status, 'open');
    assert.equal(h.stripe.refundLog.length, 0, 'never refunds by itself');
    assert.equal(hashKey('x').length, 64);
  } finally { await h.close(); }
});

// ---- reviewer fixes ---------------------------------------------------------------------------

test('fake Stripe idempotency: the same key with other params is refused; the pay link key is the same within a minute and new after it', async () => {
  const stripe = fakeStripe();
  await stripe.paymentIntents.create({ amount: 1 }, { idempotencyKey: 'k1' });
  await assert.rejects(stripe.paymentIntents.create({ amount: 2 }, { idempotencyKey: 'k1' }), (e) => e.type === 'StripeIdempotencyError');
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    const tok = h.token(h.mails()[0], 'pay');
    // The first try dies after Stripe made the session, before it was saved.
    const real = h.founders.store.setPaySession;
    h.founders.store.setPaySession = () => false;
    h.advance(20 * 1000);
    assert.equal((await h.post('/api/founders/pay', { token: tok })).status, 409);
    h.founders.store.setPaySession = real;
    // A retry 20 seconds later: same key, same params, the same session (no error).
    h.advance(20 * 1000);
    const again = await h.post('/api/founders/pay', { token: tok });
    assert.equal(again.status, 200, again.text);
    assert.equal(Object.keys(h.stripe.sessions).length, 1);
    // A minute later (the session expired): a new key, a new session, no idempotency error.
    h.stripe.sessions[h.store.seat(11).pay_session_id].status = 'expired';
    h.advance(MIN);
    assert.equal((await h.post('/api/founders/pay', { token: tok })).status, 200);
    assert.equal(Object.keys(h.stripe.sessions).length, 2);
  } finally { await h.close(); }
});

test('pay webhook: a refund that fails is logged as REFUND FAILED and answered 500, so Stripe retries; it goes through once fixed', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    const { session } = await paidPaySession(h, 11);
    const bad = { ...session, amount_total: 100 };
    const realRefund = h.stripe.refunds.create;
    h.stripe.refunds.create = async () => { throw new Stripe.errors.StripePermissionError({ message: 'no access', code: 'permission_denied' }); };
    const r = await h.sendEvent('checkout.session.completed', bad);
    assert.equal(r.status, 500);
    assert.ok(h.logs.some((l) => /REFUND FAILED seat 11 \(amount\): StripePermissionError permission_denied/.test(l)), h.logs.join('\n'));
    assert.equal(h.store.seat(11).charge_state, 'failed', 'nothing applied');
    h.stripe.refunds.create = realRefund;
    const again = await h.sendEvent('checkout.session.completed', bad);
    assert.equal(again.body.result, 'founders_pay_refunded');
  } finally { await h.close(); }
});

test('pay: the webhook and the success page at the same time: one applies, the other waits (NotYet, 500), then finds it done', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    const { session, pi } = await paidPaySession(h, 11);
    let open;
    let hit;
    const reached = new Promise((r) => { hit = r; });
    const gate = new Promise((r) => { open = r; });
    h.stripe.hooks.piRetrieve = async (pid) => { if (pid === pi) { hit(); await gate; } };
    const page = h.post('/api/founders/paid', { s: session.id, seat: 11 });
    await reached;
    const hook = await h.sendEvent('checkout.session.completed', session);
    assert.equal(hook.status, 500, 'busy: Stripe will send it again');
    h.stripe.hooks.piRetrieve = null;
    open();
    const shown = await page;
    assert.equal(shown.status, 200, shown.text);
    assert.ok(h.licences.findByKey(shown.body.key));
    assert.equal((await h.sendEvent('checkout.session.completed', session)).body.result, 'founders_pay_already');
    assert.equal(h.mails().filter((m) => m.kind === 'key').length, 1);
    assert.equal(h.stripe.refundLog.length, 0);
  } finally { await h.close(); }
});

test('charge: two runs at once on one database charge every seat once, one PaymentIntent and one email each', async () => {
  const h = await harness({ goalUsd: 1840, http: false });
  try {
    for (const s of [1, 11, 12, 13]) commitSeat(h.db, s);
    const ctx2 = createChargeContext({ db: h.db, stripe: h.stripe, licences: h.licences, livemode: 1, now: h.now, log: quiet, priceId: PRICE,
      outbox: createOutbox({ dir: h.outDir, source: 'charge', now: h.now }), deadlineAt: DEADLINE });
    const lines2 = [];
    const [a, b] = await Promise.all([
      script.charge({ ctx: h.ctx, cfg: h.cfg, print: h.print, execute: true }),
      script.charge({ ctx: ctx2, cfg: h.cfg, print: (l) => lines2.push(l), execute: true }),
    ]);
    assert.ok([a.code, b.code].includes(0) || [a.code, b.code].every((c) => c === 2), `${a.code} ${b.code}`);
    // Whatever stopped, a re-run finishes; every seat is charged exactly once.
    await h.run('charge');
    for (const s of [1, 11, 12, 13]) {
      assert.equal(h.store.seat(s).charge_state, 'charged', `seat ${s}`);
      const mine = Object.values(h.stripe.pis).filter((p) => p.metadata.seat === String(s));
      assert.equal(mine.length, 1, `seat ${s}: one PaymentIntent`);
      assert.equal(mine[0].status, 'succeeded');
    }
    assert.deepEqual(h.mails().map((m) => m.seat).sort((x, y) => x - y), [1, 11, 12, 13], 'one email each');
  } finally { await h.close(); }
});

test('golive: a future day is refused (Stripe\'s anchor rule); nothing is saved', async () => {
  const h = await harness({ goalUsd: 420, http: false });
  try {
    commitSeat(h.db, 11);
    await h.run('charge');
    const out = await h.run('golive', { date: '2026-12-05' });
    assert.equal(out.code, 1);
    assert.match(h.lines.at(-1), /Go-live cannot be a future day: run golive on Dec 5, 2026 or later/);
    assert.equal(h.store.state().golive_at, null);
    assert.equal(h.stripe.calls.filter((c) => c[0] === 'sub.create').length, 0);
    // Today is fine.
    assert.equal((await h.run('golive', { date: '2026-12-01' })).code, 0, h.lines.join('\n'));
  } finally { await h.close(); }
});

test('golive: a seat paid by link while golive runs is read after the day is saved, so it gets its step and email', async () => {
  const h = await harness({ goalUsd: 420, http: false });
  try {
    commitSeat(h.db, 11);
    commitSeat(h.db, 12, { pm: 'pm_bad' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    h.set(AFTER_GOLIVE);
    // Seat 12 is applied by the pay link right when the day is being saved.
    const real = h.store.setGolive.bind(h.store);
    h.store.setGolive = (at) => {
      const ok = real(at);
      h.db.prepare("UPDATE founders_seats SET charge_state = 'charged', licence_id = ?, charged_at = ? WHERE seat = 12")
        .run(h.licences.insertFounderLicence({ customerId: 'cus_12', livemode: 1 }).id, h.now());
      return ok;
    };
    assert.equal((await h.run('golive')).code, 0, h.lines.join('\n'));
    assert.ok(h.store.seat(12).subscription_id, 'seat 12 got its renewal');
    assert.deepEqual(h.mails().filter((m) => m.kind === 'golive').map((m) => m.seat), [11, 12]);
  } finally { await h.close(); }
});

test('expire-unpaid: refused while the charge run is not finished (a seat not started or still charging)', async () => {
  const h = await harness({ goalUsd: 420, http: false });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    commitSeat(h.db, 12);
    h.stripe.cards.pm_bad = 'decline';
    h.stripe.cards.pm_12 = 'network';
    await h.run('charge');
    assert.equal(h.store.seat(12).charge_state, 'charging');
    h.set(T0 + PAY_WINDOW_MS + 1);
    const out = await h.run('expire');
    assert.equal(out.code, 1);
    assert.match(h.lines.at(-1), /Refused: the charge run is not finished \(seat 12 not charged yet\)/);
    assert.equal(h.store.seat(11).charge_state, 'failed', 'nothing given back');
    h.stripe.cards.pm_12 = 'ok';
    h.set(T0 + HOUR);
    await h.run('charge');
    h.set(T0 + PAY_WINDOW_MS + 1);
    assert.equal((await h.run('expire')).code, 0);
    assert.equal(h.store.seat(11).status, 'open');
  } finally { await h.close(); }
});

test('outbox: take renames a file for sending under the lock; new emails start a new file; the sender only takes taken files and stops on a permanent bounce', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-take-'));
  try {
    const o = path.join(dir, 'o');
    const ob = createOutbox({ dir: o, source: 'pay', now: () => T0 });
    const tok = 'D'.repeat(43);
    ob.append(keyEmail({ seat: 11, to: 'ann@example.com', token: tok, publicUrl: 'https://bloombroke.com' }));
    const taken = script.takeOutboxFile(o, 'founders-20261201-pay.json');
    assert.equal(path.basename(taken), '.sending-founders-20261201-pay.json');
    assert.equal(statSync(taken).mode & 0o777, 0o600);
    assert.throws(() => script.takeOutboxFile(o, 'founders-20261201-pay.json'), /no file/);
    assert.throws(() => script.takeOutboxFile(o, '../x.json'), /name a waiting file/);
    ob.append(keyEmail({ seat: 12, to: 'bob@example.com', token: tok, publicUrl: 'https://bloombroke.com' }));
    assert.equal(JSON.parse(readFileSync(path.join(o, 'founders-20261201-pay.json'), 'utf8')).length, 1, 'a new file, the taken one untouched');
    assert.equal(JSON.parse(readFileSync(taken, 'utf8')).length, 1);
    assert.throws(() => script.takeOutboxFile(o, 'founders-20261201-pay.json'), /already being sent/);
    const preview = script.outboxPreview(o);
    assert.match(preview, /\.sending-founders-20261201-pay\.json: 1 email \(taken: being sent\)/);
    assert.ok(!preview.includes(tok));
    assert.equal(script.parseArgs(['outbox', '--take', 'founders-20261201-pay.json']).take, 'founders-20261201-pay.json');
    assert.ok(script.parseArgs(['charge', '--take', 'x']).error);
    // A lock left by a dead process is cleared after 30 seconds; a fresh one makes writers wait.
    writeFileSync(path.join(o, '.lock'), '');
    assert.throws(() => ob.append(keyEmail({ seat: 13, to: 'c@example.com', token: tok, publicUrl: 'https://bloombroke.com' })), /busy/);
    const old = (Date.now() - 60 * 1000) / 1000;
    utimesSync(path.join(o, '.lock'), old, old);
    ob.append(keyEmail({ seat: 13, to: 'c@example.com', token: tok, publicUrl: 'https://bloombroke.com' }));
    // The sender: an untaken name is refused; a permanent bounce stops and keeps that email.
    const account = 'b'.repeat(32);
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { delivered: [], permanent_bounces: ['ann@example.com'], queued: [] } }) });
    await assert.rejects(sender.sendOutbox({ file: path.join(o, 'founders-20261201-pay.json'), token: 't', accountId: account, send: true, fetchFn, log: () => {} }), /take the file first/);
    const logs = [];
    const r = await sender.sendOutbox({ file: taken, token: 't', accountId: account, send: true, fetchFn, log: (l) => logs.push(l) });
    assert.deepEqual([r.sent, r.left, r.error], [0, 1, 'bounced']);
    assert.equal(JSON.parse(readFileSync(taken, 'utf8')).length, 1, 'the bounced email stays');
    assert.match(logs.join('\n'), /bounced for good \(a\*\*@example\.com\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('app start: an outbox the app cannot write is logged loudly', () => {
  const db = openDb(':memory:');
  const errors = [];
  createFounders({ db, stripe: null, env: { FOUNDERS_OUTBOX_DIR: path.resolve('var', 'outbox-inside') }, log: { log() {}, error: (m) => errors.push(m) }, licences: createStore(db) });
  assert.ok(errors.some((m) => /OUTBOX NOT WRITABLE/.test(m) && /inside the repo/.test(m)), errors.join('\n'));
});

test('after the deadline: a processing PaymentIntent is not cancelled or given back; a cancel that loses to a payment stops without giving back', async () => {
  const h = await harness({ goalUsd: 420, http: false });
  try {
    commitSeat(h.db, 11);
    commitSeat(h.db, 12);
    for (const s of [11, 12]) {
      const pi = await h.stripe.paymentIntents.create(script.chargeParams(h.store.seat(s)), {});
      h.store.startCharging(s, pi.id);
    }
    const pi11 = h.store.seat(11).payment_intent_id;
    const pi12 = h.store.seat(12).payment_intent_id;
    h.stripe.pis[pi11].status = 'processing';
    h.set(DEADLINE + HOUR);
    assert.equal((await h.run('charge')).code, 2);
    assert.match(h.lines.join('\n'), /seat 11: the payment is processing/);
    assert.ok(!h.lines.join('\n').includes('run charge --execute again'), 'no "run again" after the deadline');
    assert.ok(!h.stripe.calls.some((c) => c[0] === 'pi.cancel'));
    assert.equal(h.store.seat(11).charge_state, 'charging');
    // Seat 11 settles as paid; seat 12 is paid at Stripe just as the cancel goes out.
    Object.assign(h.stripe.pis[pi11], { status: 'succeeded', amount_received: 42000 });
    h.stripe.hooks.cancel = (pid) => { if (pid === pi12) Object.assign(h.stripe.pis[pi12], { status: 'succeeded', amount_received: 42000 }); };
    h.lines.length = 0;
    assert.equal((await h.run('charge')).code, 2);
    assert.equal(h.store.seat(11).charge_state, 'charged');
    assert.match(h.lines.join('\n'), /seat 12: after the deadline, cancelling its PaymentIntent failed: Stripe said StripeInvalidRequestError payment_intent_unexpected_state\. The seat stays 'charging' and is not given back/);
    assert.equal(h.store.seat(12).charge_state, 'charging');
    assert.ok(!h.stripe.calls.some((c) => c[0] === 'customer.del'), 'nothing given back');
    // The next run records the payment.
    h.stripe.hooks.cancel = null;
    assert.equal((await h.run('charge')).code, 0, h.lines.join('\n'));
    assert.equal(h.store.seat(12).charge_state, 'charged');
  } finally { await h.close(); }
});

test('after the deadline: cancel worked but giving back failed has its own message; a failed card whose cancel fails says NOT cancelled', async () => {
  const h = await harness({ goalUsd: 420, http: false });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    commitSeat(h.db, 12);
    h.stripe.cards.pm_bad = 'decline';
    h.stripe.cards.pm_12 = 'network';
    const realCancel = h.stripe.paymentIntents.cancel;
    h.stripe.paymentIntents.cancel = async () => { throw new Stripe.errors.StripePermissionError({ message: 'no access', code: 'permission_denied' }); };
    await h.run('charge');
    assert.match(h.lines.join('\n'), /seat 11: failed \(generic_decline; PaymentIntent NOT cancelled \(StripePermissionError permission_denied\): cancel it in the dashboard\)/);
    assert.equal(h.store.seat(11).charge_state, 'failed', 'still marked failed');
    h.stripe.paymentIntents.cancel = realCancel;
    h.set(DEADLINE + HOUR);
    const realDel = h.stripe.customers.del;
    h.stripe.customers.del = async () => { throw new Stripe.errors.StripeAPIError({ message: 'down', type: 'api_error' }); };
    h.lines.length = 0;
    assert.equal((await h.run('charge')).code, 2);
    assert.match(h.lines.join('\n'), /seat 12: after the deadline its PaymentIntent is cancelled \(nothing charged\), but giving the seat back failed/);
    assert.equal(h.stripe.pis[h.store.seat(12).payment_intent_id].status, 'canceled');
    h.stripe.customers.del = realDel;
    assert.equal((await h.run('charge')).code, 0, h.lines.join('\n'));
    assert.equal(h.store.seat(12).status, 'open');
  } finally { await h.close(); }
});

test('pay success page: a paid session that is not the stored one says it is being refunded; an unknown one stays "does not work"', async () => {
  const h = await harness({ goalUsd: 420 });
  try {
    commitSeat(h.db, 11, { pm: 'pm_bad' });
    h.stripe.cards.pm_bad = 'decline';
    await h.run('charge');
    const { session } = await paidPaySession(h, 11);
    const stray = { ...session, id: 'cs_live_straypaysession01' };
    h.stripe.sessions[stray.id] = stray;
    const r = await h.post('/api/founders/paid', { s: stray.id, seat: 11 });
    assert.equal(r.status, 409);
    assert.equal(r.body.message, 'This payment was not needed and is being refunded in full. Check your email for the right link.');
    const unknown = await h.post('/api/founders/paid', { s: 'cs_live_nosuchsession0001', seat: 11 });
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.message, /This link does not work/);
    h.stripe.sessions[stray.id] = { ...stray, payment_status: 'unpaid', status: 'open' };
    assert.equal((await h.post('/api/founders/paid', { s: stray.id, seat: 11 })).status, 404, 'not paid: no refund message');
  } finally { await h.close(); }
});
