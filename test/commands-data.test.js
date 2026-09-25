import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../data/cache.js';
import { money, capNum, usDay, isIsoDay, addDays, makeCnbcList } from '../data/lists.js';
import { parseSp100, pickMovers, SP100, SECTORS } from '../data/sp100.js';
import { contractMonth, COMMODITIES } from '../data/commodities.js';
import { monthBefore, periodChanges } from '../data/sectors.js';
import { parseTreasuryCsv, rowOnOrBefore, yearBefore, makeCurve } from '../data/curve.js';
import { parseCoins } from '../data/crypto.js';
import { crossRates, lastTwoDays } from '../data/fxmatrix.js';
import { parseEarnings, weekDays } from '../data/earnings.js';
import { parseCalendar } from '../data/calendar.js';
import { parseNasdaqProfile, parseNasdaqSummary, parseSecSubmission, parseSecTickers, safeUrl } from '../data/profile.js';
import { parseOhlcv, withChanges, makeHistory } from '../data/history.js';
import { parseDividends, yearlyTotals, parseCnbcDividend, makeDividends } from '../data/dividends.js';
import { parseTickerRss } from '../data/tickernews.js';
import { normalise, parseCompareSymbols, makeCompare } from '../data/compare.js';
import { ChartError } from '../data/charts.js';
import { WORLD } from '../data/world.js';
import { BONDS } from '../data/bonds.js';

function json(body, status = 200) {
  return { ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

test('number helpers: Nasdaq money, CNBC caps, US dates', () => {
  assert.equal(money('$1,246,465,280'), 1246465280);
  assert.equal(money('($0.25)'), -0.25);
  assert.equal(money('0.32%'), 0.32);
  assert.equal(money('N/A'), null);
  assert.equal(money(''), null);
  assert.equal(capNum('4.885T'), 4.885e12);
  assert.equal(capNum('465.087B'), 465.087e9);
  assert.equal(capNum('912M'), 912e6);
  assert.equal(capNum('n/a'), null);
  assert.equal(usDay('09/24/2026'), '2026-09-24');
  assert.equal(usDay('2026-09-24'), null);
  assert.equal(isIsoDay('2026-02-30'), false);
  assert.equal(isIsoDay('2026-02-28'), true);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('fixed lists: every item has a unique id and source', () => {
  for (const list of [WORLD, BONDS, COMMODITIES]) {
    assert.equal(new Set(list.map((i) => i.id)).size, list.length);
    assert.equal(new Set(list.map((i) => i.src)).size, list.length);
  }
  assert.equal(SP100.length, 101);
  assert.equal(new Set(SP100.map((s) => s.ticker)).size, 101);
  assert.ok(SP100.every((s) => SECTORS[s.sector]), 'every member has a known sector');
});

test('CNBC list: stale-if-error after a good load', async () => {
  let t = 0;
  let fail = false;
  const cache = createCache({ retryMs: 1000, now: () => t });
  const rows = [{ symbol: '.SPX', code: 0, last: '7,700.10', change: '+2.5', change_pct: '+0.03%', last_time: '2026-09-25T10:00:00.000-0400' }];
  const fetchImpl = async () => (fail ? json({}, 500) : json({ FormattedQuoteResult: { FormattedQuote: rows } }));
  const get = makeCnbcList({ key: 'k', items: [{ id: 'SPX', src: '.SPX', name: 'S&P 500' }], ttl: 5000, fetchImpl, cache });
  const a = await get();
  assert.equal(a.rows[0].last, 7700.1);
  assert.equal(a.stale, false);
  t = 6000;
  fail = true;
  const b = await get();
  assert.equal(b.stale, true);
  assert.equal(b.rows[0].last, 7700.1);
});

test('S&P 100: parse a batch, pick movers', () => {
  const members = [
    { ticker: 'AAA', name: 'A', sector: 'TECH' }, { ticker: 'BBB', name: 'B', sector: 'FIN' },
    { ticker: 'CCC', name: 'C', sector: 'FIN' }, { ticker: 'DDD', name: 'D', sector: 'TECH' },
  ];
  const rows = [
    { symbol: 'AAA', code: 0, last: '10', change: '+1', change_pct: '+11.1%', volume: '1,000', mktcapView: '1.5B' },
    { symbol: 'BBB', code: 0, last: '20', change: '-2', change_pct: '-9.09%', volume: '5,000', mktcapView: '900M' },
    { symbol: 'CCC', code: 0, last: '30', change: 'UNCH', change_pct: 'UNCH', volume: '2,000', mktcapView: '2T' },
    { symbol: 'DDD', code: 1, last: '' },
  ];
  const s = parseSp100(rows, members);
  assert.equal(s.length, 3);
  assert.equal(s[0].marketCap, 1.5e9);
  assert.equal(s[2].changePct, 0);
  const m = pickMovers(s, 10);
  assert.deepEqual(m.gainers.map((x) => x.ticker), ['AAA']);
  assert.deepEqual(m.losers.map((x) => x.ticker), ['BBB']);
  assert.deepEqual(m.active.map((x) => x.ticker), ['BBB', 'CCC', 'AAA']);
});

test('commodities: contract month from the CNBC name', () => {
  assert.equal(contractMonth("WTI Crude (Nov'26)"), "NOV'26");
  assert.equal(contractMonth('Gold'), null);
});

test('sectors: 1 month and year-to-date changes from daily closes', () => {
  assert.equal(monthBefore('2026-09-25'), '2026-08-25');
  assert.equal(monthBefore('2026-03-31'), '2026-02-28');
  assert.equal(monthBefore('2026-01-15'), '2025-12-15');
  const at = (d) => Date.parse(`${d}T04:00:00Z`); // midnight New York in summer, 23:00 the day before in winter
  const pts = [
    { t: Date.parse('2025-12-31T05:00:00Z'), v: 100 },
    { t: Date.parse('2026-01-02T05:00:00Z'), v: 101 },
    { t: at('2026-08-24'), v: 110 },
    { t: at('2026-08-25'), v: 120 },
    { t: at('2026-08-26'), v: 125 },
  ];
  const c = periodChanges(pts, 132, '2026-09-25');
  assert.equal(Math.round(c.m1 * 100) / 100, 10);
  assert.equal(Math.round(c.ytd * 100) / 100, 32);
  assert.deepEqual(periodChanges([], 10, '2026-09-25'), { m1: null, ytd: null });
});

const TSY = `Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
09/24/2026,4.01,4.10,4.18,4.24,4.33,4.34,4.51,4.87,4.99,5.03,5.10,5.18,5.53,5.47
08/25/2026,3.79,,,3.86,,3.95,4.01,4.17,4.25,4.35,4.48,4.64,5.16,5.17
08/21/2026,3.70,,,3.80,,3.90,4.00,4.10,4.20,4.30,4.40,4.50,5.00,5.00
`;

test('curve: Treasury CSV parsing and date picks', () => {
  const rows = parseTreasuryCsv(TSY);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, '2026-08-21', 'oldest first');
  assert.equal(rows[2].yields['10Y'], 5.18);
  assert.equal(rows[1].yields['1M'], 3.79);
  assert.equal(rowOnOrBefore(rows, '2026-08-24').date, '2026-08-21');
  assert.equal(rowOnOrBefore(rows, '2026-08-01'), null);
  assert.equal(yearBefore('2028-02-29'), '2027-02-28');
  assert.throws(() => parseTreasuryCsv('nope'), /unexpected header/);
});

test('curve: today from CNBC, history from Treasury, one source down is fine', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('treasury.gov')) return url.includes('/2026/') ? json(TSY) : json('', 404);
    return json({ FormattedQuoteResult: { FormattedQuote: [{ symbol: 'US10Y', code: 0, last: '5.2%', change: '+0.02', change_pct: '+0.4%' }, { symbol: 'US2Y', code: 0, last: '4.9%', change: '0', change_pct: '0' }, ...['US1M', 'US3M', 'US6M', 'US1Y', 'US3Y', 'US5Y', 'US7Y', 'US20Y', 'US30Y'].map((s) => ({ symbol: s, code: 0, last: '4.5%', change: '0', change_pct: '0' }))] } });
  };
  const { getCurve } = makeCurve({ fetchImpl, now: () => Date.parse('2026-09-25T15:00:00Z') });
  const d = await getCurve();
  const ten = d.tenors.find((t) => t.id === '10Y');
  assert.equal(ten.now, 5.2);
  assert.equal(ten.m1, 4.64);
  assert.equal(d.m1Date, '2026-08-25');
  assert.equal(d.y1Date, null, 'last year file missing: no 1Y column, nothing made up');
  assert.equal(ten.y1, null);
});

test('crypto: CoinGecko rows, ranked', () => {
  const coins = parseCoins([
    { id: 'eth', symbol: 'eth', name: 'Ethereum', market_cap_rank: 2, current_price: 2000, price_change_percentage_24h_in_currency: -1.5, price_change_percentage_7d_in_currency: 3, market_cap: 2e11, total_volume: 1e10 },
    { id: 'btc', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, current_price: 83000, price_change_percentage_24h: -0.8, market_cap: 1.6e12 },
    { id: 'bad', symbol: '', name: 'x', current_price: 1 },
  ]);
  assert.deepEqual(coins.map((c) => c.symbol), ['BTC', 'ETH']);
  assert.equal(coins[0].change24h, -0.8);
  assert.equal(coins[0].change7d, null);
  assert.throws(() => parseCoins({}), /unexpected shape/);
});

test('FX matrix: cross rates from USD rates', () => {
  const m = crossRates({ EUR: 0.8, JPY: 160 }, ['USD', 'EUR', 'JPY']);
  assert.equal(m.USD.EUR, 0.8);
  assert.equal(m.EUR.USD, 1.25);
  assert.equal(m.EUR.JPY, 200);
  assert.equal(m.JPY.EUR, 0.005);
  assert.equal(m.JPY.JPY, 1);
  for (const a of ['USD', 'EUR', 'JPY']) for (const b of ['USD', 'EUR', 'JPY']) assert.ok(Math.abs(m[a][b] * m[b][a] - 1) < 1e-12);
  const missing = crossRates({ EUR: 0.8 }, ['USD', 'EUR', 'THB']);
  assert.equal(missing.EUR.THB, null);
  const two = lastTwoDays({ rates: { '2026-09-24': { EUR: 0.9 }, '2026-09-25': { EUR: 0.8 }, '2026-09-23': { EUR: 1 } } });
  assert.deepEqual([two.date, two.prevDate, two.rates.EUR, two.prevRates.EUR], ['2026-09-25', '2026-09-24', 0.8, 0.9]);
});

test('earnings: Nasdaq rows, biggest first; weekends are empty; week days', () => {
  const rows = parseEarnings({ data: { rows: [
    { symbol: 'SMOL', name: 'Small', time: 'time-not-supplied', marketCap: '$1,000', epsForecast: '', noOfEsts: '1', lastYearEPS: 'N/A', lastYearRptDt: 'N/A' },
    { symbol: 'BIG', name: 'Big Co', time: 'time-pre-market', marketCap: '$2,000,000', epsForecast: '($0.25)', noOfEsts: '2', lastYearEPS: '$1.10', lastYearRptDt: '9/25/2025' },
    { symbol: '<script>', name: 'x' },
  ] } });
  assert.deepEqual(rows.map((r) => r.ticker), ['BIG', 'SMOL']);
  assert.equal(rows[0].time, 'BEFORE OPEN');
  assert.equal(rows[0].epsForecast, -0.25);
  assert.equal(rows[0].lastYearDate, '2025-09-25');
  assert.equal(rows[1].time, null);
  assert.equal(rows[1].epsForecast, null);
  assert.deepEqual(parseEarnings({ data: { rows: null } }), []);
  assert.throws(() => parseEarnings({}), /unexpected shape/);
  assert.deepEqual(weekDays('2026-09-25'), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  assert.deepEqual(weekDays('2026-09-27')[0], '2026-09-21', 'Sunday belongs to the week before');
});

test('calendar: Forex Factory events, sorted, junk dropped', () => {
  const ev = parseCalendar([
    { title: 'CPI m/m', country: 'USD', date: '2026-09-23T08:30:00-04:00', impact: 'High', forecast: '0.3%', previous: '0.2%' },
    { title: 'Bank Holiday', country: 'JPY', date: '2026-09-20T19:00:00-04:00', impact: 'Holiday', forecast: '', previous: '' },
    { title: '', country: 'USD', date: '2026-09-23T08:30:00-04:00' },
    { title: 'Bad date', country: 'USD', date: 'soon' },
    { title: 'Odd impact', country: 'EUR', date: '2026-09-24T04:00:00-04:00', impact: 'Huge' },
  ]);
  assert.deepEqual(ev.map((e) => e.title), ['Bank Holiday', 'CPI m/m', 'Odd impact']);
  assert.equal(ev[1].time, '2026-09-23T12:30:00.000Z');
  assert.equal(ev[0].forecast, null);
  assert.equal(ev[2].impact, 'Low');
});

test('profile: Nasdaq profile and summary, SEC address and tickers', () => {
  const p = parseNasdaqProfile({ data: { CompanyName: { value: 'Apple Inc.' }, Sector: { value: 'Technology' }, Industry: { value: 'Computer Manufacturing' }, CompanyDescription: { value: 'Makes phones.' }, CompanyUrl: { value: 'https://www.apple.com' } } });
  assert.deepEqual([p.name, p.sector, p.website], ['Apple Inc.', 'Technology', 'https://www.apple.com/']);
  assert.equal(parseNasdaqProfile({ data: null }), null);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(parseNasdaqSummary({ data: { summaryData: { MarketCap: { value: '4,889,561,096,300' }, Exchange: { value: 'NASDAQ-GS' } } } }).marketCap, 4889561096300);
  const sec = parseSecSubmission({ fiscalYearEnd: '0926', addresses: { business: { city: 'CUPERTINO', stateOrCountry: 'CA', isForeignLocation: null } } });
  assert.deepEqual(sec, { hq: 'Cupertino, CA', fiscalYearEnd: 'SEP 26' });
  const foreign = parseSecSubmission({ fiscalYearEnd: '1231', addresses: { business: { city: 'DUBLIN 2', stateOrCountry: 'L2', isForeignLocation: 1, country: 'IRELAND' } } });
  assert.equal(foreign.hq, 'Dublin 2, IRELAND');
  const map = parseSecTickers({ 0: { cik_str: 320193, ticker: 'AAPL' }, 1: { cik_str: 1067983, ticker: 'BRK-B' } });
  assert.equal(map.get('BRK-B'), 1067983);
});

test('history: OHLCV rows newest first with close-to-close change', () => {
  const rows = withChanges(parseOhlcv([
    { tradeTime: '20260923000000', open: '10', high: '11', low: '9', close: '10', volume: 100 },
    { tradeTime: '20260924000000', open: '10', high: '12', low: '10', close: '11', volume: 200 },
    { tradeTime: '20260924000000', open: '10', high: '12', low: '10', close: '11', volume: 200 },
    { tradeTime: 'bad', close: '5' },
    { tradeTime: '20260925000000', close: '0' },
  ]));
  assert.deepEqual(rows.map((r) => r.d), ['2026-09-24', '2026-09-23']);
  assert.equal(rows[0].chg, 10);
  assert.equal(rows[1].chg, null);
  assert.deepEqual([rows[0].o, rows[0].h, rows[0].l, rows[0].c, rows[0].v], [10, 12, 10, 11, 200]);
});

test('history: date checks and unknown tickers', async () => {
  const fetchImpl = async (url) => (url.includes('/ZZZZ/') ? json({ status: 'ERROR' }) : json({ barData: { priceBars: [
    { tradeTime: '20260922000000', open: '1', high: '1', low: '1', close: '1', volume: 1 },
    { tradeTime: '20260924000000', open: '1', high: '2', low: '1', close: '2', volume: 1 },
  ] } }));
  const { getHistory } = makeHistory({ fetchImpl, now: () => Date.parse('2026-09-25T15:00:00Z') });
  const d = await getHistory({ ticker: 'AAPL', from: '2026-09-23', to: '2026-09-25' });
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].chg, 100, 'change uses the day before the range');
  await assert.rejects(getHistory({ ticker: 'AAPL', from: '2026-09-25', to: '2026-09-01' }), /after the end/);
  await assert.rejects(getHistory({ ticker: 'AAPL', from: '2010-01-01', to: '2026-09-01' }), /10 years/);
  await assert.rejects(getHistory({ ticker: 'ZZZZ' }), (e) => e.code === 'not_found');
  await assert.rejects(getHistory({ ticker: 'not a ticker' }), (e) => e.code === 'bad_symbol');
});

test('dividends: Nasdaq history and yearly totals', () => {
  const d = parseDividends({ data: { yield: '0.32%', annualizedDividend: '1.08', exDividendDate: '08/10/2026', dividendPaymentDate: '08/13/2026', dividends: { rows: [
    { exOrEffDate: '08/10/2026', type: 'Cash', amount: '$0.27', recordDate: '08/10/2026', paymentDate: '08/13/2026', declarationDate: '07/30/2026' },
    { exOrEffDate: '11/10/2025', type: 'Cash', amount: '$0.26', paymentDate: '11/13/2025' },
    { exOrEffDate: '08/11/2025', type: 'Cash', amount: '$0.26', paymentDate: '08/14/2025' },
    { exOrEffDate: 'N/A', amount: '$1' },
  ] } } });
  assert.equal(d.yield, 0.32);
  assert.equal(d.annual, 1.08);
  assert.equal(d.rows.length, 3);
  assert.equal(d.rows[0].exDate, '2026-08-10');
  assert.deepEqual(yearlyTotals(d.rows), [{ year: '2026', total: 0.27, count: 1 }, { year: '2025', total: 0.52, count: 2 }]);
  const none = parseDividends({ data: { yield: 'N/A', annualizedDividend: 'N/A', dividends: { rows: null } } });
  assert.deepEqual([none.yield, none.rows], [null, []]);
  assert.equal(parseDividends({ data: null }), null);
});

test('ticker news: Nasdaq RSS with the publisher as source', () => {
  const xml = `<rss><channel><item><title>Apple &amp;amp; friends</title><link>https://www.nasdaq.com/articles/a</link><pubDate>Fri, 25 Sep 2026 13:20:00 +0000</pubDate><dc:creator>The Motley Fool</dc:creator></item>
    <item><title>No creator</title><link>https://www.nasdaq.com/articles/b</link><pubDate>Fri, 25 Sep 2026 12:00:00 +0000</pubDate></item>
    <item><title>Bad link</title><link>javascript:alert(1)</link></item></channel></rss>`;
  const items = parseTickerRss(xml);
  assert.deepEqual(items.map((i) => i.title), ['Apple & friends', 'No creator']);
  assert.deepEqual(items.map((i) => i.source), ['The Motley Fool', 'Nasdaq']);
});

test('compare: normalised % change and symbol checks', async () => {
  assert.deepEqual(normalise([{ t: 1, v: 50 }, { t: 2, v: 75 }, { t: 3, v: 40 }]).map((p) => p.p), [0, 50, -20]);
  assert.deepEqual(normalise([]), []);
  assert.deepEqual(parseCompareSymbols('aapl,msft msft'), ['AAPL', 'MSFT']);
  assert.equal(parseCompareSymbols('AAPL'), null);
  assert.equal(parseCompareSymbols('A,B,C,D,E,F'), null);
  const getChart = async (s) => {
    if (s === 'ZZZZ') throw new ChartError('not_found', 'x');
    return { points: [{ t: 1, v: 10 }, { t: 2, v: s === 'AAA' ? 12 : 9 }], stale: false, updated: '2026-09-25T00:00:00.000Z' };
  };
  const { getCompare } = makeCompare({ getChart, getQuote: async (s) => ({ name: `${s} Inc` }) });
  const d = await getCompare({ symbols: 'AAA,BBB', range: '1y' });
  assert.deepEqual(d.series.map((s) => s.changePct), [20, -10]);
  assert.equal(d.series[0].name, 'AAA Inc');
  await assert.rejects(getCompare({ symbols: 'AAA,ZZZZ' }), /ZZZZ/);
  await assert.rejects(getCompare({ symbols: 'AAA,BBB', range: '1D' }), (e) => e.code === 'bad_range');
});

test('dividends: NYSE stocks fall back to the CNBC yield, with no history', async () => {
  assert.deepEqual(parseCnbcDividend({ code: 0, dividend: '2.12', dividendyield: '2.41%' }), { yield: 2.41, annual: 2.12 });
  assert.equal(parseCnbcDividend({ code: 1 }), null);
  const fetchImpl = async (url) => (url.includes('nasdaq.com')
    ? json({ data: { yield: 'N/A', annualizedDividend: 'N/A', dividends: { rows: null } }, message: 'Dividend History for Non-Nasdaq symbols is not available' })
    : json({ FormattedQuoteResult: { FormattedQuote: [{ symbol: 'KO', code: 0, last: '88', dividend: '2.12', dividendyield: '2.41%' }] } }));
  const d = await makeDividends({ fetchImpl }).getDividends('KO');
  assert.deepEqual([d.yield, d.annual, d.rows.length, d.history], [2.41, 2.12, 0, false]);
});
