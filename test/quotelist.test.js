import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../data/cache.js';
import { makeQuotes, INSTRUMENTS } from '../data/quotes.js';
import { INSTRUMENTS as REGISTRY } from '../public/instruments.js';

function json(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const stockRow = (symbol, last) => ({ symbol, code: 0, name: `${symbol} Inc.`, last: String(last), change: '1.00', change_pct: '+0.50%', currencyCode: 'USD', last_time: '2026-09-25T10:00:00.000-0400', realTime: 'true' });

test('quote list: named instruments from the batch, stocks in one shared call, unknowns missing', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const syms = new URL(url).searchParams.get('symbols').split('|');
    calls.push(syms);
    if (syms.length > 5) return json({ FormattedQuoteResult: { FormattedQuote: REGISTRY.map((i) => ({ symbol: i.src, code: 0, last: '100', change: '1', change_pct: '1%' })) } });
    return json({ FormattedQuoteResult: { FormattedQuote: syms.map((s) => (s === 'ZZZZ' ? { symbol: 'ZZZZ', code: 1 } : stockRow(s, 200))) } });
  };
  const q = makeQuotes({ fetchImpl, cache: createCache() });
  const r = await q.getQuoteList(['aapl', 'GOLD', 'MSFT', 'ZZZZ', 'AAPL', 'bitcoin']);
  assert.deepEqual(r.quotes.map((x) => x.ticker), ['AAPL', 'GOLD', 'MSFT', 'BTC']);
  assert.deepEqual(r.missing, ['ZZZZ']);
  const stockCalls = calls.filter((c) => c.length <= 5);
  assert.equal(stockCalls.length, 1, 'the uncached stocks share one upstream call');
  assert.deepEqual(stockCalls[0], ['AAPL', 'MSFT', 'ZZZZ']);
  assert.equal(r.quotes[0].last, 200);
  assert.equal(r.quotes[1].kind, 'spot', 'GOLD is spot gold');
  assert.ok(INSTRUMENTS.length > 10);

  // Second call inside 15 s: all from the cache.
  const before = calls.length;
  await q.getQuoteList(['AAPL', 'MSFT', 'GOLD']);
  assert.equal(calls.length, before);
});

test('quote list: a row never lands on the wrong ticker, and an outage throws', async () => {
  const q = makeQuotes({ fetchImpl: async () => json({ FormattedQuoteResult: { FormattedQuote: [stockRow('XXXX', 1), stockRow('YYYY', 2)] } }), cache: createCache() });
  const r = await q.getQuoteList(['AAPL', 'MSFT']);
  assert.deepEqual(r.quotes, []);
  assert.deepEqual(r.missing, ['AAPL', 'MSFT']);
  const down = makeQuotes({ fetchImpl: async () => json({}, 500), cache: createCache() });
  await assert.rejects(down.getQuoteList(['AAPL']));
});
