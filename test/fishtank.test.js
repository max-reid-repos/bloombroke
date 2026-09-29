import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pctToDepth, depthRange, capToSize, fishColor, pickExtremes, tankHeader, sizeLimits, seeded, makeRunner, render,
  SPECIES, SPECIES_NAME, speciesOf, FISH_SCALE, MAX_OF_H, legendItems, legendHtml, tagPlan, toggleSector, sectorAlpha, DIM, sectorCentre, schoolStep,
  FISH_SPRITES, spriteOf, spriteScale, animFrame, spriteColors, colorLevel, LEVELS, drawGlyph, mirrored,
} from '../public/screens/fishtank.js';
import { parseSprite, PALETTE_CHARS, spriteCache, blit } from '../public/pixel-sprite.js';
import { heatmapStocks, fishtankStocks, SP100, SECTORS } from '../data/sp100.js';
import { parseCommand, FKEYS } from '../public/app.js';
import { findCommand, byCategory } from '../public/registry.js';
import { WEIRD_SCREENS } from '../public/commands-weird.js';

test('fishtank: % change to depth, winners up top, losers at the floor', () => {
  assert.equal(pctToDepth(0, 3), 0.5, 'flat swims mid-tank');
  assert.equal(pctToDepth(3, 3), 0, 'the biggest move up reaches the surface');
  assert.equal(pctToDepth(-3, 3), 1, 'the biggest move down reaches the floor');
  assert.equal(pctToDepth(9, 3), 0, 'past the range: clamped');
  assert.equal(pctToDepth(-9, 3), 1);
  assert.ok(pctToDepth(1, 3) < pctToDepth(0.5, 3), 'a bigger gain swims higher');
  assert.ok(pctToDepth(-1, 3) > pctToDepth(-0.5, 3), 'a bigger loss swims lower');
  assert.ok(Math.abs(pctToDepth(0.75, 3) - (0.5 - 0.5 * Math.sqrt(0.25))) < 1e-12, 'square-root spread');
  assert.equal(pctToDepth(NaN, 3), 0.5);
  assert.equal(pctToDepth(1, 0), 0.5);
});

test('fishtank: depth range is the biggest move, never under 1%', () => {
  assert.equal(depthRange([{ changePct: 0.2 }, { changePct: -0.4 }]), 1);
  assert.equal(depthRange([{ changePct: 2.5 }, { changePct: -4.1 }, { changePct: NaN }]), 4.1);
  assert.equal(depthRange([]), 1);
});

test('fishtank: market cap to size, length grows with sqrt(cap)', () => {
  const lim = { max: 80, min: 10, fallback: 30 };
  assert.equal(capToSize(4e12, 4e12, lim), 80, 'the biggest company is the longest fish');
  assert.equal(capToSize(1e12, 4e12, lim), 40, 'a quarter of the cap: half the length');
  assert.equal(capToSize(4e10, 4e12, lim), 10, 'never shorter than min');
  assert.equal(capToSize(null, 4e12, lim), 30, 'no cap: the one fallback size');
  assert.equal(capToSize(0, 4e12, lim), 30);
  assert.equal(capToSize(1e12, 0, lim), 30, 'no caps at all: every fish the same');
  const a = capToSize(1e12, 4e12, lim); const b = capToSize(2e12, 4e12, lim);
  assert.ok(Math.abs((b / a) ** 2 - 2) < 1e-9, 'area follows cap');
});

test('fishtank: size limits scale with the tank and stay in bounds', () => {
  const big = sizeLimits(1400, 720);
  const phone = sizeLimits(372, 608);
  assert.ok(big.max > phone.max);
  for (const l of [big, phone, sizeLimits(10, 10), sizeLimits(5000, 3000), sizeLimits(1400, 240)]) {
    assert.ok(l.max >= 30 && l.max <= 88 * FISH_SCALE, `max ${l.max}`);
    assert.ok(l.min >= 9 && l.min < l.max);
    assert.ok(l.fallback > l.min && l.fallback < l.max);
  }
  // Every species about 1.4 times the old size, the biggest held to a share of the height.
  assert.ok(Math.abs(phone.max / (Math.sqrt(372 * 608) * 0.085) - FISH_SCALE) < 1e-9);
  assert.ok(sizeLimits(1500, 520).max <= 520 * MAX_OF_H + 1e-9, 'a short, wide tank caps the mega-caps');
  assert.ok(sizeLimits(1400, 720).max <= 720 * MAX_OF_H + 1e-9);
});

test('fishtank: colour scale, green up, red down, brighter with the move', () => {
  assert.equal(fishColor(1).h, 147);
  assert.equal(fishColor(-1).h, 0);
  assert.equal(fishColor(0).h, 208, 'flat is steel');
  assert.equal(fishColor(NaN).h, 208);
  assert.ok(fishColor(2).l > fishColor(0.5).l, 'bigger gain, brighter');
  assert.ok(fishColor(-2).l > fishColor(-0.5).l, 'bigger loss, brighter');
  assert.ok(fishColor(2).s > fishColor(0.5).s);
  assert.deepEqual(fishColor(3), fishColor(8), 'full strength at 3%');
  assert.deepEqual(fishColor(-3), fishColor(-8));
});

test('fishtank: biggest winner and loser, stable on ties', () => {
  const s = [
    { ticker: 'AAA', changePct: 1.2 }, { ticker: 'NVDA', changePct: 3.1 }, { ticker: 'AMD', changePct: 3.1 },
    { ticker: 'PFE', changePct: -2.4 }, { ticker: 'XOM', changePct: 0 }, { ticker: 'BAD', changePct: NaN },
  ];
  const { winner, loser } = pickExtremes(s);
  assert.equal(winner.ticker, 'AMD', 'a tie goes to the first ticker A-Z');
  assert.equal(loser.ticker, 'PFE');
  assert.deepEqual(pickExtremes([{ ticker: 'A', changePct: 1 }]), { winner: { ticker: 'A', changePct: 1 }, loser: null }, 'no loser on an all-up day');
  assert.deepEqual(pickExtremes([{ ticker: 'A', changePct: 0 }]), { winner: null, loser: null });
  assert.deepEqual(pickExtremes([]), { winner: null, loser: null });
});

test('fishtank: header line counts up and down', () => {
  const h = tankHeader([{ changePct: 1 }, { changePct: 2 }, { changePct: -1 }, { changePct: 0 }], '2026-09-25T18:32:00Z');
  assert.equal(h.up, 2);
  assert.equal(h.down, 1);
  assert.equal(h.text, 'S&P 100 · 2 up · 1 down · updated 14:32');
});

test('fishtank: seeded numbers are stable and in [0, 1)', () => {
  assert.equal(seeded('AAPL', 3), seeded('AAPL', 3));
  assert.notEqual(seeded('AAPL', 3), seeded('AAPL', 4));
  for (const t of ['A', 'MSFT', 'BRK.B', '']) for (let i = 0; i < 20; i += 1) {
    const v = seeded(t, i);
    assert.ok(v >= 0 && v < 1, `${t} ${i}: ${v}`);
  }
});

test('fishtank: routed, listed under Weird data, off the F-key bar', () => {
  assert.equal(parseCommand('FISHTANK').name, 'FISHTANK');
  assert.equal(WEIRD_SCREENS.FISHTANK?.js, 'screens/fishtank.js', 'has its own screen (loaded on first use)');
  const c = findCommand('FISHTANK');
  assert.equal(c.category, 'Weird data');
  assert.ok(byCategory('Weird data').includes(c));
  const words = c.summary.split(/\s+/).length;
  assert.ok(words >= 3 && words <= 5, c.summary);
  assert.equal(findCommand('FISH'), null, 'FISH is not a command');
  assert.ok(!FKEYS.some((k) => k.cmd === 'FISHTANK'));
});

test('fishtank: copy rules, no banned brand word, no em dashes, no amber', () => {
  for (const f of ['public/screens/fishtank.js', 'public/pixel-sprite.js']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /\u2014/, `${f}: em dash`);
    // Every fixed colour is a blue, a green, a red or steel: no amber or orange hues.
    for (const m of s.matchAll(/hsla?\((\d+),/g)) assert.ok(Number(m[1]) < 15 || Number(m[1]) > 70, `${f}: hue ${m[1]}`);
  }
});

test('fishtank data: every member stays, a missing cap is null; HEATMAP still drops it', () => {
  const rows = [
    { ticker: 'AAPL', name: 'Apple', sector: 'TECH', last: 200, changePct: 1.2, marketCap: 3e12, volume: 1 },
    { ticker: 'XYZ', name: 'No Cap', sector: 'FIN', last: 10, changePct: -0.5, marketCap: null, volume: 1 },
    { ticker: 'ZER', name: 'Zero Cap', sector: 'FIN', last: 10, changePct: 0, marketCap: 0, volume: 1 },
  ];
  assert.deepEqual(fishtankStocks(rows), [
    { ticker: 'AAPL', name: 'Apple', sector: 'TECH', changePct: 1.2, marketCap: 3e12 },
    { ticker: 'XYZ', name: 'No Cap', sector: 'FIN', changePct: -0.5, marketCap: null },
    { ticker: 'ZER', name: 'Zero Cap', sector: 'FIN', changePct: 0, marketCap: null },
  ]);
  assert.deepEqual(heatmapStocks(rows), [{ ticker: 'AAPL', name: 'Apple', sector: 'TECH', last: 200, changePct: 1.2, marketCap: 3e12 }]);
  const lim = { max: 80, min: 10, fallback: 30 };
  assert.equal(capToSize(fishtankStocks(rows)[1].marketCap, 3e12, lim), 30, 'the no-cap fish gets the plain size');
});

// A fake requestAnimationFrame: callbacks wait in a queue until flush(ts).
function fakeRaf() {
  const q = new Map();
  let n = 0;
  return {
    q,
    raf: (cb) => { n += 1; q.set(n, cb); return n; },
    caf: (id) => { q.delete(id); },
    flush(ts) { const cbs = [...q.values()]; q.clear(); for (const cb of cbs) cb(ts); },
  };
}

test('fishtank runner: holds stop the loop, releases restart it, at most about 60fps', () => {
  const r = fakeRaf();
  const drawn = [];
  const run = makeRunner((t) => drawn.push(t), { raf: r.raf, caf: r.caf, frameMs: 15 });
  run.hold('data');
  assert.equal(r.q.size, 0, 'held: nothing scheduled');
  run.hold('data', false);
  assert.equal(run.running, true);
  for (let i = 0; i <= 12; i += 1) r.flush(i * 8.33); // a 120 Hz display, 100 ms
  assert.ok(drawn.length >= 6 && drawn.length <= 7, `about 60fps: ${drawn.length} frames in 100 ms`);
  run.hold('offscreen');
  assert.equal(run.running, false);
  assert.equal(r.q.size, 0, 'the pending frame is cancelled');
  run.hold('hidden');
  run.hold('offscreen', false);
  assert.equal(r.q.size, 0, 'still hidden');
  run.hold('hidden', false);
  assert.equal(r.q.size, 1, 'running again');
  run.destroy();
  assert.equal(r.q.size, 0);
  run.hold('hidden', false);
  run.hold('offscreen', false);
  assert.equal(r.q.size, 0, 'after leaving, nothing restarts it');
});

test('fishtank: leaving the screen cancels the frame loop, observers and listeners', async () => {
  const saved = {};
  for (const k of ['window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'setTimeout', 'setInterval']) saved[k] = globalThis[k];
  const r = fakeRaf();
  const listeners = new Set(); // live listeners on document and media queries
  const on = () => ({ addEventListener: (t, f) => listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) });
  const g2d = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 20 }) : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const el = (extra = {}) => ({
    innerHTML: '', style: {}, hidden: false, clientWidth: 800, clientHeight: 500, offsetWidth: 90, offsetHeight: 20,
    setAttribute() {}, addEventListener() {}, removeEventListener() {}, getContext: () => g2d, querySelectorAll: () => [], ...extra,
  });
  const canvas = el(); const tip = el(); const sr = el();
  const host = el({ querySelector: (sel) => ({ canvas, '.ft-tip': tip, '.ft-sr': sr }[sel]) });
  const meta = el();
  const glyph = { width: 0, height: 0, style: {}, getContext: () => fakeCtx() };
  const btn = { dataset: { sector: 'TECH' }, setAttribute() {}, querySelector: () => glyph };
  const leg = el({ querySelectorAll: (sel) => (sel === '.ft-leg-btn' ? [btn] : []) });
  const root = el({ querySelector: (sel) => ({ '#ft-host': host, '#ft-meta': meta, '#ft-leg': leg }[sel]) });
  const observers = [];
  class Obs { constructor(cb) { this.cb = cb; this.on = false; observers.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } }
  let timers = 0;
  globalThis.setTimeout = (...a) => { timers += 1; return saved.setTimeout(...a); };
  globalThis.setInterval = (...a) => { timers += 1; return saved.setInterval(...a); };
  globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false, ...on() }) };
  globalThis.document = { hidden: false, createElement: () => el(), ...on() };
  globalThis.getComputedStyle = () => ({ fontFamily: 'monospace' });
  globalThis.requestAnimationFrame = r.raf;
  globalThis.cancelAnimationFrame = r.caf;
  globalThis.ResizeObserver = Obs;
  globalThis.IntersectionObserver = Obs;
  try {
    const cleanups = [];
    const live = [];
    const data = { stocks: [{ ticker: 'AAPL', name: 'Apple', sector: 'TECH', changePct: 1, marketCap: 3e12 }, { ticker: 'PFE', name: 'Pfizer', sector: 'HEALTH', changePct: -1, marketCap: null }, { ticker: 'AMT', name: 'American Tower', sector: 'RE', changePct: 0.4, marketCap: 9e10 }, { ticker: 'NEW', name: 'No Sector', sector: null, changePct: 0, marketCap: 1e11 }], sectors: SECTORS, updated: '2026-09-25T18:32:00Z', stale: false };
    const ctx = {
      fetchJSON: async () => data, signal: null, run() {}, updated() {}, status() {},
      onCleanup: (f) => cleanups.push(f), live: (f, ms) => live.push([f, ms]),
    };
    render(root, { name: 'FISHTANK' }, ctx);
    await new Promise((res) => { setImmediate(res); });
    assert.deepEqual(live.map(([, ms]) => ms), [60_000], 'the refresh goes through ctx.live (the app stops it on leave)');
    assert.equal(timers, 0, 'no timers of its own');
    assert.equal(r.q.size, 0, 'off screen until the observer says otherwise');
    const io = observers[1]; // [0] is the ResizeObserver, [1] the IntersectionObserver
    io.cb([{ isIntersecting: true }]);
    assert.equal(r.q.size, 1, 'on screen: the loop runs');
    r.flush(1000); r.flush(1017);
    assert.equal(r.q.size, 1);
    assert.equal(g2d.imageSmoothingEnabled, false, 'the tank draws with smoothing off');
    io.cb([{ isIntersecting: false }]);
    assert.equal(r.q.size, 0, 'scrolled away: no frames');
    io.cb([{ isIntersecting: true }]);
    assert.equal(r.q.size, 1);
    assert.equal(leg.hidden, false, 'the legend shows once there is data');
    assert.match(leg.innerHTML, /data-sector="TECH"/);
    assert.ok(listeners.size >= 4, 'listening while on screen: visibility, Esc, motion, pixel ratio');
    assert.deepEqual([glyph.width, glyph.height], [22, 9], 'the TECH glyph: the swordfish at 1x');
    globalThis.window.devicePixelRatio = 2; // a zoom or another monitor
    for (const f of [...listeners]) f({});
    assert.deepEqual([glyph.width, glyph.height, glyph.style.width], [44, 18, '22px'], 'a new pixel ratio redraws the legend glyphs crisp');
    for (const f of cleanups) f();
    assert.equal(r.q.size, 0, 'the pending frame is cancelled');
    assert.ok(observers.every((o) => !o.on), 'observers disconnected');
    assert.equal(listeners.size, 0, 'document and media listeners removed');
    io.cb([{ isIntersecting: true }]);
    await live[0][0]();
    assert.equal(r.q.size, 0, 'a late callback or refresh never restarts it');
    assert.equal(timers, 0);
  } finally {
    for (const [k, v] of Object.entries(saved)) globalThis[k] = v;
  }
});

test('fishtank species: every S&P 100 member gets its sector species, the rest a plain fish', () => {
  for (const k of Object.keys(SECTORS)) assert.ok(SPECIES[k], `${k} has a species`);
  const kinds = Object.values(SPECIES).map((v) => v.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'one species per sector');
  for (const m of SP100) {
    const kind = speciesOf(m.sector);
    assert.notEqual(kind, 'fish', `${m.ticker} (${m.sector})`);
    assert.ok(SPECIES_NAME[kind], kind);
  }
  assert.equal(speciesOf('TECH'), 'swordfish');
  assert.equal(speciesOf('FIN'), 'shark');
  assert.equal(speciesOf('RE'), 'crab');
  assert.equal(speciesOf(null), 'fish', 'no sector: the plain fish');
  assert.equal(speciesOf('SPACE'), 'fish', 'unknown sector: the plain fish');
  assert.equal(speciesOf(undefined), 'fish');
  assert.deepEqual(Object.values(SPECIES).map((v) => v.short),
    ['TECH', 'FIN', 'UTIL', 'ENERGY', 'COMM', 'HEALTH', 'DISC', 'STAPLES', 'INDUS', 'RE', 'MAT']);
});

test('fishtank legend: sectors present, in order, with counts; unknown sectors left out', () => {
  const items = legendItems([
    { sector: 'RE' }, { sector: 'TECH' }, { sector: 'TECH' }, { sector: null }, { sector: 'NOPE' }, { sector: 'FIN' },
  ]);
  assert.deepEqual(items.map((i) => [i.key, i.count, i.kind]), [['TECH', 2, 'swordfish'], ['FIN', 1, 'shark'], ['RE', 1, 'crab']]);
  assert.deepEqual(legendItems([]), []);
});

test('fishtank legend: pressing a sector lights it, pressing it again clears it', () => {
  let active = null;
  active = toggleSector(active, 'TECH');
  assert.equal(active, 'TECH');
  assert.equal(sectorAlpha('TECH', active), 1, 'the lit sector at full');
  assert.equal(sectorAlpha('FIN', active), DIM, 'the rest dimmed');
  assert.equal(sectorAlpha(null, active), DIM, 'a plain fish dims too');
  assert.equal(DIM, 0.25);
  active = toggleSector(active, 'FIN');
  assert.equal(active, 'FIN', 'another sector switches straight to it');
  active = toggleSector(active, 'FIN');
  assert.equal(active, null, 'the same button again clears it');
  assert.equal(sectorAlpha('FIN', null), 1, 'nothing lit: everything at full');
  const html = legendHtml(legendItems([{ sector: 'TECH' }, { sector: 'FIN' }, { sector: 'FIN' }]), 'FIN', { FIN: 'Financials' });
  const buttons = html.match(/<button[^>]*>/g);
  assert.equal(buttons.length, 2, 'a focusable button per sector');
  assert.ok(buttons.every((b) => /type="button"/.test(b)));
  assert.match(buttons[0], /data-sector="TECH" aria-pressed="false"/);
  assert.match(buttons[1], /data-sector="FIN" aria-pressed="true"/);
  assert.match(buttons[1], /aria-label="FIN, Financials: shark, 2 stocks"/, 'the name starts with the words on the button');
  assert.match(buttons[0], /aria-label="TECH: /, 'no name of its own: the short name once');
  assert.match(html, /<span>TECH<\/span>/);
});

test('fishtank tags: a lit sector tags its own fish first and skips the dimmed ones', () => {
  const fish = [
    { sector: 'TECH', kind: 'crab', s: { ticker: 'A' } },
    { sector: 'FIN', kind: 'crab', s: { ticker: 'B' } },
    { sector: 'TECH', kind: 'fish', s: { ticker: 'C' } },
    { sector: 'FIN', kind: 'shark', s: { ticker: 'D' } },
    { sector: 'FIN', kind: 'shark', s: { ticker: 'E' } },
  ];
  const ids = (plan) => plan.map((p) => `${p.f.s.ticker}:${p.tag}`);
  assert.deepEqual(ids(tagPlan(fish, { winner: fish[2], loser: fish[3] })), ['A:crab', 'B:crab', 'C:winner', 'D:loser']);
  assert.deepEqual(ids(tagPlan(fish, { winner: fish[2], loser: fish[3], active: 'FIN' })), ['B:crab', 'D:loser', 'E:sector']);
  assert.deepEqual(ids(tagPlan(fish, { active: 'TECH' })), ['A:crab', 'C:sector']);
});

test('fishtank schools: the biggest fish at one depth keep clear of each other', () => {
  const W = 1400; const L = sizeLimits(1400, 700).max;
  const fish = Array.from({ length: 4 }, (_, i) => ({ sector: 'TECH', x: 700 + i * 4, vx: 10, speed: 15, face: 1, len: L, y: 300, depth: 0.5 }));
  for (let i = 0; i < 60 * 20; i += 1) schoolStep(fish, 1 / 60, W, { centre: () => 700 });
  const xs = fish.map((f) => f.x).sort((a, b) => a - b);
  const gap = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
  assert.ok(gap >= L * 0.9, `gap ${gap.toFixed(0)} for fish ${L.toFixed(0)} long`);
});

test('fishtank schools: fish stay in the tank, depth never moves, schools gather', () => {
  const W = 1200;
  const sectors = ['TECH', 'FIN', 'HEALTH', 'RE', null];
  const fish = [];
  for (let i = 0; i < 60; i += 1) {
    const sector = sectors[i % sectors.length];
    fish.push({
      sector, x: seeded(`x${i}`) * W, vx: (seeded(`v${i}`) - 0.5) * 30, speed: 8 + seeded(`s${i}`) * 20, face: 1,
      len: 10 + seeded(`l${i}`) * 50, y: 40 + seeded(`y${i}`) * 400, depth: seeded(`d${i}`),
    });
  }
  const ys = fish.map((f) => [f.y, f.depth]);
  const centre = (k) => sectorCentre(k, 0, W);
  const spreadOf = (k) => {
    const xs = fish.filter((f) => f.sector === k).map((f) => Math.abs(f.x - centre(k)));
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const before = spreadOf('TECH') + spreadOf('FIN') + spreadOf('HEALTH');
  for (let i = 0; i < 3600; i += 1) {
    schoolStep(fish, 1 / 60, W, { centre });
    for (const f of fish) assert.ok(f.x >= 0 && f.x <= W && Number.isFinite(f.x), `x ${f.x}`);
  }
  assert.deepEqual(fish.map((f) => [f.y, f.depth]), ys, 'schooling never changes depth');
  const after = spreadOf('TECH') + spreadOf('FIN') + spreadOf('HEALTH');
  assert.ok(after < before * 0.8, `schools gather: ${before.toFixed(0)} -> ${after.toFixed(0)}`);
  for (const k of ['TECH', 'FIN', 'HEALTH', 'RE']) assert.ok(spreadOf(k) < W * 0.2, `${k} stays near its centre`);
  // A hovered fish holds still; nothing moves with no time step or no tank.
  const f = fish[0]; const x = f.x;
  for (let i = 0; i < 120; i += 1) schoolStep(fish, 1 / 60, W, { centre, hold: f });
  assert.ok(Math.abs(f.x - x) < 30, 'the held fish slows to a stop');
  const snap = fish.map((g) => g.x);
  schoolStep(fish, 0, W, { centre });
  schoolStep(fish, 1 / 60, 0, { centre });
  assert.deepEqual(fish.map((g) => g.x), snap);
});

test('fishtank schools: sector centres drift slowly inside the tank', () => {
  for (const k of Object.keys(SPECIES)) {
    for (let t = 0; t < 600; t += 7) {
      const c = sectorCentre(k, t, 1000);
      assert.ok(c >= 70 && c <= 930, `${k} at ${t}s: ${c}`);
    }
    assert.ok(Math.abs(sectorCentre(k, 1, 1000) - sectorCentre(k, 0, 1000)) < 5, 'slow');
  }
  assert.equal(sectorCentre(null, 0, 1000), null);
  assert.equal(sectorCentre('TECH', 0, 0), null);
});

// ---- The pixel sprites ------------------------------------------------------------------

test('fishtank sprites: every sector and the plain fish have one, two frames the same size', () => {
  const kinds = [...Object.values(SPECIES).map((v) => v.kind), 'fish'];
  assert.deepEqual(Object.keys(FISH_SPRITES).sort(), [...kinds].sort(), 'one sprite per species, no spares');
  for (const k of kinds) {
    const frames = FISH_SPRITES[k];
    assert.equal(frames.length, 2, `${k}: two frames`);
    const [a, b] = frames;
    assert.equal(a.length, b.length, `${k}: both frames the same height`);
    assert.equal(a[0].length, b[0].length, `${k}: both frames the same width`);
    for (const [i, rows] of frames.entries()) {
      for (const row of rows) assert.equal(row.length, rows[0].length, `${k} frame ${i}: every row the same width`);
      assert.ok(rows[0].length >= 10 && rows[0].length <= 24 && rows.length <= 16, `${k}: ${rows[0].length} x ${rows.length}`);
    }
    assert.notDeepEqual(a, b, `${k}: the two frames differ`);
    assert.equal(spriteOf(k, 1).w, spriteOf(k, 0).w);
  }
  assert.equal(spriteOf('nope'), spriteOf('fish'), 'an unknown kind draws as the plain fish');
});

test('fishtank sprites: only known palette characters, at most body, shade and eye', () => {
  assert.equal(PALETTE_CHARS, '.#+o');
  for (const [k, frames] of Object.entries(FISH_SPRITES)) {
    for (const rows of frames) {
      for (const row of rows) assert.match(row, /^[.#+o]+$/, `${k}: ${row}`);
      const used = new Set(rows.join('').replace(/\./g, ''));
      assert.ok(used.has('#'), `${k}: has a body`);
      assert.ok([...used].every((c) => '#+o'.includes(c)) && used.size <= 3, `${k}: two colours and an eye`);
    }
  }
});

test('pixel sprites: parsed into runs; an uneven row or an unknown character throws', () => {
  const sp = parseSprite(['.##+', 'o..#']);
  assert.equal(sp.w, 4); assert.equal(sp.h, 2);
  assert.deepEqual(sp.runs, [[1, 0, 2, '#'], [3, 0, 1, '+'], [0, 1, 1, 'o'], [3, 1, 1, '#']]);
  assert.throws(() => parseSprite(['###', '##']), /row 1 is 2 wide/);
  assert.throws(() => parseSprite(['#x#']), /unknown pixel 'x'/);
  assert.throws(() => parseSprite([]), /no rows/);
});

// A fake 2D context that records what is drawn.
function fakeCtx() {
  const calls = [];
  const ctx = {
    calls, imageSmoothingEnabled: true, fillStyle: '',
    fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]),
    drawImage: (...a) => calls.push(['drawImage', ctx.imageSmoothingEnabled, ...a.slice(1)]),
    clearRect: () => {},
  };
  return ctx;
}

test('pixel sprites: drawn scaled by whole numbers with smoothing off, mirrored for the other way', () => {
  const made = [];
  const cache = spriteCache((w, h) => { const c = { width: w, height: h, ctx: fakeCtx() }; c.getContext = () => c.ctx; made.push(c); return c; });
  const sp = parseSprite(['##+', '#o.']);
  const colors = { body: 'B', shade: 'S', eye: 'E' };
  const right = cache.get(sp, 'k', colors);
  assert.equal(cache.get(sp, 'k', colors), right, 'made once, then cached');
  assert.deepEqual([right.width, right.height], [3, 2], 'one canvas pixel a sprite pixel');
  assert.deepEqual(right.ctx.calls, [['fillRect', 'B', 0, 0, 2, 1], ['fillRect', 'S', 2, 0, 1, 1], ['fillRect', 'B', 0, 1, 1, 1], ['fillRect', 'E', 1, 1, 1, 1]]);
  const left = cache.get(sp, 'k', colors, true);
  assert.notEqual(left, right);
  assert.deepEqual(left.ctx.calls, [['fillRect', 'B', 1, 0, 2, 1], ['fillRect', 'S', 0, 0, 1, 1], ['fillRect', 'B', 2, 1, 1, 1], ['fillRect', 'E', 1, 1, 1, 1]], 'mirrored');
  const lit = cache.get(sp, 'k', colors, false, 'L');
  assert.deepEqual([lit.width, lit.height], [5, 4], 'the outline adds a pixel all round');
  assert.equal(cache.size, 3);
  const g = fakeCtx();
  blit(g, right, 10.4, 20.6, 4.2);
  assert.deepEqual(g.calls, [['drawImage', false, 10, 21, 12, 8]], 'smoothing off, whole pixels, a whole scale');
});

test('fishtank sprites: a whole-number scale, about as long as the fish, never under 1', () => {
  for (const len of [9, 12.6, 18, 40, 80, 116]) {
    for (const dpr of [1, 1.5, 2]) {
      const p = spriteScale(len, 22, dpr);
      assert.ok(Number.isInteger(p) && p >= 1, `${len} @${dpr}: ${p}`);
      if (len * dpr >= 22) assert.ok(Math.abs((22 * p) / dpr - len) <= 11 / dpr + 1e-9, `${len} @${dpr}: drawn ${(22 * p) / dpr}`);
    }
  }
  assert.ok(spriteScale(116, 22) > spriteScale(40, 22), 'a bigger company, bigger pixels');
  assert.equal(spriteScale(NaN, 22), 1);
  assert.equal(spriteScale(40, 0), 1);
});

test('fishtank sprites: reduced motion shows one frame; otherwise the two take turns', () => {
  const seen = new Set();
  for (let t = 0; t < 5; t += 0.05) {
    assert.equal(animFrame(t, 1.3, 3, true), 0, 'reduced motion: always the first frame');
    seen.add(animFrame(t, 1.3, 3, false));
  }
  assert.deepEqual([...seen].sort(), [0, 1], 'moving: both frames');
  assert.equal(animFrame(0, 2, 3), 0, 'no clock yet: the first frame');
  assert.equal(animFrame(1, 0, 0), 0, 'no rate: the first frame');
});

test('fishtank sprites: colours in buckets, green up, red down, steel flat, full at 3%', () => {
  assert.equal(colorLevel(0), 0);
  assert.equal(colorLevel(NaN), 0);
  assert.equal(colorLevel(0.01), 1, 'any move is at least one step');
  assert.equal(colorLevel(3), LEVELS);
  assert.equal(colorLevel(9), LEVELS);
  assert.equal(colorLevel(-9), -LEVELS);
  assert.ok(colorLevel(2) > colorLevel(0.5));
  const keys = new Set();
  for (let p = -6; p <= 6; p += 0.01) keys.add(spriteColors(p).key);
  assert.equal(keys.size, 2 * LEVELS + 1, 'a few buckets, not one per fish');
  const hue = (c) => Number(c.match(/hsl\((\d+)/)[1]);
  assert.equal(hue(spriteColors(1).body), 147);
  assert.equal(hue(spriteColors(-1).body), 0);
  assert.equal(hue(spriteColors(0).body), 208);
  const f = fishColor(3);
  assert.equal(spriteColors(5).body, `hsl(${f.h}, ${f.s}%, ${f.l}%)`, 'the top bucket is the old full strength');
  const light = (c) => Number(c.match(/(\d+)%\)$/)[1]);
  for (const p of [-3, -0.2, 0, 0.2, 3]) assert.ok(light(spriteColors(p).shade) < light(spriteColors(p).body), 'the shade is darker');
});

test('fishtank legend: glyphs are the sprites, a whole multiple of the sprite at the pixel ratio', () => {
  for (const [kind, dpr] of [['eel', 2], ['jelly', 1], ['puffer', 1.25], ['swordfish', 1.5], ['crab', 3], ['fish', 2.625]]) {
    const ctx = fakeCtx();
    const canvas = { width: 52, height: 32, style: {}, getContext: () => ctx };
    drawGlyph(canvas, kind, dpr);
    const sp = spriteOf(kind);
    const p = canvas.width / sp.w;
    assert.ok(Number.isInteger(p) && p >= 1, `${kind} @${dpr}: scale ${p}`);
    assert.equal(canvas.height, sp.h * p, `${kind}: the box is the sprite times ${p}`);
    assert.equal(canvas.style.width, `${canvas.width / Math.min(3, dpr)}px`, 'shown at one canvas pixel a device pixel');
    assert.ok(canvas.width / Math.min(3, dpr) <= 26 && canvas.height / Math.min(3, dpr) <= 16, `${kind} @${dpr}: fits the chip`);
    assert.equal(ctx.imageSmoothingEnabled, false);
    const rects = ctx.calls.filter((c) => c[0] === 'fillRect');
    assert.ok(rects.length > 3);
    assert.ok(rects.every(([, , x, y, w, h]) => [x, y, w, h].every(Number.isInteger) && h === p && x % p === 0 && y % p === 0), `${kind}: even whole pixels`);
  }
  drawGlyph({}, 'fish'); // no context: nothing to do
});

test('fishtank sprites: the jellyfish never flips; the rest face the way they swim', () => {
  assert.equal(mirrored('jelly', -1), false);
  assert.equal(mirrored('jelly', 1), false);
  for (const k of ['swordfish', 'crab', 'fish']) {
    assert.equal(mirrored(k, -0.3), true, k);
    assert.equal(mirrored(k, 0.3), false, k);
  }
});

test('pixel sprites: the cache stays bounded across every colour, direction and outline', () => {
  const make = (w, h) => ({ width: w, height: h, getContext: () => fakeCtx() });
  const all = spriteCache(make);
  const kinds = Object.keys(FISH_SPRITES);
  for (let round = 0; round < 3; round += 1) {
    for (const k of kinds) for (const fr of [0, 1]) for (let p = -6; p <= 6; p += 0.25) for (const flip of [false, true]) for (const out of [null, 'L']) {
      const c = spriteColors(p);
      all.get(spriteOf(k, fr), c.key, c, flip, out);
    }
  }
  assert.equal(all.size, kinds.length * 2 * (2 * LEVELS + 1) * 2 * 2, 'every combination once, however often asked');
  assert.ok(all.size <= 1500);
  const small = spriteCache(make, 10);
  let most = 0;
  for (let i = 0; i < 200; i += 1) {
    small.get(spriteOf(kinds[i % kinds.length]), `c${i % 37}`, { body: 'B' }, i % 2 === 0);
    most = Math.max(most, small.size);
  }
  assert.ok(most <= 10, `a small cap holds: ${most}`);
  small.clear();
  assert.equal(small.size, 0);
});

test('fishtank schools: the drawn sprite size, not the length, keeps fish apart and off the walls', () => {
  // Short lengths but wide sprites (a big scale): the sprites decide.
  const W = 1000;
  const fish = Array.from({ length: 3 }, (_, i) => ({ sector: 'TECH', x: 500 + i * 3, vx: 10, speed: 15, face: 1, len: 20, dw: 120, dh: 40, y: 300, depth: 0.5 }));
  for (let i = 0; i < 60 * 20; i += 1) schoolStep(fish, 1 / 60, W, { centre: () => 500 });
  const xs = fish.map((f) => f.x).sort((a, b) => a - b);
  const gap = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
  assert.ok(gap >= 120 * 0.9, `gap ${gap.toFixed(0)} for sprites 120 wide`);
  // Tall sprites at different depths still count as sharing one.
  const tall = [{ sector: 'HEALTH', x: 500, vx: 5, speed: 5, face: 1, len: 10, dw: 40, dh: 60, y: 300 }, { sector: 'HEALTH', x: 501, vx: 5, speed: 5, face: 1, len: 10, dw: 40, dh: 60, y: 340 }];
  for (let i = 0; i < 60 * 20; i += 1) schoolStep(tall, 1 / 60, W, { centre: () => 500 });
  assert.ok(Math.abs(tall[0].x - tall[1].x) >= 40 * 0.9, `tall sprites overlap: ${Math.abs(tall[0].x - tall[1].x).toFixed(0)}`);
  // The walls: a wide sprite never pokes out.
  const edge = [{ sector: null, x: 5, vx: -30, speed: 30, face: -1, len: 10, dw: 100, dh: 30, y: 200 }, { sector: null, x: 995, vx: 30, speed: 30, face: 1, len: 10, dw: 100, dh: 30, y: 400 }];
  for (let i = 0; i < 600; i += 1) {
    schoolStep(edge, 1 / 60, W);
    for (const f of edge) assert.ok(f.x - f.dw / 2 >= -1e-9 && f.x + f.dw / 2 <= W + 1e-9, `x ${f.x.toFixed(1)}`);
  }
});
