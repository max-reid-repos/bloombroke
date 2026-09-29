// Terminal layout fixes: the 1D axis fit, the previous close on the axis, chart bars in a
// panel, RT and DLY said once per panel, MARKETS in HOME's groups, the one-line range
// header in a DESK panel and the softer heatmap. ($DESK is in dollar-ticker.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { barInfo, sessionPad, padInfo, axisLabels, MIN_WINDOW_MINS, oneDayPad, hasSession } from '../public/screens/chart-math.js';
import { instrumentById } from '../public/instruments.js';
import { fxTable } from '../public/screens/markets-full.js';
import { svgFor, prevTagAt, prevWordsBox } from '../public/screens/chart-view.js';
import { chartBarMode } from '../public/screens/chart.js';
import { HOME_MARKETS, homeMarkets, marketsColumns, fmtNum } from '../public/screens/markets.js';
import { marketsGroups, packColumns, marketsFull, marketsFit, nameChars, staleDay } from '../public/screens/markets-full.js';
import { delayTag, freshLegend, LEGEND_TEXT } from '../public/freshness.js';
import { watchTable } from '../public/screens/watch.js';
import { rangeLine } from '../public/screens/quote.js';
import { heatFill, HEAT_SAT } from '../public/screens/heatmap.js';

const src = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const ET = (day, hm) => Date.parse(`${day}T${hm}:00-04:00`);
const bars = (day, from, n, stepMin = 1, v0 = 100) => Array.from({ length: n }, (_, k) => ({ t: ET(day, from) + k * stepMin * 60_000, v: v0 + Math.sin(k / 3) }));
const DAY = '2026-09-29';

// ---- 1. The 1D axis fit --------------------------------------------------------------

test('1D axis: early in the session the window is 2 hours, not the whole empty session', () => {
  assert.equal(MIN_WINDOW_MINS, 120);
  // 36 one-minute bars, 09:30 to 10:05: the axis runs to 11:30.
  const info = barInfo(bars(DAY, '09:30', 36), 1);
  const pad = sessionPad(info, { endMins: 16 * 60, barMins: 1 });
  assert.equal(pad, 85);
  const full = [0, info.length - 1 + pad];
  assert.equal(full[1] - full[0], 120, 'a 2-hour window');
  assert.ok((info.length - 1) / full[1] > 0.25, 'the bars fill more than a quarter of the axis, not the left tenth');
  // Before, the axis ran to 16:00: 35 of 390 minutes.
  assert.ok(35 / 390 < 0.1);
  // 5-minute bars: the same 2 hours, in bar slots.
  const five = barInfo(bars(DAY, '09:30', 8, 5), 5);
  assert.equal(sessionPad(five, { endMins: 960, barMins: 5 }), (690 - 605) / 5);
  // A stock with pre-market bars from 04:00: 2 hours from its first bar.
  const pre = barInfo(bars(DAY, '04:00', 31), 1);
  assert.equal(sessionPad(pre, { endMins: 20 * 60, barMins: 1 }), 360 - 270);
});

test('1D axis: fits the bars once they span 2 hours; after the close it is the whole session', () => {
  // 09:30 to 14:30: the axis ends at the last bar.
  assert.equal(sessionPad(barInfo(bars(DAY, '09:30', 301), 1), { endMins: 960, barMins: 1 }), 0);
  // The session is over (bars to 16:00): the full session, 09:30 to 16:00.
  const done = barInfo(bars(DAY, '09:30', 391), 1);
  assert.equal(sessionPad(done, { endMins: 960, barMins: 1 }), 0);
  assert.deepEqual([done[0].mins, done[done.length - 1].mins], [570, 960]);
  // Never past the session's end.
  assert.equal(sessionPad(barInfo(bars(DAY, '15:30', 11), 1), { endMins: 960, barMins: 1 }), 960 - 940);
  assert.equal(sessionPad([], {}), 0);
});

// A 1D chart's pad as the chart decides it (chart.js build: oneDayPad with hasSession).
const padFor = (id, points, today, { ext = false, barMins = 1 } = {}) => {
  const inst = instrumentById(id);
  return oneDayPad(barInfo(points, barMins), { today, session: hasSession(inst, !inst), ext, barMins });
};

test('1D axis: a winter (EST) session gets the same 2-hour window', () => {
  // 15 Dec 2026 is standard time: 09:30 ET = 14:30 UTC.
  const EST = (hm) => Date.parse(`2026-12-15T${hm}:00-05:00`);
  const pts = Array.from({ length: 36 }, (_, k) => ({ t: EST('09:30') + k * 60_000, v: 1 + k }));
  assert.equal(barInfo(pts, 1)[0].mins, 570, '09:30 in New York, not 08:30 or 10:30');
  assert.equal(padFor('SPX', pts, '2026-12-15'), 85);
  assert.equal(padFor('AAPL', pts, '2026-12-15'), 85);
});

test('1D axis: a half day (13:00 close) and a holiday show the session as it was', () => {
  // Friday 27 Nov 2026, the day after Thanksgiving: the session ends at 13:00.
  const est = (day, from, n) => Array.from({ length: n }, (_, k) => ({ t: Date.parse(`${day}T${from}:00-05:00`) + k * 60_000, v: 1 + k }));
  const half = est('2026-11-27', '09:30', 211);
  assert.equal(barInfo(half, 1).at(-1).mins, 13 * 60);
  assert.equal(padFor('SPX', half, '2026-11-27'), 0, 'at 15:00 that day: no empty 13:00 to 16:00');
  // Early that morning it still opens on a 2-hour window.
  assert.equal(padFor('SPX', est('2026-11-27', '09:30', 11), '2026-11-27'), 110);
  // Thanksgiving (26 Nov): no bars today, the chart holds Wednesday's full session.
  const wed = est('2026-11-25', '09:30', 391);
  assert.equal(padFor('SPX', wed, '2026-11-26'), 0);
  assert.equal(padFor('AAPL', wed, '2026-11-28'), 0, 'a weekend too');
});

test('1D axis: crypto, FX, futures and all-day indexes are never padded', () => {
  const young = bars(DAY, '09:30', 10);
  for (const id of ['BTC', 'ETH', 'EURUSD', 'USDJPY', 'SPFUT', 'GOLD', 'DXY', 'MOVEINDEX']) {
    assert.equal(hasSession(instrumentById(id)), false, id);
    assert.equal(padFor(id, young, DAY), 0, id);
  }
  for (const id of ['SPX', 'NDX', 'VIX']) assert.equal(hasSession(instrumentById(id)), true, id);
  assert.equal(hasSession(null, true), true, 'a stock');
  assert.equal(padFor('AAPL', young, DAY), 111);
  // With after hours (a stock's ext bars), 2 hours from the first bar, capped at 20:00.
  assert.equal(padFor('AAPL', bars(DAY, '19:00', 11), DAY, { ext: true }), 50, '19:10: only to 20:00');
  assert.equal(padFor('AAPL', young, DAY, { ext: true }), 111);
  assert.equal(src('screens/chart.js').includes('oneDayPad(info, { today, session: hasSession(inst, isStock), ext: data.ext, barMins })'), true);
});

test('1D axis: the empty part of a young session still has clock labels', () => {
  const info = barInfo(bars(DAY, '09:30', 36), 1);
  const pad = sessionPad(info, { barMins: 1 });
  const axis = padInfo(info, pad, 1);
  assert.equal(axis.length, 36 + 85);
  assert.equal(axis[axis.length - 1].mins, 690);
  assert.ok(axis.slice(36).every((x) => x.empty && x.day === info[0].day));
  const labels = axisLabels(axis, 0, axis.length - 1, 900 / 120, { intraday: true }).map((l) => l.text);
  for (const t of ['10:30', '11:00']) assert.ok(labels.includes(t), `${t} in ${labels}`);
  assert.equal(padInfo(info, 0, 1), info, 'no pad, the same info');
});

// ---- 2. The previous close on the axis ------------------------------------------------

const model = (points, extra = {}) => ({
  points, info: barInfo(points, 1), full: [0, points.length - 1], style: 'line', pct: false, compare: [],
  refs: { prevClose: null }, flags: [], volume: false, intraday: true, fmtY: (v) => fmtNum(v, 0), bp: false, decimals: 0,
  label: 'S&P 500', ...extra,
});

test('PREV CLOSE: its value sits on the price axis, never over the bars', () => {
  const pts = bars(DAY, '09:30', 36, 1, 7684);
  const info = barInfo(pts, 1);
  const pad = sessionPad(info, { barMins: 1 });
  const m = model(pts, { full: [0, pts.length - 1 + pad], axisInfo: padInfo(info, pad, 1), refs: { prevClose: 7684.2 } });
  const { svg, geo } = svgFor(m, null, 900, 400);
  const W = geo.W;
  // The axis tag: right of the plot, the value in it.
  const tag = /<g class="ch-prev"><title>Previous close<\/title><rect class="ch-prev-bg" x="([\d.]+)"[^>]*\/><text class="ch-prev-t" x="([\d.]+)"[^>]*>7,684<\/text><\/g>/.exec(svg);
  assert.ok(tag, 'the prev close tag on the axis');
  assert.ok(Number(tag[1]) >= W && Number(tag[2]) > W);
  // The words: at the right end of the line, over the empty part of the 2-hour window.
  const words = /<rect class="ch-lab-bg" x="([\d.]+)"[^>]*\/><text class="ch-lab ch-ref-prev-lab" x="([\d.]+)"[^>]*>PREV CLOSE<\/text>/.exec(svg);
  assert.ok(words, 'the words PREV CLOSE');
  assert.ok(Number(words[1]) > geo.x(pts.length - 1), 'right of the last bar');
  assert.doesNotMatch(svg, /PREV CLOSE 7,684/, 'no long label at the left over the bars');
  // The last bar sits about 29% across, the axis runs on to 11:30.
  assert.ok(Math.abs(geo.x(pts.length - 1) / W - 35 / 120) < 0.01);
  assert.match(svg, />11:00</);
});

test('PREV CLOSE: a busy right edge keeps only the axis tag; the tag steps off the last value', () => {
  // Bars across the whole width, right on the previous close.
  const flat = Array.from({ length: 60 }, (_, k) => ({ t: ET(DAY, '09:30') + k * 60_000, v: 7684 + (k % 2 ? 0.3 : -0.3) }));
  const { svg } = svgFor(model(flat, { refs: { prevClose: 7684 } }), null, 700, 300);
  assert.match(svg, /class="ch-prev-t"/);
  assert.doesNotMatch(svg, /ch-ref-prev-lab/, 'no words over the bars');
  // The box finder: above the line when free, below when only that is free, else none.
  const g = { W: 500, py: 100, lw: 70, top: 8, bottom: 300 };
  assert.deepEqual(prevWordsBox(g, () => null), { x0: 428, y0: 85, x1: 498, y1: 98 });
  assert.equal(prevWordsBox(g, () => [80, 99]).y0, 102, 'below');
  assert.equal(prevWordsBox(g, () => [80, 130]), null);
  // The axis tag moves one tag height off the last value's tag.
  assert.equal(prevTagAt(200, 120), 200);
  assert.equal(prevTagAt(125, 120), 136);
  assert.equal(prevTagAt(115, 120), 104);
  // Always whole inside the plot: at the top it goes under the last tag instead.
  assert.equal(prevTagAt(2, 200, { top: 8, bottom: 300 }), 16);
  assert.equal(prevTagAt(12, 20, { top: 8, bottom: 300 }), 36, 'no room above the last tag: below it');
  assert.equal(prevTagAt(298, 290, { top: 8, bottom: 300 }), 274, 'no room below: above it');
  // The compare tags see it: in percent mode there is no prev close; a line chart's last
  // tag at the prev close line is stepped, never drawn over it.
  const pts = Array.from({ length: 30 }, (_, k) => ({ t: ET(DAY, '09:30') + k * 60_000, v: 100 + k / 10 }));
  const near = svgFor(model(pts, { refs: { prevClose: 102.95 } }), null, 600, 300).svg;
  const prevY = Number(/class="ch-prev-t" x="[\d.]+" y="([\d.]+)"/.exec(near)[1]) - 4;
  const lastY = Number(/class="ch-last-t" x="[\d.]+" y="([\d.]+)"/.exec(near)[1]) - 4;
  assert.ok(Math.abs(prevY - lastY) >= 15.99, `${prevY} vs ${lastY}`);
  assert.ok(prevY - 8 >= 8, 'inside the plot');
  assert.match(src('screens/chart-view.js'), /let usedY = showPrev \? \[prevTagY\] : \[\];/);
});

// ---- 3. Chart bars: chips in a panel, everything in FULL -----------------------------

test('chart bar: range chips only in a panel (HOME, DESK); the full bar when maximised or on its own screen', () => {
  assert.equal(chartBarMode({ panel: true }), 'chips');
  assert.equal(chartBarMode({ panel: true, maximised: true }), 'full');
  assert.equal(chartBarMode({}), 'full');
  const chart = src('screens/chart.js');
  assert.match(chart, /const panelOpt = Boolean\(opts\.panel \|\| ctx\.embed\);/, 'every chart in a DESK panel');
  assert.match(chart, /maximised: Boolean\(root\.closest\?\.\('\.panel\.is-max'\)\)/, 'the number key (a maximised panel) is FULL');
  // The chips-only bar: the range tabs, and none of the period menu, dates, LINE or + COMPARE.
  const chips = /if \(chipsOnly\(\)\) return `([^\n]+)`;/.exec(chart)[1];
  assert.match(chips, /ch-tabs/);
  assert.doesNotMatch(chips, /ch-per|ch-date|data-style-toggle|data-compare-add/);
  // It follows the panel as it is maximised and back.
  assert.match(chart, /if \(chipsOnly\(\) !== chipsWas\) \{ chipsWas = chipsOnly\(\); repaintBar\(\); \}/);
  assert.match(src('screens/home.js'), /hostCls: 'chart-host-home',[\s\S]{0,120}panel: true,/, 'HOME\'s chart is a panel');
});

// ---- 4. RT and DLY -------------------------------------------------------------------

const inst = (id, group, extra = {}) => ({ id, name: `${id} name`, group, kind: 'index', last: 100, change: 1, changePct: 1, decimals: 2, realTime: true, asOf: '2026-09-29T10:06:00-04:00', ...extra });

test('RT/DLY: no RT on any row; delayed rows keep a small DLY; the strip says it once', () => {
  assert.equal(delayTag({ realTime: true }), '');
  assert.match(delayTag({ realTime: false }), /class="fresh is-dly"[^>]*>DLY</);
  assert.equal(delayTag({}), '');
  const api = [inst('SPX', 'Americas'), inst('RUT', 'Americas', { realTime: false }), inst('DAX', 'Europe', { realTime: false }), inst('BTC', 'Crypto', { kind: 'crypto' })];
  const home = marketsColumns(homeMarkets(api), { chg: false, cls: 'mk-cols h-mk' });
  const full = marketsFull(marketsGroups(api));
  for (const html of [home, full]) {
    assert.doesNotMatch(html, />RT</);
    assert.equal((html.match(/>DLY</g) || []).length, 2);
  }
  assert.equal(LEGEND_TEXT, 'RT · DLY WHERE MARKED');
  assert.match(freshLegend(api), /class="fresh-legend"[^>]*>RT · DLY WHERE MARKED</);
  assert.equal(freshLegend(api.filter((m) => m.realTime)), '', 'no delayed row, no legend');
  // HOME paints it in the MARKETS strip, MARKETS in its meta, WATCH next to its count.
  assert.match(src('screens/home.js'), /const html = freshLegend\(rows\);/);
  assert.match(src('screens/markets-full.js'), /freshLegend\(rows\)/);
  assert.match(src('screens/watch.js'), /freshLegend\(list\.map/);
  const fx = fxTable([{ id: 'EURUSD', pair: 'EUR/USD', last: 1.1, change: 0, changePct: 0, decimals: 4, realTime: true }, { id: 'X', pair: 'X/Y', last: 1, change: 0, changePct: 0, decimals: 4, realTime: false }]);
  assert.doesNotMatch(fx, />RT</, 'HOME fxTable: no RT');
  assert.match(fx, />DLY</);
  const wl = watchTable([{ id: 'AAPL', quote: { ticker: 'AAPL', last: 1, change: 0, changePct: 0, realTime: true } }, { id: 'ES', quote: { ticker: 'ES', last: 1, change: 0, changePct: 0, realTime: false } }]);
  assert.doesNotMatch(wl, />RT</);
  assert.match(wl, />DLY</);
});

// ---- 5. MARKETS: HOME's groups at full size -----------------------------------------

// Every instrument /api/markets sends today, in its own order and groups.
const API = [
  ['SPX', 'Americas'], ['NDX', 'Americas'], ['DJI', 'Americas'], ['RUT', 'Americas'], ['SPXEW', 'Americas'], ['SOX', 'Americas'],
  ['DJTRANS', 'Americas'], ['VIX', 'Americas'], ['VXN', 'Americas'], ['SPFUT', 'US futures'], ['NDFUT', 'US futures'], ['DJFUT', 'US futures'],
  ['FTSE', 'Europe'], ['DAX', 'Europe'], ['STOXX50', 'Europe'], ['CAC40', 'Europe'], ['N225', 'Asia Pacific'], ['HSI', 'Asia Pacific'],
  ['SHANGHAI', 'Asia Pacific'], ['KOSPI', 'Asia Pacific'], ['NIFTY50', 'Asia Pacific'], ['ASX200', 'Asia Pacific'], ['SET', 'Asia Pacific'],
  ['GOLD', 'Commodities'], ['SILVER', 'Commodities'], ['WTI', 'Commodities'], ['BRENT', 'Commodities'], ['NATGAS', 'Commodities'],
  ['COPPER', 'Commodities'], ['WHEAT', 'Commodities'], ['GOLDFUT', 'Commodities'], ['SILVERFUT', 'Commodities'], ['BALTICDRY', 'Commodities'],
  ['BTC', 'Crypto'], ['ETH', 'Crypto'], ['BTCFUT', 'Crypto'], ['EURUSD', 'Currencies'], ['GBPUSD', 'Currencies'], ['USDJPY', 'Currencies'],
  ['USDCNY', 'Currencies'], ['USDCNH', 'Currencies'], ['DXY', 'Currencies'], ['US3M', 'Rates'], ['US2Y', 'Rates'], ['US10Y', 'Rates'],
  ['US30Y', 'Rates'], ['US2S10S', 'Rates'], ['MOVEINDEX', 'Rates'],
].map(([id, g]) => inst(id, g, { name: id === 'VXN' ? 'Nasdaq volatility (VXN)' : `${id} full name` }));

test('MARKETS: the same groups and sub-groups in the same order as HOME, every instrument once', () => {
  const rows = marketsGroups(API);
  assert.equal(rows.length, API.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, API.length);
  const seq = (list) => list.filter((x, i) => i === 0 || x !== list[i - 1]);
  assert.deepEqual(seq(rows.map((r) => r.group)), HOME_MARKETS.map((g) => g.name));
  assert.deepEqual(seq(rows.map((r) => `${r.group}/${r.sub}`)), HOME_MARKETS.flatMap((g) => g.rows.filter((r) => typeof r === 'string').map((s) => `${g.name}/${s}`)));
  // HOME's rows in HOME's order; the others in their place.
  const homeIds = HOME_MARKETS.flatMap((g) => g.rows.filter((r) => typeof r !== 'string').map(([id]) => id));
  assert.deepEqual(rows.map((r) => r.id).filter((id) => homeIds.includes(id)), homeIds);
  const after = (id) => rows[rows.findIndex((r) => r.id === id) - 1].id;
  assert.equal(after('VXN'), 'VIX');
  assert.equal(after('DJFUT'), 'NDFUT');
  assert.equal(after('GOLDFUT'), 'GOLD');
  assert.equal(after('SILVERFUT'), 'SILVER');
  const where = (id) => { const r = rows.find((x) => x.id === id); return `${r.group}/${r.sub}`; };
  assert.equal(where('SET'), 'World/Asia');
  assert.equal(where('BTCFUT'), 'Commodities + crypto/Crypto');
  assert.equal(where('USDCNY'), 'FX + rates/FX');
  assert.equal(where('MOVEINDEX'), 'FX + rates/Rates');
  // Full names on MARKETS (HOME keeps its short ones).
  assert.equal(rows.find((r) => r.id === 'VXN').name, 'Nasdaq volatility (VXN)');
  // A new instrument never goes missing: in its group's sub-group, or its own group at the end.
  const more = marketsGroups([...API, inst('IBEX', 'Europe'), inst('MOON', 'Space')]);
  assert.equal(more.find((r) => r.id === 'IBEX').sub, 'Europe');
  assert.deepEqual([more[more.length - 1].id, more[more.length - 1].group], ['MOON', 'Space']);
});

test('MARKETS columns: no column is headed by another group; blocks keep HOME order; 4 fields a row', () => {
  const rows = marketsGroups(API);
  for (const n of [1, 2, 3]) {
    const cols = packColumns(rows, n);
    assert.equal(cols.length, n);
    assert.deepEqual(cols.flat().flatMap((u) => u.rows.map((r) => r.id)), rows.map((r) => r.id), 'column-major, HOME order');
    for (const col of cols) {
      assert.equal(col[0].head, true, 'a column opens with its own group title');
      col.forEach((u, i) => { if (i > 0 && col[i - 1].group !== u.group) assert.equal(u.head, true, `${u.group} gets its own title`); });
    }
  }
  // Three columns come out about even (heights in rows: never one twice another).
  const h = packColumns(rows, 3).map((col) => col.reduce((s, u) => s + u.rows.length + 1 + (u.head ? 1 : 0), 0));
  assert.ok(Math.max(...h) - Math.min(...h) <= 4, `balanced ${h}`);
  // Rendered: every column opens with a group title bar naming the group of its rows.
  const html = marketsFull(rows, { n: 3 });
  for (const col of html.split('<div class="mk-col">').slice(1)) {
    const first = /<tr class="group-row"><th colspan="5" scope="rowgroup">([^<]+)</.exec(col);
    assert.ok(first && col.indexOf(first[0]) === col.indexOf('<tr'), 'the first bar is a group title');
    const firstRow = /data-cmd="([^"]+)"/.exec(col)[1];
    assert.equal(first[1].replace('&amp;', '&'), rows.find((r) => r.id === firstRow).group);
  }
  // Per row: the name, then last, chg and %; the DLY mark is the only other cell. No time.
  const rowHtml = html.split('<tr class="row-link"').slice(1);
  assert.equal(rowHtml.length, API.length);
  for (const r of rowHtml) {
    assert.equal((r.match(/<th scope="row" class="name">/g) || []).length, 1);
    assert.deepEqual([...r.matchAll(/<td class="num (\w+)/g)].map((m) => m[1]), ['last', 'chg', 'pct']);
    assert.doesNotMatch(r, /class="num time/);
  }
  assert.deepEqual([...marketsFull(rows, { n: 1, chg: false }).split('<tr class="row-link"')[1].matchAll(/<td class="num (\w+)/g)].map((m) => m[1]), ['last', 'pct'], 'no room: Chg goes first');
});

test('MARKETS: a row not traded today (New York) shows its day after the name; today shows nothing', () => {
  const now = Date.parse('2026-09-29T10:06:00-04:00'); // a Tuesday
  assert.equal(staleDay('2026-09-29T02:45:00-04:00', now), '', 'Nikkei traded this morning');
  assert.equal(staleDay('2026-09-28T16:00:00-04:00', now), 'Mon');
  assert.equal(staleDay('2026-09-26', now), 'Sat');
  assert.equal(staleDay('2026-09-25T16:00:00-04:00', now), 'Fri');
  assert.equal(staleDay('2026-09-10', now), 'Sep 10');
  assert.equal(staleDay('2026-09-29T01:00:00Z', now), 'Mon', 'the New York day, not UTC');
  assert.equal(staleDay(null, now), '');
  const rows = marketsGroups([inst('SPX', 'Americas'), inst('BALTICDRY', 'Commodities', { asOf: '2026-09-28', name: 'Baltic Dry Index' })]);
  const html = marketsFull(rows, { n: 1, now });
  assert.match(html, /Baltic Dry Index<\/a> <span class="mk-day dim">Mon<\/span><\/th>/);
  assert.equal((html.match(/mk-day/g) || []).length, 1, 'SPX traded today: no mark');
  // The mark counts in the name column's width.
  assert.equal(nameChars(rows, now), 'Baltic Dry Index Mon'.length);
});

test('MARKETS widths: no name is cut at 1440x900 or 1536x730; a narrow panel drops Chg, then wraps', () => {
  const rows = marketsGroups(API);
  const ch = 13 * 0.6; // the table's monospace character at 13px
  // One column: the widest name + its 20px padding + the 34px DLY mark + last 11ch + chg 9ch + % 9ch (style.css .mk-probe).
  const colPx = (chg) => Math.ceil((nameChars(rows) + 11 + (chg ? 9 : 0) + 9) * ch + 20 + 34);
  assert.equal(nameChars(rows), 'Nasdaq volatility (VXN)'.length);
  // The panel body's inner width with real scrollbars at 1440 and 1536 (see the screenshots).
  for (const [w, body] of [[1440, 1384], [1536, 1408]]) {
    const fit = marketsFit(body, colPx);
    assert.deepEqual([fit.n, fit.chg, fit.wrap], [3, true, false], `${w}: three columns`);
    const colW = (body - (fit.n - 1)) / fit.n;
    const nameW = colW - (11 + 9 + 9) * ch - 20 - 34;
    assert.ok(nameW >= nameChars(rows) * ch, `${w}: the name column holds the longest name`);
  }
  assert.equal(marketsFit(1000, colPx).n, 2);
  assert.deepEqual(marketsFit(400, colPx), { n: 1, chg: false, wrap: false });
  assert.deepEqual(marketsFit(340, colPx), { n: 1, chg: false, wrap: true });
  const css = src('style.css');
  assert.match(css, /\.mk-full \.mk-group \.name \{ max-width: none; overflow: visible; text-overflow: clip; \}/, 'never an ellipsis');
  assert.match(css, /\.view > \.panel\.mk-panel:not\(\[hidden\]\) \{ flex: 0 1 auto !important;/, 'the panel ends where the table ends');
});

// ---- The one-line range header in a DESK panel ----------------------------------------

test('DESK panel: the quote ranges are one line, never a number stacked over its dash', () => {
  const vix = { kind: 'index', decimals: 2, last: 15.84, low: 15.73, high: 16.19, low52: 13.38, high52: 35.3 };
  const html = rangeLine(vix);
  assert.equal(html.replace(/<[^>]+>/g, ''), 'day 15.73 to 16.19 · 52w 13.38 to 35.30');
  assert.doesNotMatch(html, / - /);
  assert.equal((html.match(/class="q-rg"/g) || []).length, 2, 'each part stays whole (nowrap)');
  assert.equal(rangeLine({ kind: 'stock', decimals: 2, low52: 100, high52: 200 }).replace(/<[^>]+>/g, ''), '52w 100.00 to 200.00');
  assert.equal(rangeLine({ kind: 'fx', decimals: 4 }), '');
  assert.match(rangeLine({ kind: 'yield', decimals: 3, low: 4.1, high: 4.2 }), /4\.100% to 4\.200%/);
  // The 52W qualifier stays in the one line.
  assert.match(rangeLine({ ...vix, range52Basis: 'daily closes' }), /52w \(closes\)<\/span> 13\.38 to 35\.30/);
  assert.match(rangeLine({ ...vix, decimals: 4, last: 1.15, low52: 1.13, high52: 1.21, range52Dp: 2 }), /52w \(rounded\)<\/span> 1\.13 to 1\.21/);
  // The panel keeps the grid (Mkt cap, P/E, Open, Prev close...); only the Day range and
  // 52W cells give way to the line.
  const css = src('screens/quote.css');
  assert.doesNotMatch(css, /\.is-embed \.q-top \.stats \{ display: none; \}/, 'the grid stays in a panel');
  assert.match(css, /\.is-embed \.q-top \.stat-range \{ display: none; \}/);
  assert.match(css, /\.is-embed \.q-ranges \{ display: block;/);
  assert.match(css, /\.q-ranges \{ display: none; \}/, 'the full screen keeps its range cells');
  const q = src('screens/quote.js');
  assert.match(q, /const isRange = \(k\) => k === 'Day range' \|\| k\.startsWith\('52W'\);/);
});

// ---- The heatmap ----------------------------------------------------------------------

test('heatmap: about 70% of the old saturation, green up and red down', () => {
  assert.equal(HEAT_SAT, 0.7);
  const sat = (c) => Number(/hsl\(\d+, (\d+)%/.exec(c)[1]);
  assert.equal(sat(heatFill(3)), Math.round(62 * 0.7));
  assert.equal(sat(heatFill(-3)), Math.round(74 * 0.7));
  assert.ok(sat(heatFill(-3)) <= 52 && sat(heatFill(3)) <= 44);
  assert.match(heatFill(1), /^hsl\(147,/);
  assert.match(heatFill(-1), /^hsl\(0,/);
});
