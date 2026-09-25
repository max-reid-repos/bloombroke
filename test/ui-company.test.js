// Company and user-tool screens: the layout logic behind the per-screen fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleHtml, showExtended } from '../public/screens/quote.js';
import { parse as parseHistory, presetFrom, historyCmd, rangeStats, HISTORY_RANGES } from '../public/screens/history.js';

test('quote: the instrument name shows once', () => {
  assert.equal(titleHtml({ label: 'Gold', name: "Gold COMEX (Dec'26)" }), 'Gold COMEX (Dec&#39;26)');
  assert.equal(titleHtml({ label: 'S&P 500', name: 'S&P 500 Index' }), 'S&amp;P 500 Index');
  assert.equal(titleHtml({ label: null, name: 'Apple Inc.' }), 'Apple Inc.');
  assert.equal(titleHtml({ label: 'Dow', name: 'Dow Jones Industrial Average' }), 'Dow Jones Industrial Average');
  assert.equal(titleHtml({ label: 'Nasdaq volatility', name: 'CBOE VXN Index' }), 'Nasdaq volatility <span class="dim">CBOE VXN Index</span>');
  assert.equal(titleHtml({ label: 'Bitcoin', name: '' }), 'Bitcoin');
});

test('quote: pre-market and after-hours only outside the session', () => {
  const base = { last: 339.19, asOf: '2026-09-25T12:46:36-04:00' };
  const pre = { session: 'PRE-MARKET', last: 335.86, change: -0.06, changePct: -0.02, asOf: '2026-09-25T09:30:01-04:00' };
  // Mid-session: the regular trade is newer, and the market state says so too.
  assert.equal(showExtended({ ...base, marketState: 'REG_MKT', extended: pre }), false);
  assert.equal(showExtended({ ...base, extended: pre }), false);
  // After the close: the after-hours print is newer than the 4 pm close.
  const post = { session: 'AFTER HOURS', last: 340.1, asOf: '2026-09-25T17:30:00-04:00' };
  assert.equal(showExtended({ last: 339.5, asOf: '2026-09-25T16:00:00-04:00', marketState: 'POST_MKT', extended: post }), true);
  // Before the open: this morning's pre-market against yesterday's close.
  assert.equal(showExtended({ last: 335.92, asOf: '2026-09-24T16:00:00-04:00', marketState: 'PRE_MKT', extended: { ...pre, asOf: '2026-09-25T08:10:00-04:00' } }), true);
  assert.equal(showExtended({ ...base, extended: null }), false);
  assert.equal(showExtended({ ...base, marketState: 'POST_MKT', extended: { ...post, last: base.last } }), false);
});

test('history: range pills become dates, dates become commands', () => {
  const today = '2026-09-25';
  assert.equal(presetFrom('5D', today), '2026-09-18');
  assert.equal(presetFrom('1M', today), '2026-08-25');
  assert.equal(presetFrom('YTD', today), '2026-01-01');
  assert.equal(presetFrom('10Y', today), '2016-09-25');
  assert.equal(presetFrom('1M', '2026-03-31'), '2026-02-28');
  assert.equal(presetFrom('1Y', '2028-02-29'), '2027-02-28');
  assert.equal(presetFrom('MAX', today), null);
  assert.deepEqual(parseHistory(['AAPL', '5Y'], today), { ticker: 'AAPL', range: '5Y', from: '2021-09-25' });
  assert.deepEqual(parseHistory(['AAPL', '1Y'], today), { ticker: 'AAPL' });
  assert.equal(parseHistory(['AAPL', 'MAX'], today).error, 'usage');
  assert.ok(!HISTORY_RANGES.includes('1D'));
  assert.equal(historyCmd('AAPL', { range: '1Y' }), 'HISTORY AAPL');
  assert.equal(historyCmd('AAPL', { range: '3M' }), 'HISTORY AAPL 3M');
  assert.equal(historyCmd('AAPL', { from: '2025-01-02', to: today }, today), 'HISTORY AAPL 2025-01-02');
  assert.equal(historyCmd('AAPL', { from: '2025-01-02', to: '2025-06-30' }, today), 'HISTORY AAPL 2025-01-02 2025-06-30');
  const st = rangeStats([{ d: '2026-09-24', c: 110, v: 10 }, { d: '2026-09-23', c: 120, v: 30 }, { d: '2026-09-22', c: 100, v: null }]);
  assert.equal(st.changePct, 10);
  assert.equal(st.hi.d, '2026-09-23');
  assert.equal(st.lo.d, '2026-09-22');
  assert.equal(st.avgVolume, 20);
  assert.equal(rangeStats([]), null);
});
