import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  makeSnapshot, readSnapshot, fillSnapshot, hasData, sinceItems, sinceText, sinceHtml, fmtSince, sinceWhen,
  MIN_AGE, SINCE_WEIRD, WATCH_ITEMS,
} from '../public/since.js';

const T0 = Date.parse('2026-09-22T01:40:00Z'); // Mon 21:40 in New York
const H = 3_600_000;

const snap = (t, { spx = 7000, quotes = [], gauges = [] } = {}) => makeSnapshot({ t, spx, quotes, gauges });
const q = (ticker, last, kind = 'stock') => ({ ticker, last, kind });
const g = (id, value, ok = true, asOf = undefined) => ({ id, ok, value, asOf });

test('SINCE snapshot: the S&P 500, watchlist prices and WEIRD numbers; bad values left out', () => {
  const s = snap(T0, {
    spx: 7000,
    quotes: [q('SPX', 7000, 'index'), q('NVDA', 200), q('US10Y', 4.1, 'yield'), q('BAD', null), q('ZERO', 0), q('BTC', 80000, 'crypto')],
    gauges: [g('canal', 30), g('boxrate', 4500), g('rides', 0), g('pizza', 5), g('eggs', null), g('canal2', 1)],
  });
  assert.deepEqual(s, { v: 1, t: T0, spx: 7000, watch: { NVDA: 200, BTC: 80000 }, weird: { boxrate: { v: 4500, a: null }, rides: { v: 0, a: null } } });
  assert.deepEqual(SINCE_WEIRD.map((w) => w[0]), ['boxrate', 'rides'], 'no CANAL: a few ships a day is a silly %');
  assert.equal(makeSnapshot({ t: T0, spx: null, quotes: null, gauges: null }).spx, null);
  assert.equal(hasData(makeSnapshot({ t: T0 })), false, 'nothing to save');
  assert.equal(hasData(s), true);
  assert.deepEqual(readSnapshot(JSON.parse(JSON.stringify(s))), s, 'round-trips through storage');
  assert.equal(readSnapshot(null), null);
  assert.equal(readSnapshot({ v: 2, t: T0 }), null);
  assert.equal(readSnapshot({ v: 1, t: 'x' }), null);
  assert.deepEqual(readSnapshot({ v: 1, t: T0, spx: 'x', watch: [1], weird: null }), { v: 1, t: T0, spx: null, watch: {}, weird: {} });
  assert.deepEqual(readSnapshot({ v: 1, t: T0, weird: { rides: 3, boxrate: { v: 1, a: '2026-09-24' }, bad: { v: 'x' } } }).weird,
    { rides: { v: 3, a: null }, boxrate: { v: 1, a: '2026-09-24' } }, 'an older plain number still reads');
});

test('SINCE maths: now vs the snapshot, biggest watchlist moves first', () => {
  const then = snap(T0, { spx: 7000, quotes: [q('NVDA', 200), q('AAPL', 300), q('MSFT', 500), q('TSLA', 400), q('GONE', 10)], gauges: [g('canal', 25), g('boxrate', 4000, true, '2026-09-17'), g('rides', 40, true, 'T1')] });
  const now = snap(T0 + 25 * H, { spx: 7084, quotes: [q('NVDA', 208.2), q('AAPL', 300.3), q('MSFT', 490), q('TSLA', 440), q('NEW', 5)], gauges: [g('canal', 22), g('boxrate', 4100, true, '2026-09-24'), g('rides', 24, true, 'T2')] });
  const items = sinceItems(then, now);
  assert.deepEqual(items.map((i) => i.label), ['S&P 500', 'TSLA', 'NVDA', 'MSFT', 'BOXRATE', 'RIDES']);
  assert.equal(items.filter((i) => !['S&P 500', 'BOXRATE', 'RIDES'].includes(i.label)).length, WATCH_ITEMS, 'three watchlist items at most');
  assert.ok(Math.abs(items[0].pct - 1.2) < 1e-9);
  assert.equal(sinceText(then, items, now.t), 'SINCE MON 21:40: S&P 500 +1.2% · TSLA +10% · NVDA +4.1% · MSFT −2.0% · BOXRATE +2.5% · RIDES −40%');
});

test('SINCE WEIRD items: a gauge that has not updated or not moved is left out', () => {
  const then = snap(T0, { gauges: [g('boxrate', 4000, true, '2026-09-17'), g('rides', 40, true, 'T1')] });
  const same = sinceItems(then, snap(T0 + 3 * H, { gauges: [g('boxrate', 4100, true, '2026-09-17'), g('rides', 40, true, 'T2')] }));
  assert.deepEqual(same.map((i) => i.label), ['S&P 500'], 'same as-of date, and an equal value');
  const noDate = sinceItems(snap(T0, { gauges: [g('rides', 40)] }), snap(T0 + 3 * H, { gauges: [g('rides', 20)] }));
  assert.deepEqual(noDate.map((i) => i.label), ['S&P 500', 'RIDES'], 'no as-of date: the value decides');
});

test('SINCE save: a failed source keeps the stored numbers, never wipes them', () => {
  const stored = snap(T0, { spx: 7000, quotes: [q('NVDA', 200), q('OLD', 5)], gauges: [g('boxrate', 4000, true, 'D1'), g('rides', 40, true, 'T1')] });
  // Quotes and gauges failed this time; only the S&P 500 came in.
  const partial = makeSnapshot({ t: T0 + 2 * H, spx: 7100, quotes: null, gauges: null });
  const filled = fillSnapshot(partial, stored, ['NVDA', 'AAPL']);
  assert.equal(filled.t, T0 + 2 * H);
  assert.equal(filled.spx, 7100, 'the new number wins');
  assert.deepEqual(filled.watch, { NVDA: 200 }, 'stored price kept, a symbol no longer watched dropped');
  assert.deepEqual(filled.weird, stored.weird);
  // The S&P 500 failed but the rest came in: the new ones win, the stored S&P stays.
  const other = fillSnapshot(makeSnapshot({ t: T0 + 3 * H, spx: null, quotes: [q('NVDA', 210)], gauges: [g('rides', 12, true, 'T3')] }), stored, ['NVDA']);
  assert.deepEqual([other.spx, other.watch.NVDA, other.weird.rides.v, other.weird.boxrate.v], [7000, 210, 12, 4000]);
  assert.equal(fillSnapshot(partial, null), partial, 'nothing stored: as is');
});

test('SINCE hiding: under an hour, no snapshot, or nothing to compare hides the line', () => {
  const then = snap(T0, { spx: 7000, quotes: [q('NVDA', 200)] });
  assert.deepEqual(sinceItems(then, snap(T0 + MIN_AGE - 1, { spx: 7100 })), [], 'under an hour');
  assert.equal(sinceItems(then, snap(T0 + MIN_AGE, { spx: 7100 })).length, 1, 'an hour on the dot');
  assert.deepEqual(sinceItems(null, snap(T0 + 5 * H)), []);
  // Missing on either side: that item is skipped, the rest still show.
  const gap = sinceItems(snap(T0, { spx: null, quotes: [q('NVDA', 200)], gauges: [g('rides', 0)] }), snap(T0 + 2 * H, { spx: 7000, quotes: [q('AAPL', 1)], gauges: [g('rides', 30)] }));
  assert.deepEqual(gap, [], 'no S&P then, no shared symbol, a zero base');
  assert.equal(sinceText(then, [], T0 + 2 * H), '');
  assert.equal(sinceHtml(then, [], T0 + 2 * H), '');
  assert.equal(sinceHtml(null, [{ label: 'S&P 500', pct: 1 }], T0), '');
});

test('SINCE format: signs, decimals, colours and the time of the last visit', () => {
  assert.equal(fmtSince(1.234), '+1.2%');
  assert.equal(fmtSince(-12.4), '−12%');
  assert.equal(fmtSince(0.01), '0.0%');
  assert.equal(fmtSince(-0.04), '0.0%');
  assert.equal(sinceWhen(T0, T0 + 2 * H), 'MON 21:40');
  assert.equal(sinceWhen(T0, T0 + 8 * 24 * H), 'SEP 21 21:40', 'older than a week gets the date');
  const html = sinceHtml(snap(T0), [{ label: 'S&P 500', pct: 1.2 }, { label: 'RIDES', pct: -12 }, { label: 'X<Y', pct: 0 }], T0 + 2 * H);
  assert.match(html, /^<span class="since" title="SINCE MON 21:40: /);
  assert.match(html, /<span class="up">\+1\.2%<\/span>/);
  assert.match(html, /<span class="down">−12%<\/span>/);
  assert.match(html, /<span class="flat">0\.0%<\/span>/);
  assert.match(html, /X&lt;Y/);
  assert.doesNotMatch(html, /style=/);
});

test('SINCE on HOME: small hooks in home.js, no emoji, no em dashes', () => {
  const home = readFileSync('public/screens/home.js', 'utf8');
  assert.match(home, /startSince\(el\.querySelector\('#h-mk-meta'\), ctx\)/, 'the MARKETS title strip');
  assert.match(home, /since\.markets\(d\.instruments\)/);
  const src = readFileSync('public/since.js', 'utf8');
  assert.doesNotMatch(src, /\u2014|\p{Extended_Pictographic}/u);
  assert.doesNotMatch(src, new RegExp(['bloom', 'berg'].join(''), 'i'));
  assert.match(src, /pagehide/);
});
