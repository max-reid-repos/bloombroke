import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand, parseFxArgs, toQuery, fromQuery, suggest, complete, marketStatus, nyClock, DEFAULT_COMMAND,
} from '../public/app.js';

test('empty input and empty URL mean MARKETS', () => {
  assert.equal(DEFAULT_COMMAND, 'MARKETS');
  assert.equal(parseCommand('').name, 'MARKETS');
  assert.equal(parseCommand('   ').name, 'MARKETS');
  assert.equal(fromQuery(''), 'MARKETS');
  assert.equal(fromQuery('?c='), 'MARKETS');
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
});

test('unknown input is UNKNOWN (tickers come later)', () => {
  assert.equal(parseCommand('AAPL').name, 'UNKNOWN');
  assert.equal(parseCommand('make me rich').name, 'UNKNOWN');
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
  assert.equal(suggest('').length, 3);
  assert.equal(suggest('zzz').length, 0);
  assert.equal(suggest('FX 500 ')[0].usage, true);
  assert.equal(suggest('FX 500 USD THB').length, 0);
});

test('Tab completes and cycles', () => {
  assert.equal(complete('ma'), 'MARKETS');
  assert.equal(complete('f'), 'FX ');
  assert.equal(complete('xyz'), 'xyz');
  const all = [0, 1, 2].map((i) => complete('', i));
  assert.equal(new Set(all).size, 3);
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
