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
