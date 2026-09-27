// The Pro structure: seat numbers (migration 007), the yearly plan, gift codes and
// REDEEM. Stripe is a fake: no network calls.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import Stripe from 'stripe';
import { openDb, migrate } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import {
  revealKeyFrom, generateGiftCode, normalizeGiftCode, GIFT_RE, GIFT_LEN, ALPHABET, hashKey, KEY_RE, normalizeKey,
  GIFT_MS, GIFT_CODE_MS, MAX_GIFTS, proAccess,
} from '../pro/licence.js';
import { checkoutParams, STRIPE_API_VERSION, SUBMIT_MESSAGE, SUBMIT_MESSAGE_YEARLY, billingOf } from '../pro/billing.js';
import { mountPro, publicStatus } from '../pro/routes.js';
import { createLimiter } from '../pro/ratelimit.js';
import { RECORD_KEEP_MS, GIFT_RECORD_KEEP_MS } from '../pro/store.js';

const SECRET = 'whsec_test_dummy_secret_for_unit_tests';
const AES = revealKeyFrom('x'.repeat(40));
const T0 = Date.UTC(2026, 8, 27, 12);
const DAY = 24 * 60 * 60 * 1000;
const quiet = { log() {}, error() {} };

function fakeStripe() {
  const real = new Stripe('sk_test_dummy', { apiVersion: STRIPE_API_VERSION });
  const subs = {};
  const calls = [];
  const invoices = {};
  const refunds = [];
  const sessions = {};
  let failRefunds = 0;
  const missing = () => Object.assign(new Error('No such object'), { statusCode: 404, code: 'resource_missing' });
  const api = {
    subs, calls, invoiceData: invoices, refundData: refunds, sessions,
    failRefundsOnce() { failRefunds = 1; },
    invoices: {
      async retrieve(id) { calls.push(['invoice.retrieve', id]); if (!invoices[id]) throw missing(); return invoices[id]; },
    },
    invoicePayments: { list: ({ invoice }) => [{ status: 'paid', payment: { payment_intent: `pi_${invoice}` } }] },
    refunds: {
      list: ({ payment_intent }) => refunds.filter((r) => r.payment_intent === payment_intent),
      async create(p, opts) {
        calls.push(['refund', p, opts]);
        if (failRefunds > 0) { failRefunds -= 1; throw new Error('network down'); }
        if (refunds.some((r) => r.key === opts.idempotencyKey)) return refunds.find((r) => r.key === opts.idempotencyKey);
        const r = { ...p, status: 'succeeded', key: opts.idempotencyKey };
        refunds.push(r);
        return r;
      },
    },
    webhooks: real.webhooks,
    checkout: {
      sessions: {
        async create(p) { calls.push(['checkout.create', p]); return { id: 'cs_test_created0001', url: 'https://checkout.stripe.com/c/pay/cs_test_created0001' }; },
        async retrieve(id) { calls.push(['checkout.retrieve', id]); if (!sessions[id]) throw missing(); return sessions[id]; },
        list() { return []; },
        async expire() {},
      },
    },
    subscriptions: {
      async retrieve(id) { calls.push(['sub.retrieve', id]); if (!subs[id]) throw missing(); return subs[id]; },
      async update(id, p) { calls.push(['sub.update', id, p]); return { id, ...p }; },
      list({ customer }) { return Object.values(subs).filter((x) => x.customer === customer); },
      async cancel(id, p, opts) { calls.push(['sub.cancel', id, opts]); subs[id].status = 'canceled'; return subs[id]; },
    },
    billingPortal: { sessions: { async create() { return { url: 'https://billing.stripe.com/p/session/test_1' }; } } },
  };
  return api;
}

const sub = (n, interval, extra = {}) => ({
  id: `sub_${n}`, status: 'active', customer: `cus_${n}`, cancel_at_period_end: false,
  items: { data: [{ current_period_end: Math.floor(T0 / 1000) + (interval === 'year' ? 365 : 30) * 86400, price: { id: `price_${interval}`, recurring: { interval, interval_count: 1 } } }] },
  ...extra,
});

const paidSession = (n) => ({
  id: `cs_test_session${String(n).padStart(6, '0')}`, object: 'checkout.session', mode: 'subscription', status: 'complete',
  payment_status: 'paid', customer: `cus_${n}`, subscription: `sub_${n}`, metadata: { site: 'bloombroke', product: 'pro' },
  consent: { terms_of_service: 'accepted' }, livemode: false,
});

const evt = (id, type, object) => ({ id, object: 'event', type, created: Math.floor(T0 / 1000), data: { object } });

async function setup({ mode = 'live', yearly = 'price_test_year', limits } = {}) {
  let t = T0;
  const now = () => t;
  const db = openDb(':memory:');
  const store = createStore(db, { aesKey: AES, now });
  const stripe = fakeStripe();
  const app = express();
  mountPro(app, {
    store, stripe, now, loginDelayMs: 0, log: quiet, ...(limits ? { limits } : {}),
    config: { priceId: 'price_test_month', priceIdYearly: yearly, webhookSecret: SECRET, proSecretSet: true, publicUrl: 'https://bloombroke.com', mode },
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, { body, key } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['X-Pro-Key'] = key;
    const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, body: json };
  };
  const sendEvent = (event) => {
    const payload = JSON.stringify(event);
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) });
    return fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: payload }).then(async (r) => ({ status: r.status, body: await r.json() }));
  };
  // A paid licence straight from the store: { key, licence }.
  let n = 0;
  const paid = (extra = {}) => {
    n += 1;
    return store.ensureLicence({ sessionId: `cs_test_paid${String(n).padStart(8, '0')}`, customerId: `cus_p${n}`, subscriptionId: `sub_p${n}`, status: 'active', ...extra });
  };
  const close = () => new Promise((r) => server.close(r));
  return { db, store, stripe, req, sendEvent, paid, close, advance(ms) { t += ms; }, now };
}

// ---- migration 007 --------------------------------------------------------------------

test('migration 007: existing licences get seats in created order, nothing else changes, re-run safe', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-mig7-'));
  try {
    const early = path.join(dir, 'early');
    mkdirSync(early);
    for (const f of readdirSync('migrations').filter((f) => f < '007')) copyFileSync(path.join('migrations', f), path.join(early, f));
    const file = path.join(dir, 'pro.db');
    const db = openDb(file, { migrationsDir: early });
    assert.ok(!db.prepare('PRAGMA table_info(licences)').all().some((c) => c.name === 'seat'), 'fixture is the pre-007 schema');
    const ins = db.prepare(`INSERT INTO licences (id, key_hash, last4, stripe_customer_id, stripe_subscription_id, checkout_session_id, status, created_at, updated_at, livemode, terms_accepted_at, terms_version, current_period_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Ids out of created order on purpose, and two made in the same millisecond.
    ins.run(1, 'h1', 'AAAA', 'cus_1', 'sub_1', 'cs_test_1', 'active', 3000, 3100, 0, 3000, '2026-09-25', 9999);
    ins.run(2, 'h2', 'BBBB', 'cus_2', 'sub_2', 'cs_live_2', 'canceled', 1000, 5000, 1, null, null, null);
    ins.run(5, 'h5', 'CCCC', null, 'sub_5', 'cs_test_5', 'past_due', 2000, 2000, 0, null, null, null);
    ins.run(4, 'h4', 'DDDD', null, 'sub_4', 'cs_test_4', 'active', 2000, 2000, 0, null, null, null);
    db.prepare("INSERT INTO sync_docs (licence_id, name, data, updated_at) VALUES (1, 'watch', '[\"AAPL\"]', 5)").run();
    db.prepare("INSERT INTO stripe_events (id, type, processed_at) VALUES ('evt_1', 'checkout.session.completed', 7)").run();
    const before = db.prepare('SELECT * FROM licences ORDER BY id').all();
    const docsBefore = db.prepare('SELECT * FROM sync_docs').all();
    db.close();

    const after = openDb(file);
    const rows = after.prepare('SELECT * FROM licences ORDER BY id').all();
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.seat])), { 1: 4, 2: 1, 4: 2, 5: 3 }, 'created_at, then id');
    // No data loss: every old column is as it was; the new ones are empty.
    for (const [i, r] of rows.entries()) {
      const { seat, billing_interval: bi, gift_expires_at: ge, gifts_redeemed_purged: gp, ...old } = r;
      assert.deepEqual(old, before[i]);
      assert.equal(bi, null);
      assert.equal(ge, null);
      assert.ok(Number.isInteger(seat));
    }
    assert.deepEqual(after.prepare('SELECT * FROM sync_docs').all(), docsBefore);
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM stripe_events').get().n, 1);
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM gift_codes').get().n, 0);
    // Seats are unique.
    assert.throws(() => after.prepare('UPDATE licences SET seat = 1 WHERE id = 1').run(), /UNIQUE/);
    // Re-run: nothing applied twice, nothing moves.
    const applied = after.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
    migrate(after);
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, applied);
    after.close();
    const again = openDb(file);
    assert.deepEqual(again.prepare('SELECT id, seat FROM licences ORDER BY id').all(), rows.map((r) => ({ id: r.id, seat: r.seat })));
    // The next licence gets the next seat.
    const store = createStore(again, { aesKey: AES, now: () => T0 });
    const made = store.ensureLicence({ sessionId: 'cs_test_new', subscriptionId: 'sub_new', status: 'active' });
    assert.equal(made.licence.seat, 5);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration 007 on an empty database: the first licence is seat 1', () => {
  const store = createStore(openDb(':memory:'), { aesKey: AES, now: () => T0 });
  const a = store.ensureLicence({ sessionId: 'cs_test_s1', subscriptionId: 'sub_s1', status: 'active' });
  const b = store.ensureLicence({ sessionId: 'cs_test_s2', subscriptionId: 'sub_s2', status: 'active' });
  const again = store.ensureLicence({ sessionId: 'cs_test_s1', subscriptionId: 'sub_s1', status: 'active' });
  assert.equal(a.licence.seat, 1);
  assert.equal(b.licence.seat, 2);
  assert.equal(again.licence.seat, 1, 'the same licence keeps its seat');
});

// ---- seats in the status -----------------------------------------------------------------

test('seat: goes out with the status for display, and is never a credential', async () => {
  const s = await setup();
  try {
    const a = s.paid();
    const b = s.paid();
    const st = await s.req('GET', '/api/pro/status', { key: b.key });
    assert.equal(st.status, 200);
    assert.equal(st.body.seat, 2);
    assert.equal((await s.req('POST', '/api/pro/login', { body: { key: a.key } })).body.seat, 1);
    // A seat number in place of a key gets nothing.
    for (const fake of ['1', '00001', 'SEAT 00001', 1]) {
      assert.equal((await s.req('POST', '/api/pro/login', { body: { key: fake } })).status, 401);
    }
    assert.equal((await s.req('GET', '/api/pro/status', { key: '00002' })).status, 401);
    assert.equal((await s.req('GET', '/api/pro/sync', { key: 'SEAT-00002' })).status, 401);
    // A demo licence on the live site shows no seat and no Pro.
    const demo = publicStatus({ ...a.licence, livemode: 0 }, T0, 'live');
    assert.deepEqual(demo, { active: false, status: 'demo', last4: a.licence.last4 });
  } finally { await s.close(); }
});

// ---- yearly --------------------------------------------------------------------------------

test('yearly: checkout params use the yearly price and say yearly', () => {
  const m = checkoutParams({ priceId: 'price_m', publicUrl: 'https://bloombroke.com' });
  assert.deepEqual(m.line_items, [{ price: 'price_m', quantity: 1 }]);
  assert.equal(m.custom_text.submit.message, SUBMIT_MESSAGE);
  const y = checkoutParams({ priceId: 'price_y', publicUrl: 'https://bloombroke.com', interval: 'year' });
  assert.deepEqual(y.line_items, [{ price: 'price_y', quantity: 1 }]);
  assert.equal(y.custom_text.submit.message, SUBMIT_MESSAGE_YEARLY);
  assert.match(SUBMIT_MESSAGE_YEARLY, /yearly at \$42 USD/);
  assert.equal(y.mode, 'subscription');
  assert.deepEqual(y.payment_method_types, ['card']);
  assert.equal(y.allow_promotion_codes, false);
  assert.deepEqual(y.consent_collection, { terms_of_service: 'required' });
  assert.deepEqual(y.metadata, { site: 'bloombroke', product: 'pro' });
});

test('yearly: POST /checkout { plan: year } uses the server yearly price; bad plans are refused', async () => {
  const s = await setup();
  try {
    assert.equal((await s.req('GET', '/api/pro/config')).body.yearly, true);
    const y = await s.req('POST', '/api/pro/checkout', { body: { plan: 'year' } });
    assert.equal(y.status, 200);
    const created = s.stripe.calls.filter((c) => c[0] === 'checkout.create');
    assert.deepEqual(created.at(-1)[1].line_items, [{ price: 'price_test_year', quantity: 1 }]);
    const m = await s.req('POST', '/api/pro/checkout');
    assert.equal(m.status, 200, 'no body: monthly');
    assert.deepEqual(s.stripe.calls.filter((c) => c[0] === 'checkout.create').at(-1)[1].line_items, [{ price: 'price_test_month', quantity: 1 }]);
    assert.equal((await s.req('POST', '/api/pro/checkout', { body: { plan: 'month' } })).status, 200);
    // The client never names a price.
    const bad = await s.req('POST', '/api/pro/checkout', { body: { plan: 'price_cheap' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'bad_plan');
    const sneaky = await s.req('POST', '/api/pro/checkout', { body: { plan: 'year', price: 'price_cheap' } });
    assert.equal(sneaky.status, 200);
    assert.deepEqual(s.stripe.calls.filter((c) => c[0] === 'checkout.create').at(-1)[1].line_items, [{ price: 'price_test_year', quantity: 1 }]);
  } finally { await s.close(); }
});

test('yearly: without its price id the yearly option says not available yet, monthly still works', async () => {
  const s = await setup({ yearly: null });
  try {
    assert.equal((await s.req('GET', '/api/pro/config')).body.yearly, false);
    const y = await s.req('POST', '/api/pro/checkout', { body: { plan: 'year' } });
    assert.equal(y.status, 409);
    assert.equal(y.body.error, 'plan_unavailable');
    assert.match(y.body.message, /Yearly billing is not available yet/);
    assert.equal(s.stripe.calls.filter((c) => c[0] === 'checkout.create').length, 0);
    assert.equal((await s.req('POST', '/api/pro/checkout')).status, 200);
  } finally { await s.close(); }
});

for (const interval of ['month', 'year']) {
  test(`webhook (${interval}ly): one licence, idempotent per event and per session, interval recorded`, async () => {
    const s = await setup();
    try {
      s.stripe.subs.sub_1 = sub(1, interval);
      const e = evt(`evt_${interval}_1`, 'checkout.session.completed', paidSession(1));
      assert.equal((await s.sendEvent(e)).body.result, 'licence');
      assert.equal((await s.sendEvent(e)).body.result, 'duplicate');
      assert.equal((await s.sendEvent(evt(`evt_${interval}_1b`, 'checkout.session.completed', paidSession(1)))).body.result, 'licence');
      assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 1);
      const lic = s.store.findBySubscription('sub_1');
      assert.equal(lic.billing_interval, interval);
      assert.equal(lic.seat, 1);
      assert.equal(lic.current_period_end, s.stripe.subs.sub_1.items.data[0].current_period_end * 1000);
      // An update is processed once; a replay is a duplicate.
      s.stripe.subs.sub_1.cancel_at_period_end = true;
      const u = evt(`evt_${interval}_2`, 'customer.subscription.updated', { id: 'sub_1' });
      assert.equal((await s.sendEvent(u)).body.result, 'updated');
      assert.equal((await s.sendEvent(u)).body.result, 'duplicate');
      assert.equal(s.store.findBySubscription('sub_1').cancel_at_period_end, 1);
      assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM stripe_events').get().n, 3);
      const st = publicStatus(s.store.findBySubscription('sub_1'), T0, 'test');
      assert.equal(st.interval, interval);
      assert.equal(st.active, true);
    } finally { await s.close(); }
  });
}

test('billingOf: reads the interval from the price or the legacy plan', () => {
  assert.equal(billingOf(sub(1, 'year')).interval, 'year');
  assert.equal(billingOf(sub(1, 'month')).interval, 'month');
  assert.equal(billingOf({ items: { data: [{ plan: { interval: 'year' } }] } }).interval, 'year');
  assert.equal(billingOf({ items: { data: [{ price: { recurring: { interval: 'week', interval_count: 1 } } }] } }).interval, null);
  assert.equal(billingOf({ items: { data: [{ price: { recurring: { interval: 'month', interval_count: 3 } } }] } }).interval, null);
  assert.equal(billingOf({}).interval, null);
});

// ---- gift codes ------------------------------------------------------------------------------

test('gift codes: 140 random bits, canonical form, never mixed up with licence keys', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const c = generateGiftCode();
    assert.match(c, GIFT_RE);
    seen.add(c);
  }
  assert.equal(seen.size, 300);
  assert.ok(GIFT_LEN * Math.log2(ALPHABET.length) >= 128);
  const c = generateGiftCode(() => Buffer.from(Array.from({ length: 28 }, (_, i) => i)));
  assert.equal(c, 'GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345');
  assert.equal(normalizeGiftCode(c.toLowerCase()), c);
  assert.equal(normalizeGiftCode(c.replace(/-/g, ' ')), c);
  assert.equal(normalizeGiftCode(c.slice(5)), c, 'GIFT in front is optional');
  assert.equal(normalizeGiftCode(c.slice(0, -1)), null);
  assert.equal(normalizeGiftCode(`${c}0`), null);
  assert.equal(normalizeGiftCode('BB-7KQ2-M9XD-HT4P-WZ3C'), null, 'a licence key is not a gift code');
  assert.equal(normalizeKey(c), null, 'a gift code is not a licence key');
  assert.equal(normalizeGiftCode(null), null);
  assert.equal(normalizeGiftCode('A'.repeat(200)), null);
});

test('gifts: a paid licence makes up to 3; the code is shown once and stored only as a hash', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    assert.equal((await s.req('GET', '/api/pro/status', { key: giver.key })).body.canGift, true);
    const codes = [];
    for (let i = 0; i < MAX_GIFTS; i++) {
      const r = await s.req('POST', '/api/pro/gifts', { key: giver.key });
      assert.equal(r.status, 200);
      assert.match(r.body.code, GIFT_RE);
      assert.equal(r.body.gift.state, 'unused');
      assert.equal(r.body.gift.expiresAt, T0 + GIFT_CODE_MS);
      codes.push(r.body.code);
    }
    const fourth = await s.req('POST', '/api/pro/gifts', { key: giver.key });
    assert.equal(fourth.status, 409);
    assert.equal(fourth.body.error, 'limit');
    const list = await s.req('GET', '/api/pro/gifts', { key: giver.key });
    assert.equal(list.body.gifts.length, 3);
    assert.equal(list.body.left, 0);
    assert.ok(list.body.gifts.every((g) => !('code' in g) && g.last4.length === 4));
    // Stored hashed: no column holds a code.
    const rows = s.db.prepare('SELECT * FROM gift_codes').all();
    for (const code of codes) {
      assert.ok(rows.some((r) => r.code_hash === hashKey(code)));
      for (const r of rows) for (const v of Object.values(r)) assert.ok(!String(v).includes(code.slice(5)), 'no plain code');
    }
    // No key, a bad key: nothing.
    assert.equal((await s.req('POST', '/api/pro/gifts')).status, 401);
    assert.equal((await s.req('GET', '/api/pro/gifts', { key: 'BB-AAAA-AAAA-AAAA-AAAA' })).status, 401);
  } finally { await s.close(); }
});

test('gifts: REDEEM once makes a 30 day licence with its own key and seat; a second try is refused', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    const r = await s.req('POST', '/api/pro/redeem', { body: { code: code.toLowerCase().replace(/-/g, ' ') } });
    assert.equal(r.status, 200);
    assert.match(r.body.key, KEY_RE);
    assert.notEqual(r.body.key, giver.key);
    assert.equal(r.body.active, true);
    assert.equal(r.body.status, 'gift');
    assert.equal(r.body.seat, 2);
    assert.equal(r.body.canGift, false);
    assert.equal(r.body.giftUntil, new Date(T0 + GIFT_MS).toISOString());
    const lic = s.store.findByKey(r.body.key);
    assert.equal(lic.stripe_subscription_id, null, 'no card, no subscription');
    assert.equal(lic.stripe_customer_id, null);
    const again = await s.req('POST', '/api/pro/redeem', { body: { code } });
    assert.equal(again.status, 410);
    assert.equal(again.body.error, 'used');
    assert.equal(again.body.key, undefined);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 2);
    const g = s.db.prepare('SELECT * FROM gift_codes').get();
    assert.equal(g.redeemed_licence_id, lic.id);
    assert.equal(g.redeemed_at, T0);
    // The giver sees it as redeemed, and it still counts toward the 3.
    const list = (await s.req('GET', '/api/pro/gifts', { key: giver.key })).body;
    assert.equal(list.gifts[0].state, 'redeemed');
    assert.equal(list.left, 2);
    // The new key works for sync while the gift runs.
    assert.equal((await s.req('GET', '/api/pro/sync', { key: r.body.key })).status, 200);
  } finally { await s.close(); }
});

test('gifts: two REDEEMs of one code at the same moment make one licence', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    const both = await Promise.all([1, 2, 3].map(() => s.req('POST', '/api/pro/redeem', { body: { code } })));
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 410, 410]);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences WHERE gift_expires_at IS NOT NULL').get().n, 1);
    // In the store too: the conditional update refuses a used code even if the read raced.
    assert.throws(() => s.store.redeemGift(code), (e) => e.code === 'used');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 2, 'a refused redeem leaves no licence behind');
  } finally { await s.close(); }
});

test('gifts: the gift licence ends cleanly at 30 days, and its synced data goes 30 days later', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    const { key } = (await s.req('POST', '/api/pro/redeem', { body: { code } })).body;
    const put = await s.req('PUT', '/api/pro/sync', { key, body: { docs: { watch: { data: ['AAPL'], updatedAt: T0 } } } });
    assert.equal(put.status, 200);
    s.advance(GIFT_MS - 1);
    assert.equal((await s.req('GET', '/api/pro/status', { key })).body.active, true);
    s.advance(1);
    const st = (await s.req('GET', '/api/pro/status', { key })).body;
    assert.equal(st.active, false);
    assert.equal(st.status, 'gift_ended');
    assert.equal((await s.req('GET', '/api/pro/sync', { key })).status, 402, 'sync stops');
    // Login still works (the key is known), it just is not Pro.
    assert.equal((await s.req('POST', '/api/pro/login', { body: { key } })).body.active, false);
    assert.equal(s.store.purgeEnded().docs, 0, 'not before 30 more days');
    s.advance(30 * DAY);
    assert.equal(s.store.purgeEnded().docs, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sync_docs').get().n, 0);
    // proAccess on its own
    const lic = s.store.findByKey(key);
    assert.equal(proAccess(lic, lic.gift_expires_at - 1).active, true);
    assert.equal(proAccess(lic, lic.gift_expires_at).active, false);
  } finally { await s.close(); }
});

test('gifts: a gift licence cannot make gifts; demo, lapsed and gift-of-gift are refused', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    const { key } = (await s.req('POST', '/api/pro/redeem', { body: { code } })).body;
    const r = await s.req('POST', '/api/pro/gifts', { key });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'cannot_gift');
    assert.match(r.body.message, /A gift licence cannot make gift codes/);
    assert.equal((await s.req('GET', '/api/pro/gifts', { key })).body.canGift, false);
    // A lapsed paid licence cannot either.
    const lapsed = s.paid();
    s.store.setStatus(lapsed.licence.id, 'canceled');
    assert.equal((await s.req('POST', '/api/pro/gifts', { key: lapsed.key })).status, 403);
    // past_due in grace keeps Pro, but gifts need a paid-up licence.
    const late = s.paid();
    s.store.setStatus(late.licence.id, 'past_due');
    assert.equal((await s.req('POST', '/api/pro/gifts', { key: late.key })).status, 403);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM gift_codes').get().n, 1);
  } finally { await s.close(); }
});

test('gifts: a demo (test mode) licence gives demo gifts, which are not Pro on the live site', async () => {
  const s = await setup({ mode: 'test' });
  try {
    const giver = s.paid({ livemode: false });
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    const r = await s.req('POST', '/api/pro/redeem', { body: { code } });
    assert.equal(r.body.active, true, 'Pro in demo mode');
    const lic = s.store.findByKey(r.body.key);
    assert.equal(lic.livemode, 0, 'the gift takes the giver\'s mode');
    assert.equal(publicStatus(lic, T0, 'live').status, 'demo');
  } finally { await s.close(); }
});

test('gifts: an unused code expires after 90 days, and then frees its place', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await s.req('POST', '/api/pro/gifts', { key: giver.key })).body.code);
    s.advance(GIFT_CODE_MS - 1);
    assert.equal((await s.req('POST', '/api/pro/redeem', { body: { code: codes[0] } })).status, 200, 'still good on the last millisecond');
    s.advance(1);
    const late = await s.req('POST', '/api/pro/redeem', { body: { code: codes[1] } });
    assert.equal(late.status, 410);
    assert.equal(late.body.error, 'expired');
    const list = (await s.req('GET', '/api/pro/gifts', { key: giver.key })).body;
    assert.deepEqual(list.gifts.map((g) => g.state).sort(), ['expired', 'expired', 'redeemed']);
    assert.equal(list.left, 2, 'expired unused codes free their place; the redeemed one still counts');
    assert.equal((await s.req('POST', '/api/pro/gifts', { key: giver.key })).status, 200);
  } finally { await s.close(); }
});

test('gifts: REDEEM is rate limited per IP, and wrong codes count as guesses', async () => {
  const s = await setup();
  try {
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await s.req('POST', '/api/pro/redeem', { body: { code: generateGiftCode() } })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(404));
    assert.deepEqual(statuses.slice(10), [429, 429]);
    // Even a good code waits once the IP is limited.
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    assert.equal((await s.req('POST', '/api/pro/redeem', { body: { code } })).status, 429);
    assert.equal(s.db.prepare('SELECT redeemed_at FROM gift_codes').get().redeemed_at, null);
    // Bad format is refused before the store and counts too.
    const s2 = await setup();
    try {
      const r = await s2.req('POST', '/api/pro/redeem', { body: { code: 'hello' } });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'bad_format');
    } finally { await s2.close(); }
  } finally { await s.close(); }
});

test('gifts: after the gift month ends, SUBSCRIBE on the same key keeps its seat and becomes paid', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    const { key, seat } = (await s.req('POST', '/api/pro/redeem', { body: { code } })).body;
    const early = await s.req('POST', '/api/pro/checkout', { key });
    assert.equal(early.status, 409);
    assert.equal(early.body.error, 'gift_active');
    s.advance(GIFT_MS);
    const later = await s.req('POST', '/api/pro/checkout', { key, body: { plan: 'year' } });
    assert.equal(later.status, 200);
    const params = s.stripe.calls.filter((c) => c[0] === 'checkout.create').at(-1)[1];
    const lic = s.store.findByKey(key);
    assert.equal(params.client_reference_id, String(lic.id));
    // The subscription lands on the gift licence: same key, same seat, no longer a gift.
    const moved = s.store.ensureLicence({ sessionId: 'cs_test_regift000001', customerId: 'cus_g', subscriptionId: 'sub_g', status: 'active', licenceId: lic.id });
    assert.equal(moved.reactivated, true);
    assert.equal(moved.licence.seat, seat);
    assert.equal(moved.licence.gift_expires_at, null);
    const st = (await s.req('GET', '/api/pro/status', { key })).body;
    assert.equal(st.status, 'active');
    assert.equal(st.canGift, true);
  } finally { await s.close(); }
});

// ---- Review fixes ---------------------------------------------------------------------------

test('rate limiter: a timer drops ended windows, so an address is held its window plus at most a minute', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let t = 0;
    const l = createLimiter({ max: 5, windowMs: 15 * 60 * 1000, now: () => t });
    l.hit('1.2.3.4');
    l.hit('5.6.7.8');
    assert.equal(l.size(), 2);
    t = 15 * 60 * 1000 - 1;
    mock.timers.tick(15 * 60 * 1000 - 1);
    assert.equal(l.size(), 2, 'still inside the window');
    t = 15 * 60 * 1000 + 59_999;
    mock.timers.tick(60_000);
    assert.equal(l.size(), 0, 'gone within a minute of the window ending, with no new hits');
    // A short window sweeps on its own window.
    let u = 0;
    const s = createLimiter({ max: 1, windowMs: 1000, now: () => u });
    s.hit('a');
    u = 1000;
    mock.timers.tick(1000);
    assert.equal(s.size(), 0);
  } finally {
    mock.timers.reset();
  }
});

test('records purge: licences 5 years after they end, gift codes 12 months after use or expiry; seats never come back', async () => {
  const s = await setup();
  try {
    const old = s.paid();
    const recent = s.paid();
    const live = s.paid();
    // The giver makes a code that a friend redeems; another code expires unused.
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    const gifted = (await s.req('POST', '/api/pro/redeem', { body: { code } })).body;
    await s.req('POST', '/api/pro/gifts', { key: giver.key });
    s.store.putDocs(old.licence.id, { watch: { data: ['AAPL'], updatedAt: T0 } });
    s.store.setStatus(old.licence.id, 'canceled');
    const maxSeat = s.db.prepare('SELECT MAX(seat) AS n FROM licences').get().n;
    assert.equal(s.store.purgeRecords().licences, 0, 'nothing is old yet');
    // 12 months after use and expiry: the code rows go, the licences stay.
    s.advance(GIFT_RECORD_KEEP_MS + 91 * DAY);
    s.store.setStatus(recent.licence.id, 'unpaid');
    assert.deepEqual(s.store.purgeRecords(), { gifts: 2, licences: 0 });
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM gift_codes').get().n, 0);
    // The redeemed one still counts toward the giver's 3, for life.
    const list = s.store.listGifts(giver.licence.id);
    assert.equal(list.older, 1);
    assert.equal(list.left, 2);
    // 5 years after the old one ended (and the gift month): those rows and their data go.
    s.advance(RECORD_KEEP_MS - GIFT_RECORD_KEEP_MS - 91 * DAY + 30 * DAY);
    const r = s.store.purgeRecords();
    assert.equal(r.licences, 2, 'the old paid licence and the gift licence');
    assert.equal(s.store.findByKey(old.key), null);
    assert.equal(s.store.findByKey(gifted.key), null);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sync_docs WHERE licence_id = ?').get(old.licence.id).n, 0, 'its synced data with it');
    assert.ok(s.store.findByKey(recent.key), 'unpaid (could still charge): kept');
    assert.ok(s.store.findByKey(live.key), 'live: kept');
    assert.ok(s.store.findByKey(giver.key), 'live giver: kept');
    // Deleting the highest seat never hands it out again.
    s.db.prepare('DELETE FROM licences WHERE seat = ?').run(maxSeat);
    const next = s.paid();
    assert.equal(next.licence.seat, maxSeat + 1);
  } finally { await s.close(); }
});

test('migration 009: seat_high starts at the highest seat already given', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-mig9-'));
  try {
    const early = path.join(dir, 'early');
    mkdirSync(early);
    for (const f of readdirSync('migrations').filter((f) => f < '009')) copyFileSync(path.join('migrations', f), path.join(early, f));
    const file = path.join(dir, 'pro.db');
    const db = openDb(file, { migrationsDir: early });
    const ins = db.prepare("INSERT INTO licences (key_hash, last4, status, created_at, updated_at, seat) VALUES (?, 'AAAA', 'active', 1, 1, ?)");
    for (let i = 1; i <= 3; i++) ins.run(`h${i}`, i);
    db.prepare('DELETE FROM licences WHERE seat = 3').run();
    db.close();
    const after = openDb(file);
    assert.equal(after.prepare('SELECT n FROM seat_high').get().n, 2, 'from the rows there at migration time');
    const s2 = createStore(after, { aesKey: AES, now: () => T0 });
    assert.equal(s2.ensureLicence({ sessionId: 'cs_test_m94', subscriptionId: 'sub_m94', status: 'active' }).licence.seat, 3);
    assert.equal(after.prepare('SELECT n FROM seat_high').get().n, 3, 'the trigger keeps it up');
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gifts: a code works only while the paid subscription that made it is active', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    for (const status of ['canceled', 'unpaid', 'past_due', 'incomplete_expired']) {
      s.store.setStatus(giver.licence.id, status);
      const r = await s.req('POST', '/api/pro/redeem', { body: { code } });
      assert.equal(r.status, 410, status);
      assert.equal(r.body.error, 'giver_inactive');
      assert.match(r.body.message, /the Pro subscription that made it is not active/);
    }
    assert.equal(s.db.prepare('SELECT redeemed_at FROM gift_codes').get().redeemed_at, null, 'the code is not used up');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 1, 'no licence made');
    // Active again (REACTIVATE): the code works.
    s.store.setStatus(giver.licence.id, 'active');
    assert.equal((await s.req('POST', '/api/pro/redeem', { body: { code } })).status, 200);
  } finally { await s.close(); }
});

test('two tabs, two checkouts for one gift-ended licence: the earlier subscription is refunded in full, then cancelled', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
    const { key } = (await s.req('POST', '/api/pro/redeem', { body: { code } })).body;
    s.advance(GIFT_MS);
    const lic = s.store.findByKey(key);
    // Two checkout pages, both paid: no customer yet, so checkout could not see the other.
    assert.equal((await s.req('POST', '/api/pro/checkout', { key })).status, 200);
    assert.equal((await s.req('POST', '/api/pro/checkout', { key })).status, 200);
    const session = (n) => ({ ...paidSession(n), client_reference_id: String(lic.id), metadata: { site: 'bloombroke', product: 'pro', licence_id: String(lic.id) } });
    s.stripe.subs.sub_71 = { ...sub(71, 'month'), latest_invoice: 'in_71' };
    s.stripe.subs.sub_72 = { ...sub(72, 'month'), latest_invoice: 'in_72' };
    s.stripe.invoiceData.in_71 = { id: 'in_71', status: 'paid', amount_paid: 420, currency: 'usd' };
    s.stripe.invoiceData.in_72 = { id: 'in_72', status: 'paid', amount_paid: 420, currency: 'usd' };
    assert.equal((await s.sendEvent(evt('evt_71', 'checkout.session.completed', session(71)))).status, 200);
    assert.equal(s.store.findByKey(key).stripe_subscription_id, 'sub_71');
    // The refund fails once: nothing is cancelled, Stripe retries, then both happen.
    s.stripe.failRefundsOnce();
    assert.equal((await s.sendEvent(evt('evt_72', 'checkout.session.completed', session(72)))).status, 500);
    assert.equal(s.stripe.subs.sub_71.status, 'active', 'still live after a failed refund');
    assert.equal((await s.sendEvent(evt('evt_72', 'checkout.session.completed', session(72)))).status, 200);
    assert.deepEqual(s.stripe.refundData.map((r) => [r.payment_intent, r.amount, r.reason, r.key]), [['pi_in_71', 420, 'duplicate', 'bb-duplicate-refund-sub_71-in_71']]);
    assert.equal(s.stripe.subs.sub_71.status, 'canceled');
    assert.equal((await s.sendEvent(evt('evt_71c', 'checkout.session.async_payment_succeeded', session(71)))).status, 200, 'A again, as a new event');
    assert.equal(s.store.findByKey(key).stripe_subscription_id, 'sub_72', 'the earlier session never takes the licence back');
    assert.equal(s.stripe.subs.sub_72.status, 'active');
    const moved = s.store.findByKey(key);
    assert.equal(moved.stripe_subscription_id, 'sub_72');
    assert.equal(moved.seat, lic.seat);
    // A resend changes nothing more.
    await s.sendEvent(evt('evt_72b', 'checkout.session.completed', session(72)));
    assert.equal(s.stripe.refundData.length, 1);
    assert.equal(s.stripe.calls.filter((c) => c[0] === 'sub.cancel').length, 1);
  } finally { await s.close(); }
});

test('checkout: an oversize body gets its own plain error, not the sync one', async () => {
  const s = await setup();
  try {
    const r = await s.req('POST', '/api/pro/checkout', { body: { plan: 'month', pad: 'x'.repeat(2000) } });
    assert.equal(r.status, 413);
    assert.equal(r.body.message, 'That request is too large.');
    const giver = s.paid();
    const big = await s.req('PUT', '/api/pro/sync', { key: giver.key, body: { docs: { watch: { data: 'x'.repeat(70 * 1024), updatedAt: T0 } } } });
    assert.equal(big.status, 413);
    assert.equal(big.body.message, 'Synced data is capped at 64 KB.');
  } finally { await s.close(); }
});

// ---- Second review: the backstop never undoes the kept subscription ---------------------------

async function twoTabs() {
  const s = await setup({ mode: 'test' }); // the sessions are test-mode ones
  const giver = s.paid();
  const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
  const { key } = (await s.req('POST', '/api/pro/redeem', { body: { code } })).body;
  s.advance(GIFT_MS);
  const lic = s.store.findByKey(key);
  const session = (n) => ({ ...paidSession(n), client_reference_id: String(lic.id), metadata: { site: 'bloombroke', product: 'pro', licence_id: String(lic.id) } });
  const created = Math.floor(T0 / 1000);
  s.stripe.subs.sub_71 = { ...sub(71, 'month'), latest_invoice: 'in_71', created: created + 30 * 86400 };
  s.stripe.subs.sub_72 = { ...sub(72, 'month'), latest_invoice: 'in_72', created: created + 30 * 86400 + 5 };
  s.stripe.invoiceData.in_71 = { id: 'in_71', status: 'paid', amount_paid: 420, currency: 'usd' };
  s.stripe.invoiceData.in_72 = { id: 'in_72', status: 'paid', amount_paid: 420, currency: 'usd' };
  s.stripe.sessions[session(71).id] = session(71);
  s.stripe.sessions[session(72).id] = session(72);
  const effects = () => ({
    refunds: s.stripe.refundData.map((r) => r.payment_intent),
    cancels: s.stripe.calls.filter((c) => c[0] === 'sub.cancel').map((c) => c[1]),
  });
  return { s, key, lic, session, effects };
}

test('two tabs, then tab A reloads its success page: /claim changes nothing, the later subscription stays', async () => {
  const { s, key, session, effects } = await twoTabs();
  try {
    await s.sendEvent(evt('evt_a', 'checkout.session.completed', session(71)));
    await s.sendEvent(evt('evt_b', 'checkout.session.completed', session(72)));
    assert.deepEqual(effects(), { refunds: ['pi_in_71'], cancels: ['sub_71'] });
    // Tab A's success page, and B's, reloaded.
    const a = await s.req('POST', '/api/pro/claim', { body: { session_id: session(71).id } });
    assert.equal(a.status, 200);
    assert.equal(a.body.reactivated, true);
    assert.equal(a.body.active, true);
    assert.equal(a.body.key, undefined, 'no key shown again');
    const b = await s.req('POST', '/api/pro/claim', { body: { session_id: session(72).id } });
    assert.equal(b.status, 200);
    assert.deepEqual(effects(), { refunds: ['pi_in_71'], cancels: ['sub_71'] }, 'no new refund or cancel');
    const lic = s.store.findByKey(key);
    assert.equal(lic.stripe_subscription_id, 'sub_72');
    assert.equal(lic.status, 'active');
    assert.equal(s.stripe.subs.sub_72.status, 'active');
  } finally { await s.close(); }
});

test('two tabs, webhooks out of order: the later subscription is kept, the earlier one refunded and cancelled', async () => {
  const { s, key, session, effects } = await twoTabs();
  try {
    await s.sendEvent(evt('evt_b', 'checkout.session.completed', session(72)));
    assert.equal(s.store.findByKey(key).stripe_subscription_id, 'sub_72');
    await s.sendEvent(evt('evt_a', 'checkout.session.completed', session(71)));
    assert.deepEqual(effects(), { refunds: ['pi_in_71'], cancels: ['sub_71'] });
    assert.equal(s.store.findByKey(key).stripe_subscription_id, 'sub_72', 'the licence never moves to the earlier one');
    assert.equal(s.stripe.subs.sub_72.status, 'active');
    // Redelivery of both, same ids and new ids, and both success pages: nothing more.
    await s.sendEvent(evt('evt_a', 'checkout.session.completed', session(71)));
    await s.sendEvent(evt('evt_b', 'checkout.session.completed', session(72)));
    await s.sendEvent(evt('evt_a2', 'checkout.session.completed', session(71)));
    await s.sendEvent(evt('evt_b2', 'checkout.session.completed', session(72)));
    await s.req('POST', '/api/pro/claim', { body: { session_id: session(71).id } });
    await s.req('POST', '/api/pro/claim', { body: { session_id: session(72).id } });
    assert.deepEqual(effects(), { refunds: ['pi_in_71'], cancels: ['sub_71'] });
    assert.equal(s.store.findByKey(key).stripe_subscription_id, 'sub_72');
  } finally { await s.close(); }
});

test('gifts: the 3-code limit is for life, even after old code records are deleted', async () => {
  const s = await setup();
  try {
    const giver = s.paid();
    for (let i = 0; i < 3; i++) {
      const { code } = (await s.req('POST', '/api/pro/gifts', { key: giver.key })).body;
      assert.equal((await s.req('POST', '/api/pro/redeem', { body: { code } })).status, 200);
    }
    s.advance(GIFT_RECORD_KEEP_MS + DAY);
    assert.equal(s.store.purgeRecords().gifts, 3);
    const list = (await s.req('GET', '/api/pro/gifts', { key: giver.key })).body;
    assert.deepEqual([list.gifts.length, list.older, list.left], [0, 3, 0]);
    assert.equal((await s.req('POST', '/api/pro/gifts', { key: giver.key })).status, 409);
  } finally { await s.close(); }
});

test('records purge: only cancelled and gift-ended licences go; unpaid, past_due and incomplete stay', async () => {
  const s = await setup();
  try {
    const rows = {};
    for (const st of ['canceled', 'unpaid', 'past_due', 'incomplete']) {
      const l = s.paid();
      s.store.setStatus(l.licence.id, st);
      // Mark each as ended long ago, whatever its status, to test the status rule alone.
      s.db.prepare('UPDATE licences SET ended_at = ? WHERE id = ?').run(T0, l.licence.id);
      rows[st] = l.key;
    }
    s.advance(RECORD_KEEP_MS + DAY);
    assert.equal(s.store.purgeRecords().licences, 1);
    assert.equal(s.store.findByKey(rows.canceled), null);
    for (const st of ['unpaid', 'past_due', 'incomplete']) assert.ok(s.store.findByKey(rows[st]), st);
  } finally { await s.close(); }
});
