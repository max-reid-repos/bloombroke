// WAFFLE: how many Waffle House restaurants sit inside an active tropical storm's
// wind field right now.
// Storms: National Hurricane Center CurrentStorms.json. Wind field: the tropical-storm-
// force (34 knot) wind radii in each storm's latest forecast advisory, one radius per
// quadrant (NE, SE, SW, NW). An advisory with no 34 kt radii (a depression) counts 0.
// An advisory that will not load leaves that storm unknown: no guessed radius. If no
// storm near a store could be counted, the gauge is NO DATA; if some could, it is
// marked partial.
// Stores: a one-time OpenStreetMap snapshot in waffle-houses.json (ODbL).

import { readFileSync } from 'node:fs';
import { NoData } from './source.js';

export const id = 'waffle';
export const source = 'NHC';
export const ttl = 30 * 60_000;

const STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const SNAPSHOT = JSON.parse(readFileSync(new URL('./waffle-houses.json', import.meta.url), 'utf8'));
export const STORES = SNAPSHOT.stores;
export const STORES_META = { count: SNAPSHOT.count, fetched: SNAPSHOT.fetched, credit: SNAPSHOT.credit };

// Advisories are only fetched from the NHC site itself.
export const ADVISORY_HOST = 'www.nhc.noaa.gov';
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

export function advisoryAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === ADVISORY_HOST;
  } catch {
    return false;
  }
}

// One storm -> its row. fetchAdvisory(url) gives the advisory text (or throws).
// radiusFrom: 'far' (no store in reach), 'nhc' (34 kt radii), 'none' (no 34 kt winds),
// 'error' (the advisory would not load: stores is null, never a guess).
export async function stormRow(storm, fetchAdvisory, stores = STORES) {
  const nearest = Math.round(nearestStore(storm, stores));
  if (nearest > FAR_MILES) return { ...storm, nearest, radius: null, radiusFrom: 'far', stores: 0 };
  let text;
  try {
    if (!advisoryAllowed(storm.advisoryUrl)) throw new Error('no NHC advisory link');
    text = await fetchAdvisory(storm.advisoryUrl);
  } catch {
    return { ...storm, nearest, radius: null, radiusFrom: 'error', stores: null };
  }
  const radii = parseRadii(text);
  if (!radii) return { ...storm, nearest, radius: 0, radiusFrom: 'none', stores: 0 };
  const radius = Math.max(radii.NE, radii.SE, radii.SW, radii.NW);
  return { ...storm, nearest, radius, radii, radiusFrom: 'nhc', stores: storesInside(storm, radii, stores) };
}

export function build(rows, fetchedAt) {
  const failed = rows.filter((r) => r.radiusFrom === 'error');
  const counted = rows.filter((r) => r.radiusFrom !== 'error' && r.radiusFrom !== 'far');
  if (failed.length && !counted.length) throw new NoData('NHC: advisory for a nearby storm would not load');
  const total = rows.reduce((a, r) => a + (r.stores || 0), 0);
  const updated = rows.map((r) => r.updated).filter(Boolean).sort().pop() || fetchedAt;
  const partial = failed.length > 0;
  return {
    headline: `${total} ${total === 1 ? 'STORE' : 'STORES'} IN STORMS${partial ? ' (PARTIAL)' : ''}`,
    line: partial ? 'Partial: an NHC advisory did not load' : 'Waffle Houses inside storm winds',
    spark: null,
    asOf: updated,
    source,
    credit: STORES_META.credit,
    total,
    partial,
    storms: rows,
    snapshot: STORES_META,
  };
}

export async function load(get, { now = Date.now } = {}) {
  const storms = parseStorms(await get.json(STORMS_URL));
  const rows = await Promise.all(storms.map((s) => stormRow(s, (url) => get.text(url))));
  return build(rows, new Date(now()).toISOString());
}
