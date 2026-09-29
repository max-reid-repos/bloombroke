// The globe's pixel figures and zoom (public/globe.js, public/globe-sprites.js): a figure
// per visitor, made up from a seed, the same format as the ME avatars; where they go;
// the 240 cap and +N; zoom (wheel, pinch, double tap, buttons, keys) toward the pointer;
// the land's detail levels; and letting go of everything on stop().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encode, decode, draw, spriteHex, PALETTE, colorFor, dayKey, spotsFor, budget, hash,
} from '../public/globe-sprites.js';
import {
  mountGlobe, clampZoom, zoomAt, unortho, ortho, wheelFactor, overGlobe, levelFor, spritePx, perPlace, layoutSprites,
  pickSprite, lodLand, landOf, worldDots, wrapLon, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, SPRITE_CAP, PLACE_Z1, TILT, IDLE_MS,
} from '../public/globe.js';

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

test('a bunch: grid spots nearest first, never two figures on one another (up to 20 and past)', () => {
  for (let n = 1; n <= 20; n++) {
    const s = spotsFor(n);
    assert.equal(s.length, n);
    assert.equal(new Set(s.map((p) => p.join(','))).size, n, `n=${n}: all different`);
    assert.ok(s.every((p) => p.every(Number.isInteger)), 'whole grid steps');
    assert.deepEqual(s[0], [0, 0], 'the first on the place itself');
    for (let i = 1; i < n; i++) assert.ok(Math.hypot(...s[i]) >= Math.hypot(...s[i - 1]) - 1e-9, 'nearest first');
    // Laid out: no two figures overlap, and the bunch is tight.
    const [laid] = layoutSprites([{ x: 100, y: 100, count: n }], { pitch: 18, size: 16 });
    assert.equal(laid.sprites.length, n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const [a, b] = [laid.sprites[i], laid.sprites[j]];
        assert.ok(Math.abs(a[0] - b[0]) >= 16 || Math.abs(a[1] - b[1]) >= 16, `n=${n}: ${i} and ${j} overlap`);
      }
    }
    assert.ok(laid.box[2] - laid.box[0] <= 18 * (Math.ceil(Math.sqrt(n)) + 1), `n=${n}: tight`);
  }
});

test('bunches next to each other: none of their figures overlap; the smaller goes round the bigger', () => {
  // Tokyo and Yokohama, a pixel apart at 1x; three more places close by.
  const places = [{ x: 100, y: 100, count: 9 }, { x: 101, y: 101, count: 3 }, { x: 120, y: 95, count: 12 }, { x: 60, y: 130, count: 5 }, { x: 100, y: 100, count: 20 }];
  const laid = layoutSprites(places, { pitch: 18, size: 16 });
  const all = laid.flatMap((p, k) => p.sprites.map((s) => [...s, k]));
  assert.equal(all.length, 49, 'every figure placed');
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a, b] = [all[i], all[j]];
      assert.ok(Math.abs(a[0] - b[0]) >= 17.99 || Math.abs(a[1] - b[1]) >= 17.99, `${a} and ${b}`);
    }
  }
  assert.deepEqual(laid[0].sprites[0], [92, 92], 'the biggest first place keeps its middle');
  // Hover a figure: its own place, even inside the other's bunch.
  const placed = laid.map((p, k) => ({ item: { n: p.count, k }, x: p.x, y: p.y, r: 10, size: 16, sprites: p.sprites }));
  const [sx, sy] = laid[1].sprites[0];
  assert.equal(pickSprite(placed, sx + 8, sy + 8).item.k, 1);
  assert.equal(pickSprite(placed, 400, 400), null);
});

test('the cap: at most 240 figures in all, the biggest places give way first; the rest is +N', () => {
  assert.equal(SPRITE_CAP, 240);
  assert.deepEqual(budget([5, 3, 0]), [5, 3, 0], 'room for all');
  const counts = [500, 300, 120, 40, 9, 3];
  const b = budget(counts, { cap: SPRITE_CAP });
  assert.equal(b.reduce((s, x) => s + x, 0), SPRITE_CAP);
  assert.deepEqual(b.slice(3), [40, 9, 3], 'small places keep all theirs');
  assert.ok(b[0] >= b[1] && b[1] >= b[2] && b[2] > 40, `${b}`);
  assert.ok(b[0] - b[2] <= 1, 'the big ones share the rest evenly');
  const more = counts.map((c, i) => c - b[i]);
  assert.ok(more[0] > 0 && more[5] === 0, '+N only on the big ones');
  // Per place at this zoom, then the cap.
  assert.deepEqual(budget([38, 15, 9, 3], { perPlace: 9 }), [9, 9, 9, 3]);
  assert.deepEqual(budget([1000], { cap: 240, perPlace: 9 }), [9]);
  assert.equal(budget(Array(100).fill(10), { cap: 240 }).reduce((s, x) => s + x, 0), 240);
  assert.deepEqual(budget([NaN, -3, 2.7]), [0, 0, 2]);
  assert.equal(perPlace(1), PLACE_Z1);
  assert.ok(perPlace(2) === PLACE_Z1 * 4 && perPlace(6) >= SPRITE_CAP, 'zoomed in, a place shows more');
  assert.equal(spritePx(1), 2, '2 px a pixel at 1x: a 16 px figure');
  assert.ok(spritePx(3) === 3 && spritePx(6) === 4, 'a little bigger zoomed in');
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
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    devicePixelRatio: 2,
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    cancelAnimationFrame: () => { frames = []; },
  };
  const doc = {
    hidden: false, activeElement: null,
    addEventListener: (type, f) => { docListeners[type] = f; },
    removeEventListener: (type) => { delete docListeners[type]; },
    createElement: (tag) => el(tag),
  };
  const run = (ms) => {
    const end = t + ms;
    while (t < end) {
      t += 1000 / 60;
      const f = frames;
      frames = [];
      for (const fn of f) fn(t);
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
    canvas, fig, win, doc, draws, listeners, docListeners, run, ev,
    get t() { return t; },
    get worldCalls() { return worldCalls; },
    opts: { reduceMotion, win, doc, now: () => t, world: () => { worldCalls += 1; return Promise.resolve(world); }, day: '2026-09-29' },
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

test('mounted: a figure per visitor on the near side, the far side hidden, +N past a place\'s share', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  // It starts facing the US: New York, Chicago and the rest of the US; Japan is behind.
  const names = g.placed.filter((x) => x.item.n > 0).map((x) => x.item.name || x.item.cc).sort();
  assert.deepEqual(names, ['Chicago', 'New York', 'US']);
  const chicago = g.placed.find((x) => x.item.name === 'Chicago');
  assert.equal(chicago.shown, PLACE_Z1, 'at most PLACE_Z1 figures a place at 1x');
  assert.equal(chicago.size, 16, '8 pixels of 2 px');
  assert.ok(!p.draws.text.includes('+0'), 'no +0');
  assert.equal(g.placed.find((x) => x.item.name === 'New York').shown, 6);
  // Hover a figure of New York: its label.
  const ny = g.placed.find((x) => x.item.name === 'New York');
  const [sx, sy] = ny.sprites[ny.sprites.length - 1];
  p.ev('pointermove', { clientX: sx + 8, clientY: sy + 8 });
  assert.equal(g.tip, 'New York · 6 visitors this week');
  // Turn half way round: now Japan.
  p.doc.activeElement = p.canvas;
  for (let i = 0; i < 12; i++) p.ev('keydown', { key: 'ArrowRight' });
  const back = g.placed.filter((x) => x.item.n > 0).map((x) => x.item.name || x.item.cc).sort();
  assert.deepEqual(back, ['Tokyo', 'Yokohama'], 'the far side is hidden');
  g.stop();
});

test('mounted: 240 figures at most, the biggest places show +N', () => {
  const p = page();
  const big = { countries: [{ cc: 'US', visitors: 900, rest: 100 }], cities: [
    { name: 'New York', cc: 'US', at: [-74, 41], visitors: 400 }, { name: 'Chicago', cc: 'US', at: [-88, 42], visitors: 300 }, { name: 'Boston', cc: 'US', at: [-71, 42], visitors: 100 },
  ] };
  const g = mountGlobe(p.canvas, GEO, big, p.opts);
  g.zoom(6);
  const total = g.placed.reduce((s, x) => s + x.shown, 0);
  assert.ok(total <= SPRITE_CAP, `${total}`);
  assert.ok(p.draws.text.some((s) => /^\+\d+$/.test(s)), '+N drawn');
  g.stop();
});

test('wheel: zooms only over the globe, toward the pointer; the page scrolls elsewhere', () => {
  const p = page();
  const g = mountGlobe(p.canvas, GEO, FIX, p.opts);
  assert.deepEqual(p.listeners['wheel:opts'], { passive: false }, 'able to stop the page scrolling');
  // A corner of the canvas is not the globe: the page scrolls.
  let r = p.ev('wheel', { clientX: 3, clientY: 3, deltaY: -100 });
  assert.equal(r.prevented, false);
  assert.equal(g.view.zoom, 1);
  // Over the globe: zoom in, and no page scroll.
  r = p.ev('wheel', { clientX: 150, clientY: 150, deltaY: -100 });
  assert.equal(r.prevented, true);
  assert.ok(g.view.zoom > 1.1);
  // At 1x a scroll down is the page's.
  const q = page();
  const h = mountGlobe(q.canvas, GEO, FIX, q.opts);
  assert.equal(q.ev('wheel', { clientX: 150, clientY: 150, deltaY: 100 }).prevented, false);
  assert.equal(q.ev('wheel', { clientX: 150, clientY: 150, deltaY: 10, ctrlKey: true }).prevented, true, 'a trackpad pinch never zooms the page');
  // Toward the pointer: the place under it stays put.
  const before = unortho((200 - 150) / (144), (120 - 150) / 144, h.view.lon0, h.view.tilt);
  for (let i = 0; i < 5; i++) q.ev('wheel', { clientX: 200, clientY: 120, deltaY: -100 });
  const v = h.view;
  const [x, y] = ortho(before[0], before[1], v.lon0, v.tilt);
  assert.ok(Math.hypot(150 + x * 144 * v.zoom - 200, 150 + y * 144 * v.zoom - 120) < 1, 'under the pointer');
  for (let i = 0; i < 40; i++) q.ev('wheel', { clientX: 150, clientY: 150, deltaY: -300 });
  assert.equal(h.view.zoom, ZOOM_MAX, 'never past 6x');
  g.stop();
  h.stop();
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
  p.run(100);
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
  assert.equal(g.level, 1);
  p.run(IDLE_MS + 2000);
  const at1 = g.view.lon0;
  p.run(1000);
  assert.notEqual(g.view.lon0, at1, 'back at 1x it turns again');
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
  for (const [f, cls] of [['public/screens/bbrk.css', 'bb-globe'], ['public/screens/sponsor.css', 'spon-globe']]) {
    const css = readFileSync(f, 'utf8');
    assert.match(css, new RegExp(`\\.${cls} \\.globe-zoom \\{[^}]*position: absolute;[^}]*top: 0; right: 0;`), f);
    assert.match(css, new RegExp(`\\.${cls} \\.globe-zoom-btn:focus-visible`), `${f}: keyboard focus shows`);
    assert.doesNotMatch(css, /btn-solid/, `${f}: tertiary, not a primary button`);
  }
  // BBRK's caption stays one line at any globe size: fitToView measures it once, so a
  // caption that wrapped at 220 px would push the globe below the fold (1536x730).
  assert.match(readFileSync('public/screens/bbrk.css', 'utf8'), /\.bb-globe figcaption \{[^}]*justify-content: center;[^}]*white-space: nowrap;/);
  const src = readFileSync('public/globe.js', 'utf8');
  assert.match(src, /\['wheel', onWheel, \{ passive: false \}\]/);
  assert.doesNotMatch(src, /DataFast|datafa\.st|Mapbox/i);
});
