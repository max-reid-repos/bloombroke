// Weekend data: stray Saturday prints, the last real session, 5D daily bars, weekend
// quote rows (previous close, open and range from the daily bars) and unknown moves
// that stay unknown (--), never 0.00%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCharts, sessionDay, dropStrays, dropWeekendDaily, lastSession, shapeBars } from '../data/charts.js';
import { dailyMove, filledRow, parseQuoteRow, parseListRows, weekendPlaceholder } from '../data/quotes.js';
import { liveRates, crossRates } from '../data/fxmatrix.js';
import { parseSp100 } from '../data/sp100.js';
import { parseFedFutures } from '../data/fedpath.js';
import { valuePortfolio } from '../public/portfolio.js';
import { changeText } from '../public/screens/quote.js';
import { weightedPct } from '../public/screens/heatmap.js';

// A CNBC bar at New York time (EDT, UTC-4, as in late September).
const pad = (n) => String(n).padStart(2, '0');
function cnbcBar(day, hh, mm, close, extra = {}) {
  const [y, m, d] = [Number(day.slice(0, 4)), Number(day.slice(4, 6)), Number(day.slice(6, 8))];
  return {
    tradeTime: `${day}${pad(hh)}${pad(mm)}00`,
    tradeTimeinMills: String(Date.UTC(y, m - 1, d, hh + 4, mm)),
    open: String(close), high: String(close), low: String(close), close: String(close), volume: '1000', ...extra,
  };
}
// 5-minute bars on a New York day from h0:m0 up to (not including) h1:m1.
function day5m(day, [h0, m0], [h1, m1], price) {
  const out = [];
  for (let t = h0 * 60 + m0; t < h1 * 60 + m1; t += 5) out.push(cnbcBar(day, Math.floor(t / 60), t % 60, price(t)));
  return out;
}
const fetchFrom = (byBar) => async (url) => {
  const bar = /\/bars\/[^/]+\/([0-9A-Z]+)\//.exec(url)[1];
  return { ok: true, status: 200, json: async () => ({ barData: { priceBars: byBar[bar] || [] } }) };
};
const nyHm = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const SATURDAY = () => new Date('2026-09-26T20:00:00Z');

// AAPL-like: a week of full days (04:00 to 20:00), then one stray print on Saturday 12:20.
const WEEK = ['20260921', '20260922', '20260923', '20260924', '20260925'];
const aaplBars = [
  ...WEEK.flatMap((d, i) => day5m(d, [4, 0], [20, 0], (t) => 330 + i + t / 10_000)),
  cnbcBar('20260926', 12, 20, 341.46, { volume: '4932943' }),
];
const aaplDaily = [
  ...WEEK.map((d, i) => cnbcBar(d, 0, 0, [338.98, 339.75, 337.02, 335.92, 341.07][i])),
];

test('stray Saturday print: 1D is Friday\'s session, 5D ends on Friday\'s official close', async () => {
  const ch = makeCharts({ fetchImpl: fetchFrom({ '5M': aaplBars, '1M': aaplBars, '1D': aaplDaily }), now: SATURDAY });
  const d1 = await ch.getChart('AAPL', '1D');
  assert.equal(d1.points.length, 78, 'the whole 09:30 to 16:00 session');
  assert.match(nyHm(d1.points[0].t), /^Fri,? 09:30/);
  assert.match(nyHm(d1.points.at(-1).t), /^Fri,? 15:55/);
  assert.equal(d1.points.at(-1).v, 341.07, 'the official close, not the Saturday print');
  const ext = await ch.getChart('AAPL', { range: '1D', bar: '5M' });
  assert.ok(ext.ext);
  assert.match(nyHm(ext.points[0].t), /^Fri,? 04:00/, 'pre-market kept on a stock\'s 1D');
  assert.match(nyHm(ext.points.at(-1).t), /^Fri,? 19:55/, 'after hours kept, the Saturday print not');
  const d5 = await ch.getChart('AAPL', '5D');
  assert.equal(new Set(d5.points.map((p) => nyHm(p.t).slice(0, 3))).size, 5);
  assert.equal(d5.points.at(-1).v, 341.07, '5D LAST = the quote\'s close');
  assert.ok(d5.points.every((p) => !/^Sat/.test(nyHm(p.t))), 'no bar labelled SEP 26');
});

test('5D with daily bars: the last five daily bars, no intraday session filter', async () => {
  const daily = [
    cnbcBar('20260918', 0, 0, 7650.5), ...WEEK.map((d, i) => cnbcBar(d, 0, 0, 7700 + i)),
    cnbcBar('20260926', 0, 0, 7704), // a weekend placeholder
  ];
  const ch = makeCharts({ fetchImpl: fetchFrom({ '1D': daily }), now: SATURDAY });
  const spx = await ch.getChart('SPX', { range: '5D', bar: '1D' });
  assert.deepEqual(spx.points.map((p) => p.v), [7700, 7701, 7702, 7703, 7704], 'Monday to Friday, not the Saturday bar');
  assert.match(nyHm(spx.points.at(-1).t), /^Fri/);
  const aapl = await makeCharts({ fetchImpl: fetchFrom({ '1D': daily }), now: SATURDAY }).getChart('AAPL', { range: '5D', bar: '1D' });
  assert.equal(aapl.points.length, 5);
});

test('FX and spot metals: the trading day runs 17:00 to 17:00, Sunday evening opens Monday', () => {
  assert.equal(sessionDay('20260924170000', true), '20260925', 'Thursday 17:00 is Friday\'s day');
  assert.equal(sessionDay('20260925165500', true), '20260925');
  assert.equal(sessionDay('20260925170000', true), '20260926', 'after Friday\'s close: a Saturday, dropped');
  assert.equal(sessionDay('20260920151000', true), '20260921', 'Sunday bars open Monday');
  assert.equal(sessionDay('20260920235500', true), '20260921');
  assert.equal(sessionDay('20260926060500', true), '20260926');
  assert.equal(sessionDay('20260924170000', false), '20260924', 'stocks keep calendar days');
});

test('GOLD 1D on a Saturday: Thursday 17:00 to Friday 17:00, without the stray prints', async () => {
  const bars = [
    ...day5m('20260924', [0, 0], [24, 0], () => 4274),
    ...day5m('20260925', [0, 0], [17, 5], (t) => (t >= 16 * 60 + 55 ? 4285.0567 : 4280)),
    cnbcBar('20260926', 6, 5, 4286.2468),
  ];
  const ch = makeCharts({ fetchImpl: fetchFrom({ '5M': bars }), now: SATURDAY });
  const g = await ch.getChart('GOLD', '1D');
  assert.match(nyHm(g.points[0].t), /^Thu,? 17:00/);
  assert.match(nyHm(g.points.at(-1).t), /^Fri,? 16:55/);
  assert.equal(g.points.at(-1).v, 4285.0567);
  assert.equal(g.points.length, 24 * 12);
});

test('stray days: weekends and lone prints out, a session that just opened stays', () => {
  const pts = (bars) => shapeBars(bars);
  const spxSunday = pts([...day5m('20260918', [9, 30], [16, 0], () => 1), cnbcBar('20260920', 12, 10, 2)]);
  assert.deepEqual([...new Set(dropStrays(spxSunday, { today: '20260920' }).map((p) => p.d.slice(0, 8)))], ['20260918']);
  const mondayOpen = pts([...day5m('20260925', [9, 30], [16, 0], () => 1), cnbcBar('20260928', 9, 30, 2)]);
  assert.equal(dropStrays(mondayOpen, { today: '20260928' }).at(-1).v, 2, 'today\'s first bar is kept');
  assert.equal(dropStrays(mondayOpen, { today: '20260929' }).at(-1).v, 1, 'a past lone print is not');
  const fxSundayEvening = pts([...day5m('20260925', [0, 0], [17, 0], () => 1), cnbcBar('20260927', 17, 5, 2)]);
  assert.equal(dropStrays(fxSundayEvening, { roll: true, today: '20260927' }).at(-1).v, 2, 'Monday\'s day opened on Sunday evening');
  const kept = lastSession(dropStrays(fxSundayEvening, { roll: true, today: '20260927' }), { usSession: false, roll: true });
  assert.deepEqual(kept.map((p) => p.v), [2]);
});

test('crypto keeps its weekend bars and rolling windows', async () => {
  const bars = [...day5m('20260925', [0, 0], [24, 0], () => 84000), ...day5m('20260926', [0, 0], [15, 0], () => 84300)];
  const ch = makeCharts({ fetchImpl: fetchFrom({ '5M': bars }), now: SATURDAY });
  const btc = await ch.getChart('BTC', '1D');
  assert.equal(btc.points.at(-1).v, 84300);
  assert.match(nyHm(btc.points.at(-1).t), /^Sat/);
  assert.equal(btc.points.length, 24 * 12, 'the last 24 hours');
});

test('weekend daily placeholders: Saturday bars and flat Sunday bars are left out', () => {
  assert.equal(weekendPlaceholder({ d: '20260926', o: 1, h: 2, l: 0.5, v: 1.5 }), true, 'any Saturday');
  assert.equal(weekendPlaceholder({ d: '20260920', o: 4376.91, h: 4376.91, l: 4376.91, v: 4376.91 }), true, 'a flat Sunday');
  assert.equal(weekendPlaceholder({ d: '20260920', o: 1, h: 2, l: 0.5, v: 1.5 }), false, 'a Sunday that traded');
  assert.equal(weekendPlaceholder({ d: '20260925', o: 1, h: 1, l: 1, v: 1 }), false, 'a weekday');
  const d = shapeBars([cnbcBar('20260925', 0, 0, 1), cnbcBar('20260926', 0, 0, 2)]);
  assert.deepEqual(dropWeekendDaily(d).map((p) => p.v), [1]);
});

// Spot gold on Saturday Sep 26 2026: CNBC's row and its daily bars.
const GOLD_ROW = {
  symbol: 'XAU=', code: 0, last: '4,286.25', change: 'UNCH', change_pct: 'UNCH', previous_day_closing: '4,286.247',
  open: '4,286.247', high: '4,286.247', low: '4,286.247', last_time: '2026-09-26T15:25:55.780-0400',
};
const GOLD_DAILY = [
  cnbcBar('20260924', 0, 0, 4274.1767, { open: '4286.6775', high: '4302.4953', low: '4244.75' }),
  cnbcBar('20260925', 0, 0, 4285.0567, { open: '4273.6917', high: '4314.63', low: '4256.06' }),
  cnbcBar('20260926', 0, 0, 4286.2468),
];
const EUR_ROW = {
  symbol: 'EUR=', code: 0, last: '1.1391', change: 'UNCH', change_pct: 'UNCH', previous_day_closing: '1.1391',
  open: '0.00', high: '0.00', low: '0.00', volume: '0', last_time: '2026-09-25T16:59:00.000-0400',
};
const EUR_DAILY = [
  cnbcBar('20260924', 0, 0, 1.1379, { open: '1.1378', high: '1.1399', low: '1.1358' }),
  cnbcBar('20260925', 0, 0, 1.1391, { open: '1.1376', high: '1.1411', low: '1.1366' }),
];

test('daily move on a Saturday: Friday against Thursday, never the Saturday placeholder', () => {
  const g = dailyMove(GOLD_DAILY);
  assert.equal(g.close, 4285.0567);
  assert.equal(g.prevClose, 4274.1767);
  assert.equal(g.change, 10.88);
  assert.equal(g.day, '20260925');
  assert.deepEqual([g.open, g.high, g.low], [4273.6917, 4314.63, 4256.06]);
  assert.equal(dailyMove(GOLD_DAILY, { allWeek: true }).close, 4286.2468, 'crypto keeps weekend bars');
});

test('weekend quote rows: previous close, open and range agree with the filled move', () => {
  const eur = parseQuoteRow(EUR_ROW, 'EURUSD', dailyMove(EUR_DAILY));
  assert.equal(eur.last, 1.1391);
  assert.equal(eur.change, 0.0012);
  assert.equal(eur.prevClose, 1.1379, 'the close the move is from, not the rolled 1.1391');
  assert.deepEqual([eur.open, eur.low, eur.high], [1.1376, 1.1366, 1.1411], 'Friday\'s from the daily bar, not 0.00');
  assert.equal(eur.asOf, '2026-09-25T16:59:00.000-0400');
  const gold = parseQuoteRow(GOLD_ROW, 'GOLD', dailyMove(GOLD_DAILY));
  assert.equal(gold.last, 4285.0567, 'a Saturday print gives way to Friday\'s close');
  assert.equal(gold.asOf, '2026-09-25', 'shown as CLOSE 2026-09-25, not a Saturday trade time');
  assert.equal(gold.change, 10.88);
  assert.equal(gold.prevClose, 4274.1767);
  assert.deepEqual([gold.open, gold.low, gold.high], [4273.6917, 4256.06, 4314.63], 'not the rolled 4,286.25 three times');
  const list = parseListRows([{ id: 'GOLD', src: 'XAU=' }], [GOLD_ROW], () => dailyMove(GOLD_DAILY))[0];
  assert.deepEqual([list.last, list.change, list.asOf], [4285.0567, 10.88, '2026-09-25'], 'the tape and MARKETS say the same');
  assert.equal(filledRow({ ...EUR_ROW, change: '+0.0012' }, dailyMove(EUR_DAILY)), null, 'a row with its own move is left alone');
  // No fill ready: an unknown move and no invented open or range.
  const bare = parseQuoteRow(GOLD_ROW, 'GOLD', null);
  assert.equal(bare.change, null);
  assert.equal(bare.changePct, null);
});

test('rolled previous close with a real move: the price before the move', () => {
  const silver = parseQuoteRow({ symbol: 'XAG=', code: 0, last: '64.2805', change: '+0.3755', change_pct: '+0.58%', previous_day_closing: '64.2805', last_time: '2026-09-25T17:00:00.000-0400' }, 'SILVER');
  assert.equal(silver.prevClose, 63.905);
  const aapl = parseQuoteRow({ symbol: 'AAPL', code: 0, last: '341.07', change: '+5.15', change_pct: '+1.53%', previous_day_closing: '335.92' }, 'AAPL');
  assert.equal(aapl.prevClose, 335.92, 'a real previous close stays');
});

test('unknown moves stay null: quote, extended hours, S&P 100, Fed futures, portfolio', () => {
  const q = parseQuoteRow({ symbol: 'ZZZ', code: 0, last: '10', change: '', change_pct: '', ExtendedMktQuote: { type: 'POST_MKT', last: '10.2', change: '', change_pct: '' } }, 'ZZZ');
  assert.equal(q.change, null);
  assert.equal(q.changePct, null);
  assert.equal(q.extended.change, null);
  assert.equal(q.extended.changePct, null);
  assert.equal(parseQuoteRow({ symbol: 'ZZZ', code: 0, last: '10', change: '+1', change_pct: '' }, 'ZZZ').changePct, 11.1111, 'a missing % from the change and the price before it');
  assert.equal(changeText({ kind: 'yield', change: null }), '--', 'a yield with no move is not 0.0 bp');
  const s = parseSp100([
    { symbol: 'AAA', code: 0, last: '10', change: '', change_pct: '' },
    { symbol: 'BBB', code: 0, last: '10', change: 'UNCH', change_pct: 'UNCH' },
  ], [{ ticker: 'AAA', name: 'A', sector: 'TECH' }, { ticker: 'BBB', name: 'B', sector: 'TECH' }]);
  assert.deepEqual(s.map((x) => x.changePct), [null, 0], 'missing is unknown; the source\'s UNCH is a flat day');
  assert.equal(parseFedFutures([{ symbol: '@FF.1', code: 0, last: '96.2525', change: '', expiration_date: '2026-09-30' }])[0].change, null);
  assert.equal(weightedPct([{ changePct: null, marketCap: 5 }, { changePct: 2, marketCap: 1 }]), 2, 'unknown moves left out of a sector\'s move');
  const pf = valuePortfolio([{ ticker: 'AAA', shares: 10, cost: 5 }, { ticker: 'BBB', shares: 1, cost: 5 }], {
    AAA: { last: 10, change: null, changePct: null, currency: 'USD' }, BBB: { last: 10, change: 1, changePct: 11.1, currency: 'USD' },
  });
  assert.ok(Number.isNaN(pf.rows[0].dayGain) && Number.isNaN(pf.rows[0].dayPct), 'shown as --, not $0.00 and 0.00%');
  assert.ok(Number.isNaN(pf.totals.dayGain), 'the day total is unknown too');
  assert.equal(pf.totals.value, 110, 'the value is still known');
});

test('FXMATRIX heat: weekend legs filled from daily closes, unknown legs --, never 0.00%', () => {
  const q = (symbol, last) => ({ symbol, code: 0, last, change: 'UNCH', change_pct: 'UNCH', previous_day_closing: last, realTime: 'true', last_time: '2026-09-25T16:59:00.000-0400' });
  const rows = [q('EUR=', '1.1391'), q('GBP=', '1.25'), q('AUD=', '0.5'), q('JPY=', '157.26'), q('CHF=', '0.8282'), q('CAD=', '1.4'), q('CNY=', '7'), q('THB=', '33')];
  const fills = {
    'EUR=': dailyMove(EUR_DAILY),
    'CHF=': dailyMove([cnbcBar('20260924', 0, 0, 0.8275), cnbcBar('20260925', 0, 0, 0.8282)]),
  };
  const l = liveRates(rows, undefined, (src) => fills[src] || null);
  const m = crossRates(l.rates);
  const p = crossRates(l.prevRates);
  const pct = (a, b) => (p[a][b] > 0 ? ((m[a][b] - p[a][b]) / p[a][b]) * 100 : null);
  assert.ok(Math.abs(pct('EUR', 'USD') - 0.10546) < 1e-3, 'EUR/USD +0.11%, as on its own screen');
  assert.ok(pct('USD', 'CHF') > 0.08 && pct('USD', 'CHF') < 0.09);
  assert.ok(Math.abs(pct('EUR', 'CHF') - ((1.1391 * 0.8282) / (1.1379 * 0.8275) - 1) * 100) < 1e-9, 'a cross from its two filled legs');
  assert.equal(pct('USD', 'GBP'), null, 'no fill: unknown, not 0.00%');
  assert.equal(pct('GBP', 'EUR'), null);
});
