import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxDrawdown, holdingPath } from '../data/whatif.js';
import { attachRisk, getWhatif } from '../data/whatif-service.js';
import { QUIPS, riskLine, fmtDrop, HINDSIGHT_NOTE, WHATIF_TITLE } from '../public/screens/whatif.js';
import { HINDSIGHT_NOTE as OG_NOTE } from '../lib/og.js';
import { COMMANDS } from '../public/app.js';

const bar = (month, v) => ({ t: Date.parse(`${month}-01T05:00:00Z`), v });

test('max drawdown: worst peak-to-trough fall, with the trough month', () => {
  const path = [{ v: 100, month: '2020-01' }, { v: 120, month: '2020-02' }, { v: 60, month: '2020-03' }, { v: 150, month: '2020-04' }, { v: 90, month: '2020-05' }];
  const dd = maxDrawdown(path);
  assert.equal(dd.pct, -50);
  assert.equal(dd.month, '2020-03');
  assert.equal(dd.peakMonth, '2020-02');
  assert.deepEqual(maxDrawdown([{ v: 1, month: 'a' }, { v: 2, month: 'b' }]), { pct: 0, peakMonth: 'b', month: null });
  assert.equal(maxDrawdown([]), null);
});

test('holding path: buy-day close, month-end closes from the buy month, then today', () => {
  const bars = [bar('2019-12', 50), bar('2020-01', 90), bar('2020-02', 80), bar('2020-03', 40)];
  const p = holdingPath({ date: '2020-01-15', close: 100 }, bars, 120);
  assert.deepEqual(p.map((x) => x.month), ['2020-01', '2020-01', '2020-02', '2020-03', 'now']);
  assert.equal(maxDrawdown(p).pct, -60, 'from the 100 buy to the 40 March close');
  assert.equal(maxDrawdown(p).month, '2020-03');
});

test('attachRisk: every row gets its worst drop; the result names the worst holding', () => {
  const result = {
    rows: [
      { kind: 'once', name: 'Phone', ticker: 'AAA', bought: '2020-01-10', close: 10, price: 30 },
      { kind: 'monthly', name: 'Coffee', ticker: 'BBB', from: '2020-01', price: 5 },
      { kind: 'once', name: 'Bike', ticker: 'CCC', bought: '2020-01-10', close: 10, price: 12 },
    ],
  };
  const prices = { monthly: { BBB: { '2020-01': { date: '2020-01-02', close: 10 } } } };
  const bars = { AAA: [bar('2020-01', 9), bar('2020-02', 20), bar('2020-03', 15)], BBB: [bar('2020-01', 10), bar('2020-02', 2)], CCC: null };
  attachRisk(result, bars, { prices });
  assert.equal(result.rows[0].worstDrop.pct, -25);
  assert.equal(result.rows[1].worstDrop.pct, -80);
  assert.equal(result.rows[2].worstDrop, null, 'no chart, no number');
  assert.equal(result.risk.worst.ticker, 'BBB');
  assert.equal(result.risk.worst.month, '2020-02');
  assert.equal(result.risk.complete, false);
  assert.deepEqual(result.rows.map((r) => r.name), ['Phone', 'Coffee', 'Bike'], 'row order kept');
});

test('getWhatif with risk: uses monthly bars, survives a chart failure', async () => {
  const quoteImpl = async () => ({ last: 300, asOf: '2026-09-25T15:00:00Z' });
  const chartImpl = async () => ({ bar: '1MO', points: [bar('2014-09', 25), bar('2015-01', 20), bar('2016-05', 10), bar('2026-08', 290)] });
  const d = await getWhatif(['IPHONE6'], { quoteImpl, chartImpl, risk: true });
  assert.ok(d.rows[0].worstDrop.pct < -50);
  assert.equal(d.risk.worst.ticker, 'AAPL');
  const broken = await getWhatif(['IPHONE6'], { quoteImpl, chartImpl: async () => { throw new Error('down'); }, risk: true });
  assert.equal(broken.rows[0].worstDrop, null);
  assert.equal(broken.risk.worst, null);
  const slow = await getWhatif(['IPHONE6'], { quoteImpl, chartImpl: () => new Promise(() => {}), risk: true, riskWaitMs: 20 });
  assert.equal(slow.risk.worst, null, 'a slow chart source does not hold the answer');
  const plain = await getWhatif(['IPHONE6'], { quoteImpl, chartImpl: () => { throw new Error('not asked'); } });
  assert.equal(plain.risk, undefined, 'the share image path does not fetch charts');
});

test('risk line: always shown, one holding or several', () => {
  const one = { rows: [{}], risk: { worst: { pct: -43.4, month: '2020-03', name: 'iPhone 6', ticker: 'AAPL' } } };
  assert.equal(riskLine(one), 'Worst drop along the way: −43% (MAR 2020), based on month-end prices.');
  const many = { rows: [{}, {}], risk: { worst: { pct: -74.7, month: '2022-06', name: 'Netflix', ticker: 'NFLX' } } };
  assert.equal(riskLine(many), 'Worst drop along the way: −75% (JUN 2022), in NFLX (Netflix), based on month-end prices.');
  assert.match(riskLine({ rows: [{}], risk: { worst: { pct: -12, month: 'now', name: 'x', ticker: 'X' } } }), /\(today\)/);
  assert.match(riskLine({ rows: [{}] }), /^Worst drop along the way: not available right now/);
  assert.match(riskLine({ rows: [{}], risk: { worst: { pct: 0, month: null } } }), /none at month-end prices/);
  assert.equal(fmtDrop(-0.2), '0%');
});

test('WHATIF copy is hindsight, never advice', () => {
  const all = [...QUIPS.big, ...QUIPS.gain, ...QUIPS.loss, WHATIF_TITLE, COMMANDS.find((c) => c.name === 'WHATIF').hint];
  for (const line of all) {
    assert.doesNotMatch(line, /\bshould\b/i, line);
    assert.doesNotMatch(line, /usually|always|will (grow|rise)/i, line);
  }
  assert.ok(QUIPS.big.includes('In hindsight, the company did better than the product.'));
  assert.equal(HINDSIGHT_NOTE, 'Hindsight only. Past returns do not predict future returns. Not a recommendation.');
  assert.equal(OG_NOTE, HINDSIGHT_NOTE, 'the share image carries the same small print');
});
