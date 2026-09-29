// CHAT DRIVE, the server: one driver per room, opt-in followers, the driver's screens as
// hub events (never stored), card rules, blocks, the rate limit and the auto-stop
// (pro/chat.js createDrives, pro/chat-routes.js). A fresh Express app, an in-memory
// database and a fake clock: no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom } from '../pro/licence.js';
import { createLimiter } from '../pro/ratelimit.js';
import { mountChat, chatLimits } from '../pro/chat-routes.js';
import { createHub, createDrives, DRIVE_IDLE_MS, DRIVE_GONE_MS } from '../pro/chat.js';
import { parseCommand, linkChanges, screenTitle } from '../public/app.js';

const AES = revealKeyFrom('y'.repeat(40));
const T0 = Date.UTC(2026, 8, 28, 12);
const quiet = { log() {}, error() {} };

async function setup({ waitMs = 150 } = {}) {
  const db = openDb(':memory:');
  let t = T0;
  const now = () => t;
  const store = createStore(db, { aesKey: AES, now });
  let n = 0;
  const mk = () => {
    n += 1;
    const id = String(n).padStart(10, '0');
    return store.ensureLicence({ sessionId: `cs_test_${id}`, customerId: `cus_${id}`, subscriptionId: `sub_${id}`, status: 'active' });
  };
  const app = express();
  const hub = createHub({ now, waitMs });
  const chat = mountChat(app, {
    db, store, mode: 'test', parse: parseCommand, linkChanges, titleOf: (c) => screenTitle(c).title, now, hub, stampMs: 100, log: quiet,
    guess: createLimiter({ max: 20, windowMs: 15 * 60 * 1000, now }), limits: chatLimits(now), sweepMs: 0,
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
    return { status: res.status, body: json, text };
  };
  const person = () => {
    const made = mk();
    const key = made.key;
    return {
      key, seat: made.licence.seat, id: made.licence.id,
      get: (u) => req('GET', u, { key }),
      post: (u, body = {}) => req('POST', u, { key, body }),
      put: (u, body = {}) => req('PUT', u, { key, body }),
      open: (...seats) => req('POST', '/api/chat/open', { key, body: { seats } }),
      list: () => req('GET', '/api/chat', { key }),
      drive: (room, action) => req('POST', `/api/chat/rooms/${room}/drive`, { key, body: { action } }),
      cmd: (room, cmd) => req('POST', `/api/chat/rooms/${room}/drive/cmd`, { key, body: { cmd } }),
      msgs: async (room) => (await req('GET', `/api/chat/rooms/${room}/messages`, { key })).body.messages,
    };
  };
  const connect = async (a, b) => {
    const r = await a.open(b.seat);
    if (r.body.room) return r.body.room.id;
    return (await b.post(`/api/chat/requests/${a.seat}`, { action: 'accept' })).body.room.id;
  };
  // Three people who all know each other, and a group of the three.
  const trio = async () => {
    const [a, b, c] = [person(), person(), person()];
    await connect(a, b); await connect(a, c); await connect(b, c);
    await a.put('/api/chat/me', { name: 'Tom' });
    const g = (await a.open(b.seat, c.seat)).body.room.id;
    return { a, b, c, g };
  };
  // Events for a licence after a cursor, at once (a fresh wait answers with what is kept).
  const eventsFor = (p, after) => new Promise((resolve) => { hub.wait(p.id, after, (ev) => resolve(ev)); });
  return {
    db, store, chat, hub, req, person, connect, trio, eventsFor, now, advance: (ms) => { t += ms; },
    close: () => new Promise((r) => server.close(r)),
  };
}

test('drive state: one driver, takeover returns the old one, only the driver sends, followers opt in', () => {
  let t = 0;
  const d = createDrives({ now: () => t });
  assert.equal(d.start(1, 10, { seat: 1, name: 'Tom' }), null);
  assert.equal(d.send(1, 11, 'AAPL'), null, 'not the driver');
  assert.deepEqual(d.send(1, 10, 'AAPL'), { cmd: 'AAPL', seq: 1 });
  assert.equal(d.follow(1, 10), null, 'the driver never follows');
  assert.ok(d.follow(1, 11));
  const prev = d.start(1, 12, { seat: 3, name: null });
  assert.equal(prev.driver, 10);
  assert.deepEqual([...prev.followers], [11]);
  assert.equal(d.get(1).followers.size, 0, 'a new driver starts with nobody following');
  assert.equal(d.send(1, 12, 'NEWS').seq, 2, 'seq keeps going up in the room');
  t += DRIVE_IDLE_MS;
  assert.equal(d.idle(d.get(1)), true);
  assert.ok(d.stop(1));
  assert.equal(d.get(1), null);
});

test('drive: start posts a line; takeover; STOP posts a line; only a member; lines are the only thing stored', async () => {
  const s = await setup();
  try {
    const { a, b, c, g } = await s.trio();
    const out = s.person();
    assert.equal((await out.drive(g, 'start')).status, 404, 'not a member');
    assert.equal((await out.cmd(g, 'AAPL')).status, 404);
    const r = await a.drive(g, 'start');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.drive, { by: { seat: a.seat, name: 'Tom', color: null, avatar: null }, own: true, following: false, followers: 0 });
    assert.ok(r.body.cursor > 0);
    let lines = (await b.msgs(g)).filter((m) => m.kind === 'sys').map((m) => m.text);
    assert.deepEqual(lines, [`Tom #${a.seat} is driving.`]);
    // B sees the offer on the room; A sees own.
    const bRoom = (await b.list()).body.rooms.find((x) => x.id === g);
    assert.deepEqual(bRoom.drive, { by: { seat: a.seat, name: 'Tom', color: null, avatar: null }, own: false, following: false });
    // Pressing DRIVE again changes nothing (no second line).
    await a.drive(g, 'start');
    assert.equal((await b.msgs(g)).filter((m) => m.kind === 'sys').length, 1);
    // B cannot stop A's drive, but takes over with DRIVE.
    assert.equal((await b.drive(g, 'stop')).status, 409);
    await c.drive(g, 'follow');
    const cursorA = (await a.list()).body.cursor;
    const take = await b.drive(g, 'start');
    assert.equal(take.body.drive.own, true);
    const evA = await s.eventsFor(a, cursorA);
    assert.ok(evA.some((e) => e.type === 'drive-end' && e.room === g), 'the old driver hears it ended');
    assert.equal((await a.cmd(g, 'AAPL')).status, 409, 'only the current driver may send');
    assert.equal((await b.list()).body.rooms.find((x) => x.id === g).drive.followers, 0, 'C followed A, not B');
    assert.equal((await b.drive(g, 'stop')).status, 200);
    lines = (await c.msgs(g)).filter((m) => m.kind === 'sys').map((m) => m.text);
    assert.deepEqual(lines, [`Tom #${a.seat} is driving.`, `SEAT ${b.seat} is driving.`, `SEAT ${b.seat} stopped.`]);
    assert.equal((await c.list()).body.rooms.find((x) => x.id === g).drive, undefined);
    // Screens are never messages.
    const rows = s.db.prepare('SELECT body FROM chat_messages').all().map((x) => x.body);
    assert.ok(!rows.some((x) => /AAPL/.test(x)));
    assert.equal((await a.drive(g, 'fly')).status, 400);
  } finally { await s.close(); }
});

test('drive cmd: goes to followers only, with seq; cards rules apply (mutating and secret refused)', async () => {
  const s = await setup();
  try {
    const { a, b, c, g } = await s.trio();
    await a.drive(g, 'start');
    const f = await b.drive(g, 'follow');
    assert.equal(f.status, 200);
    assert.deepEqual(f.body.drive, { by: { seat: a.seat, name: 'Tom', color: null, avatar: null }, cmd: null, seq: 0 });
    const curB = f.body.cursor;
    const curC = (await c.list()).body.cursor;
    const sent = await a.cmd(g, 'aapl 1y');
    assert.equal(sent.status, 200);
    assert.deepEqual([sent.body.cmd, sent.body.seq, sent.body.followers], ['AAPL 1Y', 1, 1]);
    const evB = (await s.eventsFor(b, curB)).filter((e) => e.type === 'drive');
    assert.deepEqual(evB.map((e) => [e.room, e.cmd, e.seq, e.by.seat]), [[g, 'AAPL 1Y', 1, a.seat]]);
    const evC = await Promise.race([s.eventsFor(c, curC), new Promise((r) => setTimeout(() => r('none'), 250))]);
    assert.ok(evC === 'none' || !evC.some((e) => e.type === 'drive'), 'C does not follow: no screens');
    // Refused: changes something, holds a secret, account screens, chat itself, junk.
    for (const bad of ['WATCH ADD AAPL', 'PF BUY 10 AAPL 100', 'LOGIN', 'REDEEM', 'GIFT', 'PRO', 'CHAT', 'CHAT 42', 'FEEDBACK', 'ALERTS AAPL > 300', 'BB-AAAA-BBBB-CCCC-DDDD', 'NOT A COMMAND AT ALL', '<script>', '']) {
      const r = await a.cmd(g, bad);
      assert.equal(r.status, 400, bad);
      assert.equal(r.body.error, 'bad_card', bad);
    }
    // A follower who has it already knows the last screen when they follow.
    const again = await c.drive(g, 'follow');
    assert.equal(again.body.drive.cmd, 'AAPL 1Y');
    assert.equal(again.body.drive.seq, 1);
    // UNFOLLOW: the count goes down.
    await b.drive(g, 'unfollow');
    assert.equal((await a.cmd(g, 'NEWS')).body.followers, 1);
  } finally { await s.close(); }
});

test('drive: blocked people get no screens and see no offer; a closed DM cannot drive', async () => {
  const s = await setup();
  try {
    const { a, b, c, g } = await s.trio();
    await b.drive(g, 'start');
    await a.drive(g, 'follow');
    await c.drive(g, 'follow');
    assert.equal((await b.cmd(g, 'AAPL')).body.followers, 2);
    // C blocks B (in their DM): C is dropped at the next screen and never gets one.
    const bc = (await c.list()).body.rooms.find((r) => r.kind === 'dm' && r.title === `SEAT ${b.seat}`).id;
    await c.post(`/api/chat/rooms/${bc}`, { action: 'block' });
    const cur = (await c.list()).body.cursor;
    assert.equal((await b.cmd(g, 'NEWS')).body.followers, 1);
    const ev = await Promise.race([s.eventsFor(c, cur), new Promise((r) => setTimeout(() => r([]), 250))]);
    assert.ok(!ev.some((e) => e.type === 'drive'));
    assert.equal((await c.list()).body.rooms.find((x) => x.id === g).drive, undefined, 'no offer from someone you blocked');
    const again = await c.drive(g, 'follow');
    assert.equal(again.status, 409);
    // A closed DM: no DRIVE.
    assert.equal((await b.drive(bc, 'start')).status, 409);
  } finally { await s.close(); }
});

test('drive cmd: 60 a minute per licence', async () => {
  const s = await setup();
  try {
    const { a, g } = await s.trio();
    await a.drive(g, 'start');
    for (let i = 0; i < 60; i++) assert.equal((await a.cmd(g, i % 2 ? 'AAPL' : 'NEWS')).status, 200, `cmd ${i}`);
    const r = await a.cmd(g, 'AAPL');
    assert.equal(r.status, 429);
    s.advance(61_000);
    assert.equal((await a.cmd(g, 'AAPL')).status, 200);
  } finally { await s.close(); }
});

test('drive: stops after 10 minutes without a screen, or 60 s after the driver stopped listening; followers who left drop', async () => {
  const s = await setup({ waitMs: 600_000 });
  try {
    const { a, b, c, g } = await s.trio();
    await a.drive(g, 'start');
    await b.drive(g, 'follow');
    await c.drive(g, 'follow');
    // The driver keeps a wait open: alive. B keeps one too; C's page is gone.
    const cancelA = s.hub.wait(a.id, s.hub.cursor(), () => {});
    const cancelB = s.hub.wait(b.id, s.hub.cursor(), () => {});
    s.advance(DRIVE_GONE_MS + 1000);
    s.chat.sweep();
    let d = s.chat.drives.get(g);
    assert.ok(d, 'still driving');
    assert.deepEqual([...d.followers], [b.id], 'C stopped listening: dropped');
    // 10 minutes without a screen: stopped, with a line.
    s.advance(DRIVE_IDLE_MS);
    s.chat.sweep();
    assert.equal(s.chat.drives.get(g), null);
    assert.equal((await c.msgs(g)).filter((m) => m.kind === 'sys').at(-1).text, `Tom #${a.seat} stopped.`);
    cancelA(); cancelB();
    // The driver's page gone for 60 s: stopped.
    await a.drive(g, 'start');
    s.advance(DRIVE_GONE_MS - 1000);
    s.chat.sweep();
    assert.ok(s.chat.drives.get(g), 'under 60 s: still on');
    s.advance(2000);
    s.chat.sweep();
    assert.equal(s.chat.drives.get(g), null);
    // A driver who leaves the group ends it at once.
    await b.drive(g, 'start');
    await b.post(`/api/chat/rooms/${g}`, { action: 'leave' });
    assert.equal(s.chat.drives.get(g), null);
  } finally { await s.close(); }
});

// ---- the browser side (public/drive.js, the app.js hooks, the CHAT screen) -----------------

const { createDrive, driverBarHtml, followBarHtml, pickFollow, pickDrive, nextPause, who, PAUSE_MS } = await import('../public/drive.js');
const { attachFor, headHtml, extraHtml, driveChipHtml, messagesHtml } = await import('../public/screens/chat.js');
const { driveTarget } = await import('../public/app.js');
const { readFileSync } = await import('node:fs');
const { buildAssets } = await import('../lib/assets.js');

const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// A fake server for drive.js: records calls, and answers each wait from a queue (or holds it).
function fakeApi(answers = {}) {
  const calls = [];
  const queue = [];
  let hold = null;
  const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push([opts.method || 'GET', url, body, opts.headers?.['X-Pro-Key']]);
    if (url.startsWith('/api/chat/wait')) {
      if (queue.length) return Promise.resolve(res(queue.shift()));
      return new Promise((resolve, reject) => {
        hold = resolve;
        opts.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      });
    }
    const a = answers[`${body?.action || 'cmd'}`];
    return Promise.resolve(res(a ? a(body) : { ok: true }));
  };
  return {
    calls, fetchImpl,
    push(answer) { if (hold) { const h = hold; hold = null; h(res(answer)); } else queue.push(answer); },
    waits: () => calls.filter((c) => c[1].startsWith('/api/chat/wait')).length,
  };
}
const TOM = { seat: 1, name: 'Tom' };

test('bars: one line each; DRIVING with the count and STOP; FOLLOWING who, the screen, ESC stops, CHAT', () => {
  assert.equal(strip(driverBarHtml(2)), 'DRIVING · 2 following · STOP');
  assert.equal(strip(followBarHtml(TOM, 'AAPL 1Y')), 'FOLLOWING Tom #1 · AAPL 1Y · ESC stops · CHAT');
  assert.match(followBarHtml(TOM, 'AAPL'), /<a class="dv-btn" href="\?c=CHAT" data-cmd="CHAT">CHAT<\/a>/, 'fix 10: CHAT is an own command: it opens CHAT and ends following');
  assert.equal(strip(followBarHtml({ seat: 7, name: null }, '')), 'FOLLOWING SEAT 7 · ESC stops · CHAT');
  assert.match(followBarHtml({ seat: 7, name: '<b>' }, '<i>'), /&lt;b&gt;.*#7.*&lt;i&gt;/);
  assert.equal(who(TOM), 'Tom #1');
  assert.deepEqual(pickFollow([{ type: 'drive', room: 9, cmd: 'A', seq: 2 }, { type: 'drive', room: 9, cmd: 'B', seq: 3 }, { type: 'drive', room: 8, cmd: 'C', seq: 9 }], 9, 1), { next: { cmd: 'B', seq: 3 }, ended: false });
  assert.deepEqual(pickFollow([{ type: 'drive', room: 9, cmd: 'A', seq: 2 }], 9, 2).next, null, 'an old screen is not run again');
  assert.equal(pickFollow([{ type: 'drive-end', room: 9 }], 9).ended, true);
  assert.deepEqual(pickDrive([{ type: 'drive-count', room: 9, followers: 3 }, { type: 'message', room: 9 }], 9), { followers: 3, ended: false });
  assert.equal(nextPause({ events: [], evicted: true }, 0), PAUSE_MS);
  assert.equal(nextPause({ events: [{}] }, 0), 0);
});

test('the CHAT thread: DRIVE in the head (STOP while you drive), the offer line with FOLLOW, server lines', () => {
  const room = { id: 9, kind: 'group', title: 'Ann 2', members: [], readOnly: false };
  assert.match(headHtml(room), /data-act="drive" aria-pressed="false">DRIVE</);
  assert.match(headHtml(room, { role: 'drive', room: 9 }), /data-act="drive-stop" aria-pressed="true">STOP</);
  assert.match(headHtml(room, { role: 'drive', room: 4 }), />DRIVE</, 'driving another room');
  assert.equal(driveChipHtml({ ...room, readOnly: true }), '', 'a closed chat has no DRIVE');
  assert.equal(extraHtml(room), '');
  const driven = { ...room, drive: { by: TOM, own: false, following: false } };
  assert.equal(strip(extraHtml(driven)), 'Tom #1 is driving. FOLLOW');
  assert.equal(strip(extraHtml(driven, { role: 'follow', room: 9 })), 'Following Tom #1. STOP');
  assert.equal(extraHtml({ ...room, drive: { by: TOM, own: true } }), '', 'your own drive: the bar says it');
  const html = messagesHtml([{ id: 1, kind: 'sys', seat: null, text: 'Tom 1 is driving.', at: Date.now() }]);
  assert.match(html, /class="cm cm-sys".*<span class="cm-body">Tom 1 is driving\.<\/span>/);
  assert.doesNotMatch(html, /SEAT/, 'a server line has no sender');
});

test('follow: opt-in; the current screen opens; each screen goes through the router; mutating ones never run; Esc stops and the loop ends', async () => {
  const api = fakeApi({ follow: () => ({ drive: { by: TOM, cmd: 'AAPL 1Y', seq: 3 }, cursor: 5 }) });
  const win = new EventTarget();
  const ran = [];
  win.addEventListener('bb:drive-run', (e) => ran.push(e.detail));
  const dv = createDrive({ win, doc: null, fetchImpl: api.fetchImpl, key: () => 'K', shareable: attachFor });
  assert.equal(dv.state(), null);
  assert.equal(api.waits(), 0, 'no loop before FOLLOW');
  await dv.follow(9);
  assert.deepEqual(ran, ['AAPL 1Y'], 'the driver\'s screen now');
  assert.deepEqual(dv.state(), { role: 'follow', room: 9, by: TOM, cmd: 'AAPL 1Y', followers: 0 });
  await tick();
  assert.equal(api.waits(), 1);
  assert.match(api.calls.find((c) => c[1].startsWith('/api/chat/wait'))[1], /after=5$/);
  api.push({ events: [{ type: 'drive', room: 9, cmd: 'WATCH ADD AAPL', seq: 4 }], last: 6 });
  await tick(5);
  api.push({ events: [{ type: 'drive', room: 9, cmd: 'PF BUY 10 AAPL 100', seq: 5 }, { type: 'drive', room: 9, cmd: 'LOGIN', seq: 6 }], last: 7 });
  await tick(5);
  assert.deepEqual(ran, ['AAPL 1Y'], 'nothing that changes something, and no account screen');
  api.push({ events: [{ type: 'message', room: 9 }, { type: 'drive', room: 9, cmd: 'NEWS', seq: 7 }], last: 8 });
  await tick(5);
  assert.deepEqual(ran, ['AAPL 1Y', 'NEWS']);
  assert.equal(dv.state().cmd, 'NEWS');
  // Esc stops following, tells the server, and the loop ends.
  const esc = new Event('keydown', { cancelable: true });
  esc.key = 'Escape';
  win.dispatchEvent(esc);
  assert.equal(esc.defaultPrevented, true);
  assert.equal(dv.state(), null);
  await tick(5);
  assert.deepEqual(api.calls.at(-1).slice(0, 3), ['POST', '/api/chat/rooms/9/drive', { action: 'unfollow' }]);
  const n = api.waits();
  api.push({ events: [{ type: 'drive', room: 9, cmd: 'AAPL', seq: 9 }], last: 9 });
  await tick(20);
  assert.equal(api.waits(), n, 'no more waits after following ends');
  assert.deepEqual(ran, ['AAPL 1Y', 'NEWS']);
  // Esc when not following: untouched.
  const esc2 = new Event('keydown', { cancelable: true });
  esc2.key = 'Escape';
  win.dispatchEvent(esc2);
  assert.equal(esc2.defaultPrevented, false);
});

test('follow: your own command ends it; the driver ending it ends it; the router opens a driven screen like a link', async () => {
  const api = fakeApi({ follow: () => ({ drive: { by: TOM, cmd: null, seq: 0 }, cursor: 1 }) });
  const win = new EventTarget();
  const dv = createDrive({ win, doc: null, fetchImpl: api.fetchImpl, key: () => 'K', shareable: attachFor });
  await dv.follow(9);
  win.dispatchEvent(new Event('bb:own'));
  assert.equal(dv.state(), null, 'typing a command of your own');
  await dv.follow(9);
  await tick();
  api.push({ events: [{ type: 'drive-end', room: 9 }], last: 2 });
  await tick(5);
  assert.equal(dv.state(), null, 'the driver stopped');
  assert.equal(api.calls.filter((c) => c[2]?.action === 'unfollow').length, 1, 'no UNFOLLOW when the server ended it');
  // app.js runs a received screen through linkPlan: never the change itself.
  assert.equal(driveTarget('AAPL 1Y'), 'AAPL 1Y');
  assert.equal(driveTarget('WATCH ADD AAPL'), 'WATCH');
  assert.equal(driveTarget('ALERTS AAPL > 300'), 'ALERTS');
  assert.equal(driveTarget('BB-AAAA-BBBB-CCCC-DDDD'), 'PRO');
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /addEventListener\('bb:drive-run', \(e\) => run\(driveTarget\(String\(e\.detail \|\| ''\)\), \{ drive: true \}\)\)/);
  assert.match(app, /if \(!drive\) window\.dispatchEvent\(new Event\('bb:own'\)\)/);
  assert.match(app, /window\.dispatchEvent\(new CustomEvent\('bb:screen', \{ detail: raw \}\)\)/);
});

test('driver: screens go 300 ms after the last change, only card-able ones, each once; the count and a takeover come by the loop', async () => {
  const api = fakeApi({ start: () => ({ drive: { by: TOM, own: true, followers: 0 }, cursor: 3 }), cmd: () => ({ ok: true, followers: 1 }) });
  const win = new EventTarget();
  const dv = createDrive({ win, doc: null, fetchImpl: api.fetchImpl, key: () => 'K', shareable: attachFor });
  await dv.start(9);
  const screen = (raw) => win.dispatchEvent(new CustomEvent('bb:screen', { detail: raw }));
  const cmds = () => api.calls.filter((c) => c[1] === '/api/chat/rooms/9/drive/cmd').map((c) => c[2].cmd);
  screen('AAPL');
  screen('AAPL 1Y');
  await tick(350);
  assert.deepEqual(cmds(), ['AAPL 1Y'], 'one send for a quick run of screens');
  assert.equal(dv.state().followers, 1);
  for (const raw of ['CHAT', 'PRO', 'WATCH ADD AAPL', 'LOGIN', 'HOME']) { screen(raw); await tick(320); }
  screen('AAPL 1Y');
  await tick(320);
  assert.deepEqual(cmds(), ['AAPL 1Y'], 'not card-able screens are not sent; the same screen is not sent twice');
  screen('NEWS');
  await tick(320);
  assert.deepEqual(cmds(), ['AAPL 1Y', 'NEWS']);
  await tick();
  api.push({ events: [{ type: 'drive-count', room: 9, followers: 4 }], last: 4 });
  await tick(5);
  assert.equal(dv.state().followers, 4);
  api.push({ events: [{ type: 'drive-end', room: 9 }], last: 5 });
  await tick(5);
  assert.equal(dv.state(), null, 'someone took over');
  screen('AAPL 5Y');
  await tick(320);
  assert.deepEqual(cmds(), ['AAPL 1Y', 'NEWS'], 'nothing after it ended');
  // STOP tells the server.
  await dv.start(9);
  await dv.stop();
  assert.deepEqual(api.calls.at(-1).slice(0, 3), ['POST', '/api/chat/rooms/9/drive', { action: 'stop' }]);
});

test('the page: drive.js loads with CHAT, never at startup; the CHAT loop ignores drive events', () => {
  const a = buildAssets('public');
  assert.ok(!a.closure('app.js').includes('drive.js'));
  assert.ok(a.closure('screens/chat.js').includes('drive.js'));
  const src = readFileSync('public/screens/chat.js', 'utf8');
  assert.match(src, /d\.events\?\.some\(\(e\) => !String\(e\.type\)\.startsWith\('drive'\)\)/);
});

// ---- review fixes ------------------------------------------------------------------------------

const { secretIn: serverSecret, cleanCard } = await import('../pro/chat.js');
const { secretIn: clientSecret, takeConfirmHtml } = await import('../public/screens/chat.js');
const { escFree, stillFollowing } = await import('../public/drive.js');

test('fix 1: a new drive or follow tells the server the old one ended; so does logging out', async () => {
  const api = fakeApi({
    start: () => ({ drive: { by: TOM, own: true, followers: 0 }, cursor: 1 }),
    follow: () => ({ drive: { by: TOM, cmd: null, seq: 0 }, cursor: 1 }),
  });
  const win = new EventTarget();
  let k = 'KEY-A';
  const dv = createDrive({ win, doc: null, fetchImpl: api.fetchImpl, key: () => k, shareable: attachFor });
  const told = () => api.calls.filter((c) => c[2]?.action === 'stop' || c[2]?.action === 'unfollow').map((c) => [c[1], c[2].action, c[3]]);
  await dv.follow(9);
  await dv.start(7);
  await tick(5);
  assert.deepEqual(told(), [['/api/chat/rooms/9/drive', 'unfollow', 'KEY-A']], 'following 9 ended when driving 7 began');
  await dv.follow(9);
  await tick(5);
  assert.deepEqual(told().at(-1), ['/api/chat/rooms/7/drive', 'stop', 'KEY-A'], 'driving 7 ended when following 9 began');
  // DRIVE again in the room you drive (typed DRIVE): your drive goes on, nothing is told.
  await dv.start(7);
  const n = told().length;
  await dv.start(7);
  await tick(5);
  assert.equal(told().length, n, 'the same drive again never stops itself');
  assert.equal(dv.state().role, 'drive');
  assert.match(readFileSync('public/screens/chat.js', 'utf8'), /if \(now\?\.role === 'drive' && now\.room === r\.id\) \{ ctx\.status\('DRIVING: OPEN ANY SCREEN'\); return true; \}/);
  // Logout (the key is gone): the old drive ends, told with the key it began with.
  await dv.start(7);
  k = null;
  win.dispatchEvent(new Event('bb:pro'));
  await tick(5);
  assert.equal(dv.state(), null);
  assert.deepEqual(told().at(-1), ['/api/chat/rooms/7/drive', 'stop', 'KEY-A']);
  // The CHAT screen stops a drive or follow before LEAVE or BLOCK in that room.
  assert.match(readFileSync('public/screens/chat.js', 'utf8'), /if \(\(a === 'leave' \|\| a === 'block'\) && dv\.state\(\)\?\.room === r\.id\) await dv\.stop\(\);/);
});

test('fix 2: no key or gift code in a card or a driven screen, in any case or shape; server and page agree', async () => {
  const KEY = 'BB-7K2M-ABCD-EFGH-JK3M';
  const bad = [
    `HELP ${KEY}`, `help ${KEY.toLowerCase()}`, 'HELP BB7K2MABCDEFGHJK3M', 'GRID AAPL 7K2MABCDEFGHJK3M', 'WHATIF 7K2M-ABCD-EFGH-JK3M',
    'HELP BB 7K2M ABCD EFGH JK3M', 'GRID AAPL 7K2M ABCD EFGH JK3M', 'HELP 7K2M.ABCD.EFGH.JK3M', 'HELP GIFT-7K2M-ABCD-EFGH-JK3M-ABCD-EFGH-JK3M',
    'WHATIF GIFT 7K2M ABCD EFGH JK3M ABCD EFGH JK3M', 'HELP 7K2MABCDEFGHJK3MABCDEFGHJK3M', 'NEWS ABCD-EFGH-JKLM-NPQR',
    'HELP BBABCD EFGH JKLM NPQR', 'HELP GIFT7K2M ABCD EFGH JK3M ABCD EFGH JK3M',
  ];
  const good = ['AAPL 1Y', 'COMPARE AAPL MSFT NVDA TSLA', 'HISTORY AAPL 2020-01-01 2024-12-31', 'FX 500 USD THB', 'WEIRD', 'NEWS'];
  for (const c of bad) {
    assert.equal(serverSecret(c), true, `server: ${c}`);
    assert.equal(clientSecret(c), true, `page: ${c}`);
    assert.equal(attachFor(c), null, `attach: ${c}`);
    assert.throws(() => cleanCard({ cmd: c }, { parse: parseCommand, linkChanges }), { code: 'bad_card' }, c);
  }
  for (const c of good) assert.deepEqual([serverSecret(c), clientSecret(c)], [false, false], c);
  // The route refuses it, and a follower never runs one that got through somehow.
  const s = await setup();
  try {
    const { a, g } = await s.trio();
    await a.drive(g, 'start');
    for (const c of bad.slice(0, 4)) assert.equal((await a.cmd(g, c)).status, 400, c);
  } finally { await s.close(); }
  const api = fakeApi({ follow: () => ({ drive: { by: TOM, cmd: `HELP ${KEY}`, seq: 1 }, cursor: 1 }) });
  const win = new EventTarget();
  const ran = [];
  win.addEventListener('bb:drive-run', (e) => ran.push(e.detail));
  const dv = createDrive({ win, doc: null, fetchImpl: api.fetchImpl, key: () => 'K', shareable: attachFor });
  await dv.follow(9);
  assert.deepEqual(ran, [], 'the follower re-checks');
  dv.end();
});

test('fix 2: a chat card with a key in it is refused', async () => {
  const s = await setup();
  try {
    const { a, g } = await s.trio();
    const r = await s.req('POST', `/api/chat/rooms/${g}/messages`, { key: a.key, body: { text: 'look', card: { cmd: 'HELP BB-7K2M-ABCD-EFGH-JK3M' } } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'bad_card');
  } finally { await s.close(); }
});

test('fix 4: a followed screen keeps your bar, history and hints, and replaces the address', () => {
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /if \(!fromUrl && !drive\) noteTried\(\);/);
  assert.match(app, /if \(drive\) window\.history\.replaceState\(\{ c: kept, d: depth\(\) \}, '', q\);\s+else \{\s+if \(location\.search !== q\) window\.history\.pushState\(\{ c: kept, d: depth\(\) \+ 1 \}, '', q\);\s+remember\(kept\);/);
  assert.match(app, /if \(!drive\) \{\s+histIndex = cmdHistory\.length;\s+input\.value = '';/);
});

test('fix 5: a follower whose drive is gone (a restart, a lost event) stops on the next quiet answer', async () => {
  let rooms = [{ id: 9, drive: { by: TOM, own: false, following: true } }];
  const api = fakeApi({ follow: () => ({ drive: { by: TOM, cmd: null, seq: 0 }, cursor: 1 }), cmd: () => ({ rooms }) });
  const win = new EventTarget();
  const dv = createDrive({ win, doc: null, fetchImpl: api.fetchImpl, key: () => 'K', shareable: attachFor });
  await dv.follow(9);
  await tick();
  api.push({ events: [], last: 1 });
  await tick(10);
  assert.ok(dv.state(), 'still on: the room still has the drive');
  dv.end();
  assert.equal(stillFollowing([{ id: 9, drive: { by: TOM, own: false, following: false } }], 9), false);
  assert.equal(stillFollowing([{ id: 9 }], 9), false);
  assert.equal(stillFollowing([], 9), false);
  rooms = [{ id: 9 }];
  await dv.follow(9);
  await tick();
  api.push({ events: [], last: 2 });
  await tick(10);
  assert.equal(dv.state(), null, 'the drive is gone: following ends');
});

test('fix 7: someone blocked either way with the driver cannot take over', async () => {
  const s = await setup();
  try {
    const { a, b, c, g } = await s.trio();
    await a.drive(g, 'start');
    const ab = (await b.list()).body.rooms.find((r) => r.kind === 'dm' && r.title === `Tom #${a.seat}`).id;
    await b.post(`/api/chat/rooms/${ab}`, { action: 'block' });
    const r = await b.drive(g, 'start');
    assert.deepEqual([r.status, r.body.error], [409, 'taken']);
    assert.equal(s.chat.drives.get(g).driver, a.id);
    assert.equal((await c.drive(g, 'start')).status, 200, 'C may take over');
  } finally { await s.close(); }
});

test('fix 8: TAKE OVER asks first; server lines are never unread and never move a chat to the top', async () => {
  const room = { id: 9, readOnly: false, drive: { by: TOM, own: false } };
  assert.match(driveChipHtml(room), /data-act="take">TAKE OVER</);
  assert.match(driveChipHtml(room, { role: 'drive', room: 9 }), />STOP</);
  assert.equal(strip(takeConfirmHtml(TOM)), 'Take over from Tom #1? ENTER: TAKE OVER ESC: CANCEL');
  const src = readFileSync('public/screens/chat.js', 'utf8');
  assert.match(src, /\(e\.key === 'Enter' \|\| e\.key === 'Escape'\) && \$\('\.ct-confirm'\)/);
  const s = await setup();
  try {
    const { a, b, c, g } = await s.trio();
    const ab = (await a.list()).body.rooms.find((r) => r.kind === 'dm' && r.title === `SEAT ${b.seat}`).id;
    await s.req('POST', `/api/chat/rooms/${ab}/messages`, { key: a.key, body: { text: 'newer' } });
    await b.get(`/api/chat/rooms/${g}/messages`);
    const before = (await b.list()).body.rooms.map((r) => r.id);
    await a.drive(g, 'start');
    await a.drive(g, 'stop');
    const after = (await b.list()).body;
    assert.deepEqual(after.rooms.map((r) => r.id), before, 'the group did not move up');
    assert.equal(after.rooms.find((r) => r.id === g).unread, 0);
    assert.equal((await c.get('/api/chat/unread')).body.count, 0, 'nothing unread for C');
  } finally { await s.close(); }
});

test('fix 9: Esc stops following only when nothing else wants it', () => {
  const doc = (value, sel = []) => ({ getElementById: () => ({ value }), querySelector: (q) => (sel.some((x) => q.includes(x)) ? {} : null) });
  assert.equal(escFree(doc('')), true);
  assert.equal(escFree(doc('AAP')), false, 'text in the command bar');
  assert.equal(escFree(doc('', ['#suggest:not([hidden])'])), false, 'suggestions open');
  assert.equal(escFree(doc('', ['.menu-overlay:not([hidden])'])), false, 'the menu');
  assert.equal(escFree(doc('', ['body.has-max-panel'])), false, 'a maximised panel');
  assert.equal(escFree(doc('', ['.ct-confirm'])), false, 'TAKE OVER asking');
});
