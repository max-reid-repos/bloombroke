// FOUNDERS SEATS (pro/founders.js, lib/founders-page.js) and TIPS (pro/tips.js): holds,
// checkout, the webhook (commit, duplicates, handles, expiry), the public status, the goal
// math, the deadline, the closed state, the pages, the guide list, the founders email list
// and the admin scripts.
// Stripe is a fake with real webhook signing, like test/pro.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Stripe from 'stripe';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom } from '../pro/licence.js';
import { STRIPE_API_VERSION, WEBHOOK_EVENTS } from '../pro/billing.js';
import { mountPro } from '../pro/routes.js';
import { TERMS_VERSION } from '../public/legal-version.js';
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
import { toCsv } from '../scripts/waitlist.js';
import { RESERVE_DONE } from '../public/founders.js';

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
        async expire(id, p, opts) { calls.push(['checkout.expire', id, opts]); sessions[id].status = 'expired'; return sessions[id]; },
      },
    },
    setupIntents: {
      async retrieve(id, p) { calls.push(['si.retrieve', id, p]); if (!intents[id]) throw missing(); return intents[id]; },
    },
    paymentMethods: {
      async detach(id, p, opts) {
        calls.push(['pm.detach', id, opts]);
        for (const si of Object.values(intents)) if (si.payment_method?.id === id) si.payment_method.customer = null;
        return { id };
      },
      async update(id, p, opts) { calls.push(['pm.update', id, p, opts]); return { id }; },
    },
    customers: {
      tags: {},
      async update(id, p, opts) { calls.push(['customer.update', id, p, opts]); this.tags[id] = p.metadata; return { id }; },
      async retrieve(id) { calls.push(['customer.retrieve', id]); return { id, metadata: this.tags[id] || {} }; },
      async del(id, p, opts) { calls.push(['customer.del', id, opts]); return { id, deleted: true }; },
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
    payment_method: { id: `pm_${n}`, customer: `cus_${n}`, card: { fingerprint }, billing_details: { email } },
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
  const tips = createTips({ db, stripe, env: tipsEnv, mode, webhookReady: true, now, log: quiet });
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
  // Each checkout from its own address (CF-Connecting-IP behind the local proxy), unless
  // one is given: at most 2 live holds per address.
  let ipN = 0;
  const checkout = (body, ip = `198.51.100.${++ipN}`) => req('POST', '/api/founders/checkout', { body, headers: { ...ORIGIN, 'CF-Connecting-IP': ip } });
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

test('seat classes and the goal math: five-year 1 to 10 at $1,420, founder 11 to 42 at $420', () => {
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
  assert.equal(f, 'You are saving a card. We charge $420 a year for this founder seat, only when founders reach $17,640, and no later than Dec 15, 2026. If the goal is not reached by then, we delete the card and you pay nothing. If the card fails, you get 3 days to pay by link. You can give up your seat before the charge by emailing hello@bloombroke.com.');
  const t = mandateText('ten', { goalUsd: 17640, deadlineAt: at });
  assert.match(t, /We charge \$1,420 once for this five-year seat, only when founders reach \$17,640/);
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
  let k = 0;
  const key = () => `k${++k}`;
  const a = s.hold({ seat: 12, ip: '203.0.113.9', key: key() });
  assert.equal(a.seat, 12);
  assert.equal(a.cls, 'founder');
  assert.throws(() => s.hold({ seat: 12, key: key() }), (e) => e instanceof FoundersError && e.code === 'taken');
  assert.equal(s.hold({ cls: 'founder', key: key() }).seat, 11, 'the lowest open founder seat');
  assert.equal(s.hold({ cls: 'founder', key: key() }).seat, 13, '12 is held');
  assert.equal(s.hold({ cls: 'ten', key: key() }).seat, 1);
  assert.equal(s.seats().find((x) => x.seat === 12).status, 'held');
  assert.equal(HOLD_MS, SESSION_MS + 2 * MIN, 'held longer than the Stripe session can live');
  t += HOLD_MS - 1;
  assert.equal(s.seats().find((x) => x.seat === 12).status, 'held');
  t += 1;
  const after = s.seats().find((x) => x.seat === 12);
  assert.equal(after.status, 'open', 'opened again on read');
  assert.equal(s.seat(12).mandate_ip, null, 'the address of an abandoned checkout is not kept');
  for (let i = 1; i <= 10; i++) s.hold({ seat: i, key: key() });
  assert.throws(() => s.hold({ cls: 'ten', key: key() }), (e) => e.code === 'full');
});

// ---- checkout -----------------------------------------------------------------------------

test('checkout: setup mode, server-side class and metadata, no custom fields, the mandate, an idempotency key', async () => {
  const s = await setup();
  try {
    const r = await s.checkout({ seat: 7 });
    assert.equal(r.status, 200);
    assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);
    const [, p, opts] = s.stripe.calls.find((c) => c[0] === 'checkout.create');
    assert.equal(p.mode, 'setup');
    assert.deepEqual(p.payment_method_types, ['card']);
    assert.equal(p.customer_creation, 'always');
    assert.deepEqual(p.metadata, { site: 'bloombroke', product: 'founders', seat: '7', class: 'ten', terms_version: TERMS_VERSION });
    assert.deepEqual(p.setup_intent_data.metadata, p.metadata);
    assert.equal(p.success_url, 'https://bloombroke.com/founders?seat=7&s={CHECKOUT_SESSION_ID}');
    assert.match(p.cancel_url, /^https:\/\/bloombroke\.com\/founders\?release=7\.[0-9a-f]{24}$/, 'the hold token, so a cancel frees the seat');
    assert.equal(p.expires_at, Math.floor((T0 + SESSION_MS) / 1000));
    assert.ok(!('custom_fields' in p), 'Stripe allows no custom_fields in setup mode');
    assert.equal(p.setup_intent_data.description, 'Bloombroke founders seat 7 (five-year seat)');
    assert.match(p.custom_text.submit.message, /^You are saving a card\. We charge \$1,420 once for this five-year seat/);
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
    const one = '203.0.113.50';
    let last;
    for (let i = 0; i < 12; i++) {
      last = await s.checkout({ class: 'founder' }, one);
      if (i < 2) assert.equal(last.status, 200, `hold ${i + 1}`);
      else assert.equal(last.status, 429);
    }
    assert.equal(last.body.error, 'rate_limited', 'then the hourly limit');
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
    assert.equal(row.mandate_ip, '198.51.100.1', 'the address that started the checkout');
    assert.equal(row.terms_version, TERMS_VERSION, 'the Terms agreed to');
    assert.equal(row.livemode, 0);
    // Tagged at Stripe, with idempotency keys.
    const cu = s.stripe.calls.find((c) => c[0] === 'customer.update');
    assert.deepEqual(cu[2].metadata, { site: 'bloombroke', product: 'founders', seat: '12', class: 'founder', terms_version: TERMS_VERSION });
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
    for (const secret of ['ann@example.com', 'cus_1', 'pm_1', 'seti_1', 'fp_ann', 'cs_test_', '198.51.100']) assert.ok(!st.text.includes(secret), secret);
  } finally { await s.close(); }
});

test('webhook: a completed checkout with no custom_fields (setup mode has none) commits with no handle', async () => {
  for (const fields of [undefined, []]) {
    const s = await setup();
    try {
      await s.checkout({ seat: 3 });
      const session = complete(s.stripe, 'cs_test_founders000001');
      if (fields === undefined) delete session.custom_fields;
      else session.custom_fields = fields;
      const r = await s.sendEvent(evt('checkout.session.completed', session));
      assert.equal(r.body.result, 'founders_committed', String(fields));
      const row = s.founders.store.seat(3);
      assert.equal(row.status, 'committed');
      assert.equal(row.handle, null);
      const st = await s.req('GET', '/api/founders/status');
      assert.deepEqual(st.body.seats.find((x) => x.seat === 3), { seat: 3, class: 'ten', status: 'committed', handle: null });
    } finally { await s.close(); }
  }
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
    // Every five-year seat taken: a five-year checkout that finishes gets none.
    await s.checkout({ seat: 1 });
    s.db.prepare("UPDATE founders_seats SET status = 'committed', email = 'x' || seat || '@x.co' WHERE class = 'ten' AND checkout_session_id IS NOT 'cs_test_founders000002'").run();
    s.db.prepare("UPDATE founders_seats SET status = 'committed', email = 'z@x.co' WHERE seat = 1").run();
    s.db.prepare("UPDATE founders_seats SET checkout_session_id = NULL WHERE seat = 1").run();
    const f = await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000002', { email: 'new@x.co', fingerprint: 'fp_new', n: 2 })));
    assert.equal(f.body.result, 'founders_full');
    assert.ok(s.stripe.calls.some((c) => c[0] === 'pm.detach' && c[1] === 'pm_2'));
  } finally { await s.close(); }
});

test('webhook: checkout.session.expired lets the hold go; setup_intent.succeeded commits a late seat; other events go on to Pro', async () => {
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
    // The SetupIntent event first: it fetches the session again and commits the seat.
    r = await s.sendEvent(evt('setup_intent.succeeded', s.stripe.intents.seti_2));
    assert.equal(r.body.result, 'founders_committed');
    assert.equal(s.founders.store.seat(26).status, 'committed');
    assert.equal((await s.sendEvent(evt('checkout.session.completed', done))).body.result, 'founders_already');
    r = await s.sendEvent(evt('setup_intent.succeeded', s.stripe.intents.seti_2));
    assert.equal(r.body.result, 'founders_already');
    // A SetupIntent for a seat nobody holds: nothing to do.
    r = await s.sendEvent(evt('setup_intent.succeeded', { id: 'seti_x', status: 'succeeded', metadata: { site: 'bloombroke', product: 'founders', seat: '40' } }));
    assert.equal(r.body.result, 'founders_wait');
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
    assert.match(html, /<h1 class="card-hero card-hero-44 num">Pro needs 42 founders\.<\/h1>/);
    assert.ok(html.includes('42 founders at $420 cover a year of licensed live prices. Nobody pays until founders commit $17,640.'));
    // What Pro is: three plain lines under the facts, before the seats card.
    const pro = '<ul class="fd-pro" aria-label="What Pro is"><li>Pro adds live licensed US stock and ETF prices to the terminal.</li>'
      + '<li>Pro today: your watchlist and portfolio on every device, plus alerts when the tab is closed.</li><li>Built by Max Reid.</li></ul>';
    assert.ok(html.includes(pro));
    assert.ok(html.indexOf(pro) > html.indexOf('id="fd-facts"') && html.indexOf(pro) < html.indexOf('id="fd-seats"'));
    assert.doesNotMatch(html, /open source|github|repo\b/i);
    // The missed-goal rule stays in view, in the line under the seat buttons.
    assert.equal(COPY.open, 'You save a card today. If the goal is missed, we delete every card.');
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
    assert.ok(f.text.includes('You already have a seat. One seat per person. This card was not kept.'));
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
  // Charge day lives here now (test/founders-charge.test.js); golive needs its day.
  assert.equal(foundersScript.parseArgs(['charge']).cmd, 'charge');
  assert.ok(foundersScript.parseArgs(['golive']).error, 'golive takes --date');
  assert.ok(foundersScript.parseArgs(['charge', '--date', '2027-01-05']).error, '--date is for golive only');
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

test('founders email list: POST /api/founders/reserve, its own list, whatever PRO_CHECKOUT says; the count, never an address', async () => {
  const s = await setup(); // the Pro waitlist is mounted with checkout open (its own route 404)
  try {
    const join = (body, headers = ORIGIN) => s.req('POST', '/api/founders/reserve', { body, headers: { 'CF-Connecting-IP': '203.0.113.7', ...headers } });
    // None yet: no counter on the page, the form is there, its button an outline.
    let page = (await s.req('GET', '/founders')).text;
    assert.ok(page.includes('<p class="fd-reserve-line">Not ready to save a card? Leave your email. It holds no seat.</p>'));
    assert.match(page, /<button type="submit" class="btn card-btn" id="fd-reserve-send">Email me<\/button>/);
    assert.doesNotMatch(page, /waiting\./, 'no zero counter');
    assert.equal((page.match(/btn-solid/g) || []).length, 1, 'the founder seat keeps the one solid button');
    assert.ok(page.indexOf('id="fd-reserve"') > page.indexOf('class="fd-classes"') && page.indexOf('id="fd-reserve"') < page.indexOf('id="fd-grid"'), 'under the two kinds of seat, above the grid');
    assert.equal((await s.req('GET', '/api/founders/status')).body.waiting, 0);
    // The script says the page's own words on success, and posts to this route.
    const client = readFileSync('public/founders.js', 'utf8');
    assert.equal(RESERVE_DONE, COPY.reserveDone);
    assert.equal(RESERVE_DONE, 'Thanks. We will email you about the seats.');
    assert.ok(client.includes("post('/api/founders/reserve', { email, hp: $('#fd-reserve-hp')?.value || '' })"));

    const ok = await join({ email: ' Ann@Example.com ', hp: '' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true });
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.equal((await join({ email: 'ann@example.com' })).status, 200, 'again: the same answer');
    assert.equal((await join({ email: 'bot@example.com', hp: 'x' })).status, 200, 'the honeypot: done, nothing kept');
    const bad = await join({ email: 'not an address' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.message, 'That email address does not look right.');
    assert.equal((await join({ email: 'b@example.com' }, { Origin: 'https://evil.example' })).status, 403);
    const rows = s.db.prepare('SELECT email, source FROM waitlist ORDER BY id').all();
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ email: 'ann@example.com', source: 'founders' }]);
    // The Pro waitlist's limit: 5 tries an hour per address, right or wrong (four used; a
    // cross-origin try is refused before it counts).
    assert.equal((await join({ email: 'x' })).status, 400);
    const sixth = await join({ email: 'c@example.com' });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.message, 'Too many tries. Wait an hour and try again.');

    // Three on the list: the status and the page say 3, never who.
    s.db.prepare("INSERT INTO waitlist (email, created_at, source) VALUES ('d@example.com', 1, 'founders'), ('e@example.com', 1, 'founders'), ('f@example.com', 1, 'guide')").run();
    const st = await s.req('GET', '/api/founders/status');
    assert.equal(st.body.waiting, 3);
    assert.doesNotMatch(st.text, /@example\.com/);
    page = (await s.req('GET', '/founders')).text;
    assert.ok(page.includes('<p class="fd-waiting" id="fd-waiting">3 waiting.</p>'));
    assert.doesNotMatch(page, /@example\.com/);
    // scripts/waitlist.js --source founders lists them.
    assert.equal(toCsv(s.db, 'founders').split('\n').filter(Boolean).length, 4, 'the header and 3 addresses');

    // Frozen for the charge: no form, and the route says closed.
    s.founders.store.freeze();
    page = (await s.req('GET', '/founders')).text;
    assert.doesNotMatch(page, /fd-reserve|waiting\./);
    const shut = await join({ email: 'g@example.com' }, { 'CF-Connecting-IP': '203.0.113.8', ...ORIGIN });
    assert.equal(shut.status, 409);
    assert.equal(shut.body.message, 'Seats are closed.');
  } finally { await s.close(); }
  // Closed (FOUNDERS not open) and after the deadline: no form, the route says closed.
  for (const opts of [{ env: {} }, { start: Date.UTC(2026, 11, 16, 1) }]) {
    const c = await setup(opts);
    try {
      assert.doesNotMatch((await c.req('GET', '/founders')).text, /fd-reserve/);
      assert.equal((await c.req('POST', '/api/founders/reserve', { body: { email: 'h@example.com' }, headers: ORIGIN })).status, 409);
      assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE source = 'founders'").get().n, 0);
    } finally { await c.close(); }
  }
});

test('migration 023: the waitlist takes the founders list, every row and the one-row-per-list rule kept', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-founders-023-'));
  try {
    const before = path.join(dir, 'before');
    mkdirSync(before);
    for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '023')) copyFileSync(path.join('migrations', f), path.join(before, f));
    const file = path.join(dir, 'pro.db');
    const old = openDb(file, { migrationsDir: before, log: quiet });
    old.prepare("INSERT INTO waitlist (email, created_at, source, notified_at) VALUES ('a@x.co', 5, 'pro-soon', 9), ('a@x.co', 6, 'guide', NULL)").run();
    assert.throws(() => old.prepare("INSERT INTO waitlist (email, created_at, source) VALUES ('a@x.co', 7, 'founders')").run(), /CHECK/);
    old.close();
    const db = openDb(file, { log: quiet });
    assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = '023_founders_reserve.sql'").get());
    assert.deepEqual(db.prepare('SELECT email, created_at, source, notified_at FROM waitlist ORDER BY id').all().map((r) => ({ ...r })),
      [{ email: 'a@x.co', created_at: 5, source: 'pro-soon', notified_at: 9 }, { email: 'a@x.co', created_at: 6, source: 'guide', notified_at: null }]);
    db.prepare("INSERT INTO waitlist (email, created_at, source) VALUES ('a@x.co', 7, 'founders')").run();
    assert.throws(() => db.prepare("INSERT INTO waitlist (email, created_at, source) VALUES ('a@x.co', 8, 'founders')").run(), /UNIQUE/);
    assert.throws(() => db.prepare("INSERT INTO waitlist (email, created_at, source) VALUES ('b@x.co', 8, 'other')").run(), /CHECK/);
    assert.deepEqual(db.prepare('PRAGMA table_info(waitlist)').all().map((c) => c.name), ['id', 'email', 'created_at', 'source', 'notified_at', 'deleted_at']);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PRO: one founders line while seats are open, nothing otherwise', () => {
  assert.equal(foundersLine({ open: true, committedUsd: 8400, goalUsd: 17640 }), 'Founders: $8,400 of $17,640 committed. Type <a href="?c=FOUNDERS" data-cmd="FOUNDERS">FOUNDERS</a>.');
  assert.equal(foundersLine({ open: false, committedUsd: 8400, goalUsd: 17640 }), '');
  assert.equal(foundersLine(null), '');
  assert.equal(foundersLine({ open: true }), '');
});

// ---- reviewer fixes: modes, hold limits, retries, customers, the deadline ----------------

test('modes: with a live key, test seats, handles, log lines and tips never count, show or block', async () => {
  let t = T0;
  const db = openDb(':memory:');
  const test = createFoundersStore(db, { now: () => t, livemode: 0 });
  const live = createFoundersStore(db, { now: () => t, livemode: 1 });
  // A test-mode founder on seat 12, and a test release log line.
  test.hold({ seat: 12, key: 'a' });
  db.prepare("UPDATE founders_seats SET checkout_session_id = 'cs_test_a' WHERE seat = 12").run();
  assert.deepEqual(test.commit({ sessionId: 'cs_test_a', cls: 'founder', email: 'ann@x.co', fingerprint: 'fp_a', handle: 'tester', livemode: false }), { seat: 12 });
  db.prepare("INSERT INTO founders_log (at, text, livemode) VALUES (?, 'Seat 3 released Oct 9.', 0)").run(t);
  assert.equal(test.totals().seatsTaken, 1);
  assert.equal(test.logs().length, 1);
  // The live site sees none of it.
  assert.deepEqual(live.seats().find((x) => x.seat === 12), { seat: 12, class: 'founder', status: 'open', handle: null });
  assert.deepEqual(live.totals(), { committedUsd: 0, seatsTaken: 0, held: 0 });
  assert.deepEqual(live.logs(), []);
  // A real buyer who tested with the same email and card is not a duplicate, and may take seat 12.
  live.hold({ seat: 12, key: 'b' });
  db.prepare("UPDATE founders_seats SET checkout_session_id = 'cs_live_b' WHERE seat = 12").run();
  const row = live.seat(12);
  assert.equal(row.email, null, 'the test fields are cleared when the live hold takes the row');
  assert.equal(row.livemode, 1);
  assert.deepEqual(live.commit({ sessionId: 'cs_live_b', cls: 'founder', email: 'ann@x.co', fingerprint: 'fp_a', livemode: true }), { seat: 12 });
  assert.equal(live.totals().seatsTaken, 1);
  assert.equal(test.totals().seatsTaken, 0, 'and the test site no longer counts the live seat');
  // Tips: the same rule.
  const tl = createTipsStore(db, { now: () => t, livemode: 1 });
  const tt = createTipsStore(db, { now: () => t, livemode: 0 });
  tt.add({ sessionId: 'cs_test_tip', amountCents: 2000, raw: 'Test', livemode: false });
  tl.add({ sessionId: 'cs_live_tip', amountCents: 500, raw: 'Live', livemode: true });
  assert.equal(tl.monthUsd(), 5);
  assert.equal(tt.monthUsd(), 20);
  assert.deepEqual(tl.fishtank(), [{ name: 'Fish #2', big: false }]);
});

test('scripts/founders.js reset-test: test seats open, test log and tips gone, live rows untouched; dry run first', () => {
  const db = openDb(':memory:');
  db.prepare("UPDATE founders_seats SET status = 'committed', email = 't@x.co', livemode = 0 WHERE seat IN (1, 11)").run();
  db.prepare("UPDATE founders_seats SET status = 'committed', email = 'l@x.co', livemode = 1 WHERE seat = 12").run();
  db.prepare("INSERT INTO founders_log (at, text, livemode) VALUES (1, 'Seat 3 released Oct 9.', 0)").run();
  createTipsStore(db).add({ sessionId: 'cs_t', amountCents: 500, livemode: false });
  const dry = foundersScript.resetTest({ db });
  assert.match(dry.text, /^Dry run: 2 test seats would go back to open and 1 test tips would be deleted/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM founders_seats WHERE status = 'committed'").get().n, 3);
  assert.match(foundersScript.resetTest({ db, execute: true }).text, /2 test seats open, 1 test log lines and 1 test tips deleted/);
  assert.deepEqual(db.prepare("SELECT seat FROM founders_seats WHERE status = 'committed'").all().map((r) => r.seat), [12]);
  assert.equal(db.prepare('SELECT email FROM founders_seats WHERE seat = 1').get().email, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tips').get().n, 0);
  assert.deepEqual(foundersScript.parseArgs(['reset-test', '--execute']).cmd, 'reset-test');
});

test('page and status: a live site with test rows in the database shows only live numbers', async () => {
  const s = await setup({ mode: 'live' });
  try {
    s.db.prepare("UPDATE founders_seats SET status = 'committed', handle = 'tester', livemode = 0 WHERE seat IN (1, 2, 11)").run();
    const st = (await s.req('GET', '/api/founders/status')).body;
    assert.equal(st.committedUsd, 0);
    assert.equal(st.seatsTaken, 0);
    assert.equal(st.testMode, false);
    const page = (await s.req('GET', '/founders')).text;
    assert.ok(!page.includes('@tester'));
    assert.match(page, /<progress class="fd-bar" max="17640" value="0"/);
    // And a live checkout may take a seat a test founder had.
    assert.equal((await s.checkout({ seat: 1 })).status, 200);
  } finally { await s.close(); }
});

test('holds: at most 2 live holds per address, at most 20 for the site, both counted from live holds', async () => {
  const db = openDb(':memory:');
  let t = T0;
  const s = createFoundersStore(db, { now: () => t });
  s.hold({ seat: 1, key: 'same' });
  s.hold({ seat: 2, key: 'same' });
  assert.throws(() => s.hold({ seat: 3, key: 'same' }), (e) => e.code === 'too_many' && e.status === 429);
  for (let i = 0; i < 18; i++) s.hold({ cls: 'founder', key: `k${i}` });
  assert.throws(() => s.hold({ cls: 'founder', key: 'new' }), (e) => e.code === 'busy');
  t += HOLD_MS;
  assert.equal(s.hold({ seat: 3, key: 'same' }).seat, 3, 'holds that ran out stop counting');
  // Through the route: four addresses can no longer hold all ten five-year seats.
  const r = await setup();
  try {
    let held = 0;
    for (const ip of ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4']) {
      for (let i = 0; i < 3; i++) if ((await r.checkout({ class: 'ten' }, ip)).status === 200) held += 1;
    }
    assert.equal(held, 8);
    assert.equal((await r.checkout({ class: 'ten' }, '192.0.2.9')).status, 200, 'seats left for a real buyer');
  } finally { await r.close(); }
});

test('webhook: a SetupIntent not done yet is retried (500, not marked processed); the retry commits', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 16 });
    const done = complete(s.stripe, 'cs_test_founders000001', { n: 1 });
    s.stripe.intents.seti_1.status = 'processing';
    const e = evt('checkout.session.completed', done);
    assert.equal((await s.sendEvent(e)).status, 500);
    assert.equal(s.store.isEventProcessed(e.id), false);
    assert.equal(s.founders.store.seat(16).status, 'held');
    // The success page meanwhile: still saving.
    assert.ok((await s.req('GET', '/founders?s=cs_test_founders000001')).text.includes(COPY.pending));
    s.stripe.intents.seti_1.status = 'succeeded';
    assert.equal((await s.sendEvent(e)).body.result, 'founders_committed');
  } finally { await s.close(); }
});

test('customers: a duplicate\'s Stripe customer is deleted; a release deletes only a customer tagged as ours', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 12 });
    await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000001', { n: 1 })));
    await s.checkout({ seat: 13 });
    await s.sendEvent(evt('checkout.session.completed', complete(s.stripe, 'cs_test_founders000002', { n: 2 })));
    const del = s.stripe.calls.filter((c) => c[0] === 'customer.del');
    assert.deepEqual(del.map((c) => [c[1], c[2].idempotencyKey]), [['cus_2', 'bb-founders-delete-cus_2']]);
    // Release seat 12: its customer was tagged at commit, so it goes.
    const out = await foundersScript.release({ db: s.db, stripe: s.stripe, seat: 12, execute: true, now: s.now });
    assert.equal(out.done, true);
    assert.ok(s.stripe.calls.some((c) => c[0] === 'customer.del' && c[1] === 'cus_1'));
  } finally { await s.close(); }
  // Another site's customer, or an untagged one on release: never deleted.
  const { removeCustomer } = await import('../pro/founders.js');
  const fake = fakeStripe();
  fake.customers.tags.cus_other = { site: 'nomorepurple' };
  assert.equal(await removeCustomer(fake, 'cus_other'), 'not_ours');
  assert.equal(await removeCustomer(fake, 'cus_plain', { requireTag: true }), 'not_ours');
  assert.equal(await removeCustomer(fake, 'cus_plain'), 'deleted', 'a customer our own checkout just made');
  assert.equal(fake.calls.filter((c) => c[0] === 'customer.del').length, 1);
});

test('deadline: a checkout that finishes after it commits nothing: card and customer gone, no public line, "Seats closed"', async () => {
  const at = foundersEnv({}).deadlineAt;
  const s = await setup({ start: at - 10 * MIN });
  try {
    await s.checkout({ seat: 14 });
    s.advance(20 * MIN);
    const done = complete(s.stripe, 'cs_test_founders000001', { n: 1 });
    const e = { ...evt('checkout.session.completed', done), created: Math.floor((at + MIN) / 1000) };
    assert.equal((await s.sendEvent(e)).body.result, 'founders_ended');
    assert.equal(s.founders.store.seat(14).status, 'open');
    assert.ok(s.stripe.calls.some((c) => c[0] === 'pm.detach' && c[1] === 'pm_1'));
    assert.ok(s.stripe.calls.some((c) => c[0] === 'customer.del' && c[1] === 'cus_1'));
    assert.deepEqual(s.founders.store.logs(), []);
    const page = (await s.req('GET', '/founders?s=cs_test_founders000001')).text;
    assert.ok(page.includes('Seats closed on Dec 15, 2026. This card was not kept.'));
  } finally { await s.close(); }
});

test('page: the failed lines say why: class full, or one seat per person', () => {
  const st = emptyState({});
  assert.ok(foundersPage(st, { confirm: { failed: 'full', cls: 'ten' } }).includes('All five-year seats are taken. This card was not kept.'));
  assert.ok(foundersPage(st, { confirm: { failed: 'full', cls: 'founder' } }).includes('All founder seats are taken.'));
  assert.ok(foundersPage(st, { confirm: { failed: 'duplicate', cls: 'founder' } }).includes('You already have a seat. One seat per person.'));
  // Closed: both buttons outline (a disabled white fill looks pressable).
  const closed = foundersPage({ ...st, committedUsd: 0, seatsTaken: 0, seats: Array.from({ length: 42 }, (_, i) => ({ seat: i + 1, class: i < 10 ? 'ten' : 'founder', status: 'open', handle: null })) });
  assert.equal((closed.match(/btn-solid/g) || []).length, 0);
});

// ---- last round: give-backs stay given back, the deadline time, the cancel link ----------

test('given back stays given back: a buyer who finished before the deadline and loads the page after it is not given back; the webhook commits', async () => {
  const at = foundersEnv({}).deadlineAt;
  const s = await setup({ start: at - 10 * MIN });
  try {
    await s.checkout({ seat: 14 });
    const done = complete(s.stripe, 'cs_test_founders000001', { n: 1 });
    s.advance(20 * MIN); // the page loads after the deadline
    const page = (await s.req('GET', '/founders?s=cs_test_founders000001')).text;
    assert.ok(page.includes(COPY.pending), 'the page waits: it has no time the buyer agreed');
    assert.ok(!s.stripe.calls.some((c) => c[0] === 'pm.detach' || c[0] === 'customer.del'), 'nothing given back');
    assert.equal(s.founders.store.givenBack('cs_test_founders000001'), null);
    // The webhook, with the event time before the deadline: the seat is the buyer's.
    const e = { ...evt('checkout.session.completed', done), created: Math.floor((at - 5 * MIN) / 1000) };
    assert.equal((await s.sendEvent(e)).body.result, 'founders_committed');
    assert.ok((await s.req('GET', '/founders?s=cs_test_founders000001')).text.includes('Seat 14 is yours.'));
  } finally { await s.close(); }
});

test('given back stays given back: a mandate time after the deadline gives back on the page; a later webhook never commits', async () => {
  const at = foundersEnv({}).deadlineAt;
  const s = await setup({ start: at - 10 * MIN });
  try {
    await s.checkout({ seat: 15 });
    const done = complete(s.stripe, 'cs_test_founders000001', { n: 1 });
    s.stripe.intents.seti_1.mandate = { customer_acceptance: { accepted_at: Math.floor((at + MIN) / 1000), online: { ip_address: '203.0.113.7' } } };
    s.advance(20 * MIN);
    assert.ok((await s.req('GET', '/founders?s=cs_test_founders000001')).text.includes('Seats closed on Dec 15, 2026.'));
    assert.equal(s.founders.store.givenBack('cs_test_founders000001').reason, 'ended');
    // A webhook with an earlier event time still cannot commit it.
    const e = { ...evt('checkout.session.completed', done), created: Math.floor((at - 5 * MIN) / 1000) };
    assert.equal((await s.sendEvent(e)).body.result, 'founders_ended');
    assert.equal(s.founders.store.seat(15).status, 'open');
  } finally { await s.close(); }
});

test('given back stays given back: a full class whose customer delete failed is retried, and never takes a seat that frees up', async () => {
  const s = await setup();
  try {
    s.db.prepare("UPDATE founders_seats SET status = 'committed', email = 'x' || seat || '@x.co', livemode = 0 WHERE class = 'ten' AND seat > 1").run();
    await s.checkout({ seat: 1 });
    s.db.prepare("UPDATE founders_seats SET status = 'committed', email = 'one@x.co', checkout_session_id = NULL WHERE seat = 1").run();
    const done = complete(s.stripe, 'cs_test_founders000001', { email: 'new@x.co', fingerprint: 'fp_new', n: 1 });
    const keep = s.stripe.customers.del;
    s.stripe.customers.del = async () => { throw new Error('network down'); };
    const e = evt('checkout.session.completed', done);
    assert.equal((await s.sendEvent(e)).status, 500, 'the delete failed: retried');
    assert.equal(s.founders.store.givenBack('cs_test_founders000001').reason, 'full');
    // Meanwhile a five-year seat frees up.
    s.db.prepare("UPDATE founders_seats SET status = 'open', email = NULL WHERE seat = 5").run();
    s.stripe.customers.del = keep;
    assert.equal((await s.sendEvent(e)).body.result, 'founders_full');
    assert.equal(s.founders.store.seat(5).status, 'open', 'not taken by the given-back checkout');
    const gb = s.founders.store.givenBack('cs_test_founders000001');
    assert.equal(gb.payment_method_id, null, 'ids forgotten once Stripe has removed them');
    assert.equal(gb.stripe_customer_id, null);
    assert.ok((await s.req('GET', '/founders?s=cs_test_founders000001')).text.includes('All five-year seats are taken.'));
  } finally { await s.close(); }
});

test('given back stays given back: a card already taken off its customer gives no seat, whatever the record says', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 20 });
    const done = complete(s.stripe, 'cs_test_founders000001', { n: 1 });
    s.stripe.intents.seti_1.payment_method.customer = null;
    assert.equal((await s.sendEvent(evt('checkout.session.completed', done))).body.result, 'founders_gone');
    assert.equal(s.founders.store.seat(20).status, 'open');
    assert.equal(s.founders.store.givenBack('cs_test_founders000001').reason, 'gone');
  } finally { await s.close(); }
});

test('cancel link: back from Stripe without a card, the session is expired and the seat opens at once; only its own hold', async () => {
  const s = await setup();
  try {
    await s.checkout({ seat: 30 });
    const [, p] = s.stripe.calls.find((c) => c[0] === 'checkout.create');
    const release = new URL(p.cancel_url).searchParams.get('release');
    // A wrong token, another seat: nothing.
    assert.ok(!(await s.req('GET', `/founders?release=30.${'0'.repeat(24)}`)).text.includes(COPY.released));
    assert.ok(!(await s.req('GET', `/founders?release=31.${release.split('.')[1]}`)).text.includes(COPY.released));
    assert.equal(s.founders.store.seat(30).status, 'held');
    const r = await s.req('GET', `/founders?release=${release}`);
    assert.ok(r.text.includes(COPY.released));
    assert.ok(!r.text.includes('/goal.js'), 'no analytics with the token in the address');
    const ex = s.stripe.calls.find((c) => c[0] === 'checkout.expire');
    assert.deepEqual([ex[1], ex[2].idempotencyKey], ['cs_test_founders000001', 'bb-founders-expire-cs_test_founders000001']);
    assert.equal(s.founders.store.seat(30).status, 'open');
    // A checkout that was finished is never expired by its old cancel link.
    await s.checkout({ seat: 31 });
    const p2 = s.stripe.calls.filter((c) => c[0] === 'checkout.create')[1][1];
    complete(s.stripe, 'cs_test_founders000002', { n: 2 });
    await s.req('GET', `/founders?${new URL(p2.cancel_url).searchParams}`);
    assert.equal(s.stripe.calls.filter((c) => c[0] === 'checkout.expire').length, 1);
    assert.equal(s.founders.store.seat(31).status, 'held');
  } finally { await s.close(); }
});
