// FOUNDERS SEATS (pro/founders.js, lib/founders-page.js) and TIPS (pro/tips.js): holds,
// checkout, the webhook (commit, duplicates, handles, expiry), the public status, the goal
// math, the deadline, the closed state, the pages, the guide list and the admin scripts.
// Stripe is a fake with real webhook signing, like test/pro.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Stripe from 'stripe';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom } from '../pro/licence.js';
import { STRIPE_API_VERSION, WEBHOOK_EVENTS } from '../pro/billing.js';
import { mountPro } from '../pro/routes.js';
import {
  createFounders, createFoundersStore, mountFounders, handleFoundersEvent, foundersEnv, mandateText, cleanHandle, classOf,
  HOLD_MS, SESSION_MS, CLASSES, FOUNDERS_WEBHOOK_EVENTS, FoundersError,
} from '../pro/founders.js';
import { createTips, mountTips, cleanFishName, tipUsd, tipCheckoutParams, createTipsStore } from '../pro/tips.js';
import { createWaitlistStore, mountWaitlist } from '../pro/waitlist.js';
import { mountFoundersPages, foundersPage, emptyState, COPY } from '../lib/founders-page.js';
import { foundersLine } from '../public/screens/pro.js';
import * as foundersScript from '../scripts/founders.js';
import * as fishScript from '../scripts/fish-review.js';

const SECRET = 'whsec_test_dummy_secret_for_unit_tests';
const AES = revealKeyFrom('x'.repeat(40));
const T0 = Date.UTC(2026, 9, 10, 12); // Oct 10, 2026
const MIN = 60 * 1000;
const quiet = { log() {}, error() {} };
const ORIGIN = { Origin: 'https://bloombroke.com' };

function fakeStripe() {
  const real = new Stripe('sk_test_dummy', { apiVersion: STRIPE_API_VERSION });
  const sessions = {};
  const intents = {};
  const calls = [];
  let n = 0;
  let failCreate = false;
  const missing = () => Object.assign(new Error('No such object'), { statusCode: 404, code: 'resource_missing' });
  return {
    sessions, intents, calls,
    failCreate(v = true) { failCreate = v; },
    webhooks: real.webhooks,
    checkout: {
      sessions: {
        async create(p, opts) {
          calls.push(['checkout.create', p, opts]);
          if (failCreate) throw new Error('stripe down');
          n += 1;
          const id = `cs_test_founders${String(n).padStart(6, '0')}`;
          sessions[id] = { id, object: 'checkout.session', mode: p.mode, status: 'open', metadata: p.metadata, url: `https://checkout.stripe.com/c/pay/${id}` };
          return sessions[id];
        },
        async retrieve(id) { calls.push(['checkout.retrieve', id]); if (!sessions[id]) throw missing(); return sessions[id]; },
      },
    },
    setupIntents: {
      async retrieve(id, p) { calls.push(['si.retrieve', id, p]); if (!intents[id]) throw missing(); return intents[id]; },
    },
    paymentMethods: {
      async detach(id, p, opts) { calls.push(['pm.detach', id, opts]); return { id }; },
      async update(id, p, opts) { calls.push(['pm.update', id, p, opts]); return { id }; },
    },
    customers: {
      async update(id, p, opts) { calls.push(['customer.update', id, p, opts]); return { id }; },
    },
  };
}

// A checkout that finished: the session completes and its SetupIntent holds a card.
function complete(stripe, sessionId, { email = 'ann@example.com', fingerprint = 'fp_ann', handle = null, n = 1 } = {}) {
  const s = stripe.sessions[sessionId];
  Object.assign(s, {
    status: 'complete', setup_intent: `seti_${n}`, customer: `cus_${n}`, livemode: false,
    customer_details: { email },
    custom_fields: handle === null ? [] : [{ key: 'xhandle', type: 'text', text: { value: handle } }],
  });
  stripe.intents[`seti_${n}`] = {
    id: `seti_${n}`, status: 'succeeded', customer: `cus_${n}`, metadata: s.metadata,
    payment_method: { id: `pm_${n}`, card: { fingerprint }, billing_details: { email } },
    mandate: null,
  };
  return s;
}

async function setup({ env = { FOUNDERS: 'open' }, mode = 'test', start = T0, tipsEnv = {} } = {}) {
  let t = start;
  const now = () => t;
  const db = openDb(':memory:');
  const store = createStore(db, { aesKey: AES, now });
  const stripe = fakeStripe();
  const founders = createFounders({ db, stripe, env, mode, webhookReady: true, now, log: quiet });
  const tips = createTips({ db, stripe, env: tipsEnv, webhookReady: true, now, log: quiet });
  const app = express();
  mountPro(app, {
    store, stripe, now, loginDelayMs: 0, log: quiet,
    config: { priceId: 'price_test_pro', webhookSecret: SECRET, proSecretSet: true, publicUrl: 'https://bloombroke.com', mode, checkoutClosed: true },
    onEvent: (event) => handleFoundersEvent(event, { founders: founders.store, tips, stripe, log: quiet }),
  });
  mountFounders(app, { founders, now, log: quiet });
  mountTips(app, { tips, now, log: quiet });
  mountWaitlist(app, { store: createWaitlistStore(db, { now }), checkoutClosed: false, now, log: quiet });
  mountFoundersPages(app, { founders, tips, log: quiet });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, { body, headers = {}, raw } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const sendEvent = (event) => {
    const payload = JSON.stringify(event);
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) });
    return req('POST', '/api/stripe/webhook', { raw: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig } });
  };
  const checkout = (body) => req('POST', '/api/founders/checkout', { body, headers: ORIGIN });
  const close = () => new Promise((r) => server.close(r));
  return { db, store, stripe, founders, tips, req, sendEvent, checkout, close, advance(ms) { t += ms; }, now };
}

let ev = 0;
const evt = (type, object) => ({ id: `evt_f_${++ev}`, object: 'event', type, created: Math.floor(T0 / 1000), data: { object } });

// ---- config, copy, rules --------------------------------------------------------------

test('config: FOUNDERS=open, the goal and the deadline, with safe defaults', () => {
  const d = foundersEnv({});
  assert.deepEqual([d.open, d.goalUsd, d.deadline], [false, 17640, '2026-12-15']);
  assert.equal(d.deadlineAt, Date.UTC(2026, 11, 15, 23, 59, 59, 999), 'the end of that day, UTC');
  assert.equal(foundersEnv({ FOUNDERS: 'OPEN ' }).open, true);
  assert.equal(foundersEnv({ FOUNDERS: 'yes' }).open, false);
  assert.equal(foundersEnv({ FOUNDERS_GOAL_USD: '20000' }).goalUsd, 20000);
  for (const bad of ['0', '-5', '1e5', 'abc', '17640.5']) assert.equal(foundersEnv({ FOUNDERS_GOAL_USD: bad }).goalUsd, 17640, bad);
  assert.equal(foundersEnv({ FOUNDERS_DEADLINE: '2027-01-31' }).deadline, '2027-01-31');
  for (const bad of ['2026-02-30', '15-12-2026', 'soon']) assert.equal(foundersEnv({ FOUNDERS_DEADLINE: bad }).deadline, '2026-12-15', bad);
});

test('seat classes and the goal math: ten-year 1 to 10 at $1,420, founder 11 to 42 at $420', () => {
  assert.equal(classOf(1), 'ten');
  assert.equal(classOf(10), 'ten');
  assert.equal(classOf(11), 'founder');
  assert.equal(classOf(42), 'founder');
  assert.equal(CLASSES.ten.usd, 1420);
  assert.equal(CLASSES.founder.usd, 420);
  assert.equal(10 * 1420 + 32 * 420, 27640, 'every seat taken is more than the goal');
  const db = openDb(':memory:');
  const s = createFoundersStore(db, { now: () => T0 });
  assert.equal(s.seats().length, 42);
  db.prepare("UPDATE founders_seats SET status = 'committed' WHERE seat IN (1, 2, 11, 12, 13)").run();
  assert.deepEqual(s.totals(), { committedUsd: 2 * 1420 + 3 * 420, seatsTaken: 5, held: 0 });
  assert.throws(() => db.prepare("UPDATE founders_seats SET class = 'founder' WHERE seat = 3").run(), /CHECK/, 'a seat cannot change class');
});

test('the mandate: the class amount, the goal, the deadline, the way out; inside Stripe\'s limit', () => {
  const at = foundersEnv({}).deadlineAt;
  const f = mandateText('founder', { goalUsd: 17640, deadlineAt: at });
  assert.equal(f, 'You are saving a card. We charge $420 a year for this founder seat, only when founders reach $17,640, and no later than Dec 15, 2026. If the goal is not reached by then, we delete the card and you pay nothing. You can give up your seat before the charge by emailing hello@bloombroke.com.');
  const t = mandateText('ten', { goalUsd: 17640, deadlineAt: at });
  assert.match(t, /We charge \$1,420 once for this ten-year seat, only when founders reach \$17,640/);
  for (const s of [f, t]) {
    assert.ok(s.length <= 1200);
    assert.doesNotMatch(s, /—|lifetime/i);
  }
});

test('X handles: a leading @ goes, 1 to 15 of A-Z a-z 0-9 _, nothing rude or staff-like, else none', () => {
  assert.equal(cleanHandle('@maxdev'), 'maxdev');
  assert.equal(cleanHandle(' Max_Dev_01 '), 'Max_Dev_01');
  for (const bad of ['', '@', 'a b', 'toolonghandle1234', 'https://x.com/a', 'max.dev', '@@max', 'admin_tom', 'BloombrokeHQ', null, 42]) assert.equal(cleanHandle(bad), null, String(bad));
});

test('fish names: 2 to 16 letters, digits or spaces; no @, no link, nothing rude; kept raw for review', () => {
  assert.deepEqual(cleanFishName('  Big   Blue '), { raw: 'Big Blue', name: 'Big Blue' });
  assert.deepEqual(cleanFishName('Nemo 2'), { raw: 'Nemo 2', name: 'Nemo 2' });
  for (const bad of ['a', 'me@x.co', 'www example com', 'fish.com', 'Admin Fish', 'bloom broke']) assert.equal(cleanFishName(bad).name, null, bad);
  assert.equal(cleanFishName('x'.repeat(30)).raw.length, 16, 'kept to 16 for review');
  assert.equal(cleanFishName(undefined).raw, null);
  assert.deepEqual([tipUsd(5), tipUsd(3), tipUsd(200), tipUsd('20'), tipUsd(2), tipUsd(201), tipUsd(10.5), tipUsd('1e2'), tipUsd(null)], [5, 3, 200, 20, null, null, null, null, null]);
});

// ---- holds ------------------------------------------------------------------------------

test('holds: one seat, one hold; the lowest free seat of a class; a hold runs out and the seat opens again', () => {
  let t = T0;
  const db = openDb(':memory:');
  const s = createFoundersStore(db, { now: () => t });
  const a = s.hold({ seat: 12, ip: '203.0.113.9' });
  assert.equal(a.seat, 12);
  assert.equal(a.cls, 'founder');
  assert.throws(() => s.hold({ seat: 12 }), (e) => e instanceof FoundersError && e.code === 'taken');
  assert.equal(s.hold({ cls: 'founder' }).seat, 11, 'the lowest open founder seat');
  assert.equal(s.hold({ cls: 'founder' }).seat, 13, '12 is held');
  assert.equal(s.hold({ cls: 'ten' }).seat, 1);
  assert.equal(s.seats().find((x) => x.seat === 12).status, 'held');
  assert.equal(HOLD_MS, SESSION_MS + 2 * MIN, 'held longer than the Stripe session can live');
  t += HOLD_MS - 1;
  assert.equal(s.seats().find((x) => x.seat === 12).status, 'held');
  t += 1;
  const after = s.seats().find((x) => x.seat === 12);
  assert.equal(after.status, 'open', 'opened again on read');
  assert.equal(s.seat(12).mandate_ip, null, 'the address of an abandoned checkout is not kept');
  for (let i = 1; i <= 10; i++) s.hold({ seat: i });
  assert.throws(() => s.hold({ cls: 'ten' }), (e) => e.code === 'full');
});

// ---- checkout -----------------------------------------------------------------------------

test('checkout: setup mode, server-side class and metadata, the handle field, the mandate, an idempotency key', async () => {
  const s = await setup();
  try {
    const r = await s.checkout({ seat: 7 });
    assert.equal(r.status, 200);
    assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);
    const [, p, opts] = s.stripe.calls.find((c) => c[0] === 'checkout.create');
    assert.equal(p.mode, 'setup');
    assert.deepEqual(p.payment_method_types, ['card']);
    assert.equal(p.customer_creation, 'always');
    assert.deepEqual(p.metadata, { site: 'bloombroke', product: 'founders', seat: '7', class: 'ten' });
    assert.deepEqual(p.setup_intent_data.metadata, p.metadata);
    assert.equal(p.success_url, 'https://bloombroke.com/founders?seat=7&s={CHECKOUT_SESSION_ID}');
    assert.equal(p.cancel_url, 'https://bloombroke.com/founders');
    assert.equal(p.expires_at, Math.floor((T0 + SESSION_MS) / 1000));
    assert.deepEqual(p.custom_fields[0].label, { type: 'custom', custom: 'X handle (optional, shown on your seat)' });
    assert.equal(p.custom_fields[0].optional, true);
    assert.match(p.custom_text.submit.message, /^You are saving a card\. We charge \$1,420 once for this ten-year seat/);
    assert.equal(p.consent_collection.terms_of_service, 'required');
    assert.ok(!('line_items' in p) && !JSON.stringify(p).includes('unit_amount'), 'nothing is charged at checkout');
    assert.match(opts.idempotencyKey, /^bb-founders-checkout-7-[0-9a-f]{24}$/);
    const row = s.founders.store.seat(7);
    assert.equal(row.status, 'held');
    assert.equal(row.checkout_session_id, 'cs_test_founders000001');
    // The class alone: the lowest open seat of it; a body cannot name a price.
    const c = await s.checkout({ class: 'founder', price: 1, amount: 1 });
    assert.equal(c.body.seat, 11);
    assert.equal(s.stripe.calls.filter((x) => x[0] === 'checkout.create')[1][1].metadata.class, 'founder');
    // Taken, bad, cross-origin.
    assert.equal((await s.checkout({ seat: 7 })).body.error, 'taken');
    for (const seat of [0, 43, 1.5, '7a', -1]) assert.equal((await s.checkout({ seat })).status, 400, String(seat));
    assert.equal((await s.checkout({})).status, 400);
    assert.equal((await s.req('POST', '/api/founders/checkout', { body: { seat: 9 }, headers: { Origin: 'https://evil.example' } })).status, 403);
  } finally { await s.close(); }
});

test('checkout: Stripe down releases the hold; the per-IP limit holds', async () => {
  const s = await setup();
  try {
    s.stripe.failCreate(true);
    const r = await s.checkout({ seat: 20 });
    assert.equal(r.status, 503);
    assert.equal(s.founders.store.seat(20).status, 'open', 'the hold is let go');
    s.stripe.failCreate(false);
    let last;
    for (let i = 0; i < 12; i++) last = await s.checkout({ class: 'founder' });
    assert.equal(last.status, 429);
  } finally { await s.close(); }
});

test('closed: FOUNDERS unset, or open without Stripe: the page says so, checkout refuses, status says open: false', async () => {
  const s = await setup({ env: {} });
  try {
    const r = await s.checkout({ seat: 12 });
    assert.equal(r.status, 503);
    assert.equal(r.body.message, 'Seats open soon.');
    assert.equal(s.stripe.calls.length, 0);
    const st = (await s.req('GET', '/api/founders/status')).body;
    assert.equal(st.open, false);
    assert.equal(st.testMode, false, 'no test badge while closed');
    const page = (await s.req('GET', '/founders')).text;
    assert.ok(page.includes(COPY.soon));
    assert.ok(!page.includes('class="fd-pick"'), 'no seat buttons');
    assert.equal((page.match(/data-class="(ten|founder)" data-label="[^"]+" disabled>/g) || []).length, 2, 'both class buttons disabled');
    assert.ok(!page.includes('TEST MODE'));
  } finally { await s.close(); }
  const db = openDb(':memory:');
  const f = createFounders({ db, stripe: null, env: { FOUNDERS: 'open' }, webhookReady: false, log: quiet });
  assert.equal(f.isOpen(T0), false, 'no Stripe: closed');
});

test('after the deadline: final numbers, "Seats closed", no new seats', async () => {
  const s = await setup({ start: Date.UTC(2026, 11, 16, 0, 0, 1) });
  try {
    const r = await s.checkout({ seat: 12 });
    assert.equal(r.status, 410);
    assert.equal(r.body.error, 'ended');
    const st = (await s.req('GET', '/api/founders/status')).body;
    assert.equal(st.open, false);
    assert.equal(st.ended, true);
    const page = (await s.req('GET', '/founders')).text;
    assert.ok(page.includes('Seats closed on Dec 15, 2026.'));
    assert.match(page, /<dt class="tag">Closed<\/dt>/);
    assert.ok(!page.includes('Save a founder seat') && !page.includes('class="fd-pick"'), 'nothing to press');
  } finally { await s.close(); }
  const at = foundersEnv({}).deadlineAt;
  const s2 = await setup({ start: at });
  try { assert.equal((await s2.checkout({ seat: 12 })).status, 200, 'the last millisecond of the day still counts'); } finally { await s2.close(); }
});

// ---- webhook --------------------------------------------------------------------------------

test('webhook: a completed checkout commits the seat with the card, email, handle and mandate; status shows no private field', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 12 });
    const session = complete(s.stripe, 'cs_test_founders000001', { email: 'Ann@Example.com', handle: '@ann_dev' });
    const first = evt('checkout.session.completed', session);
    const r = await s.sendEvent(first);
    assert.equal(r.status, 200);
    assert.equal(r.body.result, 'founders_committed');
    const row = s.founders.store.seat(12);
    assert.equal(row.status, 'committed');
    assert.equal(row.email, 'ann@example.com');
    assert.equal(row.handle, 'ann_dev');
    assert.equal(row.card_fingerprint, 'fp_ann');
    assert.equal(row.payment_method_id, 'pm_1');
    assert.equal(row.stripe_customer_id, 'cus_1');
    assert.equal(row.setup_intent_id, 'seti_1');
    assert.equal(row.mandate_at, T0, 'the event time when Stripe gives no mandate');
    assert.equal(row.mandate_ip, '127.0.0.1', 'the address that started the checkout');
    assert.equal(row.livemode, 0);
    // Tagged at Stripe, with idempotency keys.
    const cu = s.stripe.calls.find((c) => c[0] === 'customer.update');
    assert.deepEqual(cu[2].metadata, { site: 'bloombroke', product: 'founders', seat: '12', class: 'founder' });
    assert.equal(cu[3].idempotencyKey, 'bb-founders-customer-cus_1-12');
    assert.equal(s.stripe.calls.find((c) => c[0] === 'pm.update')[3].idempotencyKey, 'bb-founders-pm-pm_1-12');
    // The same event again: nothing new.
    assert.equal((await s.sendEvent(first)).body.result, 'duplicate');
    // Another event for the same session (Stripe can send one twice under two ids).
    assert.equal((await s.sendEvent(evt('checkout.session.completed', session))).body.result, 'founders_already');
    // Status: numbers and handles, never private fields.
    const st = await s.req('GET', '/api/founders/status');
    assert.equal(st.headers.get('cache-control'), 'public, max-age=30');
    assert.equal(st.body.committedUsd, 420);
    assert.equal(st.body.seatsTaken, 1);
    assert.equal(st.body.seatsTotal, 42);
    assert.equal(st.body.goalUsd, 17640);
    assert.equal(st.body.testMode, true);
    assert.deepEqual(st.body.seats.find((x) => x.seat === 12), { seat: 12, class: 'founder', status: 'committed', handle: 'ann_dev' });
    assert.deepEqual(Object.keys(st.body.seats[0]).sort(), ['class', 'handle', 'seat', 'status']);
    for (const secret of ['ann@example.com', 'cus_1', 'pm_1', 'seti_1', 'fp_ann', 'cs_test_', '127.0.0.1']) assert.ok(!st.text.includes(secret), secret);
  } finally { await s.close(); }
});

test('webhook: one seat per email and per card; the second card is detached and its seat opens again', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 12 });
    await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000001', { email: 'ann@example.com', fingerprint: 'fp_a', n: 1 })));
    // The same email, another card.
    await s.checkout({ seat: 13 });
    let r = await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000002', { email: 'ANN@example.com', fingerprint: 'fp_b', n: 2 })));
    assert.equal(r.body.result, 'founders_duplicate');
    assert.equal(s.founders.store.seat(13).status, 'open');
    const det = s.stripe.calls.find((c) => c[0] === 'pm.detach');
    assert.deepEqual([det[1], det[2].idempotencyKey], ['pm_2', 'bb-founders-detach-pm_2']);
    // The same card, another email.
    await s.checkout({ seat: 14 });
    r = await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000003', { email: 'bob@example.com', fingerprint: 'fp_a', n: 3 })));
    assert.equal(r.body.result, 'founders_duplicate');
    assert.equal(s.founders.store.seat(14).status, 'open');
    assert.equal(s.founders.store.totals().seatsTaken, 1);
    // A duplicate never writes a public log line (no seat was ever shown as taken).
    assert.deepEqual(s.founders.store.logs(), []);
  } finally { await s.close(); }
});

test('webhook: a hold gone by the time the card is saved takes the lowest free seat of the class; a full class detaches the card', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 30 });
    s.db.prepare("UPDATE founders_seats SET status = 'open', checkout_session_id = NULL, hold_token = NULL WHERE seat = 30").run();
    const r = await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000001', { n: 1 })));
    assert.equal(r.body.result, 'founders_committed');
    assert.equal(s.founders.store.seat(11).status, 'committed', 'the lowest open founder seat');
    // Every ten-year seat taken: a ten-year checkout that finishes gets none.
    await s.checkout({ seat: 1 });
    s.db.prepare("UPDATE founders_seats SET status = 'committed', email = 'x' || seat || '@x.co' WHERE class = 'ten' AND checkout_session_id IS NOT 'cs_test_founders000002'").run();
    s.db.prepare("UPDATE founders_seats SET status = 'committed', email = 'z@x.co' WHERE seat = 1").run();
    s.db.prepare("UPDATE founders_seats SET checkout_session_id = NULL WHERE seat = 1").run();
    const f = await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000002', { email: 'new@x.co', fingerprint: 'fp_new', n: 2 })));
    assert.equal(f.body.result, 'founders_full');
    assert.ok(s.stripe.calls.some((c) => c[0] === 'pm.detach' && c[1] === 'pm_2'));
  } finally { await s.close(); }
});

test('webhook: checkout.session.expired lets the hold go; setup_intent.succeeded only confirms; other events go on to Pro', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 25 });
    const sess = s.stripe.sessions.cs_test_founders000001;
    let r = await s.sendEvent(evt('checkout.session.expired', { ...sess, status: 'expired' }));
    assert.equal(r.body.result, 'founders_released');
    assert.equal(s.founders.store.seat(25).status, 'open');
    r = await s.sendEvent(evt('checkout.session.expired', { ...sess, status: 'expired' }));
    assert.equal(r.body.result, 'founders_expired', 'nothing held any more');
    await s.checkout({ seat: 26 });
    const done = complete(s.stripe, 'cs_test_founders000002', { n: 2 });
    r = await s.sendEvent(evt('setup_intent.succeeded', s.stripe.intents.seti_2));
    assert.equal(r.body.result, 'founders_wait');
    await s.sendEvent(evt('checkout.session.completed', done));
    r = await s.sendEvent(evt('setup_intent.succeeded', s.stripe.intents.seti_2));
    assert.equal(r.body.result, 'founders_already');
    // Not ours: Pro's own handling (a Pro session that is not paid is ignored, as before).
    r = await s.sendEvent(evt('checkout.session.completed', { id: 'cs_test_pro0000000001', mode: 'subscription', status: 'open', metadata: { site: 'bloombroke', product: 'pro' } }));
    assert.equal(r.body.result, 'ignored');
    r = await s.sendEvent(evt('checkout.session.completed', { id: 'cs_test_other00000001', mode: 'setup', status: 'complete', metadata: { site: 'nomorepurple', product: 'founders' } }));
    assert.equal(r.body.result, 'ignored', 'another site on the shared account');
    // A bad signature never reaches the founders code.
    const bad = await s.req('POST', '/api/stripe/webhook', { raw: JSON.stringify(evt('checkout.session.completed', done)), headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad' } });
    assert.equal(bad.status, 400);
  } finally { await s.close(); }
  assert.deepEqual(FOUNDERS_WEBHOOK_EVENTS, ['checkout.session.completed', 'checkout.session.expired', 'setup_intent.succeeded']);
  assert.ok(WEBHOOK_EVENTS.includes('checkout.session.completed'));
});

test('webhook: a Stripe failure while committing is retried (500), and the retry commits once', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 15 });
    const done = complete(s.stripe, 'cs_test_founders000001', { n: 1 });
    const keep = s.stripe.setupIntents.retrieve;
    s.stripe.setupIntents.retrieve = async () => { throw new Error('network down'); };
    const e = evt('checkout.session.completed', done);
    assert.equal((await s.sendEvent(e)).status, 500);
    assert.equal(s.founders.store.seat(15).status, 'held');
    s.stripe.setupIntents.retrieve = keep;
    assert.equal((await s.sendEvent(e)).body.result, 'founders_committed');
  } finally { await s.close(); }
});

// ---- the page ------------------------------------------------------------------------------

test('page: open in test mode, with seats committed: the badge, the bar, the grid, the handles as plain text', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 3 });
    await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000001', { handle: '<b>x</b>', n: 1 })));
    await s.checkout({ seat: 12 });
    await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000002', { email: 'b@x.co', fingerprint: 'fp_b', handle: 'bob', n: 2 })));
    const r = await s.req('GET', '/founders');
    assert.equal(r.status, 200);
    const html = r.text;
    assert.match(html, /<title>Founders seats \| Bloombroke<\/title>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/bloombroke\.com\/founders">/);
    assert.match(html, /<h1 class="card-hero card-hero-44 num">Founders seats<\/h1>/);
    assert.ok(html.includes('Licensed live prices cost $15,300 a year. When founders commit $17,640, Pro goes live.'));
    assert.ok(html.includes('<span class="fd-badge">TEST MODE</span>'));
    assert.match(html, /<progress class="fd-bar" max="17640" value="1840"/);
    assert.ok(html.includes('<dd class="num">$1,840</dd>') && html.includes('of $17,640 committed'));
    assert.ok(html.includes('<dd class="num">2</dd>') && html.includes('of 42 seats'));
    assert.ok(html.includes('<dd class="num">Dec 15, 2026</dd>'));
    assert.ok(html.includes(COPY.open));
    assert.equal((html.match(/class="fd-pick"/g) || []).length, 40, 'every open seat can be picked');
    assert.ok(html.includes('<span class="fd-handle">@bob</span>'));
    assert.ok(!html.includes('<b>x</b>') && !/@&lt;b/.test(html), 'a bad handle is dropped, never shown');
    assert.doesNotMatch(html, /<a [^>]*>@bob/, 'a handle is never a link');
    assert.equal((html.match(/btn-solid/g) || []).length, 1, 'one solid button');
    assert.ok(html.includes('<summary>How it works</summary>'));
    assert.ok(html.includes('If the goal is not reached by Dec 15, 2026, we delete every saved card and nobody pays.'));
    assert.ok(html.includes('Team seats for newsletters and communities: $25 a seat a month, from 10 seats.'));
    assert.ok(html.includes('href="mailto:hello@bloombroke.com?subject=Team%20seats"'));
    assert.ok(html.includes('Not financial advice. <a href="/terms">Terms</a>'));
    assert.ok(html.includes('/goal.js'), 'analytics on the plain page');
    assert.ok(!html.includes('Fuel the feed'), 'TIPS closed: nothing about tips');
    for (const bad of [/—/, /lifetime/i, new RegExp(['bloom', 'berg'].join(''), 'i'), /style="/]) assert.doesNotMatch(html, bad);
  } finally { await s.close(); }
});

test('page: back from checkout (?s=): "Seat N is yours.", committed from Stripe if the webhook is late, no analytics', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 9 });
    complete(s.stripe, 'cs_test_founders000001', { n: 1 });
    const r = await s.req('GET', '/founders?seat=9&s=cs_test_founders000001');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(r.text.includes('Seat 9 is yours. Nobody pays until the goal is reached.'));
    assert.ok(!r.text.includes('/goal.js'), 'no analytics with the session id in the address');
    assert.equal(s.founders.store.seat(9).status, 'committed');
    // The webhook after it: already done.
    const w = await s.sendEvent(evt('checkout.session.completed', s.stripe.sessions.cs_test_founders000001));
    assert.equal(w.body.result, 'founders_already');
    // A made-up or other site's session: no line at all.
    assert.ok(!(await s.req('GET', '/founders?s=cs_test_nosuchsession00')).text.includes('card-alert'));
    assert.ok(!(await s.req('GET', '/founders?s=javascript:alert(1)')).text.includes('card-alert'));
    // A second seat for the same person, finished: the failed line.
    await s.checkout({ seat: 10 });
    complete(s.stripe, 'cs_test_founders000002', { n: 2 });
    const f = await s.req('GET', '/founders?s=cs_test_founders000002');
    assert.ok(f.text.includes('This checkout did not save a seat: one seat per person.'));
  } finally { await s.close(); }
});

test('page: no database: the seats closed, no made-up numbers', () => {
  const html = foundersPage(emptyState({}), {});
  assert.ok(html.includes(COPY.soon));
  assert.ok(!html.includes('<progress'), 'no bar without real numbers');
  assert.ok(!html.includes('fd-grid'));
});

// ---- tips -----------------------------------------------------------------------------------

test('tips: closed by default (404, nothing on the page); open: the card, server-side price, the stored amount is Stripe\'s', async () => {
  const closed = await setup();
  try {
    assert.equal((await closed.req('POST', '/api/tips/checkout', { body: { usd: 10 }, headers: ORIGIN })).status, 404);
    assert.ok(!(await closed.req('GET', '/founders')).text.includes('fd-tips'));
  } finally { await closed.close(); }
  const s = await setup({ tipsEnv: { TIPS: 'open' } });
  try {
    for (const usd of [2, 201, 10.5, '1e2', null]) assert.equal((await s.req('POST', '/api/tips/checkout', { body: { usd }, headers: ORIGIN })).status, 400, String(usd));
    assert.equal((await s.req('POST', '/api/tips/checkout', { body: { usd: 10 }, headers: { Origin: 'https://evil.example' } })).status, 403);
    const r = await s.req('POST', '/api/tips/checkout', { body: { usd: 25 }, headers: ORIGIN });
    assert.equal(r.status, 200);
    const [, p, opts] = s.stripe.calls.find((c) => c[0] === 'checkout.create');
    assert.equal(p.mode, 'payment');
    assert.equal(p.line_items[0].price_data.unit_amount, 2500);
    assert.deepEqual(p.metadata, { site: 'bloombroke', product: 'tip', usd: '25' });
    assert.equal(p.payment_intent_data.metadata.site, 'bloombroke');
    assert.deepEqual(p.custom_fields[0].text, { minimum_length: 2, maximum_length: 16 });
    assert.match(opts.idempotencyKey, /^bb-tip-checkout-[0-9a-f]{24}$/);
    // Paid: Stripe's amount_total is what counts.
    const sess = { ...s.stripe.sessions.cs_test_founders000001, status: 'complete', payment_status: 'paid', amount_total: 2500, currency: 'usd', livemode: false, custom_fields: [{ key: 'fishname', text: { value: 'Big Blue' } }] };
    assert.equal((await s.sendEvent(evt('checkout.session.completed', sess))).body.result, 'tip');
    assert.equal((await s.sendEvent(evt('checkout.session.completed', sess))).body.result, 'tip_already');
    assert.equal((await s.sendEvent(evt('checkout.session.completed', { ...sess, id: 'cs_test_unpaid000001', payment_status: 'unpaid' }))).body.result, 'tip_unpaid');
    assert.equal(s.tips.store.monthUsd(), 25);
    assert.deepEqual(s.tips.fish(), [{ name: 'Fish #1', big: true }], 'pending: Fish #1 until approved');
    const page = (await s.req('GET', '/founders')).text;
    assert.ok(page.includes('Fuel the feed') && page.includes('A tip is a gift, not a seat.') && page.includes('Tips this month: $25.'));
    assert.match(page, /\$1,420/, 'the founders bar is untouched by tips');
    assert.ok(page.includes('<progress class="fd-bar" max="17640" value="0"'));
    assert.equal((page.match(/btn-solid/g) || []).length, 1, 'still one solid button with the tips card');
    assert.ok((await s.req('GET', '/founders?tip=thanks')).text.includes(COPY.tipThanks));
  } finally { await s.close(); }
  const p = tipCheckoutParams({ usd: 5, publicUrl: 'https://bloombroke.com/' });
  assert.equal(p.success_url, 'https://bloombroke.com/founders?tip=thanks#fuel');
  assert.ok(!p.success_url.includes('CHECKOUT_SESSION_ID'), 'no session id in the address');
});

test('tips: the FISHTANK list, newest 100, approved names only, big from $20, gone after 365 days', () => {
  let t = T0;
  const db = openDb(':memory:');
  const s = createTipsStore(db, { now: () => t });
  s.add({ sessionId: 'cs_1', amountCents: 500, raw: 'Nemo' });
  t += 1000;
  s.add({ sessionId: 'cs_2', amountCents: 2000, raw: 'rude words' });
  assert.deepEqual(s.fishtank(), [{ name: 'Fish #2', big: true }, { name: 'Fish #1', big: false }]);
  s.approve(1, 'Nemo');
  s.remove(2);
  assert.deepEqual(s.fishtank(), [{ name: 'Fish #2', big: true }, { name: 'Nemo', big: false }]);
  for (let i = 3; i <= 110; i++) s.add({ sessionId: `cs_${i}`, amountCents: 300 });
  assert.equal(s.fishtank().length, 100);
  t += 365 * 24 * 60 * MIN;
  assert.deepEqual(s.fishtank(), [], 'a year on, the fish are gone');
  assert.equal(s.monthUsd(Date.UTC(2026, 9, 31)), 5 + 20 + 108 * 3, 'this month: every tip of October');
  assert.equal(s.monthUsd(Date.UTC(2026, 10, 1)), 0, 'a new month starts at $0');
});

test('scripts/fish-review.js: dry run by default; approve, rename and remove keep to the rules', () => {
  const db = openDb(':memory:');
  const s = createTipsStore(db, { now: () => T0 });
  s.add({ sessionId: 'cs_1', amountCents: 500, raw: 'Nemo' });
  s.add({ sessionId: 'cs_2', amountCents: 500, raw: 'me@x.co' });
  assert.match(fishScript.apply({ db, cmd: 'approve', id: 1 }).text, /^Dry run\. Tip #1: shown as "Nemo"/);
  assert.equal(s.one(1).status, 'pending');
  assert.equal(fishScript.apply({ db, cmd: 'approve', id: 1, execute: true }).done, true);
  assert.equal(s.one(1).fish_name, 'Nemo');
  assert.match(fishScript.apply({ db, cmd: 'approve', id: 2, execute: true }).text, /fails the name rules/);
  assert.equal(fishScript.apply({ db, cmd: 'rename', id: 2, name: 'Sir Fin', execute: true }).done, true);
  assert.equal(s.one(2).fish_name, 'Sir Fin');
  assert.equal(fishScript.apply({ db, cmd: 'rename', id: 2, name: 'http x', execute: true }).done, false);
  assert.equal(fishScript.apply({ db, cmd: 'remove', id: 2, execute: true }).done, true);
  assert.equal(s.one(2).fish_name, null);
  assert.deepEqual(fishScript.parseArgs(['rename', '3', 'Big', 'Blue']), { cmd: 'rename', id: 3, name: 'Big Blue', all: false, execute: false, db: null });
  assert.ok(fishScript.parseArgs(['approve']).error);
  assert.match(fishScript.listText(s.all()), /#1 {2}\$5/);
});

// ---- the admin script, the guide list, PRO's line ----------------------------------------

test('scripts/founders.js: release is a dry run unless --execute; it detaches the card, opens the seat, logs one line', async () => {
  let t = Date.UTC(2026, 10, 3, 9);
  const db = openDb(':memory:');
  const store = createFoundersStore(db, { now: () => t });
  db.prepare("UPDATE founders_seats SET status = 'committed', payment_method_id = 'pm_9', email = 'a@x.co' WHERE seat = 12").run();
  const stripe = fakeStripe();
  const dry = await foundersScript.release({ db, stripe, seat: 12, now: () => t });
  assert.equal(dry.done, false);
  assert.match(dry.text, /^Dry run/);
  assert.equal(stripe.calls.length, 0);
  const out = await foundersScript.release({ db, stripe, seat: 12, execute: true, now: () => t });
  assert.equal(out.done, true);
  assert.deepEqual(stripe.calls[0].slice(0, 2), ['pm.detach', 'pm_9']);
  assert.equal(stripe.calls[0][2].idempotencyKey, 'bb-founders-detach-pm_9');
  const row = store.seat(12);
  assert.equal(row.status, 'open');
  assert.equal(row.email, null);
  assert.deepEqual(store.logs().map((l) => l.text), ['Seat 12 released Nov 3.']);
  assert.match((await foundersScript.release({ db, stripe, seat: 12, execute: true })).text, /nothing to release/);
  assert.match(foundersScript.listText(store.list()), /0 committed, \$0\./);
  assert.equal(foundersScript.exportCsv([{ seat: 3, class: 'ten', status: 'committed', email: 'a,b@x.co', handle: null, stripe_customer_id: 'cus_1', mandate_at: T0, mandate_ip: null, livemode: 0 }]), `seat,class,email,handle,stripe_customer_id,committed_at,mandate_ip,livemode\n3,ten,"a,b@x.co",,cus_1,${new Date(T0).toISOString()},,0\n`);
  assert.deepEqual(foundersScript.parseArgs(['release', '7', '--execute']), { cmd: 'release', seat: 7, execute: true, live: false, db: null, env: null });
  assert.ok(foundersScript.parseArgs(['release', '43']).error);
  assert.ok(foundersScript.parseArgs(['charge']).error, 'the charge is not this script');
  // The log is public: the status shows it, counts only.
  const f = createFounders({ db, stripe: null, env: {}, log: quiet, now: () => t });
  assert.deepEqual(f.status().log.map((l) => l.text), ['Seat 12 released Nov 3.']);
});

test('guide list: POST ?source=guide works with Pro checkout open, its own list; the Pro list stays 404 then', async () => {
  const s = await setup();
  try {
    const join = (url, body, headers = ORIGIN) => s.req('POST', url, { body, headers });
    assert.equal((await join('/api/pro/waitlist?source=guide', { email: 'Ann@Example.com' })).status, 200);
    assert.equal((await join('/api/pro/waitlist', { email: 'ann@example.com' })).status, 404, 'checkout open: no Pro list');
    assert.equal((await join('/api/pro/waitlist?source=other', { email: 'ann@example.com' })).status, 404);
    assert.equal((await join('/api/pro/waitlist?source=guide', { email: 'ann@example.com' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await join('/api/pro/waitlist?source=guide', { email: 'bot@example.com', hp: 'x' })).status, 200);
    const rows = s.db.prepare('SELECT email, source FROM waitlist ORDER BY id').all();
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ email: 'ann@example.com', source: 'guide' }]);
    // One address on both lists.
    s.db.prepare("INSERT INTO waitlist (email, created_at, source) VALUES ('ann@example.com', 1, 'pro-soon')").run();
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE email = 'ann@example.com'").get().n, 2);
    const g = await s.req('GET', '/guide');
    assert.equal(g.status, 200);
    assert.match(g.text, /<h1 class="card-hero card-hero-44 num">How Bloombroke was built<\/h1>/);
    assert.ok(g.text.includes('A guide from first commit to launch. $149 when it ships.'));
    assert.ok(g.text.includes('One email when it is ready. Nothing else.'));
    assert.match(g.text, /<link rel="canonical" href="https:\/\/bloombroke\.com\/guide">/);
  } finally { await s.close(); }
});

test('PRO: one founders line while seats are open, nothing otherwise', () => {
  assert.equal(foundersLine({ open: true, committedUsd: 8400, goalUsd: 17640 }), 'Founders: $8,400 of $17,640 committed. Type <a href="?c=FOUNDERS" data-cmd="FOUNDERS">FOUNDERS</a>.');
  assert.equal(foundersLine({ open: false, committedUsd: 8400, goalUsd: 17640 }), '');
  assert.equal(foundersLine(null), '');
  assert.equal(foundersLine({ open: true }), '');
});
