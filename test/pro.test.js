import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import Stripe from 'stripe';
import { openDb, migrate } from '../pro/db.js';
import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { createStore, MAX_SYNC_BYTES } from '../pro/store.js';
import {
  generateKey, normalizeKey, hashKey, last4, proAccess, KEY_RE, ALPHABET, GRACE_MS, REVEAL_MS,
  revealKeyFrom, encryptReveal, decryptReveal,
} from '../pro/licence.js';
import { checkoutParams, invoiceSubscriptionId, STRIPE_API_VERSION, WEBHOOK_EVENTS, stripeEnv, billingOf } from '../pro/billing.js';
import { mountPro } from '../pro/routes.js';
import { createLimiter, ipBucket } from '../pro/ratelimit.js';

const SECRET = 'whsec_test_dummy_secret_for_unit_tests';
const AES = revealKeyFrom('x'.repeat(40));
const T0 = Date.UTC(2026, 8, 25, 12);
const DAY = 24 * 60 * 60 * 1000;
const quiet = { log() {}, error() {} };

// ---- a fake Stripe: real webhook signing, fake API resources -------------------------

function fakeStripe() {
  const real = new Stripe('sk_test_dummy', { apiVersion: STRIPE_API_VERSION });
  const sessions = {};
  const subs = {};
  const calls = [];
  const missing = () => Object.assign(new Error('No such object'), { statusCode: 404, code: 'resource_missing' });
  let failNext = 0;
  return {
    sessions, subs, calls,
    failSubscriptionRetrieves(n) { failNext = n; },
    webhooks: real.webhooks,
    checkout: {
      sessions: {
        async create(p) { calls.push(['checkout.create', p]); return { id: 'cs_test_created0001', url: 'https://checkout.stripe.com/c/pay/cs_test_created0001' }; },
        async retrieve(id) { calls.push(['checkout.retrieve', id]); if (!sessions[id]) throw missing(); return sessions[id]; },
        list({ customer, status }) { return Object.values(sessions).filter((x) => x.customer === customer && x.status === status); },
        async expire(id) { calls.push(['checkout.expire', id]); sessions[id].status = 'expired'; return sessions[id]; },
      },
    },
    subscriptions: {
      async retrieve(id) {
        calls.push(['sub.retrieve', id]);
        if (failNext > 0) { failNext -= 1; throw new Error('network down'); }
        if (!subs[id]) throw missing();
        return subs[id];
      },
      async update(id, p) { calls.push(['sub.update', id, p]); return { id, ...p }; },
      list({ customer }) { return Object.values(subs).filter((x) => x.customer === customer); },
      async cancel(id, p, opts) { calls.push(['sub.cancel', id, opts]); subs[id].status = 'canceled'; return subs[id]; },
    },
    billingPortal: { sessions: { async create(p) { calls.push(['portal.create', p]); return { url: 'https://billing.stripe.com/p/session/test_1' }; } } },
  };
}

function paidSession(n = 1, extra = {}) {
  return {
    id: `cs_test_session${String(n).padStart(6, '0')}`,
    object: 'checkout.session',
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    customer: `cus_${n}`,
    subscription: `sub_${n}`,
    metadata: { site: 'bloombroke', product: 'pro' },
    consent: { terms_of_service: 'accepted', promotions: null },
    ...extra,
  };
}

async function setup({ configured = true, loginDelayMs = 0, mode = 'live', termsVersion } = {}) {
  let t = T0;
  const now = () => t;
  const db = openDb(':memory:');
  const store = createStore(db, { aesKey: AES, now });
  const stripe = fakeStripe();
  const app = express();
  mountPro(app, {
    store, stripe, now, loginDelayMs, log: quiet,
    config: configured ? { priceId: 'price_test_pro', webhookSecret: SECRET, proSecretSet: true, publicUrl: 'https://bloombroke.com', portalConfigId: 'bpc_test_1', mode, termsVersion } : {},
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, { body, headers = {}, raw } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, body: json, headers: res.headers };
  };
  const sendEvent = (event, secret = SECRET) => {
    const payload = JSON.stringify(event);
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) });
    return req('POST', '/api/stripe/webhook', { raw: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig } });
  };
  const close = () => new Promise((r) => server.close(r));
  return { db, store, stripe, req, sendEvent, close, advance(ms) { t += ms; }, now };
}

const evt = (id, type, object) => ({ id, object: 'event', type, created: Math.floor(T0 / 1000), data: { object } });

// ---- licence keys -------------------------------------------------------------------

test('licence keys: format, alphabet without look-alikes, randomness', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const k = generateKey();
    assert.match(k, KEY_RE);
    seen.add(k);
  }
  assert.equal(seen.size, 500);
  assert.equal(ALPHABET.length, 32);
  for (const bad of 'O0I1') assert.ok(!ALPHABET.includes(bad), bad);
  // Deterministic with a fixed byte source: byte & 31 picks the letter.
  const k = generateKey(() => Buffer.from([0, 1, 2, 3, 31, 30, 29, 28, 32, 33, 34, 35, 255, 254, 253, 252]));
  assert.equal(k, 'BB-ABCD-9876-ABCD-9876');
  assert.equal(last4(k), '9876');
});

test('licence keys: normalize what people paste', () => {
  const k = 'BB-7KQ2-M9XD-HT4P-WZ3C';
  assert.equal(normalizeKey(k), k);
  assert.equal(normalizeKey(' bb-7kq2-m9xd-ht4p-wz3c '), k);
  assert.equal(normalizeKey('7KQ2M9XDHT4PWZ3C'), k);
  assert.equal(normalizeKey('BB 7KQ2 M9XD HT4P WZ3C'), k);
  assert.equal(normalizeKey('BB-BBQ2-M9XD-HT4P-WZ3C'), 'BB-BBQ2-M9XD-HT4P-WZ3C', 'a body that starts with BB');
  assert.equal(normalizeKey('BB-7KQ2-M9XD-HT4P-WZ30'), null, 'zero is not in the alphabet');
  assert.equal(normalizeKey('BB-7KQ2-M9XD-HT4P'), null);
  assert.equal(normalizeKey(''), null);
  assert.equal(normalizeKey(null), null);
  assert.equal(normalizeKey({}), null);
  assert.equal(normalizeKey('A'.repeat(100)), null);
});

test('licence keys: SHA-256 hash is stable hex and differs per key', () => {
  const h = hashKey('BB-7KQ2-M9XD-HT4P-WZ3C');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashKey('BB-7KQ2-M9XD-HT4P-WZ3C'));
  assert.notEqual(h, hashKey('BB-7KQ2-M9XD-HT4P-WZ3D'));
});

test('status rules: active and trialing on, past_due for 7 days, the rest off', () => {
  const lic = (status, extra = {}) => ({ status, last4: 'WZ3C', updated_at: T0, past_due_since: null, ...extra });
  assert.equal(proAccess(lic('active'), T0).active, true);
  assert.equal(proAccess(lic('trialing'), T0).active, true);
  const pd = lic('past_due', { past_due_since: T0 });
  assert.equal(proAccess(pd, T0 + 1).active, true);
  assert.equal(proAccess(pd, T0 + GRACE_MS - 1).active, true);
  assert.equal(proAccess(pd, T0 + GRACE_MS).active, false);
  assert.equal(proAccess(pd, T0).graceUntil, T0 + GRACE_MS);
  assert.equal(proAccess(lic('past_due', { updated_at: T0 - 8 * DAY }), T0).active, false, 'no since: falls back to updated_at');
  for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'weird']) {
    assert.equal(proAccess(lic(s), T0).active, false, s);
  }
  assert.equal(proAccess(null, T0).active, false);
});

test('reveal encryption: opens only with the same key and checkout session', () => {
  const tok = encryptReveal(AES, 'BB-7KQ2-M9XD-HT4P-WZ3C', 'cs_test_a');
  assert.ok(!tok.includes('7KQ2'));
  assert.equal(decryptReveal(AES, tok, 'cs_test_a'), 'BB-7KQ2-M9XD-HT4P-WZ3C');
  assert.throws(() => decryptReveal(AES, tok, 'cs_test_b'));
  assert.throws(() => decryptReveal(revealKeyFrom('y'.repeat(40)), tok, 'cs_test_a'));
  assert.throws(() => revealKeyFrom('short'));
});

// ---- store ---------------------------------------------------------------------------

test('store: ensureLicence is idempotent and keeps no plain key', () => {
  let t = T0;
  const db = openDb(':memory:');
  const store = createStore(db, { aesKey: AES, now: () => t });
  const a = store.ensureLicence({ sessionId: 'cs_test_1', customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active' });
  assert.equal(a.created, true);
  assert.match(a.key, KEY_RE);
  const b = store.ensureLicence({ sessionId: 'cs_test_1', customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active' });
  assert.equal(b.created, false);
  assert.equal(b.key, undefined);
  assert.equal(b.licence.id, a.licence.id);
  const rows = db.prepare('SELECT * FROM licences').all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.key_hash, hashKey(a.key));
  assert.equal(row.last4, a.key.slice(-4));
  const body = a.key.slice(3).replace(/-/g, '');
  for (const v of Object.values(row)) assert.ok(!String(v).includes(a.key) && !String(v).includes(body), 'no plain key in any column');
  assert.equal(store.findByKey(a.key).id, a.licence.id);
  // past_due: since is set once, kept, and cleared on recovery.
  store.setStatus(a.licence.id, 'past_due');
  t += 1000;
  const pd = store.setStatus(a.licence.id, 'past_due');
  assert.equal(pd.past_due_since, T0);
  assert.equal(store.setStatus(a.licence.id, 'active').past_due_since, null);
  // Reveal window, then purge.
  assert.equal(store.reveal('cs_test_1').key, a.key);
  assert.equal(store.reveal('cs_test_other'), null);
  t = T0 + REVEAL_MS;
  assert.equal(store.reveal('cs_test_1').expired, true);
  assert.equal(store.purgeReveals(), 1);
  assert.equal(db.prepare('SELECT reveal_ciphertext FROM licences').get().reveal_ciphertext, null);
});

test('store: terms_accepted_at is kept, filled once, and null without consent', () => {
  const store = createStore(openDb(':memory:'), { aesKey: AES, now: () => T0 });
  const a = store.ensureLicence({ sessionId: 'cs_test_t1', subscriptionId: 'sub_t1', status: 'active' });
  assert.equal(a.licence.terms_accepted_at, null);
  const b = store.ensureLicence({ sessionId: 'cs_test_t1', subscriptionId: 'sub_t1', status: 'active', termsAcceptedAt: T0 - 50 });
  assert.equal(b.licence.terms_accepted_at, T0 - 50);
  const c = store.ensureLicence({ sessionId: 'cs_test_t1', subscriptionId: 'sub_t1', status: 'active', termsAcceptedAt: T0 });
  assert.equal(c.licence.terms_accepted_at, T0 - 50, 'the first time stays');
});

test('store: without PRO_SECRET no licence can be made', () => {
  const store = createStore(openDb(':memory:'), {});
  assert.throws(() => store.ensureLicence({ sessionId: 'cs_test_1', subscriptionId: 'sub_1', status: 'active' }), /PRO_SECRET/);
});

test('migrations: applied once per database file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-pro-'));
  try {
    const file = path.join(dir, 'sub', 'pro.db');
    const a = openDb(file);
    assert.equal(a.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    a.close();
    const b = openDb(file);
    const files = readdirSync(new URL('../migrations', import.meta.url)).filter((f) => /^\d+_[\w-]+\.sql$/.test(f));
    assert.ok(files.length >= 7);
    assert.equal(b.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, files.length);
    assert.ok(b.prepare('PRAGMA table_info(licences)').all().some((c) => c.name === 'terms_accepted_at'));
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- checkout -------------------------------------------------------------------------

test('checkout: subscription mode, server price, no promo codes, no tax, fixed URLs', async () => {
  const p = checkoutParams({ priceId: 'price_x', publicUrl: 'https://bloombroke.com/' });
  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.payment_method_types, ['card'], 'no delayed payment methods');
  assert.equal(p.client_reference_id, undefined);
  assert.equal(p.customer, undefined);
  assert.deepEqual(p.line_items, [{ price: 'price_x', quantity: 1 }]);
  assert.equal(p.success_url, 'https://bloombroke.com/?c=PRO&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(p.cancel_url, 'https://bloombroke.com/?c=PRO');
  assert.equal(p.allow_promotion_codes, false);
  assert.deepEqual(p.automatic_tax, { enabled: false });
  assert.deepEqual(p.metadata, { site: 'bloombroke', product: 'pro' });
  assert.deepEqual(p.consent_collection, { terms_of_service: 'required' });
  assert.equal(p.custom_text.terms_of_service_acceptance.message, 'I agree to the [Terms](https://bloombroke.com/terms) and understand Bloombroke gives information only, not investment advice.');
  assert.equal(p.custom_text.submit.message, 'Auto-renews monthly at $42 USD. Cancel any time: type ME and press CANCEL; access continues to the end of the paid month.');

  const s = await setup();
  try {
    const r = await s.req('POST', '/api/pro/checkout', { body: { price: 'price_cheap', amount: 1, quantity: 99 } });
    assert.equal(r.status, 200);
    assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);
    const [, params] = s.stripe.calls.find((c) => c[0] === 'checkout.create');
    assert.deepEqual(params.line_items, [{ price: 'price_test_pro', quantity: 1 }], 'client body is ignored');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    for (let i = 0; i < 9; i++) await s.req('POST', '/api/pro/checkout');
    const limited = await s.req('POST', '/api/pro/checkout');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  } finally { await s.close(); }
});

test('checkout: closed until Stripe and secrets are configured', async () => {
  const s = await setup({ configured: false });
  try {
    assert.equal((await s.req('POST', '/api/pro/checkout')).status, 503);
    assert.equal((await s.req('POST', '/api/pro/claim', { body: { session_id: 'cs_test_session000001' } })).status, 503);
  } finally { await s.close(); }
});

// ---- webhook ---------------------------------------------------------------------------

test('webhook: rejects a missing or wrong signature', async () => {
  const s = await setup();
  try {
    const e = evt('evt_sig', 'checkout.session.completed', paidSession(1));
    const none = await s.req('POST', '/api/stripe/webhook', { raw: JSON.stringify(e), headers: { 'Content-Type': 'application/json' } });
    assert.equal(none.status, 400);
    const wrong = await s.sendEvent(e, 'whsec_someone_else');
    assert.equal(wrong.status, 400);
    const tampered = JSON.stringify(e);
    const sig = s.stripe.webhooks.generateTestHeaderString({ payload: tampered, secret: SECRET });
    const bad = await s.req('POST', '/api/stripe/webhook', { raw: tampered.replace('sub_1', 'sub_9'), headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig } });
    assert.equal(bad.status, 400);
    assert.equal(s.store.findBySubscription('sub_1'), null);
  } finally { await s.close(); }
});

test('webhook: checkout.session.completed makes one licence, tags only the last 4, and is idempotent', async () => {
  const s = await setup();
  try {
    s.stripe.subs.sub_1 = { id: 'sub_1', status: 'active', customer: 'cus_1' };
    const e = evt('evt_1', 'checkout.session.completed', paidSession(1));
    const r1 = await s.sendEvent(e);
    assert.equal(r1.status, 200);
    assert.equal(r1.body.result, 'licence');
    const lic = s.store.findBySubscription('sub_1');
    assert.equal(lic.status, 'active');
    assert.equal(lic.stripe_customer_id, 'cus_1');
    assert.equal(lic.terms_accepted_at, T0, 'terms time is the completion event time');
    const upd = s.stripe.calls.filter((c) => c[0] === 'sub.update');
    assert.equal(upd.length, 1);
    assert.deepEqual(upd[0][2].metadata, { site: 'bloombroke', product: 'pro', licence_last4: lic.last4, terms_accepted_at: new Date(T0).toISOString(), terms_version: '2026-09-27' });
    assert.equal(lic.terms_version, '2026-09-27');
    assert.equal(lic.last4.length, 4);
    const r2 = await s.sendEvent(e);
    assert.equal(r2.body.result, 'duplicate');
    // Same session, new event id (Stripe resend): still one licence, no second tag.
    const r3 = await s.sendEvent(evt('evt_1b', 'checkout.session.completed', paidSession(1)));
    assert.equal(r3.body.result, 'licence');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 1);
    assert.equal(s.stripe.calls.filter((c) => c[0] === 'sub.update').length, 1);
  } finally { await s.close(); }
});

test('webhook: ignores sessions from other products and unpaid sessions', async () => {
  const s = await setup();
  try {
    s.stripe.subs.sub_2 = { id: 'sub_2', status: 'active' };
    const other = await s.sendEvent(evt('evt_o', 'checkout.session.completed', paidSession(2, { metadata: { site: 'trackmyage' } })));
    assert.equal(other.body.result, 'ignored');
    const unpaid = await s.sendEvent(evt('evt_u', 'checkout.session.completed', paidSession(2, { payment_status: 'unpaid' })));
    assert.equal(unpaid.body.result, 'ignored');
    const payment = await s.sendEvent(evt('evt_p', 'checkout.session.completed', paidSession(2, { mode: 'payment' })));
    assert.equal(payment.body.result, 'ignored');
    const foreignSub = await s.sendEvent(evt('evt_fs', 'customer.subscription.updated', { id: 'sub_foreign', status: 'active' }));
    assert.equal(foreignSub.body.result, 'ignored');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 0);
  } finally { await s.close(); }
});

test('webhook: status follows Stripe through updated, payment_failed and deleted', async () => {
  const s = await setup();
  try {
    s.stripe.subs.sub_3 = { id: 'sub_3', status: 'active', customer: 'cus_3' };
    await s.sendEvent(evt('evt_c3', 'checkout.session.completed', paidSession(3)));
    // Payment fails: Stripe says past_due. The payload is not trusted; the fresh read is.
    s.stripe.subs.sub_3.status = 'past_due';
    const inv = { id: 'in_1', object: 'invoice', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_3' } } };
    assert.equal((await s.sendEvent(evt('evt_f3', 'invoice.payment_failed', inv))).body.result, 'updated');
    let lic = s.store.findBySubscription('sub_3');
    assert.equal(lic.status, 'past_due');
    assert.equal(lic.past_due_since, T0);
    assert.equal(proAccess(lic, T0 + 6 * DAY).active, true);
    assert.equal(proAccess(lic, T0 + 8 * DAY).active, false);
    // A stale "past_due" payload after recovery does not win.
    s.stripe.subs.sub_3.status = 'active';
    await s.sendEvent(evt('evt_u3', 'customer.subscription.updated', { id: 'sub_3', status: 'past_due' }));
    lic = s.store.findBySubscription('sub_3');
    assert.equal(lic.status, 'active');
    assert.equal(lic.past_due_since, null);
    await s.sendEvent(evt('evt_d3', 'customer.subscription.deleted', { id: 'sub_3', status: 'canceled' }));
    assert.equal(s.store.findBySubscription('sub_3').status, 'canceled');
  } finally { await s.close(); }
});

test('webhook: a transient failure returns 500 and the retry still works', async () => {
  const s = await setup();
  try {
    s.stripe.subs.sub_4 = { id: 'sub_4', status: 'active' };
    s.stripe.failSubscriptionRetrieves(1);
    const e = evt('evt_4', 'checkout.session.completed', paidSession(4));
    assert.equal((await s.sendEvent(e)).status, 500);
    assert.equal(s.store.isEventProcessed('evt_4'), false);
    const retry = await s.sendEvent(e);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.result, 'licence');
  } finally { await s.close(); }
});

test('webhook: invoice subscription id from new and old payload shapes', () => {
  assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_a' } } }), 'sub_a');
  assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: 'sub_b' } } } }), 'sub_b');
  assert.equal(invoiceSubscriptionId({ subscription: 'sub_c' }), 'sub_c');
  assert.equal(invoiceSubscriptionId({}), null);
  assert.deepEqual(WEBHOOK_EVENTS, ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed']);
});

// ---- claim -------------------------------------------------------------------------------

test('claim: key only for a paid session, the same key every time, for 24 hours', async () => {
  const s = await setup();
  try {
    const sess = paidSession(5);
    s.stripe.sessions[sess.id] = sess;
    s.stripe.subs.sub_5 = { id: 'sub_5', status: 'active', customer: 'cus_5' };
    assert.equal((await s.req('POST', '/api/pro/claim', { body: { session_id: 'nope' } })).status, 400);
    assert.equal((await s.req('POST', '/api/pro/claim', { body: { session_id: 'cs_test_unknown0000001' } })).status, 404);
    s.stripe.sessions.cs_test_unpaid0000001 = paidSession(6, { id: 'cs_test_unpaid0000001', payment_status: 'unpaid', status: 'open' });
    assert.equal((await s.req('POST', '/api/pro/claim', { body: { session_id: 'cs_test_unpaid0000001' } })).status, 402);
    s.stripe.sessions.cs_test_foreign000001 = paidSession(7, { id: 'cs_test_foreign000001', metadata: {} });
    assert.equal((await s.req('POST', '/api/pro/claim', { body: { session_id: 'cs_test_foreign000001' } })).status, 404);

    s.advance(5000);
    const a = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(a.status, 200);
    assert.match(a.body.key, KEY_RE);
    assert.equal(s.store.findBySession(sess.id).terms_accepted_at, T0 + 5000, 'from the success page: the time of the claim');
    assert.equal(a.body.active, true);
    assert.equal(a.headers.get('cache-control'), 'no-store');
    // The webhook arriving later finds the same licence.
    const w = await s.sendEvent(evt('evt_5', 'checkout.session.completed', sess));
    assert.equal(w.body.result, 'licence');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 1);
    const b = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(b.body.key, a.body.key);
    s.advance(REVEAL_MS - 1000);
    assert.equal((await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } })).body.key, a.body.key);
    s.advance(2000);
    const late = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(late.status, 410);
    assert.equal(late.body.key, undefined);
  } finally { await s.close(); }
});

test('claim: webhook first, then the success page shows that key', async () => {
  const s = await setup();
  try {
    const sess = paidSession(8);
    s.stripe.sessions[sess.id] = sess;
    s.stripe.subs.sub_8 = { id: 'sub_8', status: 'active' };
    await s.sendEvent(evt('evt_8', 'checkout.session.completed', sess));
    const lic = s.store.findBySubscription('sub_8');
    const r = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(r.status, 200);
    assert.equal(hashKey(r.body.key), lic.key_hash);
  } finally { await s.close(); }
});

// ---- login ---------------------------------------------------------------------------------

test('login: a good key returns status, a bad one 401, then rate limited', async () => {
  const s = await setup({ loginDelayMs: 40 });
  try {
    const { key } = s.store.ensureLicence({ sessionId: 'cs_test_l1', customerId: 'cus_l', subscriptionId: 'sub_l', status: 'active' });
    const t = Date.now();
    const ok = await s.req('POST', '/api/pro/login', { body: { key: key.toLowerCase() } });
    assert.ok(Date.now() - t >= 35, 'login waits a little');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true, active: true, status: 'active', last4: key.slice(-4), seat: 1, canGift: true });
    assert.equal((await s.req('GET', '/api/pro/status', { headers: { 'X-Pro-Key': key } })).body.active, true);
    const bad = await s.req('POST', '/api/pro/login', { body: { key: 'BB-AAAA-AAAA-AAAA-AAAA' } });
    assert.equal(bad.status, 401);
    assert.equal((await s.req('POST', '/api/pro/login', { raw: '{nope', headers: { 'Content-Type': 'application/json' } })).status, 400);
    let last;
    for (let i = 0; i < 10; i++) last = await s.req('POST', '/api/pro/login', { body: { key: 'BB-AAAA-AAAA-AAAA-AAAB' } });
    assert.equal(last.status, 429);
    assert.equal((await s.req('POST', '/api/pro/login', { body: { key } })).status, 429, 'even a good key waits out the limit');
  } finally { await s.close(); }
});

test('rate limiter: fixed window per key', () => {
  let t = 0;
  const l = createLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.equal(l.hit('a').ok, true);
  assert.equal(l.hit('a').ok, true);
  assert.equal(l.blocked('a'), true);
  assert.equal(l.hit('a').ok, false);
  assert.equal(l.hit('b').ok, true);
  t = 1000;
  assert.equal(l.blocked('a'), false);
  assert.equal(l.hit('a').ok, true);
});

// ---- sync ------------------------------------------------------------------------------------

test('sync: needs an active key, last write wins, 64 KB cap', async () => {
  const s = await setup();
  try {
    const { key, licence } = s.store.ensureLicence({ sessionId: 'cs_test_s1', customerId: 'cus_s', subscriptionId: 'sub_s', status: 'active' });
    const H = { 'X-Pro-Key': key };
    assert.equal((await s.req('GET', '/api/pro/sync')).status, 401);
    assert.equal((await s.req('GET', '/api/pro/sync', { headers: { 'X-Pro-Key': 'BB-AAAA-AAAA-AAAA-AAAA' } })).status, 401);

    const put1 = await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { watch: { data: ['AAPL', 'MSFT'], updatedAt: T0 - 1000 } } } });
    assert.equal(put1.status, 200);
    assert.deepEqual(put1.body.docs.watch, { data: ['AAPL', 'MSFT'], updatedAt: T0 - 1000 });
    // An older write loses, a newer one wins.
    const older = await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { watch: { data: ['OLD'], updatedAt: T0 - 5000 } } } });
    assert.deepEqual(older.body.written, []);
    assert.deepEqual(older.body.docs.watch.data, ['AAPL', 'MSFT']);
    const newer = await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { watch: { data: ['NVDA'], updatedAt: T0 }, pf: { data: [{ s: 'KO', q: 3 }], updatedAt: T0 } } } });
    assert.deepEqual(newer.body.written.sort(), ['pf', 'watch']);
    const got = await s.req('GET', '/api/pro/sync', { headers: H });
    assert.deepEqual(got.body.docs.watch.data, ['NVDA']);
    assert.deepEqual(got.body.docs.pf.data, [{ s: 'KO', q: 3 }]);
    // A clock far in the future is pulled back to now.
    await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { tape: { data: ['GOLD'], updatedAt: T0 + 365 * DAY } } } });
    assert.equal(s.store.getDocs(licence.id).tape.updatedAt, T0);

    const bigBody = await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { watch: { data: 'x'.repeat(MAX_SYNC_BYTES), updatedAt: T0 + 1 } } } });
    assert.equal(bigBody.status, 413);
    // Under the body limit on its own, but over the cap with what is stored.
    await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { a: { data: 'x'.repeat(40_000), updatedAt: T0 } } } });
    const over = await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { b: { data: 'x'.repeat(30_000), updatedAt: T0 } } } });
    assert.equal(over.status, 413);
    assert.equal(s.store.getDocs(licence.id).b, undefined);

    assert.equal((await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { 'Bad Name': { data: 1, updatedAt: T0 } } } })).status, 400);
    assert.equal((await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { watch: { data: 1, updatedAt: 'soon' } } } })).status, 400);
    assert.equal((await s.req('PUT', '/api/pro/sync', { headers: H, body: { nope: 1 } })).status, 400);

    s.store.setStatus(licence.id, 'canceled');
    const off = await s.req('GET', '/api/pro/sync', { headers: H });
    assert.equal(off.status, 402);
    assert.equal(off.body.status.active, false);
  } finally { await s.close(); }
});

// ---- portal ------------------------------------------------------------------------------------

test('portal: opens the Billing Portal for the key\'s customer only', async () => {
  const s = await setup();
  try {
    const { key } = s.store.ensureLicence({ sessionId: 'cs_test_p1', customerId: 'cus_p', subscriptionId: 'sub_p', status: 'canceled' });
    assert.equal((await s.req('POST', '/api/pro/portal')).status, 401);
    const r = await s.req('POST', '/api/pro/portal', { headers: { 'X-Pro-Key': key } });
    assert.equal(r.status, 200);
    assert.match(r.body.url, /^https:\/\/billing\.stripe\.com\//);
    const [, p] = s.stripe.calls.find((c) => c[0] === 'portal.create');
    assert.deepEqual(p, { customer: 'cus_p', return_url: 'https://bloombroke.com/?c=PRO', configuration: 'bpc_test_1' });
  } finally { await s.close(); }
});

// ---- review fixes ------------------------------------------------------------------------------

test('webhook: checkout.session.async_payment_succeeded makes the licence like completed', async () => {
  const s = await setup();
  try {
    s.stripe.subs.sub_9 = { id: 'sub_9', status: 'active', customer: 'cus_9' };
    const pending = await s.sendEvent(evt('evt_9a', 'checkout.session.completed', paidSession(9, { payment_status: 'unpaid' })));
    assert.equal(pending.body.result, 'ignored');
    const ok = await s.sendEvent(evt('evt_9b', 'checkout.session.async_payment_succeeded', paidSession(9)));
    assert.equal(ok.body.result, 'licence');
    assert.equal(s.store.findBySubscription('sub_9').status, 'active');
  } finally { await s.close(); }
});

test('claim: POST only, and the reveal copy is wiped once the browser confirms it saved the key', async () => {
  const s = await setup();
  try {
    const sess = paidSession(10);
    s.stripe.sessions[sess.id] = sess;
    s.stripe.subs.sub_10 = { id: 'sub_10', status: 'active', customer: 'cus_10' };
    assert.equal((await s.req('GET', `/api/pro/claim?session_id=${sess.id}`)).status, 404, 'no GET: the id never sits in a URL');
    const a = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(a.status, 200);
    const other = s.store.ensureLicence({ sessionId: 'cs_test_other00000001', subscriptionId: 'sub_other', status: 'active' });
    const wrong = await s.req('POST', '/api/pro/claim/confirm', { headers: { 'X-Pro-Key': other.key }, body: { session_id: sess.id } });
    assert.equal(wrong.status, 401, 'a key from another checkout cannot wipe it');
    assert.ok(s.store.findBySession(sess.id).reveal_ciphertext);
    const ok = await s.req('POST', '/api/pro/claim/confirm', { headers: { 'X-Pro-Key': a.body.key }, body: { session_id: sess.id } });
    assert.equal(ok.status, 200);
    assert.equal(s.store.findBySession(sess.id).reveal_ciphertext, null);
    const again = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(again.status, 410);
    assert.equal(again.body.key, undefined);
    assert.equal((await s.req('POST', '/api/pro/login', { body: { key: a.body.key } })).status, 200, 'the key itself still works');
  } finally { await s.close(); }
});

test('reactivate: same licence, same key, same synced data; no second key', async () => {
  const s = await setup();
  try {
    const first = s.store.ensureLicence({ sessionId: 'cs_test_first00000001', customerId: 'cus_r', subscriptionId: 'sub_old', status: 'canceled' });
    s.store.putDocs(first.licence.id, { watch: { data: ['KO'], updatedAt: T0 } });
    const H = { 'X-Pro-Key': first.key };
    // An older open checkout of this customer (another tab) is expired first.
    s.stripe.sessions.cs_test_opentab000001 = { id: 'cs_test_opentab000001', customer: 'cus_r', status: 'open', mode: 'subscription', metadata: { site: 'bloombroke', product: 'pro' } };
    const r = await s.req('POST', '/api/pro/checkout', { headers: H });
    assert.equal(r.status, 200);
    assert.deepEqual(s.stripe.calls.filter((c) => c[0] === 'checkout.expire').map((c) => c[1]), ['cs_test_opentab000001']);
    const [, params] = s.stripe.calls.find((c) => c[0] === 'checkout.create');
    assert.equal(params.client_reference_id, String(first.licence.id));
    assert.equal(params.customer, 'cus_r');
    assert.equal(params.metadata.licence_id, String(first.licence.id));

    const sess = paidSession(11, { customer: 'cus_r', subscription: 'sub_new', client_reference_id: String(first.licence.id), metadata: { site: 'bloombroke', product: 'pro', licence_id: String(first.licence.id) } });
    s.stripe.sessions[sess.id] = sess;
    s.stripe.subs.sub_new = { id: 'sub_new', status: 'active', customer: 'cus_r' };
    const w = await s.sendEvent(evt('evt_r1', 'checkout.session.completed', sess));
    assert.equal(w.body.result, 'licence');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 1, 'no second licence');
    const lic = s.store.findByKey(first.key);
    assert.equal(lic.id, first.licence.id);
    assert.equal(lic.stripe_subscription_id, 'sub_new');
    assert.equal(lic.status, 'active');
    assert.deepEqual(s.store.getDocs(lic.id).watch.data, ['KO']);
    const tag = s.stripe.calls.find((c) => c[0] === 'sub.update' && c[1] === 'sub_new');
    assert.equal(tag[2].metadata.licence_last4, first.key.slice(-4));
    // The success page gets the status, not a key.
    const c = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(c.status, 200);
    assert.equal(c.body.reactivated, true);
    assert.equal(c.body.key, undefined);
    assert.equal(c.body.active, true);
    // Events for the old subscription no longer touch the licence.
    assert.equal((await s.sendEvent(evt('evt_r2', 'customer.subscription.deleted', { id: 'sub_old' }))).body.result, 'ignored');
    assert.equal(s.store.findByKey(first.key).status, 'active');
    // Now active: a second purchase is refused.
    const again = await s.req('POST', '/api/pro/checkout', { headers: H });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_active');
  } finally { await s.close(); }
});

test('reactivate: refused while Stripe still has a live Pro subscription for the customer', async () => {
  const s = await setup();
  try {
    const { key } = s.store.ensureLicence({ sessionId: 'cs_test_dbl000000001', customerId: 'cus_d', subscriptionId: 'sub_d1', status: 'canceled' });
    s.stripe.subs.sub_d2 = { id: 'sub_d2', status: 'active', customer: 'cus_d', metadata: { site: 'bloombroke', product: 'pro' } };
    const r = await s.req('POST', '/api/pro/checkout', { headers: { 'X-Pro-Key': key } });
    assert.equal(r.status, 409);
    assert.equal(s.stripe.calls.filter((c) => c[0] === 'checkout.create').length, 0);
    assert.equal((await s.req('POST', '/api/pro/checkout', { headers: { 'X-Pro-Key': 'BB-AAAA-AAAA-AAAA-AAAA' } })).status, 401);
  } finally { await s.close(); }
});

test('rate limiter: a full table refuses new keys; IPv6 counts per /64', () => {
  let t = 0;
  const l = createLimiter({ max: 5, windowMs: 1000, maxKeys: 2, now: () => t });
  assert.equal(l.hit('a').ok, true);
  assert.equal(l.hit('b').ok, true);
  assert.equal(l.hit('c').ok, false, 'full: fail closed');
  assert.equal(l.blocked('c'), true);
  assert.equal(l.hit('a').ok, true, 'known keys still counted');
  t = 1000;
  assert.equal(l.hit('c').ok, true, 'after the window the sweep makes room');
  assert.equal(ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:0db8:0001:0002::/64');
  assert.equal(ipBucket('2001:db8:1:2::9'), '2001:0db8:0001:0002::/64');
  assert.equal(ipBucket('2001:db8:1:3::9'), '2001:0db8:0001:0003::/64');
  assert.equal(ipBucket('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipBucket('203.0.113.9'), '203.0.113.9');
  assert.equal(ipBucket('::1'), '0000:0000:0000:0000::/64');
});

test('sync: on an equal updatedAt the server copy stays and is returned', async () => {
  const s = await setup();
  try {
    const { key } = s.store.ensureLicence({ sessionId: 'cs_test_tie000000001', subscriptionId: 'sub_tie', status: 'active' });
    const H = { 'X-Pro-Key': key };
    await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { watch: { data: ['A'], updatedAt: T0 } } } });
    const tie = await s.req('PUT', '/api/pro/sync', { headers: H, body: { docs: { watch: { data: ['B'], updatedAt: T0 } } } });
    assert.deepEqual(tie.body.written, []);
    assert.deepEqual(tie.body.docs.watch, { data: ['A'], updatedAt: T0 });
  } finally { await s.close(); }
});

test('terms version is stored with the acceptance; config tells the page the mode', async () => {
  const s = await setup({ termsVersion: '2026-10-01' });
  try {
    s.stripe.subs.sub_12 = { id: 'sub_12', status: 'active' };
    await s.sendEvent(evt('evt_12', 'checkout.session.completed', paidSession(12)));
    const lic = s.store.findBySubscription('sub_12');
    assert.equal(lic.terms_version, '2026-10-01');
    assert.equal(lic.terms_accepted_at, T0);
    s.stripe.subs.sub_13 = { id: 'sub_13', status: 'active' };
    await s.sendEvent(evt('evt_13', 'checkout.session.completed', paidSession(13, { consent: null })));
    assert.equal(s.store.findBySubscription('sub_13').terms_version, null, 'no consent, no version');
    assert.deepEqual((await s.req('GET', '/api/pro/config')).body, { mode: 'live', open: true, price: 4200, currency: 'usd', yearly: false, yearPrice: 42000 });
  } finally { await s.close(); }
});

test('STRIPE_MODE: picks the key set, refuses a key of the other mode; demo licences are off on the live site', async () => {
  const live = stripeEnv({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PRICE_ID: 'price_l', STRIPE_SECRET_KEY_TEST: 'sk_test_y', STRIPE_PRICE_ID_TEST: 'price_t' });
  assert.equal(live.mode, 'live');
  assert.equal(live.secretKey, 'sk_live_x');
  assert.equal(live.priceId, 'price_l');
  const test = stripeEnv({ STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_SECRET_KEY_TEST: 'sk_test_y', STRIPE_PRICE_ID_TEST: 'price_t', STRIPE_WEBHOOK_SECRET_TEST: 'whsec_t' });
  assert.equal(test.mode, 'test');
  assert.equal(test.secretKey, 'sk_test_y');
  assert.equal(test.priceId, 'price_t');
  assert.equal(test.webhookSecret, 'whsec_t');
  assert.equal(test.names.priceId, 'STRIPE_PRICE_ID_TEST');
  const wrong = stripeEnv({ STRIPE_MODE: 'test', STRIPE_SECRET_KEY_TEST: 'sk_live_oops' });
  assert.equal(wrong.secretKey, null);
  assert.match(wrong.error, /not a test key/);
  assert.equal(stripeEnv({ STRIPE_SECRET_KEY: 'sk_test_z' }).secretKey, null, 'live mode never runs on a test key');

  const s = await setup({ mode: 'live' });
  try {
    s.stripe.subs.sub_14 = { id: 'sub_14', status: 'active' };
    await s.sendEvent(evt('evt_14', 'checkout.session.completed', paidSession(14, { livemode: false })));
    const lic = s.store.findBySubscription('sub_14');
    assert.equal(lic.livemode, 0);
    const { key } = s.store.rotateKey(lic.id);
    const st = await s.req('GET', '/api/pro/status', { headers: { 'X-Pro-Key': key } });
    assert.deepEqual(st.body, { active: false, status: 'demo', last4: key.slice(-4) });
    const r = await s.req('POST', '/api/pro/checkout', { headers: { 'X-Pro-Key': key } });
    assert.equal(r.status, 200, 'a demo key can buy for real');
    const [, params] = s.stripe.calls.find((c) => c[0] === 'checkout.create');
    assert.equal(params.customer, undefined, 'no test customer in a live checkout');
    assert.equal(params.client_reference_id, String(lic.id));
  } finally { await s.close(); }
  const t = await setup({ mode: 'test' });
  try {
    const { key } = t.store.ensureLicence({ sessionId: 'cs_live_paid00000001', subscriptionId: 'sub_live', status: 'active', livemode: true });
    assert.equal((await t.req('GET', '/api/pro/status', { headers: { 'X-Pro-Key': key } })).body.active, true, 'paid live keys keep working in test mode');
    assert.equal((await t.req('GET', '/api/pro/config')).body.mode, 'test');
  } finally { await t.close(); }
});

// ---- follow-ups ---------------------------------------------------------------------------------

const reactSession = (n, licId, extra = {}) => paidSession(n, {
  customer: `cus_${n}`, client_reference_id: String(licId), metadata: { site: 'bloombroke', product: 'pro', licence_id: String(licId) }, ...extra,
});

test('reactivate: a still-live old subscription is canceled, once, before the licence moves', async () => {
  const s = await setup();
  try {
    const first = s.store.ensureLicence({ sessionId: 'cs_test_prev00000001', customerId: 'cus_20', subscriptionId: 'sub_prev', status: 'past_due' });
    s.stripe.subs.sub_prev = { id: 'sub_prev', status: 'past_due', customer: 'cus_20' };
    s.stripe.subs.sub_20 = { id: 'sub_20', status: 'active', customer: 'cus_20' };
    const sess = reactSession(20, first.licence.id);
    await s.sendEvent(evt('evt_20', 'checkout.session.completed', sess));
    const cancels = s.stripe.calls.filter((c) => c[0] === 'sub.cancel');
    assert.deepEqual(cancels, [['sub.cancel', 'sub_prev', { idempotencyKey: 'bb-reactivate-cancel-sub_prev' }]]);
    assert.equal(s.store.findByKey(first.key).stripe_subscription_id, 'sub_20');
    // Resent event and the success page: no second cancel.
    await s.sendEvent(evt('evt_20b', 'checkout.session.completed', sess));
    s.stripe.sessions[sess.id] = sess;
    await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(s.stripe.calls.filter((c) => c[0] === 'sub.cancel').length, 1);
  } finally { await s.close(); }
});

test('reactivate: an old subscription that already ended is left alone', async () => {
  const s = await setup();
  try {
    const first = s.store.ensureLicence({ sessionId: 'cs_test_prev00000002', customerId: 'cus_21', subscriptionId: 'sub_gone', status: 'canceled' });
    s.stripe.subs.sub_gone = { id: 'sub_gone', status: 'canceled', customer: 'cus_21' };
    s.stripe.subs.sub_21 = { id: 'sub_21', status: 'active', customer: 'cus_21' };
    await s.sendEvent(evt('evt_21', 'checkout.session.completed', reactSession(21, first.licence.id)));
    assert.equal(s.stripe.calls.filter((c) => c[0] === 'sub.cancel').length, 0);
    assert.equal(s.store.findByKey(first.key).status, 'active');
  } finally { await s.close(); }
});

test('claim: a reactivation whose licence no longer exists makes a new licence and shows its key', async () => {
  const s = await setup();
  try {
    const sess = reactSession(22, 9999);
    s.stripe.sessions[sess.id] = sess;
    s.stripe.subs.sub_22 = { id: 'sub_22', status: 'active', customer: 'cus_22' };
    const r = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(r.status, 200);
    assert.match(r.body.key, KEY_RE);
    assert.equal(r.body.reactivated, undefined);
    // A normal reactivation reloaded later still answers with the status, not a 404.
    const first = s.store.ensureLicence({ sessionId: 'cs_test_prev00000003', customerId: 'cus_23', subscriptionId: 'sub_old23', status: 'canceled' });
    const re = reactSession(23, first.licence.id);
    s.stripe.sessions[re.id] = re;
    s.stripe.subs.sub_23 = { id: 'sub_23', status: 'active', customer: 'cus_23' };
    const a = await s.req('POST', '/api/pro/claim', { body: { session_id: re.id } });
    const b = await s.req('POST', '/api/pro/claim', { body: { session_id: re.id } });
    assert.equal(a.body.reactivated, true);
    assert.equal(b.status, 200);
    assert.equal(b.body.reactivated, true);
    assert.equal(b.body.key, undefined);
  } finally { await s.close(); }
});

test('migration 004: old licences get livemode from their checkout session id', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-mig-'));
  try {
    const early = path.join(dir, 'early');
    mkdirSync(early);
    for (const f of readdirSync('migrations').filter((f) => f < '004')) copyFileSync(path.join('migrations', f), path.join(early, f));
    const db = openDb(':memory:', { migrationsDir: early });
    const ins = db.prepare(`INSERT INTO licences (key_hash, last4, checkout_session_id, stripe_subscription_id, status, created_at, updated_at, livemode)
      VALUES (?, 'AAAA', ?, ?, 'active', 1, 1, ?)`);
    ins.run('h1', 'cs_test_a1', 's1', null);
    ins.run('h2', 'cs_live_b2', 's2', null);
    ins.run('h3', 'cs_live_c3', 's3', 0);
    ins.run('h4', null, 's4', null);
    migrate(db);
    const rows = Object.fromEntries(db.prepare('SELECT key_hash, livemode FROM licences').all().map((r) => [r.key_hash, r.livemode]));
    assert.deepEqual(rows, { h1: 0, h2: 1, h3: 0, h4: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rate limiter: the sweep runs at most once a second', () => {
  let t = 0;
  const l = createLimiter({ max: 5, windowMs: 100, maxKeys: 2, now: () => t });
  l.hit('a');
  l.hit('b');
  t = 150; // both expired
  assert.equal(l.hit('c').ok, true, 'first full check sweeps');
  l.hit('d');
  t = 400; // c and d expired, but the last sweep was 250 ms ago
  assert.equal(l.hit('e').ok, false, 'no second sweep within a second');
  t = 1200;
  assert.equal(l.hit('e').ok, true, 'a second later it sweeps again');
});

test('daily purge: synced data goes 30 days after the subscription ended, not before', () => {
  let t = T0;
  const db = openDb(':memory:');
  const store = createStore(db, { aesKey: AES, now: () => t });
  const mk = (n, status) => {
    const { licence } = store.ensureLicence({ sessionId: `cs_test_purge${n}`, subscriptionId: `sub_p${n}`, status: 'active' });
    store.putDocs(licence.id, { watch: { data: [n], updatedAt: T0 } });
    if (status !== 'active') store.setStatus(licence.id, status);
    return licence.id;
  };
  const canceledOld = mk(1, 'canceled');
  const unpaidOld = mk(2, 'unpaid');
  const pastDue = mk(3, 'past_due');
  const active = mk(4, 'active');
  t = T0 + 20 * DAY;
  const canceledNew = mk(5, 'canceled');
  const back = mk(6, 'canceled');
  // Reactivated before the 30 days are up: the clock stops.
  store.ensureLicence({ sessionId: 'cs_test_purge6b', subscriptionId: 'sub_p6b', status: 'active', licenceId: back });
  assert.equal(store.findById(back).ended_at, null);
  // A second "canceled" event does not restart the 30 days.
  t = T0 + 25 * DAY;
  store.setStatus(canceledOld, 'canceled');
  assert.equal(store.findById(canceledOld).ended_at, T0);

  t = T0 + 30 * DAY + 1;
  assert.deepEqual(store.purgeEnded(), { docs: 2, reveals: 2 });
  const has = (id) => Boolean(store.getDocs(id).watch);
  assert.equal(has(canceledOld), false);
  assert.equal(has(unpaidOld), false);
  assert.equal(store.findById(canceledOld).reveal_ciphertext, null);
  assert.equal(has(pastDue), true);
  assert.equal(has(active), true);
  assert.equal(has(canceledNew), true, 'ended 10 days ago');
  assert.equal(has(back), true);
  assert.ok(store.findById(canceledOld), 'the licence row stays, so the key can REACTIVATE');
  assert.deepEqual(store.purgeEnded(), { docs: 0, reveals: 0 });
  t = T0 + 50 * DAY + 1;
  assert.equal(store.purgeEnded().docs, 1);
  assert.equal(has(canceledNew), false);
});

test('renewal: cancel_at_period_end and the period end follow Stripe into /status', async () => {
  const s = await setup();
  try {
    const END = Math.floor(Date.UTC(2026, 9, 26, 12) / 1000);
    s.stripe.subs.sub_30 = { id: 'sub_30', status: 'active', customer: 'cus_30', cancel_at_period_end: false, cancel_at: null, items: { data: [{ current_period_end: END }] } };
    const sess = paidSession(30);
    s.stripe.sessions[sess.id] = sess;
    const c = await s.req('POST', '/api/pro/claim', { body: { session_id: sess.id } });
    assert.equal(c.body.cancelAtPeriodEnd, false);
    assert.equal(c.body.currentPeriodEnd, new Date(END * 1000).toISOString());
    const H = { 'X-Pro-Key': c.body.key };
    // Cancelled in the portal: Stripe keeps it active to the period end.
    Object.assign(s.stripe.subs.sub_30, { cancel_at_period_end: true, cancel_at: END });
    await s.sendEvent(evt('evt_30', 'customer.subscription.updated', { id: 'sub_30' }));
    const st = (await s.req('GET', '/api/pro/status', { headers: H })).body;
    assert.equal(st.active, true);
    assert.equal(st.cancelAtPeriodEnd, true);
    assert.equal(st.currentPeriodEnd, new Date(END * 1000).toISOString());
    assert.equal(st.cancelAt, new Date(END * 1000).toISOString());
    // Renewed again.
    Object.assign(s.stripe.subs.sub_30, { cancel_at_period_end: false, cancel_at: null });
    await s.sendEvent(evt('evt_31', 'customer.subscription.updated', { id: 'sub_30' }));
    const back = (await s.req('GET', '/api/pro/status', { headers: H })).body;
    assert.equal(back.cancelAtPeriodEnd, false);
    assert.equal(back.cancelAt, undefined);
    // Older payload shape: the period end on the subscription itself.
    assert.deepEqual(billingOf({ cancel_at_period_end: true, current_period_end: END }), { cancelAtPeriodEnd: true, currentPeriodEnd: END * 1000, cancelAt: null, interval: null });
  } finally { await s.close(); }
});

test('grandfathered: a subscription on an older price of ours still gets and keeps its licence', async () => {
  const s = await setup();
  try {
    const END = Math.floor(Date.UTC(2026, 9, 26, 12) / 1000);
    // Configured price is price_test_pro; this subscriber is on the old $4.20 price.
    const oldPrice = { id: 'price_old_420', unit_amount: 420, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, metadata: { site: 'bloombroke', product: 'pro' } };
    s.stripe.subs.sub_40 = { id: 'sub_40', status: 'active', customer: 'cus_40', cancel_at_period_end: false, cancel_at: null, items: { data: [{ price: oldPrice, current_period_end: END }] } };
    const sess = paidSession(40);
    s.stripe.sessions[sess.id] = sess;
    assert.equal((await s.sendEvent(evt('evt_40', 'checkout.session.completed', sess))).status, 200);
    const lic = s.store.findBySubscription('sub_40');
    assert.ok(lic, 'the licence is made from our metadata, not the price id');
    assert.equal(lic.status, 'active');
    // Renewal events on the old price keep it active.
    s.stripe.subs.sub_40.status = 'past_due';
    await s.sendEvent(evt('evt_41', 'customer.subscription.updated', { id: 'sub_40' }));
    assert.equal(s.store.findBySubscription('sub_40').status, 'past_due');
    s.stripe.subs.sub_40.status = 'active';
    await s.sendEvent(evt('evt_42', 'customer.subscription.updated', { id: 'sub_40' }));
    assert.equal(s.store.findBySubscription('sub_40').status, 'active');
    assert.equal(billingOf(s.stripe.subs.sub_40).interval, 'month');
    // Cancelled on the old price: the deleted event ends the licence like any other.
    s.stripe.subs.sub_40.status = 'canceled';
    assert.equal((await s.sendEvent(evt('evt_43', 'customer.subscription.deleted', { id: 'sub_40', status: 'canceled', items: { data: [{ price: oldPrice }] } }))).status, 200);
    assert.equal(s.store.findBySubscription('sub_40').status, 'canceled');
  } finally { await s.close(); }
});
