// Bar sizes for charts, shared by the browser (the bar-size row, zoom) and the server
// (the /api/chart ?bar= whitelist). Source bar names: 1M 5M 30M 1H 1D 1W (and 1MO,
// which only MAX uses by default and the row does not offer).

export const BARS = ['1M', '5M', '30M', '1H', '1D', '1W'];
export const BAR_LABEL = { '1M': '1m', '5M': '5m', '30M': '30m', '1H': '1h', '1D': 'D', '1W': 'W', '1MO': 'M' };
const MIN = 60_000;
const DAY = 86_400_000;
export const BAR_MS = { '1M': MIN, '5M': 5 * MIN, '30M': 30 * MIN, '1H': 60 * MIN, '1D': DAY, '1W': 7 * DAY, '1MO': 30 * DAY };
export const isIntradayBar = (bar) => bar === '1M' || bar === '5M' || bar === '30M' || bar === '1H';

// The longest window (days) each bar may cover, the shortest, and how far back the
// source keeps it. The source serves about 90 days of intraday bars per call, so 30m
// and 1h windows longer than that are fetched in pieces (data/charts.js).
const MAX_SPAN = { '1M': 7, '5M': 31, '30M': 190, '1H': 190, '1D': Infinity, '1W': Infinity };
const MIN_SPAN = { '1D': 2, '1W': 300 };
export const HISTORY_DAYS = { '1M': 300, '5M': 300, '30M': 200, '1H': 200 };

// The span in days each preset covers (YTD from Jan 1 to today).
export function presetSpanDays(range, today = new Date()) {
  if (range === 'YTD') {
    const y = today.getUTCFullYear();
    return Math.max(1, Math.ceil((today.getTime() - Date.UTC(y, 0, 1)) / DAY));
  }
  return { '1D': 1, '5D': 7, '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '2Y': 731, '5Y': 5 * 366, '10Y': 10 * 366, MAX: 60 * 366 }[range] ?? 366;
}

// Can `bar` draw a window of spanDays that starts ageDays ago?
export function barValid(bar, { spanDays, ageDays = spanDays }) {
  if (!BARS.includes(bar)) return false;
  if (!(spanDays > 0)) return false;
  if (spanDays > MAX_SPAN[bar] + 1e-9) return false;
  if (MIN_SPAN[bar] && spanDays < MIN_SPAN[bar]) return false;
  if (HISTORY_DAYS[bar] && ageDays > HISTORY_DAYS[bar]) return false;
  return true;
}

// The bars a preset may use: [{ bar, ok }] in row order.
export function barsForPreset(range, today = new Date()) {
  const spanDays = presetSpanDays(range, today);
  return BARS.map((bar) => ({ bar, ok: barValid(bar, { spanDays, ageDays: spanDays + (range === '5D' ? 3 : 0) }) }));
}

// The bar a preset draws with unless the user picks one. MAX keeps the source default
// (monthly), which is not in the row.
export const AUTO_BAR = { '1D': '1M', '5D': '5M', '1M': '1D', '3M': '1D', '6M': '1D', YTD: '1D', '1Y': '1D', '2Y': '1D', '5Y': '1W', '10Y': '1W', MAX: null };

// The best bar for a zoomed window: about one to a few hundred bars across it.
// A week gets 30m bars, an hour or a day keeps 1m bars. Falls back to daily when the
// window starts before the source keeps intraday bars.
export function zoomBar(spanMs, ageMs) {
  const d = spanMs / DAY;
  const age = ageMs / DAY;
  let bar;
  if (d <= 2) bar = '1M';
  else if (d <= 5) bar = '5M';
  else if (d <= 14) bar = '30M';
  else if (d <= 60) bar = '1H';
  else if (d <= 3 * 366) bar = '1D';
  else bar = '1W';
  if (HISTORY_DAYS[bar] && age > HISTORY_DAYS[bar]) bar = d <= 3 * 366 ? '1D' : '1W';
  return bar;
}

// The ?bar= value, or null for anything off the whitelist.
export function parseBar(raw) {
  const b = String(raw ?? '').trim().toUpperCase();
  return BARS.includes(b) ? b : null;
}
