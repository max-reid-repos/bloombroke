// Data-correctness regressions from the live-site audit (Sep 2026): SCREEN session
// labels and preset form values, and the rest of the list screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeScreen } from '../data/screen.js';
import { createCache } from '../data/cache.js';
import { parseScreenArgs, screenWords } from '../public/screener.js';
import { formValues, wordsFromForm, presetValues, asOfLine, resultsTable } from '../public/screens/screen.js';
import { parseExDiv, cleanExDiv, exDivProblem, makeSplits } from '../data/splits.js';
import { exdivTable } from '../public/screens/exdiv.js';
import { parseCoins, excludeCoins, makeCrypto } from '../data/crypto.js';
import { shapeBars, barEnds, isPartial, makeCharts } from '../data/charts.js';
import { stripItems, barDay } from '../public/screens/chart.js';
import { parseQuoteRow, decimalsIn } from '../data/quotes.js';
import { precise52, closesRange, roundedRange } from '../data/range52.js';
import { statRows } from '../public/screens/quote.js';
import { parseFedFutures, withGaps, makeFedPath, FF_SYMBOLS } from '../data/fedpath.js';
import { linesSvg } from '../public/screens/lines.js';
import { stepPoints } from '../public/screens/fedpath.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const json = (body) => ({ ok: true, status: 200, json: async () => body });

// ---- SCREEN ---------------------------------------------------------------------
// Real Nasdaq screener answer taken at 12:32 New York time on 2026-09-25: the file
// still says "Last price as of Sep 24, 2026" (AAPL 335.92 was the Sep 24 close).
const SCR = fixture('nasdaq-screener-asof.json');

test('SCREEN: the answer says which session the numbers are from', async () => {
  const fetchImpl = async (url) => json(url.includes('download=true') ? { data: { rows: SCR.data.table.rows } } : SCR);
  const s = makeScreen({ fetchImpl, cache: createCache(), getFundMap: async () => new Map(), now: () => Date.parse('2026-09-25T16:32:00Z') });
  const d = await s.getScreen('GAINERS');
  assert.equal(d.asOf, '2026-09-24');
  assert.equal(d.today, '2026-09-25');
  const line = asOfLine(d.asOf, d.today);
  assert.match(line, /Screener data as of SEP 24 close/);
  assert.match(line, /not today/);
  assert.match(line, /MOVERS/);
  assert.doesNotMatch(asOfLine('2026-09-25', '2026-09-25'), /close|not today/);
  assert.match(asOfLine(null, '2026-09-25'), /date unknown/);
  assert.match(resultsTable(d.rows, parseScreenArgs('GAINERS'), d.asOf), />%Chg SEP 24/);
});

test('SCREEN form: a preset fills its own boxes, and they do not become extra words', () => {
  assert.deepEqual(presetValues('GAINERS'), { CHG_min: '0', MCAP_min: '300M' });
  assert.deepEqual(presetValues('LOSERS'), { CHG_max: '0', MCAP_min: '300M' });
  const v = formValues(parseScreenArgs('GAINERS'));
  assert.equal(v.CHG_min, '0');
  assert.equal(v.MCAP_min, '300M');
  assert.deepEqual(wordsFromForm(v), { words: 'GAINERS' });
  // A typed rule on the same box wins, and stays a word of its own.
  const spec = parseScreenArgs('GAINERS MCAP>10B');
  const w = formValues(spec);
  assert.equal(w.MCAP_min, '10B');
  assert.deepEqual(wordsFromForm(w, spec.sort), { words: screenWords(spec) });
  // Without the preset the same values are ordinary rules.
  assert.deepEqual(wordsFromForm({ ...v, preset: '' }), { words: 'MCAP>300M CHG>0' });
});

// ---- EXDIV ----------------------------------------------------------------------
// Real Nasdaq dividend-calendar rows (Sep 28 and 29, 2026): ERIC lists payment on
// 9/25 for a record date of 9/29; GGAL and BZ list a historical annual dividend of 0.
test('EXDIV: impossible date orders are left out and named, zero annual amounts are "--"', async () => {
  const body = fixture('nasdaq-exdiv-checks.json');
  const rows = parseExDiv(body.data);
  assert.equal(rows.find((r) => r.symbol === 'GGAL').annual, null);
  assert.equal(rows.find((r) => r.symbol === 'BZ').annual, null);
  assert.equal(rows.find((r) => r.symbol === 'GSBC').annual, 1.72);
  assert.equal(exDivProblem(rows.find((r) => r.symbol === 'ERIC')), 'paid before the record date');
  assert.equal(exDivProblem({ record: '2026-09-28', announced: '2026-09-30' }), 'record date before the announcement');
  assert.equal(exDivProblem(rows.find((r) => r.symbol === 'GSBC')), null);
  const c = cleanExDiv(rows);
  assert.deepEqual(c.rows.map((r) => r.symbol), ['BZ', 'GGAL', 'GSBC']);
  assert.deepEqual(c.dropped.map((r) => r.symbol), ['ERIC']);
  const html = exdivTable(c.rows);
  assert.doesNotMatch(html, /\$0\.0000/);
  assert.match(html, />--</);
  const sp = makeSplits({ fetchImpl: async () => json(body), cache: createCache(), now: () => Date.parse('2026-09-26T15:00:00Z') });
  const one = await sp.getExDiv('2026-09-29');
  assert.deepEqual(one.days[0].dropped, [{ symbol: 'ERIC', company: 'Ericsson American Depositary Shares', why: 'paid before the record date' }]);
  assert.ok(one.days[0].rows.every((r) => r.symbol !== 'ERIC'));
});

// ---- CRYPTO ---------------------------------------------------------------------
// Real CoinGecko top 40 by market cap (2026-09-25): USDT #3, USDC #6, FIGR_HELOC #10
// (a tokenised pool of home equity loans), USDS #16.
test('CRYPTO: top 20 without stablecoins or tokenised assets', async () => {
  const top = fixture('coingecko-top40.json');
  const { coins, excluded } = excludeCoins(parseCoins(top), ['tether', 'usd-coin', 'usds']);
  assert.equal(coins.length, 20);
  const ids = coins.map((c) => c.id);
  for (const bad of ['tether', 'usd-coin', 'usds', 'figure-heloc', 'ethena-usde', 'dai']) assert.ok(!ids.includes(bad), bad);
  assert.deepEqual(ids.slice(0, 4), ['bitcoin', 'ethereum', 'binancecoin', 'ripple']);
  assert.deepEqual(excluded.map((c) => `${c.symbol} ${c.why}`), ['USDT stablecoin', 'USDC stablecoin', 'FIGR_HELOC tokenised asset', 'USDS stablecoin']);
  // The hand list still catches the big stablecoins when CoinGecko's category is down.
  assert.ok(!excludeCoins(parseCoins(top), null).coins.some((c) => c.id === 'tether'));
  let calls = 0;
  const fetchImpl = async (url) => { calls += 1; return url.includes('category=stablecoins') ? { ok: false, status: 429, json: async () => ({}) } : json(top); };
  const d = await makeCrypto({ fetchImpl, cache: createCache() }).getCrypto();
  assert.equal(d.coins.length, 20);
  assert.equal(d.stableSource, 'hand list');
  assert.match(d.note, /excluding stablecoins/);
  assert.equal(calls, 2);
});

// ---- chart legends ---------------------------------------------------------------
// Real CNBC AAPL bars, Dec 2022 to Apr 2023. Weekly bars are stamped with the Sunday
// their week starts (2023-01-01, a market holiday); the 129.62 close is Friday Jan 6's.
// The source has no Apr 6, 2023 daily bar: the week of Apr 2 closes at 163.76, which
// is its Apr 5 close (Apr 7 was Good Friday).
const W1 = shapeBars(fixture('cnbc-bars-aapl-1w.json').barData.priceBars);
const D1 = shapeBars(fixture('cnbc-bars-aapl-1d.json').barData.priceBars);
const nyDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

test('weekly bars carry the trading day of their close', () => {
  const pts = barEnds(W1, D1);
  const jan = pts.find((p) => p.d.startsWith('20230101'));
  assert.equal(jan.v, 129.62);
  assert.equal(nyDate(jan.e), '2023-01-06');
  const apr = pts.find((p) => p.d.startsWith('20230402'));
  assert.equal(nyDate(apr.e), '2023-04-05');
  assert.ok(pts.every((p) => !p.e || ![0, 6].includes(new Date(`${nyDate(p.e)}T12:00:00Z`).getUTCDay())), 'never a weekend');
  // A close that does not match the daily bar is not given a day.
  const off = barEnds([{ ...W1[5], v: W1[5].v + 5 }], D1);
  assert.equal(off[0].e, undefined);
  assert.equal(isPartial('20260920', '1W', '2026-09-25'), true);
  assert.equal(isPartial('20260913', '1W', '2026-09-25'), false);
  assert.equal(isPartial('20260901', '1MO', '2026-09-25'), true);
});

test('legend: weekly closes, real dates, and the live price is not a close', () => {
  const pts = barEnds(W1, D1).map(({ t, v, e }) => ({ t, v, ...(e ? { e } : {}) }));
  const live = [...pts, { t: pts[pts.length - 1].t + 86_400_000, v: 999, live: true }];
  const items = stripItems(live, null, { fmtY: (v) => v.toFixed(2), bar: '1W' });
  const by = Object.fromEntries(items.map((i) => [i.k, i]));
  assert.equal(by.Last.v, '999.00');
  assert.notEqual(by['High weekly close'].v, '999.00');
  assert.equal(by['Low weekly close'].v, '129.62');
  assert.equal(by['Low weekly close'].when, 'JAN 6, 2023');
  assert.ok(items.some((i) => i.v === 'WEEKLY CLOSES'));
  // Without the daily call a bar only names its week; a running bar claims no day.
  assert.equal(barDay({ t: W1[5].t, v: 1 }, '1W'), 'WEEK OF JAN 1, 2023');
  assert.equal(barDay({ t: W1[5].t, v: 1, e: D1[0].t, p: true }, '1W'), 'THIS WEEK SO FAR');
  assert.equal(barDay({ t: D1[0].t, v: 1 }, '1D'), 'DEC 1, 2022');
  const daily = stripItems(D1.map(({ t, v }) => ({ t, v })), null, { fmtY: (v) => v.toFixed(2), bar: '1D' });
  assert.ok(daily.some((i) => i.k === 'High close'));
});

test('chart service: weekly ranges fetch daily bars for the end dates', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return json(fixture(url.includes('/1W/') ? 'cnbc-bars-aapl-1w.json' : 'cnbc-bars-aapl-1d.json')); };
  const { getChart } = makeCharts({ fetchImpl, cache: createCache(), now: () => new Date('2023-04-20T16:00:00Z') });
  const d = await getChart('AAPL', '5Y');
  assert.equal(d.bar, '1W');
  assert.ok(urls.some((u) => u.includes('/1D/')));
  const jan = d.points.find((p) => nyDate(p.t) === '2023-01-01');
  assert.equal(nyDate(jan.e), '2023-01-06');
  assert.equal(d.points[d.points.length - 1].p, true, 'the week of Apr 16, 2023 is still running on Apr 20');
  const one = await makeCharts({ fetchImpl: async (url) => { urls.push(url); return json(fixture('cnbc-bars-aapl-1d.json')); }, cache: createCache(), now: () => new Date('2023-04-20T16:00:00Z') }).getChart('AAPL', '1Y');
  assert.equal(one.points[0].e, undefined);
});

// ---- EURUSD 52-week range ---------------------------------------------------------
// Real CNBC EUR= quote and daily bars (2026-09-25). CNBC sends the 52-week range as
// 1.21 and 1.13. Cross-checked: ECB reference rates over the same year run 1.1340 to
// 1.1974 and Yahoo's daily closes 1.1354 to 1.2018 (different fixing times).
test('EURUSD: the 52-week range comes from daily closes at full precision', async () => {
  const fx = fixture('cnbc-eurusd-52w.json');
  const q = parseQuoteRow(fx.quote, 'EURUSD');
  assert.equal(decimalsIn('1.21'), 2);
  assert.equal(decimalsIn('7,040'), 0);
  assert.equal(q.range52Dp, 2);
  assert.equal(q.decimals, 4);
  assert.ok(roundedRange(q));
  const nowMs = Date.parse('2026-09-25T16:45:00Z');
  const pts = shapeBars(fx.bars.barData.priceBars).map(({ t, v }) => ({ t, v }));
  const r = closesRange(pts, nowMs);
  assert.equal(r.high, 1.2041);
  assert.equal(r.low, 1.1357);
  const p = await precise52(q, { chart: async () => ({ bar: '1D', points: pts }), now: () => nowMs });
  assert.deepEqual([p.low52, p.high52, p.range52Basis], [1.1357, 1.2041, 'daily closes']);
  assert.deepEqual(p.source52, { high: 1.21, low: 1.13, decimals: 2 });
  const row = statRows(p).find(([k]) => k.startsWith('52W'));
  assert.deepEqual(row.slice(0, 2), ['52W range (closes)', '1.1357 - 1.2041']);
  // Chart down: the source's values, at the source's own two decimals, said to be rounded.
  const down = await precise52(q, { chart: async () => { throw new Error('down'); } });
  assert.deepEqual(statRows(down).find(([k]) => k.startsWith('52W')).slice(0, 2), ['52W range (rounded)', '1.13 - 1.21']);
  // A stock quoted to its source's precision is left alone.
  const aapl = parseQuoteRow(fixture('cnbc-fund.json').FormattedQuoteResult.FormattedQuote[0], 'AAPL');
  assert.equal(await precise52(aapl, { chart: async () => { throw new Error('not called'); } }), aapl);
});

// ---- FEDPATH --------------------------------------------------------------------
// Real CNBC Fed funds futures, @FF.1 to @FF.18 (2026-09-25): 16 contracts, SEP 2026 to
// DEC 2027; @FF.17 and @FF.18 answer unknown.
test('FEDPATH: every listed contract, and a month without a price stays as a gap', async () => {
  const body = fixture('cnbc-fedfunds.json');
  const raw = body.FormattedQuoteResult.FormattedQuote;
  assert.ok(FF_SYMBOLS.length >= 16);
  const all = withGaps(parseFedFutures(raw), raw);
  assert.equal(all.length, 16);
  assert.deepEqual([all[0].month, all[2].month, all[15].month], ['2026-09', '2026-11', '2027-12']);
  assert.ok(all.every((m) => !m.gap));
  // NOV with a blank price (before its first trade): kept, marked.
  const blank = raw.map((r) => (r.symbol === '@FF.3' ? { ...r, last: '' } : r));
  const g = withGaps(parseFedFutures(blank), blank);
  assert.equal(g.length, 16);
  assert.deepEqual([g[2].month, g[2].implied, g[2].gap], ['2026-11', null, 'no price yet']);
  // NOV missing from the answer altogether: still a row, said to be missing.
  const gone = raw.filter((r) => r.symbol !== '@FF.3');
  const h = withGaps(parseFedFutures(gone), gone);
  assert.deepEqual([h[2].month, h[2].gap], ['2026-11', 'not listed by the source']);
  // The step line breaks at the gap instead of joining OCT to DEC.
  const pts = stepPoints(h.map((m) => m.implied));
  const svg = linesSvg([{ id: 'imp', cls: 'ln-0', label: 'x', points: pts, gapX: 1 }], { width: 600, height: 200 });
  assert.equal((svg.match(/<path class="ln ln-0" d="[^"]*"/)[0].match(/M/g) || []).length, 2);
  const d = await makeFedPath({ fetchImpl: async () => json(body), rates: async () => ({ fed: null, stale: false }) }).getFedPath();
  assert.equal(d.months.length, 16);
});
