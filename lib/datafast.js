// DataFast Analytics API, read only, on the server: the audience numbers for BBRK and the
// SPONSOR screen. Totals only: DataFast sends back counts and shares, never a visitor.
//
//   Key      DATAFAST_API_KEY, a website-scoped df_ key (DataFast: Website settings ->
//            API). Never logged, never sent to a browser. Missing: every number is null.
//   Base     https://datafa.st/api/v1/  Authorization: Bearer <key>
//   Calls    GET analytics/overview    visitors today; yesterday up to this time; 7 and
//                                      30 days; 30 days: avg_session_duration and the
//                                      new/returning split
//            GET analytics/timeseries  visitors per day, the last 30 days (the sparkline)
//            GET analytics/countries   top 3, last 30 days
//            GET analytics/devices     desktop share, last 30 days
//            GET analytics/referrers   top 3, last 30 days
//            GET analytics/countries   again for the last 7 days, for the BBRK globe
//            GET analytics/realtime    visitors in the last 10 minutes (kept 1 minute)
//   The globe gets country totals only: a country with fewer than GLOBE_MIN visitors, or
//   one not on our map, folds into "other". Never a city, never coordinates.
//   Days are New York days (timezone=America/New_York). Each call times out after
//   TIMEOUT_MS; a failed call leaves only its own numbers null. The answer is kept 5
//   minutes, and a slow refresh never holds up a page: it gets the last answer.

import { readFileSync } from 'node:fs';
import { nyDay, dayBefore } from './counters.js';

const GEO = JSON.parse(readFileSync(new URL('../public/geo/globe-dots.json', import.meta.url), 'utf8'));
export const GLOBE_MIN = 3;
export const LIVE_TTL_MS = 60_000;
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const ALIASES = {
  'united states': 'US', usa: 'US', 'united states of america': 'US', uk: 'GB', 'great britain': 'GB',
  'czech republic': 'CZ', 'bosnia and herzegovina': 'BA', 'ivory coast': 'CI', 'cote d ivoire': 'CI',
  'democratic republic of the congo': 'CD', 'congo kinshasa': 'CD', 'dr congo': 'CD', 'republic of the congo': 'CG',
  'congo brazzaville': 'CG', macedonia: 'MK', 'viet nam': 'VN', 'lao people s democratic republic': 'LA',
  'korea republic of': 'KR', 'republic of korea': 'KR', 'russian federation': 'RU', turkiye: 'TR', 'the netherlands': 'NL',
  'dominican rep': 'DO', 'central african rep': 'CF', 'eq guinea': 'GQ', 's sudan': 'SS', 'solomon is': 'SB',
  'falkland is': 'FK', 'hong kong sar china': 'HK', 'macao sar china': 'MO', 'eswatini': 'SZ', 'swaziland': 'SZ',
};
const BY_NAME = new Map([...Object.entries(GEO.names).map(([cc, n]) => [norm(n), cc]), ...Object.entries(ALIASES)]);

// A DataFast country row -> an ISO code on our map, or null. The flag emoji first
// (two regional indicator letters), then the name.
export function countryCode(row) {
  const flag = [...String(row?.image || '')].map((ch) => ch.codePointAt(0) - 0x1f1e6).filter((n) => n >= 0 && n < 26);
  const fromFlag = flag.length === 2 ? String.fromCharCode(65 + flag[0], 65 + flag[1]) : null;
  if (fromFlag && GEO.centres[fromFlag]) return fromFlag;
  const cc = BY_NAME.get(norm(row?.country));
  return cc && GEO.centres[cc] ? cc : null;
}

// DataFast country rows (7 days) -> { countries: [{ cc, visitors }], other }. A country
// under GLOBE_MIN visitors, or not on the map, is only part of "other".
export function globeOf(rows) {
  const countries = [];
  let other = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const v = num(r?.visitors);
    if (v === null || v <= 0) continue;
    const cc = v >= GLOBE_MIN ? countryCode(r) : null;
    const seen = cc && countries.find((c) => c.cc === cc);
    if (seen) seen.visitors += v;
    else if (cc) countries.push({ cc, visitors: v });
    else other += v;
  }
  countries.sort((a, b) => b.visitors - a.visitors);
  return { window: '7d', countries, other };
}

export const API_BASE = 'https://datafa.st/api/v1/';
export const TZ = 'America/New_York';
export const TTL_MS = 5 * 60_000;
export const TIMEOUT_MS = 4000;
export const ENV_KEY = 'DATAFAST_API_KEY';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct1 = (part, whole) => (num(part) !== null && num(whole) ? Math.round((part / whole) * 1000) / 10 : null);

// The audience with every number unknown: what the page shows as --.
export function emptyAudience() {
  return {
    visitors: { today: null, yesterdaySoFar: null, d7: null, d30: null },
    spark30: [],
    globe: { window: '7d', countries: [], other: null },
    live: null,
    avgVisitSec: null, returningPct: null, desktopPct: null,
    countries: [], referrers: [],
    source: 'DataFast', as_of: null,
  };
}

// The UTC time of midnight at the start of a New York day ('YYYY-MM-DD').
export function nyMidnight(day) {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const off = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  const first = guess - off(guess);
  return guess - off(first);
}

// The requests for one moment. Exported for the tests.
export function plan(nowMs) {
  const today = nyDay(nowMs);
  const d7 = dayBefore(today, 6);
  const d30 = dayBefore(today, 29);
  const y = dayBefore(today, 1);
  const ySame = new Date(nowMs - 24 * 3600_000).toISOString();
  return {
    today: ['analytics/overview', { fields: 'visitors', startAt: today, endAt: today }],
    ySoFar: ['analytics/overview', { fields: 'visitors', startAt: new Date(nyMidnight(y)).toISOString(), endAt: ySame }],
    week: ['analytics/overview', { fields: 'visitors', startAt: d7, endAt: today }],
    month: ['analytics/overview', { fields: 'visitors,visitor_breakdown,avg_session_duration', startAt: d30, endAt: today }],
    series: ['analytics/timeseries', { fields: 'visitors', interval: 'day', startAt: d30, endAt: today, limit: '40' }],
    countries: ['analytics/countries', { fields: 'country,visitors', startAt: d30, endAt: today, limit: '3' }],
    devices: ['analytics/devices', { fields: 'device,visitors', startAt: d30, endAt: today, limit: '10' }],
    referrers: ['analytics/referrers', { fields: 'referrer,visitors', startAt: d30, endAt: today, limit: '3' }],
    globe: ['analytics/countries', { fields: 'country,image,visitors', startAt: d7, endAt: today, limit: '250' }],
  };
}

// The first row of an overview answer.
const row0 = (b) => (Array.isArray(b?.data) ? b.data[0] : b?.data) || null;

// The answers (each a body or null) -> the audience. Pure, for the tests.
export function shapeAudience(r, asOf) {
  const a = emptyAudience();
  a.as_of = asOf;
  const month = row0(r.month);
  a.visitors.today = num(row0(r.today)?.visitors);
  a.visitors.yesterdaySoFar = num(row0(r.ySoFar)?.visitors);
  a.visitors.d7 = num(row0(r.week)?.visitors);
  a.visitors.d30 = num(month?.visitors);
  const avg = num(month?.avg_session_duration);
  a.avgVisitSec = avg === null ? null : Math.round(avg);
  const vb = month?.visitorBreakdown || month?.visitor_breakdown;
  a.returningPct = num(vb?.returningPercentage) !== null ? Math.round(vb.returningPercentage * 10) / 10
    : pct1(num(month?.returning_visitors), num(month?.visitors));
  if (Array.isArray(r.series?.data)) a.spark30 = r.series.data.map((d) => num(d?.visitors) ?? 0).slice(-30);
  const whole = a.visitors.d30;
  // A country or referring site with fewer than GLOBE_MIN visitors is never shown on its
  // own (Privacy Policy): it is part of the rest.
  const top = (rows, key) => (Array.isArray(rows) ? rows : [])
    .filter((x) => typeof x?.[key] === 'string' && num(x.visitors) !== null && num(x.visitors) >= GLOBE_MIN)
    .slice(0, 3)
    .map((x) => ({ name: x[key].slice(0, 40), pct: pct1(x.visitors, whole) }));
  a.countries = whole ? top(r.countries?.data, 'country') : [];
  a.referrers = whole ? top(r.referrers?.data, 'referrer') : [];
  if (Array.isArray(r.globe?.data)) a.globe = globeOf(r.globe.data);
  const dev = Array.isArray(r.devices?.data) ? r.devices.data : null;
  if (dev) {
    const all = dev.reduce((s, x) => s + (num(x?.visitors) || 0), 0);
    const desk = dev.filter((x) => String(x?.device).toLowerCase() === 'desktop').reduce((s, x) => s + (num(x.visitors) || 0), 0);
    a.desktopPct = all ? pct1(desk, all) : null;
  }
  return a;
}

// { get({ wait }) -> audience }. fetchImpl and now for the tests.
export function makeDataFast({ key = process.env[ENV_KEY], fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = TIMEOUT_MS, ttlMs = TTL_MS, log = (m) => console.error(m) } = {}) {
  const apiKey = typeof key === 'string' && key.startsWith('df_') ? key.trim() : null;
  let cache = null; // { at, value }
  let inflight = null;
  let live = null; // { at, value }
  let liveFlight = null;

  async function call([path, params]) {
    const url = `${API_BASE}${path}?${new URLSearchParams({ ...params, timezone: TZ })}`;
    try {
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) { log(`[datafast] ${path} HTTP ${res.status}`); return null; }
      const body = await res.json();
      return body?.status === 'success' ? body : null;
    } catch (err) {
      log(`[datafast] ${path} ${err?.name === 'TimeoutError' ? 'timed out' : 'failed'}`);
      return null;
    }
  }

  async function refresh() {
    const t = now();
    const p = plan(t);
    const names = Object.keys(p);
    const bodies = await Promise.all(names.map((n) => call(p[n])));
    const value = shapeAudience(Object.fromEntries(names.map((n, i) => [n, bodies[i]])), new Date(t).toISOString());
    if (bodies.some(Boolean)) cache = { at: t, value };
    else if (cache && t - cache.at > 60 * 60_000) cache = null; // an hour of failures: show --
    return cache?.value || value;
  }

  // Visitors right now, kept LIVE_TTL_MS; a slow answer gives the last one.
  async function liveNow(wait) {
    if (live && now() - live.at < LIVE_TTL_MS) return live.value;
    liveFlight ||= call(['analytics/realtime', { fields: 'visitors' }]).then((b) => {
      const v = num(row0(b)?.visitors);
      if (v !== null) live = { at: now(), value: v };
      else if (live && now() - live.at > 10 * 60_000) live = null;
      return live?.value ?? null;
    }).finally(() => { liveFlight = null; });
    const late = new Promise((r) => { setTimeout(r, wait, undefined).unref?.(); });
    const got = await Promise.race([liveFlight, late]);
    return got === undefined ? live?.value ?? null : got;
  }

  return {
    configured: Boolean(apiKey),
    // The audience. wait: how long a first fetch may hold the answer (ms); after that,
    // the last answer (or all nulls) while the refresh finishes in the background.
    async get({ wait = timeoutMs + 500 } = {}) {
      if (!apiKey) return emptyAudience();
      const livePromise = liveNow(Math.min(wait, 1500));
      let value;
      if (cache && now() - cache.at < ttlMs) value = cache.value;
      else {
        inflight ||= refresh().finally(() => { inflight = null; });
        if (cache) value = cache.value; // stale but instant; the refresh runs on
        else {
          const late = new Promise((r) => { setTimeout(r, wait, null).unref?.(); });
          value = (await Promise.race([inflight, late])) || emptyAudience();
        }
      }
      return { ...value, live: await livePromise };
    },
  };
}
