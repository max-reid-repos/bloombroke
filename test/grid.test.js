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
  applyQuote, barStep, flashClass, guarded, quoteTime, isIntraday, BUCKET_MS, TICK_MS, REFETCH_MS, FLASH_MS,
} from '../public/screens/grid.js';
import {
  makeGrid, mountGrid, downsample, seriesStats, loadCpiMonthly, cpiTile, ripTile, weirdTile, marketTile, periodStart, GRID_POINTS, GRID_PARALLEL,
  GRID_RATE,
} from '../lib/grid.js';
import {
  makeGridCards, gridCardModel, cardBoard, gridMeta, gridTree, mountGridCards, GRID_CARD_MAX_AGE, INCOMPLETE_MAX_AGE,
  GRID_CARD_MAX_AGE_INTRADAY, cardMaxAge,
} from '../lib/og-grid.js';
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
  assert.equal(parseGrid(['NVDA']).range, '1D', '1D by default: the board ticks live');
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
  assert.equal(gridCmd({ tokens: GRID_STARTER }), 'GRID STARTER 1D');
  assert.equal(parseCommand('grid starter').input, 'GRID STARTER 1D');
  // No preset words: they are other screens (MARKETS, CRYPTO, WEIRD, GRAVEYARD, DESK MACRO).
  for (const w of ['BIGTECH', 'CRYPTO', 'GRAVEYARD']) assert.equal(parseGrid([w]).items[0].kind, 'unknown', w);
  assert.equal(parseGrid(['WEIRD']).items[0].kind, 'market', 'WEIRD is ticker-shaped: a stock tile, W:PIZZA is the gauge');
  assert.deepEqual(parseGrid(['MACRO']).tokens, ['MACRO'], 'MACRO is a ticker-shaped word like any other');
  assert.deepEqual(parseCommand('GRID $AAPL $GOLD').args.tokens, ['AAPL', '$GOLD'], '$ forces the stock');
});

test('GRID command: the canonical URL, bare GRID, toInput', () => {
  // The canonical URL always says its range, so a link keeps it whatever the default.
  assert.equal(gridCmd({ tokens: ['NVDA', 'AMD', 'INTC'], range: '1Y' }), 'GRID NVDA AMD INTC 1Y');
  assert.equal(gridCmd({ tokens: ['NVDA'], range: '5Y' }), 'GRID NVDA 5Y');
  assert.equal(gridCmd({ tokens: ['NVDA'], range: '1D' }), 'GRID NVDA 1D');
  assert.equal(gridCmd({ tokens: [], range: '1D' }), 'GRID');
  const bare = parseCommand('GRID');
  assert.equal(bare.name, 'GRID');
  assert.equal(bare.args.bare, true);
  assert.equal(bare.url, 'GRID', 'bare GRID stays bare: the last board keeps its own range');
  assert.equal(parseCommand('GRID 1D').url, 'GRID 1D', 'a typed range on bare GRID stays');
  assert.equal(parseCommand('GRID 5Y').url, 'GRID 5Y');
  const p = parseCommand('grid nvda amd intc 1y');
  assert.equal(p.input, 'GRID NVDA AMD INTC 1Y');
  assert.equal(toInput(p.args), p.input);
  // A pasted link rebuilds the same board.
  assert.deepEqual(parseCommand(p.input).args.tokens, p.args.tokens);
  assert.deepEqual(cleanBoard({ tokens: ['nvda', 'NVDA', 'W:EGGS'], range: 'NOPE' }), { tokens: ['NVDA', 'W:EGGPRICE'], range: '1D' });
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
  assert.deepEqual([...r.matchAll(/data-range="(\w+)"/g)].map((m) => m[1]), ['1D', '5D', '1M', '1Y', '5Y', 'MAX']);
  assert.equal((r.match(/is-active/g) || []).length, 1);
  assert.match(rangeChips('3M'), /data-range="3M" aria-pressed="true">3M</, 'a typed range shows as its own chip');
  assert.equal(starterButton(GRID_STARTER), '', 'on the starter board: no STARTER button');
  assert.match(starterButton(['NVDA']), /<button type="button" class="gr-starter" data-starter>STARTER<\/button>/);
  const links = shareLinks(['NVDA', 'AMD'], '5Y', 'https://bloombroke.com');
  assert.equal(links.url, 'https://bloombroke.com/?c=GRID+NVDA+AMD+5Y');
  assert.match(links.x, /^https:\/\/x\.com\/intent\/post\?/);
  assert.equal(shareLinks(GRID_STARTER, '1Y', 'https://b.test').url, 'https://b.test/?c=GRID+STARTER+1Y');
  assert.equal(shareLinks(GRID_STARTER, '1D', 'https://b.test').url, 'https://b.test/?c=GRID+STARTER+1D');
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
    assert.deepEqual(f.calls, ['AA:1D', 'BB:1D'], 'no range: 1D; a limited request fetches nothing');
  } finally { server.close(); }
});

// ---- the share card ------------------------------------------------------------------------------------

test('GRID card model: cached tiles only; missing tiles show the symbol alone', async () => {
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
  assert.doesNotMatch(src, /getChart|getWeird|fetch\(/, 'the card loads only through grid.board');
});

// A getChart that counts how many run at once and takes `ms` for each.
function slowCharts(ms) {
  const calls = [];
  let running = 0;
  let peak = 0;
  const getChart = async (sym, range) => {
    calls.push(`${sym}:${range}`);
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running -= 1;
    return { points: series(300), stale: false };
  };
  return { getChart, calls, peak: () => peak };
}

test('GRID card: a cold cache loads the missing tiles through the loader, 4 at a time, then keeps the card', async () => {
  const f = fakeDeps();
  const c = slowCharts(10);
  let weirdCalls = 0;
  const getWeird = async (o) => {
    weirdCalls += 1;
    const d = await f.deps.getWeird(o);
    return { gauges: [...d.gauges, { id: 'canal', ok: true, headline: 'HORMUZ 3 SHIPS/DAY', spark: [64, 78, 91] }] };
  };
  const grid = makeGrid({ ...f.deps, getChart: c.getChart, getWeird });
  let renders = 0;
  const cards = makeGridCards({ grid, fallback: async () => Buffer.from('site'), render: async () => { renders += 1; return Buffer.from(`card${renders}`); } });
  const parsed = cardBoard('STARTER', '1Y');
  assert.equal(gridCardModel(parsed, grid).complete, false, 'cold: incomplete');
  const a = await cards.png('STARTER', '1Y', '1.1.1.1');
  const markets = parsed.items.filter((i) => i.kind === 'market').length;
  assert.equal(markets, 11);
  assert.equal(c.calls.length, markets, 'every market tile loaded once');
  assert.ok(c.calls.every((x) => x.endsWith(':1Y')));
  assert.ok(c.peak() <= 4 && c.peak() > 1, `at most 4 at once (${c.peak()})`);
  assert.equal(weirdCalls, 1, 'one WEIRD read for the card');
  assert.deepEqual([a.drawn, a.maxAge, GRID_CARD_MAX_AGE], [true, 14400, 14400], 'complete: 4 h');
  assert.equal(cards.cache.size, 1, 'complete: kept');
  const m = gridCardModel(parsed, grid);
  assert.equal(m.complete, true);
  assert.ok(m.tiles.every((t) => !t.missing), 'all 16 drawn');
  // W:EGGPRICE and BBRK, as /api/grid serves them.
  const egg = m.tiles[parsed.tokens.indexOf('W:EGGPRICE')];
  assert.deepEqual([egg.sym, egg.big], ['EGGPRICE', '$2.27 A DOZEN']);
  const bb = m.tiles[parsed.tokens.indexOf('BBRK')];
  assert.deepEqual([bb.sym, bb.big, bb.pill], ['BBRK', '4,321', '7D'], 'the week of page views, like the page tile');
  // Again: from memory, nothing loaded, nothing drawn.
  const b = await cards.png('STARTER', '1Y', '1.1.1.1');
  assert.deepEqual([b.png, b.maxAge, renders, c.calls.length], [a.png, 14400, 1, markets]);
  // A W: alias is the same tile: W:EGGS draws the kept W:EGGPRICE.
  const alias = gridCardModel(cardBoard('W:EGGS', '1Y'), grid);
  assert.deepEqual([alias.complete, alias.tiles[0].big], [true, '$2.27 A DOZEN']);
});

test('GRID card: past the deadline an incomplete card, drawn but not kept, a minute; later loads complete it', async () => {
  const f = fakeDeps();
  const c = slowCharts(300);
  const grid = makeGrid({ ...f.deps, getChart: c.getChart });
  let renders = 0;
  const cards = makeGridCards({ grid, wait: 40, fallback: async () => Buffer.from('site'), render: async () => { renders += 1; return Buffer.from(`card${renders}`); } });
  const t0 = Date.now();
  const a = await cards.png('AA,BB,CC,DD,EE,FF,CPI,W:EGGS', '1Y', '1.1.1.1');
  assert.ok(Date.now() - t0 < 250, 'answered at the deadline, not when the loads end');
  assert.deepEqual([a.drawn, a.maxAge, INCOMPLETE_MAX_AGE], [true, 60, 60]);
  assert.equal(cards.cache.size, 0, 'incomplete: not kept');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(c.calls.length, 4, 'no load starts after the deadline');
  // The four that were running finished and were kept: the next card loads the rest.
  const b = await cards.png('AA,BB,CC,DD,EE,FF,CPI,W:EGGS', '1Y', '1.1.1.1');
  assert.equal(b.maxAge, 60, 'still waiting on two');
  await new Promise((r) => setTimeout(r, 400));
  const fast = makeGridCards({ grid, fallback: async () => Buffer.from('site'), render: async () => Buffer.from('done') });
  const done = await fast.png('AA,BB,CC,DD,EE,FF,CPI,W:EGGS', '1Y', '1.1.1.1');
  assert.deepEqual([done.png.toString(), done.maxAge, fast.cache.size], ['done', 14400, 1]);
  assert.equal(c.calls.length, 6, 'each tile loaded once');
  // A busy chart gate at the deadline is incomplete too; a final answer (no such ticker) is not.
  const g2 = makeGrid(f.deps);
  const busy = makeGridCards({ grid: g2, fallback: async () => Buffer.from('site'), render: async () => Buffer.from('x') });
  assert.equal((await busy.png('BUSY,AA', '1Y', '2.2.2.2')).maxAge, 60);
  assert.equal(busy.cache.size, 0);
  assert.equal((await busy.png('APPL,AA', '1Y', '2.2.2.2')).maxAge, 14400, 'no such ticker is an answer');
});

test('GRID card: a WEIRD gauge with no data (a failed source) is not final: incomplete, a minute, not kept', async () => {
  const f = fakeDeps();
  const grid = makeGrid(f.deps);
  const cards = makeGridCards({ grid, fallback: async () => Buffer.from('site'), render: async () => Buffer.from('x') });
  const a = await cards.png('W:PIZZA,CPI', '1Y', '1.1.1.1');
  assert.equal(f.weirdCalls(), 1, 'the gauge was read (ok: false)');
  assert.deepEqual([a.drawn, a.maxAge, cards.cache.size], [true, 60, 0]);
  assert.equal((await cards.png('W:PIZZA,CPI', '1Y', '1.1.1.1')).maxAge, 60, 'asked again, still not kept');
  assert.equal(cards.cache.size, 0);
});

test('GRID card: a request turned away by the per-address limit or the budget loads nothing', async () => {
  const f = fakeDeps();
  const grid = makeGrid(f.deps);
  const site = Buffer.from('site');
  const render = async () => Buffer.from('x');
  const perIp = makeGridCards({ grid, fallback: async () => site, render, allow: () => false });
  const a = await perIp.png('NVDA,AMD,W:EGGS,BBRK', '1Y', '1.1.1.1');
  assert.deepEqual([a.png, a.drawn, a.maxAge], [site, false, 60]);
  const spent = makeGridCards({ grid, fallback: async () => site, render, budget: { renders: 0, windowMs: 60_000 } });
  const b = await spent.png('NVDA,AMD,W:EGGS,BBRK', '1Y', '2.2.2.2');
  assert.deepEqual([b.png, b.drawn, b.maxAge], [site, false, 60]);
  assert.deepEqual([f.calls.length, f.weirdCalls()], [0, 0], 'no getChart, no WEIRD read');
});

test('GRID card: BBRK without its page views is not kept and not drawn; with them it is', async () => {
  const f = fakeDeps();
  let aud = { pageviews: { d7: null }, live: null };
  const grid = makeGrid({ ...f.deps, audience: { get: async () => aud } });
  const it = gridItem('BBRK');
  const first = (await grid.board([it], '1Y'))[0];
  assert.deepEqual([first.views7, first.error], [null, undefined], 'the page still gets its -- tile');
  assert.equal(grid.cached(it, '1Y'), null, 'but it is not kept');
  const cards = makeGridCards({ grid, fallback: async () => Buffer.from('site'), render: async () => Buffer.from('x') });
  const a = await cards.png('BBRK,CPI', '1Y', '1.1.1.1');
  assert.equal(a.maxAge, 60, 'no page views yet: incomplete');
  assert.equal(gridCardModel(cardBoard('BBRK', '1Y'), grid).tiles[0].missing, true, 'never drawn as --');
  aud = { pageviews: { d7: 250 }, live: 0 };
  const b = await cards.png('BBRK,CPI', '1Y', '1.1.1.1');
  assert.equal(b.maxAge, 14400);
  const m = gridCardModel(cardBoard('BBRK', '1Y'), grid);
  assert.deepEqual([m.tiles[0].big, m.tiles[0].pill], ['250', '7D']);
});

test('GRID card route: 4 h for a complete card, a minute for an incomplete one', async () => {
  const f = fakeDeps();
  const grid = makeGrid(f.deps);
  const app = express();
  mountGridCards(app, { grid, fallback: async () => Buffer.from('site'), render: async () => Buffer.from('png') });
  const { server, base } = await listen(app);
  try {
    const ok = await fetch(`${base}/og/grid.png?s=NVDA,CPI&r=1Y`);
    assert.equal(ok.headers.get('cache-control'), 'public, max-age=14400');
    const busy = await fetch(`${base}/og/grid.png?s=BUSY,CPI&r=1Y`);
    assert.equal(busy.headers.get('cache-control'), 'public, max-age=60');
  } finally { server.close(); }
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
  assert.equal(m.url, 'https://bloombroke.com/?c=GRID+NVDA+AMD+INTC+1Y');
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
  assert.equal(m.title, 'GRID: NVDA, AMD (1D) | Bloombroke');
  assert.equal(gridMeta(`GRID ${bad}`, parseCommand), null, 'nothing real: the plain page');
  const page = withMeta('<html><head><title>x</title><meta name="description" content="y"></head></html>', m);
  assert.doesNotMatch(page, /CASH|XYZ/i);
  // The card: drawn as ?.
  const grid = makeGrid(fakeDeps().deps);
  const card = gridCardModel(cardBoard(`NVDA,${bad}`, '1Y'), grid);
  assert.deepEqual(card.tiles.map((t) => t.sym), ['NVDA', '?']);
  assert.equal(card.command, 'GRID NVDA ? 1Y');
  assert.doesNotMatch(JSON.stringify(gridTree(card)), /CASH|XYZ/i);
  // The last board and the share link.
  assert.deepEqual(cleanBoard({ tokens: ['nvda', '<script>', 'x'.repeat(40), bad], range: '1Y' }).tokens, ['NVDA', 'X'.repeat(24), bad]);
  const links = shareLinks(['NVDA', bad], '1Y', 'https://bloombroke.com');
  assert.equal(links.url, `https://bloombroke.com/?c=GRID+NVDA+${bad}+1Y`, 'the link keeps the board as typed');
  assert.doesNotMatch(new URL(links.x).searchParams.get('text'), /CASH|XYZ/i, 'the post text names real tiles only');
});

test('GRID CPI: a small 1Y chip when its range is not the board range', () => {
  const cpi = loadCpiMonthly();
  const one = tileHtml(gridItem('CPI'), cpiTile('1M', cpi), { range: '1M' });
  assert.match(one, /<span class="gr-rng">1Y<\/span>/);
  assert.doesNotMatch(tileHtml(gridItem('CPI'), cpiTile('5Y', cpi), { range: '5Y' }), /gr-rng/);
  assert.doesNotMatch(tileHtml(gridItem('NVDA'), marketTile('NVDA', { points: series(20) }), { range: '1M' }), /gr-rng/);
});

// ---- live: 1D by default, quote ticks, refetches ------------------------------------------------

test('GRID live: 1D by default, a link or a saved board keeps its range', () => {
  assert.equal(parseGrid([]).range, '1D', 'bare GRID and a new board: 1D');
  assert.equal(parseCommand('GRID NVDA AMD').args.range, '1D', 'a link with no range opens 1D');
  assert.equal(parseCommand('GRID NVDA AMD 1Y').args.range, '1Y', 'a link with a range keeps it');
  assert.equal(parseCommand('GRID STARTER 5Y').args.range, '5Y');
  assert.deepEqual(cleanBoard({ tokens: ['NVDA'], range: '1Y' }), { tokens: ['NVDA'], range: '1Y' }, 'a saved board keeps its range');
  // The canonical form always carries the range, so it round-trips.
  for (const r of ['1D', '5D', '1M', '1Y', '5Y', 'MAX']) {
    const c = gridCmd({ tokens: ['NVDA', 'BTC'], range: r });
    assert.equal(c, `GRID NVDA BTC ${r}`);
    assert.equal(parseCommand(c).args.range, r);
  }
  assert.equal(shareLinks(['EURUSD', 'BTC'], '1D', 'https://b.test').url, 'https://b.test/?c=GRID+EURUSD+BTC+1D');
  assert.deepEqual([isIntraday('1D'), isIntraday('5D'), isIntraday('1M'), isIntraday('MAX')], [true, true, false, false]);
  assert.deepEqual([TICK_MS, REFETCH_MS, FLASH_MS], [15_000, 60_000, 700]);
});

// A 1D tile of 5-minute bars from 09:30 New York (13:30 UTC), as /api/grid sends it.
const OPEN = Date.UTC(2026, 8, 28, 13, 30);
const intraday = (vals) => marketTile('AAPL', { points: vals.map((v, i) => ({ t: OPEN + i * BUCKET_MS, v })) });
const at = (ms) => new Date(ms).toISOString();

test('GRID tick: the value, the pill, the last point and the high and low move', () => {
  const tile = intraday([100, 101, 102, 101, 100.5]);
  const lastT = OPEN + 4 * BUCKET_MS;
  const q = { ticker: 'AAPL', last: 103.25, changePct: 1.5, asOf: at(lastT + 60_000) };
  const next = applyQuote(tile, q, '1D', { now: lastT + 90_000 });
  assert.equal(next.last, 103.25);
  assert.equal(next.points.length, 5, 'same 5-minute bucket: the last point is replaced');
  assert.deepEqual(next.points[4], { t: lastT, v: 103.25 });
  assert.equal(next.changePct, 1.5, '1D: the quote\'s own day change (vs the previous close), as QUOTE shows');
  assert.deepEqual(next.hi, { v: 103.25, t: lastT }, 'a new high');
  const f = tileFace(gridItem('AAPL'), next);
  assert.deepEqual([f.big, f.pill, f.pillDir], ['103.25', '+1.50%', 'up']);
  const marks = marksFor(next);
  assert.deepEqual(marks.map((m) => [m.i, m.text]), [[4, 'H 103.25'], [0, 'L 100.00']], 'the H dot moves to the new high');
  assert.equal(tile.points[4].v, 100.5, 'the old tile is left as it was');
  // A new low.
  const low = applyQuote(next, { ...q, last: 99.1, changePct: -0.8 }, '1D', { now: lastT + 90_000 });
  assert.deepEqual(marksFor(low).map((m) => m.text), ['H 102.00', 'L 99.10']);
  assert.equal(tileFace(gridItem('AAPL'), low).pillDir, 'down');
  // Nothing new: nothing to draw.
  assert.equal(applyQuote(next, q, '1D', { now: lastT + 90_000 }), null);
  // Tiles that do not tick.
  assert.equal(applyQuote(cpiTile('1Y', loadCpiMonthly()), q, '1D'), null, 'CPI');
  assert.equal(applyQuote({ token: 'AAPL', kind: 'market', error: 'no_data' }, q, '1D'), null);
  assert.equal(applyQuote(tile, { ticker: 'AAPL', last: null }, '1D'), null, 'no price: no tick');
});

test('GRID tick: a new 5-minute bucket appends a point; an older quote leaves the line', () => {
  const tile = intraday([100, 101, 102]);
  const lastT = OPEN + 2 * BUCKET_MS;
  const next = applyQuote(tile, { last: 102.5, changePct: 0.2, asOf: at(lastT + BUCKET_MS + 42_000) }, '1D', { now: lastT + BUCKET_MS + 50_000 });
  assert.equal(next.points.length, 4, 'a new bucket: one more point');
  assert.deepEqual(next.points[3], { t: lastT + BUCKET_MS, v: 102.5 }, 'at the start of its bucket');
  const same = applyQuote(next, { last: 102.7, changePct: 0.3, asOf: at(lastT + BUCKET_MS + 200_000) }, '1D', { now: lastT + 2 * BUCKET_MS });
  assert.equal(same.points.length, 4, 'the same bucket again: replaced');
  // No asOf: now's bucket.
  assert.equal(applyQuote(tile, { last: 99 }, '5D', { now: lastT + BUCKET_MS * 3 }).points.length, 4);
  // A quote from before the last bar (a stock's close, while the line has after-hours bars).
  const old = applyQuote(tile, { last: 101.9, changePct: 0.1, asOf: at(lastT - BUCKET_MS) }, '1D', { now: lastT + 60_000 });
  assert.equal(old.points, tile.points, 'the line stays');
  assert.equal(old.last, 101.9, 'the value is the quote\'s');
  // A quote dated in the future counts as now.
  assert.equal(quoteTime({ asOf: at(OPEN + 3_600_000) }, OPEN), OPEN);
  assert.equal(quoteTime({ asOf: '2026-09-28T10:12:35.937-0400' }, Date.UTC(2026, 8, 29)), Date.UTC(2026, 8, 28, 14, 12, 35, 937), 'the quote source\'s time form');
});

test('GRID tick: on 5D and longer the change is against the first point of the range', () => {
  const tile = intraday([100, 101, 102]);
  const five = applyQuote(tile, { last: 110, changePct: 3, asOf: at(OPEN + 2 * BUCKET_MS + 1000) }, '5D', { now: OPEN + 3 * BUCKET_MS });
  assert.ok(Math.abs(five.changePct - 10) < 1e-9, '5D: +10% from the first point, not the quote\'s day change');
  // Daily bars (1M): New York midnight stamps. The same New York day: replaced; the next: appended.
  const day = (d) => Date.UTC(2026, 8, d, 4);
  const month = marketTile('AAPL', { points: [22, 23, 24, 25].map((d, i) => ({ t: day(d), v: 100 + i })) });
  const fri = applyQuote(month, { last: 104, changePct: 1, asOf: '2026-09-25T15:59:00.000-0400' }, '1M', { now: day(26) });
  assert.deepEqual([fri.points.length, fri.points[3].v], [4, 104], 'today\'s point updated');
  assert.ok(Math.abs(fri.changePct - 4) < 1e-9);
  const mon = applyQuote(month, { last: 105, changePct: 2, asOf: '2026-09-28T10:12:35.000-0400' }, '1M', { now: day(29) });
  assert.deepEqual([mon.points.length, mon.points[4].v], [5, 105], 'a new day: its own point');
  assert.deepEqual([barStep(day(25), day(25) + 3600_000, '1Y'), barStep(day(25), day(28), '1Y'), barStep(day(25), day(24), '1Y')], [0, 1, -1]);
  assert.deepEqual([barStep(day(21), day(25), '5Y'), barStep(day(21), day(28), '5Y')], [0, 1], 'weekly bars');
  assert.deepEqual([barStep(Date.UTC(2026, 8, 1, 4), day(28), 'MAX'), barStep(Date.UTC(2026, 7, 1, 4), day(28), 'MAX')], [0, 1], 'monthly bars');
});

test('GRID tick: a changed value flashes up or down, never with reduced motion', () => {
  assert.equal(flashClass(100, 101), 'gr-flash-up');
  assert.equal(flashClass(100, 99), 'gr-flash-down');
  assert.equal(flashClass(100, 100), '', 'the same value: no flash');
  assert.equal(flashClass(undefined, 100), '', 'a first value: no flash');
  assert.equal(flashClass(100, 101, { reduced: true }), '', 'reduced motion: no flash class');
  assert.equal(flashClass(100, 99, { reduced: true }), '');
  const css = readFileSync(new URL('../public/screens/grid.css', import.meta.url), 'utf8');
  assert.match(css, /\.gr-flash-up \{[^}]*var\(--up-flash\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.gr-panel \.gr-tile \.gr-flash-up/);
  const js = readFileSync(new URL('../public/screens/grid.js', import.meta.url), 'utf8');
  assert.match(js, /prefers-reduced-motion: reduce/, 'the screen asks the browser');
  assert.doesNotMatch(js, /style=/, 'no inline styles (the CSP)');
});

test('GRID live: never two requests at once, and a failed one skips a turn', async () => {
  let calls = 0;
  let release;
  const run = guarded(() => { calls += 1; return new Promise((r) => { release = r; }); });
  const first = run();
  assert.equal(await run(), 'busy', 'in flight: the next turn does not stack');
  assert.equal(calls, 1);
  release();
  assert.equal(await first, 'ok');
  // An error: the next turn is skipped, then it asks again.
  let fail = { status: 503 };
  const r2 = guarded(async () => { calls += 1; if (fail) throw fail; });
  calls = 0;
  assert.equal(await r2(), 'error');
  assert.equal(await r2(), 'skipped');
  fail = null;
  assert.equal(await r2(), 'ok');
  assert.equal(calls, 2);
  // A 429: two turns skipped.
  fail = { status: 429 };
  assert.equal(await r2(), 'error');
  fail = null;
  assert.deepEqual([await r2(), await r2(), await r2()], ['skipped', 'skipped', 'ok']);
  // A closed screen (aborted): no back-off.
  const r3 = guarded(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); });
  assert.equal(await r3(), 'aborted');
  assert.equal(await r3(), 'aborted');
});

test('GRID live: the budget and the caches for a board that asks every minute', async () => {
  // 10 refetches in 10 minutes, a board built tile by tile (16), six range switches with
  // a retry each (12), and a second board open (10 more): well inside the limit.
  const perWindow = (GRID_RATE.windowMs / REFETCH_MS);
  assert.equal(perWindow, 10);
  assert.ok(perWindow * 2 + 16 + 12 < GRID_RATE.renders, `${GRID_RATE.renders} per 10 minutes`);
  assert.equal(GRID_RATE.renders, 90);
  const f = fakeDeps();
  const app = express();
  mountGrid(app, f.deps);
  const { server, base } = await listen(app);
  try {
    assert.equal((await fetch(`${base}/api/grid?s=AA&r=1D`)).headers.get('cache-control'), 'public, max-age=15', '1D: asked again every minute');
    assert.equal((await fetch(`${base}/api/grid?s=AA&r=5D`)).headers.get('cache-control'), 'public, max-age=15');
    assert.equal((await fetch(`${base}/api/grid?s=AA&r=1M`)).headers.get('cache-control'), 'public, max-age=60');
  } finally { server.close(); }
});

test('GRID card: a complete 1D or 5D card goes out for 10 minutes, the rest as before', async () => {
  const f = fakeDeps();
  const grid = makeGrid(f.deps);
  const cards = makeGridCards({ grid, fallback: async () => Buffer.from('site'), render: async () => Buffer.from('card') });
  for (const r of ['1D', '5D', '1Y']) await grid.board(cardBoard('NVDA,AMD', r).items, r);
  const one = await cards.png('NVDA,AMD', '1D', '1.1.1.1');
  assert.deepEqual([one.drawn, one.maxAge, GRID_CARD_MAX_AGE_INTRADAY], [true, 600, 600]);
  assert.equal((await cards.png('NVDA,AMD', '1D', '1.1.1.1')).maxAge, 600, 'from the kept card too');
  assert.equal((await cards.png('NVDA,AMD', '5D', '1.1.1.1')).maxAge, 600);
  assert.equal((await cards.png('NVDA,AMD', '1Y', '1.1.1.1')).maxAge, GRID_CARD_MAX_AGE);
  assert.equal((await cards.png('NVDA,AMD', '', '1.1.1.1')).maxAge, 600, 'no range: 1D');
  assert.deepEqual(['1D', '5D', '1M', '1Y', 'MAX'].map(cardMaxAge), [600, 600, 14400, 14400, 14400]);
});
