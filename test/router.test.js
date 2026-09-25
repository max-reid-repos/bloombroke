import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand, parseFxArgs, parseCpiArgs, toQuery, fromQuery, suggest, complete, marketStatus, nyClock, DEFAULT_COMMAND, COMMANDS,
} from '../public/app.js';

test('empty input and empty URL mean HOME', () => {
  assert.equal(DEFAULT_COMMAND, 'HOME');
  assert.equal(parseCommand('').name, 'HOME');
  assert.equal(parseCommand('   ').name, 'HOME');
  assert.equal(fromQuery(''), 'HOME');
  assert.equal(fromQuery('?c='), 'HOME');
});

test('commands are case-insensitive', () => {
  assert.equal(parseCommand('help').name, 'HELP');
  assert.equal(parseCommand('MaRkEtS').name, 'MARKETS');
  assert.equal(parseCommand('fx 500 usd thb').name, 'FX');
});

test('FX with amount, without amount, and with filler words', () => {
  assert.deepEqual(parseCommand('FX 500 USD THB').args, { amount: 500, amountGiven: true, from: 'USD', to: 'THB' });
  assert.deepEqual(parseCommand('fx usd thb').args, { amount: 1, amountGiven: false, from: 'USD', to: 'THB' });
  assert.deepEqual(parseFxArgs(['1,250.50', 'EUR', 'TO', 'GBP']), { amount: 1250.5, amountGiven: true, from: 'EUR', to: 'GBP' });
});

test('FX errors are reported, not thrown', () => {
  assert.equal(parseCommand('FX').error, 'usage');
  assert.equal(parseCommand('FX 500 USD').error, 'usage');
  assert.equal(parseCommand('FX 500 DOLLARS BAHT').error, 'code');
  assert.equal(parseCommand('FX 1.2.3 USD THB').error, 'amount');
  assert.equal(parseCommand('FX 2000000000000 USD THB').error, 'amount');
  assert.equal(parseCommand('FX 1e5 USD THB').error, 'usage');
});

test('tickers: one word of 1-5 letters, optional class and range', () => {
  assert.deepEqual(parseCommand('aapl').args, { ticker: 'AAPL', range: '1Y' });
  assert.equal(parseCommand('aapl').name, 'QUOTE');
  assert.deepEqual(parseCommand('BRK.B').args, { ticker: 'BRK.B', range: '1Y' });
  assert.deepEqual(parseCommand('tsla 5y').args, { ticker: 'TSLA', range: '5Y' });
  assert.equal(parseCommand('tsla 5y').input, 'TSLA 5Y');
  assert.equal(parseCommand('GOOGLE').name, 'UNKNOWN');
  assert.equal(parseCommand('AAPL 7Y').name, 'UNKNOWN');
  assert.equal(parseCommand('NEWS').name, 'NEWS');
  assert.equal(parseCommand('rates').name, 'RATES');
  assert.equal(parseCommand('BUY').error, 'usage');
  assert.equal(parseCommand('WHATIF').name, 'SOON');
});

test('CPI arguments', () => {
  assert.deepEqual(parseCpiArgs([]), { amount: 100, year: 2000 });
  assert.deepEqual(parseCpiArgs(['2015']), { amount: 100, year: 2015 });
  assert.deepEqual(parseCpiArgs(['$1,000', '1990']), { amount: 1000, year: 1990 });
  assert.deepEqual(parseCpiArgs(['50', 'IN', '1970']), { amount: 50, year: 1970 });
  assert.equal(parseCpiArgs(['abc']).error, 'usage');
  assert.equal(parseCpiArgs(['100', '15']).error, 'usage');
  assert.equal(parseCpiArgs(['1.2.3', '2015']).error, 'amount');
  assert.equal(parseCommand('cpi 100 2015').input, 'CPI 100 2015');
});

test('unknown input is UNKNOWN', () => {
  assert.equal(parseCommand('make me rich').name, 'UNKNOWN');
  assert.equal(parseCommand('12345').name, 'UNKNOWN');
});

test('URL state round-trips', () => {
  assert.equal(toQuery('fx 500 usd thb'), '?c=FX+500+USD+THB');
  assert.equal(fromQuery('?c=FX+500+USD+THB'), 'FX 500 USD THB');
  assert.equal(fromQuery('?c=fx%20%20500%20usd%20thb'), 'FX 500 USD THB');
  assert.equal(fromQuery(toQuery('HELP')), 'HELP');
});

test('suggestions match command prefixes', () => {
  assert.deepEqual(suggest('m').map((s) => s.name), ['MARKETS']);
  assert.deepEqual(suggest('F').map((s) => s.name), ['FX']);
  assert.deepEqual(suggest('H').map((s) => s.name), ['HOME', 'HELP']);
  assert.deepEqual(suggest('c').map((s) => s.name), ['CPI']);
  assert.equal(suggest('').length, COMMANDS.length);
  assert.equal(suggest('zzz').length, 0);
  assert.equal(suggest('FX 500 ')[0].usage, true);
  assert.equal(suggest('FX 500 USD THB').length, 0);
});

test('Tab completes and cycles', () => {
  assert.equal(complete('ma'), 'MARKETS');
  assert.equal(complete('f'), 'FX ');
  assert.equal(complete('xyz'), 'xyz');
  assert.equal(complete('cp'), 'CPI ');
  const all = COMMANDS.map((_, i) => complete('', i));
  assert.equal(new Set(all).size, COMMANDS.length);
});

test('NYSE hours: 9:30 to 16:00 ET, weekdays only', () => {
  // Friday 25 Sep 2026, New York is UTC-4
  assert.equal(marketStatus(new Date('2026-09-25T13:29:00Z')), 'CLOSED'); // 9:29
  assert.equal(marketStatus(new Date('2026-09-25T13:30:00Z')), 'OPEN'); // 9:30
  assert.equal(marketStatus(new Date('2026-09-25T19:59:59Z')), 'OPEN'); // 15:59
  assert.equal(marketStatus(new Date('2026-09-25T20:00:00Z')), 'CLOSED'); // 16:00
  assert.equal(marketStatus(new Date('2026-09-26T15:00:00Z')), 'CLOSED'); // Saturday
  // Winter time, UTC-5: Monday 12 Jan 2026 10:00 ET
  assert.equal(marketStatus(new Date('2026-01-12T15:00:00Z')), 'OPEN');
  assert.equal(nyClock(new Date('2026-09-25T04:05:06Z')), '00:05:06');
});

test('NYSE holidays and early closes, 2026 and 2027', () => {
  // Thanksgiving, Thursday 26 Nov 2026, 11:00 ET (UTC-5)
  assert.equal(marketStatus(new Date('2026-11-26T16:00:00Z')), 'CLOSED');
  // Day after Thanksgiving closes at 13:00
  assert.equal(marketStatus(new Date('2026-11-27T17:59:00Z')), 'OPEN'); // 12:59
  assert.equal(marketStatus(new Date('2026-11-27T18:00:00Z')), 'CLOSED'); // 13:00
  // Independence Day observed on Friday 3 Jul 2026
  assert.equal(marketStatus(new Date('2026-07-03T15:00:00Z')), 'CLOSED');
  // Good Friday 2027 is 26 Mar
  assert.equal(marketStatus(new Date('2027-03-26T15:00:00Z')), 'CLOSED');
  // Christmas 2027 observed on Friday 24 Dec
  assert.equal(marketStatus(new Date('2027-12-24T16:00:00Z')), 'CLOSED');
  // Christmas Eve 2026 closes early
  assert.equal(marketStatus(new Date('2026-12-24T17:00:00Z')), 'OPEN'); // 12:00
  assert.equal(marketStatus(new Date('2026-12-24T18:30:00Z')), 'CLOSED'); // 13:30
  // An ordinary Monday
  assert.equal(marketStatus(new Date('2027-03-29T15:00:00Z')), 'OPEN');
});
