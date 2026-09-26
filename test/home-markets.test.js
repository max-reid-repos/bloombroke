// HOME's markets list: yields in basis points, the 2s10s spread, sub-heading bars, the
// 2% box, and missing symbols dropping out cleanly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toBp, withBp, SPREAD_ID } from '../data/quotes.js';
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
  assert.equal(fmtBp(30.5, 0), '+31bp');
  assert.equal(fmtBp(null), '--');
});

test('2s10s: the 10Y less the 2Y, last and change in bp, from the live rows only', () => {
  const rows = [px('SPX', 'Americas', 0.5), y('US3M', 4.178, 0.004), y('US2Y', 4.86, -0.035), y('US10Y', 5.165, 0.003, { asOf: '2026-09-25T17:03:02.000-0400' }), y('US30Y', 5.49, 0.028), px('MOVEINDEX', 'Rates', -8.2)];
  const out = withBp(rows);
  assert.deepEqual(out.map((r) => r.id), ['SPX', 'US3M', 'US2Y', 'US10Y', 'US30Y', SPREAD_ID, 'MOVEINDEX'], 'after the last yield');
  assert.deepEqual(out.filter((r) => r.kind === 'yield' && r.id !== SPREAD_ID).map((r) => r.changeBp), [0.4, -3.5, 0.3, 2.8]);
  assert.equal(out[0].changeBp, undefined, 'prices keep % only');
  const s = out.find((r) => r.id === SPREAD_ID);
  assert.equal(s.last, 30.5);
  assert.equal(s.changeBp, 3.8, '+0.3bp less -3.5bp');
  assert.equal(s.unit, 'bp');
  assert.equal(s.cmd, 'CURVE', 'the row opens the Treasury curve');
  assert.equal(s.asOf, '2026-09-25T17:03:02.000-0400', 'the older of the two times');
  assert.equal(s.realTime, true);
  assert.equal(withBp([y('US2Y', 4.86, -0.035), y('US10Y', 5.165, 0.003, { realTime: false })]).find((r) => r.id === SPREAD_ID).realTime, false);
  // An inverted curve is a negative spread.
  assert.equal(withBp([y('US2Y', 5.2, 0), y('US10Y', 4.9, 0)]).find((r) => r.id === SPREAD_ID).last, -30);
  // Either yield missing: no spread, never a made-up one.
  assert.ok(!withBp([y('US2Y', 4.86, 0), px('SPX', 'Americas', 1)]).some((r) => r.id === SPREAD_ID));
  assert.ok(!withBp([y('US10Y', 5.1, 0)]).some((r) => r.id === SPREAD_ID));
});

test('HOME rows: yields show bp, 2s10s last in bp, a 2% move gets a box, the spread opens CURVE', () => {
  const api = withBp([px('SPX', 'Americas', 0.5), px('SOX', 'Americas', -2.4), px('DAX', 'Europe', 2), y('US2Y', 4.86, -0.035), y('US10Y', 5.165, 0.003)]);
  const html = marketsColumns(homeMarkets(api), { chg: false, cls: 'mk-cols h-mk' });
  assert.match(html, />\+31bp</, '2s10s last');
  assert.match(html, /class="num pct up">\+3\.8bp</, '2s10s change');
  assert.match(html, /class="num pct down">−3\.5bp</, '2Y change');
  assert.match(html, /data-cmd="CURVE"/);
  assert.match(html, /class="num pct down is-big">−2\.40%</);
  assert.match(html, /class="num pct up is-big">\+2\.00%</);
  assert.match(html, /class="num pct up">\+0\.50%</);
  assert.doesNotMatch(html, /bp[^<]*is-big|is-big">[^<]*bp/, 'no box on yields');
  // MARKETS (with its change column): a yield's bp sits in Chg, its % cell stays empty.
  const mk = marketsColumns(api, { time: true });
  assert.match(mk, /class="num chg down">−3\.5bp<\/td>\s*<td class="num pct down"><\/td>/);
});

test('HOME rows: a missing symbol drops out cleanly, and a sub-heading with it', () => {
  const all = HOME_MARKETS.flatMap((g) => g.rows.filter((r) => typeof r !== 'string').map(([id]) => id));
  const full = all.map((id) => px(id, 'X', 0.1));
  assert.equal(homeMarkets(full).length, 40);
  // No Nifty, no Brent, no metals at all.
  const gone = new Set(['NIFTY50', 'BRENT', 'GOLD', 'SILVER', 'COPPER']);
  const rows = homeMarkets(full.filter((r) => !gone.has(r.id)));
  assert.equal(rows.length, 35);
  assert.ok(rows.every((r) => !gone.has(r.id)));
  const html = marketsColumns(rows, { chg: false, cls: 'mk-cols h-mk' });
  assert.doesNotMatch(html, /Nifty|Brent|>Metals</);
  assert.match(html, />Energy</);
  assert.match(html, />Asia</);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.deepEqual(homeMarkets([]), []);
  assert.deepEqual(homeMarkets(undefined), []);
});
