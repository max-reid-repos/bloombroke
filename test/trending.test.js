import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTracker, createValidator, isBot, validSessionId, mountTrending, sameSite, TRENDING_LIMITS } from '../data/trending.js';
import { SP100_NAMES } from '../public/known-tickers.js';
import { createLimiter } from '../pro/ratelimit.js';
import { parseCommand } from '../public/app.js';
import { findCommand, FUNCTION_BAR } from '../public/registry.js';
import { trendingTable, opensText, fmtLast, windowLabel, metaText, QUIET } from '../public/screens/trending.js';
import { shouldSend, randomId, sessionId, countsAsOpen } from '../public/trending.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 8, 26, 12, 0, 0);
const sid = (n) => `session-${String(n).padStart(10, '0')}`;
const clock = (t = T0) => { const c = { t, now: () => c.t, add: (ms) => { c.t += ms; } }; return c; };
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36';

test('trending: distinct sessions per symbol, once per session per hour', () => {
  const c = clock();
  const tr = createTracker({ now: c.now });
  assert.equal(tr.hit('AAPL', sid(1)), true);
  assert.equal(tr.hit('AAPL', sid(1)), false, 'same session, same hour: not again');
  c.add(30 * MIN);
  assert.equal(tr.hit('AAPL', sid(1)), false, 'still inside the hour');
  tr.hit('AAPL', sid(2));
  tr.hit('AAPL', sid(3));
  tr.hit('TSLA', sid(1));
  assert.deepEqual(tr.top(), { window: 'hour', rows: [{ s: 'AAPL', n: 3 }, { s: 'TSLA', n: 1 }] });
  // An hour after it first counted, the same session counts again, and the old count has left the window.
  c.add(30 * MIN);
  assert.equal(tr.hit('AAPL', sid(1)), true);
  const aapl = tr.top().rows.find((r) => r.s === 'AAPL');
  assert.equal(aapl.n, 3, 'sessions 1 (again), 2 and 3: never 4');
  assert.equal(tr.hit('AAPL', 'short'), false, 'a bad session id never counts');
});

test('trending: counts leave the hour window, then the 24 hour window', () => {
  const c = clock();
  const tr = createTracker({ now: c.now });
  for (let i = 1; i <= 4; i += 1) tr.hit('NVDA', sid(i));
  assert.deepEqual(tr.top(), { window: 'hour', rows: [{ s: 'NVDA', n: 4 }] });
  c.add(HOUR + MIN);
  assert.deepEqual(tr.top(), { window: 'day', rows: [{ s: 'NVDA', n: 4 }] }, 'an empty hour falls back to 24 hours');
  c.add(24 * HOUR);
  assert.deepEqual(tr.top(), { window: 'day', rows: [] }, 'gone after 24 hours');
  assert.equal(tr.size().symbols, 0, 'and forgotten');
});

test('trending: fewer than 3 sessions in the last hour shows the last 24 hours', () => {
  const c = clock();
  const tr = createTracker({ now: c.now });
  for (let i = 1; i <= 5; i += 1) tr.hit('GOLD', sid(i));
  c.add(3 * HOUR);
  tr.hit('AAPL', sid(10));
  tr.hit('AAPL', sid(11));
  let t = tr.top();
  assert.equal(t.window, 'day');
  assert.deepEqual(t.rows, [{ s: 'GOLD', n: 5 }, { s: 'AAPL', n: 2 }]);
  tr.hit('MSFT', sid(12));
  t = tr.top();
  assert.equal(t.window, 'hour', '3 distinct sessions in the hour');
  assert.deepEqual(t.rows, [{ s: 'AAPL', n: 2 }, { s: 'MSFT', n: 1 }]);
  // One session opening many tickers is still one session for the threshold.
  const c2 = clock();
  const one = createTracker({ now: c2.now });
  for (const s of ['AAPL', 'MSFT', 'TSLA', 'NVDA']) one.hit(s, sid(1));
  assert.equal(one.top().window, 'day');
  assert.equal(TRENDING_LIMITS.minHourSessions, 3);
});

test('trending: top 10, most first, ties by symbol', () => {
  const tr = createTracker({ now: clock().now });
  const syms = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  syms.forEach((s, i) => { for (let k = 0; k <= i % 4; k += 1) tr.hit(s, sid(k)); });
  const rows = tr.top().rows;
  assert.equal(rows.length, 10);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].n > rows[i].n || (rows[i - 1].n === rows[i].n && rows[i - 1].s < rows[i].s));
  }
});

test('trending: memory caps on symbols and session ids', () => {
  const c = clock();
  const tr = createTracker({ now: c.now, limits: { maxSymbols: 3, maxIds: 2, maxSessions: 4 } });
  tr.hit('AAPL', sid(1)); tr.hit('AAPL', sid(2));
  assert.equal(tr.hit('AAPL', sid(3)), false, 'the id set is full: no count, never a double count');
  tr.hit('MSFT', sid(1));
  tr.hit('TSLA', sid(1)); tr.hit('TSLA', sid(2));
  tr.hit('NVDA', sid(4)); // a 4th symbol pushes out the one with the fewest views (MSFT)
  const size = tr.size();
  assert.equal(size.symbols, 3);
  assert.ok(size.ids <= 3 * 2);
  assert.ok(size.sessions <= 4);
  assert.deepEqual(tr.top().rows.map((r) => r.s).sort(), ['AAPL', 'NVDA', 'TSLA']);
  // After an hour the ids expire and there is room again.
  c.add(HOUR);
  assert.equal(tr.hit('AAPL', sid(3)), true);
});

test('trending: the bot filter', () => {
  for (const ua of ['', undefined, 'curl/8.5.0', 'Wget/1.21', 'python-requests/2.31', 'node', 'Go-http-client/1.1',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0 Safari/537.36',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0)', 'Mozilla/5.0 (compatible; SemrushBot) crawler', 'Mozilla/5.0 spider', 'x'.repeat(600)]) {
    assert.equal(isBot(ua), true, String(ua));
  }
  for (const ua of [BROWSER, 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1']) {
    assert.equal(isBot(ua), false, ua);
  }
  assert.equal(validSessionId('a'.repeat(32)), true);
  for (const v of ['short', 'x'.repeat(65), 'has space in it here', '<script>alert(1)</script>', 42, null]) assert.equal(validSessionId(v), false, String(v));
});

test('trending: only real instruments and tickers count', async () => {
  const asked = [];
  const getQuote = async (t) => { asked.push(t); return t === 'ROKU' ? { ticker: 'ROKU' } : null; };
  const c = clock();
  const validate = createValidator({ lookup: getQuote, now: c.now, lookupsPerMinute: 3 });
  assert.equal(await validate('aapl'), 'AAPL', 'a listed ticker, no lookup');
  assert.equal(await validate('gold'), 'GOLD', 'a registry instrument');
  assert.equal(await validate('EUR/USD'), 'EURUSD');
  assert.equal(await validate('US10Y'), 'US10Y');
  assert.equal(await validate('BTC'), 'BTC');
  assert.deepEqual(asked, []);
  assert.equal(await validate('ROKU'), 'ROKU', 'a real ticker, checked once');
  assert.equal(await validate('ROKU'), 'ROKU');
  assert.deepEqual(asked, ['ROKU']);
  assert.equal(await validate('ZZZZZ'), null, 'no quote: not counted');
  for (const bad of ['', 'hello world', '<b>', 'TOOLONGSYMBOL', 'x'.repeat(40), 42, null, undefined, { s: 'AAPL' }]) {
    assert.equal(await validate(bad), null, String(bad));
  }
  // New lookups are capped per minute.
  assert.equal(await validate('QQQQ'), null);
  assert.equal(await validate('WWWW'), null);
  assert.deepEqual(asked, ['ROKU', 'ZZZZZ', 'QQQQ'], 'the 4th lookup in a minute is not made');
  c.add(MIN);
  await validate('WWWW');
  assert.deepEqual(asked.at(-1), 'WWWW');
  // A data break is not remembered as "not a ticker".
  const flaky = createValidator({ lookup: async () => { throw new Error('down'); }, now: c.now });
  assert.equal(await flaky('ABCD'), null);
  // The default: about 5 new lookups a minute, across everyone.
  let calls = 0;
  const slow = createValidator({ lookup: async () => { calls += 1; return null; }, now: c.now });
  for (const t of ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE', 'FFFF', 'GGGG', 'HHHH']) await slow(t);
  assert.equal(calls, 5);
});

async function serve(opts = {}) {
  const app = express();
  const c = clock();
  const tracker = createTracker({ now: c.now });
  const quotes = { AAPL: { ticker: 'AAPL', name: 'Apple Inc', last: 250.1, changePct: 1.2, decimals: null, kind: 'stock' } };
  mountTrending(app, {
    tracker,
    lookup: async (t) => quotes[t] || null,
    getQuoteList: async (list) => ({ quotes: list.map((t) => quotes[t]).filter(Boolean) }),
    now: c.now,
    ...opts,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const seen = (body, ua = BROWSER, headers = {}) => fetch(`${base}/api/seen`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'User-Agent': ua, 'Content-Type': 'text/plain', ...headers } });
  return { server, base, tracker, seen, clock: c };
}

test('trending routes: /api/seen counts browsers only, /api/trending adds prices', async () => {
  const { server, base, tracker, seen } = await serve();
  try {
    for (let i = 1; i <= 3; i += 1) assert.equal((await seen({ s: 'AAPL', v: sid(i) })).status, 204);
    await seen({ s: 'gold', v: sid(1) });
    assert.equal((await seen({ s: 'AAPL', v: sid(9) }, 'curl/8.5.0')).status, 204, 'a bot gets the same answer');
    await seen({ s: 'NOTREAL', v: sid(9) });
    await seen({ s: 'ZZZZ', v: sid(9) });
    await seen({ s: 'AAPL', v: 'bad' });
    await seen('not json');
    await seen(JSON.stringify({ s: 'AAPL', v: sid(8), pad: 'x'.repeat(400) }));
    assert.deepEqual(tracker.top(), { window: 'hour', rows: [{ s: 'AAPL', n: 3 }, { s: 'GOLD', n: 1 }] });
    const res = await fetch(`${base}/api/trending`);
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.window, 'hour');
    assert.deepEqual(d.rows[0], { s: 'AAPL', n: 3, name: 'Apple', last: 250.1, changePct: 1.2, decimals: null, kind: 'stock' });
    assert.equal(d.rows[1].s, 'GOLD');
    assert.equal(d.rows[1].last, null, 'no quote: shown as --');
    assert.equal(d.rows[1].kind, 'spot');
  } finally {
    server.close();
  }
});

test('trending routes: /api/seen is rate limited per client', async () => {
  const { server, tracker, seen } = await serve();
  try {
    const codes = [];
    const syms = SP100_NAMES.map(([t]) => t);
    for (let i = 1; i <= TRENDING_LIMITS.perMinute + 3; i += 1) codes.push((await seen({ s: syms[i], v: sid(i) })).status);
    assert.equal(codes.filter((x) => x === 204).length, TRENDING_LIMITS.perMinute);
    assert.deepEqual(codes.slice(-3), [429, 429, 429]);
    assert.equal(tracker.size().ids, TRENDING_LIMITS.perMinute, 'limited calls are not counted');
  } finally {
    server.close();
  }
  // The limiter is injectable; a tiny one proves the key is per client, not global.
  const lim = createLimiter({ max: 1, windowMs: MIN });
  const two = await serve({ limiter: lim });
  try {
    assert.equal((await two.seen({ s: 'AAPL', v: sid(1) })).status, 204);
    assert.equal((await two.seen({ s: 'AAPL', v: sid(2) })).status, 429);
  } finally {
    two.server.close();
  }
});

test('TRENDING: a command in HELP, not on the function bar, not a ticker', () => {
  const p = parseCommand('trending');
  assert.equal(p.name, 'TRENDING');
  assert.equal(p.input, 'TRENDING');
  const entry = findCommand('TRENDING');
  assert.ok(entry && !entry.hidden);
  const words = entry.summary.split(/\s+/).length;
  assert.ok(words >= 3 && words <= 5, entry.summary);
  assert.ok(!FUNCTION_BAR.includes('TRENDING'));
  assert.equal(findCommand('MOST'), null);
  assert.equal(findCommand('READ'), null);
});

test('TRENDING screen: rows, labels, escaping, the quiet line', () => {
  assert.equal(opensText(1), '1 open');
  assert.equal(opensText(12), '12 opens');
  assert.equal(opensText(1200), '1,200 opens');
  assert.equal(windowLabel('hour'), 'Last hour');
  assert.equal(windowLabel('day'), 'Last 24 hours');
  const row = [{ s: 'AAPL', n: 2 }];
  assert.equal(metaText({ window: 'hour', rows: row }), 'Last hour · opens on Bloombroke');
  assert.equal(metaText({ window: 'day', rows: row }), 'Last 24 hours · opens on Bloombroke', 'the fallback is labelled');
  assert.equal(metaText({ window: 'day', rows: [] }), '', 'quiet: no label');
  assert.equal(fmtLast(250.1, null), '250.10');
  assert.equal(fmtLast(4.1234, 3), '4.123');
  assert.equal(fmtLast(0.01234, null), '0.01234');
  assert.equal(fmtLast(null, 2), '--');
  assert.match(trendingTable({ rows: [] }), new RegExp(QUIET.replace('.', '\\.')));
  assert.match(trendingTable(null), /Quiet right now\./);
  const html = trendingTable({ rows: [{ s: 'AAPL', n: 12, name: '<img src=x onerror=alert(1)>', last: 1, changePct: -0.5 }] });
  assert.match(html, /12 opens/);
  assert.match(html, />Opens</);
  assert.doesNotMatch(html, /people|person/);
  assert.match(html, /data-cmd="AAPL"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /\u2014|hot|buy/i);
});

test('TRENDING client: random session id, one beacon per symbol per hour', () => {
  const id = randomId();
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.notEqual(randomId(), id);
  assert.ok(validSessionId(id));
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = sessionId(storage);
  assert.equal(sessionId(storage), a, 'the same all session');
  const blocked = { getItem() { throw new Error('blocked'); } };
  assert.match(sessionId(blocked), /^[a-f0-9]{32}$/);
  const log = new Map();
  assert.equal(shouldSend('AAPL', T0, log), true);
  assert.equal(shouldSend('AAPL', T0 + MIN, log), false);
  assert.equal(shouldSend('MSFT', T0 + MIN, log), true);
  assert.equal(shouldSend('AAPL', T0 + HOUR, log), true);
});

test('trending: one address adds at most 3 new session ids per symbol per hour', () => {
  const c = clock();
  const tr = createTracker({ now: c.now, limits: { maxClientKeys: 3 } });
  for (let i = 1; i <= 3; i += 1) assert.equal(tr.hit('AAPL', sid(i), 'ip-a'), true);
  assert.equal(tr.hit('AAPL', sid(4), 'ip-a'), false, 'a 4th new id from the same address');
  assert.equal(tr.hit('AAPL', sid(1), 'ip-a'), false, 'a repeat is still a repeat');
  assert.equal(tr.hit('MSFT', sid(4), 'ip-a'), true, 'the cap is per symbol');
  assert.equal(tr.hit('AAPL', sid(5), 'ip-b'), true, 'and per address');
  assert.equal(tr.top().rows.find((r) => r.s === 'AAPL').n, 4);
  // The key map is bounded: a new key when full is refused (fail closed).
  assert.equal(tr.hit('TSLA', sid(6), 'ip-c'), false);
  assert.equal(tr.size().clients, 3);
  // An hour later the keys expire and the address may count again.
  c.add(HOUR);
  assert.equal(tr.hit('AAPL', sid(4), 'ip-a'), true);
  assert.ok(tr.size().clients <= 3);
});

test('trending routes: cross-site calls and the per-address cap', async () => {
  const { server, base, tracker, seen } = await serve();
  try {
    const host = new URL(base).host;
    assert.equal((await seen({ s: 'AAPL', v: sid(1) }, BROWSER, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await seen({ s: 'AAPL', v: sid(2) }, BROWSER, { 'Sec-Fetch-Site': 'same-site' })).status, 403);
    assert.equal((await seen({ s: 'AAPL', v: sid(3) }, BROWSER, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await seen({ s: 'AAPL', v: sid(4) }, BROWSER, { Referer: 'https://evil.example/page' })).status, 403);
    assert.equal((await seen({ s: 'AAPL', v: sid(5) }, BROWSER, { Origin: 'null' })).status, 403);
    assert.equal(tracker.size().ids, 0, 'none of those counted');
    const own = { 'Sec-Fetch-Site': 'same-origin', Origin: `http://${host}`, Referer: `http://${host}/?c=AAPL` };
    for (let i = 10; i < 15; i += 1) assert.equal((await seen({ s: 'AAPL', v: sid(i) }, BROWSER, own)).status, 204);
    assert.equal(tracker.top().rows[0].n, 3, 'five tabs from one address count as three');
  } finally {
    server.close();
  }
  // The same check, straight.
  const req = (h) => ({ get: (k) => h[k.toLowerCase()] });
  assert.equal(sameSite(req({ host: 'bloombroke.com' })), true, 'no headers: allowed (old browsers, fetch keepalive)');
  assert.equal(sameSite(req({ host: 'bloombroke.com', origin: 'https://bloombroke.com' })), true);
  assert.equal(sameSite(req({ host: 'bloombroke.com', origin: 'https://bloombroke.com.evil.example' })), false);
  assert.equal(sameSite(req({ host: 'bloombroke.com', referer: 'not a url' })), false);
  assert.equal(sameSite(req({ host: '127.0.0.1:3020', origin: 'https://bloombroke.com' })), true, 'a proxy that rewrites Host');
  assert.equal(sameSite(req({ host: '127.0.0.1:3020', origin: 'https://evil.example' })), false);
});

test('TRENDING client: counts ticker screens only, never in DESK panels or before ACCEPT', () => {
  const quote = parseCommand('AAPL');
  const ok = { embed: false, consentPending: false };
  assert.equal(countsAsOpen(quote, ok), true);
  for (const s of ['GOLD', 'EURUSD', 'BTC', 'SPX', 'US10Y', 'SPY']) assert.equal(countsAsOpen(parseCommand(s), ok), true, s);
  assert.equal(countsAsOpen(quote, { embed: true, consentPending: false }), false, 'a DESK iframe (embed=1)');
  assert.equal(countsAsOpen(quote, { embed: false, consentPending: true }), false, 'the first-visit notice is showing');
  assert.equal(countsAsOpen(quote), false, 'defaults to not counting');
  for (const s of ['WEIRD', 'PIZZA', 'HOME', 'TRENDING', 'AAPL NEWS', 'MOVERS']) assert.equal(countsAsOpen(parseCommand(s), ok), false, s);
  assert.equal(countsAsOpen(parseCommand('AAPL 2020-13-45 2024-01-01'), ok), false, 'a screen with an error');
  assert.equal(countsAsOpen(null, ok), false);
});
