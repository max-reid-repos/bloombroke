// WAFFLE: how many Waffle House restaurants sit inside an active tropical storm's
// wind field right now.
// Storms: National Hurricane Center CurrentStorms.json. Wind field: the tropical-storm-
// force (34 knot) wind radii in each storm's latest forecast advisory, one radius per
// quadrant (NE, SE, SW, NW). No radii published (a depression, or the advisory would
// not load): a fixed FALLBACK_MILES circle, and the screen says so.
// Stores: a one-time OpenStreetMap snapshot in waffle-houses.json (ODbL).

import { readFileSync } from 'node:fs';

export const id = 'waffle';
export const source = 'NHC';
export const ttl = 30 * 60_000;

const STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const SNAPSHOT = JSON.parse(readFileSync(new URL('./waffle-houses.json', import.meta.url), 'utf8'));
export const STORES = SNAPSHOT.stores;
export const STORES_META = { count: SNAPSHOT.count, fetched: SNAPSHOT.fetched, credit: SNAPSHOT.credit };

export const FALLBACK_MILES = 50;
// A storm further than this from every store cannot reach one (the widest 34 kt radii
// are about 600 miles), so its advisory is not fetched.
export const FAR_MILES = 800;
const NM_TO_MI = 1.150779;
const EARTH_MI = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

// Great-circle distance in miles.
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Initial bearing from point 1 to point 2, degrees clockwise from north (0 to 360).
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function quadrantOf(deg) {
  if (deg < 90) return 'NE';
  if (deg < 180) return 'SE';
  if (deg < 270) return 'SW';
  return 'NW';
}

// Forecast advisory text -> the current 34 kt radii in miles, { NE, SE, SW, NW }, or
// null when the advisory has none (the storm has no tropical-storm-force winds).
// Only the block before "REPEAT...CENTER" or the first "FORECAST VALID" counts: later
// 34 KT lines are forecasts.
export function parseRadii(text) {
  const t = String(text ?? '');
  const start = t.search(/MAX SUSTAINED WINDS/);
  if (start < 0) return null;
  const endM = t.slice(start).search(/REPEAT\.\.\.CENTER|FORECAST VALID/);
  const block = endM < 0 ? t.slice(start) : t.slice(start, start + endM);
  const m = /^\s*34 KT\.+\s*(\d+)NE\s+(\d+)SE\s+(\d+)SW\s+(\d+)NW/m.exec(block);
  if (!m) return null;
  const [NE, SE, SW, NW] = m.slice(1, 5).map((n) => Math.round(Number(n) * NM_TO_MI));
  return { NE, SE, SW, NW };
}

// NHC CurrentStorms.json -> [{ id, name, kind, windKt, lat, lon, updated, advisoryUrl }].
export function parseStorms(body) {
  if (!body || !Array.isArray(body.activeStorms)) throw new Error('NHC: unexpected shape');
  return body.activeStorms
    .map((s) => ({
      id: String(s.id || ''),
      name: String(s.name || 'Unnamed').slice(0, 40),
      kind: String(s.classification || ''),
      windKt: Number.isFinite(Number(s.intensity)) ? Number(s.intensity) : null,
      lat: Number(s.latitudeNumeric),
      lon: Number(s.longitudeNumeric),
      updated: s.lastUpdate || null,
      advisoryUrl: typeof s.forecastAdvisory?.url === 'string' ? s.forecastAdvisory.url : null,
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

// Stores inside one storm's wind field. radii: { NE, SE, SW, NW } in miles, or a number.
export function storesInside(storm, radii, stores = STORES) {
  let n = 0;
  for (const [lat, lon] of stores) {
    const d = haversine(storm.lat, storm.lon, lat, lon);
    const r = typeof radii === 'number' ? radii : radii[quadrantOf(bearing(storm.lat, storm.lon, lat, lon))];
    if (d <= r) n += 1;
  }
  return n;
}

export function nearestStore(storm, stores = STORES) {
  let best = Infinity;
  for (const [lat, lon] of stores) best = Math.min(best, haversine(storm.lat, storm.lon, lat, lon));
  return best;
}

// One storm -> its row. fetchAdvisory(url) gives the advisory text (or throws).
export async function stormRow(storm, fetchAdvisory, stores = STORES) {
  const nearest = nearestStore(storm, stores);
  if (nearest > FAR_MILES) return { ...storm, nearest: Math.round(nearest), radius: null, radiusFrom: 'far', stores: 0 };
  let radii = null;
  let from = 'fixed';
  if (storm.advisoryUrl) {
    try {
      radii = parseRadii(await fetchAdvisory(storm.advisoryUrl));
      if (radii) from = 'nhc';
    } catch { /* fall back to the fixed circle */ }
  }
  const use = radii || FALLBACK_MILES;
  const radius = typeof use === 'number' ? use : Math.max(use.NE, use.SE, use.SW, use.NW);
  return { ...storm, nearest: Math.round(nearest), radius, radii, radiusFrom: from, stores: storesInside(storm, use, stores) };
}

export function build(rows, fetchedAt) {
  const total = rows.reduce((a, r) => a + r.stores, 0);
  const updated = rows.map((r) => r.updated).filter(Boolean).sort().pop() || fetchedAt;
  return {
    headline: `${total} ${total === 1 ? 'STORE' : 'STORES'} IN STORMS`,
    line: 'Waffle Houses inside storm winds',
    spark: null,
    asOf: updated,
    source,
    credit: STORES_META.credit,
    total,
    storms: rows,
    snapshot: STORES_META,
    fallbackMiles: FALLBACK_MILES,
  };
}

export async function load(get, { now = Date.now } = {}) {
  const storms = parseStorms(await get.json(STORMS_URL));
  const rows = await Promise.all(storms.map((s) => stormRow(s, (url) => get.text(url))));
  return build(rows, new Date(now()).toISOString());
}
