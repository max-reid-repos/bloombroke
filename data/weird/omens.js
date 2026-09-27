// OMENS: three things people have tried to tie to markets. The moon's phase (worked
// out here, see moon.js), the sky over New York's Central Park (National Weather
// Service station KNYC) and the monthly sunspot number (NOAA Space Weather Prediction
// Center). The moon needs no source, so the gauge shows even when both feeds fail.

import { moonPhase } from './moon.js';
import { histFrom } from './history.js';

export const id = 'omens';
export const source = 'NWS, NOAA SWPC';
export const ttl = 30 * 60_000;
// History: the monthly sunspot number, which SWPC gives in full (since 1749) with every
// fetch. The headline is the moon, which has no record, so there is no record line.
export const defaultPeriod = '10Y';
export const record = false;

const NWS_URL = 'https://api.weather.gov/stations/KNYC/observations/latest';
const SUN_URL = 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json';

// NWS body -> { text, tempC, at } or throws.
export function parseSky(body) {
  const p = body?.properties;
  if (!p) throw new Error('NWS: unexpected shape');
  const text = typeof p.textDescription === 'string' ? p.textDescription.trim() : '';
  const t = p.temperature?.value;
  if (!text && !Number.isFinite(t)) throw new Error('NWS: empty observation');
  return { text: text || null, tempC: Number.isFinite(t) ? t : null, at: p.timestamp || null };
}

// SWPC body -> [{ month: 'YYYY-MM', ssn }] oldest first, observed values only.
export function parseSunspots(body) {
  if (!Array.isArray(body)) throw new Error('SWPC: unexpected shape');
  const rows = body
    .map((r) => ({ month: String(r['time-tag'] || ''), ssn: Number(r.ssn) }))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.month) && Number.isFinite(r.ssn) && r.ssn >= 0);
  if (!rows.length) throw new Error('SWPC: no values');
  return rows;
}

export function build({ moon, sky, sun, now }) {
  const lastSun = sun ? sun[sun.length - 1] : null;
  return {
    headline: moon.name.toUpperCase(),
    line: 'Moon, New York sky, sunspots',
    spark: sun ? sun.slice(-36).map((r) => r.ssn) : null,
    asOf: new Date(now).toISOString(),
    source,
    moon: {
      name: moon.name,
      age: moon.age,
      lit: moon.lit,
      lastNew: new Date(moon.lastNew).toISOString(),
      nextFull: new Date(moon.nextFull).toISOString(),
      nextNew: new Date(moon.nextNew).toISOString(),
    },
    sky,
    sunspots: lastSun ? { month: lastSun.month, ssn: lastSun.ssn, series: sun.slice(-120) } : null,
    ...(sun ? { hist: histFrom(sun.map((r) => ({ d: `${r.month}-01`, ssn: r.ssn })), [{ key: 'ssn', label: 'Sunspot number' }], { step: 'month' }) } : {}),
  };
}

export async function load(get, { now = Date.now } = {}) {
  const t = now();
  const [sky, sun] = await Promise.allSettled([
    get.json(NWS_URL, { accept: 'application/geo+json' }).then(parseSky),
    get.json(SUN_URL).then(parseSunspots),
  ]);
  return build({
    moon: moonPhase(t),
    sky: sky.status === 'fulfilled' ? sky.value : null,
    sun: sun.status === 'fulfilled' ? sun.value : null,
    now: t,
  });
}
