// Chart N flags: headlines on 1D and 5D bars, other 8-K filings on daily bars and longer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeNewsFlags, mergeFlags, capFlags, MAX_N_FLAGS } from '../public/screens/chart-math.js';
import { newsFlags, filingFlags } from '../public/screens/chart.js';
import { svgFor } from '../public/screens/chart-view.js';
import { other8K } from '../data/chart-events.js';

const MIN5 = 5 * 60_000;
// Five-minute bars from 09:30 to 16:00 ET on Fri 2026-09-25 (13:30Z to 20:00Z).
const OPEN = Date.parse('2026-09-25T13:30:00Z');
const times = Array.from({ length: 78 }, (_, i) => OPEN + i * MIN5);

test('N flags: a headline goes on the bar that holds its time', () => {
  const items = [
    { t: OPEN + 12 * 60_000, id: 'a' }, // 09:42: the 09:40 bar (i 2)
    { t: OPEN, id: 'b' }, // the open: bar 0
    { t: Date.parse('2026-09-25T19:59:00Z'), id: 'c' }, // 15:59: the last bar
    { t: Date.parse('2026-09-25T20:30:00Z'), id: 'd' }, // after the last bar: off
    { t: OPEN - 60_000, id: 'e' }, // before the first bar: off
    { t: NaN, id: 'f' },
  ];
  assert.deepEqual(placeNewsFlags(items, times, 0, times.length - 1, MIN5).map((x) => [x.id, x.i]), [['a', 2], ['b', 0], ['c', 77]]);
});

test('N flags: a headline in a gap between sessions goes on the next bar', () => {
  // Two sessions: Thu 15:55 is the last bar of the first, Fri 09:30 the first of the next.
  const two = [Date.parse('2026-09-24T19:55:00Z'), ...times];
  const night = Date.parse('2026-09-25T02:00:00Z'); // Thu 22:00 ET
  assert.deepEqual(placeNewsFlags([{ t: night }], two, 0, two.length - 1, MIN5).map((x) => x.i), [1]);
  assert.deepEqual(placeNewsFlags([{ t: night }], times, 0, 5, MIN5), [], 'nothing before the window');
});

test('N flags: flags on the same bar merge; the newest link is on top', () => {
  const merged = mergeFlags([
    { i: 3, kind: 'N', url: 'https://n.test/new', line: '10:00 ET · CNBC · New' },
    { i: 3, kind: 'N', url: 'https://n.test/old', line: '09:47 ET · SA · Old' },
    { i: 1, kind: 'N', url: null, line: '09:36 ET · SA · Early' },
  ], 'HEADLINES');
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((f) => f.i), [1, 3]);
  assert.equal(merged[1].url, 'https://n.test/new');
  assert.equal(merged[1].count, 2);
  assert.equal(merged[1].title, '2 HEADLINES · 10:00 ET · CNBC · New');
  assert.equal(merged[1].tip, '10:00 ET · CNBC · New\n09:47 ET · SA · Old');
  assert.equal(merged[0].title, '09:36 ET · SA · Early');
});

test('N flags: at most about 12 in view, the latest; E and D always stay', () => {
  assert.equal(MAX_N_FLAGS, 12);
  const flags = [
    ...Array.from({ length: 20 }, (_, i) => ({ i, kind: 'N' })),
    { i: 0, kind: 'E' }, { i: 1, kind: 'D' },
  ];
  const out = capFlags(flags);
  assert.equal(out.filter((f) => f.kind === 'N').length, 12);
  assert.deepEqual(out.filter((f) => f.kind === 'N').map((f) => f.i), Array.from({ length: 12 }, (_, i) => i + 8));
  assert.equal(out.filter((f) => f.kind !== 'N').length, 2);
  assert.equal(capFlags(flags.slice(0, 5)).length, 5);
});

test('N flags: headlines -> one flag per bar with time, source and title', () => {
  const heads = [
    { time: '2026-09-25T14:02:00Z', source: 'CNBC', title: 'Apple rises', url: 'https://n.test/1' },
    { time: '2026-09-25T14:04:00Z', source: 'Nasdaq', title: 'Apple talks', url: 'https://n.test/2' },
    { time: '2026-09-25T15:30:00Z', source: 'SA', title: 'Apple later', url: 'javascript:alert(1)' },
    { time: 'bad', source: 'SA', title: 'x', url: 'https://n.test/3' },
  ];
  const f = newsFlags(heads, times, '5M');
  assert.equal(f.length, 2);
  assert.equal(f[0].i, 6); // 10:00 bar
  assert.equal(f[0].kind, 'N');
  assert.equal(f[0].url, 'https://n.test/2', 'the newest of the bar');
  assert.match(f[0].title, /^2 HEADLINES · 10:04 ET · Nasdaq · Apple talks$/);
  assert.equal(f[0].hint, 'CLICK N TO OPEN THE STORY');
  assert.equal(f[1].url, null, 'only web links open');
  assert.deepEqual(newsFlags(null, times, '5M'), []);
});

test('N flags: daily bars get the non-earnings 8-K days, merged per bar', () => {
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28'];
  const f = filingFlags([
    { date: '2026-09-22', url: 'https://www.sec.gov/a', text: '8-K: executive change' },
    { date: '2026-09-22', url: 'https://www.sec.gov/b', text: '8-K: other events' },
    { date: '2026-09-26', url: 'https://www.sec.gov/c', text: '8-K: major agreement' }, // a Saturday: Monday's bar
  ], days, '1D');
  assert.deepEqual(f.map((x) => [x.i, x.count]), [[1, 2], [5, 1]]);
  assert.match(f[0].title, /^2 FILINGS · 8-K: other events/);
  assert.equal(f[0].hint, 'CLICK N FOR THE SEC FILING');
});

test('N flags: drawn like E and D, linked out in a new tab, tooltip lists every line', () => {
  const points = times.map((t, i) => ({ t, v: 100 + i }));
  const info = points.map(() => ({ day: '2026-09-25', mins: 600, session: 'regular' }));
  const flags = [{ i: 6, kind: 'N', url: 'https://n.test/2', title: '2 HEADLINES · 10:04 ET · Nasdaq · Apple talks', tip: 'a\nb' }, { i: 2, kind: 'E', url: null, title: 'EARNINGS' }];
  const { svg } = svgFor({ points, info, full: [0, points.length - 1], style: 'line', compare: [], refs: {}, flags, intraday: true, fmtY: String, label: 'x', whenAt: () => '' }, null, 800, 300);
  assert.match(svg, /<a class="ch-flag is-N" data-k="0" href="https:\/\/n\.test\/2" target="_blank" rel="noopener noreferrer">/);
  assert.match(svg, />N<\/text><title>a\nb<\/title>/);
  assert.match(svg, /class="ch-flag is-E"/);
});

test('N flags: the server lists 8-Ks that are not earnings, with their words', () => {
  const rows = [
    { form: '8-K', filed: '2026-07-30', items: ['2.02', '9.01'], url: 'https://www.sec.gov/e' },
    { form: '8-K', filed: '2026-08-12', items: ['5.02'], url: 'https://www.sec.gov/x' },
    { form: '8-K/A', filed: '2026-06-01', items: ['1.01'], url: 'https://evil.test/y' },
    { form: '10-Q', filed: '2026-08-01', items: [], url: 'https://www.sec.gov/q' },
  ];
  assert.deepEqual(other8K(rows), [
    { date: '2026-06-01', url: null, text: '8-K: major agreement (amended)' },
    { date: '2026-08-12', url: 'https://www.sec.gov/x', text: '8-K: executive change' },
  ]);
});
