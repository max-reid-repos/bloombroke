// WHATIF maths: "the stock you should have bought". Pure functions, no I/O.
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

// What one month of this habit costs.
export function monthlyCost(item, key, catalog) {
  let unit;
  if (item.scaleWith) {
    const ref = catalog.recurring.find((r) => r.id === item.scaleWith).prices;
    unit = item.today * (stepPrice(ref, key) / ref[ref.length - 1].usd);
  } else {
    unit = stepPrice(item.prices, key);
  }
  if (item.per === 'day') return unit * daysInMonth(key);
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
export function recurringRow(item, range, monthly, current, catalog) {
  let paid = 0;
  let shares = 0;
  const months = monthsBetween(range.start, range.end);
  for (const key of months) {
    const spend = monthlyCost(item, key, catalog);
    const close = monthly[key]?.close ?? current;
    paid += spend;
    shares += spend / close;
  }
  const value = shares * current;
  return {
    id: item.id, kind: 'monthly', name: item.name, company: item.company, ticker: item.ticker,
    bought: `${range.start} to ${range.end}`, from: range.start, to: range.end, clamped: range.clamped,
    buys: months.length, paid, shares, price: current, value, multiple: value / paid,
    note: item.note || '', src: item.src,
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

// "IPHONE6 LATTE:3Y APPLE" -> { picks: [{ id, spec }], families: ['APPLE'], unknown: [] }
export function resolveTokens(tokens, catalog) {
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
    const fam = families.get(head) ? head : families.get(head.replace(/S$/, '')) ? head.replace(/S$/, '') : null;
    if (fam && !spec) { if (!fams.includes(fam)) fams.push(fam); continue; }
    unknown.push(raw);
  }
  return { picks, families: fams, unknown };
}

// Everything needed for the result screen. quotes: { TICKER: price now }.
export function computeWhatif(picks, { catalog, prices, quotes, now = new Date() }) {
  if (!picks.length) throw new WhatifError('empty', 'Pick at least one thing you bought.');
  if (picks.length > 30) throw new WhatifError('too_many', 'Pick 30 things or fewer.');
  const rows = picks.map(({ id, spec }) => {
    const product = catalog.products.find((p) => p.id === id);
    if (product) {
      if (spec) throw new WhatifError('bad_spec', `${id.toUpperCase()} was a one-off buy, so it takes no dates.`);
      return oneOffRow(product, prices.buys[id], quotes[product.ticker]);
    }
    const item = catalog.recurring.find((r) => r.id === id);
    const range = parseSpec(spec, item, now);
    return recurringRow(item, range, prices.monthly[item.ticker] || {}, quotes[item.ticker], catalog);
  });
  return { rows, total: totals(rows) };
}

// Canonical command text for a set of picks.
export function whatifCommand(picks) {
  return ['WHATIF', ...picks.map((p) => (p.spec ? `${p.id}:${p.spec}` : p.id).toUpperCase())].join(' ');
}
