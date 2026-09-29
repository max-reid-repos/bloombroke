// CHAT GUESS LEAGUE, the server: a GUESS result posted to chat is the server's own replay
// of the guesses (data/guess.js verifyPlay); one per person per room per puzzle; the
// TODAY'S GUESS strip; last week's winner line, once per room, with ties; the purge.
// A fresh Express app, an in-memory database, a fake clock and a test secret: no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom } from '../pro/licence.js';
import { createLimiter } from '../pro/ratelimit.js';
import { mountChat, chatLimits, lastWeek, guessPoints } from '../pro/chat-routes.js';
import { createHub, KEEP_MS } from '../pro/chat.js';
import { verifyPlay, pickAnswer, puzzleNumber, POOL } from '../data/guess.js';
import { parseCommand, linkChanges } from '../public/app.js';

const AES = revealKeyFrom('y'.repeat(40));
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const T0 = Date.UTC(2026, 8, 28, 16); // Monday 28 Sep 2026, noon in New York
const DAY = 24 * 60 * 60 * 1000;
const quiet = { log() {}, error() {} };

// Puzzle n's answer, and n wrong picks before it.
const answerOf = (n) => pickAnswer(n, SECRET).ticker;
const wrong = (n, k) => POOL.map((m) => m.ticker).filter((t) => t !== answerOf(n)).slice(0, k);
const solvedIn = (n, tries) => [...wrong(n, tries - 1), answerOf(n)];
const nyN = (ms) => puzzleNumber(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms)));

async function setup() {
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
  const hub = createHub({ now, waitMs: 150 });
  const chat = mountChat(app, {
    db, store, mode: 'test', parse: parseCommand, linkChanges, now, hub, stampMs: 100, log: quiet, guessSecret: SECRET, sweepMs: 0,
    guess: createLimiter({ max: 20, windowMs: 15 * 60 * 1000, now }), limits: chatLimits(now),
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, { body, key } = {}) => {
    const headers = { Origin: base };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['X-Pro-Key'] = key;
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
      play: (guesses, rooms = 'all', num = nyN(t)) => req('POST', '/api/chat/guess', { key, body: { n: num, guesses, rooms } }),
      thread: async (room) => (await req('GET', `/api/chat/rooms/${room}/messages`, { key })).body,
    };
  };
  const connect = async (a, b) => {
    const r = await a.open(b.seat);
    if (r.body.room) return r.body.room.id;
    return (await b.post(`/api/chat/requests/${a.seat}`, { action: 'accept' })).body.room.id;
  };
  return {
    db, chat, hub, person, connect, now, setNow: (v) => { t = v; }, advance: (ms) => { t += ms; },
    close: () => new Promise((r) => server.close(r)),
  };
}

test('verifyPlay: the score is the replay, never a number from the page; forged games are refused', () => {
  const now = () => new Date(T0);
  const n = nyN(T0);
  assert.deepEqual(verifyPlay(n, solvedIn(n, 4), { secret: SECRET, now }), { n, day: '2026-09-28', tries: 4, solved: true });
  assert.deepEqual(verifyPlay(n, solvedIn(n, 1), { secret: SECRET, now }).tries, 1);
  const lost = verifyPlay(n, wrong(n, 6), { secret: SECRET, now });
  assert.deepEqual([lost.tries, lost.solved], [6, false]);
  const bad = (g, num = n) => assert.throws(() => verifyPlay(num, g, { secret: SECRET, now }), (e) => ['bad_play', 'not_done', 'old_puzzle', 'usage'].includes(e.code), JSON.stringify(g));
  bad(wrong(n, 3)); // not finished
  bad([...wrong(n, 1), answerOf(n), 'AAPL']); // a guess after the answer
  bad([wrong(n, 1)[0], wrong(n, 1)[0], answerOf(n)]); // the same twice
  bad(['ZZZZ', answerOf(n)]); // off the list
  bad([]);
  bad([...wrong(n, 6), answerOf(n)]); // seven tries
  bad('AAPL');
  bad([1, 2]);
  bad(solvedIn(n, 2), n - 1); // yesterday's
  bad(solvedIn(n, 2), n + 1); // tomorrow's
  bad(solvedIn(n, 2), 'x');
  assert.equal(guessPoints(1, true), 6);
  assert.equal(guessPoints(6, true), 1);
  assert.equal(guessPoints(6, false), 0);
});

test('post: a checked result goes to the rooms picked, once per room per day; forged ones are refused', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    const ab = await s.connect(a, b);
    const ac = await s.connect(a, c);
    await a.put('/api/chat/me', { name: 'Ann' });
    const n = nyN(T0);
    // A made-up answer: refused, nothing posted.
    const forged = await a.play(['AAPL'], [ab]);
    if (answerOf(n) !== 'AAPL') assert.equal(forged.status, 400);
    assert.equal((await a.play(wrong(n, 2), [ab])).body.error, 'not_done');
    assert.equal((await a.play(solvedIn(n, 3), [ab], n - 1)).status, 409, 'yesterday is closed');
    const r = await a.play(solvedIn(n, 3), [ab]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { posted: [ab], already: [], result: { n, tries: 3, solved: true, of: 6 } });
    const again = await a.play(solvedIn(n, 1), [ab]);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already');
    // ALL: the other room only.
    const all = await a.play(solvedIn(n, 2), 'all');
    assert.deepEqual([all.body.posted, all.body.already], [[ac], [ab]]);
    // Not your room: nothing.
    const out = s.person();
    assert.equal((await out.play(solvedIn(n, 2), [ab])).status, 404);
    // The message: a GUESS card with the score, kind guess.
    const m = (await b.thread(ab)).messages.find((x) => x.kind === 'guess');
    assert.deepEqual([m.text, m.card, m.guess, m.seat], [`GUESS #${n} 3/6`, { cmd: 'GUESS', title: `GUESS #${n}` }, { n, tries: 3, solved: true }, a.seat]);
    assert.equal((await b.list()).body.rooms.find((x) => x.id === ab).last.preview, `GUESS #${n} 3/6`);
    assert.equal((await a.play([], [ab])).status, 400);
    assert.equal((await a.play(solvedIn(n, 2), [])).status, 400);
  } finally { await s.close(); }
});

test('strip: TODAY\'S GUESS lists the room\'s scores best first; a lost game is X; blocked hidden in a group', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    await s.connect(a, b); await s.connect(a, c); await s.connect(b, c);
    await a.put('/api/chat/me', { name: 'Ann' });
    const g = (await a.open(b.seat, c.seat)).body.room.id;
    const n = nyN(T0);
    assert.equal((await a.thread(g)).guess, undefined, 'nobody posted: no strip');
    await b.play(wrong(n, 6), [g]);
    await a.play(solvedIn(n, 4), [g]);
    await c.play(solvedIn(n, 2), [g]);
    const strip = (await a.thread(g)).guess;
    assert.equal(strip.n, n);
    assert.equal(strip.of, 6);
    assert.deepEqual(strip.scores.map((x) => [x.seat, x.name, x.tries, x.solved]), [[c.seat, null, 2, true], [a.seat, 'Ann', 4, true], [b.seat, null, 6, false]]);
    // C blocks B: B's score is gone from C's strip only.
    const bc = (await c.list()).body.rooms.find((r) => r.kind === 'dm' && r.title === `SEAT ${b.seat}`).id;
    await c.post(`/api/chat/rooms/${bc}`, { action: 'block' });
    assert.deepEqual((await c.thread(g)).guess.scores.map((x) => x.seat), [c.seat, a.seat]);
    assert.equal((await a.thread(g)).guess.scores.length, 3);
    // The next day: a new puzzle, an empty strip.
    s.advance(DAY);
    assert.equal((await a.thread(g)).guess, undefined);
  } finally { await s.close(); }
});

test('weekly: last week\'s winner posts once per room on the first load after the week; ties are shared', async () => {
  assert.deepEqual(lastWeek('2026-10-05'), { week: '2026-09-28', from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(lastWeek('2026-10-11'), { week: '2026-09-28', from: '2026-09-28', to: '2026-10-04' }, 'Sunday is the end of a week');
  assert.deepEqual(lastWeek('2026-10-12').week, '2026-10-05');
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    const ab = await s.connect(a, b);
    const ac = await s.connect(a, c);
    await a.put('/api/chat/me', { name: 'Ann' });
    await b.put('/api/chat/me', { name: 'Tom' });
    // Monday: Ann 2 tries (5 points), Tom 3 tries (4). Tuesday: Ann 2 (5), Tom 1 (6). 10 each.
    let n = nyN(s.now());
    await a.play(solvedIn(n, 2), [ab, ac]);
    await b.play(solvedIn(n, 3), [ab]);
    await c.play(solvedIn(n, 1), [ac]);
    s.advance(DAY);
    n = nyN(s.now());
    await a.play(solvedIn(n, 2), [ab]);
    await b.play(solvedIn(n, 1), [ab]);
    // Still this week: no line.
    const sys = async (p, room) => (await p.thread(room)).messages.filter((m) => m.kind === 'sys').map((m) => m.text);
    assert.deepEqual(await sys(a, ab), []);
    // Next Monday, New York time.
    s.setNow(Date.UTC(2026, 9, 5, 14));
    assert.deepEqual(await sys(b, ab), [`Last week's GUESS: Ann ${a.seat} and Tom ${b.seat} won with 10 points.`]);
    assert.deepEqual(await sys(a, ab), [`Last week's GUESS: Ann ${a.seat} and Tom ${b.seat} won with 10 points.`], 'once per room');
    assert.deepEqual(await sys(c, ac), [`Last week's GUESS: SEAT ${c.seat} won with 6 points.`], 'each room its own');
    // A late load the week after: nothing new for that old week.
    s.advance(DAY * 2);
    assert.equal((await sys(a, ab)).length, 1);
  } finally { await s.close(); }
});

test('purge: results and week marks go after 30 days, with the messages', async () => {
  const s = await setup();
  try {
    const [a, b] = [s.person(), s.person()];
    const ab = await s.connect(a, b);
    await a.play(solvedIn(nyN(s.now()), 2), [ab]);
    s.setNow(Date.UTC(2026, 9, 5, 14));
    await a.thread(ab);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM chat_guess').get().n, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM chat_guess_weeks').get().n, 1);
    s.setNow(Date.UTC(2026, 9, 5, 14) + KEEP_MS + 1);
    const out = s.chat.purge(s.now());
    assert.equal(out.guess, 2);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM chat_guess').get().n, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n, 0);
  } finally { await s.close(); }
});

// ---- the browser side ----------------------------------------------------------------------

const { postChatHtml, roomsPickHtml, postable } = await import('../public/screens/guess.js');
const { messagesHtml, extraHtml, scoreText } = await import('../public/screens/chat.js');
const { readFileSync } = await import('node:fs');
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('POST TO CHAT: only for Pro with a chat that is open; ALL then each chat', () => {
  const rooms = [{ id: 5, title: 'Ann 2', readOnly: false }, { id: 6, title: 'Bo 3', readOnly: true }, { id: 7, title: '<b>x</b>', readOnly: false }];
  assert.equal(postChatHtml(false, rooms), '', 'not Pro');
  assert.equal(postChatHtml(true, []), '', 'no chats');
  assert.equal(postChatHtml(true, [rooms[1]]), '', 'only a closed chat');
  assert.equal(postChatHtml(true, null), '');
  assert.equal(strip(postChatHtml(true, rooms)), 'POST TO CHAT');
  assert.deepEqual(postable(rooms).map((r) => r.id), [5, 7]);
  const pick = roomsPickHtml(rooms);
  assert.deepEqual([...pick.matchAll(/data-room="(\w+)">([^<]*)</g)].map((m) => m[1]), ['all', '5', '7']);
  assert.match(pick, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.equal(roomsPickHtml(Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `R${i}` }))).match(/data-room=/g).length, 9, 'ALL and 8 chats');
  // The screen sends the guesses, never a score.
  const src = readFileSync('public/screens/guess.js', 'utf8');
  assert.match(src, /body: JSON\.stringify\(\{ n: game\.n, guesses: game\.rows\.map\(\(r\) => r\.ticker\), rooms \}\)/);
  assert.doesNotMatch(src, /from '\.\.\/pro\.js'/, 'pro.js by name only: the embed never loads it');
});

test('the thread: a GUESS result is one line with the score; TODAY\'S GUESS strip in order; X for a lost game', () => {
  assert.equal(scoreText({ tries: 4, solved: true }), '4/6');
  assert.equal(scoreText({ tries: 6, solved: false }), 'X/6');
  const html = messagesHtml([{ id: 3, kind: 'guess', seat: 2, name: 'Ann', own: false, text: 'GUESS #2 4/6', card: { cmd: 'GUESS', title: 'GUESS #2' }, guess: { n: 2, tries: 4, solved: true }, at: Date.now() }]);
  assert.match(html, /class="cm cm-guess".*data-card="GUESS"><span class="cm-card-t">GUESS #2<\/span><span class="num">4\/6<\/span><\/button>/);
  const room = { id: 9, readOnly: false };
  const guess = { n: 2, of: 6, scores: [{ seat: 2, name: 'Ann', tries: 2, solved: true }, { seat: 1, name: 'Tom', tries: 6, solved: false }] };
  const x = extraHtml(room, null, guess);
  assert.equal(strip(x), "TODAY'S GUESS Ann 2 2/6 · Tom 1 X/6");
  assert.match(x, /class="ct-line ct-guess" data-card="GUESS"/, 'a click opens GUESS');
  assert.equal(extraHtml(room, null, { n: 2, scores: [] }), '');
});

test('copy rules: DRIVE and GUESS LEAGUE files', () => {
  for (const f of ['public/drive.js', 'migrations/014_chat_drive_guess.sql', 'public/screens/chat.js', 'public/screens/chat.css', 'pro/chat.js', 'pro/chat-store.js', 'pro/chat-routes.js', 'data/guess.js']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(src, /—/, `${f}: em dash`);
    assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${f}: emoji`);
    assert.doesNotMatch(src, /amber|orange|#ffb|#f90/i, `${f}: amber`);
    assert.doesNotMatch(src, /\b(buy now|sell now|strong buy|should buy|buy signal|sell signal|price target|prize|wager|stake)\b/i, `${f}: advice or stakes`);
  }
});

// ---- review fixes ------------------------------------------------------------------------------

test('fix 3: today\'s answer is not one request away; the screen sends the guesses before (p) and keeps the answer', async () => {
  const { makeGuess, lostWith } = await import('../data/guess.js');
  const { checkQuery, readState } = await import('../public/screens/guess.js');
  const game = makeGuess({ getChart: async () => ({ points: [] }), getCaps: async () => ({ stocks: [] }), secret: SECRET, now: () => new Date(T0) });
  const n = nyN(T0);
  assert.throws(() => game.reveal(n), { code: 'today' }, 'reveal refuses today');
  assert.equal(game.reveal(n - 1).ticker, answerOf(n - 1), 'older days still');
  const ans = POOL.find((m) => m.ticker === answerOf(n));
  const w = wrong(n, 6).map((t) => POOL.find((m) => m.ticker === t));
  assert.equal(lostWith(w.slice(0, 5).map((m) => m.ticker).join(','), w[5], ans), true);
  assert.equal(lostWith(w.slice(0, 4).map((m) => m.ticker).join(','), w[5], ans), false, 'not the last try');
  assert.equal(checkQuery({ n: 2, rows: [] }, 'AAPL'), 'n=2&g=AAPL');
  assert.equal(checkQuery({ n: 2, rows: [{ ticker: 'MSFT' }, { ticker: 'BRK.B' }] }, 'AAPL'), 'n=2&g=AAPL&p=MSFT%2CBRK.B');
  const st = readState({ game: { n: 2, rows: [], answer: { ticker: 'UPS', name: 'UPS' } } });
  assert.deepEqual(st.game.answer, { ticker: 'UPS', name: 'UPS' });
  assert.equal(readState({ game: { n: 2, rows: [], answer: { ticker: 1 } } }).game.answer, undefined);
  for (const f of ['public/screens/guess.js', 'public/embed-guess.js']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /\/api\/guess\/check\?\$\{checkQuery\(game, pick\[0\]\)\}/, f);
    assert.match(src, /if \(game\.answer\) \{ answer = game\.answer; return; \}/, f);
  }
});

test('fix 12: TODAY\'S GUESS and the weekly winner count only people still in the room', async () => {
  const s = await setup();
  try {
    const [a, b, c] = [s.person(), s.person(), s.person()];
    await s.connect(a, b); await s.connect(a, c); await s.connect(b, c);
    const g = (await a.open(b.seat, c.seat)).body.room.id;
    const n = nyN(s.now());
    await b.play(solvedIn(n, 1), [g]);
    await a.play(solvedIn(n, 3), [g]);
    await b.post(`/api/chat/rooms/${g}`, { action: 'leave' });
    assert.deepEqual((await a.thread(g)).guess.scores.map((x) => x.seat), [a.seat]);
    s.setNow(Date.UTC(2026, 9, 5, 14));
    const lines = (await c.thread(g)).messages.filter((m) => m.kind === 'sys').map((m) => m.text);
    assert.deepEqual(lines, [`Last week's GUESS: SEAT ${a.seat} won with 4 points.`], 'B left: not the winner');
  } finally { await s.close(); }
});
