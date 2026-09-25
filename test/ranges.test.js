import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, parseRangeArgs, parseDate, rangeWords, chartQuery } from '../public/ranges.js';
import { makeCharts, chartWindow, barFor, thin, lastSession } from '../data/charts.js';
import { parseLookup, makeSearch, cleanQuery } from '../data/search.js';

const TODAY = '2026-09-25';

test('range words: presets, custom dates, FROM, errors', () => {
  assert.deepEqual(PRESETS, ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'MAX']);
  assert.deepEqual(parseRangeArgs([], TODAY), { range: '1Y' });
  assert.deepEqual(parseRangeArgs(['ytd'], TODAY), { range: 'YTD' });
  assert.deepEqual(parseRangeArgs(['2020-01-01', '2024-12-31'], TODAY), { from: '2020-01-01', to: '2024-12-31' });
  assert.deepEqual(parseRangeArgs(['FROM', '2020-01-01'], TODAY), { from: '2020-01-01', to: null });
  assert.deepEqual(parseRangeArgs(['2020-01-01'], TODAY), { from: '2020-01-01', to: null });
  assert.deepEqual(parseRangeArgs(['FROM', '2020-01-01', 'TO', '2021-06-30'], TODAY), { from: '2020-01-01', to: '2021-06-30' });
  assert.deepEqual(parseRangeArgs(['2020-01-01', '2030-01-01'], TODAY), { from: '2020-01-01', to: TODAY }, 'a future TO stops at today');
  assert.equal(parseRangeArgs(['7Y'], TODAY).error, 'usage');
  assert.equal(parseRangeArgs(['FROM'], TODAY).error, 'usage');
  assert.equal(parseRangeArgs(['2020-01-01', '2021-01-01', '2022-01-01'], TODAY).error, 'usage');
  assert.equal(parseRangeArgs(['2021-02-30'], TODAY).error, 'date');
  assert.equal(parseRangeArgs(['1850-01-01'], TODAY).error, 'date');
  assert.equal(parseRangeArgs(['2024-01-01', '2023-01-01'], TODAY).error, 'order');
  assert.equal(parseRangeArgs(['2024-01-01', '2024-01-01'], TODAY).error, 'order');
  assert.equal(parseRangeArgs(['2027-01-01'], TODAY).error, 'future');
  assert.equal(parseDate('2024-02-29').toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(parseDate('2023-02-29'), null);
  assert.equal(rangeWords({ range: '1Y' }), '');
  assert.equal(rangeWords({ range: '5Y' }), '5Y');
  assert.equal(rangeWords({ from: '2020-01-01', to: null }), 'FROM 2020-01-01');
  assert.equal(rangeWords({ from: '2020-01-01', to: '2024-12-31' }), '2020-01-01 2024-12-31');
  assert.equal(chartQuery('AAPL', { from: '2020-01-01', to: '2024-12-31' }), '/api/chart?s=AAPL&from=2020-01-01&to=2024-12-31');
  assert.equal(chartQuery('GOLD', { range: 'MAX' }), '/api/chart?s=GOLD&r=MAX');
});

test('bar sizes: intraday for days, daily to about 2 years, weekly, then monthly', () => {
  const now = new Date('2026-09-25T15:00:00Z');
  const w = (spec) => chartWindow(spec, now);
  assert.equal(w({ range: '1D' }).bar, '5M');
  assert.equal(w({ range: '5D' }).bar, '5M');
  for (const r of ['1M', '3M', '6M', 'YTD', '1Y', '2Y']) assert.equal(w({ range: r }).bar, '1D', r);
  assert.equal(w({ range: '5Y' }).bar, '1W');
  assert.equal(w({ range: '10Y' }).bar, '1W');
  assert.equal(w({ range: 'MAX' }).bar, '1MO');
  assert.equal(w({ range: 'YTD' }).start.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(w({ range: '1D' }).ttl, 60_000, 'intraday charts refresh every minute');
  assert.ok(w({ range: '1Y' }).ttl > 60_000);
  const c = w({ from: '2020-01-01', to: '2024-12-31' });
  assert.equal(c.bar, '1W');
  assert.equal(c.end.toISOString().slice(0, 10), '2025-01-01', 'TO is inclusive');
  assert.equal(w({ from: '2026-09-22', to: '2026-09-24' }).bar, '5M');
  assert.equal(w({ from: '2026-09-16', to: '2026-09-22' }).bar, '1H');
  assert.equal(w({ from: '2024-03-01', to: '2024-03-05' }).bar, '1D', 'old intraday history is not kept, so daily');
  assert.equal(w({ from: '2025-01-01' }).bar, '1D');
  assert.equal(w({ from: '1990-01-01' }).bar, '1MO');
  assert.throws(() => w({ range: '7Y' }), (e) => e.code === 'bad_range');
  assert.throws(() => w({ from: '2024-02-30' }), (e) => e.code === 'bad_date');
  assert.throws(() => w({ from: '2025-01-01', to: '2024-01-01' }), /before TO/);
  assert.throws(() => w({ from: '2030-01-01' }), /future/);
  assert.equal(barFor(0, 5 * 86_400_000, 10 * 86_400_000), '1H');
});

test('chart helpers: thin keeps the ends, 5D keeps five sessions', () => {
  const pts = Array.from({ length: 2000 }, (_, i) => ({ t: i, v: i }));
  const t = thin(pts, 800);
  assert.equal(t.length, 800);
  assert.equal(t[0].v, 0);
  assert.equal(t[799].v, 1999);
  const days = ['20260918', '20260921', '20260922', '20260923', '20260924', '20260925'];
  const bars = days.flatMap((d, i) => [{ t: i * 10, d: `${d}093500`, v: 1 }, { t: i * 10 + 1, d: `${d}190000`, v: 2 }]);
  const kept = lastSession(bars, { sessions: 5 });
  assert.deepEqual([...new Set(kept.map((p) => p.d.slice(0, 8)))], days.slice(1));
  assert.ok(kept.every((p) => p.v === 1), 'after-hours dropped for US symbols');
});

test('getChart: custom ranges reach the source with the right bar size', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ barData: { priceBars: [
      { close: '1', tradeTime: '20200102000000', tradeTimeinMills: 1577923200000 },
      { close: '2', tradeTime: '20241230000000', tradeTimeinMills: 1735516800000 },
    ] } }) };
  };
  const ch = makeCharts({ fetchImpl, now: () => new Date('2026-09-25T15:00:00Z') });
  const r = await ch.getChart('aapl', { from: '2020-01-01', to: '2024-12-31' });
  assert.deepEqual([r.from, r.to, r.bar, r.range], ['2020-01-01', '2024-12-31', '1W', null]);
  assert.match(urls[0], /\/AAPL\/1W\/20200101000000\/20250101000000\//);
  assert.match(urls[1], /\/AAPL\/1D\/20200101000000\/20250101000000\//, 'daily bars for the weekly end dates');
  await ch.getChart('gold', 'MAX');
  assert.match(urls[2], /\/%40GC\.1\/1MO\/19000101000000\//);
  await ch.getChart('eur/usd', '5D');
  assert.match(urls[4], /\/EUR%3D\/5M\//);
  assert.equal(urls.length, 5, 'intraday ranges make one call');
});

test('symbol search: our names first, then US stocks and ETFs', async () => {
  assert.equal(cleanQuery(' s&p '), 'S&P');
  assert.equal(cleanQuery('<script>'), null);
  const body = [{ TotalMatchAvailable: '4' },
    { issueType: 'STOCK', countryCode: 'US', symbolName: 'AAPL', companyName: 'Apple Inc.' },
    { issueType: 'STOCK', countryCode: 'GB', symbolName: 'VOD', companyName: 'Vodafone' },
    { issueType: 'ETF', countryCode: 'US', symbolName: 'SPY', companyName: 'SPDR S&P 500 ETF Trust' },
    { issueType: 'STOCK', countryCode: 'US', symbolName: 'GOLD', companyName: 'Old Barrick ticker' },
    { issueType: 'STOCK', countryCode: 'US', symbolName: 'TOO-LONG1', companyName: 'x' }];
  assert.deepEqual(parseLookup(body).map((r) => r.id), ['AAPL', 'SPY']);
  let calls = 0;
  const s = makeSearch({ fetchImpl: async () => { calls += 1; return { ok: true, json: async () => body }; } });
  const r = await s.search('s&p');
  assert.equal(r.results[0].id, 'SPX');
  await s.search('S&P');
  assert.equal(calls, 1, 'cached per query');
  const down = makeSearch({ fetchImpl: async () => { throw new Error('down'); } });
  const d = await down.search('gold');
  assert.deepEqual([d.results[0].id, d.degraded], ['GOLD', true]);
});
