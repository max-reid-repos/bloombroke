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
