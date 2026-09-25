// PORTFOLIO: holdings maths, command words and CSV. Pure functions only (unit tested).
// A holding is { ticker, shares, cost }, where cost is the average cost per share in USD.
// Holdings live in this browser only.

import { parseSymbols, kindOf } from './watchlist.js';

export const PF_KEY = 'bb.pf';
export const MAX_HOLDINGS = 60;
const EPS = 1e-9;

// Kinds you cannot hold directly: an index, a currency rate, a bond yield.
export const NOT_HOLDABLE = { index: 'an index', fx: 'a currency pair', yield: 'a bond yield' };

const num = (tok) => {
  const s = String(tok ?? '').replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

// Round away float dust: 0.1 + 0.2 shares is 0.3 shares.
export const round = (n, dp = 8) => Math.round(n * 10 ** dp) / 10 ** dp;

// Add shares at a price. An existing holding keeps one line with a weighted average cost.
export function addLot(holdings, { ticker, shares, cost }) {
  const i = holdings.findIndex((h) => h.ticker === ticker);
  if (i < 0) return [...holdings, { ticker, shares: round(shares), cost }];
  const h = holdings[i];
  const total = h.shares + shares;
  const avg = (h.shares * h.cost + shares * cost) / total;
  const out = [...holdings];
  out[i] = { ticker, shares: round(total), cost: avg };
  return out;
}

// Sell some shares (or 'ALL'). The average cost of what is left does not change.
// Returns { holdings } or { error: 'none' | 'too_many', held }.
export function sellShares(holdings, ticker, shares) {
  const i = holdings.findIndex((h) => h.ticker === ticker);
  if (i < 0) return { error: 'none' };
  const h = holdings[i];
  const n = shares === 'ALL' ? h.shares : shares;
  if (n > h.shares + EPS) return { error: 'too_many', held: h.shares };
  const left = round(h.shares - n);
  const out = [...holdings];
  if (left <= EPS) out.splice(i, 1); else out[i] = { ...h, shares: left };
  return { holdings: out, sold: n, left: Math.max(0, left) };
}

export function removeHolding(holdings, ticker) {
  return holdings.filter((h) => h.ticker !== ticker);
}

// Edit a holding in place: its shares and average cost become exactly these. The row keeps
// its position; a ticker not held is added at the end.
export function setHolding(holdings, { ticker, shares, cost }) {
  const i = holdings.findIndex((h) => h.ticker === ticker);
  const h = { ticker, shares: round(shares), cost };
  if (i < 0) return [...holdings, h];
  const out = [...holdings];
  out[i] = h;
  return out;
}

// The PF add form's three fields -> the same result as PF ADD <ticker> <shares> @ <price>.
export function readPfForm({ ticker, shares, price }) {
  const t = String(ticker || '').trim().toUpperCase();
  const toks = ['ADD', ...t.split(/\s+/).filter(Boolean), String(shares || '').trim(), '@', String(price || '').trim()];
  if (!t) return { action: 'add', error: 'usage' };
  return parsePfArgs(toks);
}

// Market value, day gain, total gain and weight per holding, plus totals.
// quotes: { [ticker]: { last, change, changePct, currency } }. A holding with no quote,
// or a quote in another currency, is shown but left out of the totals and weights.
export function valuePortfolio(holdings, quotes = {}) {
  const rows = holdings.map((h) => {
    const q = quotes[h.ticker];
    const basis = h.shares * h.cost;
    const base = { ...h, basis, quote: q || null };
    if (!q || !Number.isFinite(q.last)) return { ...base, ok: false, reason: 'noquote' };
    if (q.currency && q.currency !== 'USD') return { ...base, ok: false, reason: 'currency', last: q.last };
    const value = h.shares * q.last;
    const change = Number.isFinite(q.change) ? q.change : 0;
    const dayGain = h.shares * change;
    const prev = value - dayGain;
    return {
      ...base,
      ok: true,
      last: q.last,
      value,
      dayGain,
      dayPct: Number.isFinite(q.changePct) ? q.changePct : (prev > 0 ? (dayGain / prev) * 100 : NaN),
      totalGain: value - basis,
      totalPct: basis > 0 ? ((value - basis) / basis) * 100 : NaN,
    };
  });
  const counted = rows.filter((r) => r.ok);
  const value = counted.reduce((s, r) => s + r.value, 0);
  const basis = counted.reduce((s, r) => s + r.basis, 0);
  const dayGain = counted.reduce((s, r) => s + r.dayGain, 0);
  for (const r of rows) r.weight = r.ok && value > 0 ? (r.value / value) * 100 : NaN;
  const prev = value - dayGain;
  return {
    rows,
    totals: {
      value,
      basis,
      dayGain,
      dayPct: prev > 0 ? (dayGain / prev) * 100 : NaN,
      totalGain: value - basis,
      totalPct: basis > 0 ? ((value - basis) / basis) * 100 : NaN,
      counted: counted.length,
    },
  };
}

// ---- Commands ------------------------------------------------------------------

const SUBS = { ADD: 'add', BUY: 'add', SELL: 'sell', REMOVE: 'remove', DELETE: 'remove', DEL: 'remove', RM: 'remove', CLEAR: 'clear', EXPORT: 'export', IMPORT: 'import' };

// "150" "@150" "@" "AT" "$150" -> the tokens with the price markers split off.
function splitAt(toks) {
  return toks.flatMap((t) => (t.length > 1 && t.startsWith('@') ? ['@', t.slice(1)] : [t])).filter((t) => t !== '@' && t !== 'AT' && t !== 'SHARES' && t !== 'SHARE' && t !== 'X');
}

// One symbol at the start of the words: { id, used } or an error.
function symbolFirst(toks) {
  for (let n = Math.min(3, toks.length - 1); n >= 1; n -= 1) {
    const { ids, bad } = parseSymbols(toks.slice(0, n));
    if (!bad.length && ids.length === 1) return { id: ids[0], used: n };
  }
  return null;
}

function holdable(id) {
  const kind = kindOf(id);
  return NOT_HOLDABLE[kind] ? { error: 'kind', kind: NOT_HOLDABLE[kind], ticker: id } : null;
}

// The words after PF:
//   []                          -> show
//   ADD AAPL 10 @ 150           -> add 10 shares at 150 (merges into a weighted average)
//   SELL AAPL 3 | SELL AAPL ALL -> sell
//   REMOVE AAPL | CLEAR         -> remove one, remove all
//   EXPORT                      -> CSV to the clipboard
//   IMPORT AAPL,10,150 MSFT,5,300 -> replace the holdings (IMPORT alone opens a paste box)
export function parsePfArgs(toks) {
  if (!toks.length) return { action: 'show' };
  const action = SUBS[toks[0]];
  if (!action) return { error: 'usage' };
  const rest = toks.slice(1);
  if (action === 'clear' || action === 'export') return rest.length ? { action, error: 'usage' } : { action, mutates: action === 'clear' };
  if (action === 'import') {
    if (!rest.length) return { action, paste: true };
    const { holdings, errors } = parseCsv(rest.join('\n'));
    if (errors.length) return { action, error: 'csv', errors };
    return { action, holdings, mutates: true };
  }
  if (action === 'remove') {
    const { ids, bad } = parseSymbols(rest);
    if (bad.length || ids.length !== 1) return { action, error: 'usage' };
    return { action, ticker: ids[0], mutates: true };
  }
  const words = splitAt(rest);
  const sym = symbolFirst(words);
  if (!sym) return { action, error: 'usage' };
  const nums = words.slice(sym.used);
  if (action === 'sell') {
    if (nums.length !== 1) return { action, error: 'usage' };
    if (nums[0] === 'ALL') return { action, ticker: sym.id, shares: 'ALL', mutates: true };
    const shares = num(nums[0]);
    if (!(shares > 0 && shares <= 1e9)) return { action, error: 'shares' };
    return { action, ticker: sym.id, shares, mutates: true };
  }
  // add
  if (nums.length !== 2) return { action, error: 'usage' };
  const shares = num(nums[0]);
  const cost = num(nums[1]);
  if (!(shares > 0 && shares <= 1e9)) return { action, error: 'shares' };
  if (!(cost > 0 && cost <= 1e9)) return { action, error: 'cost' };
  const bad = holdable(sym.id);
  if (bad) return { action, ...bad };
  return { action, ticker: sym.id, shares, cost, mutates: true };
}

// "10.5" not "10.500000", "150.123457" at most for costs.
export function plain(n, dp = 6) {
  return String(round(n, dp));
}

export function pfInput(a) {
  if (a.error || !a.mutates) return null;
  if (a.action === 'add') return `PF ADD ${a.ticker} ${plain(a.shares)} @ ${plain(a.cost)}`;
  if (a.action === 'sell') return `PF SELL ${a.ticker} ${a.shares === 'ALL' ? 'ALL' : plain(a.shares)}`;
  if (a.action === 'remove') return `PF REMOVE ${a.ticker}`;
  if (a.action === 'clear') return 'PF CLEAR';
  if (a.action === 'import') return `PF IMPORT ${a.holdings.map(csvLine).join(' ')}`;
  return null;
}

// ---- CSV: ticker,shares,cost ----------------------------------------------------

const csvLine = (h) => `${h.ticker},${plain(h.shares)},${plain(h.cost)}`;

export function toCsv(holdings) {
  return ['ticker,shares,cost', ...holdings.map(csvLine)].join('\n') + '\n';
}

// Lines of ticker,shares,cost (commas, semicolons or tabs; an optional header line).
// The same ticker twice merges into a weighted average. Returns { holdings, errors }.
export function parseCsv(text) {
  let holdings = [];
  const errors = [];
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /^(ticker|symbol)$/i.test(cells[0])) return;
    const { ids, bad } = parseSymbols([cells[0] || '']);
    const shares = num(cells[1]);
    const cost = num(cells[2]);
    if (cells.length !== 3 || bad.length || ids.length !== 1 || !(shares > 0) || !(cost > 0)) {
      errors.push({ line: i + 1, text: line });
      return;
    }
    if (holdable(ids[0])) { errors.push({ line: i + 1, text: line }); return; }
    if (holdings.length >= MAX_HOLDINGS && !holdings.some((h) => h.ticker === ids[0])) { errors.push({ line: i + 1, text: line }); return; }
    holdings = addLot(holdings, { ticker: ids[0], shares, cost });
  });
  return { holdings, errors };
}

// ---- Storage ---------------------------------------------------------------------

const valid = (h) => h && typeof h.ticker === 'string' && h.ticker.length <= 16 && h.shares > 0 && h.cost > 0 && Number.isFinite(h.shares) && Number.isFinite(h.cost);

export function loadPortfolio(store) {
  const v = store.get(PF_KEY, []);
  return Array.isArray(v) ? v.filter(valid).slice(0, MAX_HOLDINGS) : [];
}

export function savePortfolio(store, holdings) {
  store.set(PF_KEY, holdings.filter(valid).slice(0, MAX_HOLDINGS));
}
