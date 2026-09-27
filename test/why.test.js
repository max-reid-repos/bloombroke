// WHY <ticker>: the biggest daily moves and what came out in each one's window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWords, filingText, closeAt, nyAt, biggestMoves, eightKs, whatCameOut, makeWhy, WHY_MOVES } from '../data/why.js';
import { makeFilings, parseSubmissions } from '../data/filings.js';
import { SEC_UA } from '../data/financials.js';

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

const AAPL_SUB = {
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

test('WHY: FILINGS rows -> 8-Ks with their acceptance time and words', () => {
  const rows = parseSubmissions(AAPL_SUB).rows;
  assert.equal(rows.find((r) => r.form === '8-K').accepted, '2026-07-30T20:30:28.000Z', 'FILINGS rows carry the acceptance time');
  const k = eightKs(rows);
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

// WHY through the real FILINGS service: its gated fetch, SEC's User-Agent, its cache.
function fixtures({ calls = { sec: 0, tickers: 0 }, secStatus = 200, gapMs = 0 } = {}) {
  const days = ['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-03'];
  const closes = [200, 201, 202, 222, 221];
  const getChart = async (t, r) => { assert.equal(r, '1Y'); return { points: days.map((d, i) => bar(d, closes[i])), stale: false }; };
  // The E flag source: the results 8-K's filing day and the next CNBC date.
  const getChartEvents = async () => ({ earnings: [{ date: '2026-07-30', url: 'https://www.sec.gov/a' }], next: { date: '2026-10-29', est: true }, dividends: [] });
  const fetchImpl = async (url, opts) => {
    assert.equal(opts.headers['User-Agent'], SEC_UA, 'the SEC User-Agent, with its contact');
    if (url.endsWith('company_tickers.json')) {
      calls.tickers += 1;
      return new Response(JSON.stringify({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } }));
    }
    calls.sec += 1;
    assert.match(url, /^https:\/\/data\.sec\.gov\/submissions\/CIK0000320193\.json$/);
    return secStatus === 200 ? new Response(JSON.stringify(AAPL_SUB)) : new Response('no', { status: secStatus });
  };
  const { getFilings } = makeFilings({ fetchImpl, gapMs });
  const log = { read: async () => [{ time: '2026-07-31T13:00:00Z', source: 'Nasdaq', title: 'Apple jumps', url: 'https://n.test/1' }] };
  return { getChart, getChartEvents, getFilings, log, calls };
}

test('WHY: the service ranks the moves and fills each row; SEC goes through FILINGS, once', async () => {
  const f = fixtures();
  const why = makeWhy({ ...f, now: () => Date.parse('2026-09-27T00:00:00Z') });
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
  await Promise.all([why.getWhy('AAPL'), why.getWhy('AAPL')]);
  assert.equal(f.calls.sec, 1, 'the submissions JSON is fetched once and cached');
  assert.equal(f.calls.tickers, 1);
});

test('WHY: AAPL reported after the close on Jul 30: it shows on the Jul 31 move, not Jul 30', async () => {
  const f = fixtures();
  const d = await makeWhy({ ...f, now: () => Date.parse('2026-09-27T00:00:00Z') }).getWhy('AAPL');
  const on = (day) => d.rows.find((r) => r.date === day);
  assert.deepEqual(on('2026-07-30').items, [], 'accepted 16:30 ET: after the Jul 30 close');
  assert.deepEqual(on('2026-07-31').items.filter((x) => x.kind !== 'NEWS').map((x) => [x.kind, x.text]), [['FILING', '8-K: earnings']]);
  assert.ok(!d.rows.some((r) => r.items.some((x) => x.kind === 'EARNINGS')), 'the E flag filing day is not added again');
});

test('WHY: SEC requests go one at a time, gapped', async () => {
  const starts = [];
  const fetchImpl = async (url) => {
    starts.push(Date.now());
    if (url.endsWith('company_tickers.json')) return new Response(JSON.stringify({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft' } }));
    return new Response(JSON.stringify({ ...AAPL_SUB, cik: url.includes('789019') ? '789019' : '320193' }));
  };
  const { getFilings } = makeFilings({ fetchImpl, gapMs: 40 });
  const base = fixtures();
  const why = makeWhy({ ...base, getFilings });
  await Promise.all([why.getWhy('AAPL'), why.getWhy('MSFT')]);
  assert.equal(starts.length, 3);
  for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= 35, `gap ${starts[i] - starts[i - 1]} ms`);
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
  const f = fixtures({ secStatus: 503 });
  const d = await makeWhy(f).getWhy('AAPL');
  assert.equal(d.company, true);
  assert.equal(d.secOk, false);
  assert.equal(d.rows.length, 4);
  assert.deepEqual(d.rows[0].items.map((x) => x.kind), ['NEWS'], 'the log still gives its headline');
});

// ---- The WHY screen -------------------------------------------------------------------

import { whatCell, itemHtml, whyTable, whyMeta, notCompanyHtml, WHY_NOTE } from '../public/screens/why.js';
import { parseCommand } from '../public/app.js';
import { findCommand, TICKER_FUNCTIONS } from '../public/registry.js';

test('WHY screen: AAPL WHY and WHY AAPL are one command; WHY alone shows its usage', () => {
  assert.deepEqual(parseCommand('AAPL WHY'), { name: 'WHY', args: { ticker: 'AAPL' }, error: undefined, input: 'WHY AAPL' });
  assert.deepEqual(parseCommand('why aapl'), { name: 'WHY', args: { ticker: 'AAPL' }, error: undefined, input: 'WHY AAPL' });
  assert.equal(parseCommand('WHY').error, 'usage');
  const e = findCommand('WHY');
  assert.equal(e.name, 'WHY');
  assert.ok(e.takesTicker && TICKER_FUNCTIONS.includes('WHY'));
  assert.ok(e.examples.every((x) => parseCommand(x).name === 'WHY'));
});

test('WHY screen: nothing found is --, never a cause', () => {
  assert.match(whatCell([]), />--</);
  assert.match(whatCell(undefined), />--</);
  assert.equal(WHY_NOTE, 'Biggest daily moves, 1Y. What came out that day, not a cause.');
  assert.match(whyMeta({ secOk: true }), /not a cause/i);
  assert.match(whyMeta({ secOk: false }), /SEC filings did not load/);
  assert.match(whyMeta({ logSince: '2026-09-27T01:00:00Z' }), /Headlines since SEP 27, 2026/);
});

test('WHY screen: each line links out in a new tab, three lines then +N MORE', () => {
  const it = (i, kind = 'NEWS') => ({ kind, time: '2026-07-31T13:00:00.000Z', date: '2026-07-31', text: `Story <${i}>`, url: `https://n.test/${i}`, source: 'Nasdaq' });
  const one = itemHtml(it(1, 'FILING'));
  assert.match(one, /target="_blank" rel="noopener noreferrer"/);
  assert.match(one, />SEC</);
  assert.match(one, /Story &lt;1&gt;/, 'feed text is escaped');
  assert.match(one, /title="JUL 31, 2026 09:00 ET/);
  assert.doesNotMatch(itemHtml({ ...it(2), url: 'javascript:alert(1)' }), /href=/);
  const cell = whatCell([it(1), it(2), it(3), it(4), it(5)]);
  assert.equal((cell.match(/class="why-it /g) || []).length, 3);
  assert.match(cell, /\+2 MORE/);
});

test('WHY screen: the table has date, % move in colour, close and what came out', () => {
  const html = whyTable([
    { rank: 1, date: '2026-07-31', pct: -9.456, close: 188.4, items: [] },
    { rank: 2, date: '2026-04-09', pct: 15.33, close: 198.85, items: [{ kind: 'EARNINGS', date: '2026-04-09', time: null, text: 'Earnings date', url: null, source: 'CNBC' }] },
  ]);
  assert.match(html, /class="dt why-dt"/);
  assert.match(html, /What came out that day/);
  assert.match(html, /JUL 31, 2026/);
  assert.match(html, /class="down">−9\.46%/);
  assert.match(html, /class="up">\+15\.33%/);
  assert.match(html, /188\.40/);
  assert.match(html, />EARN</);
});

test('WHY screen: no amber, no em dashes, no advice words in its copy', () => {
  const copy = [WHY_NOTE, notCompanyHtml('SPX'), JSON.stringify(findCommand('WHY'))].join(' ');
  assert.doesNotMatch(copy, /\u2014/);
  assert.doesNotMatch(copy, /\b(buy|sell|rating|target|signal)\b/i);
  assert.match(notCompanyHtml('SPX'), /WHY works for company stocks/);
});
