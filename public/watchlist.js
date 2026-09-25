// WATCH: the user's own list of symbols. Pure list maths plus load and save through
// a store that never throws (see app.js). The list lives in this browser only.

import { matchInstrument, instrumentById } from './instruments.js';

export const WATCH_KEY = 'bb.watch';
export const DEFAULT_WATCHLIST = ['SPX', 'NDX', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'BTC', 'GOLD', 'EURUSD'];
export const MAX_WATCH = 50;
const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// "AAPL", "S&P 500", "EUR/USD", "AAPL,MSFT" -> { ids: ['AAPL', 'SPX', ...], bad: [...] }.
// Named instruments may take up to three words; commas also separate symbols.
export function parseSymbols(tokens) {
  const toks = tokens.flatMap((t) => String(t).toUpperCase().split(/[,;]+/)).map((t) => t.trim().replace(/^\$/, '')).filter(Boolean);
  const ids = [];
  const bad = [];
  let i = 0;
  while (i < toks.length) {
    const m = matchInstrument(toks.slice(i));
    if (m) { ids.push(m.inst.id); i += m.used; continue; }
    if (TICKER_RE.test(toks[i])) ids.push(toks[i]); else bad.push(toks[i]);
    i += 1;
  }
  return { ids: [...new Set(ids)], bad };
}

const SUBS = { ADD: 'add', REMOVE: 'remove', DELETE: 'remove', DEL: 'remove', RM: 'remove', CLEAR: 'clear', EXPORT: 'export', IMPORT: 'import', RESET: 'reset' };
export const WATCH_SUBCOMMANDS = Object.keys(SUBS);
const MUTATES = new Set(['add', 'remove', 'clear', 'import', 'reset']);

// The words after WATCH:
//   []                  -> show
//   ADD AAPL TSLA       -> add      (WATCH AAPL TSLA works too)
//   REMOVE AAPL         -> remove
//   CLEAR | RESET       -> empty list | the starter list
//   EXPORT              -> copy the list as text
//   IMPORT AAPL,MSFT    -> replace the list
export function parseWatchArgs(toks) {
  if (!toks.length) return { action: 'show' };
  const sub = SUBS[toks[0]];
  const rest = sub ? toks.slice(1) : toks;
  const action = sub || 'add';
  if (action === 'clear' || action === 'export' || action === 'reset') {
    return rest.length ? { action, error: 'usage' } : { action, mutates: MUTATES.has(action) };
  }
  if (!rest.length) return { action, error: 'usage' };
  const { ids, bad } = parseSymbols(rest);
  if (bad.length) return { action, error: 'symbol', bad, ids };
  if (!sub && !ids.length) return { action, error: 'usage' };
  return { action, ids, mutates: true };
}

// The canonical words for a parsed WATCH command.
export function watchInput(a) {
  if (a.error || a.action === 'show') return null;
  const word = { add: 'ADD', remove: 'REMOVE', clear: 'CLEAR', export: 'EXPORT', import: 'IMPORT', reset: 'RESET' }[a.action];
  if (a.action === 'import') return `WATCH IMPORT ${a.ids.join(',')}`;
  return ['WATCH', word, ...(a.ids || [])].join(' ');
}

const clean = (list) => (Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === 'string' && x && x.length <= 16))].slice(0, MAX_WATCH) : null);

export function loadWatchlist(store) {
  return clean(store.get(WATCH_KEY, null)) || [...DEFAULT_WATCHLIST];
}

export function saveWatchlist(store, list) {
  store.set(WATCH_KEY, clean(list) || []);
}

export function isDefaultList(list) {
  return list.length === DEFAULT_WATCHLIST.length && list.every((id, i) => id === DEFAULT_WATCHLIST[i]);
}

// { list, added, skipped } : already listed symbols are skipped, the cap is kept.
export function addIds(list, ids) {
  const out = [...list];
  const added = [];
  const skipped = [];
  for (const id of ids) {
    if (out.includes(id)) { skipped.push(id); continue; }
    if (out.length >= MAX_WATCH) { skipped.push(id); continue; }
    out.push(id);
    added.push(id);
  }
  return { list: out, added, skipped };
}

export function removeIds(list, ids) {
  const drop = new Set(ids);
  return { list: list.filter((id) => !drop.has(id)), removed: ids.filter((id) => list.includes(id)), missing: ids.filter((id) => !list.includes(id)) };
}

// Move one item from index `from` to index `to` (both clamped).
export function moveItem(list, from, to) {
  if (from < 0 || from >= list.length) return [...list];
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

export function exportText(list) {
  return list.join(',');
}

export function toggleId(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : addIds(list, [id]).list;
}

// "22.7M" -> 22700000, for sorting the volume column.
export function volumeNumber(v) {
  const m = /^([\d.,]+)\s*([KMBT])?$/i.exec(String(v ?? '').trim());
  if (!m) return NaN;
  const n = Number(m[1].replace(/,/g, ''));
  return n * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1);
}

// Where the last price sits in its 52-week range, 0 to 1 (NaN when unknown).
export function rangePos(lo, hi, last) {
  if (![lo, hi, last].every(Number.isFinite) || hi <= lo) return NaN;
  return Math.max(0, Math.min(1, (last - lo) / (hi - lo)));
}

// Sort keys for the WATCH table. Rows: { id, quote }. Missing values always sort last.
export const SORTS = {
  symbol: (r) => r.id,
  name: (r) => (r.quote ? (r.quote.label || r.quote.name || r.id) : r.id).toUpperCase(),
  last: (r) => r.quote?.last,
  chg: (r) => r.quote?.change,
  pct: (r) => r.quote?.changePct,
  range: (r) => rangePos(r.quote?.low52, r.quote?.high52, r.quote?.last),
  vol: (r) => volumeNumber(r.quote?.volume),
};

export function sortRows(rows, key, dir) {
  const f = SORTS[key];
  if (!f || !dir) return rows;
  const sign = dir === 'asc' ? 1 : -1;
  const missing = (v) => v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v));
  return [...rows].sort((a, b) => {
    const va = f(a);
    const vb = f(b);
    if (missing(va) || missing(vb)) return missing(va) - missing(vb);
    if (typeof va === 'string') return va.localeCompare(vb) * sign;
    return (va - vb) * sign;
  });
}

// Kind of a watched id before its quote arrives (for labels only).
export function kindOf(id) {
  return instrumentById(id)?.kind || 'stock';
}
