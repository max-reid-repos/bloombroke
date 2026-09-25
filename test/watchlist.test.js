import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSymbols, parseWatchArgs, watchInput, addIds, removeIds, moveItem, toggleId, exportText,
  loadWatchlist, saveWatchlist, isDefaultList, sortRows, volumeNumber, rangePos, DEFAULT_WATCHLIST, MAX_WATCH, WATCH_KEY,
} from '../public/watchlist.js';
import { applyWatch } from '../public/screens/watch.js';

test('watch: symbols from words, aliases, commas', () => {
  assert.deepEqual(parseSymbols(['AAPL', 'TSLA', 'EURUSD']), { ids: ['AAPL', 'TSLA', 'EURUSD'], bad: [] });
  assert.deepEqual(parseSymbols(['S&P', '500', 'EUR/USD', 'bitcoin']).ids, ['SPX', 'EURUSD', 'BTC']);
  assert.deepEqual(parseSymbols(['AAPL,MSFT,', '$NVDA']).ids, ['AAPL', 'MSFT', 'NVDA']);
  assert.deepEqual(parseSymbols(['AAPL', 'aapl']).ids, ['AAPL']);
  assert.deepEqual(parseSymbols(['GOOGLE']).bad, ['GOOGLE']);
});

test('watch: command words', () => {
  assert.deepEqual(parseWatchArgs([]), { action: 'show' });
  assert.deepEqual(parseWatchArgs(['ADD', 'AAPL', 'TSLA']), { action: 'add', ids: ['AAPL', 'TSLA'], mutates: true });
  assert.deepEqual(parseWatchArgs(['AAPL']), { action: 'add', ids: ['AAPL'], mutates: true });
  assert.deepEqual(parseWatchArgs(['REMOVE', 'AAPL']), { action: 'remove', ids: ['AAPL'], mutates: true });
  assert.deepEqual(parseWatchArgs(['CLEAR']), { action: 'clear', mutates: true });
  assert.deepEqual(parseWatchArgs(['EXPORT']), { action: 'export', mutates: false });
  assert.deepEqual(parseWatchArgs(['IMPORT', 'AAPL,MSFT']), { action: 'import', ids: ['AAPL', 'MSFT'], mutates: true });
  assert.equal(parseWatchArgs(['ADD']).error, 'usage');
  assert.equal(parseWatchArgs(['ADD', 'GOOGLE']).error, 'symbol');
  assert.equal(parseWatchArgs(['CLEAR', 'AAPL']).error, 'usage');
  assert.equal(watchInput(parseWatchArgs(['IMPORT', 'AAPL', 'MSFT'])), 'WATCH IMPORT AAPL,MSFT');
  assert.equal(watchInput(parseWatchArgs(['AAPL'])), 'WATCH ADD AAPL');
});

test('watch: list edits never change the input and keep the cap', () => {
  const l = ['A', 'B', 'C'];
  assert.deepEqual(addIds(l, ['B', 'D']), { list: ['A', 'B', 'C', 'D'], added: ['D'], skipped: ['B'] });
  assert.deepEqual(removeIds(l, ['B', 'Z']), { list: ['A', 'C'], removed: ['B'], missing: ['Z'] });
  assert.deepEqual(moveItem(l, 0, 2), ['B', 'C', 'A']);
  assert.deepEqual(moveItem(l, 2, 0), ['C', 'A', 'B']);
  assert.deepEqual(moveItem(l, 1, 99), ['A', 'C', 'B']);
  assert.deepEqual(toggleId(l, 'B'), ['A', 'C']);
  assert.deepEqual(toggleId(l, 'D'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(l, ['A', 'B', 'C']);
  const full = Array.from({ length: MAX_WATCH }, (_, i) => `T${i}`);
  assert.deepEqual(addIds(full, ['NEW']).skipped, ['NEW']);
  assert.equal(exportText(['AAPL', 'MSFT']), 'AAPL,MSFT');
  assert.deepEqual(parseWatchArgs(['IMPORT', exportText(['AAPL', 'GOLD'])]).ids, ['AAPL', 'GOLD']);
});

test('watch: the starter list, storage, and a store that fails', () => {
  const mem = new Map();
  const store = { get: (k, f) => (mem.has(k) ? mem.get(k) : f), set: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadWatchlist(store), DEFAULT_WATCHLIST);
  assert.ok(isDefaultList(loadWatchlist(store)));
  saveWatchlist(store, ['AAPL', 'AAPL', 42, 'MSFT']);
  assert.deepEqual(mem.get(WATCH_KEY), ['AAPL', 'MSFT']);
  assert.ok(!isDefaultList(loadWatchlist(store)));
  saveWatchlist(store, []);
  assert.deepEqual(loadWatchlist(store), [], 'an emptied list stays empty');
  mem.set(WATCH_KEY, 'junk');
  assert.deepEqual(loadWatchlist(store), DEFAULT_WATCHLIST);
  const broken = { get: (k, f) => f, set: () => {} };
  assert.deepEqual(loadWatchlist(broken), DEFAULT_WATCHLIST);
});

test('watch: sorting, missing values last, volume and range helpers', () => {
  const rows = [
    { id: 'A', quote: { last: 10, changePct: 1, volume: '2.5M', low52: 0, high52: 20 } },
    { id: 'B', quote: null },
    { id: 'C', quote: { last: 30, changePct: -2, volume: '900K', low52: 0, high52: 40 } },
  ];
  assert.deepEqual(sortRows(rows, 'pct', 'desc').map((r) => r.id), ['A', 'C', 'B']);
  assert.deepEqual(sortRows(rows, 'pct', 'asc').map((r) => r.id), ['C', 'A', 'B']);
  assert.deepEqual(sortRows(rows, 'vol', 'desc').map((r) => r.id), ['A', 'C', 'B']);
  assert.deepEqual(sortRows(rows, 'range', 'desc').map((r) => r.id), ['C', 'A', 'B']);
  assert.deepEqual(sortRows(rows, 'symbol', 'desc').map((r) => r.id), ['C', 'B', 'A']);
  assert.equal(sortRows(rows, null, null), rows);
  assert.equal(volumeNumber('22.7M'), 22_700_000);
  assert.equal(volumeNumber('1,234'), 1234);
  assert.ok(Number.isNaN(volumeNumber(null)));
  assert.equal(rangePos(0, 10, 5), 0.5);
  assert.equal(rangePos(0, 10, 50), 1);
  assert.ok(Number.isNaN(rangePos(10, 10, 10)));
});

test('watch screen: add, remove, clear, reset and import messages', () => {
  let r = applyWatch(['AAPL'], { action: 'add', ids: ['AAPL', 'TSLA'] });
  assert.deepEqual(r.list, ['AAPL', 'TSLA']);
  assert.match(r.msg, /Added TSLA\. AAPL is already on the list\./);
  r = applyWatch(r.list, { action: 'remove', ids: ['GOLD'] });
  assert.equal(r.warn, true);
  assert.deepEqual(applyWatch(['A'], { action: 'clear' }).list, []);
  assert.deepEqual(applyWatch([], { action: 'reset' }).list, DEFAULT_WATCHLIST);
  assert.deepEqual(applyWatch(['A'], { action: 'import', ids: ['X', 'Y'] }).list, ['X', 'Y']);
});
