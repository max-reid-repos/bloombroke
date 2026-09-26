import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartSvg, niceTicks, fmtXFor } from '../public/screens/quote.js';
import { tick, fmtNum, fmtAsOf, panel } from '../public/screens/markets.js';
import { safeHref, newsList, fmtNewsTime } from '../public/screens/news.js';
import { ratesRows, fmtBp } from '../public/screens/rates.js';
import { fmtUsd } from '../public/screens/cpi.js';

test('price tick: flash only when a known value changes', () => {
  assert.equal(tick('t:a', 10), '');
  assert.equal(tick('t:a', 10), '');
  assert.equal(tick('t:a', 11), ' tick-up');
  assert.equal(tick('t:a', 9), ' tick-down');
  assert.equal(tick('t:a', NaN), '');
  assert.equal(tick('t:a', 9), '');
});

test('chart: nice ticks and a pixel sized SVG', () => {
  assert.deepEqual(niceTicks(0, 100, 4), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(7668, 7712, 4), [7680, 7700]);
  assert.deepEqual(niceTicks(7668, 7712, 8), [7670, 7680, 7690, 7700, 7710]);
  const pts = [{ t: 0, v: 1 }, { t: 1, v: 3 }, { t: 2, v: 2 }];
  const svg = chartSvg(pts, { width: 400, height: 200, fmtX: String });
  assert.match(svg, /^<svg class="chart" width="400" height="200"/);
  assert.match(svg, /class="ch-line"/);
  assert.doesNotMatch(svg, /style=/, 'no inline styles: the CSP blocks them');
  assert.equal(chartSvg([{ t: 0, v: 1 }]), '');
  assert.equal(fmtXFor('5Y')(Date.UTC(2022, 5, 1)), '2022');
});

test('panels escape their labels', () => {
  const html = panel('1', '<b>x</b>', 'body');
  assert.match(html, /1\) &lt;B&gt;X&lt;\/B&gt;/);
  assert.doesNotMatch(html, /style=/);
});

test('news: only http(s) links, text escaped', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('https://ok.test/x'), 'https://ok.test/x');
  const html = newsList([
    { title: '<img src=x onerror=alert(1)>', link: 'https://ok.test/', time: '2026-09-25T12:00:00Z', source: 'CNBC' },
    { title: 'evil', link: 'javascript:alert(1)', time: null, source: 'CNBC' },
  ]);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.equal(fmtNewsTime('2026-09-25T13:02:00Z', new Date('2026-09-25T15:00:00Z')), '09:02');
  assert.equal(fmtNewsTime('2026-09-20T13:02:00Z', new Date('2026-09-25T15:00:00Z')), 'SEP 20');
});

test('rates rows and formats', () => {
  const rows = ratesRows({
    fed: { from: 3.75, to: 4, effective: 3.88, date: '2026-09-23' },
    yields: [{ id: 'US10Y', name: 'US 10-year Treasury', last: 5.181, change: 0.019, asOf: '2026-09-25T08:56:30.000-0400' }],
    mortgage: { date: '2026-09-24', rate30: 7.03, change30: 0.08, rate15: 6.42, change15: 0.16 },
  });
  assert.deepEqual(rows.map((r) => r.value), ['3.75-4.00%', '3.88%', '5.181%', '7.03%', '6.42%']);
  // One bp helper on every screen: it takes bp (RATES passes points x 100).
  assert.equal(fmtBp(0.019 * 100), '+1.9bp');
  assert.equal(fmtBp(-0.08 * 100), '−8.0bp');
  assert.equal(fmtUsd(141.3316), '$141.33');
  assert.equal(fmtNum(-0.001, 2), '0.00');
  assert.equal(fmtAsOf('2026-09-24'), '09/24');
});
