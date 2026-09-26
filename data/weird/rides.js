// RIDES: the average posted wait at the big Disney parks right now: Walt Disney World's
// four parks (Magic Kingdom, Epcot, Hollywood Studios, Animal Kingdom) and Disneyland.
// Source: Queue-Times.com, which asks to be credited "Powered by Queue-Times.com".
// Park ids were looked up once in https://queue-times.com/parks.json.

import { NoData, mean } from './source.js';

export const id = 'rides';
export const source = 'Queue-Times.com';
export const credit = 'Powered by Queue-Times.com';
export const ttl = 10 * 60_000;

export const PARKS = [
  { id: 6, name: 'Magic Kingdom', resort: 'Walt Disney World' },
  { id: 5, name: 'Epcot', resort: 'Walt Disney World' },
  { id: 7, name: 'Hollywood Studios', resort: 'Walt Disney World' },
  { id: 8, name: 'Animal Kingdom', resort: 'Walt Disney World' },
  { id: 16, name: 'Disneyland', resort: 'Disneyland Resort' },
];
const url = (parkId) => `https://queue-times.com/parks/${parkId}/queue_times.json`;

// One park's body -> [{ name, open, wait, updated }].
export function parsePark(body) {
  if (!body || (!Array.isArray(body.lands) && !Array.isArray(body.rides))) throw new Error('Queue-Times: unexpected shape');
  const rides = [...(body.lands || []).flatMap((l) => l.rides || []), ...(body.rides || [])];
  return rides.map((r) => ({
    name: String(r.name ?? '').trim(),
    open: r.is_open === true,
    wait: Number.isFinite(Number(r.wait_time)) ? Number(r.wait_time) : null,
    updated: Number.isFinite(Date.parse(r.last_updated)) ? r.last_updated : null,
  })).filter((r) => r.name);
}

// Rides that count: open, with a posted wait above zero (shows and walk-ons post 0).
const counted = (rides) => rides.filter((r) => r.open && r.wait > 0);

export function parkRow(park, rides) {
  const c = counted(rides);
  const open = rides.filter((r) => r.open).length;
  const longest = c.slice().sort((a, b) => b.wait - a.wait)[0] || null;
  return {
    name: park.name,
    resort: park.resort,
    status: open ? 'open' : 'closed',
    openRides: open,
    counted: c.length,
    avg: c.length ? mean(c.map((r) => r.wait)) : null,
    longest: longest ? { name: longest.name, wait: longest.wait } : null,
  };
}

// parks: [{ park, rides } | { park, error }] -> the gauge.
export function build(parks) {
  const ok = parks.filter((p) => p.rides);
  if (!ok.length) throw new Error('Queue-Times: no park answered');
  const rows = parks.map((p) => (p.rides ? parkRow(p.park, p.rides) : { name: p.park.name, resort: p.park.resort, status: 'error' }));
  const waits = ok.flatMap((p) => counted(p.rides).map((r) => r.wait));
  const stamps = ok.flatMap((p) => p.rides.map((r) => r.updated)).filter(Boolean).map((s) => Date.parse(s));
  const openParks = rows.filter((r) => r.status === 'open' && r.counted > 0).length;
  const avg = waits.length ? mean(waits) : null;
  return {
    headline: avg === null ? 'PARKS CLOSED' : `${Math.round(avg)} MIN AVERAGE WAIT`,
    value: avg === null ? null : Math.round(avg), // ALERTS: the headline number and its unit
    unit: 'min',
    line: avg === null ? 'Walt Disney World and Disneyland' : `Disney parks, ${openParks} of ${parks.length} open`,
    spark: null,
    asOf: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    source,
    credit,
    avg,
    rides: waits.length,
    partial: ok.length < parks.length,
    parks: rows,
  };
}

export async function load(get) {
  const parks = await Promise.all(PARKS.map((park) => get.json(url(park.id), { timeout: 15_000 })
    .then((b) => ({ park, rides: parsePark(b) }))
    .catch((err) => ({ park, error: err.message }))));
  return build(parks);
}
