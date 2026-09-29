// The globe's visitor clusters (public/globe-cluster.js): nearby places merge into one
// critter with a count, never two on one another, never more than 40 in a view, the same
// while the globe turns, split again when zooming in; the label; the speed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clusterPlaces, clusterLevel, countText, tierPx, footprint, groupOf, markLive,
  CLUSTER_ZOOMS, CRITTER_CAP, CAPS, capFor, GAP, MIN_SEPS, SPREAD_ZOOM,
} from '../public/globe-cluster.js';
import { clusterText, mountGlobe, ortho } from '../public/globe.js';

const RAD = Math.PI / 180;
const vec = ([lon, lat]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

// visitors in places round ten busy cities, at whole degrees like the server's places.
function synth(visitors, places, seed = 3) {
  let a = seed;
  const r = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  const hubs = [[-74, 41], [-122, 38], [0, 52], [13, 53], [140, 36], [77, 28], [-46, -23], [151, -34], [37, 56], [-99, 25]];
  const out = [];
  for (let i = 0; i < places; i++) {
    const h = hubs[i % hubs.length];
    out.push({ kind: 'city', cc: `C${i % 40}`, name: `Place ${i}`, at: [Math.round(h[0] + (r() - 0.5) * 40), Math.round(h[1] + (r() - 0.5) * 24)], n: 1 });
  }
  let left = visitors - places;
  for (let i = 0; left > 0; i = (i + 1) % places) { const k = Math.min(left, Math.ceil(r() * r() * 60)); out[i].n += k; left -= k; }
  return out;
}
const SETS = [[10, 10], [100, 50], [10_000, 50], [10_000, 500]];
const RS = [110, 164];

test('levels, counts and critter sizes', () => {
  assert.deepEqual(CLUSTER_ZOOMS, [1, 1.5, 2, 3, 4, 5, 6]);
  assert.deepEqual([1, 1.4, 1.5, 1.99, 2, 2.9, 3, 4.5, 5, 5.99, 6].map(clusterLevel), [0, 0, 1, 1, 2, 2, 3, 4, 5, 5, 6]);
  assert.deepEqual([0, 1, 12, 999, 1000, 1234, 9999, 12_345, 999_499, 1_250_000].map(countText),
    ['0', '1', '12', '999', '1k', '1.2k', '10k', '12k', '999k', '1.3M']);
  // 2 px a pixel for 1 to 9 visitors, 3 for 10 to 99, 4 for 100 or more; one step up zoomed in.
  assert.deepEqual([1, 9, 10, 99, 100, 10_000].map((n) => tierPx(n)), [2, 2, 3, 3, 4, 4]);
  assert.deepEqual([1, 9, 10, 99, 100].map((n) => tierPx(n, true)), [3, 3, 4, 4, 5]);
  for (const n of [1, 5, 50, 500, 5000]) {
    const f = footprint(n);
    assert.ok(Number.isInteger(f.px) && f.size === 8 * f.px, 'whole pixels');
    assert.equal(f.lw > 0, n > 1, 'a count under it from 2');
    assert.ok(f.w === Math.max(f.size, f.lw) && f.h === f.size + (f.lw ? 16 : 0), 'narrow: the count under the critter');
  }
});

test('never two clusters on one another, at every level, for 10 to 10,000 visitors in 10 to 500 places', () => {
  for (const [v, pl] of SETS) {
    const items = synth(v, pl);
    for (const R of RS) {
      for (let level = 0; level < CLUSTER_ZOOMS.length; level++) {
        const zoom = CLUSTER_ZOOMS[level];
        const cl = clusterPlaces(items, { R, level });
        assert.equal(cl.reduce((s, c) => s + c.n, 0), v, 'every visitor in one cluster');
        assert.equal(cl.reduce((s, c) => s + c.places.length, 0), pl, 'every place in one cluster');
        for (let i = 0; i < cl.length; i++) {
          for (let j = i + 1; j < cl.length; j++) {
            // px apart near the middle, at the level's smallest zoom: north-south, and
            // east-west along the parallel between them. Their boxes never overlap.
            const [a, b] = [cl[i], cl[j]];
            const d = ang(vec(a.at), vec(b.at)) * R * zoom;
            const dx = Math.abs(((((a.at[0] - b.at[0] + 180) % 360) + 360) % 360) - 180) * RAD * Math.cos(((a.at[1] + b.at[1]) / 2) * RAD) * R * zoom;
            const dy = Math.abs(a.at[1] - b.at[1]) * RAD * R * zoom;
            assert.ok(dx >= (a.w + b.w) / 2 + GAP - 1e-6 || dy >= (a.h + b.h) / 2 + GAP - 1e-6, `${v}/${pl} R${R} level ${level}: ${a.key} and ${b.key} ${dx.toFixed(1)}, ${dy.toFixed(1)} px apart`);
            assert.ok(d >= MIN_SEPS[level] * R - 1e-6, 'and never closer than MIN_SEPS of the globe (the cap)');
          }
        }
        // And on screen, for a few ways the globe can face: the boxes never overlap near
        // the middle (globe.js hides the smaller of two that touch near the rim).
        for (const [lon0, tilt] of [[0, 20], [-90, 40], [120, 10]]) {
          const boxes = [];
          for (const c of cl) {
            const [x, y, z] = ortho(c.at[0], c.at[1], lon0, tilt);
            if (z < 0.9) continue; // within 25 degrees of the middle
            const f = c.spread > 1 ? groupOf(c.spread, zoom >= 2) : footprint(c.n, zoom >= 2);
            boxes.push([x * R * zoom - f.w / 2, y * R * zoom - f.h / 2, f.w, f.h]);
          }
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              const [a, b] = [boxes[i], boxes[j]];
              assert.ok(!(a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]), `boxes ${a} ${b}`);
            }
          }
        }
      }
    }
  }
});

test('the cap: 15 critters in a view at 1x, 25 at 2x, 40 from 3x, never more than 40', () => {
  assert.deepEqual(CAPS, [15, 20, 25, 40, 40, 40, 40]);
  assert.ok(CAPS.every((c) => c <= CRITTER_CAP));
  assert.deepEqual([1, 2, 3, 6].map((z) => capFor(clusterLevel(z))), [15, 25, 40, 40]);
  for (const [v, pl] of SETS) {
    const items = synth(v, pl);
    for (const R of RS) {
      for (let level = 0; level < CLUSTER_ZOOMS.length; level++) {
        const cl = clusterPlaces(items, { R, level });
        const lens = Math.asin(Math.min(1, 1 / CLUSTER_ZOOMS[level]));
        for (const a of cl) {
          const inView = cl.filter((b) => ang(vec(a.at), vec(b.at)) <= lens).reduce((s, b) => s + b.spread, 0);
          assert.ok(inView <= capFor(level), `${v}/${pl} level ${level}: ${inView}`);
        }
      }
    }
  }
});

test('low traffic at 1x: a critter for each part of the world, the US west, middle and east', () => {
  // About 60 visitors in 12 places, like the live site: US west, middle, east; Europe; Asia.
  const k = (name, cc, at, n) => ({ kind: 'city', cc, name, at, n });
  const live = [
    k('Boardman', 'US', [-120, 46], 18), { kind: 'country', cc: 'US', at: [-99, 39], n: 9, part: true }, k('Council Bluffs', 'US', [-96, 41], 3),
    k('Ashburn', 'US', [-77, 39], 5), k('New York', 'US', [-74, 41], 4), k('London', 'GB', [0, 52], 5), k('Paris', 'FR', [2, 49], 3),
    k('Berlin', 'DE', [13, 53], 3), k('Tokyo', 'JP', [140, 36], 4), k('Yokohama', 'JP', [140, 35], 3), k('Singapore', 'SG', [104, 1], 3),
    k('Sydney', 'AU', [151, -34], 3),
  ];
  assert.equal(live.reduce((s, x) => s + x.n, 0), 63);
  for (const R of [107, 164]) { // the 226 px globe of a 1536x730 screen, and the 340 px one
    const cl = clusterPlaces(live, { R, level: 0 });
    assert.ok(cl.length >= 5, `R${R}: ${cl.length} critters at 1x`);
    const us = cl.filter((c) => c.places.some((p) => p.cc === 'US'));
    const west = us.find((c) => c.places.some((p) => p.name === 'Boardman'));
    const east = us.find((c) => c.places.some((p) => p.name === 'Ashburn'));
    const middle = us.find((c) => c.places.some((p) => p.cc === 'US' && p.kind === 'country'));
    const shape = us.map((c) => c.places.map((p) => p.name || p.cc).join('+')).join(' | ');
    assert.ok(west !== east && middle !== east, `R${R}: the east apart: ${shape}`);
    // On the 340 px globe the west, the middle and the east each have their own critter.
    // On the 226 px one the west and the rest of the US (21 degrees apart, two 24 px
    // critters) are one; with today's live counts (below) the US is still 3 critters,
    // Council Bluffs in the middle.
    if (R >= 164) assert.ok(west !== middle, `R${R}: west and middle apart: ${shape}`);
  }
  // The live site's own shape (Sep 29): Boardman, the rest of the US, Council Bluffs, Ashburn.
  const today = [k('Boardman', 'US', [-120, 46], 38), { kind: 'country', cc: 'US', at: [-99, 39], n: 15, part: true }, k('Ashburn', 'US', [-77, 39], 3), k('Council Bluffs', 'US', [-96, 41], 3)];
  for (const R of [107, 164]) assert.ok(clusterPlaces(today, { R, level: 0 }).length >= 3, `R${R}: not one critter over the whole US`);
});

test('zooming in splits clusters; far enough in, lone places, and a small one may show every visitor', () => {
  const items = synth(10_000, 500);
  let last = 0;
  for (let level = 0; level < CLUSTER_ZOOMS.length; level++) {
    const n = clusterPlaces(items, { R: 164, level }).length;
    assert.ok(n >= last, `level ${level}: ${n} clusters (was ${last})`);
    last = n;
  }
  assert.ok(clusterPlaces(items, { R: 164, level: 0 }).length < 40 && last > 100, 'from a few big ones to many small ones');
  // Places apart: at 6x each is its own cluster; Tokyo and Yokohama (a degree apart)
  // stay one, so their critters never touch.
  const apart = [
    { kind: 'city', cc: 'GB', name: 'London', at: [0, 52], n: 40 }, { kind: 'city', cc: 'ES', name: 'Madrid', at: [-4, 40], n: 30 },
    { kind: 'city', cc: 'DE', name: 'Berlin', at: [13, 53], n: 4 }, { kind: 'city', cc: 'JP', name: 'Tokyo', at: [140, 36], n: 9 },
    { kind: 'city', cc: 'JP', name: 'Yokohama', at: [140, 35], n: 3 },
  ];
  const at1 = clusterPlaces(apart, { R: 164, level: 0 });
  assert.deepEqual(at1.map((c) => c.places.map((k) => k.name)), [['London', 'Madrid', 'Berlin'], ['Tokyo', 'Yokohama']]);
  assert.equal(at1[0].name, 'London', 'named after its biggest place, and sits there');
  assert.deepEqual(at1[0].at, [0, 52]);
  const at6 = clusterPlaces(apart, { R: 164, level: 6 });
  assert.deepEqual(at6.map((c) => c.places.map((k) => k.name).join('+')).sort(), ['Berlin', 'London', 'Madrid', 'Tokyo+Yokohama']);
  // Berlin (4 visitors, alone, room round it): one critter per visitor, from SPREAD_ZOOM.
  assert.equal(at6.find((c) => c.name === 'Berlin').spread, 4);
  assert.equal(at6.find((c) => c.name === 'London').spread, 1, '40 is one critter with its count');
  assert.equal(clusterPlaces(apart, { R: 164, level: clusterLevel(SPREAD_ZOOM) - 1 }).find((c) => c.name === 'Berlin').spread, 1, 'not before');
  // A small place with a neighbour too close for its group: one critter and its count.
  const tight = [{ kind: 'city', cc: 'DE', name: 'Berlin', at: [13, 53], n: 4 }, { kind: 'city', cc: 'PL', name: 'Poznan', at: [17, 53], n: 30 }];
  const t6 = clusterPlaces(tight, { R: 164, level: 6 });
  assert.equal(t6.length, 2);
  assert.equal(t6.find((c) => c.name === 'Berlin').spread, 1);
});

test('the same clusters however the globe is turned (made on the sphere, once per level)', () => {
  const heavy = synth(10_000, 500);
  const globe = { countries: [], cities: heavy.map((k) => ({ name: k.name, cc: k.cc, at: k.at, visitors: k.n })) };
  const geo = JSON.parse(readFileSync('public/geo/globe-dots.json', 'utf8'));
  const listeners = {};
  let t = 0;
  const canvas = {
    width: 0, height: 0, getContext: () => new Proxy({}, { get: (o, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true }),
    getBoundingClientRect: () => ({ width: 300, left: 0, top: 0 }), addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener() {}, setAttribute() {},
  };
  const doc = { hidden: false, activeElement: canvas, addEventListener() {}, removeEventListener() {} };
  const win = { getComputedStyle: () => ({ getPropertyValue: () => '' }), devicePixelRatio: 1, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  const g = mountGlobe(canvas, geo, globe, { reduceMotion: true, win, doc, now: () => t, world: () => new Promise(() => {}) });
  const seen = (placed) => new Map(placed.map((p) => [p.item.key, p.item.places.map((k) => k.name).sort().join('|')]));
  const a = seen(g.placed);
  const first = g.placed[0]?.item;
  for (let i = 0; i < 2; i++) listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  const b = seen(g.placed);
  let both = 0;
  for (const [k, v] of a) if (b.has(k)) { both += 1; assert.equal(b.get(k), v, `${k}: the same places`); }
  assert.ok(both >= 3, `${both} clusters in both views`);
  // Made once per level: the same cluster objects frame after frame.
  listeners.keydown({ key: 'ArrowLeft', preventDefault() {} });
  listeners.keydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(g.placed.find((p) => p.item.key === first.key)?.item, first, 'cached, not made again');
  g.stop();
});

test('the label: one place, two, or two and how many more', () => {
  const names = { US: 'United States of America', JP: 'Japan' };
  const k = (name, n, extra = {}) => ({ kind: 'city', cc: 'JP', name, n, at: [0, 0], ...extra });
  assert.equal(clusterText({ n: 12, places: [k('Tokyo', 12)] }, names), 'Tokyo · 12 visitors this week');
  assert.equal(clusterText({ n: 1, places: [k('Oslo', 1)] }, names), 'Oslo · 1 visitor this week');
  assert.equal(clusterText({ n: 14, places: [k('Tokyo', 9), k('Osaka', 5)] }, names), 'Tokyo, Osaka · 14 visitors this week');
  assert.equal(clusterText({ n: 20, places: [k('Tokyo', 9), k('Osaka', 5), k('Kyoto', 4), k('Nara', 2)] }, names), 'Tokyo, Osaka and 2 more places · 20 visitors this week');
  assert.equal(clusterText({ n: 17, places: [k('Tokyo', 9), k('Osaka', 5), k('Kyoto', 3)] }, names), 'Tokyo, Osaka and 1 more place · 17 visitors this week');
  const us = { kind: 'country', cc: 'US', n: 15, part: true, at: [0, 0] };
  assert.equal(clusterText({ n: 15, places: [us] }, names), 'United States, elsewhere · 15 visitors this week');
  assert.equal(clusterText({ n: 1515, places: [k('Boardman', 1500, { cc: 'US' }), us] }, names), 'Boardman, United States · 1,515 visitors this week');
  assert.equal(clusterText({ n: 0, places: [] }), '');
});

test('someone on now: the cluster with them in it; a live country with no visitors of its own marks its cities\' cluster', () => {
  const items = [
    { kind: 'city', cc: 'JP', name: 'Tokyo', at: [140, 36], n: 9 },
    { kind: 'city', cc: 'JP', name: 'Yokohama', at: [140, 35], n: 3, live: true },
    { kind: 'city', cc: 'US', name: 'Boardman', at: [-120, 46], n: 38 },
    { kind: 'country', cc: 'US', at: [-99, 39], n: 0, live: true },
  ];
  const cl = markLive(clusterPlaces(items, { R: 164, level: 0 }), items);
  assert.equal(cl.find((c) => c.name === 'Tokyo').live, true);
  assert.equal(cl.find((c) => c.name === 'Boardman').live, true);
  assert.equal(cl.length, 2, 'a place with no visitors is no cluster');
});

test('fast: 10,000 visitors in 500 places, under 20 ms a level', () => {
  const items = synth(10_000, 500, 11);
  clusterPlaces(items, { R: 164, level: 3 }); // warm up
  for (const R of RS) {
    for (let level = 0; level < CLUSTER_ZOOMS.length; level++) {
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        clusterPlaces(items, { R, level });
        runs.push(performance.now() - t0);
      }
      const ms = runs.sort((a, b) => a - b)[1]; // the middle of three (a busy test box)
      assert.ok(ms < 20, `R${R} level ${level}: ${ms.toFixed(1)} ms`);
    }
  }
});
