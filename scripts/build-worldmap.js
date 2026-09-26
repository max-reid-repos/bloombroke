// Builds public/geo/world-110m.json, the WORLDMAP base map: Natural Earth 110m admin-0
// countries (public domain), projected once with the screen's own projection
// (public/screens/worldmap-geo.js), simplified, and written as compact SVG path data.
//
//   node scripts/build-worldmap.js [geojson path or URL]
//
// With no argument it downloads the official Natural Earth GeoJSON. Only this script
// fetches it; the site never loads anything from outside at run time.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { project, MAP_W, MAP_H, LAT_TOP, LAT_BOTTOM } from '../public/screens/worldmap-geo.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, '..', 'public', 'geo', 'world-110m.json');
const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';

const TOLERANCE = 0.2;  // map units (1000 wide): Douglas-Peucker distance
const MIN_AREA = 0.8;   // map units squared: smaller islands are dropped (never a country's biggest ring)
const Q = 10;           // coordinates kept in tenths of a map unit

// Point-to-segment distance, squared.
function segDist2(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

export function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(points[i], points[a], points[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0 && max > t2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function ringArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return Math.abs(s / 2);
}

const fmt = (n) => {
  const s = (n / Q).toFixed(1).replace(/\.0$/, '');
  return s.replace(/^(-?)0\./, '$1.');
};

// Projected rings -> "M x y l dx dy ... z", tenths, relative moves.
export function ringsToPath(rings) {
  let out = '';
  for (const ring of rings) {
    const pts = ring.map(([x, y]) => [Math.round(x * Q), Math.round(y * Q)]);
    const clean = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    if (clean.length > 1 && clean[0][0] === clean[clean.length - 1][0] && clean[0][1] === clean[clean.length - 1][1]) clean.pop();
    if (clean.length < 3) continue;
    let s = `M${fmt(clean[0][0])} ${fmt(clean[0][1])}l`;
    let nums = [];
    for (let i = 1; i < clean.length; i++) nums.push(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]);
    s += nums.map(fmt).reduce((acc, n, i) => (i === 0 ? n : acc + (n.startsWith('-') ? '' : ' ') + n), '');
    out += `${s}z`;
    nums = null;
  }
  return out;
}

function polygonsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

export function buildMap(geojson) {
  const countries = [];
  for (const f of geojson.features) {
    const p = f.properties || {};
    if (p.ADM0_A3 === 'ATA') continue; // Antarctica: below the map
    const iso = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ADM0_A3;
    const rings = [];
    for (const poly of polygonsOf(f.geometry)) {
      for (const ring of poly) {
        const pts = ring.map(([lon, lat]) => project(Math.max(-180, Math.min(180, lon)), Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat))));
        rings.push(simplify(pts, TOLERANCE));
      }
    }
    if (!rings.length) continue;
    const biggest = Math.max(...rings.map(ringArea));
    const kept = rings.filter((r) => r.length >= 3 && (ringArea(r) >= MIN_AREA || ringArea(r) === biggest));
    const d = ringsToPath(kept);
    if (d) countries.push({ cc: iso, name: p.NAME || p.ADMIN || iso, d });
  }
  countries.sort((a, b) => (a.cc < b.cc ? -1 : 1));
  return {
    source: 'Natural Earth 110m admin-0 countries (public domain), Robinson projection',
    w: MAP_W,
    h: MAP_H,
    countries,
  };
}

async function main() {
  const arg = process.argv[2] || SOURCE;
  const text = /^https?:\/\//.test(arg) ? await (await fetch(arg)).text() : readFileSync(arg, 'utf8');
  const map = buildMap(JSON.parse(text));
  mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(map);
  writeFileSync(OUT, `${json}\n`);
  console.log(`${map.countries.length} countries, ${(json.length / 1024).toFixed(1)} KB -> ${path.relative(process.cwd(), OUT)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
