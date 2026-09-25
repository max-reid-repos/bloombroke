// Chart ranges, shared by the browser (command parsing, the range bar) and the server.
// Presets: 1D 5D 1M 3M 6M YTD 1Y 2Y 5Y 10Y MAX. Custom: FROM and TO dates, YYYY-MM-DD.

export const PRESETS = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'MAX'];
export const DEFAULT_RANGE = '1Y';
export const FIRST_DAY = '1900-01-01';

// "2020-01-31" -> a UTC midnight Date, or null for anything that is not a real day.
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (s < FIRST_DAY) return null;
  return date;
}

// A UTC midnight Date -> "2020-01-31".
export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

// The date in New York as "2026-09-25".
export function nyToday(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// The words after a symbol:
//   []                          -> { range: '1Y' }
//   ['5Y']                      -> { range: '5Y' }
//   ['2020-01-01', '2024-12-31'] or ['FROM', '2020-01-01', 'TO', '2024-12-31']
//                               -> { from, to }
//   ['FROM', '2020-01-01'] or ['2020-01-01'] -> { from, to: null } (to today)
// Errors: { error: 'usage' | 'date' | 'order' | 'future' }.
export function parseRangeArgs(args, today = nyToday()) {
  const toks = args.map((t) => String(t).toUpperCase());
  if (!toks.length) return { range: DEFAULT_RANGE };
  if (toks.length === 1 && PRESETS.includes(toks[0])) return { range: toks[0] };
  const dates = [];
  let i = 0;
  if (toks[i] === 'FROM') i += 1;
  if (toks[i] !== undefined) { dates.push(toks[i]); i += 1; }
  if (toks[i] === 'TO') i += 1;
  if (toks[i] !== undefined) { dates.push(toks[i]); i += 1; }
  if (i !== toks.length || !dates.length) return { error: 'usage' };
  if (!dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) return { error: 'usage' };
  if (!dates.every(parseDate)) return { error: 'date' };
  const [from, to = null] = dates;
  if (from > today) return { error: 'future' };
  if (to && from >= to) return { error: 'order' };
  return { from, to: to && to > today ? today : to };
}

// The canonical words for a range, as they appear in ?c=.
export function rangeWords(r) {
  if (!r || r.error) return '';
  if (r.from) return r.to ? `${r.from} ${r.to}` : `FROM ${r.from}`;
  return r.range && r.range !== DEFAULT_RANGE ? r.range : '';
}

export function rangeLabel(r) {
  if (r?.from) return r.to ? `${r.from} TO ${r.to}` : `FROM ${r.from}`;
  return r?.range || DEFAULT_RANGE;
}

// Query string for /api/chart.
export function chartQuery(symbol, r) {
  const p = new URLSearchParams({ s: symbol });
  if (r?.from) { p.set('from', r.from); if (r.to) p.set('to', r.to); } else p.set('r', r?.range || DEFAULT_RANGE);
  return `/api/chart?${p}`;
}
