import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCache } from '../data/cache.js';
import { parseContract, parseChain, pickExpiry, daysTo, cboeTime, makeOptions, OptionsError } from '../data/options.js';
import { parseFredCsv, transform, summarize, seriesById, sliceRange, makeEconomy, SERIES } from '../data/economy.js';
import { impliedRate, contractMonthOf, parseFedFutures, bpBetween, makeFedPath, FF_SYMBOLS } from '../data/fedpath.js';
import { countBreadth, sectorBreadth, makeBreadth } from '../data/breadth.js';
import { buildGrid, GRID_CELLS, makeBonds } from '../data/bonds.js';
import { liveRates, crossRates, makeFxMatrix } from '../data/fxmatrix.js';
import { parseCommand, suggest, COMMANDS, tickerFunctions, FUNCTION_BAR } from '../public/app.js';
import { MARKETS_EXTRA, matchMarkets } from '../public/commands-markets.js';
import { findCommand } from '../public/registry.js';
import { parse as parseOptions, chainWindow, inTheMoney, fmtIv, expiryLabel, chainTable } from '../public/screens/options.js';
import { parse as parseEconomy, fmtValue, periodLabel, sparkSvg } from '../public/screens/economy.js';
import { monthLabel, stepPoints } from '../public/screens/fedpath.js';
import { splitBar, adRatio, fmtShares } from '../public/screens/breadth.js';
import { parse as parseBonds, spreadBp, spreadChangeBp, bondFigures, yieldsTable, spreadsTable, curveTable } from '../public/screens/bonds.js';
import { parse as parseFxm, heatBucket, HEAT_BUCKETS, heatLegend, matrixTable } from '../public/screens/fxmatrix.js';
import { INSTRUMENTS, BOND_GRID, instrumentById, resolveInstrument } from '../public/instruments.js';
import { WORLD } from '../data/world.js';
import { COMMODITIES } from '../data/commodities.js';
import { EXCHANGES } from '../public/screens/clock.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

function res(body, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ---- OPTIONS: Cboe parser ------------------------------------------------------

const opt = (option, extra = {}) => ({ option, bid: 1, ask: 1.2, last_trade_price: 1.1, volume: 10, open_interest: 100, iv: 0.25, delta: 0.5, ...extra });
const CBOE = {
  timestamp: '2026-09-25 15:26:53',
  symbol: 'AAPL',
  data: {
    current_price: 337, price_change: 1.08, price_change_percent: 0.3215, prev_day_close: 335.92, iv30: 23.079,
    options: [
      opt('AAPL261016C00340000', { delta: 0.45 }), opt('AAPL261016P00340000', { delta: -0.55 }),
      opt('AAPL261016C00330000'), opt('AAPL261016P00330000', { iv: 0, last_trade_price: 0 }),
      opt('AAPL260925C00337500'),
      opt('AAPL1261016C00100000'), // adjusted contract: left out
      opt('SPX261016C07000000'), opt('SPXW261016C07000000'),
      opt('JUNK'),
    ],
  },
};

test('Cboe: contract symbols, time stamps, days to expiry', () => {
  assert.deepEqual(parseContract('AAPL261016C00150000'), { root: 'AAPL', expiry: '2026-10-16', type: 'C', strike: 150 });
  assert.deepEqual(parseContract('SPXW261016P07012500'), { root: 'SPXW', expiry: '2026-10-16', type: 'P', strike: 7012.5 });
  assert.equal(parseContract('AAPL1261016C00100000').root, 'AAPL1');
  assert.equal(parseContract('nope'), null);
  assert.equal(cboeTime('2026-09-25 15:26:53'), '2026-09-25T15:26:53Z');
  assert.equal(cboeTime(''), null);
  assert.equal(daysTo('2026-10-16', '2026-09-25'), 21);
  assert.equal(daysTo('2026-09-25', '2026-09-25'), 0);
});

test('Cboe: the chain groups by expiry and root, strikes in order, 0 IV is missing', () => {
  const c = parseChain(CBOE);
  assert.equal(c.asOf, '2026-09-25T15:26:53Z');
  assert.deepEqual(c.underlying, { price: 337, change: 1.08, changePct: 0.3215, prevClose: 335.92, iv30: 23.079 });
  assert.deepEqual(c.expiries.map((e) => e.id), ['2026-09-25', '2026-10-16-AAPL', '2026-10-16-SPX', '2026-10-16-SPXW']);
  const oct = c.expiries.find((e) => e.id === '2026-10-16-AAPL');
  assert.deepEqual(oct.rows.map((r) => r.strike), [330, 340]);
  assert.equal(oct.rows[0].put.iv, null, 'Cboe 0 IV means no value');
  assert.equal(oct.rows[0].put.last, null);
  assert.equal(oct.rows[1].call.delta, 0.45);
  assert.equal(oct.rows[1].put.oi, 100);
  assert.ok(!c.expiries.some((e) => e.root === 'AAPL1'), 'adjusted roots are left out');
  assert.equal(c.expiries[0].rows[0].put, null, 'a strike with only a call has no put');
  assert.throws(() => parseChain({}), /unexpected shape/);
});

test('Cboe: nearest expiry by default, or the one asked for', () => {
  const ex = [{ id: '2026-09-18', date: '2026-09-18' }, { id: '2026-09-25', date: '2026-09-25' }, { id: '2026-10-16', date: '2026-10-16' }];
  assert.equal(pickExpiry(ex, null, '2026-09-25').id, '2026-09-25');
  assert.equal(pickExpiry(ex, null, '2026-09-26').id, '2026-10-16');
  assert.equal(pickExpiry(ex, '2026-10-16', '2026-09-25').id, '2026-10-16');
  assert.equal(pickExpiry(ex, '2027-01-15', '2026-09-25'), null);
});

test('Cboe: options service, unknown symbols and stale-if-error', async () => {
  let t = 0;
  let mode = 'ok';
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (mode === 'ok') return res(CBOE);
    if (mode === '403') return res('<Error/>', 403);
    return res({}, 500);
  };
  const { getOptions } = makeOptions({ fetchImpl, cache: createCache({ now: () => t, retryMs: 1000 }), now: () => Date.parse('2026-09-25T15:30:00Z') });
  const a = await getOptions('aapl');
  assert.equal(a.symbol, 'AAPL');
  assert.equal(a.expiry.id, '2026-09-25');
  assert.equal(a.expiry.days, 0);
  assert.equal(a.source, 'Cboe delayed quotes');
  assert.equal(a.stale, false);
  const b = await getOptions('AAPL', '2026-10-16-AAPL');
  assert.deepEqual(b.rows.map((r) => r.strike), [330, 340]);
  await assert.rejects(getOptions('AAPL', '2030-01-18'), (e) => e instanceof OptionsError && e.code === 'no_expiry');
  await assert.rejects(getOptions('not a ticker'), (e) => e.code === 'bad_symbol');
  await getOptions('SPX');
  assert.match(urls.at(-1), /options\/_SPX\.json$/, 'indexes use the underscore symbol');
  mode = '403';
  await assert.rejects(getOptions('ZZZZQ'), (e) => e.code === 'not_found');
  mode = 'fail';
  t = 10 * 60_000;
  const c = await getOptions('AAPL');
  assert.equal(c.stale, true, 'an outage serves the last chain');
});

// ---- ECONOMY: FRED CSV ------------------------------------------------------------

const CSV = 'observation_date,CPIAUCNS\n2024-12-01,100\n2025-01-01,101\n2025-02-01,.\n2025-03-01,102\n2025-12-01,103\n2026-01-01,104\n2026-02-01,105\n2026-03-01,105.5\n';

test('FRED CSV: dates and values, "." is a gap, header checked', () => {
  const obs = parseFredCsv(CSV);
  assert.equal(obs.length, 7);
  assert.deepEqual(obs[0], { date: '2024-12-01', value: 100 });
  assert.ok(!obs.some((o) => o.date === '2025-02-01'));
  assert.throws(() => parseFredCsv('<html>'), /unexpected header/);
  assert.throws(() => parseFredCsv('observation_date,X\n2026-01-01,.\n'), /no observations/);
  assert.deepEqual(parseFredCsv('observation_date,X\r\n2026-01-01,4.1\r\n'), [{ date: '2026-01-01', value: 4.1 }]);
});

test('FRED maths: year on year, month on month and change, never across a gap', () => {
  const obs = parseFredCsv(CSV);
  const yoy = transform(obs, 'yoy');
  assert.deepEqual(yoy.map((p) => p.date), ['2025-12-01', '2026-01-01', '2026-03-01']);
  close(yoy[0].value, 3);
  close(yoy[1].value, (104 / 101 - 1) * 100);
  close(yoy[2].value, (105.5 / 102 - 1) * 100);
  const mom = transform(obs, 'mom');
  assert.ok(!mom.some((p) => p.date === '2025-03-01'), 'February is missing, so March has no MoM');
  close(mom.find((p) => p.date === '2026-01-01').value, (104 / 103 - 1) * 100);
  const diff = transform([{ date: '2026-07-01', value: 158913 }, { date: '2026-08-01', value: 159075 }], 'diff');
  assert.deepEqual(diff, [{ date: '2026-08-01', value: 162 }]);
  assert.deepEqual(transform(obs, 'level'), obs);
});

test('FRED: latest, previous, a two-year sparkline and chart ranges', () => {
  const pts = [{ date: '2023-01-01', value: 1 }, { date: '2024-10-01', value: 2 }, { date: '2026-08-01', value: 3 }];
  const s = summarize(pts, '2026-09-25');
  assert.deepEqual(s, { date: '2026-08-01', value: 3, prevDate: '2024-10-01', prev: 2, spark: [2, 3] });
  assert.equal(summarize([], '2026-09-25').value, null);
  assert.deepEqual(sliceRange(pts, '5Y', '2026-09-25').map((p) => p.value), [1, 2, 3]);
  assert.deepEqual(sliceRange(pts, 'MAX', '2026-09-25').length, 3);
  assert.equal(seriesById('payems').id, 'PAYROLLS');
  assert.equal(seriesById('UNRATE').fred, 'UNRATE');
  assert.equal(seriesById('nope'), null);
  assert.equal(SERIES.length, 10);
});

test('FRED: plain user agent, one retry, a failed series shows as missing', async () => {
  const seen = [];
  let flaky = 1;
  const fetchImpl = async (url, opts) => {
    seen.push(opts.headers['User-Agent']);
    if (url.includes('UMCSENT')) return res('', 500);
    if (url.includes('UNRATE') && flaky-- > 0) throw new Error('socket hang up');
    return res('observation_date,X\n2026-07-01,4.1\n2026-08-01,4.2\n');
  };
  const { getEconomy, getEconomySeries } = makeEconomy({ fetchImpl, today: () => '2026-09-25' });
  const d = await getEconomy();
  assert.ok(seen.every((ua) => ua === 'Bloombroke/1.0'), 'FRED gets a plain user agent');
  const un = d.series.find((s) => s.id === 'UNRATE');
  assert.equal(un.value, 4.2, 'the retry recovered');
  assert.equal(un.prev, 4.1);
  const um = d.series.find((s) => s.id === 'SENTIMENT');
  assert.equal(um.missing, true);
  assert.equal(um.value, null);
  assert.equal(d.stale, true);
  const one = await getEconomySeries('UNRATE', '10Y');
  assert.equal(one.points.length, 2);
  assert.equal(one.spark, undefined);
  await assert.rejects(getEconomySeries('NOPE'), (e) => e.code === 'not_found');
});

// ---- FEDPATH: futures maths ---------------------------------------------------------

test('Fed funds futures: 100 minus the price, contract month, bp against the effective rate', () => {
  assert.equal(impliedRate(96.105), 3.895);
  assert.equal(impliedRate(96.2525), 3.7475);
  assert.equal(impliedRate(NaN), null);
  assert.equal(contractMonthOf({ expiration_date: '2026-10-30' }), '2026-10');
  assert.equal(contractMonthOf({ name: "Fed Funds 30-Day Future (Jan'27)" }), '2027-01');
  assert.equal(contractMonthOf({ name: 'nothing' }), null);
  assert.equal(bpBetween(3.895, 3.88), 1.5);
  assert.equal(bpBetween(4.045, 3.88), 16.5);
  assert.equal(bpBetween(3.9, null), null);
  const rows = parseFedFutures([
    { symbol: '@FF.2', code: 0, last: '96.105', change: 'UNCH', expiration_date: '2026-10-30', realTime: 'false' },
    { symbol: '@FF.1', code: 0, last: '96.2525', change: '+0.005', expiration_date: '2026-09-30' },
    { symbol: '@FF.3', code: 1 },
    { symbol: '@FF.4', code: 0, last: '', expiration_date: '2026-12-31' },
  ]);
  assert.deepEqual(rows.map((r) => [r.month, r.implied, r.change]), [['2026-09', 3.7475, 0.005], ['2026-10', 3.895, 0]]);
  assert.equal(FF_SYMBOLS.length, 18, 'every contract the source lists (16 on 2026-09-25), the rest answer unknown');
});

test('FEDPATH: joins the futures with the New York Fed target range', async () => {
  const quote = (i, month, last) => ({ symbol: `@FF.${i}`, code: 0, last, change: '0', expiration_date: `${month}-28` });
  const fetchImpl = async () => res({ FormattedQuoteResult: { FormattedQuote: [quote(1, '2026-09', '96.25'), quote(2, '2026-10', '96.10'), quote(3, '2026-11', '95.95')] } });
  const rates = async () => ({ fed: { from: 3.75, to: 4, effective: 3.88, date: '2026-09-24' }, stale: false });
  const d = await makeFedPath({ fetchImpl, rates }).getFedPath();
  assert.deepEqual(d.months.map((m) => m.vsEffective), [-13, 2, 17]);
  assert.equal(d.fed.to, 4);
  const noFed = await makeFedPath({ fetchImpl, rates: async () => { throw new Error('down'); } }).getFedPath();
  assert.equal(noFed.fed, null);
  assert.equal(noFed.months[0].vsEffective, null);
});

// ---- BREADTH --------------------------------------------------------------------------

test('breadth: counts up, down and unchanged; missing changes are not counted', () => {
  const b = countBreadth([
    { netchange: '7.52', volume: '100' }, { netchange: '-0.09', volume: '50' }, { netchange: '0.00', volume: '5' },
    { netchange: '', volume: '9' }, { netchange: 'NA' }, { netchange: '1', volume: '' },
  ]);
  assert.deepEqual({ ...b, upPct: undefined }, { up: 2, down: 1, unchanged: 1, noData: 2, upVolume: 100, downVolume: 50, total: 4, upPct: undefined });
  close(b.upPct, 50);
  assert.equal(countBreadth([]).upPct, null);
  const s = sectorBreadth([
    { sector: 'TECH', changePct: 1 }, { sector: 'TECH', changePct: -1 }, { sector: 'TECH', changePct: 2 },
    { sector: 'UTIL', changePct: 0 }, { sector: 'UTIL', changePct: NaN },
  ], { TECH: 'Information Technology', UTIL: 'Utilities' });
  assert.deepEqual(s.map((x) => [x.name, x.up, x.down, x.unchanged, x.total]), [['Information Technology', 2, 1, 0, 3], ['Utilities', 0, 0, 1, 1]]);
  close(s[0].upPct, 200 / 3);
  assert.equal(adRatio(3, 2), 1.5);
  assert.equal(adRatio(3, 0), null);
  assert.equal(fmtShares(1.91e9), '1.91B');
  assert.equal(fmtShares(236e6), '236M');
  assert.match(splitBar(2, 1, 1), /width="50.00"/);
  assert.equal(splitBar(0, 0, 0), '');
});

test('BREADTH: one exchange down still shows the rest', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('exchange=amex')) return res({}, 500);
    if (url.includes('limit=1')) return res({ data: { asof: 'Last price as of Sep 24, 2026' } });
    return res({ data: { rows: [{ netchange: '1' }, { netchange: '-1' }] } });
  };
  const heatmap = async () => ({ stocks: [{ sector: 'TECH', changePct: 1 }], sectors: { TECH: 'Information Technology' }, asOfList: '2026-09-21', stale: false, updated: '2026-09-25T15:00:00.000Z' });
  const d = await makeBreadth({ fetchImpl, heatmap }).getBreadth();
  assert.equal(d.sessionDate, '2026-09-24');
  assert.equal(d.exchanges[0].up, 1);
  assert.equal(d.exchanges[2].missing, true);
  assert.equal(d.sp100.up, 1);
  assert.equal(d.stale, true);
});

// ---- BONDS: grid and spread maths ------------------------------------------------------

test('bond spreads: basis points and their change', () => {
  assert.equal(spreadBp(5.211, 3.6234), 158.8);
  assert.equal(spreadBp(3.976, 5.2), -122.4);
  assert.equal(spreadBp(4, null), null);
  assert.equal(spreadChangeBp(0.049, 0.0125), 3.7);
  assert.equal(spreadChangeBp(-0.012, 0.038), -5);
  const cell = (id, last, change) => ({ id, cmd: id, last, change, asOf: null, realTime: true });
  const grid = [
    { cc: 'US', name: 'United States', region: 'Americas', cells: { '2Y': cell('US2Y', 4.9, 0), '5Y': null, '10Y': cell('US10Y', 5.2, 0.05), '30Y': null } },
    { cc: 'DE', name: 'Germany', region: 'Europe', cells: { '2Y': cell('DE2Y', 3.3, 0.01), '5Y': null, '10Y': cell('DE10Y', 3.6, 0.02), '30Y': null } },
    { cc: 'JP', name: 'Japan', region: 'Asia-Pacific', cells: { '2Y': null, '5Y': null, '10Y': cell('JP10Y', 3.1, 0), '30Y': null } },
  ];
  const f = bondFigures(grid);
  assert.equal(f[0].vsUs, null);
  assert.equal(f[0].vsDe, 160);
  assert.equal(f[0].vsDeChg, 3);
  assert.equal(f[1].vsUs, -160);
  assert.equal(f[1].curve, 30);
  assert.equal(f[1].curveChg, 1);
  assert.equal(f[2].curve, null, 'no 2Y, no curve');
  const y = yieldsTable(grid, ['2Y', '5Y', '10Y', '30Y']);
  assert.match(y, /data-cmd="DE2Y"/);
  assert.match(y, /Asia-Pacific/);
  assert.match(spreadsTable(f), /−160\.0/);
  assert.match(curveTable(f), /NORMAL/);
  assert.match(curveTable(bondFigures([{ ...grid[1], cells: { ...grid[1].cells, '10Y': cell('DE10Y', 3.2, 0) } }])), /INVERTED/);
  assert.deepEqual(parseBonds([]), { tab: 'YIELDS' });
  assert.deepEqual(parseBonds(['CURVE']), { tab: 'CURVE' });
  assert.equal(parseBonds(['NOPE']).error, 'usage');
});

test('bond grid: every cell is a known yield, missing maturities are null', async () => {
  for (const c of GRID_CELLS) assert.equal(instrumentById(c.id)?.kind, 'yield', `${c.id} opens a yield screen`);
  assert.equal(new Set(GRID_CELLS.map((c) => c.id)).size, GRID_CELLS.length);
  for (const b of BOND_GRID) assert.ok(['Americas', 'Europe', 'Asia-Pacific'].includes(b.region), b.cc);
  const g = buildGrid([{ id: 'MX10Y', cmd: 'MX10Y', last: 9.4, change: 0.04 }]);
  const mx = g.find((r) => r.cc === 'MX');
  assert.equal(mx.cells['10Y'].last, 9.4);
  assert.equal(mx.cells['2Y'], null);
  const rows = GRID_CELLS.map((c) => ({ symbol: c.src, code: 0, last: '4.5%', change: '+0.01' }));
  const d = await makeBonds({ fetchImpl: async () => res({ FormattedQuoteResult: { FormattedQuote: rows } }) }).getBonds();
  assert.equal(d.grid.length, BOND_GRID.length);
  assert.equal(d.bonds.length, 10, 'the 10Y list stays');
  assert.deepEqual(d.terms, ['2Y', '5Y', '10Y', '30Y']);
});

// ---- FXMATRIX heat -----------------------------------------------------------------------

test('FX live: XXX/USD quotes are inverted, the previous close is last minus change', () => {
  const q = (symbol, last, change) => ({ symbol, code: 0, last, change, realTime: 'true', last_time: '2026-09-25T11:29:00.000-0400' });
  const rows = [q('EUR=', '1.25', '+0.05'), q('GBP=', '1.25', '0'), q('AUD=', '0.5', '0'), q('JPY=', '150', '-1.5'), q('CHF=', '0.8', '0'), q('CAD=', '1.4', '0'), q('CNY=', '7', '0'), q('THB=', '33', 'UNCH')];
  const l = liveRates(rows);
  close(l.rates.EUR, 0.8);
  close(l.prevRates.EUR, 1 / 1.2);
  close(l.rates.JPY, 150);
  close(l.prevRates.JPY, 151.5);
  assert.equal(l.prevRates.THB, null, 'UNCH with no daily closes: the move is unknown, not 0');
  assert.equal(l.realTime, true);
  const m = crossRates(l.rates);
  close(m.EUR.JPY, 187.5);
  assert.equal(liveRates(rows.slice(1)), null, 'one missing currency: no live matrix');
});

test('FX heat: buckets, legend and a DAILY fallback when live quotes fail', async () => {
  assert.equal(heatBucket(-1.2), 'hx-d3');
  assert.equal(heatBucket(-1), 'hx-d3');
  assert.equal(heatBucket(-0.5), 'hx-d2');
  assert.equal(heatBucket(-0.1), 'hx-d1');
  assert.equal(heatBucket(-0.05), 'hx-0');
  assert.equal(heatBucket(0), 'hx-0');
  assert.equal(heatBucket(0.1), 'hx-u1');
  assert.equal(heatBucket(0.5), 'hx-u2');
  assert.equal(heatBucket(1), 'hx-u3');
  assert.equal(heatBucket(null), 'hx-na');
  assert.equal(HEAT_BUCKETS.length, 7);
  assert.equal((heatLegend().match(/<li>/g) || []).length, 7);
  const now = crossRates({ EUR: 0.8, JPY: 160 }, ['USD', 'EUR', 'JPY']);
  const prev = crossRates({ EUR: 0.8, JPY: 150 }, ['USD', 'EUR', 'JPY']);
  const html = matrixTable({ codes: ['USD', 'EUR', 'JPY'], matrix: now, prev }, { heat: true });
  assert.match(html, /hx hx-u3/);
  assert.match(html, /\+6\.67%/);
  assert.deepEqual(parseFxm([]), { mode: 'RATES' });
  assert.deepEqual(parseFxm(['HEAT']), { mode: 'HEAT' });
  const fetchImpl = async (url) => (url.includes('frankfurter')
    ? res({ rates: { '2026-09-23': { EUR: 0.8 }, '2026-09-24': { EUR: 0.81 } } })
    : res({}, 500));
  const d = await makeFxMatrix({ fetchImpl }).getFxMatrix();
  assert.equal(d.live, null);
  assert.equal(d.date, '2026-09-24');
});

// ---- Commands, help and instruments ---------------------------------------------------

test('router: the new commands parse, keep a clean URL, and sit in HELP', () => {
  assert.deepEqual(parseCommand('options aapl').args, { ticker: 'AAPL', expiry: null });
  assert.equal(parseCommand('options aapl').input, 'OPTIONS AAPL');
  const fn = parseCommand('AAPL OPTIONS');
  assert.equal(fn.name, 'OPTIONS');
  assert.equal(fn.input, 'OPTIONS AAPL');
  assert.equal(parseCommand('AAPL OPTIONS 2026-10-16').args.expiry, '2026-10-16');
  assert.equal(parseCommand('OPTIONS S&P 500').input, 'OPTIONS SPX');
  assert.equal(parseCommand('OPTIONS SPX 2026-10-16-SPXW').args.expiry, '2026-10-16-SPXW');
  assert.equal(parseCommand('OPTIONS GOLD').error, 'kind');
  assert.equal(parseCommand('OPTIONS').error, 'usage');
  assert.equal(parseCommand('OPTIONS AAPL SOON').error, 'expiry');
  assert.equal(parseCommand('ECONOMY').name, 'ECONOMY');
  assert.deepEqual(parseCommand('economy unrate 5y').args, { id: 'UNRATE', range: '5Y' });
  assert.equal(parseCommand('ECONOMY UNRATE 3Y').error, 'range');
  assert.equal(parseCommand('FEDPATH').name, 'FEDPATH');
  assert.equal(parseCommand('BREADTH').name, 'BREADTH');
  assert.equal(parseCommand('BONDS SPREADS').input, 'BONDS SPREADS');
  assert.equal(parseCommand('FXMATRIX HEAT').args.mode, 'HEAT');
  assert.equal(matchMarkets('NOPE', []), null);
  for (const c of MARKETS_EXTRA) {
    const h = findCommand(c.name);
    assert.ok(h && COMMANDS.some((x) => x.name === c.name && x.hint === h.summary), `${c.name} is in HELP`);
    for (const e of h.examples) assert.equal(parseCommand(e).error, undefined, `${e} parses`);
  }
  assert.equal(suggest('OPTIONS ')[0].usage, true);
  assert.equal(suggest('OPT')[0].value, 'OPTIONS ');
  assert.equal(FUNCTION_BAR.indexOf('OPTIONS'), 6, 'OPTIONS is key 7 on the stock function bar');
  assert.equal(tickerFunctions('AAPL').find((f) => f.fn === 'OPTIONS').ready, true);
});

test('OPTIONS screen: strikes around the price, in the money, labels', () => {
  const rows = [100, 105, 110, 115, 120, 125, 130].map((strike) => ({ strike, call: { bid: 1 }, put: { bid: 2 } }));
  const w = chainWindow(rows, 112, 2);
  assert.deepEqual(w.rows.map((r) => r.strike), [105, 110, 115, 120]);
  assert.equal(w.priceAt, 2, 'the price line goes before 115');
  assert.equal(chainWindow(rows, 112, 0).rows.length, 7);
  assert.equal(chainWindow(rows, 500, 2).priceAt, 2, 'above every strike: the line goes last');
  assert.equal(inTheMoney('call', 100, 112), true);
  assert.equal(inTheMoney('call', 115, 112), false);
  assert.equal(inTheMoney('put', 115, 112), true);
  assert.equal(inTheMoney('put', null, 112), false);
  assert.equal(fmtIv(0.2308), '23.1%');
  assert.equal(fmtIv(null), '--');
  assert.equal(expiryLabel({ id: '2026-10-16', date: '2026-10-16', root: 'AAPL' }, 2026), 'OCT 16');
  assert.equal(expiryLabel({ id: '2027-01-15', date: '2027-01-15', root: 'AAPL' }, 2026), "JAN 15 '27");
  assert.equal(expiryLabel({ id: '2026-10-16-SPXW', date: '2026-10-16', root: 'SPXW' }, 2026), 'OCT 16 SPXW');
  const html = chainTable(rows, 112, 'XYZ', 2);
  assert.match(html, /XYZ 112\.00/);
  assert.equal((html.match(/ itm/g) || []).length, 2 * 7 + 2 * 7, 'two calls and two puts are in the money');
  assert.deepEqual(parseOptions(['AAPL', 'FOR', '2026-10-16']), { ticker: 'AAPL', expiry: '2026-10-16' });
});

test('ECONOMY and FEDPATH screens: units, periods, lines', () => {
  assert.equal(fmtValue(4.1, 'pct'), '4.1%');
  assert.equal(fmtValue(162, 'k'), '+162K');
  assert.equal(fmtValue(197000, 'count'), '197K');
  assert.equal(fmtValue(0.31, 'bp'), '+31 bp');
  assert.equal(fmtValue(51.7, 'index'), '51.7');
  assert.equal(fmtValue(null, 'pct'), '--');
  assert.equal(periodLabel('2026-04-01', 'Q'), 'Q2 2026');
  assert.equal(periodLabel('2026-08-01', 'M'), 'AUG 2026');
  assert.equal(periodLabel('2026-09-19', 'W'), 'SEP 19 2026');
  assert.match(sparkSvg([1, 2, 3]), /<polyline points="1\.0,17\.0 48\.0,9\.0 95\.0,1\.0"\/>/);
  assert.match(sparkSvg([1]), /--/);
  assert.deepEqual(parseEconomy([]), { id: null });
  assert.equal(monthLabel('2026-10'), 'OCT 2026');
  assert.equal(monthLabel('2026-10', true), 'OCT');
  assert.deepEqual(stepPoints([3.9, null, 4.1]), [{ x: 0, y: 3.9 }, { x: 0.999, y: 3.9 }, { x: 2, y: 4.1 }, { x: 2.999, y: 4.1 }]);
});

test('instruments: the new rows open their own screens, new WORLD rows link', () => {
  const ids = ['SPFUT', 'NDFUT', 'DJFUT', 'SOX', 'DJTRANS', 'SPXEW', 'NYA', 'MOVEINDEX', 'VXN', 'GOLDFUT', 'SILVERFUT', 'BTCFUT', 'GASOLINE', 'LIVECATTLE', 'STOXX600', 'HSCEI', 'BIST100', 'MERVAL', 'VNINDEX', 'BALTICDRY'];
  for (const id of ids) {
    assert.ok(instrumentById(id), id);
    const c = parseCommand(id);
    assert.equal(c.name, 'QUOTE', `${id} opens a quote`);
    assert.equal(c.args.ticker, id);
  }
  assert.equal(new Set(INSTRUMENTS.map((i) => i.src)).size, INSTRUMENTS.length, 'one instrument per CNBC symbol');
  assert.equal(resolveInstrument('dowfutures').id, 'DJFUT');
  assert.equal(resolveInstrument('semis').id, 'SOX');
  assert.equal(resolveInstrument('baltic').id, 'BALTICDRY');
  assert.equal(parseCommand('MOVE').args?.ticker, 'MOVE', 'MOVE is still the stock ticker');
  assert.equal(parseCommand('DJT').args?.ticker, 'DJT', 'DJT is still the stock ticker');
  for (const w of WORLD.filter((x) => ['MERV', 'SOX', 'DJT', 'SPXEW', 'NYA', 'STOXX', 'XU100', 'HSCE', 'VNI'].includes(x.id))) assert.ok(w.cmd, `${w.id} links`);
  for (const w of WORLD) assert.ok(EXCHANGES[w.ex], `${w.id} has exchange hours`);
  for (const c of COMMODITIES) assert.ok(c.cmd, `${c.id} links`);
  const groups = INSTRUMENTS.filter((i) => i.markets).map((i) => i.group);
  assert.ok(groups.includes('US futures'));
  assert.deepEqual([...new Set(groups)], groups.filter((g, i) => groups.indexOf(g) === i), 'groups are not split');
  for (let i = 1; i < groups.length; i += 1) {
    if (groups[i] !== groups[i - 1]) assert.ok(!groups.slice(0, i - 1).includes(groups[i]), `${groups[i]} rows sit together`);
  }
});

test('copy rules for the new files: no banned brand word, no em dashes, no amber, no advice words', () => {
  const files = [
    'data/options.js', 'data/economy.js', 'data/fedpath.js', 'data/breadth.js', 'data/bonds.js', 'data/fxmatrix.js',
    'public/screens/options.js', 'public/screens/economy.js', 'public/screens/fedpath.js', 'public/screens/breadth.js',
    'public/screens/bonds.js', 'public/screens/fxmatrix.js', 'public/commands-markets.js', 'public/commands-markets.css',
  ];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /amber|#ffb|hsl\((3\d|4\d|5\d),/i, `${f}: amber`);
    assert.doesNotMatch(s, /\brecommend|\bideas?\b|trading signal|buy signal|sell signal|sentiment score|\boutlook\b|\bpredict/i, `${f}: advice words`);
  }
});
