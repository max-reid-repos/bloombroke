import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addLot, sellShares, removeHolding, valuePortfolio, parsePfArgs, pfInput, toCsv, parseCsv, loadPortfolio, savePortfolio, PF_KEY,
} from '../public/portfolio.js';
import { applyPf, usd } from '../public/screens/portfolio.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('portfolio: a second buy merges into a weighted average cost', () => {
  let h = addLot([], { ticker: 'AAPL', shares: 10, cost: 150 });
  assert.deepEqual(h, [{ ticker: 'AAPL', shares: 10, cost: 150 }]);
  h = addLot(h, { ticker: 'AAPL', shares: 5, cost: 180 });
  assert.equal(h.length, 1);
  assert.equal(h[0].shares, 15);
  close(h[0].cost, 160); // (10*150 + 5*180) / 15
  h = addLot(h, { ticker: 'MSFT', shares: 0.1, cost: 400 });
  h = addLot(h, { ticker: 'MSFT', shares: 0.2, cost: 400 });
  assert.equal(h[1].shares, 0.3, 'float dust is rounded away');
});

test('portfolio: sells keep the average cost, and all or nothing edges', () => {
  const h = [{ ticker: 'AAPL', shares: 15, cost: 160 }];
  const r = sellShares(h, 'AAPL', 3);
  assert.deepEqual(r.holdings, [{ ticker: 'AAPL', shares: 12, cost: 160 }]);
  assert.equal(r.left, 12);
  assert.deepEqual(sellShares(h, 'AAPL', 15).holdings, []);
  assert.deepEqual(sellShares(h, 'AAPL', 'ALL').holdings, []);
  assert.equal(sellShares(h, 'AAPL', 16).error, 'too_many');
  assert.equal(sellShares(h, 'MSFT', 1).error, 'none');
  assert.deepEqual(removeHolding(h, 'AAPL'), []);
  assert.deepEqual(h, [{ ticker: 'AAPL', shares: 15, cost: 160 }], 'the input is never changed');
});

test('portfolio: value, day gain, total gain and weights', () => {
  const h = [{ ticker: 'AAPL', shares: 10, cost: 150 }, { ticker: 'MSFT', shares: 5, cost: 400 }];
  const q = {
    AAPL: { last: 200, change: 2, changePct: 1.0101, currency: 'USD' },
    MSFT: { last: 300, change: -3, changePct: -0.99, currency: 'USD' },
  };
  const v = valuePortfolio(h, q);
  const [a, m] = v.rows;
  assert.equal(a.value, 2000);
  assert.equal(a.dayGain, 20);
  assert.equal(a.totalGain, 500);
  close(a.totalPct, 33.333333333);
  assert.equal(m.value, 1500);
  assert.equal(m.dayGain, -15);
  assert.equal(m.totalGain, -500);
  close(m.totalPct, -25);
  close(a.weight, (2000 / 3500) * 100);
  close(a.weight + m.weight, 100);
  assert.equal(v.totals.value, 3500);
  assert.equal(v.totals.basis, 3500);
  assert.equal(v.totals.dayGain, 5);
  close(v.totals.dayPct, (5 / 3495) * 100);
  assert.equal(v.totals.totalGain, 0);
  assert.equal(v.totals.counted, 2);
});

test('portfolio: no quote or another currency stays out of the totals', () => {
  const h = [{ ticker: 'AAPL', shares: 1, cost: 100 }, { ticker: 'ZZZZ', shares: 1, cost: 5 }, { ticker: 'N225', shares: 1, cost: 5 }];
  const v = valuePortfolio(h, { AAPL: { last: 110, change: 1, changePct: 0.9, currency: 'USD' }, N225: { last: 40000, change: 1, currency: 'JPY' } });
  assert.equal(v.rows[1].ok, false);
  assert.equal(v.rows[1].reason, 'noquote');
  assert.equal(v.rows[2].reason, 'currency');
  assert.ok(Number.isNaN(v.rows[1].weight));
  assert.equal(v.totals.value, 110);
  assert.equal(v.rows[0].weight, 100);
  assert.equal(v.totals.counted, 1);
  const empty = valuePortfolio([], {});
  assert.equal(empty.totals.value, 0);
  assert.ok(Number.isNaN(empty.totals.totalPct));
});

test('PF words: add, sell, remove, clear, errors', () => {
  assert.deepEqual(parsePfArgs([]), { action: 'show' });
  assert.deepEqual(parsePfArgs(['ADD', 'AAPL', '10', '@', '150']), { action: 'add', ticker: 'AAPL', shares: 10, cost: 150, mutates: true });
  assert.equal(parsePfArgs(['ADD', 'AAPL', '10', '@150']).cost, 150);
  assert.equal(parsePfArgs(['ADD', 'AAPL', '10', 'AT', '$1,500.50']).cost, 1500.5);
  assert.equal(parsePfArgs(['ADD', 'AAPL', '2.5', '150']).shares, 2.5);
  assert.equal(parsePfArgs(['ADD', 'BITCOIN', '0.5', '60000']).ticker, 'BTC');
  assert.equal(parsePfArgs(['ADD', 'AAPL', '10']).error, 'usage');
  assert.equal(parsePfArgs(['ADD', 'AAPL', '0', '@', '150']).error, 'shares');
  assert.equal(parsePfArgs(['ADD', 'AAPL', '10', '@', '-1']).error, 'cost');
  assert.equal(parsePfArgs(['ADD', 'SPX', '1', '@', '5000']).error, 'kind');
  assert.equal(parsePfArgs(['ADD', 'EURUSD', '1', '@', '1']).error, 'kind');
  assert.deepEqual(parsePfArgs(['SELL', 'AAPL', '3']), { action: 'sell', ticker: 'AAPL', shares: 3, mutates: true });
  assert.equal(parsePfArgs(['SELL', 'AAPL', 'ALL']).shares, 'ALL');
  assert.deepEqual(parsePfArgs(['REMOVE', 'AAPL']), { action: 'remove', ticker: 'AAPL', mutates: true });
  assert.deepEqual(parsePfArgs(['CLEAR']), { action: 'clear', mutates: true });
  assert.equal(parsePfArgs(['CLEAR', 'NOW']).error, 'usage');
  assert.deepEqual(parsePfArgs(['EXPORT']), { action: 'export', mutates: false });
  assert.equal(parsePfArgs(['IMPORT']).paste, true);
  assert.equal(parsePfArgs(['LOL']).error, 'usage');
  assert.equal(pfInput(parsePfArgs(['ADD', 'AAPL', '10', '150'])), 'PF ADD AAPL 10 @ 150');
});

test('PF CSV: round trip, header, separators, duplicates, bad lines', () => {
  const h = [{ ticker: 'AAPL', shares: 15, cost: 160 }, { ticker: 'BRK.B', shares: 2.5, cost: 1 / 3 }];
  const csv = toCsv(h);
  assert.equal(csv, 'ticker,shares,cost\nAAPL,15,160\nBRK.B,2.5,0.333333\n');
  const back = parseCsv(csv);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.holdings.map((x) => x.ticker), ['AAPL', 'BRK.B']);
  const merged = parseCsv('aapl;10;150\r\nAAPL\t5\t180\nmsft,1,300');
  assert.equal(merged.holdings.length, 2);
  close(merged.holdings[0].cost, 160);
  const bad = parseCsv('AAPL,10\nGOOGLE,1,1\nSPX,1,5000\nMSFT,1,300');
  assert.deepEqual(bad.errors.map((e) => e.line), [1, 2, 3]);
  assert.equal(bad.holdings.length, 1);
});

test('PF screen maths: messages and a sell that is too big changes nothing', () => {
  let r = applyPf([], { action: 'add', ticker: 'AAPL', shares: 10, cost: 150 });
  r = applyPf(r.holdings, { action: 'add', ticker: 'AAPL', shares: 5, cost: 180 });
  assert.match(r.msg, /15 at an average \$160\.00/);
  const before = r.holdings;
  const s = applyPf(before, { action: 'sell', ticker: 'AAPL', shares: 99 });
  assert.equal(s.warn, true);
  assert.equal(s.holdings, before);
  assert.equal(usd(-12.3), '−$12.30');
  assert.equal(usd(5, true), '+$5.00');
  assert.equal(usd(0, true), '$0.00');
});

test('PF storage: bad data is dropped, and a store that throws is survived', () => {
  const mem = new Map();
  const store = { get: (k, f) => (mem.has(k) ? mem.get(k) : f), set: (k, v) => mem.set(k, v) };
  savePortfolio(store, [{ ticker: 'AAPL', shares: 1, cost: 1 }, { ticker: 'X', shares: -1, cost: 1 }, null]);
  assert.deepEqual(mem.get(PF_KEY), [{ ticker: 'AAPL', shares: 1, cost: 1 }]);
  mem.set(PF_KEY, 'junk');
  assert.deepEqual(loadPortfolio(store), []);
  // app.js wraps localStorage in try/catch, so its store returns the fallback when storage throws.
  const broken = { get: (k, f) => f, set: () => {} };
  assert.deepEqual(loadPortfolio(broken), []);
});
