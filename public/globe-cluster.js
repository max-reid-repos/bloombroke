// Visitor clusters for the BBRK globe (public/globe.js), map style: nearby places merge
// into one critter with a count, so the critters never cover the map, and zooming in
// splits them again.
//
// Clusters are made on the sphere (angles between places), not on the screen, so they
// stay the same while the globe turns; they are made once per zoom level (CLUSTER_ZOOMS)
// and globe size, never per frame. Two clusters are always far enough apart that their
// boxes (critter and count label, north up, with MARGIN to spare for the globe's tilt)
// cannot overlap at the level's smallest zoom near the middle of the globe; near the
// rim, where the sphere squeezes them, globe.js hides the smaller of two that touch.
// A level's clusters are also at least MIN_SEPS of the globe's radius apart, and one view
// never holds more than its CAPS critters (15 at 1x, up to CRITTER_CAP from 3x): when a
// level would put more in a lens, it is made again with more room between clusters.
// Pure: node:test imports it.

import { spotsFor } from './globe-sprites.js';

const RAD = Math.PI / 180;

export const CLUSTER_ZOOMS = [1, 1.5, 2, 3, 4, 5, 6]; // a level each; the last is ZOOM_MAX
export const CRITTER_CAP = 40; // critters in one view, at most, at any zoom
export const CAPS = [15, 20, 25, 40, 40, 40, 40]; // ... and at each level
export const MIN_SEPS = [0.18, 0.16, 0.14, 0.12, 0.11, 0.1, 0.1]; // clusters' centres at least this many globe radii apart
export const capFor = (level) => CAPS[Math.max(0, Math.min(CAPS.length - 1, level))];
export const SPREAD_ZOOM = 5; // from here a place of 2 to SPREAD_MAX visitors may show them all
export const SPREAD_MAX = 9;
export const GAP = 3; // px between two clusters' boxes
export const MARGIN = 1.1; // boxes count this much bigger when clusters are made
export const LABEL_CH = 7; // px a character of the count label (11 px monospace), and 4 of padding
export const LABEL_H = 14;

// The level of a zoom: the last CLUSTER_ZOOMS step at or under it.
export function clusterLevel(zoom) {
  let l = 0;
  for (let i = 1; i < CLUSTER_ZOOMS.length; i++) if (zoom >= CLUSTER_ZOOMS[i] - 1e-9) l = i;
  return l;
}

// The count under a critter: 12, 999, 1.2k, 12k, 1.2M.
export function countText(n) {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

// CSS px a critter pixel: 2 for 1 to 9 visitors, 3 for 10 to 99, 4 for 100 or more; one
// step bigger zoomed in (from 2x). Whole pixels, so the critters stay crisp.
export const tierPx = (n, zoomed = false) => (n >= 100 ? 4 : n >= 10 ? 3 : 2) + (zoomed ? 1 : 0);

// What a cluster of n takes on the screen: its critter (size px square, pixel px), the
// count label just under it (lw px wide, none for 1), and the box of both, w by h,
// centred on the place; r the box's half diagonal. Under, not beside: the box stays
// narrow, so places east and west of each other (most of them) keep their own critters.
export function footprint(n, zoomed = false) {
  const px = tierPx(n, zoomed);
  const size = 8 * px;
  const lw = n > 1 ? countText(n).length * LABEL_CH + 4 : 0;
  const w = Math.max(size, lw);
  const h = size + (lw ? 2 + LABEL_H : 0);
  return { px, size, lw, w, h, r: Math.hypot(w, h) / 2 };
}

// A tight group of n critters of one place (spotsFor): its spots and its box.
export function groupOf(n, zoomed = true) {
  const px = tierPx(1, zoomed);
  const size = 8 * px;
  const pitch = size + px;
  const spots = spotsFor(n);
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const [x, y] of spots) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const w = (x1 - x0) * pitch + size;
  const h = (y1 - y0) * pitch + size;
  // Centred on the place: the spots' middle moves to 0, 0.
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return { px, size, pitch, w, h, r: Math.hypot(w, h) / 2, spots: spots.map(([x, y]) => [(x - mx) * pitch, (y - my) * pitch]) };
}

const vec = ([lon, lat]) => {
  const cp = Math.cos(lat * RAD);
  return [cp * Math.cos(lon * RAD), cp * Math.sin(lon * RAD), Math.sin(lat * RAD)];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const keyOf = (k) => `${k.kind}:${k.cc}:${k.name || ''}`;
const wrap = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

// How close two clusters are, 1 or more when they have room: their boxes (fa, fb: w, h
// px), north up and MARGIN bigger, must not overlap on the screen, px per radian perRad
// (near the middle: east-west the distance along the parallel between them), and their
// middles must be at least minD radians apart (the cap). Under 1: they touch; smaller,
// closer.
function touch(a, b, fa, fb, minD, perRad) {
  const lonA = a.ll[0];
  const latA = a.ll[1];
  const lonB = b.ll[0];
  const latB = b.ll[1];
  // Far apart (the common case): no need to look closer.
  const reach = Math.max(minD, (Math.max(fa.w + fb.w, fa.h + fb.h) * MARGIN + 2 * GAP) / perRad) * 1.5;
  const dLat = Math.abs(latA - latB) * RAD;
  if (dLat > reach) return Infinity;
  const dLon = Math.abs(wrap(lonA - lonB)) * RAD * Math.cos(((latA + latB) / 2) * RAD);
  if (dLon > reach) return Infinity;
  const d = angle(a.v, b.v);
  const qx = (dLon * perRad) / (((fa.w + fb.w) / 2) * MARGIN + GAP);
  const qy = (dLat * perRad) / (((fa.h + fb.h) / 2) * MARGIN + GAP);
  return Math.min(Math.max(qx, qy), d / minD);
}

// The places (globe.js globeItems: { kind, cc, name?, at, n, part?, live? }) in clusters
// for one level, on a globe of radius R px:
// [{ key, kind, cc, name, part, at, n, live, places, spread, r }], biggest first. A
// cluster sits at its biggest place and is named after it; places: its places, biggest
// first; spread: how many critters it shows (1, or a small place's every visitor).
export function clusterPlaces(items, { R, level }) {
  const zoom = CLUSTER_ZOOMS[Math.max(0, Math.min(CLUSTER_ZOOMS.length - 1, level))];
  const zoomed = zoom >= 2;
  const perRad = R * zoom; // px per radian of the sphere, near the middle
  const lens = Math.asin(Math.min(1, 1 / zoom)); // the angle a view reaches from its middle
  const list = (Array.isArray(items) ? items : [])
    .filter((k) => k && k.n > 0 && Array.isArray(k.at))
    .map((k) => ({ k, v: vec(k.at), ll: k.at, key: keyOf(k) }))
    .sort((a, b) => b.k.n - a.k.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (!(R > 0) || !list.length) return [];
  const sizes = new Map();
  const fOf = (n) => { let f = sizes.get(n); if (!f) { f = footprint(n, zoomed); sizes.set(n, f); } return f; };
  const cap = capFor(level);
  let sep = MIN_SEPS[Math.max(0, Math.min(MIN_SEPS.length - 1, level))];
  let out = [];
  for (let round = 0; round < 12; round++) {
    const minD = (sep * R) / perRad; // radians
    // How far north or south (degrees) two clusters of these sizes can touch from.
    const reachDeg = (fa, fb) => Math.max(minD, (Math.max(fa.w + fb.w, fa.h + fb.h) * MARGIN + 2 * GAP) / perRad) * 1.5 / RAD;
    let maxF = { w: 0, h: 0 };
    const grow = (f) => { if (f.w > maxF.w || f.h > maxF.h) maxF = { w: Math.max(maxF.w, f.w), h: Math.max(maxF.h, f.h) }; };
    // The clusters by latitude, so each looks only at the ones within reach.
    const byLat = [];
    const firstAt = (lat) => {
      let a = 0;
      let b = byLat.length;
      while (a < b) { const m = (a + b) >> 1; if (byLat[m].ll[1] < lat) a = m + 1; else b = m; }
      return a;
    };
    const cl = [];
    for (const p of list) {
      const fp = fOf(p.k.n);
      const far = reachDeg(maxF, fp);
      let best = null;
      let score = Infinity;
      for (let i = firstAt(p.ll[1] - far); i < byLat.length && byLat[i].ll[1] <= p.ll[1] + far; i++) {
        const c = byLat[i];
        const q = touch(c, p, c.f, fp, minD, perRad);
        if (q < 1 && q < score) { best = c; score = q; }
      }
      if (best) {
        best.n += p.k.n;
        best.places.push(p.k);
        best.f = fOf(best.n);
        grow(best.f);
      } else {
        const c = { v: p.v, ll: p.k.at, lead: p.k, key: p.key, n: p.k.n, places: [p.k], f: fp, dead: false };
        cl.push(c);
        byLat.splice(firstAt(c.ll[1]), 0, c);
        grow(fp);
      }
    }
    // Merging made some clusters bigger (a bigger critter, a longer count): merge any two
    // that now touch, the smaller into the bigger, until none do.
    for (let changed = true; changed;) {
      changed = false;
      cl.sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
      for (const c of cl) {
        if (c.dead) continue;
        const far = reachDeg(maxF, c.f);
        for (let i = firstAt(c.ll[1] - far); i < byLat.length && byLat[i].ll[1] <= c.ll[1] + far; i++) {
          const o = byLat[i];
          if (o === c || o.dead || o.n > c.n || (o.n === c.n && o.key < c.key)) continue;
          if (touch(c, o, c.f, o.f, minD, perRad) >= 1) continue;
          c.n += o.n;
          c.places.push(...o.places);
          c.f = fOf(c.n);
          grow(c.f);
          o.dead = true;
          changed = true;
        }
      }
      if (changed) {
        for (let i = cl.length - 1; i >= 0; i--) if (cl[i].dead) cl.splice(i, 1);
        for (let i = byLat.length - 1; i >= 0; i--) if (byLat[i].dead) byLat.splice(i, 1);
      }
    }
    // The cap: the most clusters one view can hold (a lens round any cluster).
    let most = 0;
    const cosLens = Math.cos(Math.min(Math.PI, lens + 2 * RAD));
    const lensDeg = (lens + 2 * RAD) / RAD;
    for (const a of cl) {
      let inView = 0;
      for (let i = firstAt(a.ll[1] - lensDeg); i < byLat.length && byLat[i].ll[1] <= a.ll[1] + lensDeg; i++) if (dot(a.v, byLat[i].v) >= cosLens) inView += 1;
      most = Math.max(most, inView);
    }
    out = cl;
    if (most <= cap) break;
    sep *= 1.25;
  }
  // Zoomed in far: a place alone with a few visitors shows them all, in a tight group,
  // when the group has room and the view stays within the cap.
  const minD = (sep * R) / perRad;
  for (const c of out) c.spread = 1;
  if (zoom >= SPREAD_ZOOM) {
    const cosLens = Math.cos(Math.min(Math.PI, lens + 2 * RAD));
    for (const c of out) {
      if (c.places.length !== 1 || c.n < 2 || c.n > SPREAD_MAX) continue;
      const g = groupOf(c.n, zoomed);
      const roomy = out.every((o) => o === c || touch(o, c, o.f, g, minD, perRad) >= 1);
      if (!roomy) continue;
      let inView = 0;
      for (const o of out) if (dot(o.v, c.v) >= cosLens) inView += o === c ? c.n : o.spread;
      if (inView > cap) continue;
      c.spread = c.n;
      c.f = g;
    }
  }
  return out.map((c) => {
    c.places.sort((a, b) => b.n - a.n);
    const { lead } = c;
    return {
      key: c.key, kind: lead.kind, cc: lead.cc, name: lead.name, part: lead.part, at: lead.at,
      n: c.n, live: c.places.some((k) => k.live), places: c.places, spread: c.spread, r: c.f.r, w: c.f.w, h: c.f.h, v: c.v,
    };
  });
}

// A place that is live but has no visitors of its own here (a country whose visitors are
// all in its cities): its cluster pulses too, the one with a place of its country, else
// the nearest within 20 degrees.
export function markLive(clusters, items) {
  for (const k of Array.isArray(items) ? items : []) {
    if (!k?.live || k.n > 0 || !Array.isArray(k.at)) continue;
    let c = clusters.find((x) => x.places.some((p) => p.cc === k.cc));
    if (!c) {
      const v = vec(k.at);
      let best = Math.cos(20 * RAD);
      for (const x of clusters) { const d = dot(x.v, v); if (d >= best) { best = d; c = x; } }
    }
    if (c) c.live = true;
  }
  return clusters;
}
