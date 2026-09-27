// WEIRD history: period cover, slicing, the record line, daily snapshots, the engine's
// period views and the period words in commands and URLs. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  histFrom, mergeHist, periodInfo, pickPeriod, sliceHist, sparkFor, recordLine, leadPoints, points,
  snapshotStore, snapshotHist, SPARK_POINTS,
} from '../data/weird/history.js';
import { makeWeird } from '../data/weird/index.js';
import * as canal from '../data/weird/canal.js';
import * as panic from '../data/weird/panic.js';
import * as macau from '../data/weird/macau.js';
import * as undies from '../data/weird/undies.js';
import * as buzz from '../data/weird/buzz.js';
import * as hotdog from '../data/weird/hotdog.js';
import * as wsb from '../data/weird/wsb.js';
import { GAUGES } from '../data/weird/index.js';
import { parseCommand } from '../public/app.js';
import { periodWord, dayLabel, WEIRD_PERIODS } from '../public/screens/weird-gauges.js';

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.parse('2020-01-01T00:00:00Z');

// n daily readings from T0, value f(i).
function daily(n, f, start = T0) {
  return histFrom(Array.from({ length: n }, (_, i) => ({ d: iso(start + i * DAY), x: f(i) })), [{ key: 'x', label: 'X' }]);
}
function monthly(n, f, y = 2000) {
  return histFrom(Array.from({ length: n }, (_, i) => ({ d: `${y + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, x: f(i) })), [{ key: 'x', label: 'X' }], { step: 'month' });
}
const pts = (vals, stepDays = 30) => vals.map((v, i) => ({ d: iso(T0 + i * stepDays * DAY), v }));

function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'weird-hist-'));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

// ---- periods -----------------------------------------------------------------------

test('periods: only what the readings really cover is on, with a reason for the rest', () => {
  // 2 years of days: 3M and 1Y on, 5Y and 10Y off, MAX on.
  const two = periodInfo(daily(730, (i) => i));
  assert.deepEqual(Object.fromEntries(WEIRD_PERIODS.map((p) => [p, two[p].ok])), { '3M': true, '1Y': true, '5Y': false, '10Y': false, MAX: true });
  assert.match(two['5Y'].title, /^Data starts JAN 2020$/);
  // 30 years of months: all on.
  const long = periodInfo(monthly(360, (i) => i));
  assert.ok(WEIRD_PERIODS.every((p) => long[p].ok));
  // Twice a year: too few readings in 3M even though the series is long.
  const half = histFrom(Array.from({ length: 40 }, (_, i) => ({ d: `${2000 + Math.floor(i / 2)}-${i % 2 ? '07' : '01'}-01`, x: i })), [{ key: 'x', label: 'X' }], { step: 'half' });
  const hi = periodInfo(half);
  assert.equal(hi['3M'].ok, false);
  assert.match(hi['3M'].title, /Too few readings in 3M/);
  assert.equal(hi['10Y'].ok, true);
  // One reading, or none: nothing on, MAX included.
  assert.ok(WEIRD_PERIODS.every((p) => periodInfo(daily(1, () => 1))[p].ok === false));
  assert.ok(WEIRD_PERIODS.every((p) => periodInfo(null)[p].ok === false));
  // A snapshot gauge says since when it records.
  const rec = periodInfo(daily(10, (i) => i), { recordingSince: '2026-09-27' });
  assert.equal(rec['3M'].title, 'Recording since 27 SEP 2026');
  assert.equal(rec.MAX.ok, true);
});

test('periods per gauge: the real modules cover what their sources give', () => {
  // CANAL: PortWatch days since 2019 -> 3M 1Y 5Y on, 10Y off.
  const daysSince = (from, to) => { const out = []; for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(iso(t)); return out; };
  const pw = {};
  for (const c of canal.CHOKEPOINTS) pw[c.portid] = daysSince('2019-01-01', '2026-09-20').map((date) => ({ date, total: 10 }));
  const c = periodInfo(canal.toHist(pw));
  assert.deepEqual(WEIRD_PERIODS.map((p) => c[p].ok), [true, true, true, false, true]);
  // HOTDOG: months since 1985, all on.
  const obs = [];
  for (let y = 1984; y <= 2026; y += 1) for (let m = 1; m <= 12; m += 1) if (y < 2026 || m <= 8) obs.push({ date: `${y}-${String(m).padStart(2, '0')}-01`, value: 100 + (y - 1984) * 3 + m / 10 });
  const h = hotdog.build(obs).hist;
  assert.equal(h.d[0], '1985-01-01');
  assert.ok(WEIRD_PERIODS.every((p) => periodInfo(h)[p].ok));
  // WSB (a snapshot gauge): nothing past MAX until it has recorded long enough.
  const snap = snapshotHist([['2026-09-27', { top: 900 }], ['2026-09-28', { top: 800 }]], wsb.snapshotSeries);
  const w = periodInfo(snap, { recordingSince: '2026-09-27' });
  assert.deepEqual(WEIRD_PERIODS.map((p) => w[p].ok), [false, false, false, false, true]);
});

test('pickPeriod: the asked period when on; longer than the data shows all; else the default', () => {
  const info = periodInfo(daily(730, (i) => i));
  assert.equal(pickPeriod(info, '1Y', '3M'), '1Y');
  assert.equal(pickPeriod(info, '10Y', '3M'), 'MAX', 'more than there is: everything there is');
  assert.equal(pickPeriod(info, null, '3M'), '3M');
  assert.equal(pickPeriod(info, null, '5Y'), '1Y', 'default off: the longest on below it');
  const half = periodInfo(histFrom(Array.from({ length: 40 }, (_, i) => ({ d: `${2000 + Math.floor(i / 2)}-${i % 2 ? '07' : '01'}-01`, x: i })), [{ key: 'x', label: 'X' }]));
  assert.equal(pickPeriod(half, '3M', 'MAX'), 'MAX', 'too few readings: the default');
});

// ---- slicing and merging -------------------------------------------------------------

test('sliceHist: a period ends at the newest reading; long runs are averaged, the latest kept', () => {
  const h = daily(1000, (i) => i);
  const y = sliceHist(h, '1Y');
  assert.equal(y.d[y.d.length - 1], h.d[h.d.length - 1]);
  assert.equal(y.d[0], iso(T0 + (999 - 365) * DAY));
  assert.equal(y.d.length, 366);
  assert.equal(y.bucket, 1);
  assert.equal(sliceHist(h, 'MAX').d.length, 1000);
  // Capped at 100 points: the newest reading on its own, then runs of 10 averaged back
  // from the one before it.
  const c = sliceHist(h, 'MAX', 100);
  assert.equal(c.bucket, 10);
  assert.equal(c.d.length, 101);
  assert.equal(c.d[100], h.d[999]);
  assert.equal(c.series[0].v[100], 999, 'the newest reading as it is, not averaged');
  assert.equal(c.d[99], h.d[998]);
  assert.equal(c.series[0].v[99], (989 + 998) / 2);
  // Grid sparks: at most SPARK_POINTS numbers, empty readings left out.
  const s = sparkFor(h, 'MAX');
  assert.ok(s.length <= SPARK_POINTS && s.length > 100);
  assert.deepEqual(sparkFor(histFrom([{ d: '2026-01-01', x: null }, { d: '2026-01-02', x: 3 }], [{ key: 'x', label: 'X' }]), 'MAX'), [3]);
  assert.equal(sliceHist(null, '1Y'), null);
});

test('mergeHist: the deep past under the recent readings; a recent gap keeps the old value', () => {
  const old = histFrom([{ d: '2020-01-01', a: 1 }, { d: '2020-02-01', a: 2 }, { d: '2020-03-01', a: 3 }], [{ key: 'a', label: 'A' }]);
  const recent = histFrom([{ d: '2020-02-01', a: null }, { d: '2020-03-01', a: 30 }, { d: '2020-04-01', a: 40, b: 1 }], [{ key: 'a', label: 'A new' }, { key: 'b', label: 'B' }], { recordAt: '2020-03-01' });
  const m = mergeHist(old, recent);
  assert.deepEqual(m.d, ['2020-01-01', '2020-02-01', '2020-03-01', '2020-04-01']);
  assert.deepEqual(m.series.find((s) => s.key === 'a').v, [1, 2, 30, 40]);
  assert.deepEqual(m.series.find((s) => s.key === 'b').v, [null, null, null, 1]);
  assert.equal(m.series[0].label, 'A new');
  assert.equal(m.recordAt, '2020-03-01');
  assert.equal(mergeHist(null, recent), recent);
  assert.equal(mergeHist(old, null), old);
  assert.deepEqual(leadPoints(m).map((p) => p.d), ['2020-01-01', '2020-02-01', '2020-03-01'], 'recordAt cuts the record line');
});

// ---- the record line -----------------------------------------------------------------

test('record line: lowest or highest since the last reading as low or high', () => {
  // Monthly: 50, then 60 for a year, then 40 now -> lower than everything. A record only
  // when the series starts where the source's data starts.
  assert.deepEqual(recordLine(pts([50, ...Array(12).fill(60), 40]), { fromStart: true }), {
    kind: 'low', record: true, since: pts([0])[0].d, text: 'RECORD LOW SINCE JAN 2020', short: 'RECORD LOW',
  });
  // Otherwise it never reads as all-time: lowest since the first reading we have.
  assert.deepEqual(recordLine(pts([50, ...Array(12).fill(60), 40])), {
    kind: 'low', record: false, since: pts([0])[0].d, text: 'LOWEST SINCE JAN 2020', short: 'LOW SINCE JAN 2020',
  });
  // 30 then 60 x 12 then 45: the last time it was as low was 13 readings ago.
  const r = recordLine(pts([30, ...Array(12).fill(60), 45]));
  assert.equal(r.kind, 'low');
  assert.equal(r.record, false);
  assert.equal(r.text, 'LOWEST SINCE JAN 2020');
  assert.equal(r.short, 'LOW SINCE JAN 2020');
  // Up: highest since.
  const u = recordLine(pts([90, ...Array(12).fill(10), 80]));
  assert.equal(u.text, 'HIGHEST SINCE JAN 2020');
  assert.equal(recordLine(pts([1, ...Array(12).fill(10), 80]), { fromStart: true }).text, 'RECORD HIGH SINCE JAN 2020');
  assert.equal(recordLine(pts([1, ...Array(12).fill(10), 80])).short, 'HIGH SINCE JAN 2020');
});

test('record line edge cases: gap under 6 months, flat, too short, ties', () => {
  // The last time as low was 3 months ago: not news.
  assert.equal(recordLine(pts([10, 50, 50, 50, 50, 50, 50, 50, 50, 20, 50, 50, 25])), null);
  // Flat: every reading ties the last one, which is a month back.
  assert.equal(recordLine(pts(Array(24).fill(7))), null);
  // Too short: too few readings, or under 6 months from first to last.
  assert.equal(recordLine(pts([1, 2])), null);
  assert.equal(recordLine(pts([9, 8, 7, 6, 5, 4, 3, 2, 1], 7), { fromStart: true }), null, 'nine weekly readings: two months of data');
  // Sparse (twice a year): the gap is long but too few readings lie between.
  const half = (vals) => vals.map((v, i) => ({ d: `${2000 + Math.floor(i / 2)}-${i % 2 ? '07' : '01'}-01`, v }));
  assert.equal(recordLine(half([10, 50, 50, 50, 50, 20])), null, 'four readings between: not enough');
  assert.equal(recordLine(half([10, 50, 50, 50, 50, 50, 50, 20])).text, 'LOWEST SINCE JAN 2000', 'six between: enough');
  assert.equal(recordLine([]), null);
  assert.equal(recordLine(null), null);
  // A tie long ago counts as "as low": lowest since then, not a record.
  const tie = recordLine(pts([20, ...Array(10).fill(50), 20]));
  assert.equal(tie.record, false);
  assert.equal(tie.since, pts([0])[0].d);
  assert.equal(tie.text, 'LOWEST SINCE JAN 2020');
  // Empty readings are skipped, never read as zero.
  const gappy = pts([5, 9, 9, 9, 9, 9, 9, 9, 1]);
  gappy.splice(3, 0, { d: '2020-03-15', v: null });
  assert.equal(recordLine(gappy, { fromStart: true }).text, 'RECORD LOW SINCE JAN 2020');
});

test('record line per gauge: CANAL reads 7-day runs, PANIC its 30-day comparison, MACAU year on year', () => {
  // Hormuz 40 a day for a year, then 5 a day for the last 7 days: record low of the 7-day mean.
  const days = [];
  for (let i = 0; i < 400; i += 1) days.push({ date: iso(T0 + i * DAY), total: i >= 393 ? 5 : 40 });
  const h = canal.toHist({ chokepoint6: days });
  const rp = canal.recordPoints(h);
  assert.equal(rp.length, 394, 'one mean per full run of 7 days');
  assert.equal(rp[rp.length - 1].v, 5);
  assert.equal(recordLine(rp, { fromStart: true }).text, 'RECORD LOW SINCE JAN 2020');
  // A missing day breaks the run.
  const gap = canal.toHist({ chokepoint6: days.filter((_, i) => i !== 396) });
  assert.notEqual(canal.recordPoints(gap).at(-1).d, days[396].date);
  // PANIC: flat views then a jump on the last day.
  const views = (n, last) => Array.from({ length: n }, (_, i) => ({ date: iso(T0 + i * DAY), views: i === n - 1 ? last : 100 }));
  const ph = panic.toHist(Object.fromEntries(panic.ARTICLES.map((a) => [a.page, views(400, 400)])));
  const pp = panic.recordPoints(ph);
  assert.equal(Math.round(pp.at(-1).v), 300);
  assert.equal(recordLine(pp, { fromStart: true }).text, 'RECORD HIGH SINCE JAN 2020');
  // MACAU: each month on the same month a year before.
  const mh = macau.toHist(Array.from({ length: 36 }, (_, i) => ({ month: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, value: 100 + i })));
  const mp = macau.recordPoints(mh);
  assert.equal(mp.length, 24);
  assert.ok(Math.abs(mp[0].v - 12) < 1e-9);
});

// ---- snapshots ---------------------------------------------------------------------

test('snapshots: one reading per UTC day (the latest of that day), survives a restart', () => withDir((dir) => {
  const a = snapshotStore(dir);
  assert.equal(a.record('wsb', '2026-09-27', { top: 100 }), true);
  assert.equal(a.record('wsb', '2026-09-27', { top: 100 }), false, 'the same reading again writes nothing');
  assert.equal(a.record('wsb', '2026-09-27', { top: 90 }), true, 'a later reading the same day replaces it');
  assert.equal(a.read('wsb').length, 1, 'still one entry for the day');
  assert.equal(a.record('wsb', '2026-09-28', { top: 200 }), true);
  assert.equal(a.record('wsb', '2026-09-27', { top: 5 }), false, 'a past day is never touched');
  assert.equal(a.record('wsb', '2026-09-29', { top: null }), false, 'no number: nothing recorded');
  assert.equal(a.record('wsb', 'yesterday', { top: 5 }), false);
  // A new process reads the same file.
  const b = snapshotStore(dir);
  assert.deepEqual(b.read('wsb'), [['2026-09-27', { top: 90 }], ['2026-09-28', { top: 200 }]]);
  assert.equal(b.record('wsb', '2026-09-28', { top: 200 }), false);
  assert.equal(b.has('wsb', '2026-09-27'), true);
  assert.ok(existsSync(path.join(dir, 'wsb.json')));
  const h = snapshotHist(b.read('wsb'), wsb.snapshotSeries);
  assert.deepEqual(points(h), [{ d: '2026-09-27', v: 90 }, { d: '2026-09-28', v: 200 }]);
  // No dir: memory only, still once a day.
  const m = snapshotStore(null);
  assert.equal(m.record('x', '2026-09-27', { v: 1 }), true);
  assert.equal(m.record('x', '2026-09-27', { v: 1 }), false);
}));

test('engine: a snapshot gauge records its value day by day, and says since when', () => withDir(async (dir) => {
  let t = Date.parse('2026-09-27T10:00:00Z');
  let n = 0;
  const g = {
    id: 'snap', source: 'S', ttl: 60_000, snapshotSeries: [{ key: 'v', label: 'V' }],
    snapshot: (v) => ({ v: v.value }),
    load: async () => { n += 1; return { headline: `N ${n}`, value: n * 10, asOf: new Date(t).toISOString(), source: 'S' }; },
  };
  const w = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
  const first = await w.getGauge('snap');
  assert.equal(first.headline, 'N 1');
  assert.deepEqual(first.recording, { since: '2026-09-27' });
  // A later refresh the same day replaces the day's reading: the chart ends on the headline.
  t += 2 * 60_000;
  await w.getGauge('snap');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(snapshotStore(path.join(dir, 'days')).read('snap'), [['2026-09-27', { v: 20 }]]);
  const same = await w.getGauge('snap');
  assert.equal(same.headline, 'N 2');
  assert.equal(same.hist.series[0].v.at(-1), 20);
  // Next day: upkeep fetches once (none recorded for today) and records it.
  t = Date.parse('2026-09-28T01:00:00Z');
  w.tick();
  await new Promise((r) => setTimeout(r, 10));
  const d = await w.getGauge('snap');
  assert.equal(d.hist.d.length, 2);
  assert.equal(d.periods.MAX.ok, true);
  assert.equal(d.periods['3M'].title, 'Recording since 27 SEP 2026');
  // A restart reads the same days back.
  const w2 = makeWeird({ gauges: [{ ...g, load: () => new Promise(() => {}) }], lastGoodDir: dir, now: () => t });
  assert.equal((await w2.getGauge('snap', { wait: 50 })).hist.d.length, 2);
}));

test('engine: upkeep tries a snapshot gauge once a day when it gives no number, and never while fresh', () => withDir(async (dir) => {
  let t = Date.parse('2026-09-27T10:00:00Z');
  let loads = 0;
  // Parks closed all day: the fetch works, the reading has no number.
  const g = {
    id: 'shut', source: 'S', ttl: 10 * 60_000, snapshotSeries: [{ key: 'avg', label: 'A' }],
    snapshot: (v) => ({ avg: v.avg }),
    load: async () => { loads += 1; return { headline: 'PARKS CLOSED', avg: null, asOf: new Date(t).toISOString(), source: 'S' }; },
  };
  const w = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
  for (let i = 0; i < 300; i += 1) { w.tick(); await new Promise((r) => setImmediate(r)); t += 60_000; }
  assert.equal(loads, 1, 'one load across 300 ticks (5 hours)');
  // The next UTC day: one more.
  t = Date.parse('2026-09-28T00:30:00Z');
  for (let i = 0; i < 30; i += 1) { w.tick(); await new Promise((r) => setImmediate(r)); t += 60_000; }
  assert.equal(loads, 2);
  // A fresh value is never refetched by upkeep, even with no reading for today.
  let fresh = 0;
  const f = { ...g, id: 'fresh', load: async () => { fresh += 1; return { headline: 'X', avg: null, asOf: '2026-09-28', source: 'S' }; } };
  const w2 = makeWeird({ gauges: [f], lastGoodDir: dir, now: () => t });
  await w2.getGauge('fresh');
  for (let i = 0; i < 5; i += 1) { w2.tick(); await new Promise((r) => setImmediate(r)); t += 60_000; }
  assert.equal(fresh, 1, 'the request\'s own load only');
}));

test('engine: a snapshot fetch that throws gets one retry later that day, no more', () => withDir(async (dir) => {
  let t = Date.parse('2026-09-27T10:00:00Z');
  let loads = 0;
  const g = {
    id: 'down', source: 'S', ttl: 10 * 60_000, retryMs: 5 * 60_000, snapshotSeries: [{ key: 'v', label: 'V' }],
    snapshot: (v) => ({ v: v.v }),
    load: async () => { loads += 1; throw new Error('HTTP 503'); },
  };
  const w = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
  const errs = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 200; i += 1) { w.tick(); await new Promise((r) => setImmediate(r)); t += 60_000; }
  } finally {
    console.error = errs;
  }
  assert.equal(loads, 2, 'a try and one retry after the hold');
}));

// ---- engine: history, periods, holds --------------------------------------------------

function fakeGauge(extra = {}) {
  return {
    id: 'fake', source: 'F', ttl: 60 * 60_000,
    load: async () => ({ headline: 'F', asOf: '2026-09-01', source: 'F', hist: monthly(12, (i) => 10 + i, 2026 - 1) }),
    history: async () => monthly(240, (i) => 100 - i / 10, 2005),
    defaultPeriod: '5Y',
    ...extra,
  };
}

test('engine: the deep past merges under the value; the API slices one period, never the whole', () => withDir(async (dir) => {
  const t = Date.parse('2026-09-27T00:00:00Z');
  const w = makeWeird({ gauges: [fakeGauge()], lastGoodDir: dir, now: () => t });
  const before = await w.getGauge('fake');
  assert.equal(before.hist.d.length, 12, 'before the deep past comes in: the value\'s own year');
  assert.equal(before.period, '1Y', 'default 5Y is off: the longest period on below it');
  // The engine's own refresh (tick) fetches the deep past.
  w.tick();
  await new Promise((r) => setTimeout(r, 10));
  const d = await w.getGauge('fake');
  assert.equal(d.period, '5Y');
  assert.equal(d.hist.period, '5Y');
  assert.ok(d.hist.d.length >= 60 && d.hist.d.length <= 61);
  assert.equal(d.periods['10Y'].ok, true);
  const all = await w.getGauge('fake', { period: 'max' });
  assert.equal(all.period, 'MAX');
  assert.equal(all.hist.d[0], '2005-01-01');
  // The value's own readings win where both have a month.
  const last = all.hist.series[0].v.at(-1);
  assert.equal(last, 21);
  assert.equal(readFileSync(path.join(dir, 'fake.history.json'), 'utf8').includes('"fetchedAt"'), true);
  // The summary: sparks on the asked period, AUTO leaves the gauge's own.
  const s = await w.getWeird({ period: '10Y' });
  assert.equal(s.period, '10Y');
  assert.equal(s.periods['10Y'].ok, true);
  assert.ok(s.gauges[0].spark.length > 20);
  const auto = await w.getWeird();
  assert.equal(auto.period, 'AUTO');
  assert.equal(auto.gauges[0].spark, undefined);
}));

test('engine: a failed history fetch is held on disk, so a restart does not ask again', () => withDir(async (dir) => {
  let t = Date.parse('2026-09-27T00:00:00Z');
  let calls = 0;
  const g = fakeGauge({ history: async () => { calls += 1; throw new Error('down'); }, historyRetryMs: 60 * 60_000 });
  const w = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
  const errs = console.error;
  console.error = () => {};
  try {
    w.tick();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1);
    w.tick();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1, 'held');
    const w2 = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
    w2.tick();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1, 'held across a restart');
    t += 61 * 60_000;
    w2.tick();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 2, 'asked again after the hold');
  } finally {
    console.error = errs;
  }
}));

test('undies history: five ten-year BLS queries once; a complete history is never asked for again', async () => {
  const asked = [];
  const get = {
    json: async (url, opts) => {
      const body = JSON.parse(opts.body);
      asked.push([opts.method, body.startyear, body.endyear]);
      const data = [];
      for (let y = Number(body.startyear); y <= Number(body.endyear); y += 1) for (let m = 1; m <= 12; m += 1) data.push({ year: String(y), period: `M${String(m).padStart(2, '0')}`, value: String(100 + y - 1978 + m / 100) });
      return { status: 'REQUEST_SUCCEEDED', Results: { series: [{ data }] } };
    },
  };
  const now = () => Date.parse('2026-09-27T00:00:00Z');
  const h = await undies.history(get, { now });
  assert.deepEqual(asked.map((a) => a[0]), ['POST', 'POST', 'POST', 'POST', 'POST']);
  assert.deepEqual(asked[0].slice(1), ['1978', '1987']);
  assert.deepEqual(asked[4].slice(1), ['2018', '2026']);
  assert.equal(h.complete, true);
  assert.equal(points(h, 'yoy')[0].d, '1979-01-01', 'a change on a year before needs a year');
  assert.equal(await undies.history(get, { now, prev: h }), h);
  assert.equal(asked.length, 5, 'no more queries');
});

test('undies history: a failed BLS piece is the only one asked for again', async () => {
  const asked = [];
  let fail = true;
  const get = {
    json: async (url, opts) => {
      const body = JSON.parse(opts.body);
      asked.push(body.startyear);
      if (fail && body.startyear === '1998') throw new Error('BLS HTTP 500');
      const data = [];
      for (let y = Number(body.startyear); y <= Number(body.endyear); y += 1) for (let m = 1; m <= 12; m += 1) data.push({ year: String(y), period: `M${String(m).padStart(2, '0')}`, value: String(100 + y - 1978 + m / 100) });
      return { status: 'REQUEST_SUCCEEDED', Results: { series: [{ data }] } };
    },
  };
  const now = () => Date.parse('2026-09-27T00:00:00Z');
  const errs = console.error;
  console.error = () => {};
  let first;
  try { first = await undies.history(get, { now }); } finally { console.error = errs; }
  assert.equal(first.complete, false);
  assert.equal(asked.length, 5);
  fail = false;
  const second = await undies.history(get, { now, prev: first });
  assert.deepEqual(asked.slice(5), ['1998'], 'only the failed piece');
  assert.equal(second.complete, true);
  // The change on a year before is right across the piece that came in late.
  const yoy = new Map(points(second, 'yoy').map((p) => [p.d, p.v]));
  assert.ok(Number.isFinite(yoy.get('1998-01-01')) && Number.isFinite(yoy.get('2008-01-01')));
});

test('macau history: a year that fails on three runs is left alone', async () => {
  let askedBad = 0; // 2024: no later report gives it (the newest one read is two years back)
  const xml = (y) => `<x>Games of Fortune in ${y} and ${y - 1}</x><RECORD><DATA>Jan</DATA><DATA>1,000</DATA><DATA>900</DATA><DATA></DATA><DATA>1,000</DATA><DATA>900</DATA></RECORD>`;
  const get = { text: async (u) => { const y = Number(/\/(\d{4})\//.exec(u)[1]); if (y === 2024) { askedBad += 1; throw new Error('HTTP 404'); } return xml(y); } };
  const now = () => Date.parse('2026-09-27T00:00:00Z');
  const errs = console.error;
  console.error = () => {};
  let h = null;
  try {
    for (let run = 0; run < 5; run += 1) h = await macau.history(get, { now, prev: h });
  } finally { console.error = errs; }
  assert.equal(askedBad, macau.MAX_YEAR_FAILS);
  assert.equal(h.complete, true, 'given up on: complete');
});

test('buzz history: a search that keeps failing stops after three runs', async () => {
  const bad = '2005-01-01';
  let badAsks = 0;
  const get = { json: async (u) => { if (u.includes(`startdt=${bad}`) && u.includes('tariff')) { badAsks += 1; throw new Error('HTTP 500'); } return { hits: { total: { value: 7, relation: 'eq' } } }; } };
  const now = () => Date.parse('2026-09-27T00:00:00Z');
  let h = null;
  for (let run = 0; run < 12 && !h?.complete; run += 1) h = await buzz.history(get, { now, prev: h, retryWait: 0, gapMs: 0 });
  assert.equal(h.complete, true);
  assert.equal(badAsks, 2 * buzz.MAX_CELL_FAILS, 'two tries a run, three runs');
  // The weekly run after that tries it once more (then counts again).
  await buzz.history(get, { now, prev: h, retryWait: 0, gapMs: 0 });
  assert.equal(badAsks, 2 * buzz.MAX_CELL_FAILS + 2);
});

test('buzz history: only missing quarters are asked for, at most a batch per run', async () => {
  let asked = 0;
  const get = { json: async () => { asked += 1; return { hits: { total: { value: 7, relation: 'eq' } } }; } };
  const now = () => Date.parse('2026-09-27T00:00:00Z');
  const first = await buzz.history(get, { now, retryWait: 0, gapMs: 0 });
  assert.equal(asked, buzz.HISTORY_BATCH);
  assert.equal(first.complete, false);
  assert.equal(first.d[first.d.length - 1] < '2024-10-01', true, 'the gauge\'s own 8 quarters are left to it');
  let runs = 1;
  let h = first;
  while (!h.complete && runs < 10) { h = await buzz.history(get, { now, prev: h, retryWait: 0, gapMs: 0 }); runs += 1; }
  assert.equal(h.complete, true);
  assert.equal(h.d[0], '2001-01-01');
  const total = asked;
  const again = await buzz.history(get, { now, prev: h, retryWait: 0, gapMs: 0 });
  assert.equal(asked, total, 'nothing missing: no searches');
  assert.equal(again.complete, true);
});

test('every gauge with history options names them correctly', () => {
  for (const g of GAUGES) {
    if (g.defaultPeriod) assert.ok(WEIRD_PERIODS.includes(g.defaultPeriod), g.id);
    if (g.snapshot) assert.ok(Array.isArray(g.snapshotSeries) && g.snapshotSeries.length, g.id);
    assert.ok(!(g.snapshot && g.history), `${g.id}: one kind of past, not both`);
  }
  const snaps = GAUGES.filter((g) => g.snapshot).map((g) => g.id).sort();
  assert.deepEqual(snaps, ['billions', 'boxrate', 'degen', 'odds', 'pizza', 'rides', 'waffle', 'wsb']);
});

// ---- commands and URLs ---------------------------------------------------------------

test('period words: CANAL 5Y, WEIRD 10Y, PANIC MAX, aliases, any case; other words ignored', () => {
  assert.deepEqual(parseCommand('CANAL 5Y'), { name: 'CANAL', args: { period: '5Y' }, input: 'CANAL 5Y', url: 'CANAL 5Y' });
  assert.deepEqual(parseCommand('ships 10y').args, { period: '10Y' });
  assert.equal(parseCommand('ships 10y').url, 'CANAL 10Y');
  assert.deepEqual(parseCommand('WEIRD 10Y').args, { period: '10Y' });
  assert.equal(parseCommand('PANIC MAX').args.period, 'MAX');
  assert.deepEqual(parseCommand('CANAL').args, {});
  assert.equal(parseCommand('CANAL FOO').url, 'CANAL');
  assert.equal(parseCommand('WEIRD AUTO').url, 'WEIRD', 'AUTO is plain WEIRD');
  assert.equal(parseCommand('CANAL 2Y').url, 'CANAL', 'only the WEIRD periods');
  // ?c=CANAL+5Y is the same words.
  const c = new URLSearchParams('c=CANAL+5Y').get('c');
  assert.equal(parseCommand(c).args.period, '5Y');
  assert.equal(periodWord('3m'), '3M');
  assert.equal(periodWord('1D'), null);
  assert.equal(dayLabel('2026-09-07'), '7 SEP 2026');
});

test('engine: no record line while a deep history is missing or filling in; none for BEIGE', () => withDir(async (dir) => {
  const t = Date.parse('2026-09-27T00:00:00Z');
  // Readings that would give a record line: flat for years, then a new low.
  const hist = monthly(120, (i) => (i === 119 ? 1 : 50), 2016);
  let deep = { ...monthly(12, () => 50, 2015), complete: false };
  const g = { id: 'fill', source: 'F', ttl: 60 * 60_000, defaultPeriod: 'MAX', load: async () => ({ headline: 'F', asOf: '2025-12-01', source: 'F', hist }), history: async () => deep };
  const w = makeWeird({ gauges: [g], lastGoodDir: dir, now: () => t });
  assert.equal((await w.getGauge('fill')).record, null, 'no deep history yet');
  w.tick();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await w.getGauge('fill')).record, null, 'still filling in');
  const beige = GAUGES.find((x) => x.id === 'beige');
  assert.equal(beige.record, false);
  // Once complete: a record from the source's start.
  deep = { ...deep, complete: true };
  const w2 = makeWeird({ gauges: [{ ...g, history: async () => deep }], lastGoodDir: null, now: () => t });
  await w2.getGauge('fill');
  w2.tick();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await w2.getGauge('fill')).record.text, 'RECORD LOW SINCE JAN 2015');
}));

test('engine: grid sparks are worked out once per period until a value changes', () => withDir(async (dir) => {
  const t = Date.parse('2026-09-27T00:00:00Z');
  const w = makeWeird({ gauges: [fakeGauge()], lastGoodDir: dir, now: () => t });
  const a = await w.getWeird({ period: '1Y' });
  const b = await w.getWeird({ period: '1Y' });
  assert.equal(a.gauges[0].spark, b.gauges[0].spark, 'the same array: not recomputed');
}));
