// WHY <ticker>: the biggest daily moves and what came out in each one's window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWords, filingText, closeAt, nyAt, biggestMoves, eightKs, whatCameOut, makeWhy, WHY_MOVES, SEC_TTL } from '../data/why.js';
import { createCache } from '../data/cache.js';

// A daily bar stamped at midnight New York time, like the chart source's.
const bar = (day, v) => ({ t: nyAt(day, 0, 0), v });

test('WHY: 8-K item codes in plain words', () => {
  assert.deepEqual(itemWords(['2.02', '9.01']), ['earnings']);
  assert.deepEqual(itemWords('1.01,5.02'), ['major agreement', 'executive change']);
  assert.deepEqual(itemWords(['8.01']), ['other events']);
  assert.deepEqual(itemWords(['5.2', '7.01']), ['executive change', 'investor disclosure'], 'a short code still reads');
  assert.deepEqual(itemWords(['9.01', '9.99', 'x']), []);
  assert.deepEqual(itemWords(['2.02', '2.02']), ['earnings']);
  assert.equal(filingText(['2.02', '9.01']), '8-K: earnings');
  assert.equal(filingText(['9.01']), '8-K filing');
  assert.equal(filingText(['5.02'], '8-K/A'), '8-K: executive change (amended)');
});

test('WHY: the close is 16:00 New York time, summer and winter', () => {
  assert.equal(new Date(closeAt('2026-07-15')).toISOString(), '2026-07-15T20:00:00.000Z');
  assert.equal(new Date(closeAt('2026-01-15')).toISOString(), '2026-01-15T21:00:00.000Z');
  assert.ok(Number.isNaN(closeAt('nope')));
});

test('WHY: the 10 biggest moves by absolute close to close change, biggest first', () => {
  const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09'];
  const closes = [100, 108, 97.2, 97.5, 92.625, 93];
  const moves = biggestMoves(days.map((d, i) => bar(d, closes[i])), { n: 3, now: Date.parse('2026-04-01T00:00:00Z') });
  assert.deepEqual(moves.map((m) => m.date), ['2026-03-04', '2026-03-03', '2026-03-06']);
  assert.equal(moves[0].prevDate, '2026-03-03');
  assert.ok(Math.abs(moves[0].pct - -10) < 1e-9);
  assert.ok(Math.abs(moves[1].pct - 8) < 1e-9);
  assert.equal(moves[0].close, 97.2);
  assert.equal(WHY_MOVES, 10);
  // A year of bars gives at most 10.
  const year = Array.from({ length: 250 }, (_, i) => bar(new Date(Date.UTC(2025, 9, 1) + i * 864e5).toISOString().slice(0, 10), 100 + Math.sin(i) * 5));
  assert.equal(biggestMoves(year, { now: Date.parse('2026-09-27T00:00:00Z') }).length, 10);
});

test('WHY: today before the close is not a close yet', () => {
  const pts = [bar('2026-09-24', 100), bar('2026-09-25', 150)];
  assert.equal(biggestMoves(pts, { now: Date.parse('2026-09-25T15:00:00Z') }).length, 0, '11:00 ET');
  assert.equal(biggestMoves(pts, { now: Date.parse('2026-09-25T20:30:00Z') }).length, 1, '16:30 ET');
});

test('WHY: EDGAR submissions -> 8-Ks with their acceptance time and words', () => {
  const body = {
    cik: '320193', name: 'Apple Inc.',
    filings: { recent: {
      form: ['8-K', '4', '8-K/A', '10-Q'],
      filingDate: ['2026-07-30', '2026-07-29', '2026-05-02', '2026-05-01'],
      acceptanceDateTime: ['2026-07-30T20:30:28.000Z', '', '', ''],
      items: ['2.02,9.01', '', '5.02', ''],
      accessionNumber: ['0000320193-26-000070', 'x', '0000320193-26-000050', 'y'],
      primaryDocument: ['aapl-20260730.htm', '', 'a.htm', ''],
    } },
  };
  const k = eightKs(body);
  assert.equal(k.length, 2);
  assert.equal(k[0].text, '8-K: earnings');
  assert.equal(new Date(k[0].time).toISOString(), '2026-07-30T20:30:28.000Z');
  assert.match(k[0].url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/000032019326000070\/aapl-20260730\.htm$/);
  assert.equal(k[1].text, '8-K: executive change (amended)');
  assert.ok(Number.isNaN(k[1].time));
});

test('WHY: what came out in the window, prior close to that close', () => {
  const move = { date: '2026-07-31', prevDate: '2026-07-30', pct: 5 };
  const filings = [
    { date: '2026-07-30', time: Date.parse('2026-07-30T20:30:28Z'), items: ['2.02', '9.01'], text: '8-K: earnings', url: 'https://www.sec.gov/a' }, // 16:30 ET the day before: counts
    { date: '2026-07-30', time: Date.parse('2026-07-30T13:00:00Z'), items: ['8.01'], text: '8-K: other events', url: 'https://www.sec.gov/b' }, // before the prior close: no
    { date: '2026-07-31', time: Date.parse('2026-07-31T21:00:00Z'), items: ['5.02'], text: '8-K: executive change', url: 'https://www.sec.gov/c' }, // after the close: no
    { date: '2026-07-31', time: NaN, items: ['1.01'], text: '8-K: major agreement', url: 'https://www.sec.gov/d' }, // that day, no time: counts
  ];
  const earnings = [{ date: '2026-07-30', url: 'https://www.sec.gov/a' }];
  const headlines = [
    { time: '2026-07-31T12:00:00Z', source: 'Nasdaq', title: 'Apple beats', url: 'https://n.test/1' },
    { time: '2026-07-30T19:00:00Z', source: 'SA', title: 'Apple ahead of results', url: 'https://n.test/0' }, // 15:00 ET: before
    { time: '2026-07-30T21:05:00Z', source: 'SA', title: 'Apple reports', url: 'https://n.test/2' },
  ];
  const out = whatCameOut(move, { filings, earnings, headlines });
  assert.deepEqual(out.map((x) => [x.kind, x.text]), [
    ['FILING', '8-K: major agreement'],
    ['FILING', '8-K: earnings'],
    ['NEWS', 'Apple reports'],
    ['NEWS', 'Apple beats'],
  ]);
  assert.ok(!out.some((x) => x.kind === 'EARNINGS'), 'the results 8-K already says earnings');
});

test('WHY: the earnings date shows when no results 8-K is there; nothing is an empty list', () => {
  const move = { date: '2026-10-29', prevDate: '2026-10-28', pct: -7 };
  assert.deepEqual(whatCameOut(move, { earnings: [{ date: '2026-10-29', est: true, url: null }] }).map((x) => [x.kind, x.text, x.source]), [['EARNINGS', 'Earnings date (estimated)', 'CNBC']]);
  // A Monday move takes in the weekend.
  const monday = { date: '2026-11-02', prevDate: '2026-10-30', pct: 4 };
  assert.equal(whatCameOut(monday, { earnings: [{ date: '2026-11-01', url: 'https://www.sec.gov/e' }] }).length, 1);
  assert.deepEqual(whatCameOut(move, {}), []);
  assert.deepEqual(whatCameOut(move, { earnings: [{ date: '2026-10-28' }] }), [], 'the prior day, no time: not in the window');
});

function fixtures({ calls = { sec: 0 } } = {}) {
  const days = ['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-03'];
  const closes = [200, 201, 202, 222, 221];
  const getChart = async (t, r) => { assert.equal(r, '1Y'); return { points: days.map((d, i) => bar(d, closes[i])), stale: false }; };
  const getChartEvents = async () => ({ earnings: [{ date: '2026-07-30', url: 'https://www.sec.gov/a' }], next: { date: '2026-10-29', est: true }, dividends: [] });
  const secTickers = async () => ({ value: { byTicker: new Map([['AAPL', { cik: 320193, title: 'Apple Inc.' }], ['SPY', { cik: 884394, title: 'SPDR S&P 500 ETF Trust' }]]) } });
  const body = { cik: '320193', filings: { recent: { form: ['8-K'], filingDate: ['2026-07-30'], acceptanceDateTime: ['2026-07-30T20:30:28.000Z'], items: ['2.02,9.01'], accessionNumber: ['0000320193-26-000070'], primaryDocument: ['a.htm'] } } };
  const fetchImpl = async (url, opts) => {
    calls.sec += 1;
    assert.match(url, /^https:\/\/data\.sec\.gov\/submissions\/CIK0000320193\.json$/);
    assert.match(opts.headers['User-Agent'], /@/, 'SEC fair access: a contact in the User-Agent');
    return new Response(JSON.stringify(body));
  };
  const log = { read: async () => [{ time: '2026-07-31T13:00:00Z', source: 'Nasdaq', title: 'Apple jumps', url: 'https://n.test/1' }] };
  return { getChart, getChartEvents, secTickers, fetchImpl, log, calls };
}

test('WHY: the service ranks the moves and fills each row; SEC is asked once per 12 h', async () => {
  let now = Date.parse('2026-09-27T00:00:00Z');
  const f = fixtures();
  const why = makeWhy({ ...f, cache: createCache({ now: () => now }), now: () => now });
  const d = await why.getWhy('aapl');
  assert.equal(d.ticker, 'AAPL');
  assert.equal(d.company, true);
  assert.equal(d.name, 'Apple Inc.');
  assert.equal(d.rows[0].date, '2026-07-31');
  assert.equal(d.rows[0].rank, 1);
  assert.deepEqual(d.rows[0].items.map((x) => x.text), ['8-K: earnings', 'Apple jumps']);
  assert.deepEqual(d.rows.at(-1).items, [], 'a quiet day has nothing');
  assert.equal(d.secOk, true);
  assert.equal(d.logSince, '2026-07-31T13:00:00Z');
  await why.getWhy('AAPL');
  assert.equal(f.calls.sec, 1);
  assert.equal(SEC_TTL, 12 * 3600_000);
  now += SEC_TTL + 1000;
  await why.getWhy('AAPL');
  assert.equal(f.calls.sec, 2);
});

test('WHY: only company stocks; indexes, FX, crypto and non-filers get company: false', async () => {
  const f = fixtures();
  const why = makeWhy(f);
  for (const t of ['SPX', 'EURUSD', 'BTC', 'GOLD', 'ZZZZ']) {
    const d = await why.getWhy(t);
    assert.equal(d.company, false, t);
    assert.deepEqual(d.rows, [], t);
  }
  await assert.rejects(why.getWhy('$$$'), { code: 'bad_symbol' });
});

test('WHY: SEC down still shows the moves, and says the filings did not load', async () => {
  const f = fixtures();
  const why = makeWhy({ ...f, fetchImpl: async () => new Response('no', { status: 503 }) });
  const d = await why.getWhy('AAPL');
  assert.equal(d.secOk, false);
  assert.equal(d.rows.length, 4);
  // The E flag source still gives the earnings day, and the log its headline.
  assert.deepEqual(d.rows[0].items.map((x) => x.kind), ['NEWS']);
});
