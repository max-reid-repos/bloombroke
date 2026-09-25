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
