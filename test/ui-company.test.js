// Company and user-tool screens: the layout logic behind the per-screen fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleHtml, showExtended } from '../public/screens/quote.js';
import { parse as parseHistory, presetFrom, historyCmd, rangeStats, HISTORY_RANGES } from '../public/screens/history.js';
import { barsDomain, barsSvg } from '../public/screens/minibars.js';
import { monthlyTotals, insidersTable } from '../public/screens/insiders.js';
import { shortQuarter, beatsGroups, beatsTable, nextLine } from '../public/screens/beats.js';
import { trendPoints, shortsTable } from '../public/screens/shorts.js';
import { chips as filingChips, filingsTable } from '../public/screens/filings.js';
import { holdersTable, notRefiledHtml, ownersNote } from '../public/screens/owners.js';
import { parseNextReport } from '../data/beats.js';
import { filterFilings, isKeyFiling } from '../data/filings.js';
import { panelTools } from '../public/kit.js';
import { rowActions, listTools, readSymbols, watchTable } from '../public/screens/watch.js';
import { pfForm, pfTable } from '../public/screens/portfolio.js';
import { setHolding, readPfForm, valuePortfolio } from '../public/portfolio.js';
import { SORTS } from '../public/watchlist.js';
import { stripNumber } from '../public/embed.js';
import { chainTable, CALL_COLS, PUT_COLS } from '../public/screens/options.js';
import { fitHeight } from '../public/screens/heatmap.js';
import { presetBar } from '../public/screens/screen.js';
import { readFileSync } from 'node:fs';
import { splitGroups, fmtX } from '../public/screens/whatif.js';
import { multiple as certMultiple } from '../data/whatif-cert.js';
import { readWageInput, affordShare, buyHtml, buyMaths } from '../public/screens/buy.js';

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

test('small bars: the domain takes in zero and rounds out to whole steps', () => {
  const series = [{ key: 'a', cls: 'mb-a', label: 'A' }, { key: 'b', cls: 'mb-b', label: 'B' }];
  const d = barsDomain([{ values: { a: 1.91, b: 1.88 } }, { values: { a: 2.84, b: 2.65 } }], series);
  assert.equal(d.lo, 0);
  assert.ok(d.hi >= 2.84 && d.ticks.at(-1) === d.hi && d.ticks[0] === 0);
  const neg = barsDomain([{ values: { a: 0, b: -93e6 } }], series);
  assert.ok(neg.lo <= -93e6 && neg.hi >= 0);
  const svg = barsSvg([{ label: 'JUN', values: { a: 1, b: 0 } }, { label: 'NEXT', values: { b: 2 }, open: { b: true } }], series, { width: 300, height: 150 });
  assert.equal((svg.match(/<rect /g) || []).length, 2, 'a zero bar is not drawn');
  assert.match(svg, /class="mb-open"/);
  assert.match(svg, /<title>NEXT B: 2\.00<\/title>/);
  assert.equal(barsSvg([], series), '');
});

test('insiders: monthly dollars bought and sold, as filed', () => {
  const rows = [
    { date: '2026-09-15', kind: 'PLAN SELL', value: 475000 },
    { date: '2026-09-01', kind: 'SELL', value: 25000 },
    { date: '2026-06-16', kind: 'BUY', value: 1000 },
    { date: '2026-06-15', kind: 'OPTION', value: null },
    { date: '2026-06-15', kind: 'DISPOSED', value: 4.8e6 },
    { date: '2025-09-30', kind: 'SELL', value: 9 },
  ];
  const m = monthlyTotals(rows);
  assert.equal(m.length, 12);
  assert.equal(m[0].key, '2025-10');
  assert.equal(m.at(-1).key, '2026-09');
  assert.equal(m.at(-1).sells, -500000);
  const jun = m.find((o) => o.key === '2026-06');
  assert.deepEqual([jun.label, jun.buys, jun.sells], ['JUN', 1000, 0]);
  // Rows older than the window are left out; an incomplete list starts at its oldest month.
  assert.equal(m.reduce((a, o) => a + o.sells, 0), -500000);
  assert.equal(monthlyTotals(rows.slice(0, 3), 12, { complete: false })[0].key, '2026-06');
  assert.deepEqual(monthlyTotals([]), []);
  const html = insidersTable([{ date: '2026-09-15', insider: 'A <B>', title: 'Officer', kind: 'SELL', transaction: 'Sell', shares: 10, price: 5, value: 50 }]);
  assert.match(html, /SEP 15, 2026/);
  assert.match(html, /A &lt;B&gt;/);
  assert.equal((html.match(/class="th-sort/g) || []).length, 7, 'every header sorts');
});

test('beats: next report date from the calendar text, and the chart groups', () => {
  const d = { reportText: "Apple Inc. Common Stock is estimated to report earnings on  10/29/2026. The upcoming earnings date is derived from an algorithm. According to Zacks Investment Research, based on  8 analysts' forecasts, the consensus EPS forecast for the quarter is $1.98.  The reported EPS for the same quarter last year was $1.85.", announcement: 'Earnings announcement* for AAPL: Oct 29, 2026' };
  assert.deepEqual(parseNextReport(d, '2026-09-25'), { date: '2026-10-29', estimated: true, consensus: 1.98 });
  assert.equal(parseNextReport(d, '2026-11-01'), null, 'a past date is dropped');
  assert.deepEqual(parseNextReport({ reportText: 'Microsoft is expected to report earnings on 10/28/2026 after market close.' }, '2026-09-25'), { date: '2026-10-28', estimated: false, consensus: null });
  assert.equal(parseNextReport({ reportText: 'No date.' }, '2026-09-25'), null);
  assert.equal(parseNextReport(null, '2026-09-25'), null);
  assert.equal(shortQuarter('Jun 2026'), "JUN '26");
  const rows = [{ quarter: 'Jun 2026', reported: '2026-07-30', eps: 1.91, consensus: 1.88, surprisePct: 1.6 }, { quarter: 'Mar 2026', reported: '2026-04-30', eps: 2.01, consensus: 1.92, surprisePct: 4.69 }];
  const g = beatsGroups(rows, { date: '2026-10-29', estimated: true, consensus: 1.98 });
  assert.deepEqual(g.map((x) => x.label), ["MAR '26", "JUN '26", 'NEXT']);
  assert.deepEqual(g[2], { label: 'NEXT', values: { consensus: 1.98 }, open: { consensus: true } });
  assert.equal(beatsGroups(rows, { date: '2026-10-29', consensus: null }).length, 2);
  assert.equal(nextLine({ date: '2026-10-29', estimated: true }), 'OCT 29, 2026 (estimated)');
  assert.match(beatsTable(rows, { date: '2026-10-29', estimated: false, consensus: 1.98 }), /Next report<\/th>\s*<td class="date hide-m">OCT 29, 2026<\/td>/);
});

test('shorts: dates plain, short interest stands out, trend oldest first', () => {
  const rows = [{ date: '2026-09-15', shortInterest: 128753092, changePct: -7.87, avgVolume: 45.1e6, daysToCover: 2.85 }, { date: '2026-08-31', shortInterest: 139749097, changePct: 20.13, avgVolume: 39.5e6, daysToCover: 3.53 }];
  assert.deepEqual(trendPoints(rows).map((p) => p.d), ['2026-08-31', '2026-09-15']);
  const html = shortsTable(rows);
  assert.match(html, /<td class="date">SEP 15, 2026<\/td>/);
  assert.match(html, /<td class="num last"><span class="d-only">128,753,092<\/span>/);
});

test('filings: key filings by default, counts in the filter row', () => {
  assert.equal(isKeyFiling('10-K'), true);
  assert.equal(isKeyFiling('4'), false);
  assert.equal(isKeyFiling('144'), false);
  assert.equal(isKeyFiling('SCHEDULE 13G/A'), false);
  assert.equal(isKeyFiling('DEF 14A'), true);
  const rows = [{ form: '4', family: '4' }, { form: '10-Q', family: '10-Q' }, { form: '144', family: null }, { form: 'SD', family: null }];
  const f = filterFilings(rows, 'KEY');
  assert.deepEqual(f.rows.map((r) => r.form), ['10-Q', 'SD']);
  assert.equal(f.counts.KEY, 2);
  assert.equal(f.counts.ALL, 4);
  const seg = filingChips('AAPL', 'KEY', { KEY: 320, ALL: 1000 });
  assert.match(seg, /class="seg-item is-active" href="\?c=FILINGS\+AAPL" data-cmd="FILINGS AAPL" aria-current="true">KEY FILINGS <span class="seg-n">320<\/span>/);
  assert.match(seg, /data-cmd="FILINGS AAPL ALL"[^>]*>ALL <span class="seg-n">1,000<\/span>/);
  assert.match(filingsTable([{ filed: '2026-07-31', form: '10-Q', description: 'Quarterly report', url: 'https://www.sec.gov/x', period: '2026-06-27' }]), /JUL 31, 2026[\s\S]*href="https:\/\/www\.sec\.gov\/x"/);
});

test('owners: one table, no box inside the panel, counts with commas', () => {
  const html = holdersTable([{ holder: 'Vanguard', shares: 1.4e9, pctOfShares: 9.77, change: 1, changePct: 1.9, value: 4.8e11, asOf: '2025-12-31' }]);
  assert.match(html, /^<table class="dt is-sortable">/);
  assert.match(html, /DEC 31, 2025/);
  assert.equal(panelTools({ shown: 25, total: 6494 }), '<span class="panel-tools"><span class="tools-count">25 OF 6,494</span></span>');
});

test('owners: holders that did not refile are greyed apart, and the note says what totals count', () => {
  const old = notRefiledHtml([{ holder: 'Vanguard Group Inc', shares: 1.43e9, pctOfShares: 9.77, change: 26856752, changePct: 1.919, value: 4.79e11, asOf: '2025-12-31' }], '2026-06-30');
  assert.match(old, /class="co-wide dim own-old"/);
  assert.match(old, /Not refiled this quarter: latest 13F older than JUN 30, 2026/);
  assert.doesNotMatch(old, /th-sort|class="up"|class="down"/, 'no sorting and no up or down colour');
  assert.equal(notRefiledHtml([], '2026-06-30'), '');
  const note = ownersNote({ quarterOnly: true, quarter: '2026-06-30', notRefiled: { holders: 287, shares: 1517017434 }, reported: { institutionalPct: 76.57 } });
  assert.match(note, /only filings for JUN 30, 2026/);
  assert.match(note, /287 holders whose latest filing is older/);
  assert.match(note, /own total, with them, is 76\.57%/);
  assert.match(ownersNote({ quarterOnly: false }), /old ones too/);
});

test('watch and pf: the same row actions at the right edge, remove last', () => {
  const acts = rowActions([{ act: 'edit', label: 'EDIT', aria: 'Edit AAPL', text: true }, { act: 'remove', label: '×', aria: 'Remove AAPL' }]);
  assert.match(acts, /^<td class="wl-act row-acts"><button type="button" class="wl-btn is-text" data-act="edit"/);
  assert.match(acts, /data-act="remove"[^>]*>×<\/button><\/td>$/);
  const w = watchTable([{ id: 'AAPL', quote: null }, { id: 'MSFT', quote: null }]);
  assert.match(w, /data-act="up" aria-label="Move AAPL up" title="Move AAPL up" disabled/);
  assert.match(w, /row-acts/);
  // Every labelled WATCH header sorts, the day range too.
  assert.match(w, /data-sort="day">Day range/);
  assert.equal(SORTS.day({ quote: { low: 10, high: 20, last: 15 } }), 0.5);
  const v = valuePortfolio([{ ticker: 'AAPL', shares: 10, cost: 150 }], {});
  assert.match(pfTable(v), /data-id="AAPL"[\s\S]*data-act="edit"[\s\S]*data-act="remove"/);
});

test('watch and pf: add forms, quiet tools, clear asks first', () => {
  assert.deepEqual(readSymbols(' aapl, tsla  eurusd '), { ids: ['AAPL', 'TSLA', 'EURUSD'], bad: [] });
  assert.deepEqual(readSymbols('AAPL $$$').bad, ['$$']);
  assert.match(listTools([{ tool: 'export', label: 'EXPORT' }, { tool: 'clear', label: 'CLEAR' }]), /class="quiet" data-tool="clear">CLEAR/);
  const ask = listTools([], { confirming: true, count: 5, what: 'symbols' });
  assert.match(ask, /Clear all 5 symbols\?/);
  assert.match(ask, /data-tool="clear-yes">YES, CLEAR[\s\S]*data-tool="clear-no">KEEP/);
  // Placeholders are words, never sample numbers.
  const form = pfForm();
  for (const ph of form.match(/placeholder="[^"]*"/g)) assert.doesNotMatch(ph, /\d/);
  assert.deepEqual(readPfForm({ ticker: 'aapl', shares: '10', price: '$150' }), { action: 'add', ticker: 'AAPL', shares: 10, cost: 150, mutates: true });
  assert.equal(readPfForm({ ticker: 'AAPL', shares: '0', price: '150' }).error, 'shares');
  assert.equal(readPfForm({ ticker: 'AAPL', shares: '1', price: '' }).error, 'cost');
  assert.equal(readPfForm({ ticker: '', shares: '1', price: '2' }).error, 'usage');
  assert.equal(readPfForm({ ticker: 'SPX', shares: '1', price: '2' }).error, 'kind');
  const h = [{ ticker: 'AAPL', shares: 10, cost: 150 }, { ticker: 'MSFT', shares: 5, cost: 300 }];
  assert.deepEqual(setHolding(h, { ticker: 'AAPL', shares: 7, cost: 160 }), [{ ticker: 'AAPL', shares: 7, cost: 160 }, h[1]]);
  assert.deepEqual(setHolding(h, { ticker: 'NVDA', shares: 1, cost: 100 }).map((x) => x.ticker), ['AAPL', 'MSFT', 'NVDA']);
});

test('desk embeds: no "1)" numbering, the map fits the panel', () => {
  assert.equal(stripNumber('1) AAPL'), 'AAPL');
  assert.equal(stripNumber('12) CHART 1Y'), 'CHART 1Y');
  assert.equal(stripNumber('S&P 100 HEATMAP'), 'S&P 100 HEATMAP');
  assert.equal(fitHeight(420, 60), 359);
  assert.equal(fitHeight(200, 150), 120, 'never below 120');
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /if \(embed\) cleanups\.push\(compactEmbed\(view\)\)/);
});

test('options: BID then ASK on both sides of the strike', () => {
  const keys = (cols) => cols.map((c) => c[0]);
  assert.deepEqual(keys(CALL_COLS).slice(-2), ['bid', 'ask']);
  assert.deepEqual(keys(PUT_COLS).slice(0, 2), ['bid', 'ask']);
  assert.deepEqual(keys(CALL_COLS).slice(0, 5), ['delta', 'iv', 'oi', 'volume', 'last']);
  const html = chainTable([{ strike: 100, call: { bid: 1, ask: 2 }, put: { bid: 3, ask: 4 } }], 101, 'XYZ', 0);
  const heads = [...html.matchAll(/<th scope="col" class="num[^"]*">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads.filter((h) => h === 'Bid' || h === 'Ask'), ['Bid', 'Ask', 'Bid', 'Ask']);
});

test('screen: one preset set under the title, placeholders are words', () => {
  const bar = presetBar('GAINERS');
  assert.match(bar, /class="toolbar"/);
  assert.match(bar, /data-value="GAINERS" aria-pressed="true"/);
  assert.equal((bar.match(/data-value=/g) || []).length, 4);
  const src = readFileSync('public/screens/screen.js', 'utf8');
  assert.doesNotMatch(src, /<select name="preset"/, 'no preset dropdown');
  assert.doesNotMatch(src, /Presets: \$\{/, 'no second preset list');
  assert.doesNotMatch(src, /placeholder="\$\{esc\(HINTS/, 'no sample numbers in the boxes');
});

test('no screen draws its own tab strip or star for a stock', () => {
  for (const f of ['quote', 'options', 'financials', 'company-kit', 'insiders', 'owners', 'filings', 'shorts', 'beats', 'value', 'profile', 'history', 'dividends', 'tickernews']) {
    const s = readFileSync(`public/screens/${f}.js`, 'utf8');
    assert.doesNotMatch(s, /fnBarHtml|mountFnBar|companyLinks|class="fnbar"/, f);
  }
  assert.doesNotMatch(readFileSync('public/nav.css', 'utf8'), /\.fnbar|\.co-links/, 'nothing left to hide');
});

test('whatif: even picker columns, one multiple format on page and certificate', () => {
  const g = splitGroups([{ name: 'Apple', items: Array.from({ length: 22 }, (_, i) => i) }, { name: 'Tesla', items: [1, 2, 3, 4] }]);
  assert.deepEqual(g.map((x) => [x.name, x.items.length, x.part]), [['Apple', 11, 1], ['Apple', 11, 2], ['Tesla', 4, undefined]]);
  for (const m of [11.1234, 2.2066, 0.53, 0.042, 131.6]) assert.equal(fmtX(m), certMultiple(m), String(m));
  assert.equal(fmtX(11.12), '11.1x');
});

test('afford: a wage field instead of a command, and a share row', () => {
  assert.equal(readWageInput('35'), 35);
  assert.equal(readWageInput('$1,200.50'), 1200.5);
  assert.equal(readWageInput('0'), null);
  assert.equal(readWageInput('abc'), null);
  assert.equal(readWageInput('200000'), null);
  const r = buyMaths({ price: 1200, times: 1, unit: 'WEEK', years: 3 });
  const share = affordShare(r, 'AFFORD 1200', 'https://bloombroke.com');
  assert.match(share, /data-copy="https:\/\/bloombroke\.com\/\?c=AFFORD\+1200"/);
  assert.match(share, /x\.com\/intent\/post\?text=/);
  const html = buyHtml(r, share);
  assert.ok(html.indexOf('buy-side') < html.indexOf('buy-share'), 'the share row comes after the verdict');
  assert.doesNotMatch(html, /Type <a class="code"[^>]*>WAGE 35/);
  assert.doesNotMatch(share, /invest|recommend/i, 'no advice wording');
});

test('loan and compound: the by-year table sits beside the chart', () => {
  for (const f of ['loan', 'compound']) {
    const s = readFileSync(`public/screens/${f}.js`, 'utf8');
    assert.match(s, /<div class="chart-by-year">/, f);
    assert.match(s, /cls: 'by-year', bodyCls: 'flush'/, f);
  }
});

test('copy rules for the ui-company files', () => {
  const files = ['public/company-ui.css', 'public/embed.js', 'public/screens/minibars.js', 'public/screens/history.js', 'public/screens/watch.js', 'public/screens/screen.js', 'public/screens/options.js'];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /amber|#ffb|hsl\((3\d|4\d|5\d),/i, `${f}: amber`);
  }
});
