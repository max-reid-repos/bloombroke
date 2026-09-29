// FISHTANK design review: the always-named fish (the 5 biggest companies and today's top
// and bottom mover), the NAMES toggle for every name (no L key), the keyboard (the tank is
// one Tab stop, the arrows walk the fish, Enter opens one, Esc leaves), and readable scale text (a solid 0% rule labelled at 13
// px, 13 px legend). The screen runs on a small fake canvas and DOM here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  render, alwaysNamed, tagPlan, nextFishIndex, namesToggleHtml, BIG, SCALE_PX, TAG_PX,
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

test('fishtank NAMES: an outlined chip, a real button (Enter and Space press it), pressed when on; no L key at all', () => {
  assert.equal(namesToggleHtml(false), '<button type="button" class="chip ft-names" id="ft-names" aria-pressed="false" title="Show the ticker of every fish">NAMES</button>');
  assert.match(namesToggleHtml(true), /aria-pressed="true"/);
  const src = readFileSync('public/screens/fishtank.js', 'utf8');
  assert.doesNotMatch(src, /isNamesKey|e\.key === 'l'|e\.key !== 'l'|key === 'L'/, 'no key handler for L');
  assert.doesNotMatch(src, /<kbd>L<\/kbd>/);
  const css = readFileSync('public/screens/fishtank.css', 'utf8');
  assert.match(css, /\.ft-names\[aria-pressed="true"\] \{ background: var\(--here\);/, 'on: the ice-blue fill of a toggle that is on');
});

test('fishtank keys: the arrows walk the fish biggest first and stop at the ends; Tab is not theirs', () => {
  assert.equal(nextFishIndex(-1, 'ArrowRight', 5), 0);
  assert.equal(nextFishIndex(2, 'ArrowRight', 5), 3);
  assert.equal(nextFishIndex(2, 'ArrowDown', 5), 3);
  assert.equal(nextFishIndex(4, 'ArrowRight', 5), 4, 'the arrows stop at the end');
  assert.equal(nextFishIndex(0, 'ArrowLeft', 5), 0);
  assert.equal(nextFishIndex(3, 'ArrowUp', 5), 2);
  assert.equal(nextFishIndex(3, 'Home', 5), 0);
  assert.equal(nextFishIndex(1, 'End', 5), 4);
  assert.equal(nextFishIndex(2, 'Tab', 5), 2, 'Tab does not move between fish');
  assert.equal(nextFishIndex(-1, 'ArrowRight', 0), -1);
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

function harness(data, { embed = false } = {}) {
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
      attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, addEventListener: (t, f) => { (on[t] ||= []).push(f); }, removeEventListener() {},
      getContext: () => g, querySelectorAll: () => [], matches: () => false, focus() { this.focused = true; }, ...extra,
    };
  };
  const canvas = el(); const tip = el(); const sr = el(); const live = el();
  const host = el({ querySelector: (sel) => ({ canvas, '.ft-tip': tip, '.ft-sr': sr, '.ft-live': live }[sel]) });
  const meta = el();
  const head = el();
  const leg = el({ querySelectorAll: () => [] });
  const names = el();
  const root = el({ querySelector: (sel) => ({ '#ft-host': host, '#ft-meta': meta, '#ft-leg': leg, '#ft-head': head, '#ft-names': embed ? null : names }[sel]) });
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
  const refresh = [];
  const ctx = {
    fetchJSON: async () => data, signal: null, run: (c) => ran.push(c), updated() {}, status() {}, embed,
    onCleanup: (f) => cleanups.push(f), live: (f) => refresh.push(f),
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
    canvas, cmd, live, tip, head, host, root, names, texts, rects, ran, press, keys, ctx,
    refresh: async () => { for (const f of refresh) await f(); },
    // The tickers drawn as tags in the last still frame (the tags are drawn last).
    tags: () => new Set(texts.filter(([t, f]) => f.startsWith(`600 ${TAG_PX}px`)).map(([t]) => t.split(' ')[0])),
    start: async () => { render(root, { name: 'FISHTANK', args: {} }, ctx); await new Promise((r) => { setImmediate(r); }); },
    done() { for (const f of cleanups) f(); for (const [k, v] of Object.entries(saved)) globalThis[k] = v; },
  };
}
const DATA = { stocks: STOCKS, sectors: SECTORS, updated: '2026-09-29T15:08:00Z', stale: false };

test('fishtank screen: the always-named fish show their tags; NAMES names all of them and again goes back', async () => {
  const h = harness(DATA);
  try {
    await h.start();
    const always = ['NVDA', 'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'ORCL', 'WMT'];
    assert.deepEqual([...h.tags()].sort(), [...always].sort(), 'only the always-named, before NAMES');
    // NAMES sits in the strip, after the counts (which a refresh rebuilds on their own).
    assert.match(h.root.innerHTML, /<span class="ft-head" id="ft-head"><\/span><span class="ft-sep"> · <\/span><button type="button" class="chip ft-names" id="ft-names" aria-pressed="false"/);
    assert.match(h.head.innerHTML, /21|up/);
    // Clicked (or Enter or Space: it is a button, the browser sends a click).
    h.texts.length = 0;
    for (const f of h.names.on.click) f({});
    assert.equal(h.names.getAttribute('aria-pressed'), 'true');
    assert.deepEqual([...h.tags()].sort(), STOCKS.map((s) => s.ticker).sort(), 'NAMES on: every fish named');
    h.texts.length = 0;
    for (const f of h.names.on.click) f({});
    assert.equal(h.names.getAttribute('aria-pressed'), 'false');
    assert.deepEqual([...h.tags()].sort(), [...always].sort(), 'off again: back to the few');
    // L is typing, never a toggle: nothing takes it, nothing is redrawn.
    h.texts.length = 0;
    const body = { id: '', closest: () => null, matches: () => false, value: '' };
    for (const target of [body, h.canvas, h.cmd]) {
      const ev = h.press('l', target);
      assert.equal(ev.prevented, false);
      assert.equal(ev.stopped, false);
    }
    assert.equal(h.texts.length, 0, 'nothing redrawn');
    // A refresh keeps NAMES (built once) and its state.
    for (const f of h.names.on.click) f({});
    await h.refresh();
    assert.equal(h.names.getAttribute('aria-pressed'), 'true');
  } finally { h.done(); }
});

test('fishtank screen: in a DESK panel no NAMES toggle and no tank keys', async () => {
  const h = harness(DATA, { embed: true });
  try {
    await h.start();
    assert.doesNotMatch(h.root.innerHTML, /ft-names|NAMES/);
    assert.match(h.host.innerHTML, /<canvas class="ft-canvas" role="img"/);
    assert.doesNotMatch(h.host.innerHTML, /tabindex/);
    assert.equal(h.canvas.on.keydown, undefined, 'no keys on the canvas');
    assert.equal(h.canvas.on.focus, undefined);
    // The always-named still show.
    assert.ok(h.tags().has('NVDA') && h.tags().has('ORCL'));
  } finally { h.done(); }
});

test('fishtank screen: one Tab stop; the arrows walk the fish from the biggest, Enter opens that ticker, Esc leaves', async () => {
  const h = harness(DATA);
  try {
    await h.start();
    assert.match(h.host.innerHTML, /<canvas class="ft-canvas" tabindex="0" role="application" aria-roledescription="fish tank" aria-label=/, 'one Tab stop, an application with a name');
    assert.equal((h.host.innerHTML.match(/tabindex="0"/g) || []).length, 1);
    // A keyboard focus (Tab into the canvas): the biggest fish.
    h.canvas.matches = (s) => s === ':focus-visible';
    const focus = () => { for (const f of h.canvas.on.focus) f({ relatedTarget: {} }); };
    const blur = () => { for (const f of h.canvas.on.blur) f({}); };
    focus();
    assert.match(h.live.textContent, /^NVDA Nvidia \+0\.70%\. Enter opens it\.$/);
    assert.equal(h.tip.hidden, false, 'its name and move show, as on hover');
    let ev = h.press('ArrowRight', h.canvas);
    assert.ok(ev.prevented);
    assert.match(h.live.textContent, /^AAPL /);
    h.press('ArrowRight', h.canvas);
    assert.match(h.live.textContent, /^GOO/, 'the third biggest');
    h.press('ArrowLeft', h.canvas);
    assert.match(h.live.textContent, /^AAPL /);
    // Tab and Shift+Tab are not taken: the browser moves on out of the tank.
    for (const shiftKey of [false, true]) {
      ev = h.press('Tab', h.canvas, { shiftKey });
      assert.equal(ev.prevented, false);
      assert.match(h.live.textContent, /^AAPL /, 'Tab does not walk the fish');
    }
    // Leaving and coming back: the same fish (a roving focus).
    blur();
    assert.equal(h.live.textContent, '');
    focus();
    assert.match(h.live.textContent, /^AAPL /);
    // A ring round it, in ice blue.
    assert.ok(h.rects.some(([c]) => c === 'hsl(201, 100%, 78%)'), 'the focus ring is drawn');
    // A refresh (setStocks) leaves the live line alone: nothing new is said.
    const said = h.live.textContent;
    DATA.stocks.find((s) => s.ticker === 'AAPL').changePct = -2.5;
    try { await h.refresh(); } finally { DATA.stocks.find((s) => s.ticker === 'AAPL').changePct = -1.9; }
    assert.equal(h.live.textContent, said, 'the live line is unchanged on a refresh');
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
    blur();
    h.canvas.matches = () => false;
    focus();
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
