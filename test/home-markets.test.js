// HOME's markets list: yields in basis points, the 2s10s spread, sub-heading bars, the
// 2% box, and missing symbols dropping out cleanly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toBp, withBp, SPREAD_ID, dayMove, dailyMove, noDayMove, parseListRows, makeQuotes } from '../data/quotes.js';
import { createCache } from '../data/cache.js';
import { INSTRUMENTS as REGISTRY } from '../public/instruments.js';
import { fmtBp as ratesFmtBp } from '../public/screens/rates.js';
import { marketsColumns, fmtBp } from '../public/screens/markets.js';
import { HOME_MARKETS, homeMarkets } from '../public/screens/home.js';

const y = (id, last, change, extra = {}) => ({
  id, name: id, group: 'Rates', kind: 'yield', decimals: 3, last, change, changePct: 0.05,
  asOf: '2026-09-25T17:05:00.000-0400', realTime: true, marketState: 'REG_MKT', ...extra,
});
const px = (id, group, changePct, extra = {}) => ({
  id, name: id, group, kind: 'index', decimals: 2, last: 100, change: changePct, changePct, asOf: '2026-09-25', realTime: false, ...extra,
});

test('bp: a change in points becomes basis points, to 0.1bp, no float noise', () => {
  assert.equal(toBp(0.003), 0.3);
  assert.equal(toBp(-0.035), -3.5);
  assert.equal(toBp(0.028), 2.8);
  assert.equal(toBp(5.165 - 4.86), 30.5, '0.30499999... is 30.5bp');
  assert.equal(toBp(0), 0);
  assert.equal(toBp(NaN), null);
  assert.equal(toBp(undefined), null);
  assert.equal(fmtBp(0.3), '+0.3bp');
  assert.equal(fmtBp(-3.5), '−3.5bp');
  // One helper everywhere: a change is signed, a level (the 2s10s spread) is not.
  assert.equal(fmtBp(30.5, { level: true }), '30.5bp');
  assert.equal(fmtBp(-30, { level: true }), '\u221230.0bp');
  assert.equal(fmtBp(3.8), '+3.8bp');
  assert.equal(fmtBp(null), '--');
  assert.equal(fmtBp(null, { level: true }), '--');
  assert.equal(ratesFmtBp, fmtBp, 'RATES, CURVE and FEDPATH use the same helper');
});

test('2s10s: the 10Y less the 2Y, last and change in bp, from the live rows only', () => {
  const rows = [px('SPX', 'Americas', 0.5), y('US3M', 4.178, 0.004), y('US2Y', 4.86, -0.035), y('US10Y', 5.165, 0.003, { asOf: '2026-09-25T17:03:02.000-0400' }), y('US30Y', 5.49, 0.028), px('MOVEINDEX', 'Rates', -8.2)];
  const out = withBp(rows);
  assert.deepEqual(out.map((r) => r.id), ['SPX', 'US3M', 'US2Y', 'US10Y', 'US30Y', SPREAD_ID, 'MOVEINDEX'], 'after the last yield');
  assert.deepEqual(out.filter((r) => r.kind === 'yield' && r.id !== SPREAD_ID).map((r) => r.changeBp), [0.4, -3.5, 0.3, 2.8]);
  assert.equal(out[0].changeBp, undefined, 'prices keep % only');
  const s = out.find((r) => r.id === SPREAD_ID);
  // Units stay clear: last and change in points like every yield, bp in their own fields.
  assert.equal(s.last, 0.305);
  assert.equal(s.lastBp, 30.5);
  assert.equal(s.change, 0.038);
  assert.equal(s.changeBp, 3.8, '+0.3bp less -3.5bp');
  assert.equal(s.unit, 'bp');
  assert.equal(s.cmd, 'CURVE', 'the row opens the Treasury curve');
  assert.equal(s.asOf, '2026-09-25T17:03:02.000-0400', 'the older of the two times');
  assert.equal(s.realTime, true);
  assert.equal(withBp([y('US2Y', 4.86, -0.035), y('US10Y', 5.165, 0.003, { realTime: false })]).find((r) => r.id === SPREAD_ID).realTime, false);
  // An inverted curve is a negative spread.
  assert.equal(withBp([y('US2Y', 5.2, 0), y('US10Y', 4.9, 0)]).find((r) => r.id === SPREAD_ID).lastBp, -30);
  // Either yield missing: no spread, never a made-up one.
  assert.ok(!withBp([y('US2Y', 4.86, 0), px('SPX', 'Americas', 1)]).some((r) => r.id === SPREAD_ID));
  assert.ok(!withBp([y('US10Y', 5.1, 0)]).some((r) => r.id === SPREAD_ID));
});

test('HOME rows: yields show bp, 2s10s last in bp, a 2% move gets a box, the spread opens CURVE', () => {
  const api = withBp([px('SPX', 'Americas', 0.5), px('SOX', 'Americas', -2.4), px('DAX', 'Europe', 2), y('US2Y', 4.86, -0.035), y('US10Y', 5.165, 0.003)]);
  const html = marketsColumns(homeMarkets(api), { chg: false, cls: 'mk-cols h-mk' });
  assert.match(html, />30\.5bp</, '2s10s level: one decimal, no sign');
  assert.match(html, /class="num pct up">\+3\.8bp</, '2s10s change');
  assert.match(html, /class="num pct down">−3\.5bp</, '2Y change');
  assert.match(html, /data-cmd="CURVE"/);
  assert.match(html, /class="num pct down is-big">−2\.40%</);
  assert.match(html, /class="num pct up is-big">\+2\.00%</);
  assert.match(html, /class="num pct up">\+0\.50%</);
  assert.doesNotMatch(html, /bp[^<]*is-big|is-big">[^<]*bp/, 'no box on yields');
  // MARKETS (with its Chg column): a yield's bp sits in the change cell, the one every
  // layout shows (phones and DESK panels hide Chg); its Chg cell stays empty.
  const mk = marketsColumns(api, { time: true });
  assert.match(mk, /class="num chg down"><\/td>\s*<td class="num pct down">−3\.5bp<\/td>/);
  assert.match(mk, />30\.5bp</);
});

test('HOME columns: all four the same shape, a title, two sub-headings and ten rows', () => {
  // Same shape, same height: the four columns end on one line.
  const shape = HOME_MARKETS.map((g) => g.rows.map((r) => (typeof r === 'string' ? 'S' : 'R')).join(''));
  for (const s of shape) assert.equal(s.replace(/R/g, '').length, 2, 'two sub-headings');
  for (const s of shape) assert.equal(s.replace(/S/g, '').length, 10, 'ten rows');
  assert.ok(HOME_MARKETS.every((g) => typeof g.rows[0] === 'string'), 'every column opens with a sub-heading');
  const byGroup = (name) => {
    const out = [];
    for (const r of HOME_MARKETS.find((g) => g.name === name).rows) {
      if (typeof r === 'string') out.push([r, []]); else out[out.length - 1][1].push(r[1]);
    }
    return out;
  };
  assert.deepEqual(byGroup('US'), [
    ['Indexes', ['S&P 500', 'Nasdaq 100', 'Dow', 'Russell 2000', 'Equal weight', 'Semis', 'Transports']],
    ['Futures + vol', ['S&P 500 fut', 'Nasdaq 100 fut', 'VIX']],
  ]);
  assert.deepEqual(byGroup('Commodities + crypto'), [
    ['Commodities', ['WTI oil', 'Brent oil', 'Natural gas', 'Gold (spot)', 'Silver (spot)', 'Copper', 'Wheat', 'Baltic Dry']],
    ['Crypto', ['Bitcoin', 'Ether']],
  ]);
  assert.deepEqual(byGroup('World').map(([s, r]) => [s, r.length]), [['Europe', 4], ['Asia', 6]]);
  assert.deepEqual(byGroup('FX + rates').map(([s, r]) => [s, r.length]), [['FX', 5], ['Rates', 5]]);
  // Rendered: four tables, each with one title bar, two sub-heading bars and ten rows.
  const all = HOME_MARKETS.flatMap((g) => g.rows.filter((r) => typeof r !== 'string').map(([id]) => id));
  const html = marketsColumns(homeMarkets(all.map((id) => px(id, 'X', 0.1))), { chg: false, cls: 'mk-cols h-mk' });
  const tables = html.split('<table').slice(1);
  assert.equal(tables.length, 4);
  for (const t of tables) {
    assert.equal((t.match(/class="group-row"/g) || []).length, 1, 'one title bar');
    assert.equal((t.match(/class="group-row sub-row"/g) || []).length, 2, 'two sub-heading bars');
    assert.equal((t.match(/class="row-link"/g) || []).length, 10, 'ten rows');
  }
});

test('HOME rows: a missing symbol drops out cleanly, and a sub-heading with it', () => {
  const all = HOME_MARKETS.flatMap((g) => g.rows.filter((r) => typeof r !== 'string').map(([id]) => id));
  const full = all.map((id) => px(id, 'X', 0.1));
  assert.equal(homeMarkets(full).length, 40);
  // No Nifty, no Brent, no crypto at all.
  const gone = new Set(['NIFTY50', 'BRENT', 'BTC', 'ETH']);
  const rows = homeMarkets(full.filter((r) => !gone.has(r.id)));
  assert.equal(rows.length, 36);
  assert.ok(rows.every((r) => !gone.has(r.id)));
  const html = marketsColumns(rows, { chg: false, cls: 'mk-cols h-mk' });
  assert.doesNotMatch(html, /Nifty|Brent|>Crypto</);
  assert.match(html, />Commodities</);
  assert.match(html, />Asia</);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.deepEqual(homeMarkets([]), []);
  assert.deepEqual(homeMarkets(undefined), []);
});

test('phone and DESK column set: yields keep their bp change when Chg is hidden', () => {
  // Phones and DESK panels show MARKETS with the Chg column hidden: every value must be
  // in the name, tag, last and change cells.
  const api = withBp([px('SPX', 'Americas', 0.5), y('US2Y', 4.86, -0.035), y('US10Y', 5.165, 0.003)]);
  for (const html of [marketsColumns(api, { time: true }), marketsColumns(api)]) {
    const visible = html.replace(/<td class="num chg[^"]*">[^<]*<\/td>/g, '');
    assert.match(visible, /−3\.5bp/, '2Y');
    assert.match(visible, /\+0\.3bp/, '10Y');
    assert.match(visible, /\+3\.8bp/, '2s10s');
    assert.match(visible, /\+0\.50%/, 'prices keep %');
  }
});

// A weekend CNBC row: UNCH, with the previous close rolled onto the last price.
const UNCH = { symbol: '@LCO.1', code: 0, last: '104.32', change: 'UNCH', change_pct: 'UNCH', previous_day_closing: '104.32', last_time: '2026-09-26T06:00:00.000+0100', realTime: 'false' };
const bar = (day, close) => ({ tradeTimeinMills: String(Date.UTC(2026, 8, day, 4)), close: String(close) });

test('UNCH rows: filled from the last two daily closes, else null (never 0.00%)', () => {
  assert.equal(noDayMove(UNCH), true);
  assert.equal(noDayMove({ ...UNCH, change: '-2.28' }), false);
  assert.equal(noDayMove({ ...UNCH, previous_day_closing: '104.30' }), true, 'a rounded previous close is not a move either');
  // Brent's Friday: 106.60 -> 104.32, oldest first whatever order the bars come in.
  const fill = dailyMove([bar(25, 104.32), bar(23, 103.08), bar(24, 106.6)]);
  assert.deepEqual(fill, { close: 104.32, change: -2.28, changePct: -2.1388, prevClose: 106.6, day: '20260925' });
  assert.equal(dailyMove([bar(25, 104.32)]), null, 'one close is not a move');
  assert.equal(dailyMove(undefined), null);
  assert.deepEqual(dayMove(UNCH, fill), { change: -2.28, changePct: -2.1388 });
  assert.deepEqual(dayMove(UNCH, null), { change: null, changePct: null });
  // A fill whose last close is not this price (stale bars) is not used.
  assert.deepEqual(dayMove(UNCH, { close: 110, change: 1, changePct: 1 }), { change: null, changePct: null });
  // A normal row keeps the source's own move.
  assert.deepEqual(dayMove({ ...UNCH, change: '+1.20', change_pct: '+1.16%' }, fill), { change: 1.2, changePct: 1.16 });
  const item = { id: 'BRENT', src: '@LCO.1', name: 'Oil (Brent)', group: 'Commodities', kind: 'future', decimals: 2 };
  assert.equal(parseListRows([item], [UNCH])[0].changePct, null);
  assert.equal(parseListRows([item], [UNCH], (src) => (src === '@LCO.1' ? fill : null))[0].changePct, -2.1388);
});

test('UNCH display: an unknown move shows --, not 0.00%, and gets no box', () => {
  const html = marketsColumns(homeMarkets([px('BRENT', 'Commodities', 0, { change: null, changePct: null })]), { chg: false, cls: 'mk-cols h-mk' });
  assert.match(html, /class="num pct flat">--</);
  assert.doesNotMatch(html, /0\.00%|is-big|NaN/);
});

test('2s10s: a leg with an unknown change gives no made-up spread change', () => {
  const out = withBp([y('US2Y', 4.86, null), y('US10Y', 5.165, 0.003)]);
  const s = out.find((r) => r.id === SPREAD_ID);
  assert.equal(s.lastBp, 30.5, 'the level is still known');
  assert.equal(s.change, null);
  assert.equal(s.changeBp, null);
  assert.equal(out.find((r) => r.id === 'US2Y').changeBp, null);
  const html = marketsColumns(homeMarkets(out), { chg: false, cls: 'mk-cols h-mk' });
  assert.match(html, />30\.5bp<\/td>\s*<td class="num pct flat">--</);
});

test('history fill: one bars call per symbol, cached 10 minutes, none when the move is known', async () => {
  let t = 0;
  let bars = 0;
  let unch = true;
  const json = (b) => ({ ok: true, json: async () => b });
  const batch = () => REGISTRY.map((i) => (i.src === '@LCO.1'
    ? { ...UNCH, ...(unch ? {} : { change: '-2.28', change_pct: '-2.14%', previous_day_closing: '106.60' }) }
    : { symbol: i.src, code: 0, last: '10', change: '1', change_pct: '10%', realTime: 'true' }));
  const fetchImpl = async (url) => {
    if (url.includes('/bars/')) {
      bars += 1;
      assert.match(url, /%40LCO\.1\/1D\//, 'daily bars for that symbol');
      return json({ barData: { priceBars: [bar(24, 106.6), bar(25, 104.32)] } });
    }
    return json({ FormattedQuoteResult: { FormattedQuote: batch() } });
  };
  const qs = makeQuotes({ fetchImpl, cache: createCache({ now: () => t }), now: () => t, fillWaitMs: 1000 });
  const brent = async () => (await qs.getQuotes()).instruments.find((r) => r.id === 'BRENT');
  assert.equal((await brent()).changePct, -2.1388);
  assert.equal((await qs.getQuote('BRENT')).changePct, -2.1388, 'the instrument screen too');
  assert.equal(bars, 1);
  t = 16_000;
  await brent();
  assert.equal(bars, 1, 'cached');
  t = 11 * 60_000;
  unch = false;
  assert.equal((await brent()).change, -2.28);
  assert.equal(bars, 1, 'a row with its own move asks for no history');
});

test('history fill: the source failing leaves the move unknown, and is not asked again soon', async () => {
  let t = 0;
  let bars = 0;
  const json = (b) => ({ ok: true, json: async () => b });
  const fetchImpl = async (url) => {
    if (url.includes('/bars/')) { bars += 1; return { ok: false, status: 503 }; }
    return json({ FormattedQuoteResult: { FormattedQuote: REGISTRY.map((i) => (i.src === '@LCO.1' ? UNCH : { symbol: i.src, code: 0, last: '10', change: '1', change_pct: '10%' })) } });
  };
  const qs = makeQuotes({ fetchImpl, cache: createCache({ now: () => t }), now: () => t, fillWaitMs: 1000 });
  const row = (await qs.getQuotes()).instruments.find((r) => r.id === 'BRENT');
  assert.equal(row.change, null);
  assert.equal(row.changePct, null);
  t = 16_000;
  await qs.getQuotes();
  assert.equal(bars, 1);
});
