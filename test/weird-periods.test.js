// WEIRD periods on screen and on the share card: the period row, the title strip, the
// grid tile's record line, the chart series and the card with its record line. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { periodRow, titleStrip, tileBody, chartSeries, firstKeys, axisFormat, gaugeShareLinks } from '../public/screens/weird.js';
import { WEIRD_GAUGES, gaugeByCommand } from '../public/screens/weird-gauges.js';
import { gaugeModel, gaugeTree, weirdMeta, cardStrip } from '../lib/og-weird.js';
import { renderPng } from '../lib/og.js';
import { histFrom, periodInfo } from '../data/weird/history.js';

const g = gaugeByCommand('CANAL');
const record = { kind: 'low', record: false, since: '2021-03-01', text: 'LOWEST SINCE MAR 2021', short: 'LOW SINCE MAR 2021' };

test('period row: the chart toolbar look, links for covered periods, greyed ones with a reason', () => {
  const periods = { '3M': { ok: true }, '1Y': { ok: true }, '5Y': { ok: true }, '10Y': { ok: false, title: 'Data starts JAN 2019' }, MAX: { ok: true } };
  const html = periodRow(periods, '5Y', (p) => `CANAL ${p}`);
  assert.match(html, /class="tabs ch-tabs wd-periods"/);
  assert.match(html, /<a class="tab is-active" href="\?c=CANAL\+5Y" data-cmd="CANAL 5Y" aria-current="true">5Y<\/a>/);
  assert.match(html, /<span class="tab is-off" aria-disabled="true" title="Data starts JAN 2019">10Y<\/span>/);
  assert.doesNotMatch(html, /data-cmd="CANAL 10Y"/, 'a greyed period is not a link');
  assert.equal((html.match(/<a /g) || []).length, 4);
  // The grid row starts on AUTO (plain WEIRD).
  const grid = periodRow(null, 'AUTO', (p) => (p === 'AUTO' ? 'WEIRD' : `WEIRD ${p}`), { auto: true });
  assert.match(grid, /<a class="tab is-active" href="\?c=WEIRD" data-cmd="WEIRD" aria-current="true">AUTO<\/a>/);
  assert.match(grid, /data-cmd="WEIRD 10Y">10Y</);
});

test('title strip: the record line and the recording date, from one function; nothing on NO DATA', () => {
  const html = titleStrip(g, { ok: true, source: 'ApeWisdom', record, recording: { since: '2026-09-27' } });
  assert.match(html, /<span class="meta-note" title="The last reading as low as this was in MAR 2021">LOWEST SINCE MAR 2021<\/span>/);
  assert.match(html, /RECORDING SINCE 27 SEP 2026/);
  assert.equal(titleStrip(g, { ok: true, source: 'X' }), '');
  assert.equal(titleStrip(g, { ok: false }), '');
  assert.equal(titleStrip(g, null), '');
  assert.match(titleStrip(g, { ok: true, record: { ...record, record: true, since: '1985-01-01', text: 'RECORD LOW SINCE JAN 1985' } }), /Lower than every reading since JAN 1985/);
});

test('grid tile: the short record line only where the grid asks for it (a DESK card keeps four lines)', () => {
  const d = { ok: true, headline: 'HORMUZ 3 SHIPS/DAY', line: 'x', spark: [1, 2, 3], asOf: '2026-09-20', source: 'IMF PortWatch', record };
  assert.match(tileBody(g, d, { rec: true }), /<p class="wd-rec" title="LOWEST SINCE MAR 2021">LOW SINCE MAR 2021<\/p>/);
  assert.doesNotMatch(tileBody(g, d), /wd-rec/);
  assert.doesNotMatch(tileBody(g, { ok: false, headline: 'NO DATA', source: 'S', record }, { rec: true }), /wd-rec/);
});

test('chart series: readings only, a break across missing stretches, the first view per gauge', () => {
  const hist = histFrom([
    { d: '2026-01-01', hormuz: 30, suez: 40 }, { d: '2026-01-02', hormuz: 31 }, { d: '2026-01-03', hormuz: null, suez: 41 }, { d: '2026-01-04', hormuz: 29, suez: 42 },
  ], [{ key: 'hormuz', label: 'Hormuz' }, { key: 'suez', label: 'Suez' }]);
  const s = chartSeries(hist, ['hormuz', 'suez', 'nope']);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].points.map((p) => p.y), [30, 31, 29]);
  assert.equal(s[0].cls, 'ln-0');
  assert.equal(s[0].gapX, 3 * 86_400_000);
  assert.deepEqual(firstKeys(g, hist), ['hormuz'], 'CANAL picks its lead chokepoint first');
  assert.deepEqual(chartSeries({ d: [], series: [] }, ['x']), []);
  const panic = gaugeByCommand('PANIC');
  const ph = histFrom([{ d: '2026-01-01', total: 4, Recession: 1, Bank_run: 3 }], [{ key: 'total', label: 'All four' }, { key: 'Recession', label: 'Recession' }, { key: 'Bank_run', label: 'Bank run' }]);
  assert.deepEqual(firstKeys(panic, ph), ['Recession', 'Bank_run'], 'PANIC draws the four articles, not the sum');
  const pizza = gaugeByCommand('PIZZA');
  const pz = histFrom([{ d: '2026-01-01', defcon: 4, index: 7 }], [{ key: 'defcon', label: 'DEFCON' }, { key: 'index', label: 'Index', hidden: true }]);
  assert.deepEqual(firstKeys(pizza, pz), ['defcon'], 'a hidden series is not drawn');
  // Axis dates: days for a few months, years for a long window.
  const days = [{ points: [{ x: Date.UTC(2026, 0, 1) }, { x: Date.UTC(2026, 2, 1) }] }];
  assert.equal(axisFormat(days)(Date.UTC(2026, 0, 5)), 'JAN 05');
  const years = [{ points: [{ x: Date.UTC(2000, 0, 1) }, { x: Date.UTC(2026, 0, 1) }] }];
  assert.equal(axisFormat(years)(Date.UTC(2010, 5, 1)), '2010');
});

test('every gauge draws a chart: a label and a number format for its history', () => {
  for (const x of WEIRD_GAUGES) {
    assert.ok(x.chart && x.chart.label, x.id);
    assert.equal(typeof x.chart.fmtY, 'function', x.id);
    assert.doesNotMatch(x.chart.label, /—/);
    assert.equal(typeof x.chart.fmtY(12.5), 'string');
  }
});

test('share link keeps the period asked for', () => {
  const plain = gaugeShareLinks(g, { headline: 'H', line: 'l' }, 'https://bloombroke.com');
  assert.equal(plain.url, 'https://bloombroke.com/?c=CANAL');
  const five = gaugeShareLinks(g, { headline: 'H', line: 'l' }, 'https://bloombroke.com', '5Y');
  assert.equal(five.url, 'https://bloombroke.com/?c=CANAL+5Y');
});

test('share card: the record line in its header strip; the card still renders', async () => {
  const gauge = gaugeByCommand('HOTDOG');
  const d = { id: 'hotdog', ok: true, headline: '$4.66', line: "The $1.50 hot dog in today's money", spark: [1.5, 2, 3, 4.66], asOf: '2026-08-01', source: 'FRED', record: { kind: 'high', record: true, since: '1985-01-01', text: 'RECORD HIGH SINCE JAN 1985', short: 'RECORD HIGH' } };
  const m = gaugeModel(gauge, d);
  assert.equal(m.record, 'RECORD HIGH SINCE JAN 1985');
  assert.deepEqual(cardStrip(m), ['RECORD HIGH SINCE JAN 1985']);
  assert.ok(JSON.stringify(gaugeTree(m)).includes('RECORD HIGH SINCE JAN 1985'));
  assert.match(weirdMeta(m).description, /Record high since Jan 1985\./);
  // No record: no strip note, the same card as before.
  const plain = gaugeModel(gauge, { ...d, record: null });
  assert.equal(plain.record, undefined);
  assert.deepEqual(cardStrip(plain).filter(Boolean), []);
  assert.deepEqual(cardStrip(gaugeModel(gauge, null)).filter(Boolean), []);
  const png = await renderPng(gaugeTree(m));
  assert.ok(Buffer.isBuffer(png) && png.length > 5000);
  assert.deepEqual([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
});

test('periods from the data shape the row: a snapshot gauge only offers MAX at first', () => {
  const info = periodInfo(histFrom([{ d: '2026-09-27', top: 1 }, { d: '2026-09-28', top: 2 }], [{ key: 'top', label: 'T' }]), { recordingSince: '2026-09-27' });
  const html = periodRow(info, 'MAX', (p) => `WSB ${p}`);
  assert.equal((html.match(/is-off/g) || []).length, 4);
  assert.match(html, /title="Recording since 27 SEP 2026">3M</);
});
