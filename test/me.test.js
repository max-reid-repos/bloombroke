// ME, the server: usernames (pro/chat.js cleanUsername, chat-store.js setProfile), colours
// and avatars, GET /api/me, PUT /api/me/profile, POST /api/me/export and /api/me/delete
// (pro/me-routes.js), NEW KEY (POST /api/pro/rotate, pro/routes.js), CHAT @name, and the
// migration of old display names (migrations/015_profiles.sql). A fresh Express app on a
// random port, an in-memory database, a fake clock: no network, no Stripe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { openDb, migrate } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom, hashKey } from '../pro/licence.js';
import { createLimiter } from '../pro/ratelimit.js';
import { mountPro, defaultLimits } from '../pro/routes.js';
import { mountChat, chatLimits } from '../pro/chat-routes.js';
import { meLimits, willRenew, RENEWING, DELETED } from '../pro/me-routes.js';
import {
  cleanUsername, cleanColor, cleanAvatar, reservedName, usernameOk, RESERVED, NAME_TAKEN, MAX_NAME_CHANGES, RELEASE_MS, DAY_MS, KEEP_MS,
} from '../pro/chat.js';
import { parseCommand, linkChanges } from '../public/app.js';

const AES = revealKeyFrom('z'.repeat(40));
const T0 = Date.UTC(2026, 8, 29, 12);
const quiet = { log() {}, error() {} };

async function setup() {
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
  const chat = mountChat(app, {
    db, store, mode: 'test', parse: parseCommand, linkChanges, now, log: quiet, sweepMs: 0,
    guess: limits.guess, limits: chatLimits(now), meLimitsFor: meLimits(now),
  });
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
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const person = (status = 'active') => {
    const made = mk(status);
    const p = {
      key: made.key, seat: made.licence.seat, id: made.licence.id,
      me: () => req('GET', '/api/me', { key: p.key }),
      set: (body) => req('PUT', '/api/me/profile', { key: p.key, body }),
      exp: () => req('POST', '/api/me/export', { key: p.key }),
      del: (confirm = 'DELETE') => req('POST', '/api/me/delete', { key: p.key, body: { confirm } }),
      rotate: () => req('POST', '/api/pro/rotate', { key: p.key }),
      open: (body) => req('POST', '/api/chat/open', { key: p.key, body }),
      say: (room, text) => req('POST', `/api/chat/rooms/${room}/messages`, { key: p.key, body: { text } }),
      list: () => req('GET', '/api/chat', { key: p.key }),
      post: (u, body = {}) => req('POST', u, { key: p.key, body }),
    };
    return p;
  };
  const connect = async (a, b) => {
    const r = await a.open({ seats: [b.seat] });
    if (r.body.room) return r.body.room.id;
    return (await b.post(`/api/chat/requests/${a.seat}`, { action: 'accept' })).body.room.id;
  };
  return {
    db, store, chat, req, person, connect, now, advance: (ms) => { t += ms; }, setNow: (v) => { t = v; },
    close: () => new Promise((r) => server.close(r)),
  };
}

// Nothing secret in an answer: no key, no key hash, no licence id field, no Stripe id.
function clean(s, res, keys = []) {
  const hashes = s.db.prepare('SELECT key_hash FROM licences').all().map((r) => r.key_hash);
  for (const k of [...keys, ...hashes]) assert.ok(!res.text.includes(k), 'no key or key hash');
  assert.doesNotMatch(res.text, /licence_id|key_hash|"last4"|cus_\d|sub_\d|cs_test_|stripe/i);
}

// ---- the rules ------------------------------------------------------------------------------

test('username rules: 3 to 15, A-Z a-z 0-9 _, a letter first, shown as typed', () => {
  assert.equal(cleanUsername('Tom'), 'Tom');
  assert.equal(cleanUsername('  tom_lee_2 '), 'tom_lee_2');
  assert.equal(cleanUsername('Abcdefghijklmno'), 'Abcdefghijklmno', '15 is fine');
  assert.equal(cleanUsername(''), null);
  assert.equal(cleanUsername(null), null);
  for (const bad of ['ab', 'Abcdefghijklmnop', 'tom lee', 'tom-lee', 'tom.lee', 'tóm', '_tom', '9lives', '12345', 'tom<3', 7, {}]) {
    assert.throws(() => cleanUsername(bad), { code: 'bad_name' }, String(bad));
  }
  assert.ok(usernameOk('Tom') && !usernameOk('tom lee') && !usernameOk('admin'));
});

test('username rules: reserved words, seats, command words and bad words are refused', () => {
  for (const w of RESERVED) assert.ok(reservedName(w) && reservedName(w.toUpperCase()), w);
  for (const bad of ['Admin', 'SUPPORT', 'Bloombroke', 'staff', 'mod', 'Pro', 'chat', 'seat', 'Seat42', 'official', 'root', 'system', 'help', 'me', 'bb2', 'BB00042', 'bb123abc',
    'Graveyard', 'news', 'MARKETS', 'watchlist', 'Settings', 'account', 'fuck', 'shit_head', 'Fuckface']) {
    assert.throws(() => cleanUsername(bad), { code: 'bad_name' }, bad);
  }
  for (const ok of ['Tom', 'Ann', 'bbq_king', 'Bobby', 'Cassandra', 'Scunthorpe', 'Dickens', 'Maxwell']) assert.equal(cleanUsername(ok), ok, ok);
});

test('colour 0 to 7 or null; avatar 16 hex characters or null', () => {
  for (const c of [0, 3, 7, null]) assert.equal(cleanColor(c), c);
  for (const c of [-1, 8, 1.5, '3', true]) assert.throws(() => cleanColor(c), { code: 'bad_color' }, String(c));
  assert.equal(cleanAvatar('0123456789ABCDEF'), '0123456789abcdef', 'stored lower case');
  assert.equal(cleanAvatar(null), null);
  for (const a of ['', '0123', '0123456789abcdeg', '0123456789abcdef0', 42]) assert.throws(() => cleanAvatar(a), { code: 'bad_avatar' }, String(a));
});

// ---- profile --------------------------------------------------------------------------------

test('profile: set, read back, unique whatever the case, 409 with a neutral message', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const r = await a.set({ username: 'Tom', color: 3, avatar: 'FF818181818181FF' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.me, { seat: a.seat, username: 'Tom', color: 3, avatar: 'ff818181818181ff' });
    const me = await a.me();
    assert.equal(me.status, 200);
    assert.deepEqual({ ...me.body, status: undefined }, { seat: a.seat, username: 'Tom', color: 3, avatar: 'ff818181818181ff', status: undefined });
    assert.equal(me.body.status.active, true);
    clean(s, me, [a.key]);
    const taken = await b.set({ username: 'TOM' });
    assert.equal(taken.status, 409);
    assert.deepEqual(taken.body, { error: 'taken', message: NAME_TAKEN });
    assert.equal((await b.set({ username: 'tom' })).body.message, NAME_TAKEN, 'any case');
    // Colour and avatar alone change nothing about the name.
    assert.equal((await a.set({ color: 7 })).body.me.username, 'Tom');
    assert.equal((await a.set({ avatar: null })).body.me.avatar, null, 'back to the initials');
    for (const bad of [{ username: 'x y z' }, { color: 9 }, { avatar: 'zz' }, {}, { other: 1 }]) assert.equal((await a.set(bad)).status, 400, JSON.stringify(bad));
  } finally { await s.close(); }
});

test('profile: Pro only, same origin only, a wrong key counts as a guess', async () => {
  const s = await setup();
  try {
    const a = s.person();
    const off = s.person('canceled');
    assert.equal((await off.set({ username: 'Lapsed' })).status, 402);
    assert.equal((await off.me()).status, 200, 'a lapsed key can still read ME');
    assert.equal((await s.req('PUT', '/api/me/profile', { key: a.key, body: { username: 'Tom' }, origin: false })).status, 403);
    assert.equal((await s.req('POST', '/api/me/export', { key: a.key, origin: false })).status, 403);
    assert.equal((await s.req('POST', '/api/me/delete', { key: a.key, body: { confirm: 'DELETE' }, origin: false })).status, 403);
    assert.equal((await s.req('POST', '/api/pro/rotate', { key: a.key, origin: false })).status, 403);
    assert.equal((await s.req('GET', '/api/me')).status, 401);
    for (let i = 0; i < 20; i++) await s.req('GET', '/api/me', { key: 'BB-AAAA-BBBB-CCCC-DDDD' });
    assert.equal((await a.me()).status, 429, 'the shared wrong-key limit, per IP');
  } finally { await s.close(); }
});

test('username: 3 changes a day, then 429 until the day is over', async () => {
  const s = await setup();
  try {
    const a = s.person();
    for (const name of ['Tom', 'Tommy', 'Thomas']) assert.equal((await a.set({ username: name })).status, 200, name);
    const fourth = await a.set({ username: 'Tomas' });
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error, 'name_limit');
    assert.equal((await a.set({ username: 'Thomas', color: 1 })).status, 200, 'the same name again is no change');
    s.advance(DAY_MS);
    assert.equal((await a.set({ username: 'Tomas' })).status, 200);
    assert.equal(MAX_NAME_CHANGES, 3);
  } finally { await s.close(); }
});

test('username: a released name is locked 30 days for others; its owner may take it back', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    await a.set({ username: 'Tom' });
    await a.set({ username: 'Tommy' });
    assert.equal((await b.set({ username: 'tom' })).status, 409, 'locked for others');
    assert.equal((await a.set({ username: 'Tom' })).status, 200, 'the licence that gave it up takes it back');
    s.advance(DAY_MS); // 3 changes a day
    assert.equal((await a.set({ username: null })).status, 200);
    s.advance(RELEASE_MS - 1000);
    assert.equal((await b.set({ username: 'Tom' })).status, 409);
    s.advance(2000);
    assert.equal((await b.set({ username: 'Tom' })).status, 200, '30 days on: free');
    assert.equal(RELEASE_MS, 30 * DAY_MS);
    s.chat.purge(s.now());
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM name_releases WHERE released_at <= ?').get(s.now() - RELEASE_MS).n, 0, 'old locks are deleted');
  } finally { await s.close(); }
});

// ---- CHAT @name -------------------------------------------------------------------------------

test('CHAT @name: the same neutral answer for a name that exists and one that does not', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    await b.set({ username: 'Bee' });
    const known = await a.open({ name: 'bee' });
    const unknown = await a.open({ name: 'Nobody_here' });
    assert.equal(known.status, 200);
    assert.deepEqual(known.body, { sent: true, message: 'Request sent to @bee.' });
    assert.deepEqual(unknown.body, { sent: true, message: 'Request sent to @Nobody_here.' });
    assert.equal(known.body.seat, undefined, 'no seat behind a name');
    // B sees the request from A, and accepting opens the DM.
    const list = await b.list();
    assert.equal(list.body.requests.in[0].seat, a.seat);
    const room = (await b.post(`/api/chat/requests/${a.seat}`, { action: 'accept' })).body.room.id;
    assert.equal((await a.open({ name: '@BEE' })).body.room.id, room, 'a contact: the room');
    assert.equal((await a.open({ name: 'x' })).status, 400);
    assert.equal((await a.open({ name: 'bad name' })).status, 400);
    await a.set({ username: 'Ann' });
    assert.equal((await a.open({ name: 'ann' })).body.error, 'self');
    // Parsed on the client: CHAT @tom, one name only.
    assert.deepEqual(parseCommand('chat @tom').args, { name: 'TOM' });
    assert.equal(parseCommand('chat @tom').mutates, true);
    assert.equal(parseCommand('chat @tom @ann').error, 'usage');
  } finally { await s.close(); }
});

test('CHAT @name: the same request limits as CHAT 42, so names cannot be tested past them', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    await b.set({ username: 'Bee' });
    for (let i = 0; i < 10; i++) assert.equal((await a.open({ name: `Ghost_${i}` })).status, 200);
    const real = await a.open({ name: 'Bee' });
    const fake = await a.open({ name: 'Ghost_x' });
    const seat = await a.open({ seats: [b.seat] });
    assert.equal(real.status, 429);
    assert.deepEqual(real.body, fake.body, 'a real and a made-up name look the same');
    assert.deepEqual(real.body, seat.body, 'and the same as a seat');
  } finally { await s.close(); }
});

test('CHAT: people carry their username, colour and avatar; the old NAME route follows the new rules', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    await a.set({ username: 'Tom', color: 2, avatar: '00ff00ff00ff00ff' });
    await a.say(room, 'hi');
    const got = await s.req('GET', `/api/chat/rooms/${room}/messages`, { key: b.key });
    const m = got.body.messages.at(-1);
    assert.deepEqual({ seat: m.seat, name: m.name, color: m.color, avatar: m.avatar }, { seat: a.seat, name: 'Tom', color: 2, avatar: '00ff00ff00ff00ff' });
    const lb = await b.list();
    assert.equal(lb.body.rooms[0].title, `Tom #${a.seat}`);
    assert.deepEqual(lb.body.rooms[0].members.find((p) => p.seat === a.seat), { seat: a.seat, name: 'Tom', color: 2, avatar: '00ff00ff00ff00ff' });
    clean(s, lb, [a.key, b.key]);
    assert.equal((await s.req('PUT', '/api/chat/me', { key: b.key, body: { name: 'bad name' } })).status, 400);
    assert.equal((await s.req('PUT', '/api/chat/me', { key: b.key, body: { name: 'tom' } })).status, 409, 'unique here too');
    assert.equal((await s.req('PUT', '/api/chat/me', { key: b.key, body: { name: 'Bee' } })).body.me.name, 'Bee');
  } finally { await s.close(); }
});

// ---- NEW KEY ------------------------------------------------------------------------------------

test('NEW KEY: a new key for the same licence; the old one is 401 at once; everything stays', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    await a.set({ username: 'Tom', color: 4 });
    await a.say(room, 'before');
    s.store.putDocs(a.id, { watch: { data: ['AAPL'], updatedAt: T0 } });
    const old = a.key;
    const r = await a.rotate();
    assert.equal(r.status, 200);
    assert.match(r.body.key, /^BB-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    assert.notEqual(r.body.key, old);
    assert.equal(r.body.seat, a.seat);
    assert.ok(!r.text.includes(hashKey(r.body.key)));
    assert.doesNotMatch(r.text, /cus_|sub_|cs_test_|licence_id/);
    // The old key: 401 everywhere.
    for (const u of ['/api/me', '/api/pro/status', '/api/chat']) assert.equal((await s.req('GET', u, { key: old })).status, 401, u);
    a.key = r.body.key;
    const me = await a.me();
    assert.deepEqual([me.body.seat, me.body.username, me.body.color], [a.seat, 'Tom', 4]);
    assert.deepEqual(s.store.getDocs(a.id).watch.data, ['AAPL']);
    const lic = s.store.findById(a.id);
    assert.equal(lic.stripe_subscription_id, 'sub_0000000001', 'billing stays on the same licence');
    assert.equal(lic.last4, r.body.key.slice(-4));
    assert.equal((await a.list()).body.rooms[0].id, room);
  } finally { await s.close(); }
});

test('NEW KEY: any valid key, active or not; 3 a day per licence', async () => {
  const s = await setup();
  try {
    const off = s.person('canceled');
    for (let i = 0; i < 3; i++) {
      const r = await off.rotate();
      assert.equal(r.status, 200, `rotate ${i}`);
      off.key = r.body.key;
    }
    assert.equal((await off.rotate()).status, 429);
    assert.equal((await s.req('POST', '/api/pro/rotate', { key: 'BB-AAAA-BBBB-CCCC-DDDD' })).status, 401);
    s.advance(DAY_MS);
    assert.equal((await off.rotate()).status, 200);
  } finally { await s.close(); }
});

// ---- DOWNLOAD MY DATA ---------------------------------------------------------------------------

test('export: you, your plan, synced data, chats; no secrets, nobody else\'s messages', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    const ab = await s.connect(a, b);
    await s.connect(a, c);
    await a.set({ username: 'Tom', color: 1, avatar: '0000000000000001' });
    await b.set({ username: 'Bee' });
    await a.say(ab, 'mine $AAPL');
    await b.say(ab, 'theirs, private');
    await a.post(`/api/chat/rooms/${ab}`, {});
    s.store.putDocs(a.id, { watch: { data: ['NVDA'], updatedAt: T0 }, prefs: { data: { start: 'DESK', clock: 'local', sound: true }, updatedAt: T0 } });
    const r = await a.exp();
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="bloombroke-my-data\.json"/);
    const d = JSON.parse(r.text);
    assert.equal(d.seat, a.seat);
    assert.deepEqual([d.username, d.colour, d.avatar], ['Tom', 1, '0000000000000001']);
    assert.equal(d.plan.status, 'active');
    assert.equal(d.plan.last4, undefined);
    assert.ok(d.exported_at);
    assert.deepEqual(d.synced.watch.data, ['NVDA']);
    assert.deepEqual(d.synced.prefs.data, { start: 'DESK', clock: 'local', sound: true });
    assert.deepEqual(d.chat.messages.map((m) => m.text), ['mine $AAPL']);
    assert.doesNotMatch(r.text, /theirs, private/);
    assert.deepEqual(d.chat.contacts.map((p) => p.seat).sort(), [b.seat, c.seat].sort());
    assert.ok(d.chat.contacts.every((p) => Object.keys(p).sort().join() === 'seat,username'));
    assert.equal(d.chat.chats.length, 2);
    assert.ok(Array.isArray(d.gift_codes));
    clean(s, r, [a.key, b.key, c.key]);
    // 5 a day.
    for (let i = 0; i < 4; i++) assert.equal((await a.exp()).status, 200);
    assert.equal((await a.exp()).status, 429);
    assert.equal(KEEP_MS, 30 * DAY_MS);
  } finally { await s.close(); }
});

// ---- DELETE MY ACCOUNT ------------------------------------------------------------------------------

test('delete: refused while the subscription will renew; the word must be typed', async () => {
  const s = await setup();
  try {
    const a = s.person();
    const r = await a.del();
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'renewing', message: RENEWING });
    assert.equal(RENEWING, 'Cancel first: press CANCEL. Then delete.');
    assert.equal((await a.del('delete please')).status, 400);
    assert.equal((await a.me()).status, 200, 'still there');
    // Set to cancel at the end of the period: allowed.
    s.store.setBilling(a.id, { cancelAtPeriodEnd: true, currentPeriodEnd: T0 + 10 * DAY_MS });
    assert.equal((await a.del()).status, 200);
    // The rule, one by one.
    const lic = (x) => ({ stripe_subscription_id: 'sub_1', status: 'active', livemode: 1, cancel_at_period_end: 0, cancel_at: null, gift_expires_at: null, ...x });
    assert.equal(willRenew(lic({})), true);
    assert.equal(willRenew(lic({ status: 'past_due' })), true);
    assert.equal(willRenew(lic({ status: 'canceled' })), false);
    assert.equal(willRenew(lic({ cancel_at_period_end: 1 })), false);
    assert.equal(willRenew(lic({ cancel_at: T0 })), false);
    assert.equal(willRenew(lic({ stripe_subscription_id: null, gift_expires_at: T0 })), false, 'gift');
    assert.equal(willRenew(lic({ livemode: 0 }), 'live'), false, 'demo on the live site');
  } finally { await s.close(); }
});

test('delete: the right rows go, the licence record stays, the key is 401', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    const ab = await s.connect(a, b);
    const ac = await s.connect(a, c);
    const group = (await a.open({ seats: [b.seat, c.seat] })).body.room.id;
    await a.set({ username: 'Tom', color: 2, avatar: 'ffffffffffffffff' });
    await a.say(ab, 'from a');
    await b.say(ab, 'from b');
    await a.say(group, 'group from a');
    await c.say(ac, 'from c');
    await a.post(`/api/chat/rooms/${ab}/report`, { reason: 'test' });
    await b.post(`/api/chat/rooms/${ab}/report`, { reason: 'about a' });
    const d = s.person();
    await d.open({ seats: [a.seat] }); // a request to A
    await a.open({ seats: [s.person().seat] }); // a request from A
    await a.post(`/api/chat/rooms/${ac}`, { action: 'block' });
    s.store.putDocs(a.id, { watch: { data: ['AAPL'], updatedAt: T0 }, prefs: { data: { start: 'GRID' }, updatedAt: T0 } });
    s.store.setStatus(a.id, 'canceled');
    const before = s.store.findById(a.id);
    const r = await a.del();
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, message: DELETED });
    const count = (sql, ...args) => s.db.prepare(sql).get(...args).n;
    assert.equal(count('SELECT COUNT(*) AS n FROM chat_profiles WHERE licence_id = ?', a.id), 0, 'profile');
    assert.equal(count('SELECT COUNT(*) AS n FROM sync_docs WHERE licence_id = ?', a.id), 0, 'synced docs and prefs');
    assert.equal(count('SELECT COUNT(*) AS n FROM chat_messages WHERE licence_id = ?', a.id), 0, 'messages A sent');
    assert.equal(count('SELECT COUNT(*) AS n FROM chat_members WHERE licence_id = ?', a.id), 0, 'membership');
    assert.equal(count('SELECT COUNT(*) AS n FROM chat_requests WHERE from_licence = ? OR to_seat = ?', a.id, a.seat), 0, 'requests');
    assert.equal(count('SELECT COUNT(*) AS n FROM chat_blocks WHERE licence_id = ? OR blocked_licence = ?', a.id, a.id), 0, 'blocks');
    assert.equal(count('SELECT COUNT(*) AS n FROM chat_reports WHERE reporter = ?', a.id), 0, 'reports A made');
    assert.equal(count('SELECT COUNT(*) AS n FROM chat_reports WHERE reporter = ?', b.id), 1, 'reports about A stay');
    assert.equal(count("SELECT COUNT(*) AS n FROM chat_rooms WHERE kind = 'dm' AND (dm_key LIKE ? OR dm_key LIKE ?)", `${a.id}:%`, `%:${a.id}`), 0, 'A\'s DMs');
    assert.ok(count('SELECT COUNT(*) AS n FROM chat_members WHERE room_id = ?', group) === 2, 'the group goes on without A');
    // The licence record stays, with a key hash no key can have.
    const after = s.store.findById(a.id);
    assert.equal(after.seat, before.seat);
    assert.equal(after.stripe_customer_id, before.stripe_customer_id);
    assert.equal(after.stripe_subscription_id, before.stripe_subscription_id);
    assert.equal(after.created_at, before.created_at);
    assert.notEqual(after.key_hash, before.key_hash);
    assert.doesNotMatch(after.key_hash, /^[0-9a-f]{64}$/);
    assert.equal(after.last4, '----');
    for (const u of ['/api/me', '/api/pro/status', '/api/chat']) assert.equal((await s.req('GET', u, { key: a.key })).status, 401, u);
    assert.equal((await s.req('POST', '/api/pro/login', { body: { key: a.key } })).status, 401);
    // Tom is locked 30 days, and nobody can take it back.
    assert.equal((await b.set({ username: 'Tom' })).status, 409);
    assert.equal(s.db.prepare('SELECT licence_id FROM name_releases WHERE name_key = ?').get('tom').licence_id, null);
    clean(s, r, [a.key]);
  } finally { await s.close(); }
});

// ---- the migration -----------------------------------------------------------------------------------

test('migration 015: old names that pass and are unique become usernames; the rest are dropped', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-me-'));
  try {
    // Every migration before 015, then some old display names, then 015.
    const before = path.join(dir, 'm');
    mkdirSync(before);
    for (const f of readdirSync('migrations').filter((x) => x < '015')) copyFileSync(path.join('migrations', f), path.join(before, f));
    const db = openDb(':memory:', { migrationsDir: before });
    const names = ['Tom', 'tom', 'Ann Lee', 'Bob', 'x', 'Admin', 'Seat 4', 'bb2', 'Kim_2', '9lives', null, 'Graveyard'];
    names.forEach((name, i) => {
      db.prepare("INSERT INTO licences (key_hash, last4, status, created_at, updated_at, seat) VALUES (?, 'AAAA', 'active', 1, 1, ?)").run(`h${i}`, i + 1);
      db.prepare('INSERT INTO chat_profiles (licence_id, name, updated_at) VALUES (?, ?, 1)').run(i + 1, name);
    });
    migrate(db, 'migrations');
    const kept = db.prepare('SELECT username FROM chat_profiles WHERE username IS NOT NULL ORDER BY licence_id').all().map((r) => r.username);
    assert.deepEqual(kept, ['Bob', 'Kim_2', 'Graveyard'], 'Tom and tom clash; the rest break a rule');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_profiles WHERE name IS NOT NULL').get().n, 0, 'the old column is emptied');
    // Start-up: command words and bad words go too.
    const store = createStore(db, { aesKey: AES });
    const app = express();
    mountChat(app, { db, store, parse: parseCommand, linkChanges, log: quiet, sweepMs: 0 });
    assert.deepEqual(db.prepare('SELECT username FROM chat_profiles WHERE username IS NOT NULL ORDER BY licence_id').all().map((r) => r.username), ['Bob', 'Kim_2']);
    // A name cleared at start-up is locked 30 days for others, like any name given up;
    // its licence (seat 12) may take any valid name at once.
    assert.deepEqual(db.prepare('SELECT name_key, licence_id FROM name_releases').all(), [{ name_key: 'graveyard', licence_id: 12 }]);
    // Unique whatever the case, in the database too.
    assert.throws(() => db.prepare('UPDATE chat_profiles SET username = ? WHERE licence_id = 1').run('BOB'), /UNIQUE/);
    assert.throws(() => db.prepare('UPDATE chat_profiles SET color = 8 WHERE licence_id = 1').run(), /CHECK/);
    assert.throws(() => db.prepare("UPDATE chat_profiles SET avatar = 'nothex' WHERE licence_id = 1").run(), /CHECK/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('copy: no em dash, no emoji, no brand word in the ME server files', () => {
  const brand = new RegExp(['bloom', 'berg'].join(''), 'i');
  for (const f of ['pro/me-routes.js', 'migrations/015_profiles.sql', 'pro/chat.js', 'pro/chat-store.js']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /—/, f);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, f);
    assert.doesNotMatch(src, brand, f);
  }
  // Limits are what the rules say.
  const l = meLimits(() => 0);
  assert.ok(l.export && l.del && l.profile && l.read);
  assert.ok(createLimiter);
});
