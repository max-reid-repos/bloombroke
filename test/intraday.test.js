import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  etParts, sessionOf, intradayStats, sessionDomain, timeTicks, dayStarts, sessionRuns,
  sessionRefs, withRefs, placeLabels, boxFor, overlaps, labelWidth, whenLabel,
} from '../public/screens/intraday.js';
import { chartSvg, chartGeom, nearestIndex, intradaySpec, stripItems } from '../public/screens/chart.js';
import { fmtNum } from '../public/screens/markets.js';

// Friday 25 Sep 2026 is summer time in New York: 09:30 ET = 13:30 UTC.
const ET = (day, hm) => Date.parse(`${day}T${hm}:00-04:00`);
const bars = (day, from, values, stepMin = 5) => values.map((v, k) => ({ t: ET(day, from) + k * stepMin * 60_000, v }));

test('New York time for a bar, and which session it is in', () => {
  const e = etParts(ET('2026-09-25', '10:42'));
  assert.deepEqual([e.day, e.weekday, e.hm, e.mins, e.date], ['2026-09-25', 'FRI', '10:42', 642, 25]);
  assert.equal(sessionOf(9 * 60 + 29), 'pre');
  assert.equal(sessionOf(9 * 60 + 30), 'regular');
  assert.equal(sessionOf(16 * 60), 'regular', 'the 16:00 bar is the close');
  assert.equal(sessionOf(16 * 60 + 5), 'post');
  assert.equal(whenLabel(ET('2026-09-24', '13:05'), true), 'THU 13:05');
  assert.equal(whenLabel(ET('2026-09-24', '13:05'), false), '13:05');
});

test('high, low and the biggest 5-minute move, from the actual bars', () => {
  const pts = bars('2026-09-25', '09:30', [100, 101, 100.5, 103, 102, 99, 99.5]);
  const s = intradayStats(pts);
  assert.equal(s.high.i, 3);
  assert.equal(s.high.v, 103);
  assert.equal(etParts(s.high.t).hm, '09:45');
  assert.equal(s.low.i, 5);
  assert.equal(etParts(s.low.t).hm, '09:55');
  // 100.5 -> 103 is +2.49%; 102 -> 99 is -2.94%, the bigger one.
  assert.equal(s.move.i, 5);
  assert.ok(Math.abs(s.move.pct - (-3 / 102) * 100) < 1e-9);
  assert.equal(etParts(s.move.t).hm, '09:55');
});

test('the move ignores the live point, gaps and overnight jumps', () => {
  const day1 = bars('2026-09-24', '15:50', [100, 100.1, 100.2]);
  const day2 = bars('2026-09-25', '09:30', [110, 110.2, 110.1]);
  const live = { t: ET('2026-09-25', '09:42'), v: 130, live: true };
  const s = intradayStats([...day1, ...day2, live]);
  assert.equal(s.high.v, 130, 'the live price is real, so it can be the high');
  assert.equal(s.move.from, 110, 'the overnight gap and the live jump are not 5-minute moves');
  assert.equal(s.move.to, 110.2);
  const gappy = [{ t: ET('2026-09-25', '10:00'), v: 100 }, { t: ET('2026-09-25', '10:30'), v: 120 }];
  assert.equal(intradayStats(gappy).move, null, 'bars 30 minutes apart are not a 5-minute move');
  assert.equal(intradayStats(bars('2026-09-25', '09:30', [5, 5, 5])).move, null, 'no move on a flat line');
  assert.equal(intradayStats(bars('2026-09-25', '09:30', [5, 6]), { bar: '1H' }).move, null);
  assert.deepEqual(intradayStats([{ t: 1, v: 1 }]), { high: null, low: null, move: null });
});

test('1D domain: a session day spans 09:30 to 16:00, anything else first to last bar', () => {
  const pts = bars('2026-09-25', '09:30', [1, 2, 3]);
  const [a, b] = sessionDomain(pts);
  assert.equal(etParts(a).hm, '09:30');
  assert.equal(etParts(b).hm, '16:00');
  const fut = bars('2026-09-25', '08:00', [1, 2, 3]);
  assert.deepEqual(sessionDomain(fut), [fut[0].t, fut[2].t]);
});

test('clock ticks land on round New York times and thin out when narrow', () => {
  const [a, b] = [ET('2026-09-25', '09:30'), ET('2026-09-25', '16:00')];
  const wide = timeTicks(a, b, 1400).map((t) => t.label);
  assert.deepEqual(wide, ['09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']);
  const narrow = timeTicks(a, b, 300).map((t) => t.label);
  assert.deepEqual(narrow, ['10:00', '12:00', '14:00', '16:00']);
  assert.deepEqual(timeTicks(b, a, 300), []);
});

test('5D: day starts, and shading runs for pre-market and after-hours bars', () => {
  const pts = [...bars('2026-09-24', '15:50', [1, 2, 3, 4, 5]), ...bars('2026-09-25', '09:20', [6, 7, 8])];
  assert.deepEqual(dayStarts(pts).map((d) => [d.i, d.label]), [[0, 'THU 24'], [5, 'FRI 25']]);
  // 15:50 15:55 16:00 regular, 16:05 16:10 after hours, 09:20 09:25 pre-market, 09:30 regular.
  assert.deepEqual(sessionRuns(pts), [{ i0: 3, i1: 4, kind: 'post' }, { i0: 5, i1: 6, kind: 'pre' }]);
});

test('previous close and open come from a quote about the same day, never another day', () => {
  const pts = bars('2026-09-25', '09:30', [100, 101]);
  const quote = { asOf: '2026-09-25T11:19:14.916-0400', prevClose: 99, open: 100.4 };
  assert.deepEqual(sessionRefs(pts, quote), { prevClose: 99, open: 100.4 });
  const monday = { ...quote, asOf: '2026-09-28T09:31:00.000-0400' };
  assert.deepEqual(sessionRefs(pts, monday), { prevClose: null, open: null });
  const five = [...bars('2026-09-24', '15:50', [90, 91, 92]), ...pts];
  assert.deepEqual(sessionRefs(five, null, { multiDay: true }), { prevClose: 92, open: null }, '5D falls back to the last bar of the day before');
});

test('reference lines widen the value range, but never more than double it', () => {
  assert.deepEqual(withRefs(100, 110, [95, null]), { lo: 95, hi: 110, shown: [true, false] });
  assert.deepEqual(withRefs(100, 110, [70]), { lo: 100, hi: 110, shown: [false] });
});

test('label placement: sides in order, kept on the chart, least important dropped first', () => {
  const b = boxFor({ text: 'HIGH', x: 100, y: 50 }, 'above');
  assert.equal(b.y1, 44);
  assert.equal(b.x1 - b.x0, labelWidth('HIGH'));
  assert.ok(overlaps({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 9, y0: 9, x1: 20, y1: 20 }));
  assert.ok(!overlaps({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 0, x1: 20, y1: 10 }));

  // Near the top, HIGH cannot go above, so it goes to the right.
  const [high] = placeLabels([{ key: 'high', text: 'HIGH 1 · 10:00', x: 50, y: 20, prio: 1, sides: ['above', 'right'] }], { width: 400, top: 8, bottom: 200 });
  assert.equal(high.side, 'right');
  // At the right edge a label slides left to stay on the chart.
  const [edge] = placeLabels([{ key: 'e', text: 'LOW 1 · 15:55', x: 398, y: 100, prio: 1, sides: ['below'] }], { width: 400, top: 0, bottom: 200 });
  assert.ok(edge.box.x1 <= 400 && edge.box.x0 >= 0);

  // Three labels fighting for one spot: the two most important win, in priority order.
  const crowd = ['move', 'high', 'open'].map((key, k) => ({ key, text: 'XXXXXXXX', x: 100, y: 100, prio: [5, 1, 4][k], sides: ['above', 'below'] }));
  const got = placeLabels(crowd, { width: 400, top: 0, bottom: 200 });
  assert.deepEqual(got.map((p) => p.key), ['high', 'open']);
  // A second x lets a line label sit beside another one on the same line.
  const refs = [
    { key: 'prev', text: 'PREV CLOSE 1', x: 398, y: 100, prio: 3, sides: ['above-end'] },
    { key: 'open', text: 'OPEN 1', x: 398, xs: [300], y: 101, prio: 4, sides: ['above-end'] },
  ];
  assert.deepEqual(placeLabels(refs, { width: 400, top: 0, bottom: 200 }).map((p) => p.key), ['prev', 'open']);
});

test('intraday chart: clock axis, reference lines and markers with times', () => {
  const pts = bars('2026-09-25', '09:30', [7695, 7712, 7731.2, 7700, 7702, 7705, 7690.5]);
  const spec = intradaySpec(pts, { bar: '5M', quote: { asOf: '2026-09-25T10:00:00.000-0400', prevClose: 7704.13, open: 7709.86 } });
  assert.equal(spec.multiDay, false);
  const fmtY = (v) => fmtNum(v, 2);
  const svg = chartSvg(pts, { width: 900, height: 320, fmtY, intraday: spec });
  assert.match(svg, />09:30</);
  assert.match(svg, />16:00</);
  assert.match(svg, /class="ch-ref ch-ref-prev"/);
  assert.match(svg, /class="ch-ref ch-ref-open"/);
  assert.match(svg, /HIGH 7,731.20 · 09:40/);
  assert.match(svg, /LOW 7,690.50 · 10:00/);
  assert.match(svg, /−0.40% · 09:45/);
  assert.doesNotMatch(svg, /style=/, 'no inline styles: the CSP blocks them');
  // The session runs to 16:00, so the last bar sits well left of the right edge.
  const g = chartGeom(pts, { width: 900, height: 320, timeDomain: spec.timeDomain });
  assert.ok(g.xs[6] < g.W / 5);
  assert.equal(nearestIndex(g.xs, g.W), 6);
  assert.equal(nearestIndex(g.xs, 0), 0);
  assert.equal(intradaySpec(pts, { bar: '1D' }), null, 'daily bars get the plain chart');

  const items = stripItems(pts, spec, { fmtY });
  assert.deepEqual(items.map((i) => `${i.k} ${i.v}`), ['Since open −0.25%', 'Since prev close −0.18%', 'Range 7,690.50 - 7,731.20']);
  const hover = stripItems(pts, spec, { fmtY, hover: pts[2] });
  assert.deepEqual(hover.map((i) => i.v), ['09:40 ET', '7,731.20', '+0.35%', '+0.28%']);
  assert.deepEqual(hover.slice(2).map((i) => i.k), ['vs prev close', 'vs open']);
});

test('longer ranges: last, high and low close with dates, average close', () => {
  const pts = [100, 120, 90, 110].map((v, k) => ({ t: Date.UTC(2026, 0, 5 + k, 21), v }));
  const items = stripItems(pts, null, { fmtY: (v) => fmtNum(v, 2), bar: '1D' });
  assert.deepEqual(items.map((i) => [i.k, i.v, i.when || '']), [
    ['Last', '110.00', ''], ['High close', '120.00', 'JAN 6, 2026'], ['Low close', '90.00', 'JAN 7, 2026'], ['Average close', '105.00', ''],
  ]);
});
