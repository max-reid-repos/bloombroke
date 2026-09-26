// DESK cards (a WEIRD gauge as a DESK panel), preset desks and the + add syntax.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS, MAX_PANELS, DEFAULT_DESK, PRESETS, PRESET_NAMES, presetPanels, hasUserPanels, parseAdd, parseDeskArgs,
  collides, settle, addPanel, parseDesks, serializeDesks, defaultDesks, clampPanel, syncFrames, embedSrc, MAX_Y,
} from '../public/desk-layout.js';
import {
  cardGauge, cardHtml, cardBody, weirdPickItems, mergeCardRows, nextCardFetch, confirmKey, CARD_MIN_MS, CARD_RETRY_MS,
} from '../public/screens/desk-cards.js';
import { tileBody } from '../public/screens/weird.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { findCommand } from '../public/registry.js';
import { parseCommand } from '../public/app.js';
import { makeWeird } from '../data/weird/index.js';

const ROWS = 16; // the rows that fit the window (screens/desk.js ROWS_FIT)

test('presets: whole cells inside the 12 columns, no overlaps, the 16 rows filled', () => {
  assert.deepEqual(PRESET_NAMES, ['WEIRD', 'MACRO', 'CRYPTO']);
  for (const name of PRESET_NAMES) {
    const panels = presetPanels(name);
    assert.ok(panels.length > 0 && panels.length <= MAX_PANELS, name);
    for (const p of panels) {
      for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(p[k]), `${name} ${p.cmd} ${k}`);
      assert.ok(p.x >= 0 && p.x + p.w <= COLS, `${name} ${p.cmd} fits the columns`);
      assert.ok(p.y >= 0 && p.y + p.h <= ROWS, `${name} ${p.cmd} fits the rows`);
      assert.ok(p.w >= 2 && p.h >= 3, `${name} ${p.cmd} is at least 2 x 3`);
    }
    for (const a of panels) for (const b of panels) assert.ok(a === b || !collides(a, b), `${name}: ${a.cmd} overlaps ${b.cmd}`);
    // Every cell of the 12 x 16 screen is used once: the preset fills the window.
    assert.equal(panels.reduce((n, p) => n + p.w * p.h, 0), COLS * ROWS, `${name} fills the screen`);
    assert.deepEqual(settle(panels), panels, `${name} is already settled`);
    assert.equal(new Set(panels.map((p) => p.id)).size, panels.length);
  }
});

test('presets use only existing commands and gauges', () => {
  for (const name of PRESET_NAMES) {
    for (const p of PRESETS[name]) {
      const c = parseCommand(p.cmd);
      assert.ok(c.name !== 'UNKNOWN' && !c.error, `${name}: ${p.cmd} runs`);
      if (p.card) assert.ok(cardGauge(p.cmd), `${name}: ${p.cmd} is a gauge`);
      else assert.equal(cardGauge(p.cmd), null, `${name}: ${p.cmd} is a framed screen`);
    }
  }
  const cmds = (n) => PRESETS[n].map((p) => p.cmd);
  assert.deepEqual(cmds('WEIRD'), ['CANAL', 'PIZZA', 'DEGEN', 'WAFFLE', 'PANIC', 'BILLIONS', 'CHANCES', 'BOXRATE', 'EGGPRICE', 'HOTDOG', 'OMENS', 'WSB']);
  assert.ok(PRESETS.WEIRD.every((p) => p.card));
  for (const c of ['SPX 1Y', 'CURVE', 'FXMATRIX', 'CPI', 'NEWS MACRO', 'CHANCES', 'BEIGE', 'TRUCKS']) assert.ok(cmds('MACRO').includes(c), `MACRO has ${c}`);
  for (const c of ['BTC 1D', 'ETH 1D', 'CRYPTO', 'DEGEN', 'WSB', 'NEWS']) assert.ok(cmds('CRYPTO').includes(c), `CRYPTO has ${c}`);
});

test('DESK WEIRD, DESK 2 MACRO: presets as commands, confirmed from a link', () => {
  assert.deepEqual(parseDeskArgs(['WEIRD']), { n: null, reset: false, preset: 'WEIRD' });
  assert.deepEqual(parseDeskArgs(['2', 'CRYPTO']), { n: 2, reset: false, preset: 'CRYPTO' });
  assert.deepEqual(parseDeskArgs(['RESET', 'WEIRD']), { error: 'usage' });
  assert.deepEqual(parseDeskArgs(['WEIRD', 'MACRO']), { error: 'usage' });
  assert.deepEqual(parseDeskArgs(['2']), { n: 2, reset: false }, 'no preset key without a preset');
  const c = parseCommand('desk macro');
  assert.equal(c.name, 'DESK');
  assert.equal(c.args.preset, 'MACRO');
  assert.equal(c.mutates, true, 'a shared link never replaces a desk by itself');
  assert.equal(c.view, 'DESK');
  assert.equal(parseCommand('DESK 3 WEIRD').view, 'DESK 3');
  assert.equal(parseCommand('DESK PIZZA').error, 'usage');
  const reg = findCommand('DESK');
  for (const k of PRESET_NAMES) {
    assert.ok(reg.examples.includes(`DESK ${k}`));
    const opt = reg.options.find(([w]) => w === k);
    assert.ok(opt, `HELP DESK lists ${k}`);
    const words = opt[1].split(/\s+/).length;
    assert.ok(words >= 3 && words <= 5, `${k}: a 3 to 5 word description`);
  }
});

test('a preset asks first only over panels of your own', () => {
  assert.equal(hasUserPanels([]), false);
  assert.equal(hasUserPanels(DEFAULT_DESK), false, 'desk 1 out of the box');
  for (const k of PRESET_NAMES) assert.equal(hasUserPanels(presetPanels(k)), false, `${k} untouched`);
  const moved = presetPanels('CRYPTO').map((p, i) => (i === 0 ? { ...p, cmd: 'MSFT 1D' } : p));
  assert.equal(hasUserPanels(moved), true);
  assert.equal(hasUserPanels([{ id: 'p1', cmd: 'NEWS', x: 0, y: 0, w: 6, h: 7, link: null }]), true);
  const relinked = presetPanels('CRYPTO').map((p) => ({ ...p, link: p.link ? null : 'green' }));
  assert.equal(hasUserPanels(relinked), true, 'changed link groups are your own work too');
  assert.equal(hasUserPanels(DEFAULT_DESK.map((p) => ({ ...p, link: null }))), true);
});

test('confirm keys: Enter replaces only from the page, the empty bar or the line', () => {
  for (const where of ['page', 'command', 'confirm']) assert.equal(confirmKey('Enter', where), 'replace', where);
  assert.equal(confirmKey('Enter', 'control'), null, 'Enter on ESC: KEEP, a link, a tab or a card does its own thing');
  assert.equal(confirmKey('Enter', 'typing'), null, 'a typed command runs');
  for (const where of ['page', 'command', 'confirm', 'control']) assert.equal(confirmKey('Escape', where), 'keep', where);
  assert.equal(confirmKey('Escape', 'typing'), null);
  assert.equal(confirmKey('a', 'page'), null);
});

// The DESK grid's node bookkeeping (screens/desk.js runs syncFrames with DOM make, drop
// and reload): a fake grid where each frame has the src it would load.
function fakeGrid() {
  const frames = new Map();
  const log = [];
  const cardOf = (p) => (p.card ? cardGauge(p.cmd) : null);
  const ops = {
    cardOf,
    make: (p) => { const card = cardOf(p); frames.set(p.id, { cmd: p.cmd, card, src: card ? null : embedSrc(p.cmd) }); log.push(`make ${p.id}`); },
    drop: (id) => { frames.delete(id); log.push(`drop ${id}`); },
    reload: (p, f) => { f.cmd = p.cmd; f.src = embedSrc(p.cmd); log.push(`reload ${p.id}`); },
  };
  return { frames, log, sync: (panels) => syncFrames(frames, panels, ops) };
}
const srcMatches = (frames, panels) => panels.every((p) => {
  const f = frames.get(p.id);
  return f && (p.card ? f.card === cardGauge(p.cmd) && f.src === null : f.src === embedSrc(p.cmd));
});

test('a preset loaded in place runs its own screens, not the old ones', () => {
  for (const name of PRESET_NAMES) {
    // Load over desk 1 (ids p1.. reused), the way loadPreset does: drop all, then sync.
    const g = fakeGrid();
    g.sync(DEFAULT_DESK);
    assert.ok(srcMatches(g.frames, DEFAULT_DESK));
    for (const [id] of [...g.frames]) g.frames.delete(id);
    const next = presetPanels(name);
    g.sync(next);
    assert.ok(srcMatches(g.frames, next), `${name}: every frame shows its panel command`);
    assert.equal(g.frames.size, next.length);
    // Enter-replace over another preset goes the same way.
    for (const [id] of [...g.frames]) g.frames.delete(id);
    g.sync(presetPanels('MACRO'));
    assert.ok(srcMatches(g.frames, presetPanels('MACRO')));
  }
  // Without the drop, a reused id with another command still reloads (never a stale screen).
  const g = fakeGrid();
  g.sync(DEFAULT_DESK);
  const macro = presetPanels('MACRO');
  g.sync(macro);
  assert.ok(srcMatches(g.frames, macro), 'SPX 1Y in p1, not AAPL 1D');
  assert.ok(g.log.includes('reload p1'));
  assert.ok(g.log.includes('drop p4'), 'HEATMAP p4 became the CHANCES card: a new node');
  // The same command again: nothing reloads.
  g.log.length = 0;
  g.sync(macro);
  assert.deepEqual(g.log, []);
});

test('a corrupt save far down the page is clamped, and settles fast', () => {
  assert.equal(clampPanel({ id: 'p1', x: 0, y: 1e12, w: 4, h: 4 }).y, MAX_Y);
  const t = Date.now();
  const s = parseDesks({ v: 1, desks: [{ panels: [{ id: 'p1', cmd: 'NEWS', x: 0, y: 9e15, w: 12, h: 4 }, { id: 'p2', cmd: 'WATCH', x: 0, y: 9e15, w: 12, h: 4 }] }] }).state;
  assert.ok(Date.now() - t < 500);
  assert.deepEqual(s.desks[0].panels.map((p) => p.y), [0, 4]);
});

test('add syntax on DESK: +CANAL, +PANEL CANAL, + alone opens the picker', () => {
  assert.deepEqual(parseAdd('+CANAL'), { cmd: 'CANAL' });
  assert.deepEqual(parseAdd('+ canal'), { cmd: 'CANAL' });
  assert.deepEqual(parseAdd('+PANEL CANAL'), { cmd: 'CANAL' });
  assert.deepEqual(parseAdd('+ PANEL aapl  1d'), { cmd: 'AAPL 1D' });
  assert.deepEqual(parseAdd('+'), { cmd: '' });
  assert.deepEqual(parseAdd('+PANEL'), { cmd: '' });
  assert.equal(parseAdd('CANAL'), null);
  assert.equal(parseAdd('DESK 2'), null);
  // An alias adds its gauge: the stored command is the gauge's own.
  assert.equal(parseCommand(parseAdd('+SHIPS').cmd).input, 'CANAL');
  assert.ok(cardGauge(parseCommand('SHIPS').input));
  // A card goes in the first free spot and keeps its flag.
  const d = addPanel([{ id: 'p1', cmd: 'NEWS', x: 0, y: 0, w: 6, h: 7, link: null }], 'CANAL', { w: 3, h: 4, card: true });
  assert.deepEqual(d[1], { id: 'p2', cmd: 'CANAL', x: 6, y: 0, w: 3, h: 4, link: null, card: true });
  assert.equal('card' in addPanel([], 'NEWS')[0], false);
});

test('the + PANEL picker has every gauge in a Weird data group', () => {
  const all = weirdPickItems('');
  assert.equal(all.length, WEIRD_GAUGES.length);
  assert.equal(all.length, 23);
  assert.deepEqual(all.map((s) => s.value), WEIRD_GAUGES.map((g) => g.command));
  assert.ok(all.every((s) => s.hint && s.name === s.value));
  const ca = weirdPickItems('ca').map((s) => s.value);
  assert.equal(ca[0], 'CANAL', 'names first');
  assert.deepEqual(ca, ['CANAL', 'BOXES'], 'BOXES by its alias CARDBOARD; no substrings (carloads, Macau, casino)');
  assert.deepEqual(weirdPickItems('hormuz').map((s) => s.value), ['CANAL'], 'a whole word of its description');
  assert.deepEqual(weirdPickItems('ships').map((s) => s.value)[0], 'CANAL', 'an alias');
  assert.ok(weirdPickItems('eggs').some((s) => s.value === 'EGGPRICE'));
  assert.deepEqual(weirdPickItems('egg').map((s) => s.value), ['EGGPRICE']);
  assert.deepEqual(weirdPickItems('zzzz'), []);
});

test('card mode: the WEIRD tile body, escaped, dimmed when stale', () => {
  const g = cardGauge('CANAL');
  const row = { id: 'canal', ok: true, stale: false, headline: 'HORMUZ 3 SHIPS/DAY', line: '7-day average', spark: [1, 3, 2], asOf: '2026-09-20', source: 'IMF PortWatch' };
  assert.equal(cardBody(g, row), tileBody(g, row), 'the tile renderer itself, not a copy');
  const html = cardHtml(g, row);
  assert.ok(html.includes(tileBody(g, row)));
  assert.match(html, /class="wd-tile dp-card" data-card="CANAL" tabindex="0"/);
  assert.match(html, /<svg class="spark"/);
  assert.doesNotMatch(html, /panel-head/, 'the DESK panel head names the gauge');
  assert.match(cardHtml(g, null), /LOADING/);
  assert.match(cardHtml(g, { ...row, stale: true }), /wd-big is-stale/);
  assert.match(cardHtml(g, { id: 'canal', ok: false, headline: 'NO DATA', source: 'IMF PortWatch' }), /wd-big is-none">NO DATA/);
  const evil = cardHtml(g, { ...row, headline: '<img src=x onerror=alert(1)>', line: '"><script>', source: '<b>' });
  assert.doesNotMatch(evil, /<img|<script|<b>/);
  assert.match(evil, /&lt;img/);
  assert.equal(cardGauge('AAPL 1D'), null);
  assert.equal(cardGauge('canal'), g);
});

test('cards are saved with the desk; old saves are unchanged', () => {
  const s = defaultDesks();
  s.desks[1].panels = presetPanels('MACRO');
  const back = parseDesks(JSON.parse(JSON.stringify(serializeDesks(s)))).state;
  assert.deepEqual(back.desks[1].panels.filter((p) => p.card).map((p) => p.cmd), ['CHANCES', 'BEIGE', 'TRUCKS']);
  assert.equal(back.desks[0].panels.some((p) => 'card' in p), false);
  const junk = parseDesks({ v: 1, desks: [{ panels: [{ id: 'p1', cmd: 'CANAL', x: 0, y: 0, w: 3, h: 4, card: 'yes' }] }] }).state;
  assert.equal('card' in junk.desks[0].panels[0], false, 'only card: true counts');
});

test('cards share one fetch, again when the first gauge is due', () => {
  const t0 = Date.parse('2026-09-26T00:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  const rows = mergeCardRows(new Map(), [
    { id: 'canal', ok: true, updated: iso(t0 - 60 * 60_000), ttl: 6 * 60 * 60_000 },
    { id: 'pizza', ok: true, updated: iso(t0 - 60_000), ttl: 10 * 60_000 },
    { id: 'wsb', ok: false, headline: 'NO DATA' },
    { id: 'degen', ok: false, pending: true, headline: 'LOADING' },
  ]);
  assert.equal(nextCardFetch(rows, [], t0), null, 'no cards, no fetch');
  assert.equal(nextCardFetch(rows, ['canal'], t0), t0 + 5 * 60 * 60_000 + 5_000, 'its own ttl');
  assert.equal(nextCardFetch(rows, ['canal', 'pizza'], t0), t0 + 9 * 60_000 + 5_000, 'the first one due');
  assert.equal(nextCardFetch(rows, ['wsb'], t0), t0 + CARD_RETRY_MS, 'no data: try again later');
  assert.equal(nextCardFetch(rows, ['degen'], t0), t0 + CARD_MIN_MS, 'pending: soon');
  assert.equal(nextCardFetch(rows, ['canal', 'nope'], t0), t0 + CARD_MIN_MS);
  const late = mergeCardRows(rows, [{ id: 'pizza', updated: iso(t0 - 11 * 60_000), ok: true, ttl: 10 * 60_000 }]);
  assert.equal(nextCardFetch(late, ['pizza'], t0), t0 + CARD_MIN_MS, 'never sooner than a minute after the last fetch');
  // Server time: a browser clock 30 minutes fast still waits the gauge's own ttl, not a minute.
  const fast = t0 + 30 * 60_000;
  assert.equal(nextCardFetch(rows, ['pizza'], fast, t0), fast + 9 * 60_000 + 5_000);
  const slow = t0 - 30 * 60_000;
  assert.equal(nextCardFetch(rows, ['pizza'], slow, t0), slow + 9 * 60_000 + 5_000, 'a slow clock does not wait longer');
  // A gauge that comes back pending keeps the value it had.
  const kept = mergeCardRows(rows, [{ id: 'pizza', ok: false, pending: true }, { id: 'canal', ok: false, headline: 'NO DATA' }]);
  assert.equal(kept.get('pizza').ok, true);
  assert.equal(kept.get('canal').ok, false);
});

test('the WEIRD summary carries each gauge ttl for the cards', async () => {
  const g = { id: 'a', source: 'A', ttl: 1234, load: async () => ({ headline: 'OK' }) };
  const w = makeWeird({ gauges: [g], lastGoodDir: null, fetchImpl: async () => new Response('{}') });
  const s = await w.getWeird({ wait: 500 });
  assert.equal(s.gauges[0].ttl, 1234);
  assert.equal(s.gauges[0].headline, 'OK');
});
