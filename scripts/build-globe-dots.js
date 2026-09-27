// Builds public/geo/globe-dots.json, the land dots of the BBRK globe (public/globe.js),
// from the WORLDMAP base map public/geo/world-110m.json (Natural Earth 110m admin-0,
// public domain), so the site ships no new map data from outside.
//
//   node scripts/build-globe-dots.js
//
// A grid of points every STEP degrees of latitude (and about STEP degrees of distance
// along each parallel) is projected with the WORLDMAP projection and kept where it falls
// inside a country's outline. Each country also gets a centre: the mean of its points on
// a finer grid. Country level only: no city, no place smaller than a country.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { project, LAT_TOP, LAT_BOTTOM } from '../public/screens/worldmap-geo.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(dir, '..', 'public', 'geo', 'world-110m.json');
const OUT = path.join(dir, '..', 'public', 'geo', 'globe-dots.json');
const STEP = 2.5;
// Countries too small for the 110m map: their centre, and their name.
const EXTRA = {
  SG: ['Singapore', 103.8, 1.35], HK: ['Hong Kong', 114.2, 22.3], MO: ['Macao', 113.55, 22.2],
  MT: ['Malta', 14.4, 35.9], BH: ['Bahrain', 50.55, 26.05], MU: ['Mauritius', 57.55, -20.3],
  BB: ['Barbados', -59.55, 13.15], LI: ['Liechtenstein', 9.55, 47.15], MC: ['Monaco', 7.42, 43.74],
  AD: ['Andorra', 1.55, 42.55], MV: ['Maldives', 73.5, 3.2],
};
const FINE = 0.5;

// 'M1 2l3 4 5 6z...' (absolute M, relative l, z) -> rings of [x, y].
export function rings(d) {
  const out = [];
  let ring = null;
  let x = 0;
  let y = 0;
  let cmd = null;
  const toks = d.match(/[MLmlz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  for (let i = 0; i < toks.length;) {
    const t = toks[i];
    if (/[MLmlz]/.test(t)) {
      cmd = t;
      i += 1;
      if (t === 'z') { if (ring) out.push(ring); ring = null; }
      continue;
    }
    const a = Number(t);
    const b = Number(toks[i + 1]);
    i += 2;
    if (cmd === 'M' || cmd === 'm') {
      if (ring) out.push(ring);
      x = cmd === 'M' ? a : x + a;
      y = cmd === 'M' ? b : y + b;
      ring = [[x, y]];
      cmd = cmd === 'M' ? 'L' : 'l';
    } else {
      x = cmd === 'L' ? a : x + a;
      y = cmd === 'L' ? b : y + b;
      ring?.push([x, y]);
    }
  }
  if (ring) out.push(ring);
  return out;
}

function inside(p, poly) {
  let hit = false;
  for (const r of poly) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

export function build(geo) {
  const shapes = geo.countries.map((c) => {
    const rs = rings(c.d);
    const xs = rs.flat().map((q) => q[0]);
    const ys = rs.flat().map((q) => q[1]);
    return { cc: c.cc, name: c.name, rs, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const find = (lon, lat) => {
    const p = project(lon, lat);
    return shapes.findIndex((s) => p[0] >= s.box[0] && p[0] <= s.box[2] && p[1] >= s.box[1] && p[1] <= s.box[3] && inside(p, s.rs));
  };
  const dots = [];
  for (let lat = LAT_BOTTOM + 1; lat <= LAT_TOP - 1; lat += STEP) {
    const step = STEP / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    for (let lon = -180 + step / 2; lon < 180; lon += step) {
      const i = find(lon, lat);
      if (i >= 0) dots.push([Math.round(lon * 10) / 10, Math.round(lat * 10) / 10, i]);
    }
  }
  // The centre of a country's biggest piece (France without Guiana, the US without Alaska).
  const sum = new Map(); // 'shape:ring' -> [lon sum, lat sum, n]
  for (let lat = LAT_BOTTOM + 0.25; lat <= LAT_TOP; lat += FINE) {
    for (let lon = -180 + FINE / 2; lon < 180; lon += FINE) {
      const i = find(lon, lat);
      if (i < 0) continue;
      const p = project(lon, lat);
      const r = shapes[i].rs.findIndex((ring) => inside(p, [ring]));
      const k = `${i}:${r}`;
      const s = sum.get(k) || [0, 0, 0];
      s[0] += lon; s[1] += lat; s[2] += 1;
      sum.set(k, s);
    }
  }
  const best = new Map();
  for (const [k, s] of sum) { const i = Number(k.split(':')[0]); if (!best.has(i) || best.get(i)[2] < s[2]) best.set(i, s); }
  const centres = Object.fromEntries([...best].map(([i, s]) => [shapes[i].cc, [Math.round((s[0] / s[2]) * 10) / 10, Math.round((s[1] / s[2]) * 10) / 10]]));
  for (const [cc, [name, lon, lat]] of Object.entries(EXTRA)) {
    if (centres[cc]) continue;
    centres[cc] = [lon, lat];
    shapes.push({ cc, name });
  }
  return {
    source: 'Natural Earth 110m admin-0 countries (public domain), via public/geo/world-110m.json',
    step: STEP,
    cc: shapes.map((s) => s.cc),
    names: Object.fromEntries(shapes.map((s) => [s.cc, s.name])),
    centres,
    dots,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = build(JSON.parse(readFileSync(IN, 'utf8')));
  writeFileSync(OUT, `${JSON.stringify(out)}\n`);
  console.log(`${out.dots.length} land dots, ${Object.keys(out.centres).length} country centres -> ${path.relative(process.cwd(), OUT)}`);
}
