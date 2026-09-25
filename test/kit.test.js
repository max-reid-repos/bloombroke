import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toolbar, segmented, rangePills, panelTools, moreButton, dataTable, sortRows, nextSort, fmtDate,
} from '../public/kit.js';
import { PRESETS } from '../public/ranges.js';
import { parseCommand, tickerStripFor, tickerStripHtml, screenTitle, FUNCTION_BAR, starTickerFor } from '../public/app.js';

test('dates: one format per role', () => {
  assert.equal(fmtDate('2026-09-24', 'table'), 'SEP 24');
  assert.equal(fmtDate('2026-09-04'), 'SEP 04');
  assert.equal(fmtDate('2026-09-24', 'prose'), 'Sep 24, 2026');
  assert.equal(fmtDate('2025-09-24', 'axis'), "SEP '25");
  // Timestamps are read in New York: 02:00 UTC on the 25th is still the 24th there.
  assert.equal(fmtDate('2026-09-25T02:00:00Z', 'table'), 'SEP 24');
  assert.equal(fmtDate(Date.UTC(2026, 0, 2, 17), 'prose'), 'Jan 2, 2026');
  assert.equal(fmtDate('', 'table'), '--');
  assert.equal(fmtDate('nope'), '--');
  assert.equal(fmtDate(null), '--');
});

test('sorting: stable, blanks last, numbers before words', () => {
  const rows = [{ n: 2, s: 'b' }, { n: null, s: 'a' }, { n: 10, s: 'c' }, { n: 2, s: 'd' }];
  assert.deepEqual(sortRows(rows, 'n', 'asc').map((r) => r.s), ['b', 'd', 'c', 'a']);
  assert.deepEqual(sortRows(rows, 'n', 'desc').map((r) => r.s), ['c', 'b', 'd', 'a']);
  assert.deepEqual(sortRows(rows, 's', 'desc').map((r) => r.s), ['d', 'c', 'b', 'a']);
  assert.deepEqual(nextSort(null, 'n', true), { key: 'n', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'n', dir: 'desc' }, 'n', true), { key: 'n', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'n', dir: 'desc' }, 's', false), { key: 's', dir: 'asc' });
});

test('tables: every header sorts or none do; numbers right-aligned', () => {
  const columns = [{ key: 'name', label: 'Name', name: true }, { key: 'px', label: 'Price', num: true }];
  const rows = [{ name: 'Apple', px: 3, cmd: 'AAPL' }, { name: 'Zeta <b>', px: 9 }];
  const plain = dataTable({ columns, rows });
  assert.doesNotMatch(plain, /th-sort|aria-sort/);
  assert.match(plain, /<td class="num">3<\/td>/);
  assert.match(plain, /class="cell-name">Zeta &lt;b&gt;/);
  assert.match(plain, /<tr data-cmd="AAPL" tabindex="0">/);
  const sorted = dataTable({ columns, rows, sort: { key: 'px', dir: 'desc' } });
  assert.equal(sorted.match(/class="th-sort/g).length, columns.length, 'every header is a sort button');
  assert.match(sorted, /aria-sort="descending"/);
  assert.ok(sorted.indexOf('Zeta') < sorted.indexOf('Apple'), 'rows follow the sort');
  assert.doesNotMatch(sorted, /style=/, 'no inline styles: the CSP blocks them');
});

test('toolbar, mode pairs, ranges, panel tools and more', () => {
  const bar = toolbar({ left: 'L', right: segmented([{ label: 'YIELDS', cmd: 'BONDS' }, { label: 'SPREADS', cmd: 'BONDS SPREADS' }], 'YIELDS') });
  assert.match(bar, /^<div class="toolbar"[^>]*><div class="toolbar-main">L<\/div><div class="toolbar-end"><nav class="seg"/);
  assert.match(bar, /class="seg-item is-active" href="\?c=BONDS" data-cmd="BONDS" aria-current="true">YIELDS/);
  assert.doesNotMatch(toolbar({ left: 'x' }), /toolbar-end/);
  const buttons = segmented([{ label: 'ANNUAL', value: 'A' }, { label: 'QUARTERLY', value: 'Q' }], 'Q');
  assert.match(buttons, /data-value="Q" aria-pressed="true">QUARTERLY/);
  const pills = rangePills('1Y', (r) => `AAPL ${r}`);
  assert.equal(pills.match(/seg-item/g).length, PRESETS.length, 'the full range set');
  assert.match(pills, /data-cmd="AAPL 5Y"/);
  assert.equal(panelTools({ shown: 40, total: 110 }), '<span class="panel-tools"><span class="tools-count">40 OF 110</span></span>');
  assert.match(panelTools({ total: 9, csv: { href: 'blob:x', name: 'a.csv' } }), /class="chip tools-csv" href="blob:x" download="a.csv">CSV/);
  assert.match(moreButton('SHOW 50 MORE'), /^<div class="table-more"><button type="button" class="chip">SHOW 50 MORE/);
});

test('stock screens: one tab strip with the same names everywhere', () => {
  const screens = ['AAPL', 'AAPL NEWS', 'NEWS AAPL', 'PROFILE AAPL', 'HISTORY AAPL', 'DIVIDENDS AAPL', 'FINANCIALS AAPL', 'OPTIONS AAPL', 'INSIDERS AAPL', 'VALUE AAPL', 'AAPL 5Y'];
  for (const c of screens) {
    const s = tickerStripFor(parseCommand(c));
    assert.ok(s, c);
    assert.equal(s.ticker, 'AAPL', c);
    const html = tickerStripHtml(s.ticker, s.current);
    assert.equal(html.match(/class="fn[ "]/g).length, FUNCTION_BAR.length, c);
    assert.equal(html.match(/is-active/g).length, 1, `${c}: one tab lit`);
    assert.doesNotMatch(html, /WATCH|QUOTE/, 'no watch tab and no QUOTE label: the star sits by the title');
  }
  assert.equal(tickerStripFor(parseCommand('AAPL')).current, 'CHART');
  assert.equal(tickerStripFor(parseCommand('AAPL NEWS')).current, 'NEWS');
  assert.equal(tickerStripFor(parseCommand('GOLD')), null, 'named instruments have no company functions');
  assert.equal(tickerStripFor(parseCommand('MARKETS')), null);
  assert.equal(tickerStripFor(parseCommand('NEWS')), null);
  assert.equal(tickerStripFor(parseCommand('COMPARE AAPL MSFT')), null);
  const html = tickerStripHtml('AAPL', 'CHART');
  assert.match(html, /data-key="1"[^>]*>.*CHART/);
  assert.match(html, /data-key="9"/);
  assert.doesNotMatch(html, /data-key="10"/, 'keys 1 to 9 only');
  assert.deepEqual(screenTitle(parseCommand('INSIDERS AAPL')).title, 'AAPL');
  assert.match(screenTitle(parseCommand('INSIDERS AAPL')).sub, /officers and directors/);
  assert.equal(screenTitle(parseCommand('AAPL 5Y')).sub, '');
});

test('kit files follow the copy rules', () => {
  for (const f of ['public/kit.js', 'public/kit.css']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /amber|#ffb|hsl\((3\d|4\d|5\d),/i, `${f}: amber`);
  }
});

test('the watch star sits by the title on every instrument screen', () => {
  for (const c of ['AAPL', 'AAPL NEWS', 'GOLD', 'BTC', 'EURUSD', 'SPX', 'GOLD 5Y']) {
    assert.equal(starTickerFor(parseCommand(c)), parseCommand(c).args.ticker, c);
  }
  for (const c of ['HOME', 'NEWS', 'WATCH', 'HEATMAP']) assert.equal(starTickerFor(parseCommand(c)), null, c);
});
