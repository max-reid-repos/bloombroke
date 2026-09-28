// GRID: the parser (command bar and /api/grid alike), the tile line with its labelled
// high and low, the phone rows, /api/grid, the share card and its page meta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import sharp from 'sharp';
import {
  parseGrid, gridItem, gridCmd, gridSuggest, gaugeCommand, isGridStarter,
  GRID_MAX, GRID_STARTER, GRID_RANGE_CHIPS,
} from '../public/command-args.js';
import { parseCommand } from '../public/app.js';
import {
  layoutFor, gridSparkSvg, placeLabel, marksFor, tileHtml, tileFace, openCmd, starterButton, rangeChips,
  saveLastBoard, boardKeyAction, sceneKeys, LAST_KEY,
  shareLinks, stepIndex, cleanBoard, LABEL_CHAR_W, toInput,
} from '../public/screens/grid.js';
import {
  makeGrid, mountGrid, downsample, seriesStats, loadCpiMonthly, cpiTile, ripTile, weirdTile, marketTile, periodStart, GRID_POINTS, GRID_PARALLEL,
} from '../lib/grid.js';
import { makeGridCards, gridCardModel, cardBoard, gridMeta, gridTree, mountGridCards } from '../lib/og-grid.js';
import { makeRateLimit, withMeta, W, H } from '../lib/og.js';
import { ChartError } from '../data/charts.js';
import { loadGraveyardData } from '../lib/graveyard.js';

const GRAVES = loadGraveyardData();
const DAY = 86_400_000;
const series = (n, f = (i) => 100 + Math.sin(i / 5) * 10 + i * 0.1) => Array.from({ length: n }, (_, i) => ({ t: Date.UTC(2025, 0, 1) + i * DAY, v: f(i) }));

// ---- the parser ----------------------------------------------------------------------------

test('GRID parser: tokens, prefixes, the range, $ stocks, aliases', () => {
  const p = parseGrid(['NVDA', 'W:EGGS', 'WEIRD:PIZZA', 'RIP:LEH', 'CPI', 'BBRK', '$GOLD', 'OIL', 'BITCOIN', '$AAPL', 'GOLD', '5Y']);
  assert.equal(p.range, '5Y');
  assert.equal(p.rangeGiven, true);
  assert.deepEqual(p.tokens, ['NVDA', 'W:EGGPRICE', 'W:PIZZA', 'RIP:LEH', 'CPI', 'BBRK', '$GOLD', 'WTI', 'BTC', 'AAPL', 'GOLD']);
  assert.deepEqual(p.items.map((i) => i.kind), ['market', 'weird', 'weird', 'rip', 'cpi', 'bbrk', 'market', 'market', 'market', 'market', 'market']);
  assert.equal(parseGrid(['NVDA']).range, '1Y', '1Y by default');
  const r = parseGrid(['5Y', 'NVDA', 'MAX', 'AMD']);
  assert.deepEqual([r.tokens, r.range, r.rangeGiven], [['NVDA', 'AMD'], 'MAX', true], 'a range word anywhere sets the range, the last wins, never a tile');
  assert.equal(gaugeCommand('PIZZINT'), 'PIZZA', 'a registry alias');
  assert.equal(gaugeCommand('BUZZ'), 'BUZZWORD');
  assert.equal(gridItem('BUZZ').kind, 'market', 'BUZZ alone is the ETF: W: is needed for the gauge');
  assert.equal(gridItem('w:buzz').token, 'W:BUZZWORD');
  assert.equal(gridItem('RIP:le-h').kind, 'unknown');
  assert.equal(gridItem(''), null);
  assert.deepEqual(parseGrid(['nvda,amd', 'intc']).tokens, ['NVDA', 'AMD', 'INTC'], 'commas split too');
});

test('GRID parser: duplicates drop, 16 at most, unknown words become NO SUCH TICKER tiles', () => {
  assert.deepEqual(parseGrid(['NVDA', 'nvda', 'W:EGGS', 'W:EGGPRICE', 'OIL', 'WTI']).tokens, ['NVDA', 'W:EGGPRICE', 'WTI']);
  const many = parseGrid(Array.from({ length: 20 }, (_, i) => `T${String.fromCharCode(65 + i)}`));
  assert.equal(many.items.length, GRID_MAX);
  assert.equal(many.dropped, 4);
  assert.equal(GRID_MAX, 16);
  const u = parseGrid(['NVIDIA', 'W:NOPE', 'EGGPRICE']);
  assert.deepEqual(u.items.map((i) => [i.token, i.kind, i.suggest]), [['NVIDIA', 'unknown', 'NVDA'], ['W:NOPE', 'unknown', null], ['EGGPRICE', 'unknown', 'W:EGGPRICE']]);
  assert.equal(gridSuggest('APPL'), 'AAPL', 'one letter off a known ticker');
  assert.equal(gridSuggest('ZZZZZZ'), null);
});

test('GRID STARTER: bare GRID falls back to it, STARTER alone names it, $ still forces a stock', () => {
  assert.equal(GRID_STARTER.length, 16);
  assert.deepEqual(GRID_STARTER, ['SPX', 'NDX', 'NVDA', 'TSLA', 'AAPL', 'BTC', 'ETH', 'GOLD', 'WTI', 'US10Y', 'VIX', 'CPI', 'W:CANAL', 'W:EGGPRICE', 'RIP:LEH', 'BBRK']);
  assert.deepEqual(parseGrid(GRID_STARTER).tokens, GRID_STARTER, 'every starter token is already canonical');
  assert.ok(parseGrid(GRID_STARTER).items.every((i) => i.kind !== 'unknown'));
  assert.ok(!GRID_STARTER.includes('W:WAFFLE'), 'no waffle gauge');
  assert.ok(GRID_STARTER.includes('CPI'), 'US CPI from BLS is on hand, so no DXY stand-in');
  const s = parseGrid(['STARTER', '5Y']);
  assert.deepEqual([s.starter, s.range, s.tokens.length], [true, '5Y', 16]);
  assert.deepEqual(parseGrid(['STARTER', 'NVDA']).tokens, ['NVDA'], 'with other words STARTER is dropped');
  assert.ok(!GRID_STARTER.includes('W:PIZZA'), 'PIZZA is often NO DATA: CANAL stands in');
  assert.equal(isGridStarter(GRID_STARTER), true);
  assert.equal(gridCmd({ tokens: GRID_STARTER }), 'GRID STARTER');
  assert.equal(parseCommand('grid starter').input, 'GRID STARTER');
  // No preset words: they are other screens (MARKETS, CRYPTO, WEIRD, GRAVEYARD, DESK MACRO).
  for (const w of ['BIGTECH', 'CRYPTO', 'GRAVEYARD']) assert.equal(parseGrid([w]).items[0].kind, 'unknown', w);
  assert.equal(parseGrid(['WEIRD']).items[0].kind, 'market', 'WEIRD is ticker-shaped: a stock tile, W:PIZZA is the gauge');
  assert.deepEqual(parseGrid(['MACRO']).tokens, ['MACRO'], 'MACRO is a ticker-shaped word like any other');
  assert.deepEqual(parseCommand('GRID $AAPL $GOLD').args.tokens, ['AAPL', '$GOLD'], '$ forces the stock');
});

test('GRID command: the canonical URL, bare GRID, toInput', () => {
  assert.equal(gridCmd({ tokens: ['NVDA', 'AMD', 'INTC'], range: '1Y' }), 'GRID NVDA AMD INTC');
  assert.equal(gridCmd({ tokens: ['NVDA'], range: '5Y' }), 'GRID NVDA 5Y');
  assert.equal(gridCmd({ tokens: [], range: '1Y' }), 'GRID');
  const bare = parseCommand('GRID');
  assert.equal(bare.name, 'GRID');
  assert.equal(bare.args.bare, true);
  assert.equal(bare.url, 'GRID');
  const p = parseCommand('grid nvda amd intc 1y');
  assert.equal(p.input, 'GRID NVDA AMD INTC');
  assert.equal(toInput(p.args), p.input);
  // A pasted link rebuilds the same board.
  assert.deepEqual(parseCommand(p.input).args.tokens, p.args.tokens);
  assert.deepEqual(cleanBoard({ tokens: ['nvda', 'NVDA', 'W:EGGS'], range: 'NOPE' }), { tokens: ['NVDA', 'W:EGGPRICE'], range: '1Y' });
  assert.equal(cleanBoard(null), null);
});

// ---- the line --------------------------------------------------------------------------------

const textsOf = (svg) => [...svg.matchAll(/<text class="gr-lab" x="([\d.-]+)" y="([\d.-]+)">([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));

test('GRID line: H and L dots with labels, no inline styles', () => {
  const tile = marketTile('NVDA', { points: series(200) });
  const marks = marksFor(tile);
  assert.deepEqual(marks.map((m) => m.text.slice(0, 2)), ['H ', 'L ']);
  assert.match(marks[0].text, /^H \d/);
  const svg = gridSparkSvg(tile.points, { w: 300, h: 100, marks, dir: 'up' });
  assert.equal((svg.match(/<circle class="gr-dot"/g) || []).length, 2);
  assert.equal(textsOf(svg).length, 2);
  assert.match(svg, /class="gr-line up"/);
  assert.doesNotMatch(svg, /style=/, 'no inline styles: the CSP blocks them');
  assert.equal(gridSparkSvg([{ t: 0, v: 1 }], { w: 100, h: 50 }), '');
  assert.deepEqual(marksFor({ points: [{ t: 0, v: 1 }, { t: 1, v: 1 }] }), [], 'a flat line has no high or low');
  assert.match(marksFor({ points: [{ t: 0, v: 4.1 }, { t: 1, v: 4.5 }], decimals: 3, unit: '%' })[0].text, /^H 4\.500%$/);
});

test('GRID line: labels stay inside the tile, flipping near the edges', () => {
  const sizes = [[60, 30], [120, 44], [170, 60], [300, 100], [900, 400]];
  const shapes = [(i) => i, (i) => -i, (i) => Math.sin(i), (i) => (i === 0 ? 100 : i === 59 ? -100 : 0), (i) => (i === 59 ? 100 : i === 0 ? -100 : 0)];
  for (const [w, h] of sizes) {
    for (const f of shapes) {
      const pts = Array.from({ length: 60 }, (_, i) => ({ t: i, v: f(i) }));
      const tile = { points: pts, decimals: 2 };
      const svg = gridSparkSvg(pts, { w, h, marks: marksFor(tile) });
      for (const l of textsOf(svg)) {
        const lw = l.text.length * LABEL_CHAR_W;
        if (lw > w - 4) continue; // a label wider than the whole tile cannot fit; it starts at the edge
        assert.ok(l.x >= 1.9 && l.x + lw <= w - 1.9 + 1e-6, `${w}x${h} ${l.text} at x ${l.x}`);
        assert.ok(l.y - 8 >= 0 && l.y <= h, `${w}x${h} ${l.text} at y ${l.y}`);
      }
    }
  }
  // Near the right edge the label flips to the dot's left.
  const at = placeLabel(295, 50, 'H 123.45', 'above', 300, 100);
  assert.ok(at.x + at.w <= 298 && at.x < 295);
  assert.ok(placeLabel(5, 50, 'L 1.00', 'below', 300, 100).x > 5, 'near the left edge it stays right of the dot');
});

test('GRID layout and keys', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13, 16, 17].map((n) => { const l = layoutFor(n); return `${l.cols}x${l.rows}`; }),
    ['1x1', '2x1', '2x2', '2x2', '3x2', '3x2', '3x3', '3x3', '4x3', '4x3', '4x4', '4x4', '4x4']);
  assert.equal(stepIndex(-1, 'ArrowRight', 4, 10), 0);
  assert.equal(stepIndex(0, 'ArrowRight', 4, 10), 1);
  assert.equal(stepIndex(1, 'ArrowDown', 4, 10), 5);
  assert.equal(stepIndex(8, 'ArrowDown', 4, 10), 8, 'no tile below: stays');
  assert.equal(stepIndex(0, 'ArrowLeft', 4, 10), 0);
  const src = readFileSync('public/screens/grid.js', 'utf8');
  assert.match(src, /t\?\.id === 'cmd'/, 'keys typed in the command bar are never taken');
  assert.match(src, /closest\?\.\('input, textarea, select, \[contenteditable\]'\)\) return/, 'nor in any input');
});

// ---- tiles and phone rows ------------------------------------------------------------------------

test('GRID tiles: numbers first, and one-line phone rows that open in place', () => {
  const item = gridItem('NVDA');
  const tile = { ...marketTile('NVDA', { points: series(50) }), name: 'Nvidia' };
  const html = tileHtml(item, tile, { i: 3, range: '5Y' });
  // The row: symbol, a tiny line, the value, the change.
  const row = /<div class="gr-row" data-row>(.*?)<\/div>/s.exec(html)[1];
  assert.match(row, /<span class="gr-sym">NVDA<\/span>/);
  assert.match(row, /<span class="gr-mini" aria-hidden="true"><\/span>/);
  assert.match(row, /<span class="gr-val num">[\d,.]+<\/span>/);
  assert.match(row, /<span class="gr-chg num (up|down|flat)">[+−]?[\d.]+%<\/span>/);
  // The whole tile: the big value with its change pill, the line, OPEN (shown when open).
  assert.match(html, /<span class="gr-big num">[\d,.]+<\/span><span class="gr-pill num (up|down|flat)">/);
  assert.match(html, /<div class="gr-chart"><\/div>/);
  assert.match(html, /<a class="gr-open code" href="\?c=NVDA\+5Y" data-cmd="NVDA 5Y">OPEN<\/a>/);
  assert.match(html, /data-i="3"/);
  assert.doesNotMatch(html, /is-open/);
  assert.match(tileHtml(item, tile, { i: 3, open: true }), /class="gr-tile is-market is-open"/);
  assert.match(html, /class="gr-x" data-x tabindex="-1" aria-label="Remove NVDA">×</);
  assert.doesNotMatch(html, /style=/);
  const css = readFileSync('public/screens/grid.css', 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 639px)'));
  assert.match(phone, /html:not\(\.is-embed\) \.gr-board \{ grid-template-columns: minmax\(0, 1fr\)/, 'a phone shows rows, not 2 columns');
  assert.match(phone, /\.gr-tile:not\(\.is-open\) \.gr-full \{ display: none; \}/);
  assert.match(phone, /\.gr-chips \{[^}]*overflow-x: auto/, 'the chips scroll sideways inside the bar');
  assert.match(css, /\.gr-panel\.is-embed \.gr-bar, \.gr-panel\.is-embed \.gr-foot, \.gr-panel\.is-embed \.gr-x, \.gr-panel\.is-embed \.gr-dym \{ display: none; \}/, 'a DESK panel: the board alone');
  // Faces for every kind.
  assert.deepEqual(tileFace(gridItem('NVIDIA'), { error: 'not_found', suggest: 'NVDA' }), { msg: 'NO SUCH TICKER', suggest: 'NVDA' });
  assert.match(tileHtml(gridItem('NVIDIA'), { token: 'NVIDIA', error: 'not_found', suggest: 'NVDA' }), /Did you mean <button type="button" class="gr-swapto" data-swap="NVDA">NVDA<\/button>\?/);
  assert.equal(tileFace(gridItem('NVDA'), null).msg, 'LOADING...');
  assert.equal(tileFace(gridItem('NVDA'), { error: 'no_data' }).msg, 'NO DATA');
  const rip = ripTile(gridItem('RIP:LEH'), GRAVES.stones.find((e) => e.ticker === 'LEH'));
  assert.deepEqual([tileFace(gridItem('RIP:LEH'), rip).big, tileFace(gridItem('RIP:LEH'), rip).pill], ['$0.00', 'RIP']);
  const bb = tileFace(gridItem('BBRK'), { kind: 'bbrk', views7: 12345, here: 7 });
  assert.equal(bb.big, '12,345');
  assert.match(bb.sub, /page views this week · 7 here now/);
  assert.deepEqual(['NVDA', '$GOLD', 'CPI', 'W:EGGS', 'RIP:LEH', 'BBRK'].map((t) => openCmd(gridItem(t), '5Y')), ['NVDA 5Y', '$GOLD 5Y', 'CPI', 'EGGPRICE 5Y', 'GRAVEYARD LEH', 'BBRK']);
  for (const c of ['NVDA 5Y', '$GOLD 5Y', 'CPI', 'EGGPRICE 5Y', 'GRAVEYARD LEH', 'BBRK']) assert.notEqual(parseCommand(c).name, 'UNKNOWN', c);
});

test('GRID chips, STARTER and SHARE', () => {
  const r = rangeChips('5Y');
  assert.deepEqual([...r.matchAll(/data-range="(\w+)"/g)].map((m) => m[1]), ['1M', '1Y', '5Y', 'MAX']);
  assert.equal((r.match(/is-active/g) || []).length, 1);
  assert.match(rangeChips('3M'), /data-range="3M" aria-pressed="true">3M</, 'a typed range shows as its own chip');
  assert.equal(starterButton(GRID_STARTER), '', 'on the starter board: no STARTER button');
  assert.match(starterButton(['NVDA']), /<button type="button" class="gr-starter" data-starter>STARTER<\/button>/);
  const links = shareLinks(['NVDA', 'AMD'], '5Y', 'https://bloombroke.com');
  assert.equal(links.url, 'https://bloombroke.com/?c=GRID+NVDA+AMD+5Y');
  assert.match(links.x, /^https:\/\/x\.com\/intent\/post\?/);
  assert.equal(shareLinks(GRID_STARTER, '1Y', 'https://b.test').url, 'https://b.test/?c=GRID+STARTER');
});

// ---- the server ------------------------------------------------------------------------------------

test('GRID data: downsample keeps the high and the low, stats, CPI from BLS, the stone cliff', () => {
  const pts = series(1000, (i) => (i === 333 ? 500 : i === 777 ? 1 : 100 + (i % 7)));
  const d = downsample(pts);
  assert.equal(d.length, GRID_POINTS);
  assert.ok(d.some((p) => p.v === 500) && d.some((p) => p.v === 1));
  assert.equal(d[0], pts[0]);
  assert.equal(d[d.length - 1], pts[pts.length - 1]);
  assert.ok(d.every((p, i) => i === 0 || p.t > d[i - 1].t));
  const s = seriesStats([{ t: 1, v: 10 }, { t: 2, v: 15 }, { t: 3, v: 5 }, { t: 4, v: 12 }]);
  assert.ok(Math.abs(s.changePct - 20) < 1e-9);
  assert.deepEqual({ ...s, changePct: 20 }, { last: 12, changePct: 20, hi: { v: 15, t: 2 }, lo: { v: 5, t: 3 } });
  const cpi = loadCpiMonthly();
  assert.ok(cpi.length > 200, 'BLS CPI-U monthly, from data/bls-monthly.json');
  const c1 = cpiTile('1Y', cpi);
  assert.equal(c1.points.length, 13);
  assert.equal(c1.kind, 'cpi');
  assert.equal(cpiTile('1D', cpi).points.length, 13, 'a month is the smallest step: at least a year');
  assert.equal(cpiTile('MAX', cpi).points.length, Math.min(GRID_POINTS, cpi.length));
  assert.equal(periodStart('2003-Q4'), Date.UTC(2003, 9, 1));
  assert.equal(periodStart('2000-03/2000-05'), Date.UTC(2000, 2, 1));
  const leh = ripTile(gridItem('RIP:LEH'), GRAVES.stones.find((e) => e.ticker === 'LEH'));
  assert.deepEqual(leh.marks.map((m) => m.text), ['PEAK FEB 2007', 'FILED SEP 2008']);
  assert.equal(leh.points[2].v, 100);
  assert.ok(leh.points[4].v < 10 && leh.points[5].v === 0, 'off the cliff, to nothing');
  const w = weirdTile(gridItem('W:EGGS'), { id: 'eggs', ok: true, headline: '$2.27 A DOZEN', spark: [3, 2, 6, 1] });
  assert.deepEqual([w.headline, w.hi.v, w.lo.v, w.points.length], ['$2.27 A DOZEN', 6, 1, 4]);
  assert.equal(weirdTile(gridItem('W:PIZZA'), { id: 'pizza', ok: false, headline: 'NO DATA' }).error, 'no_data');
  assert.equal(weirdTile(gridItem('W:PIZZA'), { id: 'pizza', pending: true, ok: false }).error, 'pending');
});

async function listen(app) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function fakeDeps() {
  const calls = [];
  let running = 0;
  let peak = 0;
  const getChart = async (sym, range) => {
    calls.push(`${sym}:${range}`);
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    if (sym === 'BUSY') throw new ChartError('unavailable', 'x'); // what getChart makes of a busy gate
    if (sym === 'DOWN') throw new ChartError('unavailable', 'x');
    if (sym === 'APPL' || sym === 'LEH') throw new ChartError('not_found', 'x');
    return { points: series(300), stale: false };
  };
  let weirdCalls = 0;
  const getWeird = async () => { weirdCalls += 1; return { gauges: [{ id: 'eggs', ok: true, headline: '$2.27 A DOZEN', spark: [3, 2, 6, 1] }, { id: 'pizza', ok: false, headline: 'NO DATA' }] }; };
  const audience = { get: async () => ({ pageviews: { d7: 4321 }, live: 5 }) };
  return { calls, peak: () => peak, weirdCalls: () => weirdCalls, deps: { getChart, getWeird, stones: GRAVES.stones, zombies: GRAVES.zombies, audience } };
}

test('/api/grid: every tile in one answer, 4 charts at a time, a busy one to try again', async () => {
  const f = fakeDeps();
  const app = express();
  mountGrid(app, f.deps);
  const { server, base } = await listen(app);
  try {
    const s = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'BUSY', 'DOWN', 'APPL', 'LEH', 'W:EGGS', 'W:PIZZA', 'RIP:LEH', 'CPI', 'BBRK'];
    const res = await fetch(`${base}/api/grid?${new URLSearchParams({ s: s.join(','), r: '5Y' })}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store', 'a tile to ask about again: not kept');
    const d = await res.json();
    assert.equal(d.range, '5Y');
    assert.equal(d.tiles.length, 16);
    const by = Object.fromEntries(d.tiles.map((t) => [t.token, t]));
    assert.ok(f.peak() <= GRID_PARALLEL && GRID_PARALLEL === 4, `at most 4 at once (${f.peak()})`);
    const ok = by.AA;
    assert.deepEqual(Object.keys(ok).filter((k) => ['token', 'kind', 'label', 'points', 'last', 'changePct', 'hi', 'lo', 'asOf'].includes(k)).length, 9);
    assert.equal(ok.points.length, GRID_POINTS);
    assert.deepEqual(by.BUSY, { token: 'BUSY', kind: 'market', label: 'BUSY', error: 'unavailable' });
    assert.equal(by.DOWN.error, 'unavailable');
    assert.deepEqual([by.APPL.error, by.APPL.suggest], ['not_found', 'AAPL']);
    assert.deepEqual([by.LEH.error, by.LEH.suggest], ['not_found', 'RIP:LEH'], 'a dead ticker points to its stone');
    assert.equal(by['W:EGGPRICE'].headline, '$2.27 A DOZEN');
    assert.equal(by['W:PIZZA'].error, 'no_data');
    assert.equal(f.weirdCalls(), 1, 'one WEIRD read for every gauge tile');
    assert.equal(by['RIP:LEH'].kind, 'rip');
    assert.equal(by.CPI.kind, 'cpi');
    assert.deepEqual([by.BBRK.views7, by.BBRK.here], [4321, 5]);
    // The retry: only the failed ones, and a clean answer is kept a minute.
    const again = await fetch(`${base}/api/grid?s=AA,BB&r=5Y`);
    assert.equal(again.headers.get('cache-control'), 'public, max-age=60');
  } finally { server.close(); }
});

test('/api/grid: the 16 cap, a bad range, the per-address limit', async () => {
  const f = fakeDeps();
  const app = express();
  mountGrid(app, { ...f.deps, allow: makeRateLimit({ renders: 2, windowMs: 60_000, addresses: 10 }) });
  const { server, base } = await listen(app);
  try {
    const s17 = Array.from({ length: 17 }, (_, i) => `T${String.fromCharCode(65 + i)}`).join(',');
    const cap = await fetch(`${base}/api/grid?s=${s17}`);
    assert.equal(cap.status, 400);
    assert.equal((await cap.json()).error, 'usage');
    assert.equal(f.calls.length, 0, 'nothing fetched');
    assert.equal((await fetch(`${base}/api/grid?s=`)).status, 400);
    assert.equal((await fetch(`${base}/api/grid?s=AA&r=7Y`)).status, 400);
    assert.equal((await fetch(`${base}/api/grid?s=AA`)).status, 200);
    assert.equal((await fetch(`${base}/api/grid?s=BB`)).status, 200);
    const limited = await fetch(`${base}/api/grid?s=CC`);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.deepEqual(f.calls, ['AA:1Y', 'BB:1Y'], 'a limited request fetches nothing');
  } finally { server.close(); }
});

// ---- the share card ------------------------------------------------------------------------------------

test('GRID card: cached tiles only, never a fetch; missing tiles show the symbol alone', async () => {
  const f = fakeDeps();
  const grid = makeGrid(f.deps);
  const parsed = cardBoard('NVDA,AMD,RIP:LEH,CPI,W:EGGS', '1Y');
  const cold = gridCardModel(parsed, grid);
  assert.deepEqual(cold.tiles.map((t) => [t.sym, Boolean(t.missing)]), [['NVDA', true], ['AMD', true], ['LEH', false], ['CPI', false], ['EGGPRICE', true]]);
  assert.equal(f.calls.length, 0, 'the card fetched nothing');
  assert.equal(f.weirdCalls(), 0);
  await grid.board(parsed.items, '1Y');
  const warm = gridCardModel(parsed, grid);
  assert.ok(warm.tiles.every((t) => !t.missing));
  assert.match(warm.tiles[0].big, /^[\d,.]+$/);
  assert.ok(warm.tiles[0].marks.length === 2);
  assert.equal(gridCardModel(cardBoard('NVDA', '5Y'), grid).tiles[0].missing, true, 'another range is another tile');
  assert.deepEqual(cardBoard('', '').tokens, GRID_STARTER, 'no s: the starter board');
  assert.deepEqual(cardBoard('STARTER', '5Y').range, '5Y');
  const tree = JSON.stringify(gridTree(warm));
  assert.match(tree, /BLOOMBROKE/);
  assert.match(tree, /GRID NVDA AMD RIP:LEH CPI W:EGGPRICE 1Y/);
  assert.match(tree, /Prices may be delayed\./);
  assert.match(tree, /H \d/);
});

test('GRID card: renders once, kept in memory, the site card past the budget or on failure', async () => {
  const f = fakeDeps();
  const grid = makeGrid(f.deps);
  const site = Buffer.from('site');
  let renders = 0;
  const cards = makeGridCards({
    grid, fallback: async () => site, budget: { renders: 1, windowMs: 60_000 },
    render: async (t) => { renders += 1; return (await import('../lib/og.js')).renderPng(t); },
  });
  await grid.board(cardBoard('NVDA,AMD', '1Y').items, '1Y');
  const a = await cards.png('NVDA,AMD', '1Y', '1.1.1.1');
  assert.equal(a.drawn, true);
  const meta = await sharp(a.png).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', W, H]);
  const again = await cards.png('NVDA,AMD', '1Y', '1.1.1.1');
  assert.equal(again.png, a.png, 'kept in memory');
  assert.equal(renders, 1);
  const over = await cards.png('AMD,NVDA', '1Y', '2.2.2.2');
  assert.deepEqual([over.png, over.drawn, over.maxAge], [site, false, 60], 'past the budget: the site card');
  const broken = makeGridCards({ grid, fallback: async () => site, render: async () => { throw new Error('boom'); } });
  assert.equal((await broken.png('NVDA', '1Y', '3.3.3.3')).png, site);
  const perIp = makeGridCards({ grid, fallback: async () => site, render: async () => Buffer.from('x'), allow: makeRateLimit({ renders: 1, windowMs: 60_000, addresses: 5 }) });
  assert.equal((await perIp.png('NVDA', '1Y', '4.4.4.4')).drawn, true);
  assert.equal((await perIp.png('AMD', '1Y', '4.4.4.4')).png, site, 'per address');
  const src = readFileSync('lib/og-grid.js', 'utf8');
  assert.doesNotMatch(src, /writeFile|mkdir|rename|CACHE_DIR|writeAtomic/, 'no disk cache');
  assert.doesNotMatch(src, /getChart|getWeird|fetch\(/, 'the card never fetches');
});

test('GRID card route and page meta', async () => {
  const f = fakeDeps();
  const grid = makeGrid(f.deps);
  const site = await sharp({ create: { width: W, height: H, channels: 3, background: '#05080C' } }).png().toBuffer();
  const app = express();
  mountGridCards(app, { grid, fallback: async () => site, render: async () => { throw new Error('no'); } });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/og/grid.png?s=NVDA&r=1Y`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), site, 'a failed render: the site card');
  } finally { server.close(); }
  const m = gridMeta('GRID NVDA AMD INTC 1Y', parseCommand);
  assert.equal(m.title, 'GRID: NVDA, AMD, INTC (1Y) | Bloombroke');
  assert.equal(m.image, 'https://bloombroke.com/og/grid.png?s=NVDA%2CAMD%2CINTC&r=1Y');
  assert.equal(m.url, 'https://bloombroke.com/?c=GRID+NVDA+AMD+INTC');
  assert.match(gridMeta('GRID STARTER', parseCommand).title, /^GRID STARTER: SPX, NDX/);
  assert.match(gridMeta('GRID STARTER', parseCommand).image, /s=STARTER/);
  assert.equal(gridMeta('GRID', parseCommand), null, 'bare GRID: lib/seo.js');
  assert.equal(gridMeta('NVDA', parseCommand), null);
  for (const v of Object.values(m)) {
    assert.doesNotMatch(v, /\b(should|recommend|buy|sell|signal|rating)\b/i, v);
  }
});

// ---- copy rules ----------------------------------------------------------------------------------

test('GRID copy: no banned brand word, no vendor names, no em dashes, no amber, no advice', () => {
  const files = ['public/screens/grid.js', 'public/screens/grid.css', 'lib/grid.js', 'lib/og-grid.js'];
  const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(src, new RegExp(['bloom', 'berg'].join(''), 'i'));
  assert.doesNotMatch(src, /—/, 'no em dashes');
  assert.doesNotMatch(src, /amber|orange|#ffb|#f90|hsla?\((2\d|3\d|4\d|5\d),/i, 'no amber');
  assert.doesNotMatch(src, /\b(CNBC|FRED|St\. Louis|Yahoo Finance|Refinitiv)\b/, 'no data vendors named');
  assert.doesNotMatch(src, /\b(buy now|sell now|strong buy|recommend|should buy|buy signal|sell signal|rating)\b/i, 'no advice');
});

// ---- review fixes: DESK panels, hostile words, keys, CPI's own range -------------------------

test('GRID in a DESK panel: view only, never writes the last board', () => {
  const writes = [];
  const store = { get: () => null, set: (k, v) => writes.push([k, v]) };
  assert.equal(saveLastBoard(store, { tokens: ['NVDA'], range: '1Y' }, { embed: true }), false);
  assert.deepEqual(writes, [], 'nothing writes bb.grid from a panel');
  assert.equal(saveLastBoard(store, { tokens: ['NVDA'], range: '1Y' }), true);
  assert.deepEqual(writes, [[LAST_KEY, { tokens: ['NVDA'], range: '1Y' }]]);
  assert.equal(LAST_KEY, 'bb.grid');
  for (const key of ['Delete', 'Backspace', '/']) assert.equal(boardKeyAction(key, { inScene: true, tileAt: 0, embed: true }), null, key);
  assert.equal(boardKeyAction('Delete', { inScene: true, tileAt: 0 }), 'remove');
  assert.equal(boardKeyAction('/', { inScene: true, tileAt: 0 }), 'swap');
  assert.equal(boardKeyAction('Enter', { inScene: true, tileAt: 0, embed: true }), 'open', 'a tile still opens its screen');
  const src = readFileSync('public/screens/grid.js', 'utf8');
  assert.match(src, /function saveLast\(\) \{ saveLastBoard\(store, \{ tokens: tokens\(\), range \}, \{ embed: ctx\.embed \}\); \}/);
  assert.match(src, /function commit\(\) \{\n    if \(ctx\.embed\) return;/);
  for (const f of ['add', 'swap']) assert.match(src, new RegExp(`function ${f}\\([^)]*\\) \\{\\n    if \\(ctx\\.embed\\) return false;`), f);
  assert.match(src, /function remove\(i\) \{\n    if \(ctx\.embed \|\| !items\[i\]\) return;/);
  assert.match(src, /if \(ctx\.embed && e\.target\.closest\('\[data-x\], \[data-swap\]'\)\)/, 'x and did you mean do nothing in a panel');
  assert.match(readFileSync('public/screens/grid.css', 'utf8'), /\.gr-panel\.is-embed \.gr-dym/);
});

test('GRID keys: only with the focus inside the board; never in the command bar or an input', () => {
  assert.equal(boardKeyAction('ArrowDown', { inScene: false }), null, 'focus on the page: arrows scroll it');
  assert.equal(boardKeyAction('ArrowDown', { inScene: true }), 'move');
  assert.equal(boardKeyAction('ArrowDown', { inScene: true, shift: true }), null);
  assert.equal(boardKeyAction('c', { inScene: false }), null);
  assert.equal(boardKeyAction('c', { inScene: true }), 'copy');
  assert.equal(boardKeyAction('c', { inScene: true, phone: true }), null);
  assert.equal(boardKeyAction('x', { inScene: true, tileAt: 0 }), null);
  // sceneKeys: keys typed in #cmd, .gr-in or .gr-swap-in never reach the board.
  const listeners = [];
  const doc = { addEventListener: (t, fn) => listeners.push(fn), removeEventListener() {}, getElementById: () => null };
  const scene = { dataset: {}, focus() {}, isConnected: true };
  const seen = [];
  sceneKeys(scene, (e) => { seen.push(e.key); return true; }, { doc });
  const input = (cls) => ({ id: '', className: cls, closest: (sel) => (sel.includes('input') ? {} : null) });
  const cmd = { id: 'cmd', value: 'AAP', closest: () => null };
  for (const target of [cmd, input('gr-in'), input('gr-in gr-swap-in')]) {
    for (const key of ['c', '/', 'Delete', 'Backspace', 'ArrowDown', 'Enter']) {
      let stopped = false;
      listeners[0]({ key, target, preventDefault() { stopped = true; }, stopPropagation() { stopped = true; } });
      assert.equal(stopped, false, `${key} in ${target.id || target.className} is left alone`);
    }
  }
  assert.deepEqual(seen, []);
  const tile = { id: '', closest: () => null };
  listeners[0]({ key: 'c', target: tile, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(seen, ['c'], 'on the board the key is handled');
});

test('GRID hostile words: escaped on the page, never on the card or in the meta tags', async () => {
  const bad = 'FREE-CASH-AT-XYZ.COM';
  const it = gridItem(bad);
  assert.equal(it.kind, 'unknown');
  const html = tileHtml(it, { token: it.token, error: 'not_found', suggest: null });
  assert.match(html, /NO SUCH TICKER/);
  assert.equal(gridItem('<IMG SRC=X ONERROR=ALERT(1)>'), null, 'characters no tile has: no tile at all');
  assert.equal(gridItem('"><SCRIPT>'), null);
  assert.doesNotMatch(tileHtml(gridItem('A&B'), { error: 'not_found' }), /A&B/, 'escaped');
  // The meta tags: only real tiles.
  const m = gridMeta(`GRID NVDA ${bad} AMD`, parseCommand);
  for (const v of Object.values(m)) assert.doesNotMatch(v, /CASH|XYZ/i, v);
  assert.equal(m.title, 'GRID: NVDA, AMD (1Y) | Bloombroke');
  assert.equal(gridMeta(`GRID ${bad}`, parseCommand), null, 'nothing real: the plain page');
  const page = withMeta('<html><head><title>x</title><meta name="description" content="y"></head></html>', m);
  assert.doesNotMatch(page, /CASH|XYZ/i);
  // The card: drawn as ?.
  const grid = makeGrid(fakeDeps().deps);
  const card = gridCardModel(cardBoard(`NVDA,${bad}`, '1Y'), grid);
  assert.deepEqual(card.tiles.map((t) => t.sym), ['NVDA', '?']);
  assert.equal(card.command, 'GRID NVDA ?');
  assert.doesNotMatch(JSON.stringify(gridTree(card)), /CASH|XYZ/i);
  // The last board and the share link.
  assert.deepEqual(cleanBoard({ tokens: ['nvda', '<script>', 'x'.repeat(40), bad], range: '1Y' }).tokens, ['NVDA', 'X'.repeat(24), bad]);
  const links = shareLinks(['NVDA', bad], '1Y', 'https://bloombroke.com');
  assert.equal(links.url, `https://bloombroke.com/?c=GRID+NVDA+${bad}`, 'the link keeps the board as typed');
  assert.doesNotMatch(new URL(links.x).searchParams.get('text'), /CASH|XYZ/i, 'the post text names real tiles only');
});

test('GRID CPI: a small 1Y chip when its range is not the board range', () => {
  const cpi = loadCpiMonthly();
  const one = tileHtml(gridItem('CPI'), cpiTile('1M', cpi), { range: '1M' });
  assert.match(one, /<span class="gr-rng">1Y<\/span>/);
  assert.doesNotMatch(tileHtml(gridItem('CPI'), cpiTile('5Y', cpi), { range: '5Y' }), /gr-rng/);
  assert.doesNotMatch(tileHtml(gridItem('NVDA'), marketTile('NVDA', { points: series(20) }), { range: '1M' }), /gr-rng/);
});
