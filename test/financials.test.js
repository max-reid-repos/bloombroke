import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildFinancials, fiscalPeriods, quarterFlows, dedupe, parseTickerMap, secTicker, makeFinancials, SEC_UA,
} from '../data/financials.js';
import { createCache } from '../data/cache.js';
import {
  parseFinancialsArgs, parseFinancialsCommand, financialsInput, fmtMillions, fmtCell, fmtRatio, statementTable, barChartSvg, shortLabel, cellTitle,
} from '../public/screens/financials.js';

// Real SEC companyfacts, cut down to the revenue and net income tags around the pinned
// years (test/fixtures/sec-companyfacts-pins.json). The pinned values were checked
// against the statements in the original 10-K filings on EDGAR:
//   Apple 10-K 0000320193-24-000123 (FY2024): net sales 391,035, net income 93,736
//   Microsoft 10-K 0000950170-24-087843 (FY2024): revenue 245,122
//   NVIDIA 10-K 0001045810-25-000023 (FY2025): revenue 130,497
const PINS = JSON.parse(readFileSync(new URL('./fixtures/sec-companyfacts-pins.json', import.meta.url), 'utf8'));
const M = 1e6;

function annualOf(r, label) {
  const i = r.annual.periods.findIndex((p) => p.label === label);
  assert.ok(i >= 0, `${label} in ${r.annual.periods.map((p) => p.label)}`);
  return { i, v: (id) => r.annual.values[id][i]?.v };
}

test('pinned 10-K values: Apple FY2024', () => {
  const r = buildFinancials(PINS['0000320193']);
  const fy = annualOf(r, 'FY2024');
  assert.equal(fy.v('revenue'), 391_035 * M);
  assert.equal(fy.v('netIncome'), 93_736 * M);
  assert.equal(r.annual.periods[fy.i].end, '2024-09-28');
  assert.equal(fmtMillions(fy.v('revenue')), '391,035');
});

test('pinned 10-K values: Microsoft FY2024', () => {
  const r = buildFinancials(PINS['0000789019']);
  assert.equal(annualOf(r, 'FY2024').v('revenue'), 245_122 * M);
});

test('pinned 10-K values: NVIDIA FY2025 (the year to January 2025, as NVIDIA labels it)', () => {
  const r = buildFinancials(PINS['0001045810']);
  const fy = annualOf(r, 'FY2025');
  assert.equal(fy.v('revenue'), 130_497 * M);
  assert.equal(r.annual.periods[fy.i].end, '2025-01-26');
});

test('Apple Q4 FY2025 = FY2025 minus Q1 to Q3, marked as worked out', () => {
  const r = buildFinancials(PINS['0000320193']);
  const i = r.quarterly.periods.findIndex((p) => p.label === 'Q4 FY2025');
  assert.ok(i >= 0);
  const c = r.quarterly.values.revenue[i];
  // 416,161 - 124,300 - 95,359 - 94,036
  assert.equal(c.v, 102_466 * M);
  assert.equal(c.derived, true);
  const q1 = r.quarterly.values.revenue[r.quarterly.periods.findIndex((p) => p.label === 'Q1 FY2025')];
  assert.equal(q1.v, 124_300 * M);
  assert.equal(q1.derived, undefined);
  assert.match(cellTitle(c), /Worked out: the full year minus Q1 to Q3. From 10-K filed /);
});

// ---- synthetic filings ----------------------------------------------------------

const F = (tag, start, end, val, form, filed, fy, fp, accn) => ({ tag, start, end, val, form, filed, fy, fp, accn });

function company(facts) {
  const gaap = {};
  for (const f of facts) {
    const unit = f.unit || 'USD';
    gaap[f.tag] ??= { units: {} };
    (gaap[f.tag].units[unit] ??= []).push({ start: f.start, end: f.end, val: f.val, form: f.form, filed: f.filed, fy: f.fy, fp: f.fp, accn: f.accn });
  }
  return { cik: 1, entityName: 'Test Co', facts: { 'us-gaap': gaap } };
}

// FY2025 = Jan to Dec 2025. Three 10-Qs, one 10-K. Cash flow only as year-to-date totals.
const YEAR = [
  F('Revenues', '2025-01-01', '2025-03-31', 100, '10-Q', '2025-05-01', 2025, 'Q1', 'q1'),
  F('Revenues', '2025-04-01', '2025-06-30', 110, '10-Q', '2025-08-01', 2025, 'Q2', 'q2'),
  F('Revenues', '2025-01-01', '2025-06-30', 210, '10-Q', '2025-08-01', 2025, 'Q2', 'q2'),
  F('Revenues', '2025-07-01', '2025-09-30', 120, '10-Q', '2025-11-01', 2025, 'Q3', 'q3'),
  F('Revenues', '2025-01-01', '2025-09-30', 330, '10-Q', '2025-11-01', 2025, 'Q3', 'q3'),
  F('Revenues', '2025-01-01', '2025-12-31', 460, '10-K', '2026-02-01', 2025, 'FY', 'k'),
  F('NetCashProvidedByUsedInOperatingActivities', '2025-01-01', '2025-03-31', 30, '10-Q', '2025-05-01', 2025, 'Q1', 'q1'),
  F('NetCashProvidedByUsedInOperatingActivities', '2025-01-01', '2025-06-30', 70, '10-Q', '2025-08-01', 2025, 'Q2', 'q2'),
  F('NetCashProvidedByUsedInOperatingActivities', '2025-01-01', '2025-09-30', 100, '10-Q', '2025-11-01', 2025, 'Q3', 'q3'),
  F('NetCashProvidedByUsedInOperatingActivities', '2025-01-01', '2025-12-31', 150, '10-K', '2026-02-01', 2025, 'FY', 'k'),
  F('PaymentsToAcquirePropertyPlantAndEquipment', '2025-01-01', '2025-12-31', 40, '10-K', '2026-02-01', 2025, 'FY', 'k'),
  { ...F('EarningsPerShareDiluted', '2025-01-01', '2025-12-31', 4.6, '10-K', '2026-02-01', 2025, 'FY', 'k'), unit: 'USD/shares' },
  { ...F('EarningsPerShareDiluted', '2025-07-01', '2025-09-30', 1.2, '10-Q', '2025-11-01', 2025, 'Q3', 'q3'), unit: 'USD/shares' },
  { ...F('Assets', undefined, '2025-12-31', 900, '10-K', '2026-02-01', 2025, 'FY', 'k') },
  { ...F('Assets', undefined, '2025-09-30', 880, '10-Q', '2025-11-01', 2025, 'Q3', 'q3') },
];

test('fiscal periods come from the filings, labelled with their fiscal year', () => {
  const { annual, quarterly } = fiscalPeriods(company(YEAR).facts['us-gaap']);
  assert.deepEqual(annual.map((p) => p.label), ['FY2025']);
  assert.deepEqual(quarterly.map((p) => p.label), ['Q1 FY2025', 'Q2 FY2025', 'Q3 FY2025', 'Q4 FY2025']);
  assert.deepEqual(quarterly.map((p) => p.end), ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31']);
});

test('quarters: filed three-month values, Q4 and cash flow worked out from year-to-date totals', () => {
  const r = buildFinancials(company(YEAR));
  const q = r.quarterly.values;
  assert.deepEqual(q.revenue.map((c) => c?.v), [100, 110, 120, 130]);
  assert.deepEqual(q.revenue.map((c) => !!c?.derived), [false, false, false, true]);
  assert.deepEqual(q.operatingCashFlow.map((c) => c?.v), [30, 40, 30, 50]);
  // Capex only for the full year: no quarter can be worked out, and no FCF.
  assert.deepEqual(q.capex.map((c) => c?.v ?? null), [null, null, null, null]);
  assert.deepEqual(q.freeCashFlow.map((c) => c?.v ?? null), [null, null, null, null]);
  // EPS does not add up: never derived, so Q4 stays empty.
  assert.deepEqual(q.epsDiluted.map((c) => c?.v ?? null), [null, null, 1.2, null]);
  assert.deepEqual(q.totalAssets.map((c) => c?.v ?? null), [null, null, 880, 900]);
  const a = r.annual.values;
  assert.equal(a.revenue[0].v, 460);
  assert.equal(a.freeCashFlow[0].v, 110);
  assert.equal(a.epsDiluted[0].v, 4.6);
  assert.equal(a.totalAssets[0].v, 900);
  assert.equal(a.cash[0], null, 'not filed, so null');
});

test('Q4 is empty when a part is missing', () => {
  // No Q2 and no nine-month total: Q1 to Q3 cannot be added up.
  const noQ2 = YEAR.filter((f) => !(f.tag === 'Revenues' && (f.accn === 'q2' || (f.accn === 'q3' && f.start === '2025-01-01'))));
  const r = buildFinancials(company(noQ2));
  const byLabel = Object.fromEntries(r.quarterly.periods.map((p, i) => [p.label, r.quarterly.values.revenue[i]?.v ?? null]));
  assert.equal(byLabel['Q3 FY2025'], 120);
  assert.equal(byLabel['Q4 FY2025'], null);
  // With the nine-month total filed, Q4 = full year minus nine months.
  const withNine = YEAR.filter((f) => !(f.tag === 'Revenues' && f.accn === 'q2'));
  const r2 = buildFinancials(company(withNine));
  assert.equal(r2.quarterly.values.revenue[r2.quarterly.periods.findIndex((p) => p.label === 'Q4 FY2025')].v, 130);
});

test('restated values: the latest filing wins', () => {
  const facts = [
    { start: '2024-01-01', end: '2024-12-31', val: 10, form: '10-K', filed: '2025-02-01', accn: 'a' },
    { start: '2024-01-01', end: '2024-12-31', val: 12, form: '10-K', filed: '2026-02-01', accn: 'b' },
    { start: '2024-01-01', end: '2024-12-31', val: 99, form: '8-K', filed: '2027-01-01', accn: 'c' },
  ];
  const d = dedupe(facts);
  assert.equal(d.length, 1);
  assert.equal(d[0].val, 12);
});

test('tag fallbacks: an older tag fills the years a newer one lacks, never mixed inside one year', () => {
  const facts = [
    F('SalesRevenueNet', '2017-01-01', '2017-12-31', 50, '10-K', '2018-02-01', 2017, 'FY', 'k17'),
    F('RevenueFromContractWithCustomerExcludingAssessedTax', '2018-01-01', '2018-12-31', 60, '10-K', '2019-02-01', 2018, 'FY', 'k18'),
    F('SalesRevenueNet', '2018-01-01', '2018-12-31', 61, '10-K', '2019-02-01', 2018, 'FY', 'k18'),
  ];
  const r = buildFinancials(company(facts));
  assert.deepEqual(r.annual.values.revenue.map((c) => [c.v, c.tag]), [[50, 'SalesRevenueNet'], [60, 'RevenueFromContractWithCustomerExcludingAssessedTax']]);
  assert.equal(r.annual.ratios.revenueGrowth[1], 20);
  assert.equal(r.annual.ratios.revenueGrowth[0], null);
});

test('margins and growth: none on a zero or negative base', () => {
  const facts = [
    F('Revenues', '2023-01-01', '2023-12-31', 100, '10-K', '2024-02-01', 2023, 'FY', 'k23'),
    F('NetIncomeLoss', '2023-01-01', '2023-12-31', -5, '10-K', '2024-02-01', 2023, 'FY', 'k23'),
    F('Revenues', '2024-01-01', '2024-12-31', 200, '10-K', '2025-02-01', 2024, 'FY', 'k24'),
    F('NetIncomeLoss', '2024-01-01', '2024-12-31', 20, '10-K', '2025-02-01', 2024, 'FY', 'k24'),
    F('GrossProfit', '2024-01-01', '2024-12-31', 80, '10-K', '2025-02-01', 2024, 'FY', 'k24'),
  ];
  const r = buildFinancials(company(facts)).annual.ratios;
  assert.deepEqual(r.netMargin, [-5, 10]);
  assert.deepEqual(r.grossMargin, [null, 40]);
  assert.deepEqual(r.netIncomeGrowth, [null, null]);
  assert.deepEqual(r.revenueGrowth, [null, 100]);
});

test('annual view keeps the last 10 fiscal years, oldest first', () => {
  const facts = [];
  for (let y = 2010; y <= 2025; y += 1) facts.push(F('Revenues', `${y}-01-01`, `${y}-12-31`, y, '10-K', `${y + 1}-02-01`, y, 'FY', `k${y}`));
  const r = buildFinancials(company(facts));
  assert.equal(r.annual.periods.length, 10);
  assert.equal(r.annual.periods[0].label, 'FY2016');
  assert.equal(r.annual.periods[9].label, 'FY2025');
  assert.equal(r.annual.ratios.revenueGrowth[0], ((2016 - 2015) / 2015) * 100, 'growth for the first column uses the year before it');
});

test('quarterFlows alone: YTD minus the running total', () => {
  const facts = [
    { tag: 'X', start: '2025-01-01', end: '2025-03-31', val: 5, form: '10-Q', filed: 'a' },
    { tag: 'X', start: '2025-01-01', end: '2025-06-30', val: 12, form: '10-Q', filed: 'b' },
  ];
  const out = quarterFlows(facts, ['2025-03-31', '2025-06-30']);
  assert.deepEqual(out.map((c) => c.v), [5, 7]);
});

test('no us-gaap facts: null', () => {
  assert.equal(buildFinancials({ facts: { 'ifrs-full': {} } }), null);
  assert.equal(buildFinancials(company([])), null);
});

// ---- service ----------------------------------------------------------------------

test('tickers: SEC map, class shares with a dash', () => {
  const map = parseTickerMap({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE' } });
  assert.equal(map.get('AAPL').cik, 320193);
  assert.equal(secTicker('brk.b'), 'BRK-B');
  assert.ok(map.get(secTicker('BRK.B')));
  assert.throws(() => parseTickerMap({}), /unexpected/);
});

test('service: SEC user agent, unknown symbols, companies without statements', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, ua: opts.headers['User-Agent'] });
    if (url.endsWith('company_tickers.json')) {
      return { ok: true, status: 200, json: async () => ({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 5, ticker: 'NOXB', title: 'No XBRL' } }) };
    }
    if (url.includes('CIK0000320193')) return { ok: true, status: 200, json: async () => PINS['0000320193'] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { getFinancials } = makeFinancials({ fetchImpl, cache: createCache(), gapMs: 0 });
  const d = await getFinancials('aapl');
  assert.equal(d.ticker, 'AAPL');
  assert.equal(d.title, 'Apple Inc.');
  assert.ok(d.annual.periods.length);
  assert.ok(calls.every((c) => c.ua === SEC_UA));
  assert.equal(SEC_UA, 'Bloombroke dev@bloombroke.com');
  assert.ok(calls.some((c) => c.url === 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json'));
  await assert.rejects(getFinancials('SHEL'), (e) => e.code === 'not_found' && e.message === 'No SEC filings for this symbol.');
  await assert.rejects(getFinancials('NOXB'), (e) => e.code === 'no_data');
  await assert.rejects(getFinancials('not a ticker'), (e) => e.code === 'bad_symbol');
  const before = calls.length;
  await getFinancials('AAPL');
  assert.equal(calls.length, before, 'cached');
});

// ---- screen helpers ---------------------------------------------------------------

test('FINANCIALS words', () => {
  assert.deepEqual(parseFinancialsArgs(['AAPL']), { ticker: 'AAPL', statement: 'income', period: 'annual' });
  assert.deepEqual(parseFinancialsArgs(['MSFT', 'BALANCE']), { ticker: 'MSFT', statement: 'balance', period: 'annual' });
  assert.deepEqual(parseFinancialsArgs(['NVDA', 'CASH', 'FLOW', 'Q']), { ticker: 'NVDA', statement: 'cashflow', period: 'quarterly' });
  assert.deepEqual(parseFinancialsArgs(['BRK.B', 'QUARTERLY', 'INCOME']), { ticker: 'BRK.B', statement: 'income', period: 'quarterly' });
  assert.equal(parseFinancialsArgs([]).error, 'usage');
  assert.equal(parseFinancialsArgs(['AAPL', 'PIZZA']).error, 'usage');
  assert.equal(parseFinancialsCommand(['NVDA', 'CASH', 'FLOW', 'Q']).input, 'FINANCIALS NVDA CASHFLOW QUARTERLY');
  assert.equal(financialsInput({ ticker: 'AAPL', statement: 'income', period: 'annual' }), 'FINANCIALS AAPL');
});

test('formats: millions, EPS, ratios, missing values', () => {
  assert.equal(fmtMillions(391_035_000_000), '391,035');
  assert.equal(fmtMillions(-1_500_000), '−2');
  assert.equal(fmtMillions(NaN), '--');
  assert.equal(fmtCell({ unit: 'eps' }, { v: 6.08 }), '6.08');
  assert.equal(fmtCell({}, null), '--');
  assert.equal(fmtRatio(46.2069), '46.2%');
  assert.equal(fmtRatio(null), '--');
  assert.equal(shortLabel('FY2024'), 'FY24');
  assert.equal(shortLabel('Q3 FY2026'), 'Q3 26');
});

test('statement table and chart: escaped, no inline styles, filing links', () => {
  const r = buildFinancials(PINS['0000320193']);
  const d = { ...r, title: '<b>Apple</b>' };
  const html = statementTable(d, 'annual', 'income');
  assert.match(html, /391,035/);
  assert.match(html, /https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/000032019324000123\/0000320193-24-000123-index\.htm/);
  assert.match(html, /MARGINS|Margins/);
  assert.doesNotMatch(html, /style=/);
  const svg = barChartSvg(r.annual.periods, r.annual.values.revenue.map((c) => c?.v ?? null), r.annual.values.netIncome.map((c) => c?.v ?? null), { width: 600, height: 150 });
  assert.match(svg, /^<svg class="chart fin-chart" width="600"/);
  assert.match(svg, /fin-bar-rev/);
  assert.doesNotMatch(svg, /style=/);
  assert.equal(barChartSvg([], [], []), '');
});

// Live check against SEC, off by default: SEC_LIVE=1 npm test
test('live SEC: pinned values still match', { skip: process.env.SEC_LIVE !== '1' }, async () => {
  const { getFinancials } = makeFinancials();
  const a = await getFinancials('AAPL');
  const i = a.annual.periods.findIndex((p) => p.label === 'FY2024');
  assert.equal(a.annual.values.revenue[i].v, 391_035 * M);
  assert.equal(a.annual.values.netIncome[i].v, 93_736 * M);
  const m = await getFinancials('MSFT');
  assert.equal(m.annual.values.revenue[m.annual.periods.findIndex((p) => p.label === 'FY2024')].v, 245_122 * M);
  const n = await getFinancials('NVDA');
  assert.equal(n.annual.values.revenue[n.annual.periods.findIndex((p) => p.label === 'FY2025')].v, 130_497 * M);
});
