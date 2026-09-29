// GRID and WEIRD design review: one tile template on each screen, one number and one
// change as coloured text (never boxed), high and low on hover only, + TILE and EDIT in
// GRID's strip, BBRK's here now from the top bar's own source, an honest "no chart yet",
// two GRID tiles a row on a phone; WEIRD heroes that read alone (a noun and its number),
// the short credits a licence asks for, and rows that are always full.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  tileHtml, tileFace, hoverText, hereWords, editButtons, shareHtml, boardKeyAction, NO_CHART, EDIT_HINT,
} from '../public/screens/grid.js';
import { gridItem } from '../public/command-args.js';
import { marketTile, cpiTile, loadCpiMonthly, weirdTile, bbrkTile, ripTile } from '../lib/grid.js';
import { HERE_MIN, hereText } from '../public/here-now.js';
import {
  WEIRD_GAUGES, HEROES, MEANINGS, heroOf, heroText, meaningOf, tileCredit, tileCreditHtml,
} from '../public/screens/weird-gauges.js';
import { tile, tileBody, recordTag, rowSizes, spanClasses } from '../public/screens/weird.js';
import { cardBody } from '../public/screens/desk-cards.js';
import { loadGraveyardData } from '../lib/graveyard.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const series = (n, f = (i) => 100 + Math.sin(i / 3) * 5 + i / 10) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000_000 + i * 60_000, v: f(i) }));
const GRAVES = loadGraveyardData();

// ---- GRID -------------------------------------------------------------------------------

test('GRID: every kind of tile is the one template: head, one number, one change (text), the line', () => {
  const cpi = loadCpiMonthly();
  const tiles = [
    [gridItem('NVDA'), { ...marketTile('NVDA', { points: series(40) }), name: 'Nvidia' }],
    [gridItem('CPI'), cpiTile('1Y', cpi)],
    [gridItem('W:EGGPRICE'), weirdTile(gridItem('W:EGGPRICE'), { ok: true, headline: '$2.27 A DOZEN', spark: [1, 2, 3] })],
    [gridItem('RIP:LEH'), ripTile(gridItem('RIP:LEH'), GRAVES.stones.find((e) => e.ticker === 'LEH'))],
    [gridItem('BBRK'), bbrkTile({ pageviews: { d7: 332 }, live: 3, spark30: [1, 4, 2, 6] })],
  ];
  for (const [item, t] of tiles) {
    const html = tileHtml(item, t, { i: 0, range: '1Y' });
    assert.match(html, /<div class="gr-head"><span class="gr-sym">[^<]+<\/span><span class="gr-name">/, item.token);
    assert.equal((html.match(/class="gr-big/g) || []).length, 1, `${item.token}: one number`);
    assert.equal((html.match(/class="gr-chg num (up|down|flat)"/g) || []).length, 1, `${item.token}: one change slot`);
    assert.match(html, /<div class="gr-chart"><\/div>/, `${item.token}: the line's box`);
    assert.doesNotMatch(html, /gr-pill|chip|gr-sub|gr-row|gr-full|gr-lab/, `${item.token}: no box, no second template, no printed label`);
  }
  // The change: coloured by its sign, dim when there is none; a W: gauge has none.
  const up = tileFace(gridItem('NVDA'), { ...marketTile('NVDA', { points: series(40) }), changePct: 1.5 });
  assert.deepEqual([up.chg, up.chgDir], ['+1.50%', 'up']);
  const w = tileFace(gridItem('W:EGGPRICE'), tiles[2][1]);
  assert.deepEqual([w.big, w.chg, w.chgDir], ['Eggs $2.27 a dozen', '', 'flat'], 'a W: tile: the WEIRD hero, no change, dim');
  const css = read('public/screens/grid.css');
  assert.match(css, /\.gr-chg\.up \{ color: var\(--up\); \}/);
  assert.match(css, /\.gr-chg\.down \{ color: var\(--down\); \}/);
  assert.match(css, /\.gr-chg\.flat \{ color: var\(--dim\);/);
  assert.match(css, /\.gr-line\.flat \{ stroke: var\(--dim\); \}/, 'no blue-instead-of-colour line');
  assert.doesNotMatch(css, /\.gr-chg[^{]*\{[^}]*(border|background)/, 'the change is never boxed');
  for (const m of css.matchAll(/font(?:-size)?:[^;]*?(\d+)px/g)) assert.ok(Number(m[1]) >= 11, `nothing under 11px: ${m[0]}`);
});

test('GRID: the high and the low only on hover (the title), never printed on the tile', () => {
  const t = marketTile('AAPL', { points: series(60) });
  const html = tileHtml(gridItem('AAPL'), t);
  const title = /title="([^"]*)"/.exec(html)[1];
  assert.match(title, /^High [\d,.]+ · Low [\d,.]+$/);
  assert.equal(title, hoverText(t));
  assert.doesNotMatch(html.replace(/title="[^"]*"/, ''), /High|Low/);
  assert.doesNotMatch(read('public/screens/grid.js').match(/function drawTileCharts[\s\S]*?\n {2}\}/)[0], /marksFor/, 'the screen draws the line without its marks');
});

test('GRID strip: + TILE and EDIT at its right end, in DESK\'s words and look; share as text links', () => {
  assert.equal(editButtons(false), '<button type="button" class="desk-btn gr-add-btn" data-add>+ TILE</button><button type="button" class="desk-btn gr-edit" data-edit aria-pressed="false">EDIT</button>');
  assert.match(editButtons(true), /aria-pressed="true">DONE</);
  const desk = read('public/screens/desk.js');
  assert.match(desk, /class="desk-btn desk-add" data-act="add">\+ PANEL<\/button>\s*<button type="button" class="desk-btn desk-edit" data-act="edit" aria-pressed="false">EDIT<\/button>/, 'DESK: the words GRID follows');
  const share = shareHtml({ x: 'https://x.com/intent/post?text=a' });
  assert.match(share, /<button type="button" class="gr-link" data-copy>COPY LINK<\/button>/);
  assert.match(share, /<a class="gr-link" href="https:\/\/x\.com\/intent\/post\?text=a" target="_blank" rel="noopener noreferrer">POST ON X<\/a>/);
  assert.doesNotMatch(share, /chip|btn-solid/, 'no boxes, nothing white');
  const js = read('public/screens/grid.js');
  assert.match(js, /shareEl\.innerHTML = `\$\{shareHtml\(shareLinks\(t, range, origin\)\)\}\$\{ctx\.embed \? '' : editButtons\(editing\)\}`/, 'the strip draws both; never in a DESK panel');
  assert.doesNotMatch(js, /btn-solid/, 'no white action on GRID');
  // Wired to the board's own actions: the + tile's input, remove (x), swap (/), move.
  assert.match(js, /\[data-add\]'\)\) \{ e\.preventDefault\(\); goAdd\(\); \}/);
  assert.match(js, /\[data-edit\]'\)\) \{ e\.preventDefault\(\); setEditing\(!editing\); \}/);
  assert.match(js, /if \(editing && !ctx\.embed\) startSwap\(i\);/, 'in EDIT a click swaps the tile');
  assert.match(read('public/screens/grid.css'), /\.gr-panel\.is-editing \.gr-x \{ opacity: 1; \}|\.gr-panel\.is-editing \.gr-x/);
  assert.ok(EDIT_HINT.length <= 60 && !/—/.test(EDIT_HINT));
  // Alt+Arrows move a tile (DESK's keys); never in a DESK panel, never without a tile.
  assert.equal(boardKeyAction('ArrowRight', { inScene: true, tileAt: 2, alt: true }), 'reorder');
  assert.equal(boardKeyAction('ArrowRight', { inScene: true, tileAt: 2, alt: true, embed: true }), null);
  assert.equal(boardKeyAction('ArrowRight', { inScene: true, tileAt: -1, alt: true }), null);
  assert.equal(boardKeyAction('ArrowRight', { inScene: true, tileAt: 2 }), 'move');
  assert.equal(boardKeyAction('Enter', { inScene: true, tileAt: 2, phone: true }), 'open', 'a phone opens the tile too');
});

test('GRID BBRK: the top bar\'s here now, from the same source, a zero in words, and a line', () => {
  // The same rule as the top bar (here-now.js): the number from HERE_MIN up.
  for (const n of [2, 3, 17, 1200]) assert.equal(hereWords(n).toUpperCase(), hereText(n), `${n}`);
  for (const n of [0, 1]) assert.equal(hereWords(n), 'no one else here', `${n} is never printed as a bare number`);
  assert.equal(hereWords(null), '');
  assert.equal(HERE_MIN, 2);
  const js = read('public/screens/grid.js');
  assert.match(js, /getJSON\('\/api\/live'/, 'the top bar\'s own endpoint');
  assert.match(read('public/here-now.js'), /fetchImpl\('\/api\/live'/);
  assert.match(js, /if \(\(d\.tiles \|\| \[\]\)\.some\(\(t\) => t\.kind === 'bbrk' && !t\.error\)\) hereNow\(\);/, 'asked at once when the tile loads, not a minute later');
  // The tile: one number (the week of page views), here now as its change, a line of visitors a day.
  const t = bbrkTile({ pageviews: { d7: 332 }, live: 3, spark30: [5, 9, 7, 12] });
  assert.deepEqual(t.points.map((p) => p.v), [5, 9, 7, 12]);
  const f = tileFace(gridItem('BBRK'), t);
  assert.deepEqual([f.big, f.chg], ['332', '3 here now']);
  // A zero: said calmly, never a bare 0 as the hero.
  const zero = tileFace(gridItem('BBRK'), bbrkTile({ pageviews: { d7: 0 }, live: 0 }));
  assert.deepEqual([zero.big, zero.chg], ['none yet', 'no one else here']);
  assert.equal(bbrkTile({ pageviews: { d7: 1 } }).points, undefined, 'no visitors a day: no line');
});

test('GRID: a tile with nothing to draw says "no chart yet"', () => {
  assert.equal(NO_CHART, 'no chart yet');
  const js = read('public/screens/grid.js');
  assert.match(js, /if \(!pts\) \{ host\.innerHTML = `<p class="gr-nochart">\$\{esc\(NO_CHART\)\}<\/p>`; return; \}/);
  assert.match(read('public/screens/grid.css'), /\.gr-nochart \{[^}]*font-size: 11px/);
});

test('GRID on a phone: two tiles a row, the long name left out, one number and its change', () => {
  const css = read('public/screens/grid.css');
  const phone = css.slice(css.indexOf('@media (max-width: 639px)'), css.indexOf('/* In a DESK panel'));
  assert.match(phone, /\.gr-board \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(phone, /\.gr-name \{ display: none; \}/);
  assert.match(phone, /\.gr-add \{ grid-column: 1 \/ -1;/, 'the + tile takes the whole row');
  assert.doesNotMatch(phone, /gr-row|gr-mini|is-open|gr-full/, 'no one-line rows any more');
});

// ---- WEIRD ------------------------------------------------------------------------------

// Headlines in every shape the servers write (data/weird/*.js), zeros included.
const SAMPLES = {
  canal: ['HORMUZ 3 SHIPS/DAY', 'BAB EL-MANDEB 1 SHIP/DAY', 'HORMUZ 0 SHIPS/DAY'],
  pizza: ['DEFCON 3', 'INDEX 42'],
  degen: ['KALSHI #10', 'NONE IN TOP 100'],
  waffle: ['0 STORES IN STORMS', '1 STORE IN STORMS', '212 STORES IN STORMS (PARTIAL)'],
  panic: ['+24%', '−3%'],
  hiring: ['1.45 PER JOB'],
  hotdog: ['$4.66'],
  omens: ['WANING GIBBOUS'],
  undies: ['+7.7% YOY'],
  bigmac: ['SWITZERLAND +45%', 'UNITED STATES +0%'],
  billions: ['MUSK +$12.0B', 'NO BIG MOVES TODAY'],
  wsb: ['SPY 238 MENTIONS'],
  odds: ['RECESSION 9%', 'FED <1%'],
  boxrate: ['$4,468'],
  eggs: ['$2.27 A DOZEN'],
  rides: ['20 MIN AVERAGE WAIT', 'PARKS CLOSED'],
  buzz: ['1,744 AI FILINGS', '2,000+ AI FILINGS'],
  beige: ['SLOW 38 TIMES', 'AI 12 TIMES'],
  trucks: ['CASS +2.1% YOY', 'TRUCKS −0.4% YOY', 'RAIL +1.0% YOY'],
  boxes: ['+0.6% YOY'],
  lipstick: ['+2.8% YOY'],
  sick: ['COVID 2.7'],
  macau: ['−1.2% YOY'],
};

test('WEIRD heroes read alone: every gauge has its own noun and number, never a bare % or $', () => {
  assert.deepEqual(Object.keys(HEROES).sort(), WEIRD_GAUGES.map((g) => g.id).sort(), 'every gauge has its hero');
  assert.deepEqual(Object.keys(SAMPLES).sort(), WEIRD_GAUGES.map((g) => g.id).sort());
  for (const g of WEIRD_GAUGES) {
    for (const h of SAMPLES[g.id]) {
      const d = { ok: true, headline: h, line: 'Box output vs a year ago' };
      assert.ok(HEROES[g.id](h, d), `${g.id}: "${h}" is read by its own hero, not the fallback`);
      const x = heroOf(g, d);
      assert.match(x.noun, /[A-Za-z]{2,}/, `${g.id}: a noun`);
      assert.ok(x.num, `${g.id}: a number`);
      const text = heroText(g, d);
      assert.match(text.split(' ')[0], /[A-Za-z]/, `${g.id}: "${text}" starts with its noun, never a bare number`);
      assert.doesNotMatch(text, /(^|\s)0(\s|$)|YOY|\/DAY/, `${g.id}: "${text}": no bare zero, no shorthand`);
      assert.doesNotMatch(text, /—/);
    }
  }
  const eg = (id, h) => heroText(WEIRD_GAUGES.find((x) => x.id === id), { ok: true, headline: h });
  assert.equal(eg('eggs', '$2.27 A DOZEN'), 'Eggs $2.27 a dozen');
  assert.equal(eg('canal', 'HORMUZ 3 SHIPS/DAY'), 'Hormuz 3 ships a day');
  assert.equal(eg('lipstick', '+2.8% YOY'), 'Cosmetics prices +2.8% a year');
  assert.equal(eg('waffle', '0 STORES IN STORMS'), 'Waffle House none in storms', 'a zero in words');
  // A shape no hero knows keeps the gauge's own label as its noun; no reading, no hero.
  assert.equal(heroText(WEIRD_GAUGES[0], { ok: true, headline: 'SOMETHING NEW 5' }), 'Canal SOMETHING NEW 5');
  assert.equal(heroOf(WEIRD_GAUGES[0], { ok: false, headline: 'NO DATA' }), null);
  assert.equal(heroOf(WEIRD_GAUGES[0], { ok: false, pending: true, headline: 'LOADING' }), null);
});

test('WEIRD: one tile template for every gauge; the DESK card and the GRID W: tile share the hero', () => {
  const shapes = new Set();
  for (const [i, g] of WEIRD_GAUGES.entries()) {
    const d = { ok: true, headline: SAMPLES[g.id][0], line: 'x', spark: [1, 2, 3], asOf: '2026-09-01', source: 'S' };
    const t = tile(g, i);
    assert.match(t, new RegExp(`<p class="wd-kick"><span class="wd-no">${i + 1}</span><span class="wd-name">${g.command}</span><span class="wd-tag"></span></p>`));
    assert.doesNotMatch(t, /panel-label/, 'the name is a small kicker, not a blue label');
    const body = tileBody(g, d);
    shapes.add(body.replace(/ <span class="wd-unit">[^<]*<\/span>/, '').replace(/>[^<]*</g, '><').replace(/ (title|points|class)="[^"]*"/g, ''));
    assert.match(body, /<p class="wd-big"><span class="wd-noun">/);
    assert.equal(cardBody(g, d), body, 'a DESK card is the same body');
    assert.equal(weirdTile({ token: `W:${g.command}`, gauge: g.command }, d).hero, heroText(g, d).slice(0, 48), 'GRID W: tile: the same hero');
    assert.ok(meaningOf(g, d).length <= 60, `${g.id}: one short line`);
  }
  assert.equal(shapes.size, 1, 'one markup shape for all gauges');
  // The record tag: one place, the kicker's right end.
  const rec = { kind: 'high', record: false, since: '2022-06-01', text: 'HIGHEST SINCE JUN 2022', short: 'HIGH SINCE JUN 2022' };
  assert.equal(recordTag({ ok: true, record: rec }), '<span class="wd-rec" title="HIGHEST SINCE JUN 2022">HIGH SINCE JUN 2022</span>');
  assert.match(read('public/screens/weird.js'), /const tag = t && t\.querySelector\('\.wd-tag'\);\n\s+if \(tag\) tag\.innerHTML = recordTag\(d\);/);
});

test('WEIRD credits: the short credit a licence asks for stays on the tile; vendors never named otherwise', () => {
  const g = (id) => WEIRD_GAUGES.find((x) => x.id === id);
  assert.equal(tileCredit(g('waffle'), { credit: '© OpenStreetMap contributors, ODbL' }), '© OSM');
  assert.equal(tileCredit(g('bigmac'), { credit: 'The Economist, CC BY 4.0' }), 'The Economist, CC BY 4.0');
  assert.match(tileCreditHtml(g('rides'), { credit: 'Powered by Queue-Times.com' }), /Powered by <a href="https:\/\/queue-times\.com\/"[^>]*>Queue-Times\.com<\/a>/);
  assert.equal(tileCredit(g('wsb'), { source: 'ApeWisdom' }), '', 'no credit asked for: none on the tile');
  const osm = tileBody(g('waffle'), { ok: true, headline: '0 STORES IN STORMS', line: 'x', source: 'NHC', credit: '© OpenStreetMap contributors, ODbL', asOf: '2026-09-29' });
  assert.match(osm, /<p class="wd-src">© OSM<\/p>/);
  // The long form stays on the gauge's own screen.
  assert.match(read('public/screens/weird.js'), /<p class="wd-src">\$\{sourceHtml\(g, d\)\}<\/p>/);
  const VENDORS = /FRED|Forbes|Polymarket|ApeWisdom|Drewry|Wikimedia|Wikipedia|Algolia|\bHN\b|Cass|PortWatch|\bIMF\b|pizzint|App Store|Apple|Bloomberg/;
  for (const x of WEIRD_GAUGES) {
    for (const h of SAMPLES[x.id]) assert.doesNotMatch(heroText(x, { ok: true, headline: h, line: '' }), VENDORS, x.id);
    if (MEANINGS[x.id]) assert.doesNotMatch(MEANINGS[x.id], VENDORS, x.id);
    const body = tileBody(x, { ok: true, headline: SAMPLES[x.id][0], line: 'y', source: 'FRED', asOf: '2026-09-01' });
    assert.doesNotMatch(body, /FRED/, `${x.id}: the source is not on the tile`);
  }
});

test('WEIRD rows: always full, for 22 or 23 tiles at 1440, 1536 and 390 px', () => {
  // The grid's width at each viewport (the page's side room and the scrollbar gutter out).
  for (const width of [1414, 1418, 1432, 358, 374, 900, 1900]) {
    for (const n of [21, 22, 23]) {
      const rows = rowSizes(n, width);
      assert.equal(rows.reduce((a, b) => a + b, 0), n, `${n} at ${width}`);
      assert.ok(Math.max(...rows) - Math.min(...rows) <= 1, `${n} at ${width}: rows differ by one at most (${rows})`);
      assert.ok(rows.every((k, i) => i === 0 || k <= rows[i - 1]), 'the longer rows first');
      const spans = spanClasses(n, width).map((c) => Number(c.slice(4)));
      let at = 0;
      for (const k of rows) { assert.equal(spans.slice(at, at + k).reduce((a, b) => a + b, 0), 60, 'each row fills all 60 columns'); at += k; }
    }
  }
  assert.deepEqual(rowSizes(22, 1414), [5, 5, 4, 4, 4]);
  assert.deepEqual(rowSizes(23, 1414), [5, 5, 5, 4, 4]);
  assert.deepEqual(rowSizes(22, 358), Array(22).fill(1), 'a phone: one a row, ending where it ends');
  const css = read('public/screens/weird.css');
  assert.match(css, /grid-template-columns: repeat\(60, minmax\(0, 1fr\)\)/);
  for (const k of [60, 30, 20, 15, 12, 10]) assert.match(css, new RegExp(`\\.wd-grid > \\.wd-tile\\.wd-s${k} \\{ grid-column: span ${k}; \\}`));
  assert.match(css, /html:not\(\.is-embed\) \.view > \.wd-scroll \{ flex: 1 1 auto; min-height: 0; overflow: auto;/, 'the scroller wraps the grid');
  for (const m of css.matchAll(/font-size: (\d+)px/g)) assert.ok(Number(m[1]) >= 11, `nothing under 11px: ${m[0]}`);
});
