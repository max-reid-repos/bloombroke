// CHAT, the server: private chat between Pro seats (pro/chat.js, pro/chat-store.js,
// pro/chat-routes.js, migrations/013_chat.sql). A fresh Express app on a random port, an
// in-memory database, a fake clock and a fake quote function: no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom } from '../pro/licence.js';
import { createLimiter } from '../pro/ratelimit.js';
import { mountChat, chatLimits } from '../pro/chat-routes.js';
import {
  createHub, hasLink, tickersIn, cleanText, cleanName, cleanCard, cleanSeats, checkText, label, NO_LINKS, CARD_DENY, CARD_RE, TICKER_WORD_RE,
  KEEP_MS, REPORT_KEEP_MS, MAX_TEXT,
} from '../pro/chat.js';
import { groupTitle } from '../pro/chat-store.js';
import { parseCommand, linkChanges } from '../public/app.js';

const AES = revealKeyFrom('y'.repeat(40));
const T0 = Date.UTC(2026, 8, 28, 12);
const DAY = 24 * 60 * 60 * 1000;
const quiet = { log() {}, error() {} };

async function setup({ waitMs = 150, quote = async () => null, limits = null, hubOpts = {} } = {}) {
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
  const hub = createHub({ now, waitMs, ...hubOpts });
  const chat = mountChat(app, {
    db, store, mode: 'test', getQuote: quote, parse: parseCommand, linkChanges, now, hub, stampMs: 100, log: quiet,
    guess: createLimiter({ max: 20, windowMs: 15 * 60 * 1000, now }), limits: limits || chatLimits(now),
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, { body, key, origin = true, raw = false } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['X-Pro-Key'] = key;
    if (origin) headers.Origin = base;
    const res = await fetch(base + url, { method, headers, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* none */ }
    return raw ? { status: res.status, body: json, text, headers: res.headers } : { status: res.status, body: json, text, cache: res.headers.get('cache-control') };
  };
  // A person: key, seat, and helpers bound to their key.
  const person = (status = 'active') => {
    const made = mk(status);
    const key = made.key;
    const p = {
      key, seat: made.licence.seat, id: made.licence.id,
      get: (u) => req('GET', u, { key }),
      post: (u, body = {}) => req('POST', u, { key, body }),
      put: (u, body = {}) => req('PUT', u, { key, body }),
      open: (...seats) => req('POST', '/api/chat/open', { key, body: { seats } }),
      say: (room, text, card) => req('POST', `/api/chat/rooms/${room}/messages`, { key, body: card ? { text, card } : { text } }),
      list: () => req('GET', '/api/chat', { key }),
    };
    return p;
  };
  // A and B share a DM: A asks, B accepts. Returns the room id.
  const connect = async (a, b) => {
    const r = await a.open(b.seat);
    if (r.body.room) return r.body.room.id;
    const ok = await b.post(`/api/chat/requests/${a.seat}`, { action: 'accept' });
    return ok.body.room.id;
  };
  return {
    db, store, chat, hub, req, person, connect, base, now, setNow: (v) => { t = v; }, advance: (ms) => { t += ms; },
    close: () => new Promise((r) => server.close(r)),
  };
}

// ---- access ------------------------------------------------------------------------------

test('access: no key, a wrong key and an inactive key are refused; writes need the same origin', async () => {
  const s = await setup();
  try {
    const a = s.person();
    const gone = s.person('canceled');
    assert.equal((await s.req('GET', '/api/chat')).status, 401);
    assert.equal((await s.req('GET', '/api/chat', { key: 'BB-AAAA-BBBB-CCCC-DDDD' })).status, 401);
    const off = await s.req('GET', '/api/chat', { key: gone.key });
    assert.equal(off.status, 402);
    assert.equal(off.body.error, 'not_active');
    assert.equal((await gone.open(a.seat)).status, 402);
    const ok = await a.list();
    assert.equal(ok.status, 200);
    assert.equal(ok.cache, 'no-store');
    assert.deepEqual(ok.body.me, { seat: a.seat, name: null });
    const cross = await s.req('POST', '/api/chat/open', { key: a.key, body: { seats: [99] }, origin: false });
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error, 'cross_origin');
  } finally { await s.close(); }
});

test('access: an outsider can neither read nor post to a room of two others', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    const room = await s.connect(a, b);
    assert.equal((await a.say(room, 'hi')).status, 200);
    const read = await c.get(`/api/chat/rooms/${room}/messages`);
    assert.equal(read.status, 404);
    assert.doesNotMatch(read.text, /hi/);
    assert.equal((await c.say(room, 'let me in')).status, 404);
    assert.equal((await c.post(`/api/chat/rooms/${room}`, { action: 'leave' })).status, 404);
    assert.equal((await c.post(`/api/chat/rooms/${room}/report`, { reason: 'x' })).status, 404);
    assert.equal((await c.get('/api/chat/rooms/abc/messages')).status, 404);
    assert.deepEqual((await c.list()).body.rooms, []);
  } finally { await s.close(); }
});

test('access: no answer ever holds a key, a key hash or a licence id', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    const ab = await s.connect(a, b);
    await s.connect(a, c);
    await a.open(b.seat, c.seat);
    await a.say(ab, 'hello $AAPL');
    const hashes = s.db.prepare('SELECT key_hash FROM licences').all().map((r) => r.key_hash);
    for (const res of [await a.list(), await b.get(`/api/chat/rooms/${ab}/messages`), await a.get('/api/chat/unread')]) {
      for (const k of [a.key, b.key, c.key, ...hashes]) assert.ok(!res.text.includes(k), 'no key or hash');
      assert.doesNotMatch(res.text, /licence|key_hash|last4/);
    }
    const members = (await a.list()).body.rooms.flatMap((r) => r.members);
    for (const m of members) assert.deepEqual(Object.keys(m).sort(), ['name', 'seat']);
  } finally { await s.close(); }
});

// ---- requests ------------------------------------------------------------------------------

test('requests: A asks B, B sees it at the top and accepts, both get the same DM', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const r = await a.open(b.seat);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { sent: true, seat: b.seat, message: `Request sent to SEAT ${b.seat}.` });
    assert.deepEqual((await a.list()).body.requests.out.map((x) => x.seat), [b.seat]);
    const inbox = (await b.list()).body.requests.in;
    assert.deepEqual(inbox.map((x) => [x.seat, x.name]), [[a.seat, null]]);
    assert.equal((await b.get('/api/chat/unread')).body.count, 1, 'a request counts as unread');
    const ok = await b.post(`/api/chat/requests/${a.seat}`, { action: 'accept' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.room.kind, 'dm');
    assert.equal(ok.body.room.title, `SEAT ${a.seat}`);
    const la = (await a.list()).body;
    assert.equal(la.rooms.length, 1);
    assert.equal(la.rooms[0].id, ok.body.room.id);
    assert.equal(la.rooms[0].title, `SEAT ${b.seat}`);
    assert.deepEqual(la.requests.out, []);
    assert.deepEqual((await b.list()).body.requests.in, []);
    // CHAT 42 again: the same room, never a second DM.
    const again = await a.open(b.seat);
    assert.equal(again.body.room.id, ok.body.room.id);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM chat_rooms WHERE kind = 'dm'").get().n, 1);
    // A DM is unique in the database too.
    assert.throws(() => s.db.prepare("INSERT INTO chat_rooms (kind, dm_key, created_at, last_at) VALUES ('dm', ?, 1, 1)").run(s.db.prepare('SELECT dm_key FROM chat_rooms').get().dm_key));
  } finally { await s.close(); }
});

test('requests: two people asking each other are connected at once', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    assert.equal((await a.open(b.seat)).body.sent, true);
    const r = await b.open(a.seat);
    assert.equal(r.body.accepted, true);
    assert.equal(r.body.room.kind, 'dm');
    assert.deepEqual((await a.list()).body.requests, { in: [], out: [] });
    assert.equal((await a.list()).body.rooms[0].id, r.body.room.id);
  } finally { await s.close(); }
});

test('requests: the same neutral answer for a seat that does not exist or has no Pro; your own seat is an error', async () => {
  const s = await setup();
  try {
    const a = s.person();
    const off = s.person('canceled');
    const none = await a.open(987654);
    const inactive = await a.open(off.seat);
    assert.deepEqual(none.body, { sent: true, seat: 987654, message: 'Request sent to SEAT 987654.' });
    assert.deepEqual(inactive.body, { sent: true, seat: off.seat, message: `Request sent to SEAT ${off.seat}.` });
    assert.equal(none.status, inactive.status);
    const out = (await a.list()).body.requests.out.map((x) => x.seat).sort((x, y) => x - y);
    assert.deepEqual(out, [off.seat, 987654].sort((x, y) => x - y), 'both listed the same way');
    const self = await a.open(a.seat);
    assert.equal(self.status, 400);
    assert.equal(self.body.error, 'self');
    assert.equal((await s.req('POST', '/api/chat/open', { key: a.key, body: { seats: ['x'] } })).status, 400);
  } finally { await s.close(); }
});

test('requests: IGNORE hides it quietly; BLOCK hides it and drops the next ones', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    await a.open(b.seat);
    const ig = await b.post(`/api/chat/requests/${a.seat}`, { action: 'ignore' });
    assert.deepEqual(ig.body, { ok: true });
    assert.deepEqual((await b.list()).body.requests.in, []);
    assert.equal((await b.get('/api/chat/unread')).body.count, 0);
    assert.deepEqual((await a.list()).body.requests.out.map((x) => x.seat), [b.seat], 'the sender is not told');
    // BLOCK from the request: hidden, and a new request from C after a block by B is dropped.
    await c.open(b.seat);
    await b.post(`/api/chat/requests/${c.seat}`, { action: 'block' });
    const again = await c.open(b.seat);
    assert.equal(again.body.sent, true, 'the sender sees the usual answer');
    assert.deepEqual((await b.list()).body.requests.in, []);
    assert.equal((await b.post(`/api/chat/requests/${c.seat}`, { action: 'accept' })).status, 404);
    // Asking for the seat you blocked takes the block back.
    const back = await b.open(c.seat);
    assert.ok(back.body.sent || back.body.room);
  } finally { await s.close(); }
});

test('requests: 10 new ones a day, 30 waiting at most', async () => {
  const s = await setup({ limits: { ...chatLimits(() => T0), request: createLimiter({ max: 3, windowMs: DAY, now: () => T0 }) } });
  try {
    const a = s.person();
    for (const seat of [1001, 1002, 1003]) assert.equal((await a.open(seat)).status, 200);
    assert.equal((await a.open(1001)).status, 200, 'the same seat again is not a new request');
    const r = await a.open(1004);
    assert.equal(r.status, 429);
  } finally { await s.close(); }
  const s2 = await setup();
  try {
    const a = s2.person();
    const now = s2.now();
    const ins = s2.db.prepare('INSERT INTO chat_requests (from_licence, to_seat, created_at) VALUES (?, ?, ?)');
    for (let i = 0; i < 30; i++) ins.run(a.id, 5000 + i, now);
    const r = await a.open(9999);
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'too_many_requests');
  } finally { await s2.close(); }
});

// ---- blocks ------------------------------------------------------------------------------

test('block: the DM turns read-only for both; UNBLOCK opens it again', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    const blk = await a.post(`/api/chat/rooms/${room}`, { action: 'block' });
    assert.equal(blk.body.room.readOnly, true);
    assert.equal(blk.body.room.blockedByMe, true);
    assert.equal((await a.say(room, 'x')).status, 409);
    assert.equal((await b.say(room, 'x')).status, 409);
    const bv = (await b.list()).body.rooms[0];
    assert.equal(bv.readOnly, true);
    assert.equal(bv.blockedByMe, false);
    // A new request from the blocked seat never reaches A.
    await b.open(a.seat);
    assert.deepEqual((await a.list()).body.requests.in, []);
    const un = await a.post(`/api/chat/rooms/${room}`, { action: 'unblock' });
    assert.equal(un.body.room.readOnly, false);
    assert.equal((await b.say(room, 'back')).status, 200);
    // LEAVE is for groups.
    assert.equal((await a.post(`/api/chat/rooms/${room}`, { action: 'leave' })).status, 400);
  } finally { await s.close(); }
});

// ---- groups ------------------------------------------------------------------------------

test('groups: only your contacts, up to 8, ADD and LEAVE, read-only under 2', async () => {
  const s = await setup();
  try {
    const people = Array.from({ length: 9 }, () => s.person());
    const [a, b, c, d] = people;
    await s.connect(a, b);
    await s.connect(a, c);
    const no = await a.open(b.seat, c.seat, d.seat);
    assert.equal(no.status, 400);
    assert.equal(no.body.error, 'not_contacts');
    assert.match(no.body.message, new RegExp(`SEAT ${d.seat}`));
    assert.doesNotMatch(no.body.message, new RegExp(`SEAT ${b.seat}\\b`));
    const g = await a.open(b.seat, c.seat);
    assert.equal(g.status, 200);
    assert.equal(g.body.room.kind, 'group');
    assert.equal(g.body.room.members.length, 3);
    assert.equal(g.body.room.title, `SEAT ${b.seat}, SEAT ${c.seat}`);
    const room = g.body.room.id;
    assert.equal((await a.open(c.seat, b.seat)).body.room.id, room, 'the same people: the same group');
    // B adds D: D must be B's contact.
    assert.equal((await b.post(`/api/chat/rooms/${room}`, { action: 'add', seat: d.seat })).status, 400);
    await s.connect(b, d);
    const add = await b.post(`/api/chat/rooms/${room}`, { action: 'add', seat: d.seat });
    assert.equal(add.status, 200);
    assert.equal(add.body.room.members.length, 4);
    assert.equal((await b.post(`/api/chat/rooms/${room}`, { action: 'add', seat: d.seat })).status, 409);
    // Cap: 8 people.
    for (const p of people.slice(4)) await s.connect(a, p);
    for (const p of people.slice(4, 8)) assert.equal((await a.post(`/api/chat/rooms/${room}`, { action: 'add', seat: p.seat })).status, 200);
    const full = await a.post(`/api/chat/rooms/${room}`, { action: 'add', seat: people[8].seat });
    assert.equal(full.status, 409);
    assert.equal(full.body.error, 'too_many');
    assert.equal((await a.open(...people.slice(1).map((p) => p.seat))).status, 400, '9 people is too many');
    // Everyone but A leaves: read-only.
    for (const p of people.slice(1, 8)) assert.equal((await p.post(`/api/chat/rooms/${room}`, { action: 'leave' })).status, 200);
    assert.equal((await b.get(`/api/chat/rooms/${room}/messages`)).status, 404, 'left: no more reading');
    const alone = (await a.list()).body.rooms.find((r) => r.id === room);
    assert.equal(alone.readOnly, true);
    assert.equal((await a.say(room, 'anyone?')).status, 409);
  } finally { await s.close(); }
});

test('groups: someone added later sees only what comes after', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    await s.connect(a, b);
    await s.connect(a, c);
    const g = (await a.open(b.seat)).body.room.id; // a DM
    assert.ok(g);
    const room = (await a.open(b.seat, a.seat)).body.room.id; // own seat is left out: the DM again
    assert.equal(room, g);
    await s.connect(b, c);
    const grp = (await a.open(b.seat, c.seat)).body.room.id;
    await c.post(`/api/chat/rooms/${grp}`, { action: 'leave' });
    await a.say(grp, 'before C is back');
    await a.post(`/api/chat/rooms/${grp}`, { action: 'add', seat: c.seat });
    await b.say(grp, 'after');
    const seen = (await c.get(`/api/chat/rooms/${grp}/messages`)).body.messages.map((m) => m.text);
    assert.deepEqual(seen, ['after']);
  } finally { await s.close(); }
});

// ---- messages ------------------------------------------------------------------------------

test('messages: no links (t.me, bare domains, www, http), but 3.5x, e.g. and $SHOP.TO are fine', async () => {
  for (const bad of ['see https://x.io/a', 'http://evil', 'www.example', 'join t.me/pumpgroup', 'bit.ly/abc', 'go to example.com', 'EXAMPLE.COM', 'discord.gg/x', 'site.xyz', 'a.b.co', 'foo.ai', 'x\u3002com']) {
    assert.equal(hasLink(bad), true, bad);
  }
  for (const ok of ['up 3.5x since June', 'e.g. rates', 'i.e. no', 'U.S. jobs', '$SHOP.TO is up', '$BRK.B', 'cheap.So I bought', 'fell hard.To be fair', 'pe 12.5 vs 13.1', 'v1.2']) {
    assert.equal(hasLink(ok), false, ok);
  }
  assert.throws(() => checkText('look at t.me/x'), { code: 'no_links', message: NO_LINKS });
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    const r = await a.say(room, 'come to t.me/fast');
    assert.equal(r.status, 400);
    assert.equal(r.body.message, 'No links. Attach a screen instead.');
    assert.equal((await a.say(room, 'up 3.5x, e.g. $NVDA')).status, 200);
  } finally { await s.close(); }
});

test('messages: 500 characters, unsafe characters stripped, blank lines collapsed, empty only with a card', async () => {
  assert.equal(cleanText('a\u202eb\u0007c\r\nd'), 'abc\nd');
  assert.equal(cleanText('a\n\n\n\n\n\nb'), 'a\n\n\nb');
  assert.equal(cleanText('  hi  '), 'hi');
  assert.throws(() => checkText(''), { code: 'empty' });
  assert.equal(checkText('', { hasCard: true }), '');
  assert.equal(checkText('x'.repeat(MAX_TEXT)).length, 500);
  assert.throws(() => checkText('x'.repeat(501)), { code: 'too_long' });
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    assert.equal((await a.say(room, 'x'.repeat(501))).status, 400);
    assert.equal((await a.say(room, '   ')).status, 400);
    const r = await a.say(room, 'ok\u202e\u0000 then');
    assert.equal(r.body.message.text, 'ok then');
    const big = await s.req('POST', `/api/chat/rooms/${room}/messages`, { key: a.key, body: { text: 'y'.repeat(3000) } });
    assert.equal(big.status, 413);
    const bad = await s.req('POST', `/api/chat/rooms/${room}/messages`, { key: a.key, body: '{nope' });
    assert.equal(bad.status, 400);
  } finally { await s.close(); }
});

test('messages: each $TICKER gets the price at send time, 3 at most; a failed quote keeps the symbol only', async () => {
  assert.deepEqual(tickersIn('$NVDA and $AAPL and $NVDA and $MSFT and $TSLA'), ['NVDA', 'AAPL', 'MSFT']);
  assert.deepEqual(tickersIn('$5 lunch, $aapl, x$AAPL, $BRK.B.'), ['BRK.B']);
  const asked = [];
  const quote = async (t) => {
    asked.push(t);
    if (t === '$FAIL') throw new Error('down');
    if (t === '$SLOW') return new Promise((r) => setTimeout(() => r({ last: 1 }), 400));
    if (t === '$NONE') return null;
    return { last: { $NVDA: 182.4, $AAPL: 230.1 }[t] };
  };
  const s = await setup({ quote });
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    const r = await a.say(room, '$NVDA ripping, $AAPL flat, $FAIL, $TSLA');
    assert.deepEqual(r.body.message.tickers, [{ sym: 'NVDA', price: 182.4, at: T0 }, { sym: 'AAPL', price: 230.1, at: T0 }, { sym: 'FAIL' }]);
    assert.deepEqual(asked, ['$NVDA', '$AAPL', '$FAIL'], 'three quotes at most, as stocks');
    const slow = await a.say(room, '$SLOW and $NONE');
    assert.deepEqual(slow.body.message.tickers, [{ sym: 'SLOW' }, { sym: 'NONE' }]);
    const got = (await b.get(`/api/chat/rooms/${room}/messages`)).body.messages;
    assert.deepEqual(got[0].tickers[0], { sym: 'NVDA', price: 182.4, at: T0 });
  } finally { await s.close(); }
});

test('cards: a screen of the terminal only; never HOME, CHAT, PRO, LOGIN, a key, or a link that changes something', async () => {
  const deps = { parse: parseCommand, linkChanges };
  assert.deepEqual(cleanCard({ cmd: 'aapl 1y', title: 'AAPL 1Y' }, deps), { cmd: 'AAPL 1Y', title: 'AAPL 1Y' });
  assert.deepEqual(cleanCard({ cmd: 'WEIRD' }, deps), { cmd: 'WEIRD', title: 'WEIRD' });
  assert.deepEqual(cleanCard({ cmd: 'FX 500 USD THB', title: 'x'.repeat(80) }, deps).title.length, 60);
  assert.equal(cleanCard(null, deps), null);
  for (const cmd of ['HOME', 'CHAT', 'CHAT 42', 'PRO', 'LOGIN', 'LOGOUT', 'REDEEM', 'GIFT', 'FEEDBACK', 'IDEA', 'WATCH ADD AAPL', 'PF ADD AAPL 1 @ 100', 'DESK RESET', 'ALERTS AAPL > 300', 'TAPE ADD AAPL',
    'BB-AAAA-BBBB-CCCC-DDDD', 'NOT A COMMAND AT ALL', 'AAPL<script>', 'https://x.co', 'x'.repeat(61), '']) {
    assert.throws(() => cleanCard({ cmd, title: 't' }, deps), { code: 'bad_card' }, cmd);
  }
  assert.deepEqual(CARD_DENY, ['HOME', 'CHAT', 'PRO', 'LOGIN', 'LOGOUT', 'REDEEM', 'GIFT', 'FEEDBACK', 'IDEA']);
  assert.ok(CARD_RE.test('S&P 500 1Y') && CARD_RE.test('SCREEN MCAP>10B') && CARD_RE.test('$GOLD 5Y') && CARD_RE.test('FX EUR/USD'));
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    const r = await a.say(room, '', { cmd: 'AAPL 1Y', title: 'AAPL 1Y' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.message.card, { cmd: 'AAPL 1Y', title: 'AAPL 1Y' });
    assert.equal(r.body.message.text, '');
    assert.equal((await a.say(room, 'x', { cmd: 'WATCH ADD AAPL', title: 'x' })).status, 400);
  } finally { await s.close(); }
});

test('unread: counts messages from others and requests; reading the room clears it', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    const room = await s.connect(a, b);
    await a.say(room, 'one');
    await a.say(room, 'two');
    await c.open(b.seat);
    assert.equal((await a.get('/api/chat/unread')).body.count, 0, 'your own messages are read');
    assert.equal((await b.get('/api/chat/unread')).body.count, 3);
    const lb = (await b.list()).body.rooms[0];
    assert.equal(lb.unread, 2);
    assert.deepEqual(lb.last, { at: T0, preview: 'two', own: false });
    const page = await b.get(`/api/chat/rooms/${room}/messages`);
    assert.deepEqual(page.body.messages.map((m) => [m.text, m.own, m.seat]), [['one', false, a.seat], ['two', false, a.seat]]);
    assert.equal((await b.get('/api/chat/unread')).body.count, 1, 'only the request is left');
    // Older pages and newer ones.
    for (let i = 0; i < 60; i++) { s.advance(2100); await a.say(room, `m${i}`); } // 30 a minute
    const newest = (await b.get(`/api/chat/rooms/${room}/messages`)).body;
    assert.equal(newest.messages.length, 50);
    assert.equal(newest.more, true);
    const older = (await b.get(`/api/chat/rooms/${room}/messages?before=${newest.messages[0].id}`)).body;
    assert.equal(older.messages.length, 12);
    assert.equal(older.more, false);
    await a.say(room, 'fresh');
    const after = (await b.get(`/api/chat/rooms/${room}/messages?after=${newest.messages.at(-1).id}`)).body;
    assert.deepEqual(after.messages.map((m) => m.text), ['fresh']);
  } finally { await s.close(); }
});

test('names: 16 characters, plain letters, always shown with the seat', async () => {
  assert.equal(cleanName('  Tom   Lee '), 'Tom Lee');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName(null), null);
  for (const bad of ['x'.repeat(17), 'Tom<3', 'Seat 1', 'SEAT', '42', 5]) assert.throws(() => cleanName(bad), { code: 'bad_name' }, String(bad));
  assert.equal(cleanName('Tom\u202e'), 'Tom', 'bidi characters are taken out');
  assert.equal(label(42, 'Tom'), 'Tom 42');
  assert.equal(label(42, null), 'SEAT 42');
  assert.equal(groupTitle(['Tom 42', 'Ann 88', 'SEAT 105', 'Bob 7', 'Kim 99', 'Lee 12']), 'Tom 42, Ann 88, SEAT 105, Bob 7, Kim 99 +1');
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    const r = await a.put('/api/chat/me', { name: 'Tom' });
    assert.deepEqual(r.body.me, { seat: a.seat, name: 'Tom' });
    assert.equal((await a.put('/api/chat/me', { name: 'x'.repeat(20) })).status, 400);
    assert.equal((await b.list()).body.rooms[0].title, `Tom ${a.seat}`);
    await a.say(room, 'hi');
    assert.equal((await b.get(`/api/chat/rooms/${room}/messages`)).body.messages[0].name, 'Tom');
    assert.deepEqual((await a.put('/api/chat/me', { name: '' })).body.me, { seat: a.seat, name: null });
  } finally { await s.close(); }
});

test('report: a copy of the last 20 messages, the reported seat and the reason', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    for (let i = 0; i < 25; i++) await b.say(room, `spam ${i}`);
    const r = await a.post(`/api/chat/rooms/${room}/report`, { reason: 'Paid signals\u202e' });
    assert.deepEqual(r.body, { ok: true, message: 'Reported. We will look at it.' });
    assert.equal((await a.post(`/api/chat/rooms/${room}/report`, { reason: 'x'.repeat(201) })).status, 400);
    const row = s.db.prepare('SELECT * FROM chat_reports').get();
    assert.equal(row.reporter_seat, a.seat);
    assert.equal(row.reason, 'Paid signals');
    assert.deepEqual(JSON.parse(row.reported).map((x) => x.seat), [b.seat]);
    const snap = JSON.parse(row.snapshot_json);
    assert.equal(snap.length, 20);
    assert.equal(snap[0].text, 'spam 5');
    assert.equal(snap.at(-1).text, 'spam 24');
    // The owner reads it with scripts/chat-reports.js: newest first, nothing a terminal acts on.
    await b.put('/api/chat/me', { name: 'Spammy' });
    await b.say(room, 'evil \u001b[31mred');
    await a.post(`/api/chat/rooms/${room}/report`, {});
    const { run, formatReports } = await import('../scripts/chat-reports.js');
    const out = run(s.db).text;
    assert.ok(out.indexOf('#2') < out.indexOf('#1'), 'newest first');
    assert.match(out, new RegExp(`#1  2026-09-28 12:00 UTC  by SEAT ${a.seat}  reported SEAT ${b.seat}  room ${room}\n  reason: Paid signals\n`));
    assert.match(out, /reason: --/);
    assert.match(out, /Spammy \d+: evil \[31mred/, 'the escape never got into the message');
    const crafted = formatReports([{ id: 9, created_at: T0, reporter_seat: 1, room_id: 1, reported: '[]', reason: 'x\u001b', snapshot_json: JSON.stringify([{ seat: 3, name: 'N\u202e', text: 'a\u001bb', at: T0 }]) }]);
    assert.match(crafted, /reason: x\\x1b/);
    assert.match(crafted, /N\\u202e 3: a\\x1bb/);
    assert.doesNotMatch(crafted, /[\u001b\u202e]/);
    assert.equal(formatReports([]), 'No chat reports.\n');
  } finally { await s.close(); }
});

// ---- realtime ------------------------------------------------------------------------------

test('wait: answers at once on a new message, and empty after the time is up', async () => {
  const s = await setup({ waitMs: 200 });
  try {
    const [a, b] = [s.person(), s.person()];
    const room = await s.connect(a, b);
    const cursor = (await b.list()).body.cursor;
    const t0 = Date.now();
    const empty = await b.get(`/api/chat/wait?after=${cursor}`);
    assert.deepEqual(empty.body, { events: [], last: cursor });
    assert.ok(Date.now() - t0 >= 150, 'held until the time was up');
    assert.equal(empty.cache, 'no-store');
    const waiting = b.get(`/api/chat/wait?after=${cursor}`);
    await new Promise((r) => setTimeout(r, 30));
    const t1 = Date.now();
    await a.say(room, 'ping');
    const got = await waiting;
    assert.ok(Date.now() - t1 < 150, 'answered at once');
    assert.equal(got.body.events.length, 1);
    assert.equal(got.body.events[0].type, 'message');
    assert.equal(got.body.events[0].room, room);
    assert.ok(got.body.last > cursor);
    // Already newer: at once.
    const now = await b.get(`/api/chat/wait?after=${cursor}`);
    assert.equal(now.body.events.length, 1);
    assert.deepEqual((await b.get(`/api/chat/wait?after=${now.body.last}`)).body.events, []);
  } finally { await s.close(); }
});

test('wait: 3 at a time per licence (the oldest answers empty), a global cap answers 503', async () => {
  const hub = createHub({ waitMs: 1000, perLicence: 3, total: 4 });
  const answers = [];
  const cancels = [1, 2, 3, 4].map((i) => hub.wait(7, 0, (ev) => answers.push([i, ev.length])));
  assert.deepEqual(answers, [[1, 0]], 'the fourth wait ends the first');
  assert.equal(hub.open(), 3);
  hub.wait(8, 0, () => {});
  assert.equal(hub.open(), 4);
  assert.equal(hub.wait(9, 0, () => {}), null, 'full');
  cancels.forEach((c) => c && c());
  hub.emit([8], { type: 'rooms' });
  assert.equal(hub.open(), 0);
  const s = await setup({ hubOpts: { total: 0 } });
  try {
    const a = s.person();
    const r = await a.get('/api/chat/wait?after=0');
    assert.equal(r.status, 503);
  } finally { await s.close(); }
});

test('wait: a closed request drops its listener', async () => {
  const s = await setup({ waitMs: 5000 });
  try {
    const a = s.person();
    const ctl = new AbortController();
    const base = s.base;
    const p = fetch(`${base}/api/chat/wait?after=0`, { headers: { 'X-Pro-Key': a.key }, signal: ctl.signal }).catch(() => 'aborted');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(s.hub.open(), 1);
    ctl.abort();
    assert.equal(await p, 'aborted');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(s.hub.open(), 0, 'the listener is gone');
  } finally { await s.close(); }
});

// ---- purge --------------------------------------------------------------------------------

test('purge: messages and requests after 30 days, reports after 12 months, ended licences after 30 days', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    const room = await s.connect(a, b);
    await a.say(room, 'old');
    await c.open(a.seat);
    await a.post(`/api/chat/rooms/${room}/report`, { reason: 'r' });
    s.advance(KEEP_MS + 1);
    await a.say(room, 'new');
    let n = s.chat.purge(s.now());
    assert.equal(n.messages, 1);
    assert.equal(n.requests, 1);
    assert.equal(n.reports, 0);
    assert.deepEqual((await b.get(`/api/chat/rooms/${room}/messages`)).body.messages.map((m) => m.text), ['new']);
    s.setNow(T0 + REPORT_KEEP_MS + 1);
    n = s.chat.purge(s.now());
    assert.equal(n.reports, 1);
    // B's Pro ends; 30 days later every chat row of B goes, and the DM with A turns read-only.
    s.setNow(T0);
    await b.put('/api/chat/me', { name: 'Bee' });
    s.store.setStatus(b.id, 'canceled');
    s.setNow(T0 + 29 * DAY);
    assert.equal(s.chat.purge(s.now()).ended, 0, 'not yet');
    s.setNow(T0 + 31 * DAY);
    n = s.chat.purge(s.now());
    assert.ok(n.ended >= 2, `ended rows: ${n.ended}`);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM chat_profiles WHERE licence_id = ?').get(b.id).n, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE licence_id = ?').get(b.id).n, 0);
    const left = s.chat.chat.list(a.id);
    assert.equal(left[0].readOnly, true);
    // The licence record purge (5 years) is never blocked by a chat row.
    assert.doesNotThrow(() => s.db.prepare('DELETE FROM licences WHERE id = ?').run(a.id));
  } finally { await s.close(); }
});

test('client and server agree on the rules', async () => {
  const client = await import('../public/screens/chat.js');
  assert.deepEqual(client.CARD_DENY, CARD_DENY);
  assert.equal(client.CARD_RE.source, CARD_RE.source);
  assert.equal(client.TICKER_WORD_RE.source, TICKER_WORD_RE.source);
  assert.equal(client.MAX_TEXT, MAX_TEXT);
  assert.deepEqual(cleanSeats(['00042', 42, 88]), [42, 88]);
  assert.throws(() => cleanSeats([1, 2, 3, 4, 5, 6, 7, 8]), { code: 'too_many' });
  assert.throws(() => cleanSeats([]), { code: 'bad_seats' });
  assert.throws(() => cleanSeats(['4x']), { code: 'bad_seats' });
});
