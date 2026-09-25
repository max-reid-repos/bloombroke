// CALENDAR: this week's economic calendar from the public Forex Factory JSON feed (no key).
// The feed has forecast and previous values; it does not carry actual results.

import { createCache } from './cache.js';
import { UA } from './quotes.js';
import { iso } from './lists.js';

const URL_WEEK = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const TTL = 30 * 60_000;
const IMPACTS = new Set(['High', 'Medium', 'Low', 'Holiday']);

const text = (v, max = 40) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parseCalendar(body) {
  if (!Array.isArray(body)) throw new Error('calendar source: unexpected shape');
  return body
    .map((e) => {
      const t = Date.parse(e?.date);
      return {
        title: text(e?.title, 140),
        country: text(e?.country, 4).toUpperCase(),
        time: Number.isFinite(t) ? new Date(t).toISOString() : null,
        impact: IMPACTS.has(e?.impact) ? e.impact : 'Low',
        forecast: text(e?.forecast) || null,
        previous: text(e?.previous) || null,
      };
    })
    .filter((e) => e.title && e.country && e.time)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

export function makeCalendar({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  async function getCalendar() {
    const { value, stale, fetchedAt } = await cache.cached('calendar', TTL, async () => {
      const res = await fetchImpl(URL_WEEK, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`calendar source HTTP ${res.status}`);
      const events = parseCalendar(await res.json());
      if (!events.length) throw new Error('calendar source: no events');
      return events;
    });
    return { events: value, stale, updated: iso(fetchedAt) };
  }
  return { getCalendar };
}

export const { getCalendar } = makeCalendar();
