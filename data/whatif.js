// WHATIF maths: in hindsight, the maker's stock instead of the thing. Pure functions, no I/O.
//
// One-off item: shares = price paid / split-adjusted close on the purchase day;
//   worth now = shares x today's price.
// Recurring item: one buy per month, on the first trading day, of that month's spend.
// Price return only: dividends are ignored.

export const PER_MONTH = {
  week: 52 / 12,
  month: 1,
  year: 1 / 12,
};

export class WhatifError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

import { parseMine, mineLabel, mineShort, MineError, MINE_DOODLE } from '../public/whatif-mine.js';
import { nyToday } from '../public/ranges.js';

// ---- Months ----------------------------------------------------------------------

export const monthKey = (date) => date.toISOString().slice(0, 7);

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(start, end) {
  const out = [];
  for (let k = start; k <= end; k = addMonths(k, 1)) out.push(k);
  return out;
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ---- Specs: LATTE:3Y, NETFLIX:2015-2024, SPOTIFY:2019 ----------------------------

// Returns { start, end, clamped } as YYYY-MM keys, or throws WhatifError.
export function parseSpec(spec, item, now = new Date()) {
  const current = monthKey(now);
  let start;
  let end = current;
  const s = String(spec ?? '').toUpperCase();
  let m;
  if (!s) {
    start = addMonths(current, -12 * item.defaultYears + 1);
  } else if ((m = /^(\d{1,2})Y$/.exec(s))) {
    const years = Number(m[1]);
    if (years < 1 || years > 30) throw new WhatifError('bad_spec', `${item.id.toUpperCase()}: pick 1 to 30 years.`);
    start = addMonths(current, -12 * years + 1);
  } else if ((m = /^(\d{4})(?:-(\d{4}))?$/.exec(s))) {
    start = `${m[1]}-01`;
    if (m[2]) end = `${m[2]}-12` < current ? `${m[2]}-12` : current;
  } else {
    throw new WhatifError('bad_spec', `${item.id.toUpperCase()}:${s} does not look right. Use years like :3Y or dates like :2015-2024.`);
  }
  let clamped = false;
  if (start < item.start) { start = item.start; clamped = true; }
  if (start > end) throw new WhatifError('bad_spec', `${item.id.toUpperCase()}: that range is before ${item.start.slice(0, 4)} or in the future.`);
  return { start, end, clamped };
}

// ---- Prices ----------------------------------------------------------------------

// Step table [{ from: 'YYYY-MM', usd }] -> the price in force in a month.
export function stepPrice(steps, key) {
  let hit = steps[0];
  for (const s of steps) if (s.from <= key) hit = s;
  return hit.usd;
}

// A monthly BLS series ({ values: { 'YYYY-MM': v } }) in a month: that month's value, or
// the last one before it (a month BLS did not publish, like October 2025, or one not out
// yet), or the first one for a month before the series starts.
export function seriesAt(series, key) {
  const values = series?.values;
  if (!values) return NaN;
  if (Number.isFinite(values[key])) return values[key];
  const keys = Object.keys(values).sort();
  let hit = values[keys[0]];
  for (const k of keys) if (k <= key) hit = values[k];
  return hit;
}

// CPI-U (BLS CUUR0000SA0) from data/bls-monthly.json: { at(key), last }.
export const CPI_SERIES = 'CUUR0000SA0';
export function cpiLoader(bls) {
  const series = bls?.series?.[CPI_SERIES];
  if (!series?.values || !Object.keys(series.values).length) throw new Error('CPI data missing');
  const keys = Object.keys(series.values).sort();
  // Months inside the series that BLS never published (Oct 2025: the shutdown). at()
  // carries the month before forward for them; `missing` says so, never silently.
  const missing = monthsBetween(keys[0], keys[keys.length - 1]).filter((k) => !(k in series.values));
  return { at: (key) => seriesAt(series, key), first: keys[0], last: keys[keys.length - 1], missing };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const monthBefore = (key) => { const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7); };

// One sentence for WHATIF Details when a replay spans a month BLS never published, or ''.
export function cpiGapNote(missing, from, to) {
  const hit = (missing || []).filter((k) => k >= from && k <= to);
  if (!hit.length) return '';
  const names = hit.map(monthName).join(', ');
  return `BLS never published CPI-U or average prices for ${names} (US government shutdown), so ${hit.map((k) => monthName(monthBefore(k))).join(', ')} is carried forward for that month.`;
}

// What one month of this habit costs. bls: data/bls-monthly.json, for items priced by a
// BLS average price series ({ series: { id, units } }: units of that series each time).
// today (New York YYYY-MM-DD): in the month still running, a daily or weekly habit counts
// only the days so far, so nothing is spent on days that have not happened. Monthly and
// yearly bills are paid at the start of the month, so they count in full.
export function monthlyCost(item, key, catalog, bls = null, today = null) {
  let unit;
  if (item.series) {
    unit = item.series.units * seriesAt(bls?.series?.[item.series.id], key);
    if (!Number.isFinite(unit)) throw new Error(`${item.id}: no ${item.series.id} price`);
  } else if (item.scaleWith) {
    const ref = catalog.recurring.find((r) => r.id === item.scaleWith).prices;
    unit = item.today * (stepPrice(ref, key) / ref[ref.length - 1].usd);
  } else {
    unit = stepPrice(item.prices, key);
  }
  const days = daysInMonth(key);
  const sofar = today && key === today.slice(0, 7) ? Math.min(days, Number(today.slice(8, 10))) : days;
  if (item.per === 'day') return unit * sofar;
  if (item.per === 'week') return unit * PER_MONTH.week * (sofar / days);
  return unit * PER_MONTH[item.per];
}

// ---- Rows and totals ------------------------------------------------------------

export function oneOffRow(product, buy, current) {
  const shares = product.price / buy.close;
  const value = shares * current;
  return {
    id: product.id, kind: 'once', name: product.name, company: product.company, ticker: product.ticker,
    launched: product.date, bought: buy.date, close: buy.close, buys: 1, paid: product.price, shares, price: current, value,
    multiple: value / product.price, note: product.note || '', src: product.src,
  };
}

// monthly: { 'YYYY-MM': { date, close } } for the first trading day of each month.
// Months after the baked data use today's price.
export function recurringRow(item, range, monthly, current, catalog, bls = null, today = null) {
  let paid = 0;
  let shares = 0;
  const months = monthsBetween(range.start, range.end);
  for (const key of months) {
    const spend = monthlyCost(item, key, catalog, bls, today);
    const close = monthly[key]?.close ?? current;
    paid += spend;
    shares += spend / close;
  }
  const value = shares * current;
  return {
    id: item.id, kind: 'monthly', name: item.name, company: item.company, ticker: item.ticker,
    bought: `${range.start} to ${range.end}`, from: range.start, to: range.end, clamped: range.clamped,
    buys: months.length, paid, shares, price: current, value, multiple: value / paid,
    note: item.note || '', startNote: item.startNote || '', src: item.src,
  };
}

export function totals(rows) {
  const paid = rows.reduce((n, r) => n + r.paid, 0);
  const value = rows.reduce((n, r) => n + r.value, 0);
  return { paid, value, gain: value - paid, multiple: paid ? value / paid : 0, pct: paid ? (value / paid - 1) * 100 : 0 };
}

// ---- Command tokens ----------------------------------------------------------------

const word = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

// Family words: a product family (IPHONE), a company (APPLE, MCDONALDS) or a category (CAR, GPU).
export function familyWords(catalog) {
  const map = new Map();
  for (const p of [...catalog.products, ...catalog.recurring]) {
    for (const w of [p.family, p.company, p.category].map(word)) {
      if (!map.has(w)) map.set(w, []);
      map.get(w).push(p.id);
    }
  }
  return map;
}

// Shelf words open the picker on that shelf (tab), with nothing picked.
export const SHELF_WORDS = ['GADGETS', 'GAMES', 'HABITS', 'VICES'];

// "IPHONE6 LATTE:3Y APPLE" -> { picks: [{ id, spec }], families: ['APPLE'], unknown: [] }
// MY items (your own purchase, public/whatif-mine.js) come out as picks with `mine`.
export function resolveTokens(tokens, catalog, now = new Date()) {
  let parsed;
  try {
    parsed = parseMine(tokens, now);
  } catch (err) {
    if (err instanceof MineError) throw new WhatifError('bad_mine', err.message);
    throw err;
  }
  tokens = parsed.rest;
  const ids = new Map([...catalog.products, ...catalog.recurring].map((p) => [p.id.toUpperCase(), p]));
  const families = familyWords(catalog);
  const picks = [];
  const fams = [];
  const unknown = [];
  for (const raw of tokens) {
    const [head, spec = ''] = String(raw).toUpperCase().split(':');
    const item = ids.get(head);
    if (item) {
      if (!picks.some((p) => p.id === item.id)) picks.push({ id: item.id, spec });
      continue;
    }
    if (SHELF_WORDS.includes(head) && !spec) { if (!fams.includes(head)) fams.push(head); continue; }
    const fam = families.get(head) ? head : families.get(head.replace(/S$/, '')) ? head.replace(/S$/, '') : null;
    if (fam && !spec) { if (!fams.includes(fam)) fams.push(fam); continue; }
    unknown.push(raw);
  }
  for (const item of parsed.mine) picks.push({ id: item.id, spec: '', mine: item });
  return { picks, families: fams, unknown };
}

// ---- Your own purchase (MY) -----------------------------------------------------------

// The catalogue-like item behind a MY habit: a fixed amount a day, week or month.
export function mineHabit(item, company) {
  return { id: item.id, name: mineLabel(item), company, ticker: item.ticker, per: item.per, prices: [{ from: item.start, usd: item.amount }] };
}
const MINE_NOTE = 'Your own purchase: daily closes from a market data provider, split-adjusted, price only (not cross-checked with a second source).';
// Words the certificate needs (short name, plural, doodle), all generated.
export function mineMeta(item) {
  return {
    short: mineShort(item),
    plural: item.kind === 'once' ? `buys of ${item.ticker}` : mineShort(item),
    family: `MY-${item.ticker}`,
    doodle: MINE_DOODLE,
  };
}

// mineData: what data/whatif-mine.js loadMine returns.
export function mineRow(item, mineData, quotes, bls = null, today = null) {
  const company = mineData.company[item.ticker] || item.ticker;
  const current = quotes[item.ticker];
  const src = `https://www.cnbc.com/quotes/${encodeURIComponent(item.ticker)}`;
  const extra = { mine: mineMeta(item), monthlyKey: `MY:${item.ticker}`, note: MINE_NOTE, src };
  if (item.kind === 'once') {
    const product = { id: item.id, name: mineLabel(item), company, ticker: item.ticker, date: item.date.day, price: item.amount };
    return { ...oneOffRow(product, mineData.buys[item.id], current), ...extra };
  }
  const habit = mineHabit(item, company);
  const row = recurringRow(habit, { start: item.start, end: item.end, clamped: false }, mineData.monthly[`MY:${item.ticker}`] || {}, current, { recurring: [] }, bls, today);
  return { ...row, ...extra, habit };
}

// Everything needed for the result screen. quotes: { TICKER: price now }.
export function computeWhatif(picks, { catalog, prices, quotes, now = new Date(), bls = null, mineData = null }) {
  if (!picks.length) throw new WhatifError('empty', 'Pick at least one thing you bought.');
  if (picks.length > 30) throw new WhatifError('too_many', 'Pick 30 things or fewer.');
  const today = nyToday(now);
  const rows = picks.map(({ id, spec, mine }) => {
    if (mine) return mineRow(mine, mineData, quotes, bls, today);
    const product = catalog.products.find((p) => p.id === id);
    if (product) {
      if (spec) throw new WhatifError('bad_spec', `${id.toUpperCase()} was a one-off buy, so it takes no dates.`);
      return oneOffRow(product, prices.buys[id], quotes[product.ticker]);
    }
    const item = catalog.recurring.find((r) => r.id === id);
    const range = parseSpec(spec, item, now);
    return recurringRow(item, range, prices.monthly[item.ticker] || {}, quotes[item.ticker], catalog, bls, today);
  });
  return { rows, total: totals(rows) };
}

// ---- Risk: the worst drop along the way -----------------------------------------------

// The worst peak-to-trough fall in a price path. points: [{ t, v, month }] oldest first.
// Returns { pct (0 or less), peakMonth, month } or null when there is nothing to measure.
export function maxDrawdown(points) {
  let peak = null;
  let worst = null;
  for (const p of points) {
    if (!(p.v > 0)) continue;
    if (!peak || p.v >= peak.v) { peak = p; continue; }
    const pct = (p.v / peak.v - 1) * 100;
    if (!worst || pct < worst.pct) worst = { pct, peakMonth: peak.month, month: p.month };
  }
  if (worst) return worst;
  return peak ? { pct: 0, peakMonth: peak.month, month: null } : null;
}

const barMonth = (t) => new Date(t).toISOString().slice(0, 7);

// A holding's price path: the close on the day of the first buy, then every month-end
// close from that month on (bars: monthly [{ t, v }], each bar's close is its month's
// last close), then today's price. Shares only change the size, so the path's worst
// drop is the holding's worst drop (for habits: of the shares from the first buy).
export function holdingPath({ date, close }, bars, current) {
  const start = String(date).slice(0, 7);
  const path = [{ v: close, month: start }];
  for (const b of bars || []) {
    const month = barMonth(b.t);
    if (month >= start) path.push({ v: b.v, month });
  }
  if (Number.isFinite(current) && current > 0) path.push({ v: current, month: 'now' });
  return path;
}

// Canonical command text for a set of picks.
export function whatifCommand(picks) {
  return ['WHATIF', ...picks.map((p) => (p.mine ? p.mine.words.join(' ') : (p.spec ? `${p.id}:${p.spec}` : p.id).toUpperCase()))].join(' ');
}

// ---- REPLAY: the race from the first buy to today --------------------------------------

// Three lines, summed over every row, at each point in time:
//   stock  the shares bought so far, at that day's close
//   jar    the same cash kept in a jar: each buy's dollars deflated by CPI-U from the
//          month it was spent to that month (what the jar still buys, in money of then)
//   spent  the running total paid (drawn below zero on screen)
// Points: the first trading day of every month (the day habits buy), each one-off
// purchase day, and today. Monthly closes come from the baked file (the first trading
// day of each month); a month past the baked data uses today's price, like the result.
// The last point is today and equals the result's totals exactly.
// Between a purchase day and the next month, a holding keeps its last known close.
export function replaySeries(result, { catalog, prices, bls, now = new Date(), asOf = null }) {
  const cpi = cpiLoader(bls);
  const current = monthKey(now);
  const monthly = (t) => prices.monthly[t] || {};
  const plans = result.rows.map((r) => {
    if (r.kind === 'once') {
      return { r, buys: [{ key: r.bought.slice(0, 7), date: r.bought, spend: r.paid, shares: r.shares, once: true }] };
    }
    const item = r.habit || catalog.recurring.find((x) => x.id === r.id);
    const m = monthly(r.monthlyKey || r.ticker);
    const buys = monthsBetween(r.from, r.to).map((key) => {
      const spend = monthlyCost(item, key, catalog, bls, nyToday(now));
      const close = m[key]?.close ?? r.price;
      return { key, date: `${key}-01`, spend, shares: spend / close };
    });
    return { r, buys };
  });
  const start = plans.map((p) => p.buys[0].key).sort()[0];
  const today = /^\d{4}-\d{2}-\d{2}/.test(asOf || '') ? String(asOf).slice(0, 10) : now.toISOString().slice(0, 10);
  const points = monthsBetween(start, current).map((key) => ({ d: `${key}-01`, key, kind: 'month' }));
  for (const p of plans) if (p.r.kind === 'once') points.push({ d: p.r.bought, key: p.r.bought.slice(0, 7), kind: 'buy', row: p.r });
  points.sort((a, b) => a.d.localeCompare(b.d) || (a.kind === 'month' ? -1 : 1));

  // A bought one-off counts from its purchase day; a habit's buy from its month's point.
  const counts = (b, pt) => (b.once ? b.date <= pt.d && !(pt.kind === 'month' && b.key === pt.key) : b.key <= pt.key);
  const last = new Map(); // ticker -> last known close
  const cpiNow = cpi.at(current);
  const out = [];
  for (const pt of points) {
    let stock = 0; let jar = 0; let spent = 0;
    const cpiThen = cpi.at(pt.key);
    for (const { r, buys } of plans) {
      let close;
      if (pt.kind === 'month') close = monthly(r.monthlyKey || r.ticker)[pt.key]?.close ?? (r.monthlyKey || pt.key > (prices.built || '').slice(0, 7) ? r.price : last.get(r.ticker));
      else if (pt.row === r) close = r.close;
      else close = last.get(r.ticker);
      if (Number.isFinite(close)) last.set(r.ticker, close);
      let shares = 0;
      for (const b of buys) {
        if (!counts(b, pt)) continue;
        shares += b.shares;
        spent += b.spend;
        jar += b.spend * (cpi.at(b.key) / cpiThen);
      }
      if (shares) stock += shares * (Number.isFinite(close) ? close : r.price);
    }
    out.push({ d: pt.d, stock: cents(stock), jar: cents(jar), spent: cents(spent) });
  }
  // Today: exactly the numbers in the table.
  let jar = 0;
  for (const { buys } of plans) for (const b of buys) jar += b.spend * (cpi.at(b.key) / cpiNow);
  out.push({ d: today > out[out.length - 1].d ? today : out[out.length - 1].d, stock: result.total.value, jar, spent: result.total.paid, now: true });
  const gap = cpiGapNote(cpi.missing, start, current);
  return { points: out, cpi: { series: CPI_SERIES, last: cpi.last, ...(gap ? { gap } : {}) } };
}
const cents = (v) => Math.round(v * 100) / 100;

