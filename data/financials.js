// FINANCIALS: income statement, balance sheet and cash flow from SEC EDGAR.
// - Ticker to CIK: https://www.sec.gov/files/company_tickers.json (24 h cache).
// - Facts: https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json (24 h cache).
// SEC asks for a descriptive User-Agent and at most 10 requests a second; every call
// here goes through one queue with a gap between requests.
//
// Every value is a figure the company filed. The only arithmetic on filed figures:
// - a quarter the company only reported as part of a year-to-date total (Q4 always,
//   and cash flow quarters) is that total minus the earlier quarters, and only when
//   every part exists;
// - free cash flow = operating cash flow - capex, margins and growth from the rows shown.
// Anything else missing stays null, and the screen shows "--".
//
// Split-adjusted view (the default on the screen): EPS and share counts from a filing
// made before a later stock split are on the old share basis. Each such figure is
// put on today's basis with the split history (data/split-history.js): every split
// dated after the filing date that the figure came from. The filed values stay in
// `values`; the adjusted EPS and share rows are in `adjusted`.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { getSplitHistory, factorAfter } from './split-history.js';

export const SEC_UA = 'Bloombroke dev@bloombroke.com';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const FACTS_URL = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
const DAY = 24 * 60 * 60_000;
export const ANNUAL_COUNT = 10;
export const QUARTER_COUNT = 8;
export const FIN_TICKER_RE = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;

// kind: flow = adds up over time (quarters derive from year-to-date totals),
// point = per period but does not add up (EPS, share count), instant = balance sheet.
export const LINES = [
  { id: 'revenue', label: 'Revenue', statement: 'income', kind: 'flow', unit: 'USD', tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet'] },
  { id: 'grossProfit', label: 'Gross profit', statement: 'income', kind: 'flow', unit: 'USD', tags: ['GrossProfit'] },
  { id: 'operatingIncome', label: 'Operating income', statement: 'income', kind: 'flow', unit: 'USD', tags: ['OperatingIncomeLoss'] },
  { id: 'netIncome', label: 'Net income', statement: 'income', kind: 'flow', unit: 'USD', tags: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'] },
  { id: 'epsDiluted', label: 'EPS diluted', statement: 'income', kind: 'point', unit: 'USD/shares', tags: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'] },
  { id: 'sharesDiluted', label: 'Shares diluted', statement: 'income', kind: 'point', unit: 'shares', tags: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'] },
  { id: 'cash', label: 'Cash', statement: 'balance', kind: 'instant', unit: 'USD', tags: ['CashAndCashEquivalentsAtCarryingValue', 'Cash', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'] },
  { id: 'totalAssets', label: 'Total assets', statement: 'balance', kind: 'instant', unit: 'USD', tags: ['Assets'] },
  { id: 'totalLiabilities', label: 'Total liabilities', statement: 'balance', kind: 'instant', unit: 'USD', tags: ['Liabilities'] },
  { id: 'longTermDebt', label: 'Long-term debt', statement: 'balance', kind: 'instant', unit: 'USD', tags: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermDebt'] },
  { id: 'equity', label: "Shareholders' equity", statement: 'balance', kind: 'instant', unit: 'USD', tags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  { id: 'operatingCashFlow', label: 'Operating cash flow', statement: 'cashflow', kind: 'flow', unit: 'USD', tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'] },
  { id: 'capex', label: 'Capex', statement: 'cashflow', kind: 'flow', unit: 'USD', tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'] },
  { id: 'dividendsPaid', label: 'Dividends paid', statement: 'cashflow', kind: 'flow', unit: 'USD', tags: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'] },
];

const ANNUAL_FORMS = new Set(['10-K', '10-K/A']);
const ALL_FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A']);

export class FinancialsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const dayMs = 24 * 60 * 60_000;
export function days(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / dayMs);
}
const isYear = (d) => d >= 350 && d <= 380;
const isQuarter = (d) => d >= 80 && d <= 100;

// "BRK.B" -> "BRK-B" (how SEC writes class shares).
export function secTicker(t) {
  return String(t || '').toUpperCase().replace('.', '-');
}

// company_tickers.json -> Map("AAPL" -> { cik, title })
export function parseTickerMap(body) {
  const map = new Map();
  for (const r of Object.values(body || {})) {
    const t = String(r?.ticker || '').toUpperCase();
    const cik = Number(r?.cik_str);
    if (t && Number.isInteger(cik) && !map.has(t)) map.set(t, { cik, title: String(r.title || t) });
  }
  if (!map.size) throw new Error('sec tickers: unexpected shape');
  return map;
}

// One concept's facts, restricted to the forms we read, deduplicated by period:
// the latest filed value wins (a later filing may restate an earlier year).
export function dedupe(facts, forms = ALL_FORMS) {
  const byKey = new Map();
  for (const f of facts || []) {
    if (!forms.has(f?.form) || !Number.isFinite(f.val) || !f.end) continue;
    const key = `${f.start || ''}|${f.end}`;
    const prev = byKey.get(key);
    if (!prev || String(f.filed) > String(prev.filed) || (f.filed === prev.filed && String(f.accn) > String(prev.accn))) byKey.set(key, f);
  }
  return [...byKey.values()];
}

function unitFacts(gaap, tag, unit) {
  return gaap?.[tag]?.units?.[unit] || null;
}

// Fiscal periods, from the filings themselves. Each 10-K's main period is its latest
// full-year period; each 10-Q's is its latest period of any length. The label uses
// the fiscal year the company gave that filing (fy), so NVIDIA's year to January
// 2025 is FY2025, as NVIDIA reports it.
export function fiscalPeriods(gaap) {
  const accns = new Map();
  for (const line of LINES) {
    for (const tag of line.tags) {
      for (const f of unitFacts(gaap, tag, line.unit) || []) {
        if (!ALL_FORMS.has(f.form) || !f.start || !f.end) continue;
        const d = days(f.start, f.end);
        const annual = ANNUAL_FORMS.has(f.form);
        if (annual ? !isYear(d) : d < 80 || d > 290) continue;
        const a = accns.get(f.accn) || { accn: f.accn, form: f.form, fy: f.fy, fp: f.fp, filed: f.filed, end: '' };
        if (f.end > a.end) a.end = f.end;
        accns.set(f.accn, a);
      }
    }
  }
  const years = new Map();
  const quarters = new Map();
  const endYear = (end) => Number(end.slice(0, 4));
  const fyOf = (a) => (Number.isInteger(a.fy) && Math.abs(a.fy - endYear(a.end)) <= 1 ? a.fy : endYear(a.end));
  const earlier = (a, b) => !b || String(a.filed) < String(b.filed);
  for (const a of accns.values()) {
    if (!a.end) continue;
    if (ANNUAL_FORMS.has(a.form)) {
      const fy = fyOf(a);
      const y = { end: a.end, fy, label: `FY${fy}`, accn: a.accn, form: a.form, filed: a.filed, q: 4 };
      if (earlier(a, years.get(a.end))) years.set(a.end, y);
    } else if (/^Q[1-3]$/.test(a.fp || '')) {
      const fy = fyOf(a);
      const qn = Number(a.fp[1]);
      const qt = { end: a.end, fy, label: `Q${qn} FY${fy}`, accn: a.accn, form: a.form, filed: a.filed, q: qn };
      if (earlier(a, quarters.get(a.end))) quarters.set(a.end, qt);
    }
  }
  const annual = [...years.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
  for (const y of annual) {
    // Q4 ends with the fiscal year. A 10-Q that ends on a year end is ignored.
    quarters.set(y.end, { ...y, label: `Q4 FY${y.fy}` });
  }
  const quarterly = [...quarters.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
  return { annual, quarterly };
}

// ---- values for one concept ---------------------------------------------------

// accn: the filing the value came from (the latest filing wins, so a restated figure names
// the restating filing); the screen links each number to it.
const cell = (f, extra) => ({ v: f.val, tag: f.tag, form: f.form, filed: f.filed, accn: f.accn, ...extra });

// Annual value: a full-year fact from a 10-K ending on the fiscal year end.
function annualValue(facts, end, kind) {
  if (kind === 'instant') return facts.find((f) => !f.start && f.end === end && ANNUAL_FORMS.has(f.form)) || null;
  return facts.find((f) => f.start && f.end === end && ANNUAL_FORMS.has(f.form) && isYear(days(f.start, f.end))) || null;
}

// Quarter values for a flow concept, across the sorted quarter ends.
// quarter(E): the three-month fact ending on E, or a year-to-date fact ending on E
// minus the running total to the previous quarter end, which in turn is a filed
// year-to-date fact or a sum of filed quarters.
export function quarterFlows(facts, ends) {
  const byKey = new Map(facts.filter((f) => f.start).map((f) => [`${f.start}|${f.end}`, f]));
  const byEnd = new Map();
  for (const f of facts) {
    if (!f.start) continue;
    if (!byEnd.has(f.end)) byEnd.set(f.end, []);
    byEnd.get(f.end).push(f);
  }
  const prevOf = new Map(ends.map((e, i) => [e, i > 0 ? ends[i - 1] : null]));
  const direct = (end) => (byEnd.get(end) || []).find((f) => isQuarter(days(f.start, f.end))) || null;

  function cum(start, end, depth = 0) {
    const f = byKey.get(`${start}|${end}`);
    if (f) return f.val;
    const prev = prevOf.get(end);
    if (!prev || prev <= start || depth > 4) return null;
    const q = direct(end);
    if (!q) return null;
    const before = cum(start, prev, depth + 1);
    return before === null ? null : before + q.val;
  }

  return ends.map((end) => {
    const d = direct(end);
    if (d) return cell(d);
    const prev = prevOf.get(end);
    if (!prev) return null;
    const gap = days(prev, end);
    if (gap < 70 || gap > 110) return null;
    const ytds = (byEnd.get(end) || [])
      .filter((f) => { const n = days(f.start, f.end); return n > 100 && n <= 380 && f.start < prev; })
      .sort((a, b) => (a.start < b.start ? 1 : -1));
    for (const f of ytds) {
      const before = cum(f.start, prev);
      if (before !== null) return cell(f, { v: f.val - before, derived: true, from: f.start });
    }
    return null;
  });
}

// Per period, the first tag in the line's list that has a value. Derivations never
// mix tags: each tag's series is built on its own first.
function lineSeries(gaap, line, periods, mode) {
  const ends = periods.map((p) => p.end);
  const out = ends.map(() => null);
  for (const tag of line.tags) {
    const raw = unitFacts(gaap, tag, line.unit);
    if (!raw) continue;
    const facts = dedupe(raw, mode === 'annual' ? ANNUAL_FORMS : ALL_FORMS).map((f) => ({ ...f, tag }));
    let vals;
    if (mode === 'annual') vals = ends.map((e) => { const f = annualValue(facts, e, line.kind); return f ? cell(f) : null; });
    else if (line.kind === 'instant') vals = ends.map((e) => { const f = facts.find((x) => !x.start && x.end === e); return f ? cell(f) : null; });
    else if (line.kind === 'point') vals = ends.map((e) => { const f = facts.find((x) => x.start && x.end === e && isQuarter(days(x.start, x.end))); return f ? cell(f) : null; });
    else vals = quarterFlows(facts, ends);
    vals.forEach((v, i) => { if (!out[i] && v) out[i] = v; });
  }
  return out;
}

const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? (a / b) * 100 : null);

// Growth against the same period a year earlier (350 to 380 days before). A base at
// or below zero has no meaningful growth rate.
function growth(values, periods) {
  return periods.map((p, i) => {
    const cur = values[i]?.v;
    for (let j = i - 1; j >= 0; j -= 1) {
      const d = days(periods[j].end, p.end);
      if (d > 380) break;
      if (d >= 350) {
        const base = values[j]?.v;
        return Number.isFinite(cur) && Number.isFinite(base) && base > 0 ? ((cur - base) / base) * 100 : null;
      }
    }
    return null;
  });
}

function buildMode(gaap, periods, mode, count) {
  const values = {};
  for (const line of LINES) values[line.id] = lineSeries(gaap, line, periods, mode);
  values.freeCashFlow = periods.map((_, i) => {
    const o = values.operatingCashFlow[i];
    const c = values.capex[i];
    if (!o || !c) return null;
    // Linked to the operating cash flow filing; capex's own filing too when it differs.
    const capex = c.accn && c.accn !== o.accn ? { capex: { form: c.form, filed: c.filed, accn: c.accn } } : {};
    return { v: o.v - c.v, derived: !!(o.derived || c.derived), calc: 'OCF - capex', form: o.form, filed: o.filed, accn: o.accn, ...capex };
  });
  const ratios = {
    grossMargin: periods.map((_, i) => pct(values.grossProfit[i]?.v, values.revenue[i]?.v)),
    operatingMargin: periods.map((_, i) => pct(values.operatingIncome[i]?.v, values.revenue[i]?.v)),
    netMargin: periods.map((_, i) => pct(values.netIncome[i]?.v, values.revenue[i]?.v)),
    revenueGrowth: growth(values.revenue, periods),
    netIncomeGrowth: growth(values.netIncome, periods),
  };
  // Keep the newest `count` periods, oldest first.
  const from = Math.max(0, periods.length - count);
  const cut = (arr) => arr.slice(from);
  return {
    periods: cut(periods).map(({ end, fy, label, accn, form, filed }) => ({ end, fy, label, accn, form, filed })),
    values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, cut(v)])),
    ratios: Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, cut(v)])),
  };
}

// companyfacts JSON -> { name, cik, annual, quarterly }. Pure, for tests.
export function buildFinancials(body, { annualCount = ANNUAL_COUNT, quarterCount = QUARTER_COUNT } = {}) {
  const gaap = body?.facts?.['us-gaap'];
  if (!gaap) return null;
  const { annual, quarterly } = fiscalPeriods(gaap);
  if (!annual.length && !quarterly.length) return null;
  // Quarters keep a year of extra history for the year-over-year column and Q4 math.
  const q = quarterly.slice(-(quarterCount + 8));
  const a = annual.slice(-(annualCount + 1));
  return {
    cik: body.cik,
    name: body.entityName || null,
    annual: buildMode(gaap, a, 'annual', annualCount),
    quarterly: buildMode(gaap, q, 'quarterly', quarterCount),
  };
}

// ---- split adjustment -------------------------------------------------------------

export const SPLIT_LINES = { epsDiluted: 'divide', sharesDiluted: 'multiply' };

// One mode's per-share rows on today's share basis. A cell's factor is the product of
// the splits dated after the filing it came from; an unknown factor gives null ("--").
export function splitAdjust(mode, hist) {
  const out = {};
  for (const [id, how] of Object.entries(SPLIT_LINES)) {
    out[id] = (mode?.values?.[id] || []).map((c) => {
      if (!c) return null;
      const f = factorAfter(hist, c.filed);
      if (!f) return null;
      if (f === 1) return c;
      const v = how === 'divide' ? c.v / f : c.v * f;
      return { ...c, v, asReported: c.v, splitFactor: f };
    });
  }
  return out;
}

// The splits that change any figure shown: dated after the earliest filing on screen.
function splitsShown(d, hist) {
  const filed = [...(d.annual?.periods || []), ...(d.quarterly?.periods || [])].map((p) => p.filed).filter(Boolean).sort();
  const first = filed[0] || '';
  return (hist?.splits || []).filter((s) => s.date > first).map(({ date, ratio }) => ({ date, ratio }));
}

export function withSplits(d, hist) {
  if (!hist) return { ...d, split: null };
  return {
    ...d,
    annual: { ...d.annual, adjusted: splitAdjust(d.annual, hist) },
    quarterly: { ...d.quarterly, adjusted: splitAdjust(d.quarterly, hist) },
    split: { source: hist.source, splits: splitsShown(d, hist) },
  };
}

// ---- service ------------------------------------------------------------------

export function makeFinancials({ fetchImpl = cappedFetch, cache = createCache({ maxEntries: 300, retryMs: 60_000 }), gapMs = 150, splitHistory = fetchImpl === cappedFetch ? getSplitHistory : async () => null } = {}) {
  // One SEC request at a time, at least gapMs apart (under 10 a second).
  let chain = Promise.resolve();
  let lastAt = 0;
  function secGet(url) {
    const run = chain.then(async () => {
      const wait = lastAt + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      // maxBytes: companyfacts runs to 8 MB and more for the biggest filers.
      const res = await fetchImpl(url, { headers: { 'User-Agent': SEC_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000), maxBytes: 64 * 1024 * 1024 });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`sec HTTP ${res.status}`);
      return res.json();
    });
    chain = run.catch(() => {});
    return run;
  }

  const tickers = () => cache.cached('sec:tickers', DAY, async () => {
    const body = await secGet(TICKERS_URL);
    if (!body) throw new Error('sec tickers: missing');
    return parseTickerMap(body);
  });

  async function getFinancials(raw) {
    const ticker = String(raw ?? '').trim().toUpperCase();
    if (!FIN_TICKER_RE.test(ticker)) throw new FinancialsError('bad_symbol', 'That does not look like a ticker.');
    let map;
    try {
      map = (await tickers()).value;
    } catch (err) {
      throw new FinancialsError('unavailable', 'SEC data is taking a break. Try again in a minute.');
    }
    const hit = map.get(secTicker(ticker));
    if (!hit) throw new FinancialsError('not_found', 'No SEC filings for this symbol.');
    let r;
    try {
      r = await cache.cached(`sec:facts:${hit.cik}`, DAY, async () => {
        const body = await secGet(FACTS_URL(hit.cik));
        return body ? buildFinancials(body) : null;
      });
    } catch (err) {
      console.error('[financials]', err.message);
      throw new FinancialsError('unavailable', 'SEC data is taking a break. Try again in a minute.');
    }
    if (!r.value) throw new FinancialsError('no_data', 'No 10-K or 10-Q statements on file for this symbol. Companies outside the US often file other reports.');
    let hist = null;
    try { hist = await splitHistory(ticker); } catch { hist = null; }
    return {
      ticker,
      title: hit.title,
      ...withSplits(r.value, hist),
      updated: new Date(r.fetchedAt).toISOString(),
      stale: r.stale,
      source: 'US SEC EDGAR company filings (10-K, 10-Q)',
    };
  }

  // A new 10-Q or 10-K for this company (data/edgarwatch.js): the next view refetches.
  const forget = (cik) => cache.forget(`sec:facts:${Number(cik)}`);
  return { getFinancials, forget };
}

export const { getFinancials, forget: forgetFinancials } = makeFinancials();
