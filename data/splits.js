// SPLITS: upcoming stock splits, from the Nasdaq splits calendar (no key). Cached an hour.
// EXDIV: ex-dividend dates for the next five weekdays, from the Nasdaq dividend calendar
// (one call per day). Cached an hour. Rows are checked before they are shown: a zero
// dividend or annual amount is "no figure" (null), and a row whose dates cannot be
// true (paid before the record date, or a record date before it was announced) is
// left out and counted, since we cannot tell which of its dates is wrong.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { money, usDay, nyDay, addDays, isIsoDay } from './lists.js';
import { CompanyDataError, HOUR_MS, nasdaqData, cachedOrThrow, text, symbolOf } from './company-kit.js';

export { CompanyDataError as SplitsError };

export const SPLITS_SOURCE = 'Exchange calendars';
export const EXDIV_SOURCE = 'Exchange calendars';

// "3 : 1" / "1:150" / "1.5:1" -> { ratio: "3:1", reverse: false }.
export function parseRatio(s) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(s ?? ''));
  if (!m) return { ratio: text(s, 20), reverse: null };
  const a = Number(m[1]);
  const b = Number(m[2]);
  return { ratio: `${m[1]}:${m[2]}`, reverse: a < b };
}

export function parseSplits(d) {
  const rows = (Array.isArray(d?.rows) ? d.rows : []).map((r) => ({
    symbol: symbolOf(r.symbol),
    company: text(r.name, 90),
    ...parseRatio(r.ratio),
    date: usDay(r.executionDate),
  })).filter((r) => r.company && r.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.symbol).localeCompare(String(b.symbol))));
  return rows.length ? { rows } : null;
}

const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);

// Why a row's dates cannot be true, or null when they can.
export function exDivProblem(r) {
  if (r.paid && r.record && r.paid < r.record) return 'paid before the record date';
  if (r.record && r.announced && r.record < r.announced) return 'record date before the announcement';
  return null;
}

// rows -> { rows, dropped: [{ symbol, company, why }] }
export function cleanExDiv(rows) {
  const out = [];
  const dropped = [];
  for (const r of rows || []) {
    const why = exDivProblem(r);
    if (why) dropped.push({ symbol: r.symbol, company: r.company, why });
    else out.push(r);
  }
  return { rows: out, dropped };
}

export function parseExDiv(d) {
  const rows = (Array.isArray(d?.calendar?.rows) ? d.calendar.rows : []).map((r) => ({
    symbol: symbolOf(r.symbol),
    company: text(String(r.companyName || '').replace(/\s+(Common Stock|Common Shares|Ordinary Shares)$/i, ''), 90),
    exDate: usDay(r.dividend_Ex_Date),
    dividend: positive(money(r.dividend_Rate)),
    annual: positive(money(r.indicated_Annual_Dividend)),
    record: usDay(r.record_Date),
    paid: usDay(r.payment_Date),
    announced: usDay(r.announcement_Date),
  })).filter((r) => r.company && r.exDate)
    .sort((a, b) => String(a.symbol || a.company).localeCompare(String(b.symbol || b.company)));
  return rows;
}

// The next n weekdays from a day, the day itself included when it is a weekday.
export function nextWeekdays(from, n = 5) {
  const out = [];
  let d = from;
  while (out.length < n) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function makeSplits({ fetchImpl = cappedFetch, cache = createCache({ retryMs: 60_000, maxEntries: 200 }), now = () => Date.now() } = {}) {
  async function getSplits() {
    const got = await cachedOrThrow(cache, 'splits', HOUR_MS, async () => parseSplits(await nasdaqData(fetchImpl, 'calendar/splits')), {
      what: 'Split data', missing: 'No stock splits listed right now.',
    });
    return { ...got.value, stale: got.stale, updated: got.updated, source: SPLITS_SOURCE };
  }

  // One day (YYYY-MM-DD) or the next five weekdays.
  async function getExDiv(dayArg) {
    const today = nyDay(now());
    const single = isIsoDay(dayArg) ? dayArg : null;
    const days = single ? [single] : nextWeekdays(today, 5);
    const settled = await Promise.allSettled(days.map((d) => cache.cached(`exdiv:${d}`, HOUR_MS, async () => {
      const data = await nasdaqData(fetchImpl, `calendar/dividends?date=${d}`);
      if (!data) throw new Error('dividend calendar: no data');
      return parseExDiv(data);
    })));
    if (settled.every((s) => s.status === 'rejected')) throw new CompanyDataError('unavailable', 'Dividend data is taking a break. Try again in a minute.');
    const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    return {
      today,
      single: Boolean(single),
      days: days.map((date, i) => (settled[i].status === 'fulfilled' ? { date, ...cleanExDiv(settled[i].value.value) } : { date, rows: null, dropped: [] })),
      stale: ok.some((g) => g.stale),
      updated: new Date(Math.min(...ok.map((g) => g.fetchedAt))).toISOString(),
      source: EXDIV_SOURCE,
    };
  }

  return { getSplits, getExDiv };
}

export const { getSplits, getExDiv } = makeSplits();
