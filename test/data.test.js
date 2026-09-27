import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../data/cache.js';
import { makeQuotes, parseQuoteRow, parseListRows, normalizeTicker, INSTRUMENTS, QUOTES_TTL } from '../data/quotes.js';
import { INSTRUMENTS as REGISTRY } from '../public/instruments.js';
import { makeCharts, shapeBars, lastSession } from '../data/charts.js';
import { makeCpi, inflate, latestFromBls, ANNUAL, FIRST_YEAR, LAST_YEAR } from '../data/cpi.js';
import { parseEffr, parsePmms, makeRates } from '../data/rates.js';
import { parseRss, mergeNews, cleanText, safeLink, makeNews } from '../data/news.js';

function json(body, status = 200) {
  return { ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

// ---- cache -------------------------------------------------------------------

test('cache: a failure with no entry is remembered for retryMs', async () => {
  let t = 0;
  const cache = createCache({ retryMs: 30_000, now: () => t });
  let calls = 0;
  const loader = async () => { calls += 1; throw new Error('source down'); };
  await assert.rejects(cache.cached('k', 60_000, loader), /source down/);
  await assert.rejects(cache.cached('k', 60_000, loader), /source down/);
  await assert.rejects(cache.cached('k', 60_000, loader), /source down/);
  assert.equal(calls, 1, 'the dead source is hit once, not on every request');

  t += 30_001;
  const ok = await cache.cached('k', 60_000, async () => { calls += 1; return 42; });
  assert.equal(ok.value, 42);
  assert.equal(calls, 2);
  assert.equal(ok.stale, false);
});

test('cache: stale value is served when a refresh fails, then retried later', async () => {
  let t = 0;
  const cache = createCache({ retryMs: 1000, now: () => t });
  await cache.cached('k', 5000, async () => 'v1');
  t = 6000;
  const r = await cache.cached('k', 5000, async () => { throw new Error('x'); });
  assert.deepEqual([r.value, r.stale], ['v1', true]);
  t = 7001;
  const r2 = await cache.cached('k', 5000, async () => 'v2');
  assert.deepEqual([r2.value, r2.stale], ['v2', false]);
});

// ---- quotes ------------------------------------------------------------------

const AAPL_ROW = {
  symbol: 'AAPL', code: 0, name: 'Apple Inc.', last: '335.92', change: '-1.10', change_pct: '-0.33%',
  last_time: '2026-09-24', type: 'STOCK', exchange: 'NASDAQ', currencyCode: 'USD', open: '0.00',
  mktcapView: '4.902T', pe: '38.65', eps: '8.69', yrhiprice: '345.34', yrloprice: '243.42',
  dividendyield: '0.32%', volume_alt: '22.7M', previous_day_closing: '335.92',
  ExtendedMktQuote: { type: 'PRE_MKT', last: '336.09', change: '+0.17', change_pct: '+0.05%', last_time: '2026-09-25T08:53:53.539-0400' },
};

test('quote parsing: a full CNBC stock row', () => {
  const qt = parseQuoteRow(AAPL_ROW, 'AAPL');
  assert.equal(qt.ticker, 'AAPL');
  assert.equal(qt.name, 'Apple Inc.');
  assert.equal(qt.last, 335.92);
  assert.equal(qt.change, -1.1);
  assert.equal(qt.changePct, -0.33);
  assert.equal(qt.marketCap, '4.902T');
  assert.equal(qt.pe, 38.65);
  assert.equal(qt.high52, 345.34);
  assert.equal(qt.low52, 243.42);
  assert.equal(qt.open, null, 'a zero open before the bell is not a price');
  assert.deepEqual(qt.extended, { session: 'PRE-MARKET', last: 336.09, change: 0.17, changePct: 0.05, asOf: '2026-09-25T08:53:53.539-0400' });
});

test('quote parsing: commas, percent signs, missing numbers, unknown symbols', () => {
  const idx = parseQuoteRow({ symbol: '.SPX', code: 0, name: 'S&P 500 Index', last: '7,704.13', change: '-1.90', change_pct: '-0.02%' }, 'SPX');
  assert.equal(idx.last, 7704.13);
  assert.equal(idx.pe, null);
  assert.equal(idx.marketCap, null);
  assert.equal(idx.extended, null);
  assert.equal(parseQuoteRow({ symbol: 'ZZZZZ', code: 1 }), null);
  assert.equal(parseQuoteRow({ symbol: 'X', code: 0, last: 'N/A' }), null);
  assert.equal(parseQuoteRow(undefined), null);
  const bond = parseListRows([{ id: 'US10Y', src: 'US10Y' }], [{ symbol: 'US10Y', last: '5.181%', change: '+0.019', change_pct: '+0.37%' }]);
  assert.deepEqual([bond[0].last, bond[0].change, 'src' in bond[0]], [5.181, 0.019, false]);
});

test('ticker shapes', () => {
  assert.equal(normalizeTicker('aapl'), 'AAPL');
  assert.equal(normalizeTicker('brk.b'), 'BRK.B');
  assert.equal(normalizeTicker('TOOLONG'), null);
  assert.equal(normalizeTicker('AA|BB'), null);
  assert.equal(normalizeTicker('A1'), null);
  assert.equal(normalizeTicker('eur/usd'), 'EURUSD');
  assert.equal(normalizeTicker('us10y'), 'US10Y');
  assert.equal(normalizeTicker(''), null);
});

// Every registry symbol, as the CNBC batch call returns them.
const batchRows = (extra = {}) => REGISTRY.map((i) => ({
  symbol: i.src, code: 0, name: i.name, last: '10', change: '1', change_pct: '10%', last_time: '2026-09-25T10:14:00.000-0400',
  realTime: i.kind === 'future' ? 'false' : 'true', curmktstatus: 'REG_MKT', ...extra,
}));

test('getQuote: unknown ticker is null; registry names come from the shared batch', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const sym = new URL(url).searchParams.get('symbols');
    if (sym === 'ZZZZZ') return json({ FormattedQuoteResult: { FormattedQuote: [{ symbol: 'ZZZZZ', code: 1 }] } });
    if (sym.includes('|')) return json({ FormattedQuoteResult: { FormattedQuote: batchRows() } });
    return json({ FormattedQuoteResult: { FormattedQuote: [{ ...AAPL_ROW, symbol: sym }] } });
  };
  const qs = makeQuotes({ fetchImpl });
  assert.equal(await qs.getQuote('zzzzz'), null);
  assert.equal(urls.length, 2, 'an unknown symbol is asked twice before it is unknown');
  const spx = await qs.getQuote('SPX');
  assert.equal(spx.ticker, 'SPX');
  assert.equal(spx.kind, 'index');
  assert.equal(spx.realTime, true);
  assert.ok(new URL(urls[2]).searchParams.get('symbols').split('|').includes('.SPX'));
  const gold = await qs.getQuote('gold');
  assert.deepEqual([gold.ticker, gold.kind, gold.realTime, gold.label], ['GOLD', 'spot', true, 'Spot gold (XAU)']);
  const fut = await qs.getQuote('goldfutures');
  assert.deepEqual([fut.ticker, fut.kind, fut.realTime, fut.label], ['GOLDFUT', 'future', false, 'Gold futures (COMEX)']);
  await qs.getQuote('EUR/USD');
  await qs.getQuotes();
  await qs.getFxMajors();
  assert.equal(urls.length, 3, 'one batch call serves every registry screen');
  const aapl = await qs.getQuote('aapl');
  assert.equal(aapl.kind, 'stock');
  assert.equal(await qs.getQuote('bad|sym'), null);
  assert.equal(urls.length, 4, 'bad shapes never reach the source');
});

test('GOLD and SILVER are spot (real time); the COMEX futures keep their own names (real CNBC rows)', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolveInstrument, instrumentBySrc } = await import('../public/instruments.js');
  const { precise52 } = await import('../data/range52.js');
  const { COMMODITIES } = await import('../data/commodities.js');
  const rows = JSON.parse(readFileSync(new URL('./fixtures/cnbc-gold-silver.json', import.meta.url))).FormattedQuoteResult.FormattedQuote;
  const row = (s) => rows.find((r) => r.symbol === s);
  for (const [word, id] of [['gold', 'GOLD'], ['XAU', 'GOLD'], ['spotgold', 'GOLD'], ['GOLDFUTURES', 'GOLDFUT'], ['silver', 'SILVER'], ['SPOTSILVER', 'SILVER'], ['SILVERFUTURES', 'SILVERFUT']]) {
    assert.equal(resolveInstrument(word)?.id, id, word);
  }
  const gold = parseQuoteRow(row('XAU='), 'GOLD');
  assert.deepEqual([gold.label, gold.kind, gold.realTime, gold.last], ['Spot gold (XAU)', 'spot', true, 4288.59]);
  assert.equal(gold.low52, null, 'the source sends 0.00 for the 52-week low: a placeholder, not a price');
  const fut = parseQuoteRow(row('@GC.1'), 'GOLDFUT');
  assert.deepEqual([fut.label, fut.kind, fut.realTime, fut.last, fut.low52], ['Gold futures (COMEX)', 'future', false, 4320.5, 3751.9]);
  assert.equal(parseQuoteRow(row('XAG='), 'SILVER').label, 'Spot silver (XAG)');
  assert.equal(parseQuoteRow(row('@SI.1'), 'SILVERFUT').label, 'Silver futures (COMEX)');
  // Spot's 52-week range: always from daily closes (the source's is a short window), or --.
  const closes = Array.from({ length: 30 }, (_, i) => ({ t: Date.parse('2026-09-01T20:00:00Z') - i * 86_400_000, v: 4000 + i }));
  const ok = await precise52(gold, { chart: async () => ({ bar: '1D', points: closes }), now: () => Date.parse('2026-09-25T18:00:00Z') });
  assert.deepEqual([ok.low52, ok.high52, ok.range52Basis], [4000, 4029, 'daily closes']);
  const down = await precise52(gold, { chart: async () => { throw new Error('down'); } });
  assert.deepEqual([down.low52, down.high52], [null, null], 'never the 4,314.63 "52-week high" that is only today');
  assert.equal(await precise52(fut, { chart: async () => { throw new Error('not called'); } }), fut, 'futures keep the source range');
  // COMMODITIES keeps the futures rows, and a click opens the futures screen.
  assert.equal(COMMODITIES.find((c) => c.src === '@GC.1').cmd, 'GOLDFUT');
  assert.equal(COMMODITIES.find((c) => c.src === '@SI.1').cmd, 'SILVERFUT');
  assert.equal(instrumentBySrc('XAU=').id, 'GOLD');
  // The screen says which one it is.
  const { metaLine } = await import('../public/screens/quote.js');
  const { freshnessParts } = await import('../public/freshness.js');
  assert.equal(metaLine(gold), 'USD  SPOT');
  assert.equal(metaLine(fut), 'COMEX  USD  FUTURES');
  assert.deepEqual(freshnessParts([gold, fut]), ['SPOT METALS REAL TIME', 'FUTURES DELAYED']);
});

test('quotes: 15 second cache, one upstream call however many callers', async () => {
  assert.equal(QUOTES_TTL, 15_000);
  let t = 0;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return json({ FormattedQuoteResult: { FormattedQuote: batchRows() } });
  };
  const qs = makeQuotes({ fetchImpl, cache: createCache({ now: () => t }) });
  await Promise.all(Array.from({ length: 50 }, () => qs.getQuotes()));
  assert.equal(calls, 1, '50 visitors at once, one call');
  t = 14_999;
  await qs.getQuotes();
  assert.equal(calls, 1);
  t = 15_001;
  await qs.getQuotes();
  assert.equal(calls, 2);
});

test('getQuotes: too few rows is a failure, not an empty table', async () => {
  const fetchImpl = async () => json({ FormattedQuoteResult: { FormattedQuote: [{ symbol: '.SPX', code: 0, last: '1' }] } });
  await assert.rejects(makeQuotes({ fetchImpl }).getQuotes(), /too few rows/);
  const all = async () => json({ FormattedQuoteResult: { FormattedQuote: batchRows() } });
  const r = await makeQuotes({ fetchImpl: all }).getQuotes();
  // Every MARKETS instrument, plus the 2s10s spread worked out from the 2Y and 10Y.
  assert.equal(r.instruments.length, INSTRUMENTS.length + 1);
  assert.ok(r.instruments.some((i) => i.id === 'US2S10S'));
  assert.ok(r.instruments.every((i) => typeof i.realTime === 'boolean' && !('src' in i) && !('aliases' in i)));
});

// ---- charts ------------------------------------------------------------------

const bar = (d, close) => ({ close: String(close), tradeTime: d, tradeTimeinMills: Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10), +d.slice(10, 12)) });

test('chart bars: shape, sort, and the last regular session', () => {
  const bars = [
    bar('20260924093000', 100), bar('20260924160000', 101), bar('20260924183500', 101),
    bar('20260925080000', 102), bar('20260923120000', 99), { close: 'x', tradeTime: 'bad' },
  ];
  const pts = shapeBars(bars);
  assert.equal(pts.length, 5);
  assert.ok(pts.every((p, i) => i === 0 || p.t >= pts[i - 1].t));
  const day = lastSession(pts);
  assert.deepEqual(day.map((p) => p.d), ['20260924093000'], 'pre-market today, the 16:00 bar (after-bell prints) and after-hours ticks are dropped');
  assert.equal(lastSession(pts, { usSession: false }).length, 1);
});

test('getChart: ranges, unknown symbols, cached', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url.includes('/ZZZZZ/')) return json({ status: 'ERROR', statusMessage: 'Security Master not found' });
    return json({ barData: { priceBars: [bar('20260101000000', 1), bar('20260102000000', 2)] } });
  };
  const ch = makeCharts({ fetchImpl, now: () => new Date('2026-09-25T12:00:00Z') });
  const r = await ch.getChart('aapl', '5y');
  assert.equal(r.range, '5Y');
  assert.deepEqual(r.points.map((p) => p.v), [1, 2]);
  await ch.getChart('AAPL', '5Y');
  assert.equal(calls, 2, 'weekly bars plus daily bars for their end dates, then cached');
  await assert.rejects(ch.getChart('ZZZZZ', '1Y'), (e) => e.code === 'not_found');
  await assert.rejects(ch.getChart('AAPL', '7Y'), (e) => e.code === 'bad_range');
  await assert.rejects(ch.getChart('../x', '1Y'), (e) => e.code === 'bad_symbol');
  const y = await ch.getChart('US10Y', '1Y');
  assert.equal(y.ticker, 'US10Y');
});

// ---- CPI ---------------------------------------------------------------------

test('CPI table covers 1913 to the last full year', () => {
  assert.equal(FIRST_YEAR, 1913);
  assert.ok(LAST_YEAR >= 2025);
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y += 1) assert.ok(ANNUAL[y] > 0, `year ${y}`);
  assert.equal(ANNUAL[2024], 313.689);
});

test('CPI maths and the latest BLS value', () => {
  const latest = latestFromBls({ status: 'REQUEST_SUCCEEDED', Results: { series: [{ data: [
    { year: '2026', period: 'M08', value: '334.980' },
    { year: '2026', period: 'M07', value: '333.918' },
    { year: '2025', period: 'M13', value: '321.943' },
    { year: '2025', period: 'M10', value: '-' },
  ] }] } });
  assert.deepEqual(latest, { year: 2026, month: 8, value: 334.98 });
  const r = inflate(100, 2015, latest);
  assert.equal(r.result.toFixed(2), '141.33');
  assert.ok(r.perYear > 3 && r.perYear < 3.3);
  assert.throws(() => latestFromBls({ status: 'REQUEST_NOT_PROCESSED' }));
});

test('getCpi: falls back to the static table when BLS is down; validates input', async () => {
  const cpi = makeCpi({ fetchImpl: async () => { throw new Error('down'); } });
  const r = await cpi.getCpi({ amount: '100', year: '2015' });
  assert.equal(r.latest.source, 'static');
  assert.equal(r.latest.year, LAST_YEAR);
  assert.equal(r.series[0].d, '2015');
  assert.equal(r.series[r.series.length - 1].d, String(LAST_YEAR));
  await assert.rejects(cpi.getCpi({ amount: '100', year: '1900' }), (e) => e.code === 'bad_year');
  await assert.rejects(cpi.getCpi({ amount: '1e5', year: '2000' }), (e) => e.code === 'bad_amount');
  const d = await cpi.getCpi({ year: '2000' });
  assert.equal(d.amount, 100);
});

// ---- rates -------------------------------------------------------------------

test('rates parsing: NY Fed and Freddie Mac', () => {
  assert.deepEqual(parseEffr({ refRates: [{ effectiveDate: '2026-09-23', percentRate: 3.88, targetRateFrom: 3.75, targetRateTo: 4.0 }] }),
    { from: 3.75, to: 4, effective: 3.88, date: '2026-09-23' });
  assert.throws(() => parseEffr({ refRates: [] }));
  const csv = 'date,pmms30,pmms30p,pmms15,pmms15p\n4/2/1971,7.33, ,,\n9/17/2026,6.95,,6.26,\n9/24/2026,7.03,,6.42,\n';
  const m = parsePmms(csv);
  assert.equal(m.date, '2026-09-24');
  assert.equal(m.rate30, 7.03);
  assert.equal(m.change30.toFixed(2), '0.08');
  assert.equal(m.rate15, 6.42);
});

test('getRates: one dead source leaves the others', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('newyorkfed')) throw new Error('down');
    if (url.includes('freddiemac')) return json('date,pmms30,pmms15\n9/17/2026,6.95,6.26\n9/24/2026,7.03,6.42\n');
    return json({ FormattedQuoteResult: { FormattedQuote: batchRows({ last: '5.18%', change: '+0.02' }) } });
  };
  const r = await makeRates({ fetchImpl }).getRates();
  assert.equal(r.fed, null);
  assert.equal(r.mortgage.rate30, 7.03);
  assert.equal(r.yields.length, 3);
});

// ---- news --------------------------------------------------------------------

const RSS = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Stocks &amp; bonds <b>rally</b>]]></title><link>https://example.com/a</link><pubDate>Fri, 25 Sep 2026 12:56 GMT</pubDate></item>
<item><title>China&apos;s Xi &#x2018;urges&#x2019; talks</title><link>https://example.com/b</link><pubDate>Fri, 25 Sep 2026 11:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Fri, 25 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title><script>alert(1)</script>Tagged</title><link>http://example.com/c</link></item>
</channel></rss>`;

test('news: RSS parsing cleans text and keeps only http(s) links', () => {
  const items = parseRss(RSS, 'CNBC');
  assert.deepEqual(items.map((i) => i.title), ['Stocks & bonds rally', 'China\'s Xi ‘urges’ talks', 'alert(1) Tagged']);
  assert.equal(items[0].time, '2026-09-25T12:56:00.000Z');
  assert.equal(items[2].time, null);
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('data:text/html,x'), null);
  assert.equal(safeLink('https://x.test/a?b=1&amp;c=2'), 'https://x.test/a?b=1&c=2');
  assert.equal(cleanText('  a\n  b '), 'a b');
});

test('news: merged newest first, deduped by title', () => {
  const a = [{ title: 'Fed holds rates', link: 'https://a', time: '2026-09-25T10:00:00.000Z', source: 'CNBC' }];
  const b = [
    { title: 'Fed holds rates!', link: 'https://b', time: '2026-09-25T09:00:00.000Z', source: 'MarketWatch' },
    { title: 'Oil jumps', link: 'https://c', time: '2026-09-25T11:00:00.000Z', source: 'MarketWatch' },
  ];
  const m = mergeNews([a, b]);
  assert.deepEqual(m.map((i) => i.title), ['Oil jumps', 'Fed holds rates']);
});

test('getNews: works while one feed is down, fails only when all are', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('cnbc')) throw new Error('down');
    return json(RSS);
  };
  const r = await makeNews({ fetchImpl }).getNews();
  assert.deepEqual(r.sources, ['MarketWatch', 'Yahoo Finance']);
  assert.equal(r.items.length, 3, 'same headlines from two feeds appear once');
  await assert.rejects(makeNews({ fetchImpl: async () => { throw new Error('down'); } }).getNews(), /every feed failed/);
});
