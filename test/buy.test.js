import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseBuyArgs, parseWageArgs, suggest, complete } from '../public/app.js';
import { buyMaths, verdictFor, fmtMoney, howOften, buyHtml } from '../public/screens/buy.js';

test('BUY parses price, frequency and years with defaults', () => {
  assert.deepEqual(parseBuyArgs(['1200']), { price: 1200, times: 1, unit: 'WEEK', years: 3 });
  assert.deepEqual(parseBuyArgs(['1200', '2', 'PER', 'WEEK', 'FOR', '3Y']), { price: 1200, times: 2, unit: 'WEEK', years: 3 });
  assert.deepEqual(parseBuyArgs(['$4.50', '1', 'PER', 'DAY', 'FOR', '1', 'YEAR']), { price: 4.5, times: 1, unit: 'DAY', years: 1 });
  assert.deepEqual(parseBuyArgs(['30000', 'FOR', '8Y']), { price: 30000, times: 1, unit: 'WEEK', years: 8 });
  assert.deepEqual(parseBuyArgs(['90', 'DAILY', 'FOR', '18M']), { price: 90, times: 1, unit: 'DAY', years: 1.5 });
  assert.deepEqual(parseBuyArgs(['50', '3', 'PER', 'MONTHS']), { price: 50, times: 3, unit: 'MONTH', years: 3 });
  assert.equal(parseCommand('buy 1200 2 per week for 3y').name, 'BUY');
  assert.equal(parseCommand('buy 1200 2 per week for 3y').input, 'BUY 1200 2 PER WEEK FOR 3Y');
});

test('BUY errors are reported, not thrown', () => {
  assert.equal(parseBuyArgs([]).error, 'usage');
  assert.equal(parseBuyArgs(['CHEAP']).error, 'usage');
  assert.equal(parseBuyArgs(['0']).error, 'amount');
  assert.equal(parseBuyArgs(['1.2.3']).error, 'amount');
  assert.equal(parseBuyArgs(['100', '2', 'PER', 'FORTNIGHT']).error, 'usage');
  assert.equal(parseBuyArgs(['100', 'FOR', '0Y']).error, 'years');
  assert.equal(parseBuyArgs(['100', 'FOR', '500Y']).error, 'years');
  assert.equal(parseBuyArgs(['100', '5000', 'PER', 'DAY']).error, 'times');
  assert.equal(parseBuyArgs(['100', 'NOW']).error, 'usage');
  assert.equal(suggest('BUY ')[0].usage, true);
  assert.equal(complete('bu'), 'BUY ');
});

test('BUY maths: cost per use, hours, compounding, verdicts', () => {
  const r = buyMaths({ price: 1200, times: 2, unit: 'WEEK', years: 3 }, { wage: 35 });
  assert.equal(r.uses, 312);
  assert.equal(r.costPerUse, 1200 / 312);
  assert.equal(r.hours, 1200 / 35);
  assert.ok(Math.abs(r.invested - 1200 * 1.08 ** 3) < 1e-9);
  assert.equal(r.verdict, 'THINK');
  assert.equal(buyMaths({ price: 1200, times: 1, unit: 'DAY', years: 3 }).verdict, 'BUY');
  assert.equal(buyMaths({ price: 30000, times: 1, unit: 'WEEK', years: 8 }).verdict, 'SKIP');
  assert.equal(buyMaths({ price: 100, times: 1, unit: 'YEAR', years: 0.5 }).uses, 1, 'at least one use');
  assert.equal(buyMaths({ price: 100, times: 1, unit: 'WEEK', years: 1 }).hours, null);
  assert.equal(verdictFor(1.99).verdict, 'BUY');
  assert.equal(verdictFor(2).verdict, 'THINK');
  assert.equal(verdictFor(9.99).verdict, 'THINK');
  assert.equal(verdictFor(10).verdict, 'SKIP');
});

test('BUY formats and HTML', () => {
  assert.equal(fmtMoney(7.6923), '$7.69');
  assert.equal(fmtMoney(1511.65), '$1,512');
  assert.equal(fmtMoney(0.0312), '$0.0312');
  assert.equal(howOften(2, 'WEEK'), 'twice a week');
  assert.equal(howOften(1, 'DAY'), 'once a day');
  const html = buyHtml(buyMaths({ price: 1200, times: 1, unit: 'WEEK', years: 3 }));
  assert.match(html, /stamp-think/);
  assert.match(html, /WAGE 35/);
  assert.match(html, /How is this calculated\?/);
  assert.doesNotMatch(html, /style=/);
  assert.doesNotMatch(html, /\u2014/, 'no em dashes');
});

test('WAGE parses, shows and clears', () => {
  assert.deepEqual(parseWageArgs(['35']), { wage: 35 });
  assert.deepEqual(parseWageArgs(['$22.50', 'PER', 'HOUR']), { wage: 22.5 });
  assert.equal(parseWageArgs([]).show, true);
  assert.equal(parseWageArgs(['OFF']).clear, true);
  assert.equal(parseWageArgs(['LOTS']).error, 'usage');
  assert.equal(parseCommand('wage 35').name, 'WAGE');
});
