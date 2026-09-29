// PINGS, the server (pro/push.js, pro/push-send.js, migrations/016_push.sql): subscribe,
// unsubscribe, prefs, the server copy of the alerts, CHAT pings, the ALERTS loop, send
// errors, NEW KEY, DELETE MY ACCOUNT, the purge, and the feature off without VAPID keys.
// A fresh Express app on a random port, an in-memory database, a fake clock and a FAKE
// sender: no push service is ever called. Every key below is an obvious fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom } from '../pro/licence.js';
import { mountPro, defaultLimits } from '../pro/routes.js';
import { mountChat, chatLimits } from '../pro/chat-routes.js';
import { meLimits } from '../pro/me-routes.js';
import { createHub, DAY_MS } from '../pro/chat.js';
import {
  mountPush, pushConfig, pushHostOk, cleanSubscription, cleanServerAlerts, cleanPrefsPatch, createPushStore, PushError, MAX_SUBS,
} from '../pro/push.js';
import {
  createSender, createAlertLoop, chatPayload, alertPayload, plainText, usMarketOpen, OPEN_CHAT, CHAT_THROTTLE_MS, MAX_FAILS,
} from '../pro/push-send.js';
import { parseCommand, linkChanges } from '../public/app.js';
import { envLines, vapidKeys } from '../scripts/vapid-keys.js';

const AES = revealKeyFrom('z'.repeat(40));
const T0 = Date.UTC(2026, 8, 29, 15); // a Tuesday, 11:00 in New York: the market is open
const quiet = { log() {}, error() {} };
// Obvious fakes: a VAPID pair of repeated bytes, browser keys of repeated bytes.
const FAKE_VAPID = { publicKey: 'FAKE-PUBLIC-VAPID-KEY', privateKey: 'FAKE-PRIVATE-VAPID-KEY', subject: 'mailto:hello@bloombroke.com', devHosts: [] };
const FAKE_P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const FAKE_AUTH = Buffer.alloc(16, 9).toString('base64url');
const sub = (n, host = 'fcm.googleapis.com') => ({ endpoint: `https://${host}/fcm/send/fake-device-${n}`, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH } });

// The fake push service: records every send; fail(endpoint, status) makes it answer so.
function fakeSender() {
  const sent = [];
  const failing = new Map();
  const send = async (s, body, opts) => {
    sent.push({ endpoint: s.endpoint, body: JSON.parse(body), opts });
    const code = failing.get(s.endpoint);
    if (code) throw Object.assign(new Error(`push service said ${code}`), { statusCode: code });
    return { statusCode: 201 };
  };
  return { send, sent, fail: (endpoint, code) => failing.set(endpoint, code), ok: (endpoint) => failing.delete(endpoint) };
}

async function setup({ config = FAKE_VAPID, quotes = {} } = {}) {
  const db = openDb(':memory:');
  let t = T0;
  const now = () => t;
  const store = createStore(db, { aesKey: AES, now });
  let n = 0;
  const mk = (status = 'active') => {
    n += 1;
    const id = String(n).padStart(10, '0');
    return store.ensureLicence({ sessionId: `cs_test_${id}`, customerId: `cus_${id}`, subscriptionId: `sub_${id}`, status });
  };
  const app = express();
  const limits = defaultLimits(now);
  mountPro(app, { store, now, limits, loginDelayMs: 0, log: quiet, config: { mode: 'test' } });
  const fake = fakeSender();
  const q = { ...quotes };
  const getQuoteList = async (syms) => {
    getQuoteList.calls.push(syms);
    return { quotes: syms.filter((s) => q[s]).map((s) => ({ ticker: s, ...q[s] })) };
  };
  getQuoteList.calls = [];
  const push = mountPush(app, {
    db, store, guess: limits.guess, mode: 'test', config, send: fake.send, getQuoteList, now, log: quiet, alertEveryMs: 0,
  });
  const hub = createHub({ now, waitMs: 4000 });
  const chat = mountChat(app, {
    db, store, mode: 'test', parse: parseCommand, linkChanges, now, log: quiet, sweepMs: 0,
    guess: limits.guess, limits: chatLimits(now), meLimitsFor: meLimits(now), hub,
    onMessage: (m) => push.onMessage(m), onAccountDelete: (id) => push.wipe(id), pingsOf: (id) => push.exportOf(id),
  });
  store.onKeyChange((id) => push.forgetDevices(id));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, { body, key, origin = true } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['X-Pro-Key'] = key;
    if (origin) headers.Origin = base;
    const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* none */ }
    return { status: res.status, body: json, text };
  };
  const person = (status = 'active') => {
    const made = mk(status);
    const p = {
      key: made.key, seat: made.licence.seat, id: made.licence.id,
      subscribe: (s) => req('POST', '/api/push/subscribe', { key: p.key, body: s }),
      unsubscribe: (endpoint) => req('POST', '/api/push/unsubscribe', { key: p.key, body: { endpoint } }),
      prefs: (body) => (body ? req('PUT', '/api/push/prefs', { key: p.key, body }) : req('GET', '/api/push/prefs', { key: p.key })),
      // This person's first device (pinged() subscribes sub(p.id)) unless extra.endpoint.
      alerts: (alerts, extra = {}) => req('PUT', '/api/push/alerts', { key: p.key, body: { alerts, endpoint: sub(p.id).endpoint, ...extra } }),
      test: () => req('POST', '/api/push/test', { key: p.key }),
      open: (seats) => req('POST', '/api/chat/open', { key: p.key, body: { seats } }),
      say: (room, text) => req('POST', `/api/chat/rooms/${room}/messages`, { key: p.key, body: { text } }),
      post: (u, body = {}) => req('POST', u, { key: p.key, body }),
      get: (u) => req('GET', u, { key: p.key }),
    };
    return p;
  };
  const connect = async (a, b) => {
    const r = await a.open([b.seat]);
    if (r.body.room) return r.body.room.id;
    return (await b.post(`/api/chat/requests/${a.seat}`, { action: 'accept' })).body.room.id;
  };
  // A person with CHAT pings (and more) on one device.
  const pinged = async (p, prefs = { chat: true }, n = p.id) => {
    assert.equal((await p.subscribe(sub(n))).status, 200);
    assert.equal((await p.prefs(prefs)).status, 200);
    return sub(n).endpoint;
  };
  const count = (table, lic) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE licence_id = ?`).get(lic).n);
  return {
    db, store, push, chat, hub, fake, quotes: q, getQuoteList, req, person, connect, pinged, count, now,
    advance: (ms) => { t += ms; }, setNow: (v) => { t = v; },
    close: () => new Promise((r) => server.close(r)),
  };
}

// ---- off without keys, the key, config ------------------------------------------------------

test('off without VAPID keys: every route is 404 push_off, nothing hooks in, rows still purge', async () => {
  const s = await setup({ config: null });
  try {
    const a = s.person();
    for (const [m, u] of [['GET', '/api/push/key'], ['GET', '/api/push/prefs'], ['POST', '/api/push/subscribe'], ['PUT', '/api/push/alerts'], ['POST', '/api/push/test']]) {
      const r = await s.req(m, u, { key: a.key, body: m === 'GET' ? undefined : {} });
      assert.equal(r.status, 404, u);
      assert.equal(r.body.error, 'push_off', u);
    }
    assert.equal(s.push.enabled, false);
    assert.equal(s.push.onMessage({ room: 1, from: 1, message: { text: 'x' }, notify: [2] }), 0);
    assert.deepEqual(s.push.purge(), { subs: 0, prefs: 0, alerts: 0 });
  } finally { await s.close(); }
});

test('pushConfig: both keys of the right size, or off; the subject; dev hosts only on this machine', () => {
  const pub = Buffer.alloc(65, 1).toString('base64url'); // fake
  const priv = Buffer.alloc(32, 2).toString('base64url'); // fake
  assert.equal(pushConfig({}, quiet), null);
  assert.equal(pushConfig({ VAPID_PUBLIC_KEY: pub }, quiet), null);
  assert.equal(pushConfig({ VAPID_PUBLIC_KEY: 'short', VAPID_PRIVATE_KEY: priv }, quiet), null);
  assert.equal(pushConfig({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: 'hello' }, quiet), null);
  const dev = { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, PUSH_DEV_HOSTS: '127.0.0.1:3999, evil.example:443, localhost:8443', PUBLIC_URL: 'http://127.0.0.1:3022' };
  const c = pushConfig(dev, quiet);
  assert.equal(c.subject, 'mailto:hello@bloombroke.com');
  assert.deepEqual(c.devHosts, ['127.0.0.1:3999', 'localhost:8443'], 'development: this machine only');
  // Anywhere else the dev hosts are ignored, with a warning.
  const warned = [];
  const log = { log() {}, error: (m) => warned.push(m) };
  for (const env of [{ ...dev, NODE_ENV: 'production' }, { ...dev, HOST: '0.0.0.0' }, { ...dev, PUBLIC_URL: 'https://bloombroke.com' }, { ...dev, PUBLIC_URL: undefined }]) {
    assert.deepEqual(pushConfig(env, log).devHosts, [], JSON.stringify(env));
  }
  assert.equal(warned.length, 4);
  assert.match(warned[0], /PUSH_DEV_HOSTS is set outside development: ignored/);
  // scripts/vapid-keys.js makes a pair pushConfig accepts, in .env format.
  const k = vapidKeys();
  assert.ok(pushConfig({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey }, quiet));
  assert.match(envLines(k), /^VAPID_PUBLIC_KEY=[\w-]{87}\nVAPID_PRIVATE_KEY=[\w-]{43}\nVAPID_SUBJECT=mailto:hello@bloombroke\.com\n$/);
  // .env.example names the three, empty.
  const example = readFileSync('.env.example', 'utf8');
  for (const n of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) assert.match(example, new RegExp(`^${n}=$`, 'm'), n);
});

test('GET /api/push/key: the public key, no licence needed', async () => {
  const s = await setup();
  try {
    const r = await s.req('GET', '/api/push/key', { origin: false });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { key: FAKE_VAPID.publicKey });
  } finally { await s.close(); }
});

// ---- subscribe --------------------------------------------------------------------------------

test('push hosts: https, the five services, no port, no user, no lookalikes', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x',
    'https://api.push.apple.com/3/x', 'https://wns2-by3p.notify.windows.com/w/?token=x',
    // The real shapes: an FCM token with a colon, a Mozilla gAAAA token, an Apple path, a WNS token with %2b.
    'https://fcm.googleapis.com/fcm/send/dGhpc2lzZmFrZQ:APA91bFAKE-token_value',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABfakeFAKEfake_-=',
    'https://web.push.apple.com/QFAKEfakeFAKE-_fake',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAABfake%2bFAKE%3d%3d']) assert.ok(pushHostOk(ok), ok);
  for (const bad of ['http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://evil.com/x',
    'https://fcm.googleapis.com.evil.com/x', 'https://push.apple.com/x', 'https://evilpush.apple.com.evil/x', 'https://notify.windows.com/x', 'https://127.0.0.1/x', 'nonsense', '']) {
    assert.ok(!pushHostOk(bad), bad);
  }
  // Addresses the WHATWG URL and the legacy url.parse() (what web-push sends with) read as
  // different hosts: all refused (SSRF).
  for (const bad of [
    'https://evil.com;.push.apple.com/x', 'https://169.254.169.254;.push.apple.com/x', "https://127.0.0.1'.push.apple.com/", 'https://127.0.0.1".push.apple.com/',
    'https://127.0.0.1{.push.apple.com/', 'https://evil.com;.notify.windows.com/x', "https://10.0.0.1'.notify.windows.com/x", 'https://169.254.169.254{.notify.windows.com/x',
    'https:fcm.googleapis.com/fcm/send/x', 'https:/fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com', 'https://fcm.googleapis.com\\@evil.com/x',
    'https://evil.com\\.push.apple.com/x', 'https://fcm.googleapis.com /x', 'https://FCM.googleapis.com.\t/x', 'https://evil.com%2f.push.apple.com/x',
    'https://evil.com|.push.apple.com/x', 'https://evil.com^.push.apple.com/x', 'https://evil.com`.push.apple.com/x', 'https://evil.com<.push.apple.com/x',
    'https://fcm.googleapis.com/x;y', 'https://[::1].push.apple.com/x', 'https://fcm.googleapis.com./x',
  ]) assert.ok(!pushHostOk(bad), bad);
  assert.ok(pushHostOk('https://127.0.0.1:3999/fake', ['127.0.0.1:3999']), 'a dev host with its port');
  assert.ok(!pushHostOk("https://127.0.0.1:3999'.push.apple.com/x", ['127.0.0.1:3999']));
  assert.ok(!pushHostOk('https://127.0.0.1:4000/fake', ['127.0.0.1:3999']));
  // The browser keys: a 65-byte point starting 0x04, a 16-byte secret.
  assert.throws(() => cleanSubscription({ ...sub(1), keys: { p256dh: Buffer.alloc(65, 7).toString('base64url'), auth: FAKE_AUTH } }), PushError);
  assert.throws(() => cleanSubscription({ ...sub(1), keys: { p256dh: FAKE_P256DH, auth: Buffer.alloc(8).toString('base64url') } }), PushError);
  assert.throws(() => cleanSubscription({ endpoint: sub(1).endpoint }), PushError);
  assert.throws(() => cleanSubscription({ ...sub(1), endpoint: `https://fcm.googleapis.com/${'x'.repeat(1100)}` }), PushError);
  assert.deepEqual(cleanSubscription(sub(1)), { endpoint: sub(1).endpoint, p256dh: FAKE_P256DH, auth: FAKE_AUTH });
});

test('subscribe: an active key, same origin, a known push service, 10 devices at most', async () => {
  const s = await setup();
  try {
    const a = s.person();
    assert.equal((await s.req('POST', '/api/push/subscribe', { body: sub(1) })).status, 401, 'no key');
    assert.equal((await s.req('POST', '/api/push/subscribe', { key: 'BB-AAAA-BBBB-CCCC-DDDD', body: sub(1) })).status, 401, 'a wrong key');
    assert.equal((await s.req('POST', '/api/push/subscribe', { key: a.key, body: sub(1), origin: false })).status, 403, 'not same origin');
    const lapsed = s.person('canceled');
    assert.equal((await lapsed.subscribe(sub(99))).status, 402, 'Pro ended');
    const bad = await a.subscribe({ ...sub(1), endpoint: 'https://evil.example/push' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'bad_endpoint');
    assert.equal((await a.subscribe({ ...sub(1), endpoint: 'http://fcm.googleapis.com/fcm/send/x' })).status, 400, 'https only');
    for (let i = 1; i <= MAX_SUBS; i++) assert.equal((await a.subscribe(sub(i))).body.devices, i);
    assert.equal((await a.subscribe(sub(1))).status, 200, 'the same browser again does not count');
    const full = await a.subscribe(sub(11));
    assert.equal(full.status, 409);
    assert.equal(full.body.error, 'too_many');
    assert.equal(s.count('push_subs', a.id), 10);
    // A browser logs in with another key: it is that licence's device now.
    const b = s.person();
    await b.subscribe(sub(3));
    assert.equal(s.count('push_subs', a.id), 9);
    assert.equal(s.count('push_subs', b.id), 1);
  } finally { await s.close(); }
});

test('unsubscribe: only your own device; any valid key (a lapsed plan can still turn it off)', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    await a.subscribe(sub(1));
    await b.subscribe(sub(2));
    assert.equal((await a.unsubscribe(sub(2).endpoint)).status, 200);
    assert.equal(s.count('push_subs', b.id), 1, 'not A\'s to remove');
    s.store.setStatus(a.id, 'canceled');
    assert.equal((await a.unsubscribe(sub(1).endpoint)).status, 200);
    assert.equal(s.count('push_subs', a.id), 0);
    assert.equal((await a.unsubscribe(42)).status, 400);
  } finally { await s.close(); }
});

test('resubscribe: the service worker moves a replaced subscription; an unknown old address is 404', async () => {
  const s = await setup();
  try {
    const a = s.person();
    await a.subscribe(sub(1));
    const r = await s.req('POST', '/api/push/resubscribe', { body: { old: sub(1).endpoint, sub: sub(2) } });
    assert.equal(r.status, 200);
    assert.deepEqual(s.push.store.subsOf(a.id).map((x) => x.endpoint), [sub(2).endpoint]);
    assert.equal((await s.req('POST', '/api/push/resubscribe', { body: { old: sub(1).endpoint, sub: sub(3) } })).status, 404);
    assert.equal((await s.req('POST', '/api/push/resubscribe', { body: { old: sub(2).endpoint, sub: sub(3) }, origin: false })).status, 403);
    assert.equal((await s.req('POST', '/api/push/resubscribe', { body: { old: sub(2).endpoint, sub: { endpoint: 'https://evil.example/x', keys: sub(3).keys } } })).status, 400);
  } finally { await s.close(); }
});

// ---- prefs -----------------------------------------------------------------------------------

test('prefs: off by default, booleans only, per licence; ALERTS off drops the server copy', async () => {
  const s = await setup();
  try {
    const a = s.person();
    assert.deepEqual((await a.prefs()).body, { chat: false, alerts: false, show_text: false, devices: 0 });
    assert.equal((await a.prefs({ chat: 'yes' })).status, 400);
    assert.equal((await a.prefs({})).status, 400);
    assert.throws(() => cleanPrefsPatch([]), PushError);
    assert.deepEqual((await a.prefs({ chat: true, show_text: true })).body, { chat: true, alerts: false, show_text: true, devices: 0 });
    assert.deepEqual((await a.prefs({ alerts: true })).body, { chat: true, alerts: true, show_text: true, devices: 0 });
    await a.subscribe(sub(a.id));
    await a.alerts([{ id: 'a1', sym: 'AAPL', op: '>', level: 350, state: 'waiting' }]);
    assert.equal(s.count('server_alerts', a.id), 1);
    await a.prefs({ alerts: false });
    assert.equal(s.count('server_alerts', a.id), 0, 'the copy goes when closed-tab alerts go off');
  } finally { await s.close(); }
});

// ---- the server copy of the alerts ------------------------------------------------------------------

test('alerts: validated like the client, 20 at most, quote alerts only, replaced as a whole', async () => {
  const s = await setup();
  try {
    const a = s.person();
    const al = (i, extra = {}) => ({ id: `al${i}`, sym: 'AAPL', op: '>', level: 100 + i, dp: 2, state: 'waiting', ...extra });
    assert.equal((await a.alerts(Array.from({ length: 21 }, (_, i) => al(i)))).status, 400);
    for (const bad of [{ id: 'BAD ID' }, { sym: 'aapl' }, { op: '=' }, { level: 'x' }, { level: 1e13 }, { state: 'fired' }, { dp: 9 }, { kind: 'gauge' }]) {
      const r = await a.alerts([al(1, bad)]);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.body.error, 'bad_alert');
    }
    assert.equal((await a.alerts([al(1), al(1)])).status, 400, 'the same id twice');
    assert.equal((await a.alerts('x')).status, 400);
    // ALERTS pings off: nothing is kept.
    let r = await a.alerts([al(1)]);
    assert.deepEqual(r.body, { ok: true, count: 0, on: false, armed: [], fired: [] });
    assert.equal(s.count('server_alerts', a.id), 0);
    await a.prefs({ alerts: true });
    r = await a.alerts([al(1)]);
    assert.deepEqual(r.body, { ok: true, count: 0, on: false, armed: [], fired: [] }, 'no device at that address: nothing kept, the tab notifies');
    assert.equal(s.count('server_alerts', a.id), 0);
    await a.subscribe(sub(a.id));
    r = await a.alerts([al(1), al(2, { sym: 'EUR/USD', op: '<=' }), al(3, { state: 'triggered' })]);
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 3);
    assert.equal(r.body.on, true);
    assert.deepEqual(r.body.armed, ['al1', 'al2'], 'what the server pings for this device');
    assert.deepEqual(r.body.fired, ['al3']);
    const rows = s.push.store.alertsOf(a.id);
    assert.deepEqual(rows.map((x) => [x.client_id, x.symbol, x.op, x.level, x.fired_at !== null]), [['al1', 'AAPL', '>', 101, false], ['al2', 'EUR/USD', '<=', 102, false], ['al3', 'AAPL', '>', 103, true]]);
    await a.alerts([al(2, { sym: 'EUR/USD', op: '<=' })]);
    assert.deepEqual(s.push.store.alertsOf(a.id).map((x) => x.client_id), ['al2'], 'replaced');
    assert.deepEqual(cleanServerAlerts([]), []);
    assert.equal((await a.alerts([], { endpoint: sub(999).endpoint })).body.on, false, 'an address that is not this licence\'s device');
    assert.equal((await a.alerts([al(1, { value: 'x', state: 'triggered' })])).status, 400, 'a value is a number');
  } finally { await s.close(); }
});

// ---- the ALERTS loop -------------------------------------------------------------------------------

test('alert loop: fires once, never on a stale quote, only for ALERTS pings on with a device', async () => {
  const s = await setup({ quotes: { AAPL: { last: 349, stale: false } } });
  try {
    const a = s.person();
    const endpoint = await s.pinged(a, { alerts: true });
    await a.alerts([{ id: 'x1', sym: 'AAPL', op: '>', level: 350, dp: 2, state: 'waiting' }]);
    let r = await s.push.alerts.cycle();
    assert.equal(r.fired, 0);
    s.quotes.AAPL = { last: 351.2, stale: true };
    r = await s.push.alerts.cycle();
    assert.equal(r.fired, 0, 'a stale quote never fires');
    s.quotes.AAPL = { last: 351.2, stale: false };
    r = await s.push.alerts.cycle();
    assert.equal(r.fired, 1);
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 1);
    const ping = s.fake.sent[0];
    assert.equal(ping.endpoint, endpoint);
    assert.deepEqual(ping.body, { t: 'AAPL above 350', b: 'AAPL 351.20 · above your 350', u: '/?c=AAPL', g: 'bb-alert-x1' });
    assert.deepEqual(ping.opts, { ttl: 600, urgency: 'high', topic: ping.opts.topic });
    r = await s.push.alerts.cycle();
    assert.equal(r.symbols, 0, 'fired: nothing left to check');
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 1, 'once');
    // The browser shows it TRIGGERED: it stays fired. Re-armed there while still above: it
    // waits for a fresh crossing.
    await a.alerts([{ id: 'x1', sym: 'AAPL', op: '>', level: 350, dp: 2, state: 'triggered' }]);
    assert.equal((await s.push.alerts.cycle()).fired, 0);
    await a.alerts([{ id: 'x1', sym: 'AAPL', op: '>', level: 350, dp: 2, state: 'waiting', rearmed: true }]);
    assert.equal((await s.push.alerts.cycle()).fired, 0, 'still above: waits');
    s.quotes.AAPL = { last: 340, stale: false };
    assert.equal((await s.push.alerts.cycle()).fired, 0, 'below: armed again');
    s.quotes.AAPL = { last: 352, stale: false };
    assert.equal((await s.push.alerts.cycle()).fired, 1, 'a fresh crossing fires');
    // ALERTS pings off, or no device: not checked at all.
    await a.alerts([{ id: 'x2', sym: 'MSFT', op: '<', level: 1, state: 'waiting' }]);
    await a.prefs({ chat: true, alerts: false });
    assert.deepEqual(s.push.store.waitingAlerts(), []);
    // A lapsed Pro never fires.
    const b = s.person();
    await s.pinged(b, { alerts: true });
    await b.alerts([{ id: 'y1', sym: 'AAPL', op: '>', level: 1, state: 'waiting' }]);
    s.store.setStatus(b.id, 'canceled');
    assert.equal((await s.push.alerts.cycle()).fired, 0);
  } finally { await s.close(); }
});

test('the open tab saw the crossing first (its notification stood down): the one ping goes from the sync, to that device, once', async () => {
  const s = await setup({ quotes: { AAPL: { last: 349, stale: false } } });
  try {
    const a = s.person();
    const mine = await s.pinged(a, { alerts: true });
    await a.subscribe(sub(500)); // a second device of A: not pinged for this device's alert
    const x = { id: 'x1', sym: 'AAPL', op: '>', level: 350, dp: 2, state: 'waiting' };
    await a.alerts([x]);
    await s.push.alerts.cycle();
    const r = await a.alerts([{ ...x, state: 'triggered', value: 351.25 }]); // the tab's check came first
    assert.deepEqual(r.body.fired, ['x1']);
    await s.push.sender.drain();
    assert.deepEqual(s.fake.sent.map((m) => [m.endpoint, m.body.t, m.body.b]), [[mine, 'AAPL above 350', 'AAPL 351.25 · above your 350']]);
    assert.equal(s.fake.sent[0].opts.urgency, 'high');
    s.quotes.AAPL = { last: 351, stale: false };
    assert.equal((await s.push.alerts.cycle()).fired, 0, 'fired already: the loop does not ping again');
    await a.alerts([{ ...x, state: 'triggered', value: 351.25 }]);
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 1, 'once');
    // Without a value (an older tab): the ping still goes, without a number.
    await a.alerts([x, { id: 'x2', sym: 'MSFT', op: '<', level: 1, state: 'waiting' }]);
    await a.alerts([x, { id: 'x2', sym: 'MSFT', op: '<', level: 1, state: 'triggered' }]);
    await s.push.sender.drain();
    assert.equal(s.fake.sent[1].body.b, 'MSFT is below your 1');
  } finally { await s.close(); }
});

test('alerts are per device: two devices keep their own lists; one sends [] and the other keeps its alerts; the owner alone is pinged', async () => {
  const s = await setup({ quotes: { AAPL: { last: 351, stale: false }, MSFT: { last: 100, stale: false } } });
  try {
    const a = s.person();
    const one = await s.pinged(a, { alerts: true });
    await a.subscribe(sub(600));
    const two = sub(600).endpoint;
    await a.alerts([{ id: 'p1', sym: 'AAPL', op: '>', level: 350, state: 'waiting' }], { endpoint: one });
    await a.alerts([{ id: 'q1', sym: 'MSFT', op: '<', level: 50, state: 'waiting' }], { endpoint: two });
    // Device two opens ME with no alerts of its own: its list is [], device one's stays.
    await a.alerts([], { endpoint: two });
    assert.deepEqual(s.push.store.alertsOf(a.id).map((r) => r.client_id), ['p1']);
    await a.alerts([{ id: 'q1', sym: 'MSFT', op: '<', level: 50, state: 'waiting' }], { endpoint: two });
    assert.deepEqual(s.push.store.alertsOf(a.id).map((r) => r.client_id).sort(), ['p1', 'q1']);
    assert.equal((await s.push.alerts.cycle()).fired, 1);
    await s.push.sender.drain();
    assert.deepEqual(s.fake.sent.map((m) => m.endpoint), [one], 'only the device that owns the alert');
    // A device goes (LOGOUT, 410, NEW KEY): its alerts go with it.
    await a.unsubscribe(two);
    assert.deepEqual(s.push.store.alertsOf(a.id).map((r) => r.client_id), ['p1']);
    s.fake.fail(one, 410);
    s.push.sender.toLicence(a.id, { t: 'x' }, {});
    await s.push.sender.drain();
    assert.equal(s.count('server_alerts', a.id), 0, '410: the device and its alerts are gone');
    // Another licence logs in on a browser: that browser is a new device, the old alerts gone.
    const b = s.person();
    await a.subscribe(sub(700));
    await a.alerts([{ id: 'r1', sym: 'AAPL', op: '>', level: 1, state: 'waiting' }], { endpoint: sub(700).endpoint });
    await b.subscribe(sub(700));
    assert.equal(s.count('server_alerts', a.id), 0);
  } finally { await s.close(); }
});

test('alert loop: fired while the tab was not looking: it stays fired, goes back as fired, never re-armed by a stale WAITING', async () => {
  const s = await setup({ quotes: { AAPL: { last: 351, stale: false } } });
  try {
    const a = s.person();
    await s.pinged(a, { alerts: true });
    const x = { id: 'x1', sym: 'AAPL', op: '>', level: 350, dp: 2, state: 'waiting' };
    await a.alerts([x]);
    assert.equal((await s.push.alerts.cycle()).fired, 1);
    // The tab had not caught up: WAITING, even after the price went back and forth.
    s.quotes.AAPL = { last: 349, stale: false };
    let r = await a.alerts([x]);
    assert.deepEqual(r.body.fired, ['x1'], 'the tab learns it fired and marks it TRIGGERED');
    assert.deepEqual(r.body.armed, []);
    await s.push.alerts.cycle();
    s.quotes.AAPL = { last: 352, stale: false };
    assert.equal((await s.push.alerts.cycle()).fired, 0, 'no second ping: WAITING was not a re-arm');
    // The tab shows TRIGGERED, then the person re-arms it: now it fires on the next crossing.
    await a.alerts([{ ...x, state: 'triggered' }]);
    r = await a.alerts([{ ...x, rearmed: true }]);
    assert.deepEqual(r.body.armed, [], 'waiting for a fresh crossing: the tab keeps its own notification for now');
    assert.equal((await s.push.alerts.cycle()).fired, 0, 're-armed while above: waits');
    s.quotes.AAPL = { last: 349, stale: false };
    await s.push.alerts.cycle();
    r = await a.alerts([x]);
    assert.deepEqual(r.body.armed, ['x1'], 'back below: armed, the server pings it');
    s.quotes.AAPL = { last: 351, stale: false };
    assert.equal((await s.push.alerts.cycle()).fired, 1, 'the next crossing');
  } finally { await s.close(); }
});

test('alert loop: licences without Pro are left out before the symbol budget', async () => {
  const s = await setup({ quotes: { AAPL: { last: 1, stale: false }, MSFT: { last: 1, stale: false } } });
  try {
    const [a, b] = [s.person(), s.person()];
    for (const [p, sym] of [[a, 'AAPL'], [b, 'MSFT']]) {
      await s.pinged(p, { alerts: true });
      await p.alerts([{ id: 'x1', sym, op: '>', level: 100, state: 'waiting' }]);
    }
    s.store.setStatus(b.id, 'canceled');
    s.getQuoteList.calls.length = 0;
    const r = await s.push.alerts.cycle();
    assert.equal(r.symbols, 1);
    assert.deepEqual(s.getQuoteList.calls, [['AAPL']], 'MSFT (an ended licence) is not asked for');
  } finally { await s.close(); }
});

test('alert loop: 300 symbols a cycle at most, taking turns; closed market: only a quote that changed', async () => {
  const quotes = Object.fromEntries(['AA', 'BB', 'CC'].map((k) => [k, { last: 10, stale: false }]));
  const store = {
    waitingAlerts: () => ['AA', 'BB', 'CC'].map((sym, i) => ({ id: i + 1, licence_id: 1, client_id: `c${i}`, symbol: sym, op: '>', level: 50, dp: 2, armed: 1 })),
    armAlert() {}, fireAlert: () => true, subById: (id) => ({ id, endpoint: 'e' }),
  };
  const calls = [];
  const sent = [];
  let open = false;
  const loop = createAlertLoop({
    store, sender: { enqueue: (d, p) => sent.push(p) }, isActive: () => true, log: quiet, cap: 2, chunk: 1, marketOpen: () => open,
    getQuoteList: async (syms) => { calls.push(syms.join()); return { quotes: syms.map((t) => ({ ticker: t, ...quotes[t] })) }; },
  });
  await loop.cycle();
  assert.deepEqual(calls, ['AA', 'BB'], 'two symbols, one call each');
  calls.length = 0;
  await loop.cycle();
  assert.deepEqual(calls, ['CC', 'AA'], 'the next turn starts where the last stopped');
  // Market closed: a quote that did not move is not looked at; one that moved is.
  quotes.AA = { last: 60, stale: false };
  quotes.BB = { last: 10, stale: false };
  calls.length = 0;
  await loop.cycle();
  assert.equal(sent.length, 0, 'this turn is BB and CC, and neither changed');
  quotes.AA = { last: 61, stale: false };
  await loop.cycle();
  await loop.cycle();
  assert.deepEqual(sent.map((p) => p.t), ['AA above 50'], 'AA moved while closed: it fires');
  open = true;
  quotes.CC = { last: 70, stale: false };
  await loop.cycle();
  await loop.cycle();
  assert.ok(sent.some((p) => p.t === 'CC above 50'), 'open market: every fresh quote');
  // New York hours.
  assert.equal(usMarketOpen(new Date(T0)), true);
  assert.equal(usMarketOpen(new Date(Date.UTC(2026, 8, 29, 21))), false, '17:00 in New York');
  assert.equal(usMarketOpen(new Date(Date.UTC(2026, 9, 3, 15))), false, 'a Saturday');
});

test('alert payload: the level as typed, the value with its decimals, below and at-or-above', () => {
  assert.deepEqual(alertPayload({ symbol: 'US10Y', op: '<=', level: 4.25, dp: 3, client_id: 'z' }, 4.2491), { t: 'US10Y at or below 4.25', b: 'US10Y 4.249 · at or below your 4.25', u: '/?c=US10Y', g: 'bb-alert-z' });
  assert.equal(alertPayload({ symbol: 'EUR/USD', op: '<', level: 1.1, dp: 4, client_id: 'q' }, 1.0999).u, '/?c=EUR%2FUSD');
  assert.equal(alertPayload({ symbol: 'BTC', op: '>', level: 100000, dp: 0, client_id: 'q' }, 100500).t, 'BTC above 100,000');
});

// ---- CHAT pings ---------------------------------------------------------------------------------------

test('chat pings: the other member gets one, the sender none; the text only with SHOW MESSAGE TEXT', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    await s.pinged(a);
    const bEnd = await s.pinged(b);
    assert.equal((await a.say(room, 'Hello $AAPL')).status, 200);
    await s.push.sender.drain();
    assert.deepEqual(s.fake.sent.map((x) => x.endpoint), [bEnd], 'only B');
    assert.deepEqual(s.fake.sent[0].body, { t: `New message from SEAT ${a.seat}`, b: OPEN_CHAT, u: '/?c=CHAT', g: `bb-chat-${room}` });
    assert.equal(s.fake.sent[0].opts.ttl, 3600);
    // B turns SHOW MESSAGE TEXT on; A has a username. Throttled for 5 minutes per chat.
    await b.prefs({ show_text: true });
    await s.req('PUT', '/api/me/profile', { key: a.key, body: { username: 'Ann' } });
    await a.say(room, 'again');
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 1, 'one ping per chat per 5 minutes');
    s.advance(CHAT_THROTTLE_MS);
    await a.say(room, `Look at $NVDA and $AAPL ${'x'.repeat(100)}`);
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 2);
    const p = s.fake.sent[1].body;
    assert.equal(p.t, 'New message from @Ann');
    assert.ok(p.b.startsWith('Look at NVDA and AAPL x'), p.b);
    assert.equal(p.b.length, 80);
    assert.ok(p.b.endsWith('...'));
  } finally { await s.close(); }
});

test('chat pings: none while the recipient is on CHAT, none with CHAT pings off, none for a lapsed Pro', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    await s.pinged(b);
    // B's CHAT screen is open: a long-poll waits.
    const cursor = (await b.get('/api/chat')).body.cursor;
    const wait = b.get(`/api/chat/wait?after=${cursor}`);
    await new Promise((r) => setTimeout(r, 50));
    await a.say(room, 'you are here');
    await wait;
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 0, 'on CHAT: no ping');
    s.advance(60_000); // left CHAT a minute ago
    await a.say(room, 'now you are not');
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 1);
    s.advance(CHAT_THROTTLE_MS);
    await b.prefs({ chat: false });
    await a.say(room, 'off');
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 1, 'CHAT pings off');
    await b.prefs({ chat: true });
    s.store.setStatus(b.id, 'canceled');
    await a.say(room, 'lapsed');
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, 1, 'no Pro, no ping');
  } finally { await s.close(); }
});

test('chat pings: a blocked sender never pings; server lines, GUESS and DRIVE never ping', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    await s.connect(a, b);
    await s.connect(a, c);
    await s.connect(b, c);
    const group = (await a.open([b.seat, c.seat])).body.room.id;
    const cEnd = await s.pinged(c);
    const bEnd = await s.pinged(b);
    // C blocks A (in their DM): A's group messages are hidden for C, so no ping either.
    const dm = (await c.open([a.seat])).body.room.id;
    await c.post(`/api/chat/rooms/${dm}`, { action: 'block' });
    await a.say(group, 'hi all');
    await s.push.sender.drain();
    assert.deepEqual(s.fake.sent.map((x) => x.endpoint), [bEnd], 'B only; C blocked A');
    assert.ok(!s.fake.sent.some((x) => x.endpoint === cEnd));
    // DRIVE posts a server line: no ping.
    s.advance(CHAT_THROTTLE_MS);
    const before = s.fake.sent.length;
    assert.equal((await a.post(`/api/chat/rooms/${group}/drive`, { action: 'start' })).status, 200);
    await s.push.sender.drain();
    assert.equal(s.fake.sent.length, before, 'DRIVE lines never ping');
    // The hook itself: server lines and GUESS results are refused.
    assert.equal(s.push.onMessage({ room: group, from: a.id, message: { kind: 'sys', text: 'x' }, notify: [b.id] }), 0);
    assert.equal(s.push.onMessage({ room: group, from: a.id, message: { kind: 'guess', text: 'GUESS #1 3/6' }, notify: [b.id] }), 0);
  } finally { await s.close(); }
});

test('chat payload: SEAT or @name; $TICKERs plain; a card-only message shows its title', () => {
  assert.deepEqual(chatPayload({ seat: 7, name: null, text: 'x' }), { t: 'New message from SEAT 7', b: OPEN_CHAT, u: '/?c=CHAT' });
  assert.equal(chatPayload({ seat: 7, name: 'Tom', text: '', card: { title: 'AAPL 1Y chart' } }, { showText: true }).b, 'AAPL 1Y chart');
  assert.equal(plainText('Buy $BRK.B? no, $5 is $5.  Line\ntwo'), 'Buy BRK.B? no, $5 is $5. Line two');
});

// ---- sending ------------------------------------------------------------------------------------------

test('send errors: 404 or 410 drops the device at once; others count, 5 in a row drop it; a success resets', async () => {
  const s = await setup();
  try {
    const a = s.person();
    await a.subscribe(sub(1));
    await a.subscribe(sub(2));
    await a.prefs({ chat: true });
    s.fake.fail(sub(1).endpoint, 410);
    s.fake.fail(sub(2).endpoint, 500);
    const send = async () => { s.push.sender.toLicence(a.id, { t: 'x', b: 'y', u: '/' }, { ttl: 60 }); await s.push.sender.drain(); };
    await send();
    assert.deepEqual(s.push.store.subsOf(a.id).map((x) => [x.endpoint, x.fail_count]), [[sub(2).endpoint, 1]], '410: gone');
    for (let i = 0; i < 3; i++) await send();
    assert.equal(s.push.store.subsOf(a.id)[0].fail_count, 4);
    s.fake.ok(sub(2).endpoint);
    await send();
    assert.equal(s.push.store.subsOf(a.id)[0].fail_count, 0, 'a success resets the count');
    assert.equal(s.push.store.subsOf(a.id)[0].last_ok_at, s.now());
    s.fake.fail(sub(2).endpoint, 503);
    for (let i = 0; i < MAX_FAILS; i++) await send();
    assert.equal(s.count('push_subs', a.id), 0, '5 failures in a row: dropped');
    s.fake.fail(sub(3).endpoint, 404);
    await a.subscribe(sub(3));
    await send();
    assert.equal(s.count('push_subs', a.id), 0, '404: gone');
  } finally { await s.close(); }
});

test('sender: a full queue drops new pings; drain waits for the ones in flight', async () => {
  const push = { sendOk() {}, sendFailed: () => 1, dropSub() {}, subsOf: () => [{ id: 1, endpoint: sub(1).endpoint, p256dh: 'p', auth: 'a' }] };
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  const sender = createSender({ store: push, send: async () => { n += 1; await gate; }, concurrency: 1, maxQueue: 2, log: quiet });
  assert.equal(sender.toLicence(1, { t: 'a' }), 1);
  assert.equal(sender.toLicence(1, { t: 'b' }), 1);
  assert.equal(sender.toLicence(1, { t: 'c' }), 1);
  assert.equal(sender.toLicence(1, { t: 'd' }), 0, 'full');
  assert.equal(sender.stats().dropped, 1);
  const done = sender.drain();
  release();
  await done;
  assert.equal(n, 3);
});

test('a stored row with an address we do not send to: deleted at start, and never sent to by the sender', async () => {
  // A row that got in before today's check (an older build, a hand edit): the start-up
  // sweep deletes it.
  const db = openDb(':memory:');
  const store = createStore(db, { aesKey: AES, now: () => T0 });
  const made = store.ensureLicence({ sessionId: 'cs_test_0000000001', customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active' });
  const put = db.prepare('INSERT INTO push_subs (licence_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)');
  put.run(made.licence.id, 'https://169.254.169.254;.push.apple.com/x', FAKE_P256DH, FAKE_AUTH, T0);
  put.run(made.licence.id, sub(1).endpoint, FAKE_P256DH, FAKE_AUTH, T0);
  const fake = fakeSender();
  const errors = [];
  const push = mountPush(express(), { db, store, mode: 'test', config: FAKE_VAPID, send: fake.send, now: () => T0, log: { log() {}, error: (m) => errors.push(m) }, alertEveryMs: 0 });
  assert.deepEqual(push.store.subsOf(made.licence.id).map((r) => r.endpoint), [sub(1).endpoint]);
  assert.match(errors.join(' '), /1 stored subscriptions with an address we do not send to were deleted/);
  // The sender checks again right before sending: a bad row that is there anyway is
  // dropped, never handed to the push service.
  const dropped = [];
  const rows = [{ id: 9, endpoint: 'https:fcm.googleapis.com/fcm/send/x', p256dh: 'p', auth: 'a' }, { id: 10, endpoint: sub(2).endpoint, p256dh: 'p', auth: 'a' }];
  const sender = createSender({ store: { subsOf: () => rows, dropSub: (id) => dropped.push(id), sendOk() {}, sendFailed: () => 0 }, send: fake.send, log: quiet });
  sender.toLicence(1, { t: 'x' }, {});
  await sender.drain();
  assert.deepEqual(fake.sent.map((x) => x.endpoint), [sub(2).endpoint]);
  assert.deepEqual(dropped, [9]);
});

test('resubscribe and subscribe refuse the SSRF addresses too', async () => {
  const s = await setup();
  try {
    const a = s.person();
    await a.subscribe(sub(1));
    for (const endpoint of ['https://169.254.169.254;.push.apple.com/x', 'https:fcm.googleapis.com/fcm/send/x', "https://127.0.0.1'.notify.windows.com/x"]) {
      assert.equal((await a.subscribe({ ...sub(2), endpoint })).status, 400, endpoint);
      assert.equal((await s.req('POST', '/api/push/resubscribe', { body: { old: sub(1).endpoint, sub: { ...sub(2), endpoint } } })).status, 400, endpoint);
    }
    assert.deepEqual(s.push.store.subsOf(a.id).map((r) => r.endpoint), [sub(1).endpoint]);
  } finally { await s.close(); }
});

test('TEST: one ping to every device, 3 an hour, none without a device', async () => {
  const s = await setup();
  try {
    const a = s.person();
    const none = await a.test();
    assert.equal(none.status, 409);
    assert.equal(none.body.error, 'no_device');
    await a.subscribe(sub(1));
    await a.subscribe(sub(2));
    assert.deepEqual((await a.test()).body, { ok: true, sent: 2 });
    await a.test();
    const third = await a.test();
    assert.equal(third.status, 429);
    await s.push.sender.drain();
    assert.equal(s.fake.sent[0].body.b, 'Test ping. Pings work on this device.');
  } finally { await s.close(); }
});

test('DOWNLOAD MY DATA: devices by push service and date only, the ping settings, the copy of the alerts', async () => {
  const s = await setup();
  try {
    const a = s.person();
    await s.pinged(a, { chat: true, alerts: true });
    await a.subscribe(sub(5, 'updates.push.services.mozilla.com'));
    await a.alerts([{ id: 'x1', sym: 'AAPL', op: '>', level: 350, state: 'waiting' }, { id: 'x2', sym: 'MSFT', op: '<', level: 300, state: 'triggered' }]);
    const r = await s.req('POST', '/api/me/export', { key: a.key });
    assert.equal(r.status, 200);
    const d = JSON.parse(r.text);
    const at = new Date(s.now()).toISOString();
    assert.deepEqual(d.pings, {
      devices: [
        { push_service: 'fcm.googleapis.com', added: at, last_ping: null, alerts: [{ symbol: 'AAPL', op: '>', level: 350, added: at, fired: null }, { symbol: 'MSFT', op: '<', level: 300, added: at, fired: at }] },
        { push_service: 'updates.push.services.mozilla.com', added: at, last_ping: null, alerts: [] },
      ],
      settings: { chat: true, alerts: true, show_text: false },
    });
    assert.ok(!r.text.includes('fake-device') && !r.text.includes(FAKE_P256DH) && !r.text.includes(FAKE_AUTH), 'no address, no keys');
  } finally { await s.close(); }
});

// ---- NEW KEY, DELETE MY ACCOUNT, the purge -----------------------------------------------------------------

test('NEW KEY drops every device (settings stay); DELETE MY ACCOUNT drops everything at once', async () => {
  const s = await setup();
  try {
    const a = s.person();
    await s.pinged(a, { chat: true, alerts: true });
    await a.subscribe(sub(77));
    await a.alerts([{ id: 'x1', sym: 'AAPL', op: '>', level: 1, state: 'waiting' }]);
    const r = await s.req('POST', '/api/pro/rotate', { key: a.key });
    assert.equal(r.status, 200);
    assert.equal(s.count('push_subs', a.id), 0, 'NEW KEY logs out every device');
    assert.equal(s.count('push_prefs', a.id), 1);
    a.key = r.body.key;
    await a.subscribe(sub(78));
    s.store.setStatus(a.id, 'canceled');
    const del = await s.req('POST', '/api/me/delete', { key: a.key, body: { confirm: 'DELETE' } });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    for (const t of ['push_subs', 'push_prefs', 'server_alerts']) assert.equal(s.count(t, a.id), 0, t);
  } finally { await s.close(); }
});

test('purge: every push row 30 days after the Pro ended, not before; others stay', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    for (const p of [a, b]) {
      await s.pinged(p, { chat: true, alerts: true });
      await p.alerts([{ id: 'x1', sym: 'AAPL', op: '>', level: 1, state: 'waiting' }]);
    }
    s.store.setStatus(a.id, 'canceled');
    s.advance(29 * DAY_MS);
    assert.deepEqual(s.push.purge(), { subs: 0, prefs: 0, alerts: 0 }, 'not yet');
    s.advance(2 * DAY_MS);
    assert.deepEqual(s.push.purge(), { subs: 1, prefs: 1, alerts: 1 });
    for (const t of ['push_subs', 'push_prefs', 'server_alerts']) {
      assert.equal(s.count(t, a.id), 0, t);
      assert.equal(s.count(t, b.id), 1, t);
    }
    // The 5-year licence purge is never blocked by a push row (they cascade).
    s.db.prepare('DELETE FROM licences WHERE id = ?').run(b.id);
    assert.equal(s.count('push_subs', b.id), 0);
  } finally { await s.close(); }
});

test('the push store alone: a fresh database migrates to 016 with the three tables', () => {
  const db = openDb(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('push_subs', 'push_prefs', 'server_alerts') ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(names, ['push_prefs', 'push_subs', 'server_alerts']);
  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = '016_push.sql'").get());
  const store = createPushStore(db);
  assert.deepEqual(store.prefs(1), { chat: false, alerts: false, show_text: false });
});
