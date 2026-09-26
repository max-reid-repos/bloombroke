// Chart ranges, shared by the browser (command parsing, the range bar) and the server.
// Presets: 1D 5D 1M 3M 6M YTD 1Y 2Y 5Y 10Y MAX. Custom: FROM and TO dates, YYYY-MM-DD.
// Compare symbols ride along: AAPL 1Y VS QQQ (typed as +QQQ on a chart).

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
// Compare symbols (an overlay line on the chart): "+QQQ" anywhere, or "VS QQQ SPY" at the
// end, up to MAX_COMPARE -> { ..., compare: ['QQQ', 'SPY'] } (left out when there are none).
// Errors: { error: 'usage' | 'date' | 'order' | 'future' }.
export function parseRangeArgs(args, today = nyToday()) {
  const all = args.map((t) => String(t).toUpperCase());
  const cmp = splitCompare(all);
  if (!cmp) return { error: 'usage' };
  const r = parseRangeOnly(cmp.rest, today);
  return cmp.compare.length && !r.error ? { ...r, compare: cmp.compare } : r;
}

export const MAX_COMPARE = 3;
const COMPARE_RE = /^[A-Z0-9][A-Z0-9.\/=&-]{0,11}$/;

// Words -> { rest (the range words), compare: [symbols] }, or null when the compare part
// is not symbols (or more than MAX_COMPARE).
export function splitCompare(toks) {
  const vs = toks.indexOf('VS');
  const head = vs >= 0 ? toks.slice(0, vs) : toks;
  const tail = vs >= 0 ? toks.slice(vs + 1) : [];
  if (vs >= 0 && !tail.length) return null;
  const compare = [];
  const rest = [];
  for (const t of head) {
    if (t.startsWith('+') && t.length > 1) compare.push(t.slice(1));
    else rest.push(t);
  }
  for (const t of tail) compare.push(t.replace(/^\+/, ''));
  if (!compare.every((c) => COMPARE_RE.test(c))) return null;
  const uniq = [...new Set(compare)];
  if (uniq.length > MAX_COMPARE) return null;
  return { rest, compare: uniq };
}

function parseRangeOnly(toks, today) {
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
  const cmp = r.compare?.length ? `VS ${r.compare.join(' ')}` : '';
  let words;
  if (r.from) words = r.to ? `${r.from} ${r.to}` : `FROM ${r.from}`;
  else words = r.range && r.range !== DEFAULT_RANGE ? r.range : '';
  return [words, cmp].filter(Boolean).join(' ');
}

export function rangeLabel(r) {
  if (r?.from) return r.to ? `${r.from} TO ${r.to}` : `FROM ${r.from}`;
  return r?.range || DEFAULT_RANGE;
}

// Query string for /api/chart. bar: a size from public/bars.js, or none for the default.
export function chartQuery(symbol, r, bar = null) {
  const p = new URLSearchParams({ s: symbol });
  if (r?.from) { p.set('from', r.from); if (r.to) p.set('to', r.to); } else p.set('r', r?.range || DEFAULT_RANGE);
  if (bar) p.set('bar', bar);
  return `/api/chart?${p}`;
}
