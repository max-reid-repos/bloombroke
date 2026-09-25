// Layout logic on the markets, macro, news and calendar screens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marketsColumns } from '../public/screens/markets.js';
import { moversTable, moversCompact } from '../public/screens/movers.js';

const inst = (id, group, extra = {}) => ({ id, name: id, group, last: 1, change: 0.1, changePct: 0.1, decimals: 2, realTime: true, asOf: '2026-09-24T16:00:00Z', ...extra });

test('MARKETS and HOME: group tables share one column set, MARKETS adds the time', () => {
  const rows = [inst('SPX', 'Americas'), inst('GOLD', 'Commodities', { realTime: false })];
  const home = marketsColumns(rows);
  const mk = marketsColumns(rows, { time: true });
  // Every group table gets the same colgroup, so tags and numbers line up across groups.
  assert.equal(home.match(/<colgroup>/g).length, 2);
  assert.doesNotMatch(home, /c-time/);
  assert.match(mk, /class="c-time"/);
  assert.match(mk, /mk-cols-time/);
  assert.match(mk, /class="num time dim"/);
  assert.doesNotMatch(home, /class="num time/);
  assert.match(mk, /colspan="6"/);
});

test('MOVERS: most active leads with volume; every row opens its ticker', () => {
  const rows = [{ ticker: 'INTC', name: 'Intel', last: 24.5, changePct: -2, volume: 49_300_000 }];
  const html = moversTable(rows, { volume: true });
  const heads = [...html.matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Ticker', 'Volume', 'Last', '%Chg']);
  assert.match(html, /<tr class="row-link" data-cmd="INTC" tabindex="0">/);
  assert.match(html, /49\.3M/);
  assert.ok(html.indexOf('49.3M') < html.indexOf('24.50'), 'volume before last');
  assert.doesNotMatch(moversTable(rows), /Volume/);
});

test('HOME movers panel: five gainers then five losers', () => {
  const mk = (t, p) => ({ ticker: t, name: t, last: 1, changePct: p });
  const d = { gainers: Array.from({ length: 10 }, (_, i) => mk(`G${i}`, 10 - i)), losers: [mk('L0', -3)] };
  const html = moversCompact(d);
  assert.equal((html.match(/data-cmd="G\d"/g) || []).length / 2, 5);
  assert.ok(html.indexOf('Top gainers') < html.indexOf('Top losers'));
  assert.match(moversCompact({ gainers: [], losers: [] }), /None right now/);
});

test('HEATMAP: big tiles show the % change too', async () => {
  const { tileLabels, labelSize } = await import('../public/screens/heatmap.js');
  // A wide, short big tile: the old rule dropped the %; now the ticker shrinks to fit it.
  const big = tileLabels(150, 56, 4, 6);
  assert.ok(big.fs >= 9 && big.ps >= 9, 'ticker and % both shown');
  assert.ok(big.fs <= labelSize(150, 56, 4));
  assert.ok(56 >= big.fs * 1.1 + big.ps * 1.15 + 4);
  assert.deepEqual(tileLabels(8, 8, 4), { fs: 0, ps: 0 });
  // Room for the ticker only: no %.
  assert.equal(tileLabels(40, 16, 3).ps, 0);
});

test('CLOCK: next bells from the clock rows', async () => {
  const { nextBells } = await import('../public/screens/clock.js');
  const ex = (name) => ({ name, city: name });
  const list = [
    { ex: ex('NYSE'), st: { next: 'CLOSES', minsTo: 120 }, s: { text: 'OPEN' } },
    { ex: ex('LSE'), st: { next: 'OPENS', minsTo: 900 }, s: { text: 'CLOSED' } },
    { ex: ex('TSE'), st: { next: 'OPENS', minsTo: 300 }, s: { text: 'LUNCH' } },
    { ex: ex('SSE'), st: { next: 'OPENS', minsTo: 10 }, s: { text: 'HOLIDAY' } },
  ];
  const b = nextBells(list);
  assert.deepEqual(b.open, ['NYSE']);
  assert.equal(b.nextClose.ex.name, 'NYSE');
  assert.equal(b.nextOpen.ex.name, 'TSE', 'a holiday is not the next open');
});

test('COMPARE: the standard daily ranges, chips that remove, a field that adds', async () => {
  const { RANGES, parse, addTicker, tickerChips } = await import('../public/screens/compare.js');
  const { COMPARE_RANGES } = await import('../data/compare.js');
  assert.deepEqual(RANGES, ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'MAX']);
  assert.deepEqual(COMPARE_RANGES, RANGES, 'server and screen agree');
  assert.deepEqual(parse(['KO', 'PEP', 'YTD']), { tickers: ['KO', 'PEP'], range: 'YTD' });
  assert.equal(addTicker(['AAPL', 'MSFT'], '1Y', ' nvda '), 'COMPARE AAPL MSFT NVDA 1Y');
  assert.equal(addTicker(['AAPL', 'MSFT'], '1Y', 'msft'), null, 'already there');
  assert.equal(addTicker(['A', 'B', 'C', 'D', 'E'], '1Y', 'F'), null, '5 is the most');
  assert.equal(addTicker(['AAPL', 'MSFT'], '1Y', '12$'), null);
  const three = tickerChips(['AAPL', 'MSFT', 'NVDA'], '5Y');
  assert.match(three, /data-cmd="COMPARE MSFT NVDA 5Y"/, 'removing AAPL keeps the range');
  const two = tickerChips(['AAPL', 'MSFT'], '1Y');
  assert.doesNotMatch(two, /data-cmd=/, 'two tickers cannot lose one');
  assert.match(two, /name="t"/);
});

test('FX: the converter form builds the command; swap swaps the codes', async () => {
  const { fxFormCommand, fxForm } = await import('../public/screens/fx.js');
  assert.equal(fxFormCommand('1,250.5', 'usd', 'thb'), 'FX 1250.5 USD THB');
  assert.equal(fxFormCommand('0', 'USD', 'EUR'), null);
  assert.equal(fxFormCommand('100', 'US', 'EUR'), null);
  assert.equal(fxFormCommand('2e13', 'USD', 'EUR'), null);
  const html = fxForm({ amount: 100, from: 'USD', to: 'EUR' });
  assert.match(html, /name="amount" value="100"/);
  assert.match(html, /data-swap/);
  assert.doesNotMatch(html, /Flip it/);
});

test('FXMATRIX: neutral rates with a small direction arrow', async () => {
  const { matrixTable } = await import('../public/screens/fxmatrix.js');
  const d = { codes: ['USD', 'EUR'], matrix: { USD: { EUR: 0.9 }, EUR: { USD: 1.11 } }, prev: { USD: { EUR: 0.8 }, EUR: { USD: 1.25 } } };
  const html = matrixTable(d);
  assert.match(html, /class="fxm-cell" [^>]*>0\.9000<span class="fxm-arr up"[^>]*>▲</);
  assert.match(html, /fxm-arr down/);
  assert.doesNotMatch(html, /fxm-cell (up|down)/, 'the number itself is not coloured');
});

test('CURVE: x labels thin out on narrow charts and always end at the longest term', async () => {
  const { curveTicks } = await import('../public/screens/curve.js');
  assert.equal(curveTicks(13, 900).length, 13);
  const narrow = curveTicks(13, 300);
  assert.deepEqual(narrow, [0, 2, 4, 6, 8, 10, 12]);
  assert.deepEqual(curveTicks(12, 300).slice(-2), [9, 11]);
});

test('RATES: every row opens something', async () => {
  const { ratesRows } = await import('../public/screens/rates.js');
  const rows = ratesRows({
    fed: { from: 3.75, to: 4, effective: 3.88, date: '2026-09-24' },
    yields: [{ id: 'US10Y', name: 'US 10-year Treasury', last: 5.1, change: 0.01, asOf: null }],
    mortgage: { rate30: 7, change30: 0.1, rate15: 6.4, change15: 0.1, date: '2026-09-24' },
  });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.cmd), ['FEDPATH', 'FEDPATH', 'US10Y', 'LOAN 400000 30Y', 'LOAN 400000 15Y']);
});

test('CPI: the amount and year form builds the command', async () => {
  const { cpiFormCommand, cpiForm } = await import('../public/screens/cpi.js');
  assert.equal(cpiFormCommand('$1,000', '1990', 2026), 'CPI 1000 1990');
  assert.equal(cpiFormCommand('100', '1850', 2026), null);
  assert.equal(cpiFormCommand('100', '2030', 2026), null);
  assert.equal(cpiFormCommand('-5', '2000', 2026), null);
  assert.match(cpiForm({ amount: 100, year: 2015 }), /name="year" value="2015"/);
});

test('ECONOMY: one period style, no ISO dates', async () => {
  const { periodLabel } = await import('../public/screens/economy.js');
  assert.equal(periodLabel('2026-04-01', 'Q'), 'Q2 2026');
  assert.equal(periodLabel('2026-08-01', 'M'), 'AUG 2026');
  assert.equal(periodLabel('2026-09-19', 'W'), 'SEP 19 2026');
  assert.equal(periodLabel('2026-09-04', 'D'), 'SEP 04 2026');
  assert.equal(periodLabel(null, 'D'), '--');
});

test('NEWS: source filters; phone dates as 9/24', async () => {
  const { filterNews, fmtNewsTimeShort, newsTimeHtml } = await import('../public/screens/news.js');
  const items = [{ source: 'CNBC', title: 'a' }, { source: 'MarketWatch', title: 'b' }, { source: 'Yahoo Finance', title: 'c' }];
  assert.deepEqual(filterNews(items, 'MKTW').map((n) => n.title), ['b']);
  assert.equal(filterNews(items, 'ALL').length, 3);
  const now = new Date('2026-09-25T15:00:00Z');
  assert.equal(fmtNewsTimeShort('2026-09-24T15:00:00Z', now), '9/24');
  assert.equal(fmtNewsTimeShort('2026-09-25T13:02:00Z', now), '09:02');
  assert.match(newsTimeHtml('2026-09-24T15:00:00Z', now), /nt-l">SEP 24<.*nt-s">9\/24</);
});

test('NEWS <T>: source in the NEWS slot; ABOUT keeps stories that name the company', async () => {
  const { tickerNewsList, aboutTicker, nameWord } = await import('../public/screens/tickernews.js');
  const html = tickerNewsList([{ title: 'x', link: 'https://example.com/', source: 'Zacks', time: '2026-09-24T15:00:00Z' }]);
  assert.ok(html.indexOf('news-src') < html.indexOf('news-title'), 'source before the headline, as on NEWS');
  assert.equal(nameWord('Apple Inc.'), 'Apple');
  assert.equal(nameWord('The Walt Disney Company'), 'Walt');
  const items = [
    { title: 'Prediction: what $1,000 in Apple will be worth' },
    { title: 'Notable ETF inflow - SPYG, NVDA, AAPL' },
    { title: '4 ETFs to buy if the market crashes' },
    { title: 'Pineapple prices soar' },
  ];
  assert.deepEqual(aboutTicker(items, 'AAPL', 'Apple Inc.').map((n) => n.title[0]), ['P', 'N']);
  assert.equal(aboutTicker(items, 'AAPL', null).length, 1);
});

test('EARNINGS: day pills for the week, with the weeks either side', async () => {
  const { dayPills, mondayOf } = await import('../public/screens/earnings.js');
  assert.equal(mondayOf('2026-09-25'), '2026-09-21');
  assert.equal(mondayOf('2026-09-27'), '2026-09-21', 'Sunday belongs to the week before');
  const p = dayPills('2026-09-23', false);
  assert.deepEqual(p.items.map((i) => i.label), ['‹ PREV', 'MON 21', 'TUE 22', 'WED 23', 'THU 24', 'FRI 25', 'WEEK', 'NEXT ›']);
  assert.equal(p.active, 'WED 23');
  assert.equal(p.items[0].cmd, 'EARNINGS 2026-09-14');
  assert.equal(p.items[6].cmd, 'EARNINGS 2026-09-21 WEEK');
  const w = dayPills('2026-09-21', true);
  assert.equal(w.active, 'WEEK');
  assert.equal(w.items[7].cmd, 'EARNINGS 2026-09-28 WEEK');
});

test('SECTORS: the bar sits in the TODAY cell; leaders by period', async () => {
  const { sectorsTable, sectorLeaders } = await import('../public/screens/sectors.js');
  const rows = [
    { id: 'XLK', name: 'Technology', last: 1, changePct: 1, m1: 2, ytd: 30 },
    { id: 'XLE', name: 'Energy', last: 1, changePct: -1, m1: -2, ytd: 40 },
  ];
  const html = sectorsTable(rows);
  assert.equal((html.match(/<th scope="col"/g) || []).length, 5, 'every column has a header');
  assert.match(html, /today-cell[^>]*><span class="tbar"><svg class="pbar"/);
  assert.match(html, /data-cmd="XLK" tabindex="0"/);
  const lead = sectorLeaders(rows);
  assert.equal(lead[0].best.id, 'XLK');
  assert.equal(lead[2].best.id, 'XLE');
});
