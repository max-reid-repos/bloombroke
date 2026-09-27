import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BARS, barValid, barsForPreset, AUTO_BAR, zoomBar, parseBar, presetSpanDays } from '../public/bars.js';
import {
  shapeBars, lastSession, inRegular, lastHours, mergeBars, chartWindow, chunks, chartSpecFromQuery, makeCharts, readJson,
  officialCloses, sessionVolume, clipBars, mergeFactor,
} from '../data/charts.js';
import { createCache } from '../data/cache.js';
import {
  lineIndexes, candleBuckets, zoomWindow, timeAt, unitAt, durationText, measure, alignAsOf, rebase, commonStart,
  placeEvents, axisLabels, barInfo, headerStats, fmtVol, whenText, fmtDateBox, parseDateBox, windowDays,
} from '../public/screens/chart-math.js';
import { earningsFrom8K, exDivFromRows, parseEventData, makeChartEvents } from '../data/chart-events.js';
import { parseSubmissions } from '../data/filings.js';
import { parseRangeArgs, rangeWords, chartQuery, splitCompare, PRESETS } from '../public/ranges.js';
import { parseCommand } from '../public/app.js';
import { periodLabel, periodRows, periodMenu, periodPick, chartStyleToggle, nextChartStyle } from '../public/screens/chart.js';

const DAY = 86_400_000;
const NOW = new Date('2026-09-25T15:00:00Z');
// A New York time on Friday 25 Sep 2026 (summer time: UTC-4) as ms.
const ET = (hm, day = '2026-09-25') => Date.parse(`${day}T${hm}:00-04:00`);
const cnbc = (hm, close, { day = '20260925', o = close, h = close, l = close, vol = 100 } = {}) => {
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  return { open: String(o), high: String(h), low: String(l), close: String(close), volume: vol, tradeTime: `${day}${hm.replace(':', '')}00`, tradeTimeinMills: ET(hm, iso) };
};

// ---- Bar sizes and ranges ----------------------------------------------------------

test('bar sizes: only valid combos per range', () => {
  const ok = (r) => barsForPreset(r, NOW).filter((b) => b.ok).map((b) => b.bar);
  assert.deepEqual(ok('1D'), ['1M', '5M', '30M', '1H'], '1D: intraday only, a daily bar would be one point');
  assert.deepEqual(ok('5D'), ['1M', '5M', '30M', '1H', '1D']);
  assert.deepEqual(ok('1M'), ['5M', '30M', '1H', '1D'], '1m bars stop at 5D');
  assert.deepEqual(ok('3M'), ['30M', '1H', '1D'], '5m bars stop at 1M');
  assert.deepEqual(ok('6M'), ['30M', '1H', '1D'], '30m and 1h to the intraday history limit');
  assert.deepEqual(ok('YTD'), ['1D'], 'YTD starts before the intraday history');
  assert.deepEqual(ok('1Y'), ['1D', '1W'], 'W from 1Y up');
  assert.deepEqual(ok('MAX'), ['1D', '1W']);
  assert.equal(barValid('1M', { spanDays: 2, ageDays: 400 }), false, 'too old for 1m bars');
  assert.equal(barValid('15M', { spanDays: 1 }), false);
  assert.equal(presetSpanDays('YTD', NOW), 268);
  assert.deepEqual([AUTO_BAR['1D'], AUTO_BAR['5D'], AUTO_BAR['1M'], AUTO_BAR['1Y'], AUTO_BAR['5Y'], AUTO_BAR.MAX], ['1M', '5M', '1D', '1D', '1W', null]);
  for (const r of Object.keys(AUTO_BAR)) if (AUTO_BAR[r]) assert.ok(barsForPreset(r, NOW).find((b) => b.bar === AUTO_BAR[r]).ok, `${r} auto bar is valid`);
});

test('bar whitelist: the route takes only known bar sizes', () => {
  assert.deepEqual(BARS, ['1M', '5M', '30M', '1H', '1D', '1W']);
  assert.equal(parseBar('1m'), '1M');
  assert.equal(parseBar('15M'), null, 'the source has no 15m bars');
  assert.equal(parseBar('1MO'), null);
  assert.equal(parseBar('../x'), null);
  assert.deepEqual(chartSpecFromQuery({ r: '1D', bar: '1m' }), { range: '1D', bar: '1M' });
  assert.deepEqual(chartSpecFromQuery({ from: '2026-09-01', to: '2026-09-05', bar: '30M' }), { from: '2026-09-01', to: '2026-09-05', bar: '30M' });
  assert.equal(chartSpecFromQuery({ r: '5Y' }), '5Y', 'no bar: the old call');
  assert.deepEqual(chartSpecFromQuery({ from: '2020-01-01' }), { from: '2020-01-01', to: null });
  assert.throws(() => chartSpecFromQuery({ r: '1D', bar: '15M' }), (e) => e.code === 'bad_bar');
  assert.throws(() => chartSpecFromQuery({ r: '1D', bar: 'drop table' }), (e) => e.code === 'bad_bar');
  assert.equal(chartQuery('AAPL', { range: '1D' }, '1M'), '/api/chart?s=AAPL&r=1D&bar=1M');
});

test('chart window: an explicit bar is checked against the range', () => {
  const w = chartWindow({ range: '1D', bar: '1M' }, NOW);
  assert.deepEqual([w.bar, w.ext, w.ttl, w.key], ['1M', true, 60_000, '1D:1M'], 'a stock 1D keeps pre-market and after hours');
  assert.equal(chartWindow({ range: '1D' }, NOW).ext, false, 'the old call is unchanged');
  assert.equal(chartWindow({ range: '1M', bar: '1H' }, NOW).regular, true, 'multi-day intraday: the session only');
  assert.throws(() => chartWindow({ range: '1Y', bar: '1M' }, NOW), (e) => e.code === 'bad_bar');
  assert.throws(() => chartWindow({ range: '1D', bar: '1D' }, NOW), (e) => e.code === 'bad_bar');
  assert.throws(() => chartWindow({ from: '2026-01-01', to: '2026-01-05', bar: '30M' }, NOW), (e) => e.code === 'bad_bar', 'older than 30m history');
  const c = chartWindow({ from: '2026-09-21', to: '2026-09-23', bar: '1M' }, NOW);
  assert.deepEqual([c.bar, c.regular, c.key], ['1M', true, '2026-09-21:2026-09-23:1M']);
  // 6M of 1h bars comes in pieces the source serves (about 90 days each).
  const parts = chunks(new Date('2026-03-25T00:00:00Z'), new Date('2026-09-26T00:00:00Z'), '1H');
  assert.equal(parts.length, 3);
  assert.equal(parts[0].start.toISOString(), '2026-03-25T00:00:00.000Z');
  assert.equal(parts[2].end.toISOString(), '2026-09-26T00:00:00.000Z');
  assert.equal(chunks(new Date(0), new Date(400 * DAY), '1D').length, 1, 'daily bars in one call');
});

test('bar period button: plain words, the range own period after a range click', () => {
  assert.deepEqual(['1M', '5M', '30M', '1H', '1D', '1W', '1MO'].map((b) => periodLabel(b)), ['1 MIN', '5 MIN', '30 MIN', '60 MIN', 'DAILY', 'WEEKLY', 'MONTHLY']);
  assert.equal(periodLabel(null), 'MONTHLY', 'no bar asked: the source default (MAX)');
  assert.equal(periodLabel('1D', 3), '3-DAY', 'merged bars say their span');
  // A range click drops the user's period: the button reads the range's own (AUTO_BAR).
  const own = (p) => periodLabel(AUTO_BAR[p]);
  assert.deepEqual(PRESETS.map((p) => [p, own(p)]), [
    ['1D', '1 MIN'], ['5D', '5 MIN'], ['1M', 'DAILY'], ['3M', 'DAILY'], ['6M', 'DAILY'], ['YTD', 'DAILY'],
    ['1Y', 'DAILY'], ['2Y', 'DAILY'], ['5Y', 'WEEKLY'], ['10Y', 'WEEKLY'], ['MAX', 'MONTHLY'],
  ]);
  const html = periodMenu({ cur: '1D', range: '1Y', today: NOW });
  assert.match(html, /data-per-toggle aria-haspopup="grid" aria-expanded="false"[^>]*>DAILY<span class="ch-caret" aria-hidden="true">\u25be<\/span>/);
  assert.doesNotMatch(html, /AUTO/);
  assert.match(html, /role="grid"[^>]* hidden>/, 'closed until the button opens it');
  assert.match(periodMenu({ cur: '1D', range: '1Y', open: true, today: NOW }), /aria-expanded="true"[\s\S]*role="grid" aria-label="Bar period and range">/);
});

test('bar period grid: each row the ranges bars.js allows, the active cell marked', () => {
  const rows = periodRows(NOW);
  assert.deepEqual(rows.map((g) => [g.group, g.rows.map((r) => r.label)]), [
    ['INTRADAY', ['1 MIN', '5 MIN', '30 MIN', '60 MIN']],
    ['HISTORICAL', ['DAILY', 'WEEKLY', 'MONTHLY']],
  ]);
  const cells = Object.fromEntries(rows.flatMap((g) => g.rows).map((r) => [r.bar, r.ranges]));
  // The same rules as the ?bar= check: a cell is there exactly when bars.js says the pair is valid.
  for (const bar of BARS) {
    assert.deepEqual(cells[bar], PRESETS.filter((p) => barsForPreset(p, NOW).find((b) => b.bar === bar).ok), bar);
  }
  assert.deepEqual(cells['1M'], ['1D', '5D']);
  assert.deepEqual(cells['5M'], ['1D', '5D', '1M']);
  assert.deepEqual(cells['1W'], ['1Y', '2Y', '5Y', '10Y', 'MAX']);
  assert.deepEqual(cells['1MO'], ['MAX'], 'monthly bars: the source default for MAX');
  // Rendered: a button per valid pair, an empty cell otherwise, one row per period.
  const html = periodMenu({ cur: '1W', range: '5Y', today: NOW });
  const btns = [...html.matchAll(/data-per="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(btns, rows.flatMap((g) => g.rows.flatMap((r) => r.ranges.map((p) => `${r.bar}:${p}`))));
  assert.equal((html.match(/role="row"/g) || []).length, 7);
  for (const row of html.split('role="row"').slice(1)) assert.equal((row.match(/role="gridcell"/g) || []).length, PRESETS.length);
  assert.match(html, /class="ch-per-c is-active" data-per="1W:5Y" tabindex="0"[^>]*aria-current="true">5Y</);
  assert.equal((html.match(/is-active/g) || []).length, 1);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1, 'one cell in the tab order');
  assert.match(periodMenu({ cur: '1MO', range: 'MAX', today: NOW }), /is-active" data-per="1MO:MAX"/);
  assert.doesNotMatch(periodMenu({ cur: '1H', range: null, today: NOW }), /is-active/, 'typed or zoomed dates: no cell active');
  assert.match(periodMenu({ cur: '1H', range: null, today: NOW }), /data-per="1H:1D" tabindex="0"/);
  // A cell sets the period and range together; the range's own period is AUTO (null).
  assert.equal(periodPick('1D', '1Y'), null);
  assert.equal(periodPick('1W', '1Y'), '1W');
  assert.equal(periodPick('30M', '1D'), '30M');
  assert.equal(periodPick('1MO', 'MAX'), null);
  assert.doesNotMatch(html, /undefined|null|NaN/);
});

// ---- CNBC 1-minute bars --------------------------------------------------------------

test('CNBC 1m bars: OHLC and volume, pre-market, session and after hours', () => {
  const raw = [
    cnbc('04:00', 336.11, { o: 336.41, h: 336.49, l: 335.66, vol: 6010 }),
    cnbc('09:29', 335.9),
    cnbc('09:30', 335.81, { o: 336.04, h: 336.8, l: 335.5, vol: 404194 }),
    cnbc('15:59', 340.96),
    cnbc('16:00', 341.0, { vol: 5277299 }),
    cnbc('16:01', 341.01),
    cnbc('19:59', 341.4603, { o: 341.465, h: 341.48, l: 341.44, vol: 539 }),
    cnbc('09:31', 335.0, { day: '20260924' }),
    { open: '1', high: '0.5', low: '2', close: '1', volume: 0, tradeTime: '20260925100000', tradeTimeinMills: ET('10:00') },
  ];
  const pts = shapeBars(raw);
  assert.equal(pts.length, 9);
  const first = pts.find((p) => p.d === '20260925040000');
  assert.deepEqual([first.o, first.h, first.l, first.v, first.x], [336.41, 336.49, 335.66, 336.11, 6010]);
  const bad = pts.find((p) => p.d === '20260925100000');
  assert.equal(bad.o, undefined, 'a high under the low is not an OHLC bar: close only');
  assert.equal(bad.x, undefined, 'zero volume is no volume');
  // 1D with pre-market and after hours (a stock), or the session only.
  const ext = lastSession(pts, { ext: true, mins: 1 });
  assert.deepEqual(ext.map((p) => p.d.slice(8, 12)), ['0400', '0929', '0930', '1000', '1559', '1600', '1601', '1959']);
  const reg = lastSession(pts, { mins: 1 });
  assert.deepEqual(reg.map((p) => p.d.slice(8, 12)), ['0930', '1000', '1559'], 'the 16:00 bar holds only prints after the bell');
  assert.equal(inRegular('20260925155900', 1), true);
  assert.equal(inRegular('20260925160000', 1), false);
  assert.equal(inRegular('20260925155500', 5), true);
  assert.equal(inRegular('20260925160000', 5), false, 'the 16:00 5m bar closes on a 16:04 trade');
  // 1h bars: the 09:00 bar holds the open, the 16:00 bar is after hours.
  assert.equal(inRegular('20260925090000', 60), true);
  assert.equal(inRegular('20260925160000', 60), false);
  assert.equal(inRegular('20260925080000', 60), false);
  // The chart's sessions: by New York time and bar length.
  const info = barInfo(ext, 1);
  assert.deepEqual(info.map((x) => x.session), ['pre', 'pre', 'regular', 'regular', 'regular', 'post', 'post', 'post']);
  assert.equal(barInfo([{ t: ET('09:00') }], 60)[0].session, 'regular');
  assert.equal(barInfo([{ t: ET('08:00') }], 60)[0].session, 'pre');
  // Crypto: the last 24 hours, not the last calendar day.
  const btc = [{ t: 0, v: 1 }, { t: DAY - 60_000, v: 2 }, { t: DAY + 5 * 60_000, v: 3 }];
  assert.deepEqual(lastHours(btc, 1).map((p) => p.v), [2, 3]);
});

test('the session closes on the official close; intraday volume only in the session', () => {
  const day = (d) => ({ d: `${d}000000`, t: 0, v: d === '20260925' ? 341.07 : 335.92 });
  const pts = shapeBars([
    cnbc('15:55', 340.9, { o: 340.8, h: 341.0, l: 340.7, vol: 900_000, day: '20260924' }),
    cnbc('16:00', 336.0, { vol: 1_360_000_000, day: '20260924' }),
    cnbc('09:30', 336.5, { vol: 2_000_000 }),
    cnbc('15:55', 340.98, { o: 340.9, h: 341.0, l: 340.85, vol: 5_000_000 }),
    cnbc('16:00', 341.2, { vol: 4_930_000 }),
  ]);
  const reg = pts.filter((p) => inRegular(p.d, 5));
  const fixed = officialCloses(reg, [day('20260924'), day('20260925')], 5);
  assert.deepEqual(fixed.map((p) => p.v), [335.92, 336.5, 341.07], 'each finished session ends on its daily close');
  assert.equal(fixed[2].h, 341.07, 'the high widens to hold the close');
  assert.equal(fixed[0].l, 335.92);
  // An unfinished session (the last bar is before 16:00) keeps its last trade.
  const live = officialCloses([{ ...reg[1] }], [day('20260925')], 5);
  assert.equal(live[0].v, 336.5);
  // Volume outside 09:30-15:59 is dropped (repeated after-hours prints, a 1.36B 16:00 bar).
  const vol = sessionVolume(pts, 5);
  assert.deepEqual(vol.map((p) => p.x ?? null), [900_000, null, 2_000_000, 5_000_000, null]);
  // FX, indexes and crypto get no volume at all (the source sends tick counts).
  assert.equal(shapeBars([cnbc('10:00', 1.14, { vol: 38_700 })], { volume: false })[0].x, undefined);
});

test('getChart: FX has no volume; intraday LAST is the official close', async () => {
  const intradayBody = { barData: { priceBars: [cnbc('15:55', 340.98, { vol: 10 }), cnbc('16:00', 341.2, { vol: 4_930_000 }), cnbc('09:30', 336, { day: '20260925' })] } };
  const dailyBody = { barData: { priceBars: [cnbc('00:00', 341.07, { day: '20260925' })] } };
  const fetchImpl = async (url) => ({ ok: true, status: 200, headers: new Map(), json: async () => (url.includes('/1D/') ? dailyBody : intradayBody) });
  const ch = makeCharts({ fetchImpl, now: () => new Date('2026-09-26T15:00:00Z') });
  const d = await ch.getChart('AAPL', { range: '5D', bar: '5M' });
  assert.equal(d.points[d.points.length - 1].v, 341.07, 'the 15:55 bar closes on the official close, the 16:00 bar is gone');
  const fx = await ch.getChart('EURUSD', { range: '5D', bar: '5M' });
  assert.ok(fx.points.every((p) => p.x === undefined), 'no FX volume');
});

test('chart cache: long daily windows share month keys; merged bars say their span', async () => {
  const w1 = chartWindow({ from: '2024-03-07', to: '2025-02-11' }, NOW);
  const w2 = chartWindow({ from: '2024-03-19', to: '2025-02-03' }, NOW);
  assert.equal(w1.key, w2.key, 'windows a few days apart share one cache entry');
  assert.equal(w1.key, '2024-03-01:2025-03-01');
  assert.deepEqual([w1.from, w1.to], ['2024-03-07', '2025-02-11'], 'the answer still says the dates asked for');
  assert.equal(chartWindow({ from: '2026-09-01', to: '2026-09-20' }, NOW).clip, null, 'short windows are not snapped');
  const bars = [{ t: Date.parse('2024-03-06T05:00:00Z') }, { t: Date.parse('2024-03-07T05:00:00Z') }, { t: Date.parse('2025-02-11T05:00:00Z') }, { t: Date.parse('2025-02-12T05:00:00Z') }];
  assert.equal(clipBars(bars, w1.clip, '1D').length, 2);
  // Merged bars keep their last bar's time.
  const many = Array.from({ length: 12 }, (_, i) => ({ t: i, d: 'x', v: i }));
  const m = mergeBars(many, 6);
  assert.deepEqual([m.length, m[0].t, m[0].te, m[0].v], [6, 0, 1, 1]);
  assert.equal(mergeFactor(12, 6), 2);
  assert.equal(mergeFactor(5, 6), 1);
  // The cache keeps the most recently used charts.
  const c = createCache({ maxEntries: 2, lru: true });
  await c.cached('a', 1e6, async () => 1);
  await c.cached('b', 1e6, async () => 2);
  await c.cached('a', 1e6, async () => 9);
  await c.cached('c', 1e6, async () => 3);
  assert.equal((await c.cached('a', 1e6, async () => 'reloaded')).value, 1, 'a was used, so b went');
  assert.equal((await c.cached('b', 1e6, async () => 'reloaded')).value, 'reloaded');
  // And stays under a total number of bars.
  const wc = createCache({ lru: true, weigh: (v) => v.points.length, maxWeight: 10 });
  for (const k of ['x', 'y', 'z']) await wc.cached(k, 1e6, async () => ({ points: new Array(4).fill(0) }));
  assert.deepEqual([wc.size(), wc.weight()], [2, 8], 'the oldest chart went to stay under 10 bars');
});

test('getChart: an explicit 1m 1D asks the source for 1m bars and keeps after hours', async () => {
  const urls = [];
  const body = { barData: { priceBars: [cnbc('08:00', 10), cnbc('10:00', 11, { o: 10, h: 12, l: 9 }), cnbc('11:00', 11.5), cnbc('17:00', 12)] } };
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, headers: new Map(), json: async () => body }; };
  const ch = makeCharts({ fetchImpl, now: () => NOW });
  const d = await ch.getChart('AAPL', { range: '1D', bar: '1M' });
  assert.match(urls[0], /\/AAPL\/1M\//);
  assert.deepEqual([d.bar, d.ext, d.points.length], ['1M', true, 4]);
  assert.deepEqual(d.points[1], { t: ET('10:00'), v: 11, o: 10, h: 12, l: 9, x: 100 });
  assert.equal(d.points[0].x, undefined, 'pre-market volume is dropped');
  const idx = await ch.getChart('SPX', { range: '1D', bar: '1M' });
  assert.deepEqual([idx.ext, idx.points.map((p) => p.v)], [false, [11, 11.5]], 'an index: the session only');
});

test('upstream bodies over the size cap are refused', async () => {
  const big = { headers: new Map([['content-length', String(9 * 1024 * 1024)]]), json: async () => ({}) };
  big.headers.get = (k) => Map.prototype.get.call(big.headers, k);
  await assert.rejects(readJson(big), /too large/);
  const chunk = new Uint8Array(600);
  let n = 0;
  const stream = { headers: { get: () => null }, body: { getReader: () => ({ read: async () => (n++ < 3 ? { done: false, value: chunk } : { done: true }), cancel: async () => {} }) } };
  await assert.rejects(readJson(stream, 1000), /too large/);
  const ok = { headers: { get: () => null }, body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new TextEncoder().encode('{"a":1}') })) }; } } };
  assert.deepEqual(await readJson(ok), { a: 1 });
});

// ---- Downsampling --------------------------------------------------------------------

test('downsampling keeps every high and low', () => {
  const vals = Array.from({ length: 10_000 }, (_, i) => Math.sin(i / 37) * 10 + (i === 4321 ? 50 : 0) + (i === 7777 ? -60 : 0));
  const idx = lineIndexes(vals, 0, vals.length - 1, 500);
  assert.ok(idx.length <= 1002, `about two points per bucket, got ${idx.length}`);
  assert.ok(idx.includes(4321), 'the spike up');
  assert.ok(idx.includes(7777), 'the spike down');
  assert.equal(idx[0], 0);
  assert.equal(idx[idx.length - 1], vals.length - 1);
  assert.ok(idx.every((v, k) => k === 0 || v > idx[k - 1]), 'in time order');
  const drawnMax = Math.max(...idx.map((i) => vals[i]));
  const drawnMin = Math.min(...idx.map((i) => vals[i]));
  assert.equal(drawnMax, Math.max(...vals));
  assert.equal(drawnMin, Math.min(...vals));
  assert.deepEqual(lineIndexes([1, 2, 3], 0, 2, 100), [0, 1, 2], 'few bars: all of them');
  // Candles merged k at a time: first open, last close, highest high, lowest low, summed volume.
  const pts = [{ v: 2, o: 1, h: 3, l: 0.5, x: 10 }, { v: 4, o: 2, h: 9, l: 1, x: 5 }, { v: 3, o: 4, h: 5, l: 0.1, x: 1 }];
  assert.deepEqual(candleBuckets(pts, 0, 2, 3), [{ a: 0, b: 2, o: 1, h: 9, l: 0.1, c: 3, x: 16 }]);
  // The server's cap merges bars the same way.
  const many = Array.from({ length: 7000 }, (_, i) => ({ t: i, d: 'x', v: i === 3500 ? 999 : 1, o: 1, h: i === 3500 ? 999 : 1, l: i === 10 ? 0.01 : 1 }));
  const m = mergeBars(many, 6000);
  assert.ok(m.length <= 6000);
  assert.equal(Math.max(...m.map((p) => p.h)), 999);
  assert.equal(Math.min(...m.map((p) => p.l)), 0.01);
});

// ---- Zoom ----------------------------------------------------------------------------

test('zoom: the window around the cursor, and the bar size it gets', () => {
  const w = zoomWindow([0, 100], 75, 0.5);
  assert.deepEqual(w, [37.5, 87.5], 'the bar under the cursor stays put');
  assert.deepEqual(zoomWindow([0, 100], 50, 0.01, { minSpan: 10 }), [45, 55]);
  assert.deepEqual(zoomWindow([50, 100], 90, 2, { hi: 100 }), [0, 100], 'never past the last bar');
  // Zoomed windows get the bar size that suits them.
  const H = 3_600_000;
  assert.equal(zoomBar(1 * H, 1 * H), '1M', 'a 1D chart zoomed to an hour keeps 1m bars');
  assert.equal(zoomBar(7 * DAY, 30 * DAY), '30M', 'a 1Y chart zoomed to a week gets 30m bars');
  assert.equal(zoomBar(4 * DAY, 10 * DAY), '5M');
  assert.equal(zoomBar(40 * DAY, 60 * DAY), '1H');
  assert.equal(zoomBar(7 * DAY, 400 * DAY), '1D', 'older than intraday history: daily');
  assert.equal(zoomBar(300 * DAY, 300 * DAY), '1D');
  assert.equal(zoomBar(8 * 366 * DAY, 8 * 366 * DAY), '1W');
  // Bar units to time and back, beyond the ends by the average spacing.
  const times = [0, 10, 20, 40];
  assert.equal(timeAt(times, 1.5), 15);
  assert.equal(timeAt(times, 3.5), 46.666666666666664);
  assert.equal(unitAt(times, 30), 2.5);
  assert.equal(unitAt(times, timeAt(times, -2)), -2);
  // A zoomed window becomes FROM/TO days for the command, TO dropped when it is today.
  assert.deepEqual(windowDays(Date.parse('2026-06-10T15:00:00Z'), Date.parse('2026-06-17T15:00:00Z'), '2026-09-25'), { from: '2026-06-10', to: '2026-06-17' });
  assert.deepEqual(windowDays(Date.parse('2026-09-25T14:00:00Z'), Date.parse('2026-09-25T15:00:00Z'), '2026-09-25'), { from: '2026-09-25', to: null });
  assert.deepEqual(windowDays(Date.parse('2026-06-10T14:00:00Z'), Date.parse('2026-06-10T15:00:00Z'), '2026-09-25'), { from: '2026-06-10', to: '2026-06-11' }, 'never the same day twice');
});

// ---- Measure -------------------------------------------------------------------------

test('measure: percent, change and how long, big and plain', () => {
  const a = { t: Date.parse('2026-01-02T05:00:00Z'), v: 100 };
  const b = { t: a.t + 43 * DAY, v: 112.34 };
  const m = measure(a, b);
  assert.equal(m.text, '+12.34%  +12.34  43 days');
  assert.equal(m.dir, 'up');
  assert.equal(measure(b, a).text, m.text, 'dragged right to left: the same');
  const d = measure({ t: 0, v: 309.12 }, { t: 8_100_000, v: 270.99 }, { intraday: true });
  assert.equal(d.dir, 'down');
  assert.equal(d.text, '\u221212.34%  \u221238.13  2h 15m');
  assert.equal(measure({ t: 0, v: 4.1 }, { t: DAY, v: 4.223 }, { bp: true }).text, '+12.3 bp  1 day');
  assert.equal(durationText(45 * 60_000, true), '45m');
  assert.equal(durationText(2 * 60 * 60_000, true), '2h');
  assert.equal(durationText(DAY + 4 * 3_600_000, true), '1d 4h');
  assert.equal(durationText(DAY, false), '1 day');
  assert.equal(measure({ t: 0, v: 5 }, { t: DAY, v: 5 }).dir, 'flat');
});

// ---- Compare -------------------------------------------------------------------------

test('compare: aligned to the main bars and rebased to 0% at the window start', () => {
  const times = [10, 20, 30, 40];
  const other = [{ t: 15, v: 50 }, { t: 30, v: 55 }, { t: 35, v: 60 }];
  const vals = alignAsOf(times, other);
  assert.deepEqual(vals, [null, 50, 55, 60], 'the last close at or before each bar');
  assert.deepEqual(rebase([100, 110, 90, 120], 0), [0, 10, -10, 20]);
  assert.deepEqual(rebase([100, 110, 90, 120], 1), [null, 0, (90 - 110) / 110 * 100, (120 - 110) / 110 * 100], 'from the first bar shown');
  assert.deepEqual(rebase(vals, 0), [null, 0, 10, 20], 'a series that starts later starts at 0% on its first bar');
  assert.deepEqual(rebase([null, null], 0), [null, null]);
  // A stock from 04:00 against an index from 09:30: both start at 0% at 09:30.
  const stock = [100, 101, 102, 104];
  const index = alignAsOf([1, 2, 3, 4], [{ t: 3, v: 50 }, { t: 4, v: 51 }]);
  const base = commonStart([stock, index], 0, 3);
  assert.equal(base, 2);
  assert.deepEqual([rebase(stock, base)[2], rebase(index, base)[2]], [0, 0]);
  assert.equal(commonStart([[null, null]], 0, 1), 0);
  // Compare words ride in the command, so a shared link keeps them.
  assert.deepEqual(parseRangeArgs(['5D', '+QQQ']), { range: '5D', compare: ['QQQ'] });
  assert.deepEqual(parseRangeArgs(['VS', 'QQQ', 'SPY']), { range: '1Y', compare: ['QQQ', 'SPY'] });
  assert.equal(parseRangeArgs(['VS', 'A', 'B', 'C', 'D']).error, 'usage', 'up to three');
  assert.equal(parseRangeArgs(['VS']).error, 'usage');
  assert.equal(splitCompare(['+<X>']), null);
  assert.equal(rangeWords({ range: '5D', compare: ['QQQ', 'SPY'] }), '5D VS QQQ SPY');
  assert.equal(rangeWords({ range: '1Y', compare: ['QQQ'] }), 'VS QQQ');
  const c = parseCommand('AAPL 1Y +QQQ');
  assert.deepEqual([c.name, c.args.compare, c.input], ['QUOTE', ['QQQ'], 'AAPL VS QQQ']);
  assert.deepEqual(parseCommand('AAPL 5D VS QQQ').args, { ticker: 'AAPL', range: '5D', compare: ['QQQ'] });
});

// ---- Events --------------------------------------------------------------------------

test('events: earnings from 8-K item 2.02, ex-dividend days, the next date', () => {
  const rows = [
    { form: '8-K', filed: '2026-07-30', items: ['2.02', '9.01'], url: 'https://www.sec.gov/Archives/edgar/data/320193/1/a.htm' },
    { form: '8-K', filed: '2026-05-01', items: ['5.07'], url: 'https://www.sec.gov/x' },
    { form: '8-K/A', filed: '2026-04-30', items: ['2.02'], url: 'https://www.sec.gov/y' },
    { form: '10-Q', filed: '2026-08-01', items: [], url: 'https://www.sec.gov/z' },
    { form: '8-K', filed: '2026-01-29', items: ['2.02'], url: 'https://evil.example/' },
  ];
  assert.deepEqual(earningsFrom8K(rows), [
    { date: '2026-01-29', url: null },
    { date: '2026-07-30', url: 'https://www.sec.gov/Archives/edgar/data/320193/1/a.htm', form: '10-Q' },
  ], 'the July results are final (10-Q filed after); January is older than the list of reports');
  assert.deepEqual(exDivFromRows([{ exDate: '2026-08-10', amount: 0.27 }, { exDate: '2026-05-11', amount: null }, { exDate: 'bad' }]), [
    { date: '2026-05-11', amount: null }, { date: '2026-08-10', amount: 0.27 },
  ]);
  assert.deepEqual(parseEventData({ next_earnings_date: '10/28/2026(est)', div_ex_date: '08/10/2026', div_amount: '0.27' }), {
    next: { date: '2026-10-28', est: true }, exDiv: { date: '2026-08-10', amount: 0.27 },
  });
  assert.deepEqual(parseEventData({ next_earnings_date: '1/29/2027' }).next, { date: '2027-01-29', est: false });
  assert.deepEqual(parseEventData(null), { next: null, exDiv: null });
  // The SEC list keeps 8-K item numbers for this.
  const sub = parseSubmissions({ cik: 1, name: 'X', filings: { recent: { form: ['8-K'], filingDate: ['2026-07-30'], items: ['2.02,9.01'], accessionNumber: ['0000000000-26-000001'], primaryDocument: ['a.htm'] } } });
  assert.deepEqual(sub.rows[0].items, ['2.02', '9.01']);
});

test('events: a stock gets flags from each source that answers; others get none', async () => {
  const { getChartEvents } = makeChartEvents({
    getFilings: async () => ({ rows: [{ form: '8-K', filed: '2026-07-30', items: ['2.02'], url: 'https://www.sec.gov/a' }] }),
    getDividends: async () => { throw new Error('down'); },
    fetchImpl: async () => ({ ok: true, json: async () => ({ FormattedQuoteResult: { FormattedQuote: [{ EventData: { next_earnings_date: '10/28/2026(est)', div_ex_date: '08/10/2026', div_amount: '0.27' } }] } }) }),
  });
  const d = await getChartEvents('aapl');
  assert.deepEqual(d.earnings, [{ date: '2026-07-30', url: 'https://www.sec.gov/a' }], 'no 10-Q or 10-K in the list: not known final or preliminary');
  assert.deepEqual(d.next, { date: '2026-10-28', est: true });
  assert.deepEqual(d.dividends, [{ date: '2026-08-10', amount: 0.27 }], 'no history: the last ex-dividend day from the quote');
  const gold = await getChartEvents('GOLD');
  assert.deepEqual([gold.earnings, gold.dividends, gold.next], [[], [], null]);
});

test('events land on the right bar', () => {
  const days = ['2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11'];
  const ev = [{ date: '2026-08-07', kind: 'E' }, { date: '2026-08-08', kind: 'D' }, { date: '2026-08-12', kind: 'E' }, { date: '2026-08-01', kind: 'D' }];
  assert.deepEqual(placeEvents(ev, days, 0, 3).map((e) => [e.date, e.i]), [['2026-08-07', 1], ['2026-08-08', 2]], 'a Saturday lands on Monday');
  const intraday = ['2026-08-07', '2026-08-07', '2026-08-10'];
  assert.deepEqual(placeEvents(ev, intraday, 0, 2, { bar: '5M' }).map((e) => [e.date, e.i]), [['2026-08-07', 0]], 'intraday: only days with bars');
  const weeks = ['2026-07-26', '2026-08-02', '2026-08-09'];
  assert.deepEqual(placeEvents(ev, weeks, 0, 2, { bar: '1W' }).map((e) => [e.date, e.i]), [['2026-08-07', 1], ['2026-08-08', 1], ['2026-08-12', 2], ['2026-08-01', 0]]);
});

// ---- Header, axis, date boxes ----------------------------------------------------------

test('header numbers for the window', () => {
  const pts = [{ t: 0, v: 10, h: 11, l: 9, x: 5 }, { t: 1, v: 12, h: 15, l: 11, x: 5 }, { t: 2, v: 8, h: 9, l: 7 }, { t: 3, v: 9, live: true }];
  const s = headerStats(pts, 0, 3);
  assert.deepEqual([s.last, s.chg, s.high, s.highI, s.low, s.lowI, s.avg, s.vol], [9, -1, 15, 1, 7, 2, 10, 10]);
  assert.equal(headerStats(pts, 1, 2, 10).pct, -20, 'from a given base (the previous close)');
  assert.equal(headerStats([{ t: 0, v: 1 }, { t: 1, v: 2 }], 0, 1).vol, null);
  assert.equal(fmtVol(12_300_000_000), '12.3B');
  assert.equal(fmtVol(329_000_000), '329M');
  assert.equal(fmtVol(22_400), '22.4K');
  assert.equal(whenText(Date.parse('2026-09-25T14:00:00Z'), { nowYear: 2026 }), 'SEP 25');
  assert.equal(whenText(Date.parse('2025-10-10T14:00:00Z'), { nowYear: 2026 }), "OCT 10 '25");
  assert.equal(whenText(ET('10:42'), { intraday: true, spanMs: DAY / 2 }), '10:42');
  assert.equal(whenText(ET('10:42'), { intraday: true, spanMs: 5 * DAY }), 'FRI 10:42');
});

test('axis labels: months on a year, clock times on a day, never crowded', () => {
  const days = [];
  for (let t = Date.parse('2025-09-26T16:00:00Z'); t < Date.parse('2026-09-26T00:00:00Z'); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push({ t });
  }
  const info = barInfo(days);
  const labs = axisLabels(info, 0, info.length - 1, 1300 / info.length);
  assert.ok(labs.length >= 10 && labs.length <= 13, `about one a month, got ${labs.length}`);
  assert.ok(labs.some((l) => l.text === '2026' && l.strong), 'the new year is named');
  const px = 1300 / info.length;
  assert.ok(labs.every((l, k) => k === 0 || (l.i - labs[k - 1].i) * px >= 72));
  const mins = Array.from({ length: 390 }, (_, k) => ({ t: ET('09:30') + k * 60_000 }));
  const day = axisLabels(barInfo(mins), 0, 389, 1300 / 390, { intraday: true });
  assert.ok(day.every((l) => /^\d\d:\d\d$/.test(l.text)), 'clock times');
  assert.ok(day.map((l) => l.text).includes('12:00'));
});

test('date boxes: MM/DD/YYYY in and out, bad days refused', () => {
  assert.equal(fmtDateBox(Date.parse('2026-09-25T14:00:00Z')), '09/25/2026');
  assert.equal(parseDateBox('9/25/2026'), '2026-09-25');
  assert.equal(parseDateBox(' 09-05-2020 '), '2020-09-05');
  assert.equal(parseDateBox('02/30/2024'), null);
  assert.equal(parseDateBox('2024-02-01'), null);
  assert.equal(parseDateBox('13/01/2024'), null);
  assert.equal(parseDateBox('01/01/1850'), null);
});

test('date boxes: a narrow bar shows MM/DD/YY, and both year forms are read', () => {
  assert.equal(fmtDateBox(Date.parse('2026-09-25T14:00:00Z'), true), '09/25/26');
  assert.equal(fmtDateBox(Date.parse('1999-01-04T14:00:00Z'), true), '01/04/99');
  // Two digits: this century unless that is after this year.
  assert.equal(parseDateBox('09/25/26', 2026), '2026-09-25');
  assert.equal(parseDateBox('9/5/24', 2026), '2024-09-05');
  assert.equal(parseDateBox('01/02/00', 2026), '2000-01-02');
  assert.equal(parseDateBox('12/31/27', 2026), '1927-12-31');
  assert.equal(parseDateBox('03/16/80', 2026), '1980-03-16');
  assert.equal(parseDateBox('09/25/2026', 2026), '2026-09-25');
  // What the box shows parses back to the same day, in either form.
  const t = Date.parse('2025-03-04T15:00:00Z');
  assert.equal(parseDateBox(fmtDateBox(t, true), 2026), parseDateBox(fmtDateBox(t)));
  assert.equal(parseDateBox('02/29/23', 2026), null, 'not a leap year');
  assert.equal(parseDateBox('09/25/026'), null, 'three digits');
  assert.equal(parseDateBox('09/25/2'), null, 'one digit');
});

test('chart type: one LINE or CANDLES button, a click switches it', () => {
  assert.equal(nextChartStyle('line'), 'candle');
  assert.equal(nextChartStyle('candle'), 'line');
  const line = chartStyleToggle('line');
  assert.match(line, /^<button type="button"/);
  assert.match(line, /data-style-toggle/);
  assert.match(line, />LINE<\/button>$/);
  assert.match(line, /aria-label="Chart type line, switch to candles"/);
  const candle = chartStyleToggle('candle');
  assert.match(candle, />CANDLES<\/button>$/);
  assert.match(candle, /aria-label="Chart type candles, switch to line"/);
  assert.match(chartStyleToggle('bogus'), />LINE</, 'anything else is a line');
  assert.ok(!/\u2014|\u2013/.test(line + candle), 'no long dashes');
});
