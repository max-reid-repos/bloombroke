// FISHTANK design review: the always-named fish (the 5 biggest companies and today's top
// and bottom mover), L for every name, the keyboard (Tab and the arrows walk the fish,
// Enter opens one, Esc leaves), and readable scale text (a solid 0% rule labelled at 13
// px, 13 px legend). The screen runs on a small fake canvas and DOM here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  render, alwaysNamed, tagPlan, isNamesKey, nextFishIndex, BIG, SCALE_PX, TAG_PX,
} from '../public/screens/fishtank.js';
import { SECTORS } from '../data/sp100.js';

// ---- the pure parts ----------------------------------------------------------------------

const STOCKS = [
  { ticker: 'NVDA', name: 'Nvidia', sector: 'TECH', changePct: 0.7, marketCap: 5.5e12 },
  { ticker: 'AAPL', name: 'Apple', sector: 'TECH', changePct: -1.9, marketCap: 4.8e12 },
  { ticker: 'GOOG', name: 'Alphabet C', sector: 'COMM', changePct: -1, marketCap: 4.07e12 },
  { ticker: 'GOOGL', name: 'Alphabet A', sector: 'COMM', changePct: -1.1, marketCap: 4.07e12 },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'TECH', changePct: -0.1, marketCap: 3.7e12 },
  { ticker: 'AMZN', name: 'Amazon', sector: 'DISC', changePct: 0.02, marketCap: 2.6e12 },
  { ticker: 'META', name: 'Meta Platforms', sector: 'COMM', changePct: 0.8, marketCap: 1.8e12 },
  { ticker: 'ORCL', name: 'Oracle', sector: 'TECH', changePct: 6.3, marketCap: 0.8e12 },
  { ticker: 'WMT', name: 'Walmart', sector: 'STAPLES', changePct: -6.3, marketCap: 0.8e12 },
  { ticker: 'KO', name: 'Coca-Cola', sector: 'STAPLES', changePct: 0.1, marketCap: null },
];

test('fishtank names: the 5 biggest companies and the top and bottom mover always show', () => {
  assert.equal(BIG, 5);
  const n = alwaysNamed(STOCKS);
  // Alphabet once (its A class), so the fifth is AMZN; no cap, no place.
  assert.deepEqual(n, { big: ['NVDA', 'AAPL', 'GOOGL', 'MSFT', 'AMZN'], winner: 'ORCL', loser: 'WMT' });
  assert.deepEqual(alwaysNamed([]), { big: [], winner: null, loser: null });
  // The order of the input does not matter.
  assert.deepEqual(alwaysNamed([...STOCKS].reverse()), n);
});

test('fishtank names: the tag plan draws the always-named first and for sure; L adds every other fish', () => {
  const fish = STOCKS.map((s) => ({ s, sector: s.sector, kind: s.sector === 'RE' ? 'crab' : 'fish' }));
  fish.push({ s: { ticker: 'AMT' }, sector: 'RE', kind: 'crab' });
  const by = (t) => fish.find((f) => f.s.ticker === t);
  const named = alwaysNamed(STOCKS);
  const opts = { winner: by(named.winner), loser: by(named.loser), big: named.big.map(by) };
  const ids = (plan) => plan.map((p) => `${p.f.s.ticker}:${p.tag}${p.must ? '!' : ''}`);
  assert.deepEqual(ids(tagPlan(fish, opts)), ['AMT:crab', 'ORCL:winner!', 'WMT:loser!', 'NVDA:big!', 'AAPL:big!', 'GOOGL:big!', 'MSFT:big!', 'AMZN:big!']);
  const all = tagPlan(fish, { ...opts, all: true });
  assert.deepEqual(ids(all).slice(0, 8), ids(tagPlan(fish, opts)), 'the always-named keep their place');
  assert.deepEqual(ids(all).slice(8), ['GOOG:name', 'META:name', 'KO:name'], 'then every other fish, which gives way when there is no room');
  assert.equal(new Set(all.map((p) => p.f)).size, fish.length, 'every fish once');
  // A lit sector: only its own fish, the always-named of it still for sure.
  assert.deepEqual(ids(tagPlan(fish, { ...opts, active: 'COMM', all: true })), ['GOOGL:big!', 'GOOG:sector', 'META:sector']);
});

test('fishtank L: the key names every fish, never while typing in the command bar or a field', () => {
  const body = { id: '', closest: () => null };
  const canvas = { id: '', closest: () => null };
  const cmd = { id: 'cmd', closest: (s) => (s.includes('input') ? {} : null) };
  const field = { id: 'x', closest: (s) => (s.includes('input') ? {} : null) };
  const k = (key, target, mods = {}) => ({ key, target, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...mods });
  assert.equal(isNamesKey(k('l', body)), true);
  assert.equal(isNamesKey(k('L', canvas)), true);
  assert.equal(isNamesKey(k('l', cmd)), false, 'the command bar: it is typing');
  assert.equal(isNamesKey(k('l', field)), false);
  assert.equal(isNamesKey(k('l', body, { ctrlKey: true })), false);
  assert.equal(isNamesKey(k('l', body, { metaKey: true })), false);
  assert.equal(isNamesKey(k('k', body)), false);
  assert.equal(isNamesKey(null), false);
});

test('fishtank keys: Tab and the arrows walk the fish biggest first; Tab past either end leaves', () => {
  assert.equal(nextFishIndex(-1, 'Tab', 5), 0, 'Tab in: the biggest');
  assert.equal(nextFishIndex(-1, 'Tab', 5, true), 4, 'Shift+Tab in: the smallest');
  assert.equal(nextFishIndex(0, 'Tab', 5), 1);
  assert.equal(nextFishIndex(4, 'Tab', 5), -1, 'past the last: out of the tank');
  assert.equal(nextFishIndex(0, 'Tab', 5, true), -1, 'before the first: out');
  assert.equal(nextFishIndex(2, 'ArrowRight', 5), 3);
  assert.equal(nextFishIndex(2, 'ArrowDown', 5), 3);
  assert.equal(nextFishIndex(4, 'ArrowRight', 5), 4, 'the arrows stop at the end');
  assert.equal(nextFishIndex(0, 'ArrowLeft', 5), 0);
  assert.equal(nextFishIndex(3, 'ArrowUp', 5), 2);
  assert.equal(nextFishIndex(3, 'Home', 5), 0);
  assert.equal(nextFishIndex(1, 'End', 5), 4);
  assert.equal(nextFishIndex(-1, 'Tab', 0), -1);
});

test('fishtank text: the 0% label and the scale at 13 px, tags at 12, the legend at 13; no 11 px text in the tank', () => {
  assert.equal(SCALE_PX, 13);
  assert.ok(TAG_PX >= 11 && TAG_PX === 12);
  const src = readFileSync('public/screens/fishtank.js', 'utf8');
  assert.doesNotMatch(src, /font = `(?:600 )?(?:9|10|11)px/, 'no canvas text under 12 px');
  const css = readFileSync('public/screens/fishtank.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const leg = /\.ft-leg-btn \{[^}]*\}/.exec(css)[0];
  assert.match(leg, /font-size: 13px/);
  assert.match(/\.ft-leg \{[^}]*\}/.exec(css)[0], /height: 30px/, 'a row tall enough for it');
});

// ---- the screen on a fake canvas ------------------------------------------------------------

function harness(data) {
  const saved = {};
  for (const k of ['window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver']) saved[k] = globalThis[k];
  const texts = []; // [text, font] for every fillText
  const rects = []; // [fillStyle, x, y, w, h]
  const g = {
    font: '', fillStyle: '', globalAlpha: 1, imageSmoothingEnabled: true, textAlign: '', textBaseline: '',
    fillText(t) { texts.push([t, g.font]); }, fillRect(...a) { rects.push([g.fillStyle, ...a]); },
    measureText: (t) => ({ width: String(t).length * 7 }), setTransform() {}, drawImage() {}, clearRect() {},
  };
  const el = (extra = {}) => {
    const on = {};
    return {
      innerHTML: '', textContent: '', style: {}, hidden: false, clientWidth: 1400, clientHeight: 700, offsetWidth: 90, offsetHeight: 20, on,
      setAttribute() {}, addEventListener: (t, f) => { (on[t] ||= []).push(f); }, removeEventListener() {},
      getContext: () => g, querySelectorAll: () => [], matches: () => false, focus() { this.focused = true; }, ...extra,
    };
  };
  const canvas = el(); const tip = el(); const sr = el(); const live = el();
  const host = el({ querySelector: (sel) => ({ canvas, '.ft-tip': tip, '.ft-sr': sr, '.ft-live': live }[sel]) });
  const meta = el();
  const leg = el({ querySelectorAll: () => [] });
  const root = el({ querySelector: (sel) => ({ '#ft-host': host, '#ft-meta': meta, '#ft-leg': leg }[sel]) });
  const keys = new Set();
  const cmd = { id: 'cmd', focused: false, focus() { this.focused = true; }, closest: () => ({}) };
  class Obs { observe() {} disconnect() {} }
  globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.document = {
    hidden: false, createElement: () => el(), getElementById: (id) => (id === 'cmd' ? cmd : null),
    addEventListener: (t, f) => { if (t === 'keydown') keys.add(f); }, removeEventListener: (t, f) => keys.delete(f),
  };
  globalThis.getComputedStyle = () => ({ fontFamily: 'monospace' });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = Obs;
  globalThis.IntersectionObserver = Obs;
  const ran = [];
  const cleanups = [];
  const ctx = {
    fetchJSON: async () => data, signal: null, run: (c) => ran.push(c), updated() {}, status() {},
    onCleanup: (f) => cleanups.push(f), live() {},
  };
  const press = (key, target, mods = {}) => {
    const ev = { key, target, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, prevented: false, stopped: false, ...mods };
    ev.preventDefault = () => { ev.prevented = true; };
    ev.stopPropagation = () => { ev.stopped = true; };
    for (const f of [...keys]) f(ev);
    if (!ev.stopped && target === canvas) for (const f of canvas.on.keydown || []) f(ev);
    return ev;
  };
  return {
    canvas, cmd, live, tip, meta, texts, rects, ran, press,
    // The tickers drawn as tags in the last still frame (the tags are drawn last).
    tags: () => new Set(texts.filter(([t, f]) => f.startsWith(`600 ${TAG_PX}px`)).map(([t]) => t.split(' ')[0])),
    start: async () => { render(root, { name: 'FISHTANK', args: {} }, ctx); await new Promise((r) => { setImmediate(r); }); },
    done() { for (const f of cleanups) f(); for (const [k, v] of Object.entries(saved)) globalThis[k] = v; },
  };
}
const DATA = { stocks: STOCKS, sectors: SECTORS, updated: '2026-09-29T15:08:00Z', stale: false };

test('fishtank screen: the always-named fish show their tags; L names all of them and L again goes back', async () => {
  const h = harness(DATA);
  try {
    await h.start();
    const always = ['NVDA', 'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'ORCL', 'WMT'];
    assert.deepEqual([...h.tags()].sort(), [...always].sort(), 'only the always-named, before L');
    h.texts.length = 0;
    const body = { id: '', closest: () => null };
    const ev = h.press('l', body);
    assert.ok(ev.prevented && ev.stopped, 'L is taken (it does not type into the command bar)');
    assert.deepEqual([...h.tags()].sort(), STOCKS.map((s) => s.ticker).sort(), 'L: every fish named');
    h.texts.length = 0;
    h.press('L', body);
    assert.deepEqual([...h.tags()].sort(), [...always].sort(), 'L again: back to the few');
    // In the command bar L is typing.
    h.texts.length = 0;
    const typed = h.press('l', h.cmd);
    assert.equal(typed.prevented, false);
    assert.equal(h.texts.length, 0, 'nothing redrawn');
    // The strip says the key.
    assert.match(h.meta.innerHTML, /<kbd>L<\/kbd> names/);
  } finally { h.done(); }
});

test('fishtank screen: Tab walks the fish from the biggest, Enter opens that ticker, Esc leaves to the command bar', async () => {
  const h = harness(DATA);
  try {
    await h.start();
    // A keyboard focus (Tab into the canvas): the biggest fish.
    h.canvas.matches = (s) => s === ':focus-visible';
    h.canvas.compareDocumentPosition = () => 2; // came from before it
    for (const f of h.canvas.on.focus) f({ relatedTarget: {} });
    assert.match(h.live.textContent, /^NVDA Nvidia \+0\.70%\. Enter opens it\.$/);
    assert.equal(h.tip.hidden, false, 'its name and move show, as on hover');
    let ev = h.press('Tab', h.canvas);
    assert.ok(ev.prevented, 'Tab stays in the tank while there is a next fish');
    assert.match(h.live.textContent, /^AAPL /);
    h.press('ArrowRight', h.canvas);
    assert.match(h.live.textContent, /^GOO/, 'the third biggest');
    h.press('ArrowLeft', h.canvas);
    assert.match(h.live.textContent, /^AAPL /);
    // A ring round it, in ice blue.
    assert.ok(h.rects.some(([c]) => c === 'hsl(201, 100%, 78%)'), 'the focus ring is drawn');
    ev = h.press('Enter', h.canvas);
    assert.deepEqual(h.ran, ['AAPL'], 'Enter: the same command as typing the ticker');
    assert.ok(ev.stopped);
    ev = h.press('Escape', h.canvas);
    assert.ok(ev.prevented && ev.stopped, 'Esc leaves the fish, it never goes back a screen');
    assert.equal(h.live.textContent, '');
    assert.equal(h.cmd.focused, true, 'the focus goes back to the command bar');
    // Enter with no fish in focus does nothing.
    ev = h.press('Enter', h.canvas);
    assert.equal(ev.prevented, false);
    assert.deepEqual(h.ran, ['AAPL']);
    // A click focus (not a keyboard one) starts on no fish.
    h.canvas.matches = () => false;
    for (const f of h.canvas.on.focus) f({ relatedTarget: null });
    assert.equal(h.live.textContent, '');
    // Tab off the end leaves the tank (default Tab).
    h.canvas.matches = (s) => s === ':focus-visible';
    for (const f of h.canvas.on.focus) f({ relatedTarget: null });
    for (let i = 0; i < STOCKS.length - 1; i += 1) h.press('Tab', h.canvas);
    ev = h.press('Tab', h.canvas);
    assert.equal(ev.prevented, false, 'past the last fish: the browser moves the focus on');
    assert.equal(h.live.textContent, '');
  } finally { h.done(); }
});

test('fishtank screen: the 0% line is a solid rule across the tank, labelled at 13 px, the scale too', async () => {
  const h = harness(DATA);
  try {
    await h.start();
    const zero = h.texts.find(([t]) => t === '0%');
    assert.ok(zero, 'a 0% label');
    assert.match(zero[1], /^13px /);
    for (const t of ['+6.30%', '−6.30%']) {
      const lab = h.texts.find(([x]) => x === t);
      assert.ok(lab, t);
      assert.match(lab[1], /^13px /);
    }
    // One rect the whole tank wide, one pixel tall, in the rule colour: solid, not dots.
    const rule = h.rects.filter(([c]) => c === 'hsla(208, 30%, 60%, 0.3)');
    assert.ok(rule.length >= 1, 'drawn (once per background paint)');
    assert.ok(rule.every(([, x, , w, hh]) => x === 0 && w === 1400 && hh === 1), 'each one the full width, one pixel tall');
    assert.equal(h.texts.filter(([, f]) => /^(?:600 )?(?:9|10|11)px/.test(f)).length, 0, 'no text under 12 px');
  } finally { h.done(); }
});
