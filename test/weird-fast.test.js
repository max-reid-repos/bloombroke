// WEIRD answers fast after a restart: the last good files are read at boot, a value is
// served at once (stale only past its ttl) while one background refresh runs, and only
// a gauge with no value anywhere comes back pending. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { makeWeird, FAST_WAIT } from '../data/weird/index.js';

const HOUR = 60 * 60_000;
const NOW = Date.parse('2026-09-26T12:00:00Z');
const never = () => new Promise(() => {});

function withDir(files, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'weird-fast-'));
  for (const [id, body] of Object.entries(files)) writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(body));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('a cold start with a disk cache answers at once with the last good values', () => withDir({
  a: { fetchedAt: NOW - 10 * 60_000, value: { headline: 'A1', line: 'a', asOf: '2026-09-26', source: 'A' } },
  b: { fetchedAt: NOW - 5 * HOUR, value: { headline: 'B1', line: 'b', asOf: '2026-09-20', source: 'B' } },
}, async (dir) => {
  let loads = 0;
  const mk = (id) => ({ id, source: id.toUpperCase(), ttl: HOUR, load: () => { loads += 1; return never(); } });
  const w = makeWeird({ gauges: [mk('a'), mk('b'), mk('c')], lastGoodDir: dir, now: () => NOW });
  const t0 = performance.now();
  const s = await w.getWeird({ wait: FAST_WAIT });
  const ms = performance.now() - t0;
  assert.ok(ms < 400, `answered in ${ms.toFixed(0)} ms`);
  const [a, b, c] = s.gauges;
  assert.equal(a.ok, true);
  assert.equal(a.headline, 'A1');
  assert.equal(a.stale, false, 'younger than its ttl: not stale');
  assert.equal(a.updated, new Date(NOW - 10 * 60_000).toISOString(), 'the real fetch time');
  assert.equal(b.headline, 'B1');
  assert.equal(b.stale, true, 'older than its ttl: stale');
  assert.equal(b.asOf, '2026-09-20', 'its own as-of date');
  assert.equal(c.pending, true, 'no value anywhere: pending');
  assert.equal(s.stale, false);
  // The fresh one is not fetched; the old one and the empty one are, once each.
  assert.equal(loads, 2);
  assert.equal(w.refreshing('a'), false);
  assert.equal(w.refreshing('b'), true);
  // A single gauge answers at once too.
  const t1 = performance.now();
  assert.equal((await w.getGauge('b', { wait: FAST_WAIT })).headline, 'B1');
  assert.equal((await w.getGauge('c', { wait: FAST_WAIT })).pending, true);
  assert.ok(performance.now() - t1 < 400);
}));

test('the stale flag follows the value age against the gauge ttl', () => withDir({
  g: { fetchedAt: NOW, value: { headline: 'G', asOf: '2026-09-26', source: 'G' } },
}, async (dir) => {
  let t = NOW;
  const g = { id: 'g', source: 'G', ttl: HOUR, load: never };
  const w = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
  t = NOW + HOUR - 1;
  assert.equal((await w.getGauge('g')).stale, false);
  t = NOW + HOUR + 1;
  const old = await w.getGauge('g');
  assert.equal(old.stale, true);
  assert.equal(old.updated, new Date(NOW).toISOString());
}));

test('one background refresh per gauge, and its value is served on the next request', () => withDir({
  g: { fetchedAt: NOW - 2 * HOUR, value: { headline: 'OLD', asOf: '2026-09-25', source: 'G' } },
}, async (dir) => {
  let t = NOW;
  let calls = 0;
  let finish;
  const g = { id: 'g', source: 'G', ttl: HOUR, load: () => { calls += 1; return new Promise((r) => { finish = r; }); } };
  const w = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
  const rows = await Promise.all(Array.from({ length: 10 }, () => w.getGauge('g', { wait: FAST_WAIT })));
  await w.getWeird();
  await w.getWeird();
  assert.equal(calls, 1, 'one fetch for twelve requests');
  assert.ok(rows.every((r) => r.headline === 'OLD' && r.stale));
  t = NOW + 1000;
  finish({ headline: 'NEW', asOf: '2026-09-26', source: 'G' });
  await new Promise((r) => setImmediate(r));
  const next = await w.getGauge('g');
  assert.equal(next.headline, 'NEW');
  assert.equal(next.stale, false);
  assert.equal(next.updated, new Date(NOW + 1000).toISOString());
  // The new value was written for the next restart.
  const again = makeWeird({ gauges: [{ ...g, load: never }], lastGoodDir: dir, now: () => t });
  assert.equal((await again.getGauge('g')).headline, 'NEW');
}));

test('a failed refresh keeps the last good value and waits retryMs before trying again', () => withDir({
  g: { fetchedAt: NOW - 2 * HOUR, value: { headline: 'OLD', source: 'G' } },
}, async (dir) => {
  let t = NOW;
  let calls = 0;
  const g = { id: 'g', source: 'G', ttl: HOUR, retryMs: 60_000, load: async () => { calls += 1; throw new Error('down'); } };
  const w = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
  const err = console.error;
  console.error = () => {};
  try {
    assert.equal((await w.getGauge('g')).headline, 'OLD');
    await new Promise((r) => setImmediate(r));
    assert.equal((await w.getGauge('g')).stale, true);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1, 'no new fetch inside retryMs');
    t = NOW + 61_000;
    await w.getGauge('g');
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2);
  } finally {
    console.error = err;
  }
}));

test('boot pre-warm: gauges with no value first, fresh ones skipped, one start per gap', () => withDir({
  fresh: { fetchedAt: NOW, value: { headline: 'F', source: 'F' } },
  old: { fetchedAt: NOW - 2 * HOUR, value: { headline: 'O', source: 'O' } },
}, async (dir) => {
  const order = [];
  const mk = (id) => ({ id, source: id, ttl: HOUR, load: async () => { order.push(id); return { headline: id.toUpperCase(), source: id }; } });
  const w = makeWeird({ gauges: [mk('fresh'), mk('old'), mk('none')], lastGoodDir: dir, now: () => NOW });
  const stop = w.startPrewarm({ gapMs: 30 });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, ['none'], 'the second start waits for the gap');
  // A request before its turn gets the last good value and starts no fetch of its own.
  const early = await w.getGauge('old');
  assert.equal(early.headline, 'O');
  assert.equal(early.stale, true);
  assert.deepEqual(order, ['none']);
  await new Promise((r) => setTimeout(r, 60));
  stop();
  assert.deepEqual(order, ['none', 'old']);
  assert.equal((await w.getGauge('none')).headline, 'NONE');
}));
