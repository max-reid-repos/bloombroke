import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSpec, monthlyCost, oneOffRow, recurringRow, totals, resolveTokens, computeWhatif, whatifCommand,
  addMonths, monthsBetween, daysInMonth, stepPrice, WhatifError,
} from '../data/whatif.js';
import { getWhatif, getFunding } from '../data/whatif-service.js';
import { planWhatif, normalizeSpec, commandFor, quipFor, QUIPS, familyIds, fmtX } from '../public/screens/whatif.js';

const catalog = JSON.parse(readFileSync(new URL('../data/whatif-products.json', import.meta.url)));
const prices = JSON.parse(readFileSync(new URL('../data/whatif-prices.json', import.meta.url)));
const close = (a, b, tol = 1e-3) => Math.abs(a - b) / b < tol;
const NOW = new Date('2026-09-25T15:00:00Z');

test('baked closes match known raw closes divided by the splits since', () => {
  // AAPL 11 Jul 2008 closed at $172.58; splits since: 7:1 (2014) and 4:1 (2020).
  assert.ok(close(prices.buys.iphone3g.close, 172.58 / 28));
  // AAPL 19 Sep 2014 closed at $100.96; one split since: 4:1 (2020).
  assert.ok(close(prices.buys.iphone6.close, 100.96 / 4));
  // TSLA 7 Aug 2018 closed at $379.57; splits since: 5:1 (2020) and 3:1 (2022).
  assert.ok(close(prices.funding.close, 379.57 / 15));
  assert.equal(prices.funding.date, '2018-08-07');
  // A buy uses the purchase day, or the last trading day before it (iPad: Sat 3 Apr 2010, Good Friday shut).
  assert.equal(prices.buys.ipad.date, '2010-04-01');
  assert.equal(prices.buys.iphone6.date, '2014-09-19');
});

test('split history in the baked file matches the known splits', () => {
  const has = (t, date, ratio) => prices.splits[t].some((s) => s.date === date && s.ratio === ratio);
  assert.ok(has('AAPL', '2014-06-09', '7:1') && has('AAPL', '2020-08-31', '4:1'));
  assert.ok(has('TSLA', '2020-08-31', '5:1') && has('TSLA', '2022-08-25', '3:1'));
  assert.ok(has('NVDA', '2021-07-20', '4:1') && has('NVDA', '2024-06-10', '10:1'));
  assert.ok(has('AMZN', '2022-06-06', '20:1'));
  assert.ok(has('NFLX', '2015-07-15', '7:1') && has('NFLX', '2025-11-17', '10:1'));
  assert.ok(has('CMG', '2024-06-26', '50:1'));
  assert.ok(has('SBUX', '2015-04-09', '2:1'));
  assert.ok(has('SONY', '2024-10-09', '5:1'));
});

test('every baked price was checked against a second source', () => {
  for (const [id, b] of Object.entries(prices.buys)) assert.equal(b.verified, true, id);
  for (const [t, series] of Object.entries(prices.monthly)) {
    for (const [k, m] of Object.entries(series)) assert.equal(m.verified, true, `${t} ${k}`);
  }
  assert.equal(prices.funding.verified, true);
  // Every catalog item has a price and a source.
  for (const p of catalog.products) { assert.ok(prices.buys[p.id], p.id); assert.match(p.src, /^https:\/\//, p.id); }
  for (const r of catalog.recurring) { assert.ok(prices.monthly[r.ticker], r.id); assert.match(r.src, /^https:\/\//, r.id); }
});

test('iPhone prices share one basis: full US price, or a label where only a contract price existed', () => {
  const phones = catalog.products.filter((p) => p.family === 'IPHONE');
  const by = Object.fromEntries(phones.map((p) => [p.id, p]));
  // The iPhone 3G was sold only on a 2-year AT&T contract at US launch.
  assert.equal(by.iphone3g.price, 199);
  assert.equal(by.iphone3g.name, 'iPhone 3G (on contract)');
  assert.match(by.iphone3g.note, /on contract/);
  assert.match(by.iphone3g.src, /^https:\/\/www\.apple\.com\/newsroom\/2008\/06\//);
  // No-commitment (full) US prices at launch, each with its own source.
  assert.deepEqual([by.iphone3gs.price, by.iphone4.price, by.iphone4s.price, by.iphone5.price], [599, 599, 649, 649]);
  for (const p of phones) {
    const contract = /\(on contract\)/.test(p.name);
    assert.equal(contract, /on contract/.test(p.note) && !/full price/.test(p.note), `${p.id}: the name and the note agree`);
    if (contract) assert.ok(p.price < 300, `${p.id}: a contract price`);
    else assert.ok(p.price >= 599, `${p.id}: a full price, not a contract price`);
  }
});

test('months and specs', () => {
  assert.equal(addMonths('2024-11', 3), '2025-02');
  assert.equal(addMonths('2024-01', -1), '2023-12');
  assert.equal(monthsBetween('2024-11', '2025-02').length, 4);
  assert.equal(daysInMonth('2024-02'), 29);
  const latte = catalog.recurring.find((r) => r.id === 'latte');
  const spotify = catalog.recurring.find((r) => r.id === 'spotify');
  assert.deepEqual(parseSpec('3Y', latte, NOW), { start: '2023-10', end: '2026-09', clamped: false });
  assert.deepEqual(parseSpec('2015-2024', latte, NOW), { start: '2015-01', end: '2024-12', clamped: false });
  assert.deepEqual(parseSpec('2020', latte, NOW), { start: '2020-01', end: '2026-09', clamped: false });
  assert.deepEqual(parseSpec('2010-2019', spotify, NOW), { start: '2018-04', end: '2019-12', clamped: true });
  assert.equal(parseSpec('', latte, NOW).start, '2021-10', 'default 5 years');
  assert.throws(() => parseSpec('forever', latte, NOW), WhatifError);
  assert.throws(() => parseSpec('2030', latte, NOW), WhatifError);
});

test('monthly costs: step prices, per day, per week, per year, scaled', () => {
  const netflix = catalog.recurring.find((r) => r.id === 'netflix');
  assert.equal(stepPrice(netflix.prices, '2014-04'), 7.99);
  assert.equal(stepPrice(netflix.prices, '2014-05'), 8.99);
  assert.equal(monthlyCost(netflix, '2019-06', catalog), 12.99);
  const prime = catalog.recurring.find((r) => r.id === 'prime');
  assert.ok(close(monthlyCost(prime, '2020-01', catalog), 119 / 12));
  const bigmac = catalog.recurring.find((r) => r.id === 'bigmac');
  assert.ok(close(monthlyCost(bigmac, '2026-08', catalog), 6.22 * 52 / 12));
  const latte = catalog.recurring.find((r) => r.id === 'latte');
  assert.ok(close(monthlyCost(latte, '2026-08', catalog), 5.95 * 31), 'today price, 31 days');
  assert.ok(close(monthlyCost(latte, '2016-02', catalog), 5.95 * (4.29 / 6.22) * 29), 'scaled back, 29 days');
});

test('one-off and recurring rows, totals', () => {
  const iphone6 = catalog.products.find((p) => p.id === 'iphone6');
  const r = oneOffRow(iphone6, { date: '2014-09-19', close: 25.24 }, 300);
  assert.ok(close(r.shares, 649 / 25.24));
  assert.ok(close(r.value, (649 / 25.24) * 300));
  assert.ok(close(r.multiple, 300 / 25.24));

  const netflix = catalog.recurring.find((x) => x.id === 'netflix');
  const monthly = { '2019-01': { close: 10 }, '2019-02': { close: 20 } };
  const rr = recurringRow(netflix, { start: '2019-01', end: '2019-03', clamped: false }, monthly, 40, catalog);
  assert.equal(rr.buys, 3);
  assert.ok(close(rr.paid, 12.99 * 3));
  // March has no baked close, so it buys at today's price.
  assert.ok(close(rr.shares, 12.99 / 10 + 12.99 / 20 + 12.99 / 40));
  assert.ok(close(rr.value, rr.shares * 40));

  const t = totals([{ paid: 100, value: 300 }, { paid: 100, value: 50 }]);
  assert.deepEqual(t, { paid: 200, value: 350, gain: 150, multiple: 1.75, pct: 75 });
});

test('tokens: items, specs, families, unknown words', () => {
  const r = resolveTokens(['IPHONE6', 'LATTE:3Y', 'APPLE', 'IPHONES', 'NOPE'], catalog);
  assert.deepEqual(r.picks, [{ id: 'iphone6', spec: '' }, { id: 'latte', spec: '3Y' }]);
  assert.deepEqual(r.families, ['APPLE', 'IPHONE']);
  assert.deepEqual(r.unknown, ['NOPE']);
  assert.equal(whatifCommand([{ id: 'iphone6', spec: '' }, { id: 'latte', spec: '3Y' }]), 'WHATIF IPHONE6 LATTE:3Y');
  const quotes = { AAPL: 300 };
  assert.throws(() => computeWhatif([], { catalog, prices, quotes }), /at least one/);
  assert.throws(() => computeWhatif([{ id: 'iphone6', spec: '3Y' }], { catalog, prices, quotes }), /one-off/);
});

test('service: a full result from baked prices and a fake quote', async () => {
  const quoteImpl = async (t) => ({ last: { AAPL: 300, SBUX: 90, PTON: 5 }[t], asOf: '2026-09-25T11:00:00.000-0400' });
  const d = await getWhatif(['IPHONE6', 'LATTE:3Y', 'PELOTON'], { quoteImpl, now: NOW });
  assert.equal(d.rows.length, 3);
  assert.ok(close(d.rows[0].value, (649 / prices.buys.iphone6.close) * 300));
  assert.equal(d.rows[1].buys, 36);
  assert.ok(d.rows[2].multiple < 1, 'Peloton lost money');
  assert.equal(d.stale, false);
  assert.match(d.source, /cross-checked/);
  assert.deepEqual(await getWhatif(['IPHONE'], { quoteImpl }), { picker: true, families: ['IPHONE'] });
  await assert.rejects(getWhatif(['ZZZ'], { quoteImpl }), /Not on the list: ZZZ/);
  // A dead quote source falls back to the last baked close, marked stale.
  const dead = await getWhatif(['IPHONE6'], { quoteImpl: async () => { throw new Error('down'); }, now: NOW });
  assert.equal(dead.stale, true);
  assert.equal(dead.rows[0].price, prices.last.AAPL.close);
  const f = await getFunding({ quoteImpl: async () => ({ last: 400, asOf: '2026-09-25T11:00:00.000-0400' }) });
  assert.ok(close(f.value, (420 / prices.funding.close) * 400));
  assert.equal(f.points[f.points.length - 1].v, 400);
});

test('picker helpers: families, edit mode, specs, command', () => {
  const cat = {
    products: catalog.products.map((p) => ({ ...p, kind: 'once' })),
    recurring: catalog.recurring.map((r) => ({ ...r, kind: 'monthly' })),
  };
  assert.equal(familyIds(cat, 'IPHONE').length, 18);
  assert.deepEqual(familyIds(cat, 'TESLA'), ['models', 'model3', 'modely', 'cybertruck']);
  assert.equal(planWhatif([], cat).mode, 'picker');
  assert.equal(planWhatif(['IPHONE'], cat).mode, 'picker');
  assert.equal(planWhatif(['IPHONE'], cat).picks.size, 18);
  assert.equal(planWhatif(['IPHONE6'], cat).mode, 'result');
  const edit = planWhatif(['EDIT', 'IPHONE6', 'LATTE:3Y'], cat);
  assert.equal(edit.mode, 'picker');
  assert.equal(edit.picks.get('latte'), '3Y');
  assert.equal(normalizeSpec('5', 3), '5Y');
  assert.equal(normalizeSpec('2015-2024', 3), '2015-2024');
  assert.equal(normalizeSpec('junk', 3), '3Y');
  assert.equal(commandFor(new Map([['latte', ''], ['iphone8', ''], ['iphone6', '']]), cat), 'WHATIF IPHONE6 IPHONE8 LATTE:5Y');
  assert.equal(fmtX(13.284), '13.3x');
});

test('one-liners: picked by outcome, same input same line, plain copy', () => {
  assert.ok(QUIPS.big.includes(quipFor(13, 'WHATIF IPHONE6')));
  assert.ok(QUIPS.gain.includes(quipFor(1.4, 'WHATIF LATTE:3Y')));
  assert.ok(QUIPS.loss.includes(quipFor(0.2, 'WHATIF PELOTON')));
  assert.equal(quipFor(3, 'WHATIF X'), quipFor(3, 'WHATIF X'));
  for (const line of Object.values(QUIPS).flat()) assert.doesNotMatch(line, /\u2014/);
});
