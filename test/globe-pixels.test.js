// The globe's pixel figures and zoom (public/globe.js, public/globe-sprites.js): a figure
// per visitor, made up from a seed, the same format as the ME avatars; where they go;
// the 240 cap and +N; zoom (wheel, pinch, double tap, buttons, keys) toward the pointer;
// the land's detail levels; and letting go of everything on stop().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encode, decode, draw, spriteHex, PALETTE, colorFor, dayKey, spotsFor, hash,
} from '../public/globe-sprites.js';
import {
  mountGlobe, clampZoom, zoomAt, unortho, ortho, wheelFactor, overGlobe, levelFor,
  pickSprite, lodLand, lodReady, inLens, LOD_WAIT_MS, WORLD_RETRY_MS, landOf, worldDots, wrapLon, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, TILT, IDLE_MS,
} from '../public/globe.js';
import { groupOf, CRITTER_CAP } from '../public/globe-cluster.js';

const WORLD = JSON.parse(readFileSync('public/geo/world-110m.json', 'utf8'));
const GEO = JSON.parse(readFileSync('public/geo/globe-dots.json', 'utf8'));
const bitsOf = (hex) => decode(hex);

// ---- the figures ------------------------------------------------------------------------

test('figures: the same seed, the same figure; the same left and right; eyes; a new one each day', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const seed = `city:US:New York:${i}:2026-09-29`;
    const hex = spriteHex(seed);
    assert.match(hex, /^[0-9a-f]{16}$/);
    assert.equal(spriteHex(seed), hex, 'deterministic');
    const b = bitsOf(hex);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) assert.equal(b[r * 8 + c], b[r * 8 + 7 - c], `mirrored: ${hex} row ${r}`);
    const lit = b.filter(Boolean).length;
    assert.ok(lit >= 16 && lit <= 56, `a figure, not a dot or a block: ${lit}`);
    // Two eyes: a dark pixel with lit pixels left, right, above and below it, in row 2 or 3.
    const eye = [2, 3].some((r) => [1, 2].some((c) => !b[r * 8 + c] && b[(r - 1) * 8 + c] && b[(r + 1) * 8 + c] && b[r * 8 + c + 1] && (c === 0 || b[r * 8 + c - 1])));
    assert.ok(eye, `eyes: ${hex}`);
    seen.add(hex);
  }
  assert.ok(seen.size > 200, `varied: ${seen.size} of 300`);
  assert.notEqual(spriteHex('city:JP:Tokyo:0:2026-09-29'), spriteHex('city:JP:Tokyo:0:2026-09-30'), 'a new day, new figures');
  assert.equal(dayKey(new Date('2026-09-29T23:59:00Z')), '2026-09-29');
});

test('figures: the colours are ice blue tints, never amber, never the up green or down red', () => {
  const style = readFileSync('public/style.css', 'utf8');
  const up = /--up: hsl\((\d+)/.exec(style);
  assert.ok(up, 'style.css --up');
  const hsl = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((h * 60) + 360) % 360, d, (max + min) / 2];
  };
  assert.ok(PALETTE.length >= 4 && PALETTE.length <= 8);
  for (const c of PALETTE) {
    assert.match(c, /^#[0-9A-F]{6}$/i);
    const [h, chroma, l] = hsl(c);
    assert.ok(chroma < 0.1 || (h >= 185 && h <= 235), `${c}: an ice blue (hue ${Math.round(h)})`);
    assert.ok(!(h >= 20 && h <= 70 && chroma > 0.1), `${c}: not amber`);
    assert.ok(l > 0.6, `${c}: light on black`);
    assert.ok(!['#3DDC84', '#FF5C5C'].includes(c.toUpperCase()), `${c}: not --up or --down`);
  }
  for (let i = 0; i < 50; i++) assert.ok(PALETTE.includes(colorFor(`s${i}`)));
  assert.equal(colorFor('x'), colorFor('x'));
  assert.doesNotMatch(readFileSync('public/globe-sprites.js', 'utf8'), /amber|orange|#f5a|#ffa|#ff9|—/i);
});

test('the hex format: one byte a row, top row first, bit 63 the top left pixel (the ME avatars)', () => {
  const one = decode('8000000000000000');
  assert.equal(one[0], true, 'bit 63: top left');
  assert.equal(one.filter(Boolean).length, 1);
  assert.equal(decode('0000000000000001')[63], true, 'bit 0: bottom right');
  assert.equal(decode('0100000000000000')[7], true, 'the top row, right end');
  assert.equal(decode('0080000000000000')[8], true, 'the second row, left end');
  assert.equal(decode('FFFFFFFFFFFFFFFF').every(Boolean), true, 'upper case reads too');
  for (const bad of ['', 'xyz', '123', '0123456789abcdef0', null, undefined]) assert.equal(decode(bad), null, String(bad));
  for (let i = 0; i < 100; i++) {
    const hex = spriteHex(`round:${i}`);
    assert.equal(encode(decode(hex)), hex, 'round trip');
    const bits = Array.from({ length: 64 }, (_, k) => (hash(`${i}:${k}`) & 1) === 1);
    assert.deepEqual(decode(encode(bits)), bits);
  }
});

test('draw(): whole pixels, one rectangle per run of lit pixels, at the given size', () => {
  const rects = [];
  const ctx = { fillStyle: '', fillRect: (x, y, w, h) => rects.push([x, y, w, h]) };
  const hex = spriteHex('draw');
  draw(ctx, hex, 10.4, 20.6, 3, '#CFEAFF');
  assert.equal(ctx.fillStyle, '#CFEAFF');
  let area = 0;
  for (const [x, y, w, h] of rects) {
    assert.ok([x, y, w, h].every(Number.isInteger), 'crisp: whole pixels');
    assert.equal(h, 3);
    assert.equal((x - 10) % 3, 0);
    area += w * h;
  }
  assert.equal(area, decode(hex).filter(Boolean).length * 9, 'every lit pixel, once');
  assert.ok(rects.length <= decode(hex).filter(Boolean).length, 'runs, not pixel by pixel');
});

// ---- where they go ------------------------------------------------------------------------

test('a small place\'s group: grid spots nearest first, never two critters on one another', () => {
  for (let n = 1; n <= 20; n++) {
    const s = spotsFor(n);
    assert.equal(s.length, n);
    assert.equal(new Set(s.map((p) => p.join(','))).size, n, `n=${n}: all different`);
    assert.ok(s.every((p) => p.every(Number.isInteger)), 'whole grid steps');
    assert.deepEqual(s[0], [0, 0], 'the first on the place itself');
    for (let i = 1; i < n; i++) assert.ok(Math.hypot(...s[i]) >= Math.hypot(...s[i - 1]) - 1e-9, 'nearest first');
    const g = groupOf(n, true);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const [a, b] = [g.spots[i], g.spots[j]];
        assert.ok(Math.abs(a[0] - b[0]) >= g.size || Math.abs(a[1] - b[1]) >= g.size, `n=${n}: ${i} and ${j} overlap`);
      }
    }
    for (const [x, y] of g.spots) assert.ok(Math.abs(x) + g.size / 2 <= g.w / 2 + 1e-9 && Math.abs(y) + g.size / 2 <= g.h / 2 + 1e-9, 'inside its box, centred on the place');
  }
});

test('hover and tap: the critter or its count under the pointer, else the nearest cluster', () => {
  const placed = [
    { item: { n: 12, k: 0 }, x: 100, y: 100, r: 20, size: 24, sprites: [[80, 88]], label: [106, 93, 18, 14] },
    { item: { n: 3, k: 1 }, x: 160, y: 100, r: 20, size: 16, sprites: [[140, 92]], label: [158, 93, 11, 14] },
  ];
  assert.equal(pickSprite(placed, 90, 95).item.k, 0, 'the critter');
  assert.equal(pickSprite(placed, 120, 100).item.k, 0, 'its count');
  assert.equal(pickSprite(placed, 160, 100).item.k, 1);
  assert.equal(pickSprite(placed, 400, 400), null);
});

// ---- zoom -----------------------------------------------------------------------------------

test('zoom: 1x to 6x; toward the pointer, the place under it stays under it', () => {
  assert.equal(ZOOM_MIN, 1);
  assert.equal(ZOOM_MAX, 6);
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(9), 6);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom(2.5), 2.5);
  // unortho undoes ortho.
  for (const [lon, lat] of [[10, 50], [-99, 39], [140, 36], [-40, -20]]) {
    const [x, y, z] = ortho(lon, lat, -30, TILT);
    if (z <= 0) continue;
    const [l2, p2] = unortho(x, y, -30, TILT);
    assert.ok(Math.abs(wrapLon(l2 - lon)) < 1e-9 && Math.abs(p2 - lat) < 1e-9, `${lon},${lat}`);
  }
  assert.equal(unortho(0.9, 0.9, 0), null, 'off the globe');
  const R = 150;
  const cases = [[{ lon0: -99, tilt: 18, zoom: 1 }, 3, 40, -30], [{ lon0: 6, tilt: 42, zoom: 2 }, 4, -60, 20], [{ lon0: 120, tilt: 10, zoom: 4 }, 2, 30, 30]];
  for (const [view, next, dx, dy] of cases) {
    const before = unortho(dx / (R * view.zoom), dy / (R * view.zoom), view.lon0, view.tilt);
    const v = zoomAt(view, next, dx, dy, R);
    assert.equal(v.zoom, next);
    const [x, y] = ortho(before[0], before[1], v.lon0, v.tilt);
    assert.ok(Math.hypot(x * R * v.zoom - dx, y * R * v.zoom - dy) < 0.5, `still under the pointer: ${JSON.stringify(v)}`);
  }
  const mid = zoomAt({ lon0: 10, tilt: 20, zoom: 1 }, 99, 0, 0, R);
  assert.deepEqual(mid, { lon0: 10, tilt: 20, zoom: 6 }, 'on the middle: no turn, clamped');
  // The wheel: up zooms in, down out, a notch about 1.2x; a pinch (ctrl) quicker per pixel.
  assert.ok(wheelFactor({ deltaY: -100 }) > 1.15 && wheelFactor({ deltaY: -100 }) < 1.3);
  assert.ok(wheelFactor({ deltaY: 100 }) < 1);
  assert.ok(wheelFactor({ deltaY: -3, deltaMode: 1 }) > 1, 'lines');
  assert.ok(wheelFactor({ deltaY: -10, ctrlKey: true }) > wheelFactor({ deltaY: -10 }));
  assert.ok(overGlobe(100, 100, { c: 100, R: 94 }) && !overGlobe(2, 2, { c: 100, R: 94 }), 'the corners are not the globe');
});

test('land detail: denser when zoomed in, made once per level, from the map outlines', () => {
  assert.deepEqual([1, 1.4, 1.5, 2.9, 3, 4.4, 4.5, 6].map(levelFor), [1, 1, 2, 2, 3, 3, 4, 4]);
  const l2 = lodLand(WORLD, 2);
  assert.equal(lodLand(WORLD, 2), l2, 'cached');
  const l3 = lodLand(WORLD, 3);
  const l4 = lodLand(WORLD, 4);
  const l1 = landOf(GEO);
  assert.equal(landOf(GEO), l1, 'cached');
  assert.ok(l1.n < l2.n && l2.n < l3.n && l3.n < l4.n, `${l1.n} ${l2.n} ${l3.n} ${l4.n}`);
  assert.ok(l4.n < 150_000, `cheap enough: ${l4.n}`);
  // Land where land is: London, Paris, Tokyo; not the middle of the Atlantic.
  const near = (dots, lon, lat, d) => dots.some(([a, b]) => Math.abs(a - lon) < d && Math.abs(b - lat) < d);
  const dots = worldDots(WORLD, 0.5);
  assert.ok(near(dots, -0.1, 51.5, 0.5) && near(dots, 2.35, 48.85, 0.5) && near(dots, 139.7, 35.7, 0.6));
  assert.ok(!near(dots, -35, 40, 3), 'the open sea stays empty');
  assert.ok(near(dots, -6, 53.3, 0.6), 'Ireland shows at the fine level');
});

// ---- a fake page ------------------------------------------------------------------------------
function el(tag) {
  const listeners = {};
  const attrs = {};
  const kids = [];
  return {
    tag, hidden: false, style: {}, textContent: '', offsetWidth: 80, dataset: {}, kids, listeners, removed: false,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => attrs[k] ?? null,
    appendChild(c) { kids.push(c); }, remove() { this.removed = true; },
    addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; },
    click() { listeners.click?.({}); },
  };
}
function page({ reduceMotion = false, world = WORLD } = {}) {
  let t = 0;
  let frames = [];
  let timers = [];
  let timerId = 0;
  const winListeners = {};
  const listeners = {};
  const docListeners = {};
  const draws = { rect: 0, text: [] };
  const ctx = new Proxy({}, {
    get: (o, k) => (k === 'fillRect' ? () => { draws.rect += 1; } : k === 'fillText' ? (s) => { draws.text.push(s); } : k === 'measureText' ? (s) => ({ width: s.length * 7 }) : () => {}),
    set: () => true,
  });
  const fig = el('figure');
  fig.clientWidth = 300;
  const canvas = {
    width: 0, height: 0, offsetLeft: 0, offsetTop: 0, parentElement: fig, attrs: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 300, left: 0, top: 0 }),
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener: (type, f, opts) => { listeners[type] = f; if (opts) listeners[`${type}:opts`] = opts; },
    removeEventListener: (type) => { delete listeners[type]; delete listeners[`${type}:opts`]; },
    setPointerCapture() {},
  };
  const win = {
    getComputedStyle: (e) => ({ getPropertyValue: () => '', overflowY: e?.overflowY }),
    devicePixelRatio: 2,
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    cancelAnimationFrame: () => { frames = []; },
    setTimeout: (f, ms) => { timerId += 1; timers.push({ at: t + ms, f, id: timerId }); return timerId; },
    clearTimeout: (id) => { timers = timers.filter((x) => x.id !== id); },
    addEventListener: (type, f, opts) => { winListeners[type] = f; winListeners[`${type}:opts`] = opts; },
    removeEventListener: (type) => { delete winListeners[type]; },
  };
  const doc = {
    hidden: false, activeElement: null, documentElement: { tag: 'html' },
    addEventListener: (type, f, opts) => { docListeners[type] = f; if (opts) docListeners[`${type}:opts`] = opts; },
    removeEventListener: (type, f, opts) => { delete docListeners[type]; if (opts) docListeners[`${type}:removed`] = opts; },
    createElement: (tag) => el(tag),
  };
  const run = (ms) => {
    const end = t + ms;
    while (t < end) {
      t += 1000 / 60;
      const f = frames;
      frames = [];
      for (const fn of f) fn(t);
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      for (const x of due) x.f();
    }
  };
  const ev = (type, o = {}) => {
    let prevented = false;
    let stopped = false;
    listeners[type]?.({ pointerId: 1, pointerType: 'mouse', button: 0, timeStamp: t, clientX: 0, clientY: 0, deltaY: 0, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...o });
    return { prevented, stopped };
  };
  let worldCalls = 0;
  return {
    canvas, fig, win, doc, draws, listeners, docListeners, winListeners, run, ev,
    get timers() { return timers.length; },
    get t() { return t; },
    get worldCalls() { return worldCalls; },
    opts: { reduceMotion, win, doc, now: () => t, world: () => { worldCalls += 1; return typeof world === 'function' ? world() : Promise.resolve(world); }, day: '2026-09-29' },
  };
}
const FIX = {
  countries: [{ cc: 'US', visitors: 20, rest: 5 }, { cc: 'JP', visitors: 6, rest: 0, live: true }],
  cities: [
    { name: 'New York', cc: 'US', at: [-74, 41], visitors: 6, live: true }, { name: 'Chicago', cc: 'US', at: [-88, 42], visitors: 9 },
    { name: 'Tokyo', cc: 'JP', at: [140, 36], visitors: 3 }, { name: 'Yokohama', cc: 'JP', at: [140, 35], visitors: 3 },
  ],
};
const tick = () => new Promise((r) => { setImmediate(r); });
// 10,000 visitors in 500 places round ten busy cities (whole degrees, like the server's).
function synth(visitors, places, seed = 7) {
  let a = seed;
  const r = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  const hubs = [[-74, 41], [-122, 38], [0, 52], [13, 53], [140, 36], [77, 28], [-46, -23], [151, -34], [37, 56], [-99, 25]];
  const out = [];
  for (let i = 0; i < places; i++) {
    const h = hubs[i % hubs.length];
    out.push({ kind: 'city', cc: `C${i % 40}`, name: `Place ${i}`, at: [Math.round(h[0] + (r() - 0.5) * 40), Math.round(h[1] + (r() - 0.5) * 24)], n: 1, live: i % 97 === 0 });
  }
  let left = visitors - places;
  for (let i = 0; left > 0; i = (i + 1) % places) { const k = Math.min(left, Math.ceil(r() * r() * 60)); out[i].n += k; left -= k; }
  return out;
}
const HEAVY = synth(10000, 500);

test('mounted: nearby places are one critter with a count; the far side is hidden; zoom in and they split', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  // It starts facing the US. At 1x Chicago and the rest of the US (11 degrees apart) are
  // one critter, named after Chicago (the biggest), counting 14; New York is its own.
  // Japan is behind.
  const at1 = g.placed.filter((x) => x.item.n > 0);
  assert.deepEqual(at1.map((x) => `${x.item.name || x.item.cc} ${x.item.n}`).sort(), ['Chicago 14', 'New York 6']);
  const us = at1.find((x) => x.item.name === 'Chicago');
  assert.equal(us.size, 24, '10 to 99 visitors: 3 px a pixel');
  assert.ok(p.draws.text.includes('14') && p.draws.text.includes('6'), 'each count under its critter');
  assert.ok(us.label[1] >= us.sprites[0][1] + us.size, 'under it');
  const [sx, sy] = us.sprites[0];
  p.ev('pointermove', { clientX: sx + 8, clientY: sy + 8 });
  assert.equal(g.tip, 'Chicago, United States (elsewhere) · 14 visitors this week');
  // Face Chicago and zoom in to 3x: they split, one critter a place.
  p.doc.activeElement = p.canvas;
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowRight']) p.ev('keydown', { key });
  g.zoom(3);
  p.run(50);
  const at3 = g.placed.filter((x) => x.item.n > 0).map((x) => `${x.item.name || x.item.cc} ${x.item.n}`).sort();
  assert.deepEqual(at3, ['Chicago 9', 'New York 6', 'US 5']);
  g.zoom(1);
  // Turn half way round: now Japan, Tokyo and Yokohama as one.
  for (let i = 0; i < 12; i++) p.ev('keydown', { key: 'ArrowRight' });
  const back = g.placed.filter((x) => x.item.n > 0);
  assert.deepEqual(back.map((x) => x.item.places.map((k) => k.name).sort()), [['Tokyo', 'Yokohama']], 'the far side is hidden');
  assert.equal(back[0].item.live, true, 'Japan is live (its visitors are all in its cities): the cluster is');
  g.stop();
});

test('mounted: at most 40 critters in view and none on another, at every zoom, with 10,000 visitors', () => {
  const p = page();
  const heavy = { countries: [], cities: HEAVY.map((k) => ({ name: k.name, cc: k.cc, at: k.at, visitors: k.n, live: k.live })) };
  const g = mountGlobe(p.canvas, GEO, heavy, p.opts);
  for (const z of [1, 1.5, 2, 2.5, 3, 4, 5, 6]) {
    for (const turn of [0, 60, 150]) {
      g.zoom(1);
      p.doc.activeElement = p.canvas;
      for (let i = 0; i < turn / 15; i++) p.ev('keydown', { key: 'ArrowRight' });
      g.zoom(z);
      p.run(40);
      const critters = g.placed.reduce((s, x) => s + x.shown, 0);
      assert.ok(critters <= CRITTER_CAP, `${z}x: ${critters} critters`);
      const rects = g.placed.flatMap((x) => [...x.sprites.map(([l, t]) => [l, t, x.size, x.size]), ...(x.label ? [x.label] : [])]);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [a, b] = [rects[i], rects[j]];
          assert.ok(!(a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]), `${z}x, turned ${turn}: ${a} and ${b} overlap`);
        }
      }
    }
  }
  g.stop();
});

test('wheel: a pointer resting on the globe zooms, toward itself; the page scrolls elsewhere', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  assert.deepEqual(p.listeners['wheel:opts'], { passive: false }, 'able to stop the page scrolling');
  p.run(1000);
  // A corner of the canvas is not the globe: the page scrolls.
  let r = p.ev('wheel', { clientX: 3, clientY: 3, deltaY: -100 });
  assert.equal(r.prevented, false);
  assert.equal(g.view.zoom, 1);
  // Resting on the globe, no click needed: zoom in, and no page scroll.
  r = p.ev('wheel', { clientX: 150, clientY: 150, deltaY: -100 });
  assert.equal(r.prevented, true);
  assert.ok(g.view.zoom > 1.1);
  // Toward the pointer: the place under it stays put.
  const q = page();
  const h = mountGlobe(q.canvas, GEO, FIX, q.opts);
  q.run(1000);
  const before = unortho((200 - 150) / (144), (120 - 150) / 144, h.view.lon0, h.view.tilt);
  for (let i = 0; i < 5; i++) q.ev('wheel', { clientX: 200, clientY: 120, deltaY: -100 });
  const v = h.view;
  const [x, y] = ortho(before[0], before[1], v.lon0, v.tilt);
  assert.ok(Math.hypot(150 + x * 144 * v.zoom - 200, 150 + y * 144 * v.zoom - 120) < 1, 'under the pointer');
  g.stop();
  h.stop();
});

test('wheel (a): a sideways wheel or a back swipe (no deltaY) is always the page\'s', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  p.run(1000);
  g.zoom(3);
  for (const e of [{ deltaY: 0, deltaX: -120 }, { deltaY: 0, deltaX: 40, ctrlKey: true }, { deltaX: 80 }]) {
    const r = p.ev('wheel', { clientX: 150, clientY: 150, ...e });
    assert.equal(r.prevented, false, JSON.stringify(e));
  }
  assert.equal(g.view.zoom, 3);
  g.stop();
});

test('wheel (b): at a limit in the wheel\'s direction the page scrolls: 1x zooming out, 6x zooming in', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  p.run(1000);
  assert.equal(p.ev('wheel', { clientX: 150, clientY: 150, deltaY: 100 }).prevented, false, '1x, scrolling down');
  assert.equal(g.view.zoom, 1);
  for (let i = 0; i < 40; i++) p.ev('wheel', { clientX: 150, clientY: 150, deltaY: -300 });
  assert.equal(g.view.zoom, ZOOM_MAX, 'never past 6x');
  assert.equal(p.ev('wheel', { clientX: 150, clientY: 150, deltaY: -100 }).prevented, false, '6x, scrolling up');
  assert.equal(p.ev('wheel', { clientX: 150, clientY: 150, deltaY: 100 }).prevented, true, '6x, scrolling down zooms out');
  assert.ok(g.view.zoom < ZOOM_MAX);
  // ctrl + wheel (a trackpad pinch) is the globe's inside the circle, even at a limit:
  // never the page zooming. A mouse notch with ctrl is at most 1.25x.
  g.zoom(1);
  const r = p.ev('wheel', { clientX: 150, clientY: 150, deltaY: 10, ctrlKey: true });
  assert.equal(r.prevented, true);
  assert.equal(g.view.zoom, 1);
  p.ev('wheel', { clientX: 150, clientY: 150, deltaY: -100, ctrlKey: true });
  assert.ok(Math.abs(g.view.zoom - 1.25) < 1e-9, `${g.view.zoom}`);
  assert.equal(wheelFactor({ deltaY: -300, ctrlKey: true }), 1.25);
  assert.equal(wheelFactor({ deltaY: 300, ctrlKey: true }), 1 / 1.25);
  assert.ok(wheelFactor({ deltaY: -3, ctrlKey: true }) > 1.02, 'a real pinch step is untouched');
  assert.equal(p.ev('wheel', { clientX: 3, clientY: 3, deltaY: -10, ctrlKey: true }).prevented, false, 'outside the circle: not ours');
  g.stop();
});

test('wheel (c): while the page is scrolling (the globe slid under the pointer), the wheel keeps scrolling it', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  // One listener on the document, in the capture phase (scroll does not bubble).
  assert.equal(typeof p.docListeners.scroll, 'function');
  assert.deepEqual(p.docListeners['scroll:opts'], { capture: true, passive: true });
  const box = { contains: (n) => n === p.canvas }; // the screen or a panel the globe is in
  const other = { contains: () => false }; // some other box: a table, the tape
  const wheel = () => p.ev('wheel', { clientX: 150, clientY: 150, deltaY: -100 });
  p.run(1000);
  // Another box scrolling is not the page: the wheel zooms.
  p.docListeners.scroll({ target: other });
  p.run(100);
  let r = wheel();
  assert.equal(r.prevented, true, 'another box scrolling: still ours');
  g.zoom(1);
  // The box the globe is in scrolled: the page scrolls on.
  p.docListeners.scroll({ target: box });
  p.run(100);
  r = wheel();
  assert.equal(r.prevented, false, 'just scrolled: the page scrolls on');
  assert.equal(g.view.zoom, 1);
  // The document itself (after a resize the window may be what scrolls) counts too.
  p.run(700);
  p.docListeners.scroll({ target: p.doc });
  p.run(300);
  assert.equal(wheel().prevented, false, 'the document scrolling counts');
  p.run(700);
  p.docListeners.scroll({ target: p.doc.documentElement });
  p.run(300);
  assert.equal(wheel().prevented, false, 'and the root element');
  // The pointer has rested: now it zooms.
  p.run(700);
  r = wheel();
  assert.equal(r.prevented, true, 'rested: now it zooms');
  assert.ok(g.view.zoom > 1);
  g.stop();
  assert.equal(p.docListeners.scroll, undefined, 'stop() lets go of it');
  assert.deepEqual(p.docListeners['scroll:removed'], { capture: true, passive: true }, 'with the same capture option');
});

test('zoomed in: it stays put (no turning by itself), a drag turns it less, the land is finer', async () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  assert.equal(p.worldCalls, 0, 'the map outlines load only once someone zooms');
  g.zoom(4);
  p.run(50);
  await tick();
  await tick();
  assert.equal(p.worldCalls, 1);
  p.run(400);
  assert.equal(g.level, 3, 'finer land at 4x');
  const lon = g.view.lon0;
  p.run(IDLE_MS + 3000);
  assert.equal(g.view.lon0, lon, 'no turning by itself when zoomed in');
  p.ev('pointerdown', { clientX: 150, clientY: 150 });
  p.ev('pointermove', { clientX: 180, clientY: 150 });
  p.ev('pointerup', { clientX: 180, clientY: 150, timeStamp: p.t + 200 });
  const turned = Math.abs(wrapLon(g.view.lon0 - lon));
  assert.ok(turned > 0 && turned < 4, `a 30 px drag at 4x turns ${turned.toFixed(2)} degrees`);
  g.zoom(1);
  p.run(50);
  assert.equal(g.level, 1);
  p.run(IDLE_MS + 2000);
  const at1 = g.view.lon0;
  p.run(1000);
  assert.notEqual(g.view.lon0, at1, 'back at 1x it turns again');
  g.stop();
});

test('finer land is made after the zooming stops, never inside a frame; the best made so far meanwhile', async () => {
  const world = JSON.parse(JSON.stringify(WORLD)); // a map no level was made for yet
  const p = page({ world });
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  g.zoom(2);
  await tick(); await tick();
  assert.equal(p.worldCalls, 1);
  // Still zooming: every frame draws, none makes a level.
  for (let i = 0; i < 6; i++) {
    p.run(LOD_WAIT_MS / 2);
    assert.equal(lodReady(world, 2), false, `zoom step ${i}: not made yet`);
    assert.equal(g.level, 1, 'the 1x land meanwhile');
    g.zoom(i % 2 ? 2.2 : 2.1);
  }
  p.run(LOD_WAIT_MS + 50);
  assert.equal(lodReady(world, 2), true, 'made once the zooming stopped');
  assert.equal(g.level, 2);
  // Zoom on to 6x: level 2 is drawn until level 4 is made.
  g.zoom(6);
  p.run(50);
  assert.equal(g.level, 2, 'the best made so far');
  assert.equal(lodReady(world, 4), false);
  p.run(LOD_WAIT_MS + 50);
  assert.equal(g.level, 4);
  g.stop();
  assert.equal(p.timers, 0, 'no timer left behind');
});

test('the map outlines fail: one more try after 30 s, then the 1x land for good', async () => {
  let calls = 0;
  const p = page({ world: () => { calls += 1; return Promise.reject(new Error('offline')); } });
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  g.zoom(4);
  await tick(); await tick();
  assert.equal(calls, 1);
  for (let i = 0; i < 20; i++) { p.run(200); g.zoom(3 + (i % 2)); }
  await tick();
  assert.equal(calls, 1, 'not again every frame or zoom');
  p.run(WORLD_RETRY_MS);
  await tick(); await tick();
  assert.equal(calls, 2, 'once more after 30 s');
  p.run(WORLD_RETRY_MS * 3);
  g.zoom(5);
  await tick(); await tick();
  assert.equal(calls, 2, 'then never');
  assert.equal(g.level, 1);
  g.stop();
});

test('zoomed in: hover finds only figures inside the lens', () => {
  assert.equal(inLens(90, 90, 16, 100, 50), true);
  assert.equal(inLens(145, 100, 16, 100, 50), true, 'partly inside');
  assert.equal(inLens(152, 100, 16, 100, 50), false);
  assert.equal(inLens(140, 140, 16, 100, 50), false, 'the corner');
  assert.equal(inLens(100, 148, 30, 100, 50, 14), true, 'a wide box, its own height');
  assert.equal(inLens(100, 151, 30, 100, 50, 14), false);
  const p = page();
  const heavy = { countries: [], cities: HEAVY.map((k) => ({ name: k.name, cc: k.cc, at: k.at, visitors: k.n })) };
  const g = mountGlobe(p.canvas, GEO, heavy, p.opts);
  g.zoom(3);
  p.run(50);
  const c = 150;
  const R = 144;
  let n = 0;
  for (const pl of g.placed) {
    for (const [sx, sy] of pl.sprites) {
      n += 1;
      assert.ok(inLens(sx, sy, pl.size, c, R), 'a hidden figure is not hoverable');
    }
    if (pl.label) assert.ok(inLens(pl.label[0], pl.label[1], pl.label[2], c, R, pl.label[3]), 'nor a hidden count');
  }
  assert.ok(n > 0);
  // A corner of the canvas never finds a figure.
  assert.equal(pickSprite(g.placed, 2, 2, 4), null);
  g.stop();
});

test('buttons and keys: +, - and 1x; keys only while the globe has focus, and not the command bar\'s', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  const box = p.fig.kids.find((k) => k.className === 'globe-zoom');
  assert.ok(box, 'the zoom buttons, beside the canvas');
  const [plus, minus, reset] = box.kids;
  assert.deepEqual(box.kids.map((b) => [b.tag, b.type, b.textContent, b.getAttribute('aria-label')]), [
    ['button', 'button', '+', 'Zoom in'], ['button', 'button', '−', 'Zoom out'], ['button', 'button', '1x', 'Back to 1x'],
  ]);
  assert.equal(minus.getAttribute('aria-disabled'), 'true', 'at 1x: nothing to zoom out');
  plus.click();
  assert.equal(g.view.zoom, ZOOM_STEP);
  assert.equal(minus.getAttribute('aria-disabled'), 'false');
  plus.click(); plus.click(); plus.click();
  assert.equal(g.view.zoom, ZOOM_MAX);
  assert.equal(plus.getAttribute('aria-disabled'), 'true');
  minus.click();
  assert.equal(g.view.zoom, ZOOM_MAX / ZOOM_STEP);
  reset.click();
  assert.equal(g.view.zoom, 1);
  // Keys: nothing while focus is elsewhere (the command bar).
  let r = p.ev('keydown', { key: '+' });
  assert.equal(g.view.zoom, 1);
  assert.equal(r.prevented, false);
  p.doc.activeElement = p.canvas;
  r = p.ev('keydown', { key: '+' });
  assert.equal(g.view.zoom, 2);
  assert.ok(r.prevented && r.stopped, 'not typed into the command bar');
  p.ev('keydown', { key: '=' });
  assert.equal(g.view.zoom, 4);
  p.ev('keydown', { key: '-' });
  assert.equal(g.view.zoom, 2);
  p.ev('keydown', { key: '+', ctrlKey: true });
  assert.equal(g.view.zoom, 2, 'ctrl + is the browser\'s');
  g.stop();
});

test('touch: two fingers pinch the globe, one drags it; a double tap and a double click zoom in there', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  const t = (type, id, x, y, extra = {}) => p.ev(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, ...extra });
  t('pointerdown', 1, 130, 150);
  t('pointerdown', 2, 170, 150);
  const lon = g.view.lon0;
  t('pointermove', 1, 90, 150);
  t('pointermove', 2, 210, 150);
  assert.ok(Math.abs(g.view.zoom - 3) < 1e-9, `fingers 3 times as far apart: ${g.view.zoom}`);
  const pinched = g.view.lon0;
  t('pointerup', 2, 210, 150);
  t('pointermove', 1, 20, 150);
  assert.equal(g.view.lon0, pinched, 'the finger left over does not drag');
  t('pointerup', 1, 20, 150);
  g.zoom(1);
  // One finger: a drag turns it.
  t('pointerdown', 3, 150, 150);
  t('pointermove', 3, 110, 150);
  t('pointerup', 3, 110, 150, { timeStamp: p.t + 200 });
  assert.notEqual(g.view.lon0, lon);
  // A double tap: 2x there.
  p.run(1000);
  t('pointerdown', 4, 150, 150);
  t('pointerup', 4, 150, 150);
  p.run(100);
  t('pointerdown', 5, 152, 151);
  t('pointerup', 5, 152, 151);
  assert.equal(g.view.zoom, 2, 'double tap');
  p.run(2000);
  // A tap, then another far away or late: no zoom.
  t('pointerdown', 6, 150, 150); t('pointerup', 6, 150, 150);
  p.run(600);
  t('pointerdown', 7, 150, 150); t('pointerup', 7, 150, 150);
  assert.equal(g.view.zoom, 2, 'too slow for a double tap');
  // A double click with a mouse.
  p.run(1000);
  const r = p.ev('dblclick', { clientX: 150, clientY: 150 });
  assert.equal(g.view.zoom, 4);
  assert.equal(r.prevented, true);
  g.stop();
});

test('stop(): every listener goes, the buttons and the label too', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'keydown', 'dblclick', 'wheel'];
  for (const type of types) assert.equal(typeof p.listeners[type], 'function', type);
  const box = p.fig.kids.find((k) => k.className === 'globe-zoom');
  const tip = p.fig.kids.find((k) => k.className === 'globe-tip');
  assert.ok(box.kids.every((b) => typeof b.listeners.click === 'function'));
  g.stop();
  for (const type of types) assert.equal(p.listeners[type], undefined, `${type} let go`);
  assert.ok(box.kids.every((b) => b.listeners.click === undefined), 'button clicks let go');
  assert.ok(box.removed && tip.removed, 'the buttons and the label gone');
  assert.equal(p.docListeners.visibilitychange, undefined);
});

test('someone on now: the first figure of a live place bobs (not with reduced motion)', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, { ...p.opts, live: 3 });
  const a = p.draws.rect;
  p.run(1000);
  assert.ok(p.draws.rect > a, 'keeps drawing while someone is on');
  g.stop();
  const r = page({ reduceMotion: true });
  const still = mountGlobe(r.canvas, GEO, FIX, { ...r.opts, live: 3 });
  const b = r.draws.rect;
  r.run(1000);
  assert.equal(r.draws.rect, b, 'reduced motion: one still frame');
  still.zoom(2);
  assert.ok(r.draws.rect > b, 'but it still zooms by hand');
  still.stop();
});

test('the screens: zoom buttons styled in the corner, out of the flow; the globe files keep the house rules', () => {
  for (const [f, cls] of [['public/screens/bbrk.css', 'bb-globe']]) { // SPONSOR has no globe (Sep 29)
    const css = readFileSync(f, 'utf8');
    assert.match(css, new RegExp(`\\.${cls} \\.globe-zoom \\{[^}]*position: absolute;[^}]*top: 0; right: 0;`), f);
    assert.match(css, new RegExp(`\\.${cls} \\.globe-zoom-btn:focus-visible`), `${f}: keyboard focus shows`);
    assert.doesNotMatch(css, /btn-solid/, `${f}: tertiary, not a primary button`);
  }
  // BBRK's caption (what a figure is) is set to 40ch, so it is the same two lines at any
  // globe size from about 290 px: fitToView measures it with the globe, and a caption that
  // wrapped again after that could push the globe below the fold (1536x730).
  assert.match(readFileSync('public/screens/bbrk.css', 'utf8'), /\.bb-globe figcaption \{ max-width: 40ch;[^}]*text-wrap: balance; \}/);
  const src = readFileSync('public/globe.js', 'utf8');
  assert.match(src, /\['wheel', onWheel, \{ passive: false \}\]/);
  assert.doesNotMatch(src, /DataFast|datafa\.st|Mapbox/i);
});
