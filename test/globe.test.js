// The globe (public/globe.js): drag to turn it, momentum, turning by itself again, keys,
// the sun, pulses, the dot labels (the folding rule), pausing off screen and while the tab
// is hidden, and the SPONSOR phone layout (CSS).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mountGlobe, wrapLon, pxToDeg, decay, clampV, clampTilt, autoSpeed, subsolar, daylight, shade, globeItems, tipText, pulsesOn, pickDot, denseDots,
  IDLE_MS, RAMP_MS, TURN_DEG_PER_SEC, V_MAX, TILT_MAX, TILT_MIN, KEY_STEP, FPS,
} from '../public/globe.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('drag math: angles wrap, pixels become degrees, momentum decays to a stop', () => {
  assert.equal(wrapLon(190), -170);
  assert.equal(wrapLon(-190), 170);
  assert.equal(wrapLon(540), -180);
  assert.equal(wrapLon(-720 + 5), 5);
  for (let l = -1000; l < 1000; l += 37) assert.ok(wrapLon(l) >= -180 && wrapLon(l) < 180, String(l));
  assert.ok(near(pxToDeg(100, 100), 180 / Math.PI), 'a radius dragged is a radian');
  assert.equal(pxToDeg(10, 0), 0);
  // Momentum: always slower, same direction, and over within a couple of seconds.
  let v = 0.5;
  let steps = 0;
  while (v !== 0 && steps < 1000) {
    const next = decay(v, 1000 / 60);
    assert.ok(Math.abs(next) < Math.abs(v) && Math.sign(next || v) === 1);
    v = next;
    steps += 1;
  }
  assert.ok(steps > 10 && steps < 120, `${steps} frames`);
  assert.ok(decay(-0.3, 16) < 0, 'a flick left stays left');
  assert.equal(decay(0.4, 16 * 4), decay(decay(decay(decay(0.4, 16), 16), 16), 16) || 0, 'frame rate does not change the glide');
  assert.equal(clampV(9), V_MAX);
  assert.equal(clampTilt(200), TILT_MAX);
  assert.equal(clampTilt(-200), TILT_MIN);
  // Turning by itself: nothing for IDLE_MS after a touch, then up to speed.
  assert.equal(IDLE_MS, 4000);
  assert.equal(autoSpeed(0), 0);
  assert.equal(autoSpeed(IDLE_MS - 1), 0);
  assert.ok(autoSpeed(IDLE_MS + RAMP_MS / 2) > 0 && autoSpeed(IDLE_MS + RAMP_MS / 2) < TURN_DEG_PER_SEC);
  assert.equal(autoSpeed(IDLE_MS + RAMP_MS), TURN_DEG_PER_SEC);
  assert.equal(autoSpeed(Infinity), TURN_DEG_PER_SEC, 'never touched: it turns');
});

test('the sun: overhead at the right latitude by season, the day and night line', () => {
  const june = subsolar(new Date('2026-06-21T12:00:00Z'));
  assert.ok(near(june[1], 23.44, 0.3), `June ${june[1]}`);
  assert.ok(Math.abs(june[0]) < 3, `noon UTC is near Greenwich: ${june[0]}`);
  const dec = subsolar(new Date('2026-12-21T12:00:00Z'));
  assert.ok(near(dec[1], -23.44, 0.3), `December ${dec[1]}`);
  const march = subsolar(new Date('2026-03-20T14:46:00Z'));
  assert.ok(Math.abs(march[1]) < 0.3, `equinox ${march[1]}`);
  const six = subsolar(new Date('2026-06-21T18:00:00Z'));
  assert.ok(Math.abs(six[0] - -90) < 3, `six hours later, a quarter turn west: ${six[0]}`);
  assert.ok(near(daylight(10, 20, [10, 20]), 1));
  assert.ok(near(daylight(-170, -20, [10, 20]), -1));
  assert.equal(shade(0.5), 1);
  assert.ok(shade(0) < 1 && shade(0) > shade(-0.5), 'dusk between day and night');
});

test('dot labels: the folding rule (3 or more, from the server), cities and the rest of a country', () => {
  const centres = { US: [-99, 39], JP: [138, 36], IS: [-19, 65] };
  const names = { US: 'United States', JP: 'Japan' };
  const globe = {
    countries: [{ cc: 'US', visitors: 45 }, { cc: 'JP', visitors: 30, rest: 18, live: true }, { cc: 'DE', visitors: 9, rest: 0, live: true }],
    cities: [{ name: 'Tokyo', cc: 'JP', at: [140, 36], visitors: 12, live: true }],
  };
  const items = globeItems(globe, centres);
  assert.equal(tipText(items.find((k) => k.cc === 'US'), names), 'United States · 45 this week');
  assert.equal(tipText(items.find((k) => k.kind === 'city'), names), 'Tokyo · 12 this week');
  assert.equal(tipText(items.find((k) => k.cc === 'JP' && k.kind === 'country'), names), 'Japan, elsewhere · 18 this week');
  assert.ok(!items.some((k) => k.cc === 'DE'), 'not on the map: no dot');
  assert.equal(tipText(items.find((k) => k.cc === 'US'), { US: 'United States of America' }), 'United States · 45 this week', 'plain names');
  const noRest = globeItems({ countries: [{ cc: 'JP', visitors: 12, rest: 0, live: true }] }, centres);
  assert.equal(noRest.length, 1, 'kept only to pulse');
  assert.equal(tipText(noRest[0], names), '', 'no dot, no label');
  assert.equal(pickDot([{ item: noRest[0], x: 10, y: 10, r: 3 }], 10, 10), null, 'nothing to hover');
  // The browser draws what the server sent: a country under 3 never arrives, so never shows.
  assert.deepEqual(globeItems({ countries: [] }, centres), []);
  // The old shape (a countries array) still works.
  assert.equal(globeItems([{ cc: 'US', visitors: 5 }], centres)[0].n, 5);
  // Pulses: from 2 people on now (1 is most likely the viewer).
  assert.equal(pulsesOn(1), false);
  assert.equal(pulsesOn(null), false);
  assert.equal(pulsesOn(2), true);
  // Picking: the nearest dot within its radius and some slack.
  const placed = [{ item: items[0], x: 50, y: 50, r: 4 }, { item: items[1], x: 70, y: 50, r: 4 }];
  assert.equal(pickDot(placed, 52, 51).item, items[0]);
  assert.equal(pickDot(placed, 66, 50).item, items[1]);
  assert.equal(pickDot(placed, 150, 150), null);
});

// ---- a fake page: canvas, window, document, clock, frames, IntersectionObserver ----
function page({ reduceMotion = false, io = true } = {}) {
  let t = 0;
  let frames = [];
  const listeners = {};
  const docListeners = {};
  const draws = { fill: 0, rect: 0, stroke: 0 };
  const ctx = new Proxy({}, {
    get: (o, k) => (k === 'fillRect' ? () => { draws.rect += 1; } : k === 'fill' ? () => { draws.fill += 1; } : k === 'stroke' ? () => { draws.stroke += 1; } : () => {}),
    set: () => true,
  });
  const children = [];
  const fig = { clientWidth: 200, appendChild: (c) => children.push(c) };
  const canvas = {
    width: 0, height: 0, offsetLeft: 0, offsetTop: 0, parentElement: fig,
    attrs: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 200, left: 0, top: 0 }),
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener: (type, f) => { listeners[type] = f; },
    removeEventListener: (type) => { delete listeners[type]; },
    setPointerCapture() {},
  };
  const observers = [];
  const win = {
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    devicePixelRatio: 2,
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    cancelAnimationFrame: () => { frames = []; },
  };
  if (io) {
    win.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() { this.gone = true; }
    };
  }
  const doc = {
    hidden: false, activeElement: null,
    addEventListener: (type, f) => { docListeners[type] = f; },
    removeEventListener: (type) => { delete docListeners[type]; },
    createElement: () => ({ hidden: true, style: {}, textContent: '', offsetWidth: 80, setAttribute() {}, remove() {} }),
  };
  const geo = { dots: [[0, 0], [10, 10], [-99, 39], [140, 36]], centres: { US: [-99, 39], JP: [138, 36] }, names: { US: 'United States', JP: 'Japan' } };
  // Run frames for ms milliseconds of the fake clock, a frame each 1/60 s.
  const run = (ms) => {
    const end = t + ms;
    while (t < end) {
      t += 1000 / 60;
      const f = frames;
      frames = [];
      for (const fn of f) fn(t);
    }
  };
  const ev = (type, o = {}) => listeners[type]?.({ pointerId: 1, pointerType: 'mouse', button: 0, timeStamp: t, clientX: 0, clientY: 0, preventDefault() {}, ...o });
  return {
    canvas, win, doc, geo, draws, listeners, docListeners, observers, children, run, ev,
    get t() { return t; },
    get frames() { return frames.length; },
    opts: { reduceMotion, win, doc, now: () => t },
  };
}

test('drag: the globe follows the pointer, flings on, stops, then turns by itself after 4 s', () => {
  const p = page();
  const g = mountGlobe(p.canvas, p.geo, { countries: [{ cc: 'US', visitors: 45 }] }, p.opts);
  assert.equal(p.canvas.tabIndex, 0, 'focusable, for the arrow keys');
  assert.equal(p.canvas.attrs['data-own-focus'], '', 'a click keeps its focus (app.js)');
  p.run(5000);
  const lon0 = g.view.lon0;
  const R = 200 / 2 - 6;
  p.ev('pointerdown', { clientX: 100, clientY: 100 });
  p.run(16);
  p.ev('pointermove', { clientX: 130, clientY: 100, timeStamp: p.t });
  assert.ok(near(wrapLon(g.view.lon0 - lon0), wrapLon(-pxToDeg(30, R)), 1e-9), 'dragging right turns the near side right');
  const held = g.view.lon0;
  p.run(1000);
  assert.equal(g.view.lon0, held, 'held: it does not turn by itself while pressed');
  // A flick: fast moves, then let go at once.
  for (let i = 1; i <= 3; i++) { p.run(16); p.ev('pointermove', { clientX: 130 + i * 20, clientY: 100, timeStamp: p.t }); }
  p.ev('pointerup', { clientX: 190, clientY: 100, timeStamp: p.t });
  assert.ok(g.view.v < 0, 'momentum in the drag direction');
  const up = g.view.lon0;
  p.run(200);
  assert.ok(wrapLon(g.view.lon0 - up) < 0, 'glides on');
  p.run(2500);
  assert.equal(g.view.v, 0, 'and stops');
  const stopped = g.view.lon0;
  p.run(2000);
  assert.equal(g.view.lon0, stopped, 'still for a while (4 s idle)');
  p.run(IDLE_MS + 2000);
  assert.ok(wrapLon(g.view.lon0 - stopped) > 0, 'then turns by itself again');
  // Up and down tilts with a mouse, never past the limits; not on a touch screen (that scrolls).
  p.ev('pointerdown', { clientX: 100, clientY: 100 });
  p.ev('pointermove', { clientX: 100, clientY: 900 });
  assert.equal(g.view.tilt, TILT_MAX);
  p.ev('pointerup', { clientX: 100, clientY: 900 });
  const tilt = g.view.tilt;
  p.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 100 });
  p.ev('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 20 });
  assert.equal(g.view.tilt, tilt, 'a vertical touch drag is the page scrolling');
  p.ev('pointercancel', { pointerId: 2, pointerType: 'touch' });
  assert.match(readFileSync('public/screens/sponsor.css', 'utf8'), /\.spon-globe canvas \{[^}]*touch-action: pan-y;/);
  assert.match(readFileSync('public/screens/bbrk.css', 'utf8'), /\.bb-globe canvas \{[^}]*touch-action: pan-y;/);
  g.stop();
  assert.equal(p.listeners.pointerdown, undefined, 'stop() takes the handlers away');
});

test('frames: at most 30 a second, pause while hidden or off screen, still with reduced motion', () => {
  const p = page();
  const g = mountGlobe(p.canvas, p.geo, { countries: [{ cc: 'US', visitors: 45 }] }, p.opts);
  assert.equal(FPS, 30);
  p.run(IDLE_MS);
  const before = p.draws.stroke;
  p.run(1000); // untouched: it turns, so every allowed frame draws
  const frames = p.draws.stroke - before; // one rim stroke a frame
  assert.ok(frames <= 32 && frames >= 25, `${frames} frames in a second`);
  assert.equal(p.canvas.width, 400, 'devicePixelRatio aware');
  // Hidden tab.
  p.doc.hidden = true;
  p.docListeners.visibilitychange();
  assert.equal(g.running, false);
  const hiddenAt = p.draws.stroke;
  p.run(1000);
  assert.equal(p.draws.stroke, hiddenAt, 'nothing drawn while hidden');
  p.doc.hidden = false;
  p.docListeners.visibilitychange();
  assert.equal(g.running, true);
  // Off screen.
  p.observers[0].cb([{ isIntersecting: false }]);
  assert.equal(g.running, false, 'paused off screen');
  const offAt = p.draws.stroke;
  p.run(1000);
  assert.equal(p.draws.stroke, offAt);
  p.observers[0].cb([{ isIntersecting: true }]);
  assert.equal(g.running, true);
  // Hidden while off screen, then shown: still paused until it is on screen again.
  p.observers[0].cb([{ isIntersecting: false }]);
  p.doc.hidden = true; p.docListeners.visibilitychange();
  p.doc.hidden = false; p.docListeners.visibilitychange();
  assert.equal(g.running, false);
  g.stop();
  assert.ok(p.observers[0].gone, 'stop() lets go of the observer');
  // Reduced motion: one still frame, no loop, no pulse animation; a drag still turns it.
  const r = page({ reduceMotion: true });
  const still = mountGlobe(r.canvas, r.geo, { countries: [{ cc: 'US', visitors: 45, live: true }] }, { ...r.opts, live: 5 });
  assert.equal(still.running, false);
  assert.equal(r.frames, 0);
  const lon = still.view.lon0;
  r.ev('pointerdown', { clientX: 100, clientY: 100 });
  r.ev('pointermove', { clientX: 60, clientY: 100 });
  r.ev('pointerup', { clientX: 60, clientY: 100 });
  assert.notEqual(still.view.lon0, lon);
  assert.equal(still.view.v, 0, 'no momentum with reduced motion');
  assert.equal(r.frames, 0, 'and still no loop');
});

test('pulses: live places pulse from 2 people on now; the loop keeps drawing them', () => {
  const p = page();
  const g = mountGlobe(p.canvas, p.geo, { countries: [{ cc: 'US', visitors: 45, live: true }] }, { ...p.opts, live: 1 });
  // Face the US, then hover so it stops turning; with 1 on now no pulse, so no redraws.
  p.ev('pointerdown', { clientX: 100, clientY: 100 });
  p.ev('pointerup', { clientX: 100, clientY: 100 });
  const quiet = p.draws.stroke;
  p.run(1000);
  assert.equal(p.draws.stroke, quiet, 'idle and no pulse: nothing to redraw');
  g.update({ countries: [{ cc: 'US', visitors: 45, live: true }] }, 3);
  const a = p.draws.stroke;
  p.run(1000);
  assert.ok(p.draws.stroke - a > 25, 'pulsing: it keeps drawing');
  g.stop();
});

test('hover and tap: the label of the dot under the pointer; keys turn it only while it has focus', () => {
  const p = page();
  const g = mountGlobe(p.canvas, p.geo, { countries: [{ cc: 'US', visitors: 45 }], cities: [{ name: 'Tokyo', cc: 'JP', at: [140, 36], visitors: 12 }] }, p.opts);
  assert.equal(p.children.length, 1, 'one label element beside the canvas');
  const us = g.placed.find((x) => x.item.cc === 'US');
  assert.ok(us, 'the globe starts facing the top country');
  p.ev('pointermove', { clientX: us.x, clientY: us.y });
  assert.equal(g.tip, 'United States · 45 this week');
  p.ev('pointerleave', {});
  assert.equal(g.tip, '');
  p.ev('pointerdown', { pointerType: 'touch', clientX: us.x + 3, clientY: us.y });
  p.ev('pointerup', { pointerType: 'touch', clientX: us.x + 3, clientY: us.y });
  assert.equal(g.tip, 'United States · 45 this week', 'a tap shows it too');
  p.ev('pointerdown', { pointerType: 'touch', clientX: 5, clientY: 5 });
  p.ev('pointerup', { pointerType: 'touch', clientX: 5, clientY: 5 });
  assert.equal(g.tip, '', 'a tap elsewhere hides it');
  // Keys: nothing while the command bar (or anything else) has focus.
  const lon = g.view.lon0;
  let prevented = false;
  p.ev('keydown', { key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(g.view.lon0, lon);
  assert.equal(prevented, false, 'the arrow is left alone');
  p.doc.activeElement = p.canvas;
  p.ev('keydown', { key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.ok(near(g.view.lon0, wrapLon(lon + KEY_STEP)));
  assert.equal(prevented, true, 'no page scroll');
  const tilt = g.view.tilt;
  p.ev('keydown', { key: 'ArrowUp' });
  assert.ok(g.view.tilt > tilt);
  p.ev('keydown', { key: 'ArrowLeft', ctrlKey: true });
  assert.ok(near(g.view.lon0, wrapLon(lon + KEY_STEP)), 'with a modifier: not ours');
  g.stop();
  // The page wiring: both screens give the globe its places and the live count.
  for (const f of ['public/screens/sponsor.js', 'public/screens/bbrk.js']) {
    const s = readFileSync(f, 'utf8');
    assert.match(s, /mountGlobe\(canvas, geo, \w+\?\.audience\?\.globe \|\| null, \{ reduceMotion[^}]*live: /, f);
    assert.match(s, /globe\?\.update\(\w+\??\.audience\?\.globe \|\| null, \w+\??\.audience\?\.live \?\? null\)/, f);
  }
});

test('SPONSOR and BBRK: the globe under the numbers, in the first view, centred, square, never cut off', () => {
  // --globe-w: about half the old 640 px, and never taller than 40% of the window.
  assert.match(readFileSync('public/style.css', 'utf8'), /--globe-w: min\(340px, 40vh\);/);
  const css = readFileSync('public/screens/sponsor.css', 'utf8');
  assert.match(css, /\.spon-globe \{[^}]*width: min\(var\(--fit-w, var\(--globe-w\)\), 100%\);[^}]*margin: 0 auto;/, 'the room left, or --globe-w; centred');
  assert.doesNotMatch(css, /spon-top|align-self: stretch/, 'not beside YOUR AD HERE; not page-wide on a phone');
  assert.match(css, /\.spon-globe canvas \{[^}]*aspect-ratio: 1;/, 'always square: never cut in half');
  const bb = readFileSync('public/screens/bbrk.css', 'utf8');
  assert.match(bb, /\.bb-globe \{[^}]*width: min\(var\(--fit-w, var\(--globe-w\)\), 100%\);[^}]*margin: 0 auto;/, 'the room left, or --globe-w; centred');
  // Six facts in one row once BBRK's column is its full 880 px, so the globe fits the first view.
  assert.match(bb, /\.bb-card \{ container-type: inline-size; \}\s*@container \(min-width: 880px\) \{\s*\.bb-card \.card-facts \{ grid-template-columns: repeat\(6, minmax\(0, 1fr\)\); \}/);
  // Both screens fit it on render, on new numbers and on resize.
  for (const f of ['public/screens/sponsor.js', 'public/screens/bbrk.js']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /fitToView\(/, f);
    assert.match(src, /addEventListener\?*\.?\('resize', \w+\)/, `${f}: on resize`);
    assert.match(src, /requestAnimationFrame\(/, `${f}: once a frame`);
    assert.match(src, /removeEventListener\?*\.?\('resize', \w+\)/, `${f}: and let go`);
  }
  assert.match(bb, /\.bb-globe canvas \{[^}]*aspect-ratio: 1;/);
  // Under the numbers: the card's media slot comes after its facts.
  for (const f of ['public/screens/sponsor.js', 'public/screens/bbrk.js']) assert.match(readFileSync(f, 'utf8'), /facts:[\s\S]*media: raw\(/, f);
});

test('globe: the land four times as dense from the shipped grid, crisp and cheap', () => {
  const geo = JSON.parse(readFileSync('public/geo/globe-dots.json', 'utf8'));
  const dense = denseDots(geo.dots, geo.step);
  assert.ok(dense.length > geo.dots.length * 3 && dense.length < geo.dots.length * 4.2, `${dense.length}`);
  const key = (d) => `${d[0]},${d[1]}`;
  const all = new Set(dense.map(key));
  for (const d of geo.dots) assert.ok(all.has(`${d[0]},${d[1]}`), 'every shipped dot is kept');
  // Nothing new in the open sea: every new dot is within one grid step of a shipped one.
  for (const d of dense.slice(0, 4000)) {
    assert.ok(geo.dots.some((o) => Math.abs(o[1] - d[1]) <= geo.step && Math.abs(wrapLon(o[0] - d[0])) * Math.cos((d[1] * Math.PI) / 180) <= geo.step * 1.05), key(d));
  }
  const src = readFileSync('public/globe.js', 'utf8');
  assert.match(src, /Math\.min\(2, win\.devicePixelRatio \|\| 1\)/, 'at most 2 device pixels a CSS pixel');
  assert.match(src, /Math\.round\(ds \* dpr\)/, 'land dots on the device pixel grid');
});

test('house rules in the globe and hint files', () => {
  for (const f of ['public/globe.js', 'public/hints.js', 'scripts/build-cities.js', 'public/screens/sponsor.css', 'public/screens/bbrk.css']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, `${f}: emoji`);
    assert.doesNotMatch(s, /amber|orange|#f5a|#ffa|#ff9/i, `${f}: amber`);
  }
  assert.doesNotMatch(readFileSync('public/globe.js', 'utf8'), /DataFast|datafa\.st|Mapbox/i, 'no vendor names in the page code');
});

test('fitToView: the globe gets the room left above the dock, 220 to 340 px; a phone keeps its own size', async () => {
  const { fitToView } = await import('../public/kit.js');
  const props = {};
  const fig = (top, h = 250, canvasH = 225) => ({
    isConnected: true, offsetHeight: h, getBoundingClientRect: () => ({ top }),
    querySelector: () => ({ offsetHeight: canvasH }),
    style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } },
  });
  const doc = (scrollTop = 0) => ({
    getElementById: () => ({ scrollTop, getBoundingClientRect: () => ({ bottom: 671 }) }),
    querySelector: () => ({ getBoundingClientRect: () => ({ top: 671 }) }),
  });
  const win = (phone = false) => ({ matchMedia: () => ({ matches: phone }), getComputedStyle: () => ({ overflowY: 'auto' }), innerHeight: 730, scrollY: 0 });
  // 671 (the dock) - 400 (its top) - 25 (the caption) - 8 = 238.
  assert.equal(fitToView(fig(400), { win: win(), doc: doc() }), 238);
  assert.equal(props['--fit-w'], '238px');
  // Scrolled down 100: measured as if at the top.
  assert.equal(fitToView(fig(300), { win: win(), doc: doc(100) }), 238);
  assert.equal(fitToView(fig(100), { win: win(), doc: doc() }), 340, 'never bigger than 340');
  assert.equal(fitToView(fig(600), { win: win(), doc: doc() }), 220, 'never smaller than 220');
  assert.equal(fitToView(fig(400), { win: win(true), doc: doc() }), null, 'a phone scrolls instead');
  assert.equal(props['--fit-w'], undefined);
  assert.equal(fitToView(null), null);
});
