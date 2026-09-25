import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseAffordArgs, parseBuyArgs, parseWageArgs, isInvestmentWord, suggest, complete, COMMANDS, RENAMED_NOTE } from '../public/app.js';
import { buyMaths, verdictFor, fmtMoney, howOften, buyHtml, NOT_INVESTMENTS, TITLE, VERDICTS, render as renderBuy } from '../public/screens/buy.js';

test('AFFORD parses price, frequency and years with defaults', () => {
  assert.deepEqual(parseAffordArgs(['1200']), { price: 1200, times: 1, unit: 'WEEK', years: 3 });
  assert.deepEqual(parseAffordArgs(['1200', '2', 'PER', 'WEEK', 'FOR', '3Y']), { price: 1200, times: 2, unit: 'WEEK', years: 3 });
  assert.deepEqual(parseAffordArgs(['$4.50', '1', 'PER', 'DAY', 'FOR', '1', 'YEAR']), { price: 4.5, times: 1, unit: 'DAY', years: 1 });
  assert.deepEqual(parseAffordArgs(['30000', 'FOR', '8Y']), { price: 30000, times: 1, unit: 'WEEK', years: 8 });
  assert.deepEqual(parseAffordArgs(['90', 'DAILY', 'FOR', '18M']), { price: 90, times: 1, unit: 'DAY', years: 1.5 });
  assert.deepEqual(parseAffordArgs(['50', '3', 'PER', 'MONTHS']), { price: 50, times: 3, unit: 'MONTH', years: 3 });
  assert.deepEqual(parseAffordArgs(['50', 'USD', 'FOR', '2', 'YEARS']), { price: 50, times: 1, unit: 'WEEK', years: 2 });
  assert.equal(parseBuyArgs, parseAffordArgs, 'old name still works for imports');
  assert.equal(parseCommand('afford 1200 2 per week for 3y').name, 'AFFORD');
  assert.equal(parseCommand('afford 1200 2 per week for 3y').input, 'AFFORD 1200 2 PER WEEK FOR 3Y');
});

test('AFFORD refuses tickers, markets and investment words', () => {
  for (const words of [['AAPL'], ['100', 'SHARES'], ['1200', 'AAPL'], ['100', 'SHARES', 'OF', 'TSLA'], ['GOLD'], ['BITCOIN'], ['500', 'BTC'],
    ['1000', 'ETF'], ['$AAPL'], ['100', 'STOCK'], ['250', 'EURUSD'], ['1000', 'FUNDS'], ['50', 'OPTIONS'], ['100', 'NOW']]) {
    assert.equal(parseAffordArgs(words).error, 'investment', words.join(' '));
  }
  assert.equal(parseCommand('AFFORD AAPL').error, 'investment');
  assert.equal(parseCommand('AFFORD 100 SHARES').error, 'investment');
  assert.equal(NOT_INVESTMENTS, 'AFFORD is for things you buy, like a bike or a laptop. It does not assess investments.');
  for (const ok of ['1200', '$4.50', 'PER', 'WEEK', 'DAILY', 'FOR', '3Y', '18M', 'YEARS', 'A', 'USD']) assert.equal(isInvestmentWord(ok), false, ok);
});

test('AFFORD errors are reported, not thrown', () => {
  assert.equal(parseAffordArgs([]).error, 'usage');
  assert.equal(parseAffordArgs(['0']).error, 'amount');
  assert.equal(parseAffordArgs(['1.2.3']).error, 'amount');
  assert.equal(parseAffordArgs(['100', '2', 'PER', 'FORTNIGHT']).error, 'usage');
  assert.equal(parseAffordArgs(['100', 'FOR', '0Y']).error, 'years');
  assert.equal(parseAffordArgs(['100', 'FOR', '500Y']).error, 'years');
  assert.equal(parseAffordArgs(['100', '5000', 'PER', 'DAY']).error, 'times');
  assert.equal(suggest('AFFORD ')[0].usage, true);
  assert.equal(complete('af'), 'AFFORD ');
});

test('BUY is renamed: typed it explains, old links go to AFFORD', () => {
  assert.ok(!COMMANDS.some((c) => c.name === 'BUY'), 'BUY is not in HELP or suggestions');
  const aff = COMMANDS.find((c) => c.name === 'AFFORD');
  assert.ok(aff && aff.examples.every((e) => e.startsWith('AFFORD')));
  assert.ok(!suggest('BU').some((s) => s.name === 'BUY'));
  const typed = parseCommand('buy');
  assert.equal(typed.name, 'RENAMED');
  assert.equal(typed.args.to, 'AFFORD');
  const link = parseCommand('BUY 1200 2 PER WEEK FOR 3Y');
  assert.equal(link.name, 'RENAMED');
  assert.equal(link.args.to, 'AFFORD 1200 2 PER WEEK FOR 3Y');
  assert.equal(parseCommand(link.args.to).name, 'AFFORD');
  assert.equal(RENAMED_NOTE, 'Renamed to AFFORD. It is about things you buy, not investments.');
});

test('AFFORD maths: cost per use, hours, compounding, verdicts', () => {
  const r = buyMaths({ price: 1200, times: 2, unit: 'WEEK', years: 3 }, { wage: 35 });
  assert.equal(r.uses, 312);
  assert.equal(r.costPerUse, 1200 / 312);
  assert.equal(r.hours, 1200 / 35);
  assert.ok(Math.abs(r.invested - 1200 * 1.08 ** 3) < 1e-9);
  assert.equal(r.verdict, 'SLEEP ON IT');
  assert.equal(buyMaths({ price: 1200, times: 1, unit: 'DAY', years: 3 }).verdict, 'WORTH IT');
  assert.equal(buyMaths({ price: 30000, times: 1, unit: 'WEEK', years: 8 }).verdict, 'SKIP IT');
  assert.equal(buyMaths({ price: 100, times: 1, unit: 'YEAR', years: 0.5 }).uses, 1, 'at least one use');
  assert.equal(buyMaths({ price: 100, times: 1, unit: 'WEEK', years: 1 }).hours, null);
  assert.equal(verdictFor(1.99).verdict, 'WORTH IT');
  assert.equal(verdictFor(2).verdict, 'SLEEP ON IT');
  assert.equal(verdictFor(9.99).verdict, 'SLEEP ON IT');
  assert.equal(verdictFor(10).verdict, 'SKIP IT');
  assert.deepEqual(VERDICTS.map((v) => v.verdict), ['WORTH IT', 'SLEEP ON IT', 'SKIP IT']);
  assert.equal(TITLE, 'Can I afford it?');
});

test('AFFORD formats and HTML', () => {
  assert.equal(fmtMoney(7.6923), '$7.69');
  assert.equal(fmtMoney(1511.65), '$1,512');
  assert.equal(fmtMoney(0.0312), '$0.0312');
  assert.equal(howOften(2, 'WEEK'), 'twice a week');
  assert.equal(howOften(1, 'DAY'), 'once a day');
  const html = buyHtml(buyMaths({ price: 1200, times: 1, unit: 'WEEK', years: 3 }));
  assert.match(html, /stamp-sleep/);
  assert.match(html, /SLEEP ON IT/);
  assert.match(html, /class="add-form wage-form"[\s\S]*placeholder="Hourly pay"/);
  assert.match(html, /How is this calculated\?/);
  assert.doesNotMatch(html, /\bBUY\b/);
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

test('AFFORD reads plain phrasings and keeps the first item word as a label', () => {
  const p = (s) => parseAffordArgs(s.split(' '));
  assert.deepEqual(p('1200 BIKE 2 PER WEEK'), { price: 1200, times: 2, unit: 'WEEK', years: 3, label: 'Bike' });
  assert.deepEqual(p('$1,200 TWICE A WEEK'), { price: 1200, times: 2, unit: 'WEEK', years: 3 });
  assert.deepEqual(p('1200 2X WEEK'), { price: 1200, times: 2, unit: 'WEEK', years: 3 });
  assert.deepEqual(p('1200 2X/WEEK'), { price: 1200, times: 2, unit: 'WEEK', years: 3 });
  assert.deepEqual(p('1200 3 TIMES A MONTH FOR 2 YEARS'), { price: 1200, times: 3, unit: 'MONTH', years: 2 });
  assert.deepEqual(p('1200 ONCE A MONTH OVER 18 MONTHS'), { price: 1200, times: 1, unit: 'MONTH', years: 1.5 });
  assert.deepEqual(p('1200 2 TIMES WEEKLY'), { price: 1200, times: 2, unit: 'WEEK', years: 3 });
  assert.deepEqual(p('1200 EVERY DAY FOR 2Y'), { price: 1200, times: 1, unit: 'DAY', years: 2 });
  assert.deepEqual(p('1200 2 YEARS'), { price: 1200, times: 1, unit: 'WEEK', years: 2 });
  assert.equal(p('5 COFFEE 1 PER DAY').label, 'Coffee', 'an everyday market word is a thing, not a future');
  assert.equal(p('3000 VIETNAM TRIP').label, 'Vietnam');
  assert.equal(p('BIKE 1200 2 PER WEEK').label, 'Bike');
  assert.equal(parseCommand('AFFORD 1200 BIKE 2 PER WEEK').error, undefined);
  assert.equal(parseCommand('AFFORD 1200 BIKE 2 PER WEEK').args.label, 'Bike');
  for (const ok of ['BIKE', 'LAPTOP', 'SOFA', 'COFFEE', 'TURKEY', 'GAS', '2X']) assert.equal(isInvestmentWord(ok), false, ok);
  for (const bad of ['AAPL', '$BIKE', 'SPY', 'GOLD', 'BITCOIN', 'SHARES']) assert.equal(isInvestmentWord(bad), true, bad);
});

test('AFFORD errors say what works, and only mention investments for investments', () => {
  assert.equal(parseAffordArgs(['1200', '2']).error, 'usage');
  assert.equal(parseAffordArgs(['BIKE']).error, 'usage');
  assert.equal(parseAffordArgs(['1200', 'FOR']).error, 'usage');
  const el = { innerHTML: '', querySelector: () => null };
  const ctx = { status: () => {}, store: { get: () => null }, copy: async () => true };
  renderBuy(el, parseCommand('AFFORD 1200 2'), ctx);
  assert.match(el.innerHTML, /Try: <a class="code"[^>]*>AFFORD 1200 2 PER WEEK FOR 3Y<\/a>/);
  assert.doesNotMatch(el.innerHTML, /investment/i);
  renderBuy(el, parseCommand('AFFORD 1200 BIKE'), ctx);
  assert.match(el.innerHTML, /Bike: <span class="num">\$1,200<\/span>/);
  renderBuy(el, parseCommand('AFFORD 1200 AAPL'), ctx);
  assert.match(el.innerHTML, /does not assess investments/);
});
