import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS, DEFAULT_DESK, DESK_KEY, DESK_VERSION, MAX_PANELS, clampPanel, collides, settle, dragPreview, dropAt,
  resizeTo, nudge, grow, findSpot, addPanel, removePanel, stackOrder, swapInStack, cycleLink,
  defaultDesks, parseDesks, serializeDesks, loadDesks, saveDesks, parseDeskArgs, embedSrc, isEmbedSearch,
  tickerOf, retarget,
} from '../public/desk-layout.js';
import { parseCommand, FKEYS, suggest, COMMANDS } from '../public/app.js';
import { embedHtml, isEmbedQuery, securityHeaders } from '../lib/embed.js';

const P = (id, x, y, w, h, extra = {}) => ({ id, cmd: 'X', x, y, w, h, link: null, ...extra });
const pos = (list) => Object.fromEntries(list.map((p) => [p.id, `${p.x},${p.y},${p.w}x${p.h}`]));
const noOverlap = (list) => list.every((a) => list.every((b) => a === b || !collides(a, b)));

test('snap: panels are whole grid cells inside the 12 columns', () => {
  assert.deepEqual(pos([clampPanel(P('p1', 11.6, -3, 5.4, 1))]), { p1: '7,0,5x3' }, 'x slides left to fit, a minimum height of 3');
  assert.deepEqual(pos([clampPanel(P('p1', -2, 2.4, 40, 99))]), { p1: '0,2,12x40' });
  assert.ok(collides(P('a', 0, 0, 4, 4), P('b', 3, 3, 4, 4)));
  assert.ok(!collides(P('a', 0, 0, 4, 4), P('b', 4, 0, 4, 4)), 'touching edges do not collide');
});

test('reflow: panels float up, never overlap, never jump over a panel', () => {
  const s = settle([P('a', 0, 5, 12, 3), P('b', 0, 20, 6, 3), P('c', 6, 20, 6, 3)]);
  assert.deepEqual(pos(s), { a: '0,0,12x3', b: '0,3,6x3', c: '6,3,6x3' });
  // c sits under a tall panel: it cannot float into the hole above b.
  const t = settle([P('a', 0, 0, 12, 4), P('b', 0, 4, 12, 4), P('c', 0, 8, 4, 3)]);
  assert.deepEqual(pos(t), { a: '0,0,12x4', b: '0,4,12x4', c: '0,8,4x3' });
  assert.deepEqual(settle(DEFAULT_DESK), DEFAULT_DESK, 'the default desk is already settled');
});

test('collision: a dragged panel pushes what it lands on down, or swaps with it', () => {
  const base = [P('a', 0, 0, 6, 4), P('b', 6, 0, 6, 4), P('c', 0, 4, 12, 4)];
  const pre = dragPreview(base, 'c', { x: 0, y: 0 });
  assert.ok(noOverlap(pre));
  assert.deepEqual(pos(pre), { a: '0,4,6x4', b: '6,4,6x4', c: '0,0,12x4' });
  // Dragging a down onto c: c hops above it.
  const down = dropAt([P('a', 0, 0, 12, 4), P('c', 0, 4, 12, 4)], 'a', { x: 0, y: 4 });
  assert.deepEqual(pos(down), { a: '0,4,12x4', c: '0,0,12x4' });
  // Dragging the watchlist onto the chart's corner: the chart hops beside it (a swap).
  const side = dropAt(settle(DEFAULT_DESK), 'p2', { x: 0, y: 0 });
  assert.ok(noOverlap(side));
  assert.deepEqual(pos(side).p2, '0,0,4x9');
  assert.deepEqual(pos(side).p1, '4,0,8x9');
  // Dropping into empty space far below floats up to the first free row.
  assert.deepEqual(pos(dropAt(base, 'a', { x: 0, y: 30 })), { a: '0,8,6x4', b: '6,0,6x4', c: '0,4,12x4' });
});

test('resize snaps to cells and reflows the neighbours', () => {
  const base = [P('a', 0, 0, 6, 4), P('b', 6, 0, 6, 4)];
  const wide = resizeTo(base, 'a', { w: 8 });
  assert.ok(noOverlap(wide));
  assert.deepEqual(pos(wide), { a: '0,0,8x4', b: '6,4,6x4' });
  assert.deepEqual(pos(grow(base, 'a', 0, 2)), { a: '0,0,6x6', b: '6,0,6x4' });
  assert.deepEqual(pos(grow(base, 'b', 1, 0)), { a: '0,4,6x4', b: '5,0,7x4' }, 'at the right edge it grows to the left and keeps its row');
});

test('keyboard: Alt+Arrows move until the layout changes', () => {
  const base = [P('a', 0, 0, 12, 4), P('b', 0, 4, 12, 4)];
  assert.deepEqual(pos(nudge(base, 'a', 0, 1)), { a: '0,4,12x4', b: '0,0,12x4' }, 'down swaps with the panel below');
  assert.deepEqual(pos(nudge(base, 'b', 0, -1)), { a: '0,4,12x4', b: '0,0,12x4' }, 'up swaps with the panel above');
  assert.equal(nudge(base, 'b', 0, 1), base, 'the bottom panel cannot go further down');
  const side = [P('a', 0, 0, 4, 4)];
  assert.deepEqual(pos(nudge(side, 'a', 1, 0)), { a: '1,0,4x4' });
  assert.equal(nudge([P('a', 8, 0, 4, 4)], 'a', 1, 0).length, 1);
  assert.deepEqual(pos(nudge([P('a', 8, 0, 4, 4)], 'a', 1, 0)), { a: '8,0,4x4' }, 'no room on the right');
});

test('add, remove, and the phone stack', () => {
  let d = addPanel([P('p1', 0, 0, 8, 9)], 'NEWS');
  assert.deepEqual(pos(d), { p1: '0,0,8x9', p2: '0,9,6x7' });
  assert.deepEqual(findSpot([P('p1', 0, 0, 6, 4)], 6, 4), { x: 6, y: 0 });
  d = removePanel(d, 'p1');
  assert.deepEqual(pos(d), { p2: '0,0,6x7' });
  const full = Array.from({ length: MAX_PANELS }, (_, i) => P(`p${i + 1}`, 0, i * 3, 12, 3));
  assert.equal(addPanel(full, 'NEWS'), full, `a desk holds ${MAX_PANELS} panels`);

  const desk = settle(DEFAULT_DESK);
  assert.deepEqual(stackOrder(desk).map((p) => p.cmd), ['AAPL 1D', 'WATCH', 'NEWS', 'HEATMAP', 'MARKETS']);
  const up = swapInStack(desk, 'p2', -1);
  assert.ok(noOverlap(up));
  assert.deepEqual(stackOrder(up).map((p) => p.cmd), ['WATCH', 'AAPL 1D', 'NEWS', 'HEATMAP', 'MARKETS']);
  const down = swapInStack(desk, 'p3', 1);
  assert.deepEqual(stackOrder(down).map((p) => p.cmd), ['AAPL 1D', 'WATCH', 'HEATMAP', 'NEWS', 'MARKETS']);
  assert.equal(swapInStack(desk, 'p1', -1), desk, 'the first panel cannot go up');
  assert.deepEqual([null, 'blue', 'green'].map(cycleLink), ['blue', 'green', null]);
});

test('persistence: versioned JSON under bb.desks, bad data cleaned, newer versions left alone', () => {
  const mem = new Map();
  const store = { get: (k, f) => (mem.has(k) ? JSON.parse(mem.get(k)) : f), set: (k, v) => mem.set(k, JSON.stringify(v)) };
  assert.equal(DESK_KEY, 'bb.desks');
  const first = loadDesks(store);
  assert.equal(first.writable, true);
  assert.deepEqual(first.state, defaultDesks());
  const s = first.state;
  s.active = 3;
  s.desks[2].panels = [P('p1', 0, 0, 6, 6, { cmd: 'news aapl' })];
  saveDesks(store, s);
  const raw = JSON.parse(mem.get('bb.desks'));
  assert.equal(raw.v, DESK_VERSION);
  assert.match(raw.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  const back = loadDesks(store);
  assert.equal(back.state.active, 3);
  assert.deepEqual(back.state.desks[2].panels, [{ id: 'p1', cmd: 'NEWS AAPL', x: 0, y: 0, w: 6, h: 6, link: null }]);

  // Junk: overlapping, duplicate ids, bad commands and links, a bad desk number.
  const junk = parseDesks({ v: 1, active: 9, desks: [{ panels: [
    { id: 'p1', cmd: 'AAPL', x: 0, y: 0, w: 6, h: 6, link: 'purple' },
    { id: 'p1', cmd: 'MSFT', x: 0, y: 0, w: 6, h: 6 },
    { id: 'p2', cmd: 'MSFT', x: 3, y: 0, w: 6, h: 6 },
    { id: 'p3', cmd: '', x: 0, y: 0, w: 6, h: 6 },
    { id: 'zz', cmd: 'GOLD', x: 0, y: 0, w: 6, h: 6 },
    'nope',
  ] }] });
  assert.equal(junk.state.active, 1);
  assert.deepEqual(pos(junk.state.desks[0].panels), { p1: '0,0,6x6', p2: '3,6,6x6' });
  assert.equal(junk.state.desks[0].panels[0].link, null);
  assert.deepEqual(junk.state.desks[1].panels, []);

  // A newer format from a later version: shown as defaults, never overwritten.
  mem.set('bb.desks', JSON.stringify({ v: 2, desks: 'whatever' }));
  const newer = loadDesks(store);
  assert.equal(newer.writable, false);
  saveDesks(store, newer.state, newer.writable);
  assert.equal(JSON.parse(mem.get('bb.desks')).v, 2);
  assert.deepEqual(parseDesks('junk').state, defaultDesks());
  assert.deepEqual(parseDesks({ v: 0, desks: [] }).state, defaultDesks());
  assert.deepEqual(Object.keys(serializeDesks(defaultDesks(), new Date(0))), ['v', 'active', 'desks', 'updatedAt']);
});

test('DESK command: desks 1 to 4, RESET asks first when it comes from a link, F9', () => {
  assert.deepEqual(parseDeskArgs([]), { n: null, reset: false });
  assert.deepEqual(parseDeskArgs(['2']), { n: 2, reset: false });
  assert.deepEqual(parseDeskArgs(['3', 'RESET']), { n: 3, reset: true });
  assert.deepEqual(parseDeskArgs(['5']), { error: 'usage' });
  assert.equal(parseCommand('desk').name, 'DESK');
  assert.equal(parseCommand('DESK 2').args.n, 2);
  const reset = parseCommand('DESK RESET');
  assert.equal(reset.mutates, true, 'a reload or a shared link never resets by itself');
  assert.equal(reset.view, 'DESK');
  assert.equal(parseCommand('DESK 7').error, 'usage');
  assert.equal(FKEYS.find((k) => k.key === 'F3').cmd, 'DESK');
  assert.ok(COMMANDS.some((c) => c.name === 'DESK'));
  assert.equal(suggest('DES')[0].name, 'DESK');
  assert.equal(suggest('DESK 9')[0].usage, true);
});

test('embed mode: the flag, the panel URL, and the embed page', () => {
  assert.equal(embedSrc('FX 500 USD THB'), '/?c=FX+500+USD+THB&embed=1');
  assert.equal(isEmbedSearch('?c=AAPL&embed=1'), true);
  assert.equal(isEmbedSearch('?c=AAPL&embed=0'), false);
  assert.equal(isEmbedSearch('?c=AAPL'), false);
  assert.equal(isEmbedQuery({ embed: '1' }), true);
  assert.equal(isEmbedQuery({ embed: ['1', '1'] }), false);
  const page = '<html lang="en">\n<head>\n  <script type="module" src="/app.js"></script>\n  <script defer data-website-id="x" data-domain="bloombroke.com" src="https://datafa.st/js/script.js"></script>\n</head>';
  const out = embedHtml(page);
  assert.match(out, /<html lang="en" class="is-embed">/);
  assert.doesNotMatch(out, /datafa\.st/, 'panels do not count as visits');
  assert.match(out, /src="\/app.js"/);
});

test('framing: same origin only', () => {
  const h = securityHeaders();
  assert.equal(h['X-Frame-Options'], 'SAMEORIGIN');
  const csp = h['Content-Security-Policy'].split('; ');
  assert.ok(csp.includes("frame-ancestors 'self'"));
  assert.ok(csp.includes("frame-src 'self'"));
  assert.ok(!/frame-(src|ancestors)[^;]*(https?:|\*)/.test(h['Content-Security-Policy']), 'no other origin may frame or be framed');
});

test('linked panels: a ticker moves to every ticker screen in the group', () => {
  assert.equal(tickerOf('AAPL 1D', parseCommand), 'AAPL');
  assert.equal(tickerOf('NEWS MSFT', parseCommand), 'MSFT');
  assert.equal(tickerOf('WATCH', parseCommand), null);
  assert.equal(tickerOf('HEATMAP', parseCommand), null);
  assert.equal(retarget('AAPL 1D', 'MSFT', parseCommand), 'MSFT 1D');
  assert.equal(retarget('SPX 5D', 'NVDA', parseCommand), 'NVDA 5D');
  assert.equal(retarget('NEWS AAPL', 'TSLA', parseCommand), 'NEWS TSLA');
  assert.equal(retarget('FINANCIALS AAPL BALANCE', 'MSFT', parseCommand), 'FINANCIALS MSFT BALANCE');
  assert.equal(retarget('WATCH', 'MSFT', parseCommand), null);
  assert.equal(retarget('AAPL 1D', 'AAPL', parseCommand), null, 'same ticker: nothing to do');
  assert.equal(COLS, 12);
});
