// EARNINGS: the earnings calendar from the Nasdaq API (no key).

import { createCache } from './cache.js';
import { getNasdaq, money, usDay, isIsoDay, addDays, iso } from './lists.js';

const TTL = 30 * 60_000;
const TIMES = { 'time-pre-market': 'BEFORE OPEN', 'time-after-hours': 'AFTER CLOSE' };

export class EarningsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function parseEarnings(body) {
  const rows = body?.data?.rows;
  if (body?.data === undefined) throw new Error('earnings source: unexpected shape');
  if (!Array.isArray(rows)) return []; // weekends and holidays come back with rows: null
  return rows
    .filter((r) => r && typeof r.symbol === 'string' && /^[A-Z.\-/]{1,10}$/.test(r.symbol.trim()))
    .map((r) => ({
      ticker: r.symbol.trim(),
      name: String(r.name || '').trim(),
      time: TIMES[r.time] || null,
      marketCap: money(r.marketCap),
      epsForecast: money(r.epsForecast),
      estimates: money(r.noOfEsts),
      lastYearEps: money(r.lastYearEPS),
      lastYearDate: usDay(r.lastYearRptDt),
      quarter: r.fiscalQuarterEnding || null,
    }))
    .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));
}

// Monday to Friday of the week that holds `day`.
export function weekDays(day) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
  const monday = addDays(day, dow === 0 ? -6 : 1 - dow);
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

export function makeEarnings({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  const one = (day) => cache.cached(`earnings:${day}`, TTL, async () => parseEarnings(await getNasdaq(fetchImpl, `calendar/earnings?date=${day}`)));

  // { date } for one day, or { date, week: true } for Monday to Friday of that week.
  async function getEarnings({ date, week = false }) {
    if (!isIsoDay(date)) throw new EarningsError('bad_date', 'Use a date like 2026-09-28, or TODAY, TOMORROW, WEEK.');
    const days = week ? weekDays(date) : [date];
    const got = await Promise.allSettled(days.map(one));
    if (got.every((g) => g.status === 'rejected')) throw new Error('earnings: source failed');
    return {
      days: days.map((d, i) => ({
        date: d,
        rows: got[i].status === 'fulfilled' ? got[i].value.value : null,
      })),
      stale: got.some((g) => g.status === 'fulfilled' && g.value.stale),
      updated: iso(Math.min(...got.filter((g) => g.status === 'fulfilled').map((g) => g.value.fetchedAt))),
    };
  }

  return { getEarnings };
}

export const { getEarnings } = makeEarnings();
