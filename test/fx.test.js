import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFx, shapeSeries, parseAmount, convert, normalizeCode, FxError } from '../data/fx.js';
import { createCache } from '../data/cache.js';
import { fmtMoney, fmtRate, sparkline } from '../public/screens/fx.js';

const CURRENCIES = { USD: 'United States Dollar', THB: 'Thai Baht', EUR: 'Euro' };
const SERIES = { rates: { '2026-09-24': { THB: 33.48 }, '2026-08-25': { THB: 32.735 }, '2026-09-01': { THB: 33.265 } } };

function json(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function fakeFetch(state) {
  return async (url) => {
    state.calls.push(url);
    if (state.down) throw new Error('network down');
    if (url.endsWith('/currencies')) return json(CURRENCIES);
    return json(SERIES);
  };
}

test('helpers: codes, amounts, conversion, series order', () => {
  assert.equal(normalizeCode(' usd '), 'USD');
  assert.equal(parseAmount(undefined), 1);
  assert.equal(parseAmount('1,500'), 1500);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('-5')));
  assert.equal(convert(500, 33.48), 16740);
  const s = shapeSeries(SERIES.rates, 'THB');
  assert.deepEqual(s.map((p) => p.d), ['2026-08-25', '2026-09-01', '2026-09-24']);
});

test('getFx converts with the latest rate and returns the series', async () => {
  const state = { calls: [] };
  const fx = makeFx({ fetchImpl: fakeFetch(state), now: () => new Date('2026-09-25T12:00:00Z') });
  const r = await fx.getFx({ amount: '500', from: 'usd', to: 'thb' });
  assert.equal(r.rate, 33.48);
  assert.equal(r.result, 16740);
  assert.equal(r.date, '2026-09-24');
  assert.equal(r.series.length, 3);
  assert.equal(r.stale, false);
  assert.match(state.calls[1], /\/2026-08-25\.\.\?from=USD&to=THB$/);
});

test('unknown currency gives a friendly error with examples', async () => {
  const fx = makeFx({ fetchImpl: fakeFetch({ calls: [] }) });
  await assert.rejects(fx.getFx({ from: 'USD', to: 'XYZ' }), (err) => {
    assert.ok(err instanceof FxError);
    assert.equal(err.code, 'unknown_currency');
    assert.deepEqual(err.unknown, ['XYZ']);
    assert.ok(err.examples.length > 0);
    return true;
  });
});

test('same currency converts at 1 without calling the series API', async () => {
  const state = { calls: [] };
  const fx = makeFx({ fetchImpl: fakeFetch(state) });
  const r = await fx.getFx({ amount: '42', from: 'EUR', to: 'EUR' });
  assert.equal(r.result, 42);
  assert.equal(state.calls.length, 1);
});

test('cached data is reused, and served stale when the source fails', async () => {
  let t = 0;
  const cache = createCache({ now: () => t });
  const state = { calls: [] };
  const fx = makeFx({ fetchImpl: fakeFetch(state), cache });
  await fx.getFx({ from: 'USD', to: 'THB' });
  const before = state.calls.length;
  await fx.getFx({ from: 'USD', to: 'THB' });
  assert.equal(state.calls.length, before, 'second call is served from cache');

  t += 2 * 60 * 60_000; // past the 1 hour TTL
  state.down = true;
  const r = await fx.getFx({ amount: '2', from: 'USD', to: 'THB' });
  assert.equal(r.stale, true);
  assert.equal(r.result, 66.96);
});

test('no data at all gives an unavailable error, never a raw one', async () => {
  const fx = makeFx({ fetchImpl: fakeFetch({ calls: [], down: true }) });
  await assert.rejects(fx.getFx({ from: 'USD', to: 'THB' }), (err) => err.code === 'unavailable' && !/network/.test(err.message));
});

test('display formatting', () => {
  assert.equal(fmtMoney(16740, 'THB'), '16,740.00');
  assert.equal(fmtMoney(15773.456, 'JPY'), '15,773');
  assert.equal(fmtRate(33.48), '33.4800');
  assert.equal(fmtRate(157.734), '157.73');
  assert.equal(fmtRate(0.02987), '0.02987');
  const svg = sparkline([{ d: 'a', v: 1 }, { d: 'b', v: 2 }]);
  assert.match(svg, /^<svg/);
  assert.equal(sparkline([{ d: 'a', v: 1 }]), '');
});
