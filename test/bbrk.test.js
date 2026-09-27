// BBRK (our own site numbers) and the DataFast goals: the daily_counts migration, the
// counters, POST /api/count, GET /api/bbrk, the server routes that count, the screen,
// and public/goal.js with and without DataFast and with Global Privacy Control.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { openDb, migrate } from '../pro/db.js';
import { createLimiter } from '../pro/ratelimit.js';
import { createFeedbackStore, mountFeedback } from '../pro/feedback.js';
import {
  createCounters, mountCounters, nyDay, dayBefore, mrrLine, COUNTS, CLIENT_COUNTS, SERVER_COUNTS, COUNT_LIMIT,
} from '../lib/counters.js';
import { POOL, pickAnswer, mountGuess } from '../data/guess.js';
import { bbrkHtml, heroChange, counterOf, seatsLabel, ROWS, STRIP, SOURCE } from '../public/screens/bbrk.js';
import { goal, loadDataFast, cleanProps, gpcOn, GOALS, CLIENT_COUNTED } from '../public/goal.js';
import { parseCommand } from '../public/app.js';
import { findCommand } from '../public/registry.js';

const T0 = Date.parse('2026-09-27T16:00:00Z'); // 12:00 in New York
const DAY = 86_400_000;

// ---- migration -------------------------------------------------------------------------
test('migration 011: additive, idempotent, only a day, a name and a count', () => {
  const db = openDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(daily_counts)').all().map((c) => c.name);
  assert.deepEqual(cols, ['day', 'name', 'n']);
  for (const t of ['licences', 'feedback', 'gift_codes', 'seat_high']) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t), `${t} kept`);
  db.prepare("INSERT INTO daily_counts (day, name, n) VALUES ('2026-09-27', 'whatif_run', 3)").run();
  migrate(db); // a second run changes nothing
  db.exec(readFileSync('migrations/011_daily_counts.sql', 'utf8')); // even run by hand again
  assert.equal(db.prepare('SELECT n FROM daily_counts').get().n, 3, 'rows survive');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE name='011_daily_counts.sql'").get().c, 1);
  const sql = readFileSync('migrations/011_daily_counts.sql', 'utf8');
  assert.doesNotMatch(sql, /\b(DROP|DELETE|ALTER|UPDATE)\b/i, 'additive only');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bip\b|email|licence|visitor/i, 'no personal data columns');
});

// ---- counters ------------------------------------------------------------------------
test('counters: New York days, and the day before', () => {
  assert.equal(nyDay(Date.parse('2026-09-27T03:59:00Z')), '2026-09-26');
  assert.equal(nyDay(Date.parse('2026-09-27T04:01:00Z')), '2026-09-27');
  assert.equal(dayBefore('2026-03-01', 1), '2026-02-28');
  assert.equal(dayBefore('2026-09-27', 6), '2026-09-21');
});

test('counters: one bump is one count; today, yesterday, 7 days, all time', () => {
  let t = T0;
  const db = openDb(':memory:');
  const c = createCounters({ now: () => t }).attach(db);
  assert.equal(c.bump('whatif_run'), true);
  assert.equal(c.stats().counts.whatif_run.today, 1, 'exactly one');
  t = T0 - DAY; c.bump('whatif_run'); c.bump('whatif_run');
  t = T0 - 10 * DAY; c.bump('whatif_run');
  t = T0;
  const s = c.stats();
  assert.deepEqual(s.counts.whatif_run, { today: 1, yesterday: 2, d7: 3, all: 4 });
  assert.deepEqual(s.counts.guess_played, { today: 0, yesterday: 0, d7: 0, all: 0 });
  assert.equal(c.bump('not_a_counter'), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM daily_counts WHERE name='not_a_counter'").get().c, 0);
});

test('counters: MCP shows -- until the MCP server enables it', () => {
  const c = createCounters({ now: () => T0 }).attach(openDb(':memory:'));
  assert.equal(c.bump('mcp_call'), false);
  assert.equal(c.stats().counts.mcp_call, null);
  c.enable('mcp_call');
  c.bump('mcp_call');
  assert.equal(c.stats().counts.mcp_call.today, 1);
});

test('counters: no database means every counter is null and nothing throws', () => {
  const c = createCounters();
  assert.equal(c.bump('whatif_run'), false);
  const s = c.stats({ mode: 'test' });
  for (const n of COUNTS) assert.equal(s.counts[n], null, n);
  assert.equal(s.seats, null);
});

test('counters: Pro seats count the licences of the current Stripe mode only', () => {
  const db = openDb(':memory:');
  const add = db.prepare("INSERT INTO licences (key_hash, last4, status, created_at, updated_at, livemode) VALUES (?, 'ABCD', 'active', ?, ?, ?)");
  add.run('h1', T0, T0, 0);
  add.run('h2', T0 - DAY, T0 - DAY, 0);
  add.run('h3', T0, T0, 1);
  const c = createCounters({ now: () => T0 }).attach(db);
  assert.deepEqual(c.stats({ mode: 'test' }).seats, { today: 1, yesterday: 1, d7: 2, all: 2 });
  assert.deepEqual(c.stats({ mode: 'live' }).seats, { today: 1, yesterday: 0, d7: 1, all: 1 });
  assert.equal(c.stats().seats, null, 'no mode, no seats');
});

test('counters: MRR comes from the config, never a guess', () => {
  assert.equal(mrrLine('test'), 'MRR $0 (test mode)');
  assert.equal(mrrLine('live'), null);
  assert.equal(mrrLine(null), null);
});

// ---- the routes -------------------------------------------------------------------------
async function serve({ max = COUNT_LIMIT.max, mode = 'test' } = {}) {
  const db = openDb(':memory:');
  const counters = createCounters({ now: () => T0 }).attach(db);
  const app = express();
  mountCounters(app, { counters, mode, now: () => T0, limiter: createLimiter({ max, windowMs: 60_000, now: () => T0, sweepEvery: 0 }) });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body, { origin = base, site } = {}) => {
    const h = { 'Content-Type': 'application/json' };
    if (origin) h.Origin = origin;
    if (site) h['Sec-Fetch-Site'] = site;
    const res = await fetch(`${base}/api/count`, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return res.status;
  };
  const stats = async () => (await fetch(`${base}/api/bbrk`)).json();
  return { db, counters, post, stats, base, close: () => new Promise((r) => server.close(r)) };
}

test('POST /api/count: allow-listed client names only, one count each', async () => {
  const s = await serve();
  try {
    for (const n of CLIENT_COUNTS) assert.equal(await s.post({ name: n }), 204, n);
    for (const n of CLIENT_COUNTS) assert.equal(s.counters.stats().counts[n].today, 1, `${n} counted once`);
    // Server-counted names cannot be pushed from a browser.
    for (const n of SERVER_COUNTS) assert.equal(await s.post({ name: n }), 400, n);
    assert.equal(s.counters.stats().counts.whatif_run.today, 0);
    for (const b of [{ name: 'drop table' }, {}, { name: 5 }, [], 'nope']) assert.equal(await s.post(b), 400, JSON.stringify(b));
    assert.equal(await s.post({ name: 'x'.repeat(2000) }), 400, 'too big');
  } finally { await s.close(); }
});

test('POST /api/count: same origin only', async () => {
  const s = await serve();
  try {
    assert.equal(await s.post({ name: 'whatif_share' }, { origin: null }), 403, 'no Origin');
    assert.equal(await s.post({ name: 'whatif_share' }, { origin: 'https://evil.example' }), 403, 'another site');
    assert.equal(await s.post({ name: 'whatif_share' }, { site: 'cross-site' }), 403, 'Sec-Fetch-Site cross-site');
    assert.equal(s.counters.stats().counts.whatif_share.today, 0);
  } finally { await s.close(); }
});

test('POST /api/count: rate limited per IP, and no IP is stored', async () => {
  const s = await serve({ max: 3 });
  try {
    for (let i = 0; i < 3; i += 1) assert.equal(await s.post({ name: 'guess_shared' }), 204);
    assert.equal(await s.post({ name: 'guess_shared' }), 429);
    assert.equal(s.counters.stats().counts.guess_shared.today, 3);
    const dump = JSON.stringify(s.db.prepare('SELECT * FROM daily_counts').all());
    assert.doesNotMatch(dump, /127\.0\.0\.1|::1/);
  } finally { await s.close(); }
});

test('GET /api/bbrk: every counter, seats, MRR; -- data where missing', async () => {
  const s = await serve();
  try {
    await s.post({ name: 'whatif_video' });
    const d = await s.stats();
    assert.equal(d.mode, 'test');
    assert.equal(d.mrr, 'MRR $0 (test mode)');
    assert.deepEqual(Object.keys(d.counts).sort(), [...COUNTS].sort());
    assert.equal(d.counts.whatif_video.today, 1);
    assert.equal(d.counts.mcp_call, null);
    assert.deepEqual(d.seats, { today: 0, yesterday: 0, d7: 0, all: 0 });
  } finally { await s.close(); }
});

test('GUESS routes: a solved check and a reveal each count one game played; a miss does not', async () => {
  const db = openDb(':memory:');
  const counters = createCounters({ now: () => T0 }).attach(db);
  const app = express();
  const now = () => new Date('2026-09-28T15:00:00Z'); // puzzle #2
  const getChart = async (ticker) => {
    const start = Date.parse('2025-09-26T04:00:00Z');
    const end = ticker.charCodeAt(0) + 50;
    const points = [];
    for (let i = 0; i <= 367; i += 1) points.push({ t: start + i * DAY, v: 100 + (end - 100) * (i / 367) });
    return { points };
  };
  const getCaps = async () => ({ stocks: POOL.map((m, i) => ({ ticker: m.ticker, marketCap: (i + 1) * 1e10 })) });
  mountGuess(app, { getChart, getCaps, secret: 'test-secret-0123456789abcdef0123456789abcdef', now, count: (n) => counters.bump(n) });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const answer = pickAnswer(2, 'test-secret-0123456789abcdef0123456789abcdef');
    const wrong = POOL.find((m) => m.ticker !== answer.ticker);
    assert.equal((await fetch(`${base}/api/guess/check?n=2&g=${wrong.ticker}`)).status, 200);
    assert.equal(counters.stats().counts.guess_played.today, 0, 'a miss is not a game played');
    assert.equal((await (await fetch(`${base}/api/guess/check?n=2&g=${answer.ticker}`)).json()).solved, true);
    assert.equal(counters.stats().counts.guess_played.today, 1);
    assert.equal((await fetch(`${base}/api/guess/reveal?n=2`)).status, 200);
    assert.equal(counters.stats().counts.guess_played.today, 2);
    assert.equal((await fetch(`${base}/api/guess/reveal?n=99`)).status, 400);
    assert.equal(counters.stats().counts.guess_played.today, 2, 'an error counts nothing');
  } finally { await new Promise((r) => server.close(r)); }
});

test('FEEDBACK route: a saved note counts once; a refused or honeypot note does not', async () => {
  const db = openDb(':memory:');
  const counters = createCounters({ now: () => T0 }).attach(db);
  const app = express();
  mountFeedback(app, { store: createFeedbackStore(db), onSaved: () => counters.bump('feedback_sent'), log: { error() {} } });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ message: 'hello' })).status, 200);
    assert.equal(counters.stats().counts.feedback_sent.today, 1);
    assert.equal((await post({ message: '' })).status, 400);
    assert.equal((await post({ message: 'bot', website: 'spam.example' })).status, 200);
    assert.equal(counters.stats().counts.feedback_sent.today, 1);
  } finally { await new Promise((r) => server.close(r)); }
});

test('server wiring: WHATIF counts a computed result; counters sit on the Pro database', () => {
  const src = readFileSync('server.js', 'utf8');
  const route = src.slice(src.indexOf("app.get('/api/whatif',"), src.indexOf("app.get('/api/funding'"));
  assert.match(route, /if \(data\.rows\) siteCounters\.bump\('whatif_run'\)/);
  assert.equal((route.match(/siteCounters\.bump/g) || []).length, 1, 'one count per result');
  assert.match(src, /startPro\(app, \{ dir, counters: siteCounters \}\)/);
  assert.match(src, /mountCounters\(app,/);
  assert.match(src, /count: \(n\) => siteCounters\.bump\(n\)/);
  const pro = readFileSync('pro/index.js', 'utf8');
  assert.match(pro, /counters\?\.attach\(db\)/);
  assert.match(pro, /onSaved: \(\) => counters\?\.bump\('feedback_sent'\)/);
});

// ---- the screen -------------------------------------------------------------------------
test('BBRK screen: a quote-like hero, the counters table, -- for anything missing', () => {
  const empty = bbrkHtml(null);
  assert.match(empty, /q-hero/);
  assert.match(empty, new RegExp(SOURCE));
  for (const [, label] of ROWS.filter(([n]) => n !== 'seats')) assert.ok(empty.includes(label), label);
  assert.equal((empty.match(/<td class="num">--<\/td>/g) || []).length, ROWS.length * 3, 'every cell is --');
  assert.doesNotMatch(empty, /NaN|undefined|null/);

  const d = {
    mode: 'test', mrr: 'MRR $0 (test mode)',
    counts: { whatif_run: { today: 12, yesterday: 8, d7: 40, all: 1234 }, mcp_call: null, guess_played: { today: 3, yesterday: 0, d7: 3, all: 3 } },
    seats: { today: 0, yesterday: 0, d7: 1, all: 2 },
  };
  const html = bbrkHtml(d);
  assert.match(html, /<span class="q-last">12<\/span>/);
  assert.match(html, /q-chg num up">\+4 \+50\.00%/);
  assert.match(html, /1,234/);
  assert.match(html, /<th scope="row">MCP tool calls<\/th><td class="num">--<\/td>/);
  assert.match(html, /Pro seats issued \(test mode\)/);
  assert.match(html, /\$0 \(test mode\)/);
  assert.equal(seatsLabel({ mode: 'live' }), 'Pro seats issued');
  assert.deepEqual(heroChange({ today: 0, yesterday: 5 }), { text: '−5 −100.00%', dir: 'down' });
  assert.deepEqual(heroChange({ today: 2, yesterday: 0 }), { text: '+2', dir: 'up' });
  assert.deepEqual(heroChange(null), { text: '--', dir: 'flat' });
  assert.equal(counterOf(d, 'seats').all, 2);
  assert.equal(STRIP, 'OUR OWN SITE NUMBERS. NOT A SECURITY. NOT FOR SALE.');
});

test('BBRK wiring: a command, listed, not a ticker; HOME keeps no BBRK row', () => {
  const p = parseCommand('bbrk');
  assert.equal(p.name, 'BBRK');
  assert.equal(p.input, 'BBRK');
  assert.equal(findCommand('BBRK').category, 'Markets');
  // HOME at 1536x730: a row under the markets grid pushed it past its share of the
  // screen (VIX cut off, the grid scrolled), so BBRK is a command only.
  assert.doesNotMatch(readFileSync('public/screens/home.js', 'utf8'), /bbrk/i);
});

test('BBRK and goals copy: no banned brand word, no em dash, no emoji, no amber, no advice words', () => {
  for (const f of ['public/screens/bbrk.js', 'public/goal.js', 'lib/counters.js', 'migrations/011_daily_counts.sql']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, `${f}: emoji`);
    assert.doesNotMatch(s, /amber|orange|#f5a|#ffa|#ff9/i, `${f}: amber`);
    assert.doesNotMatch(s, /\b(you should|we recommend|buy now|invest in)\b/i, `${f}: advice`);
  }
  const css = readFileSync('public/commands.css', 'utf8');
  assert.doesNotMatch(css.slice(css.indexOf('BBRK')), /amber|orange/i);
});

// ---- goal() -----------------------------------------------------------------------------
function fakeFetch() {
  const calls = [];
  const f = (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true }); };
  f.calls = calls;
  return f;
}

test('goal(): the twelve goals, each once in the code', () => {
  assert.deepEqual(GOALS.slice().sort(), ['desk_opened', 'feedback_sent', 'guess_played', 'guess_shared', 'mcp_screen_opened', 'news_why_opened', 'pro_checkout_started', 'weird_gauge_opened', 'whatif_embed', 'whatif_run', 'whatif_share', 'whatif_video']);
  assert.deepEqual(CLIENT_COUNTED, CLIENT_COUNTS, 'the browser posts exactly the names the server allows');
  const wired = {
    'public/screens/whatif.js': ['whatif_run', 'whatif_video', 'whatif_share'],
    'public/screens/guess.js': ['guess_played', 'guess_shared'],
    'public/screens/why.js': ['news_why_opened'],
    'public/screens/weird.js': ['weird_gauge_opened'],
    'public/screens/feedback.js': ['feedback_sent'],
    'public/pro.js': ['pro_checkout_started'],
    'public/screens/desk.js': ['desk_opened'],
  };
  for (const [f, names] of Object.entries(wired)) {
    const s = readFileSync(f, 'utf8');
    for (const n of names) assert.match(s, new RegExp(`goal\\('${n}'`), `${f}: ${n}`);
  }
});

test('goal(): without DataFast it does nothing there and never throws', () => {
  const f = fakeFetch();
  assert.deepEqual(goal('whatif_run', undefined, { win: {}, nav: {}, fetchImpl: f }), { datafast: false, counted: false });
  assert.equal(f.calls.length, 0, 'whatif_run is counted by the server route, not posted');
  assert.doesNotThrow(() => goal('whatif_share', { via: 'x' }, { win: undefined, nav: undefined, fetchImpl: undefined }));
  assert.doesNotThrow(() => goal('whatif_share', {}, { win: { datafast() { throw new Error('blocked'); } }, nav: {}, fetchImpl: () => { throw new Error('offline'); } }));
  assert.deepEqual(goal('nope', {}, { win: { datafast() {} }, nav: {}, fetchImpl: f }), { datafast: false, counted: false });
});

test('goal(): DataFast gets the name and short enum props only; client actions post one count', () => {
  const seen = [];
  const win = { datafast: (...a) => seen.push(a) };
  const f = fakeFetch();
  goal('whatif_share', { via: 'X', email: 'a@b.co', long: 'x' }, { win, nav: {}, fetchImpl: f });
  goal('weird_gauge_opened', { gauge: 'CANAL' }, { win, nav: {}, fetchImpl: f });
  goal('desk_opened', undefined, { win, nav: {}, fetchImpl: f });
  goal('whatif_share', { via: 'https://evil.example/?email=a@b.co' }, { win, nav: {}, fetchImpl: f });
  assert.deepEqual(seen, [['whatif_share', { via: 'x' }], ['weird_gauge_opened', { gauge: 'canal' }], ['desk_opened'], ['whatif_share']]);
  assert.equal(f.calls.length, 2, 'two shares posted, the others not');
  assert.equal(f.calls[0].url, '/api/count');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { name: 'whatif_share' }, 'only the name');
  assert.deepEqual(cleanProps('guess_played', { result: 'solved', extra: 'y' }), { result: 'solved' });
  assert.deepEqual(cleanProps('desk_opened', { anything: 'x' }), {});
});

test('goal(): Global Privacy Control skips DataFast, our own totals still count', () => {
  const seen = [];
  const win = { datafast: (...a) => seen.push(a) };
  const f = fakeFetch();
  const nav = { globalPrivacyControl: true };
  assert.equal(gpcOn(nav), true);
  assert.deepEqual(goal('guess_shared', { via: 'copy' }, { win, nav, fetchImpl: f }), { datafast: false, counted: true });
  assert.deepEqual(goal('desk_opened', undefined, { win, nav, fetchImpl: f }), { datafast: false, counted: false });
  assert.equal(seen.length, 0);
  assert.equal(f.calls.length, 1);
});

// A tiny DOM: enough for loadDataFast.
function fakeDoc({ embed = false, present = false } = {}) {
  const head = { kids: [], appendChild(n) { this.kids.push(n); } };
  return {
    head,
    documentElement: { classList: { contains: (c) => embed && c === 'is-embed' } },
    querySelector: (sel) => (present && sel.includes('datafa.st') ? {} : null),
    createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
}

test('loadDataFast: adds the script once, with its site id; never with GPC or inside a DESK panel', () => {
  const win = {};
  const doc = fakeDoc();
  assert.equal(loadDataFast({ doc, nav: {}, win }), true);
  const s = doc.head.kids[0];
  assert.equal(s.src, 'https://datafa.st/js/script.js');
  assert.equal(s.attrs['data-domain'], 'bloombroke.com');
  assert.equal(s.attrs['data-website-id'], 'dfid_RaIYVk8TuhGSz6fl2wpPa');
  // Calls before the script arrives wait in the queue the script replays.
  assert.equal(typeof win.datafast, 'function');
  goal('desk_opened', undefined, { win, nav: {}, fetchImpl: fakeFetch() });
  assert.deepEqual(win.datafast.q, [['desk_opened']]);
  for (let i = 0; i < 100; i += 1) win.datafast('desk_opened');
  assert.ok(win.datafast.q.length <= 50, 'the queue is bounded when the script is blocked');

  const gpcDoc = fakeDoc();
  const gpcWin = {};
  assert.equal(loadDataFast({ doc: gpcDoc, nav: { globalPrivacyControl: true }, win: gpcWin }), false);
  assert.equal(gpcDoc.head.kids.length, 0);
  assert.equal(gpcWin.datafast, undefined);
  assert.equal(loadDataFast({ doc: fakeDoc({ embed: true }), nav: {}, win: {} }), false, 'a DESK panel is not a visit');
  assert.equal(loadDataFast({ doc: fakeDoc({ present: true }), nav: {}, win: {} }), false, 'never twice');
  assert.equal(loadDataFast({ doc: undefined, nav: {}, win: undefined }), false);
});

test('DataFast loads only through goal.js: no fixed script tag in the page or the legal pages', () => {
  const index = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(index, /datafa\.st/);
  assert.match(readFileSync('public/app.js', 'utf8'), /import '\.\/goal\.js';/);
  const legal = readFileSync('lib/legal.js', 'utf8');
  assert.doesNotMatch(legal, /src="https:\/\/datafa\.st/);
  assert.match(legal, /asset\('goal\.js'\)/);
});
