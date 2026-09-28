// Builds data/cities.json, the city table the server uses to put a DataFast city name on
// the globe (lib/datafast.js). From Natural Earth's 10m populated places (public domain,
// naturalearthdata.com), downloaded once by hand; the source file is not kept here:
//
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson
//   node scripts/build-cities.js ne_10m_populated_places_simple.geojson
//
// Each row: [name, country code, lat, lon, population in thousands, other names...].
// lat and lon are already rounded to whole degrees (about 100 km), so the server never
// holds a finer place than it may show. Server only: data/ is never sent to a browser.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, '..', 'data', 'cities.json');

// Places the 10m table leaves out that analytics services often report (large suburbs and
// data-centre towns), by hand from their public coordinates: [name, cc, lat, lon, popK].
export const EXTRA = [
  ['Ashburn', 'US', 39.04, -77.49, 43],
  ['Boardman', 'US', 45.84, -119.7, 4],
  ['Kawaguchi', 'JP', 35.81, 139.72, 578],
  ['Council Bluffs', 'US', 41.26, -95.86, 62],
  ['The Dalles', 'US', 45.6, -121.18, 16],
  ['Frankfurt am Main', 'DE', 50.11, 8.68, 760],
];

export const snap = (deg) => Math.round(deg);

export function build(geojson) {
  const rows = [];
  for (const f of geojson.features || []) {
    const p = f.properties || {};
    if (!/^[A-Z]{2}$/.test(p.iso_a2 || '') || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;
    const alt = String(p.namealt || '').split(/\s*[|,]\s*/).filter(Boolean);
    const names = [...new Set([p.nameascii, ...alt].filter((n) => n && n !== p.name))];
    rows.push([p.name, p.iso_a2, snap(p.latitude), snap(p.longitude), Math.max(0, Math.round((p.pop_max || 0) / 1000)), ...names]);
  }
  for (const [name, cc, lat, lon, pop] of EXTRA) rows.push([name, cc, snap(lat), snap(lon), pop]);
  rows.sort((a, b) => b[4] - a[4] || a[0].localeCompare(b[0]));
  return { source: 'Natural Earth 10m populated places (public domain), rounded to whole degrees', cities: rows };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const src = process.argv[2];
  if (!src) { console.error('usage: node scripts/build-cities.js <ne_10m_populated_places_simple.geojson>'); process.exit(1); }
  const out = build(JSON.parse(readFileSync(src, 'utf8')));
  writeFileSync(OUT, `${JSON.stringify(out).replace(/\],\[/g, '],\n[')}\n`);
  console.log(`${out.cities.length} places -> ${path.relative(process.cwd(), OUT)}`);
}
