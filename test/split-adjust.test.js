// Split-adjusted per-share figures: FINANCIALS EPS and share counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYahooSplits, factorAfter, ratioFactor, normalizeSplits, makeSplitHistory } from '../data/split-history.js';
import { buildFinancials, withSplits, makeFinancials } from '../data/financials.js';
import { createCache } from '../data/cache.js';
import { statementTable, basisValues, basisNote, parseFinancialsArgs, financialsInput, barChartSvg, cellTitle } from '../public/screens/financials.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
// Real SEC companyfacts for Apple, 10-K full-year facts FY2015 to FY2021 (EPS, diluted
// shares, revenue), and Yahoo Finance's Apple split events.
const FACTS = fixture('sec-companyfacts-aapl-split.json');
const YAHOO = fixture('yahoo-splits-aapl.json');

test('Yahoo split events: dates are the New York ex-dates, ratios as factors', () => {
  const s = parseYahooSplits(YAHOO);
  assert.deepEqual(s.map((x) => `${x.date} ${x.ratio}`), ['1987-06-16 2:1', '2000-06-21 2:1', '2005-02-28 2:1', '2014-06-09 7:1', '2020-08-31 4:1']);
  assert.equal(parseYahooSplits({}), null);
  assert.equal(ratioFactor('1:10'), 0.1);
  assert.equal(ratioFactor('3:2'), 1.5);
  assert.equal(ratioFactor('x'), null);
});

test('factor: splits after the day only; unknown before the history starts', () => {
  const hist = { splits: parseYahooSplits(YAHOO), from: null };
  assert.equal(factorAfter(hist, '2017-11-03'), 4);
  assert.equal(factorAfter(hist, '2014-01-01'), 28);
  assert.equal(factorAfter(hist, '2020-08-31'), 1, 'the ex-date itself is already on the new basis');
  assert.equal(factorAfter(hist, '2020-08-28'), 4);
  assert.equal(factorAfter({ splits: normalizeSplits([{ date: '2014-06-09', ratio: '7:1' }]), from: '2007-01-01' }, '2006-05-01'), null);
  assert.equal(factorAfter(null, '2020-01-01'), null);
});

test('split history: WHATIF copy when Yahoo fails, null when neither has it', async () => {
  const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const h = makeSplitHistory({ fetchImpl: down, cache: createCache(), bakedFor: (t) => (t === 'AAPL' ? [{ date: '2020-08-31', ratio: '4:1' }] : null) });
  const a = await h.getSplitHistory('AAPL');
  assert.equal(a.from, '2007-01-01');
  assert.equal(a.splits[0].factor, 4);
  assert.equal(await h.getSplitHistory('ZZZZ'), null);
  const up = makeSplitHistory({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => YAHOO }), cache: createCache() });
  assert.equal((await up.getSplitHistory('AAPL')).splits.length, 5);
});

// Checked against Apple's FY2020 10-K (0000320193-20-000096), Item 6 Selected
// Financial Data, which restates FY2016 to FY2020 for the 2020 4:1 split:
// diluted EPS 3.28 2.97 2.98 2.30 2.08, diluted shares (thousands) 17,528,214
// 18,595,651 20,000,435 21,006,767 22,001,126.
test('FINANCIALS AAPL: EPS and shares before the 2020 split are put on today\'s basis', () => {
  const d = withSplits(buildFinancials(FACTS), { splits: parseYahooSplits(YAHOO), from: null, source: 'Yahoo Finance split history' });
  const a = d.annual;
  const at = (label) => a.periods.findIndex((p) => p.label === label);
  const eps = (label) => a.adjusted.epsDiluted[at(label)];
  const sh = (label) => a.adjusted.sharesDiluted[at(label)];
  // As filed: FY2016 and FY2017 last appeared in pre-split 10-Ks.
  assert.equal(a.values.epsDiluted[at('FY2017')].v, 9.21);
  assert.equal(a.values.epsDiluted[at('FY2018')].v, 2.98);
  assert.equal(eps('FY2016').v.toFixed(2), '2.08');
  assert.equal(eps('FY2017').v.toFixed(2), '2.30');
  assert.equal(eps('FY2017').asReported, 9.21);
  assert.equal(eps('FY2017').splitFactor, 4);
  assert.equal(eps('FY2018').v, 2.98);
  assert.equal(eps('FY2020').v, 3.28);
  assert.equal(Math.round(sh('FY2016').v / 1e6), 22_001);
  assert.equal(Math.round(sh('FY2017').v / 1e6), 21_007);
  assert.equal(Math.round(sh('FY2018').v / 1e6), 20_000);
  // EPS falls smoothly now: no 9.21 then 2.98 jump.
  assert.deepEqual(d.split.splits, [{ date: '2020-08-31', ratio: '4:1' }]);
  // The table: adjusted by default, filed values with REPORTED.
  const adj = statementTable(d, 'annual', 'income');
  assert.match(adj, />2\.30</);
  assert.doesNotMatch(adj, />9\.21</);
  assert.match(statementTable(d, 'annual', 'income', 'reported'), />9\.21</);
  assert.equal(basisValues(a, 'reported').epsDiluted, a.values.epsDiluted);
  assert.match(cellTitle(eps('FY2017')), /filed as 9\.21/);
  assert.match(basisNote(d), /split-adjusted .* 4:1 split on 2020-08-31/);
  assert.match(basisNote(d, 'reported'), /as reported/);
  assert.match(basisNote({ ...d, split: null }), /unavailable/);
});

test('FINANCIALS: no split history means no adjusted rows, never a guess', () => {
  const d = withSplits(buildFinancials(FACTS), null);
  assert.equal(d.split, null);
  assert.equal(d.annual.adjusted, undefined);
  assert.match(statementTable(d, 'annual', 'income'), />9\.21</);
  // History that does not reach back to the filing: "--" for that cell.
  const part = withSplits(buildFinancials(FACTS), { splits: normalizeSplits([{ date: '2020-08-31', ratio: '4:1' }]), from: '2020-01-01', source: 'x' });
  const i = part.annual.periods.findIndex((p) => p.label === 'FY2017');
  assert.equal(part.annual.adjusted.epsDiluted[i], null);
});

test('FINANCIALS service passes the split history through', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('company_tickers.json')) return { ok: true, status: 200, json: async () => ({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } }) };
    return { ok: true, status: 200, json: async () => FACTS };
  };
  const { getFinancials } = makeFinancials({ fetchImpl, cache: createCache(), gapMs: 0, splitHistory: async () => ({ splits: parseYahooSplits(YAHOO), from: null, source: 'Yahoo Finance split history' }) });
  const d = await getFinancials('AAPL');
  assert.equal(d.split.splits.length, 1);
  assert.ok(d.annual.adjusted.epsDiluted.some((c) => c?.splitFactor === 4));
});

test('FINANCIALS words: REPORTED switches the basis and round-trips', () => {
  assert.deepEqual(parseFinancialsArgs(['AAPL', 'REPORTED']), { ticker: 'AAPL', statement: 'income', period: 'annual', basis: 'reported' });
  assert.deepEqual(parseFinancialsArgs(['AAPL', 'AS', 'REPORTED', 'Q']), { ticker: 'AAPL', statement: 'income', period: 'quarterly', basis: 'reported' });
  assert.deepEqual(parseFinancialsArgs(['AAPL', 'ADJUSTED']), { ticker: 'AAPL', statement: 'income', period: 'annual' });
  assert.equal(financialsInput({ ticker: 'AAPL', statement: 'income', period: 'annual', basis: 'reported' }), 'FINANCIALS AAPL REPORTED');
});

test('FINANCIALS chart: bars centred over the table columns they belong to', () => {
  const periods = [{ label: 'FY2024' }, { label: 'FY2025' }];
  const cols = [{ x: 200, w: 100 }, { x: 300, w: 100 }];
  const svg = barChartSvg(periods, [10e9, 20e9], [1e9, 2e9], { width: 400, height: 150, cols, plotLeft: 200 });
  const labs = [...svg.matchAll(/class="ch-xlab" x="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(labs, [250, 350]);
  const hits = [...svg.matchAll(/class="fin-hit" x="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(hits, [200, 300]);
  assert.match(svg, /class="ch-ylab" x="194\.0"[^>]*text-anchor="end"/);
  // A column scrolled under the sticky label column is not drawn.
  const scrolled = barChartSvg(periods, [10e9, 20e9], [1e9, 2e9], { width: 400, height: 150, cols: [{ x: 100, w: 100 }, { x: 200, w: 100 }], plotLeft: 200 });
  assert.equal([...scrolled.matchAll(/class="fin-col"/g)].length, 1);
});
