// HOLIDAYS: the days the US stock market (NYSE and Nasdaq) is closed or closes early,
// over the next 12 months. The dates are app.js's NYSE_HOLIDAYS and NYSE_EARLY_CLOSES
// (the market clock and CLOCK read them too); this file only names them. Each day shows
// in the visitor's own time zone: the day the New York session would open (9:30) there.

import { esc, panel } from './markets.js';
import { NYSE_HOLIDAYS, NYSE_EARLY_CLOSES } from '../app.js';

// The names, from the NYSE holiday calendar (nyse.com/markets/hours-calendars, Holidays
// and Trading Hours, 2026 and 2027). Nasdaq closes on the same days. A date added to
// app.js needs its name here (test/holidays.test.js checks).
export const HOLIDAY_NAMES = {
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Washington's Birthday",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-11-27': 'Day after Thanksgiving',
  '2026-12-24': 'Christmas Eve',
  '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': "Washington's Birthday",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving Day',
  '2027-11-26': 'Day after Thanksgiving',
  '2027-12-24': 'Christmas Day (observed)',
};

const NY = 'America/New_York';
const DAY_MS = 86400000;

// ms since 1970 for a wall time in a time zone.
function zoned(ymd, hh, mm, tz) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, hh, mm);
  let t = wall;
  for (let i = 0; i < 2; i += 1) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(t).map((x) => [x.type, x.value]));
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
    t = wall - (seen - t);
  }
  return t;
}

// New York's calendar day for an instant: 'YYYY-MM-DD'.
export function nyDay(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

// "THU NOV 26, 2026" in a time zone.
const localDay = (t, tz) => new Date(t).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).replace(/^(\w+),/, '$1').toUpperCase();
// "1:00 PM" (and "SAT" when it is another day there).
const localTime = (t, tz) => new Date(t).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ').toLowerCase();
const localWeekday = (t, tz) => new Date(t).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });

// Every closure and early close from now to 12 months on, in order:
// [{ date (New York), name, early, day (the visitor's), closeLocal }]. closeLocal: an
// early close's 1:00 pm New York in the visitor's time, or null when that reads the same.
export function upcoming(now = Date.now(), tz = NY) {
  const from = nyDay(now);
  const to = nyDay(now + 365 * DAY_MS);
  const days = [...NYSE_HOLIDAYS].map((d) => [d, false]).concat([...NYSE_EARLY_CLOSES].map((d) => [d, true]))
    .filter(([d]) => d >= from && d <= to)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return days.map(([date, early]) => {
    const open = zoned(date, 9, 30, NY);
    const row = { date, name: HOLIDAY_NAMES[date] || 'Market holiday', early, day: localDay(open, tz), closeLocal: null };
    if (early) {
      const close = zoned(date, 13, 0, NY);
      const here = localTime(close, tz);
      if (here !== '1:00 pm' || localDay(close, tz) !== localDay(open, tz)) {
        row.closeLocal = localDay(close, tz) === row.day ? here : `${here} ${localWeekday(close, tz)}`;
      }
    }
    return row;
  });
}

// The visitor's time zone, or New York.
export function visitorZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || NY; } catch { return NY; }
}

// "Asia/Bangkok" -> "BANGKOK"
const zoneName = (tz) => String(tz).split('/').pop().replace(/_/g, ' ').toUpperCase();

export function holidaysTable(rows) {
  if (!rows.length) return '<p class="panel-msg">No closures listed for the next 12 months yet.</p>';
  return `<table class="grid-table co-table hol-table">
    <thead><tr><th scope="col" class="co-date">Date</th><th scope="col">Holiday</th><th scope="col">Market</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${r.early ? ' class="is-early"' : ''}>
      <td class="co-date">${esc(r.day)}</td>
      <td>${esc(r.name)}</td>
      <td>${r.early ? `Early close 1:00 pm New York${r.closeLocal ? ` <span class="dim">(${esc(r.closeLocal)} your time)</span>` : ''}` : 'Closed'}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// The status line: the next full closure.
export function nextLine(rows) {
  const next = rows.find((r) => !r.early);
  return next ? `NEXT CLOSURE: ${next.day}, ${next.name.toUpperCase()}` : '';
}

export function render(el, cmd, ctx) {
  const tz = visitorZone();
  const rows = upcoming(Date.now(), tz);
  el.innerHTML = panel('1', 'US market holidays', holidaysTable(rows), {
    cls: 'panel-solo hol-panel', bodyCls: 'flush', meta: `NYSE AND NASDAQ &middot; NEXT 12 MONTHS &middot; ${esc(zoneName(tz))} TIME`,
  });
  ctx.status(nextLine(rows));
}
