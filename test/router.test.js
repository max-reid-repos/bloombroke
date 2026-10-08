import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand, parseFxArgs, parseCpiArgs, toQuery, fromQuery, suggest, complete, completeFrom, linkPlan, urlFor, marketStatus, nyClock, DEFAULT_COMMAND, COMMANDS,
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
  assert.equal(parseCommand('AFFORD').error, 'usage');
  assert.equal(parseCommand('BUY').name, 'RENAMED');
  assert.equal(parseCommand('WHATIF').name, 'WHATIF');
  assert.deepEqual(parseCommand('whatif iphone6 latte:3y').args, { tokens: ['IPHONE6', 'LATTE:3Y'] });
  assert.equal(parseCommand('420').name, 'FUNDING');
  assert.equal(parseCommand('420 X').name, 'UNKNOWN');
  assert.equal(suggest('4').length, 0, '420 stays hidden');
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
  assert.deepEqual(suggest('ma').map((s) => s.name), ['MARKETS', 'MACAU']);
  assert.deepEqual(suggest('m').map((s) => s.name), ['MARKETS', 'MOVERS', 'ME', 'MACAU', 'MCP', 'MENU']);
  assert.deepEqual(suggest('F').map((s) => s.name), ['FINANCIALS', 'FILINGS', 'FEDPATH', 'FX', 'FXMATRIX', 'FOUNDERS', 'FEEDBACK', 'FISHTANK']);
  assert.deepEqual(suggest('H').map((s) => s.name), ['HOME', 'HEATMAP', 'HISTORY', 'HOLIDAYS', 'HIRING', 'HOTDOG', 'HELP']);
  assert.deepEqual(suggest('cp').map((s) => s.name), ['CPI']);
  assert.equal(suggest('').length, COMMANDS.length);
  assert.equal(suggest('zzz').length, 0);
  assert.equal(suggest('FX 500 ')[0].usage, true);
  assert.equal(suggest('FX 500 USD THB').length, 0);
});

test('Tab completes and cycles', () => {
  assert.equal(complete('ma'), 'MARKETS');
  assert.equal(complete('f'), 'FINANCIALS ');
  assert.equal(complete('fx'), 'FX ');
  assert.equal(complete('xyz'), 'xyz');
  assert.equal(complete('cp'), 'CPI ');
  const all = COMMANDS.map((_, i) => complete('', i));
  assert.equal(new Set(all).size, COMMANDS.length);
});

test('Tab completes to the top of the list on screen, and cycles through it', () => {
  // The list the dropdown shows for AAP: the server's symbols, AAP first.
  const shown = [{ name: 'AAP', value: 'AAP', symbol: true }, { name: 'AAPL', value: 'AAPL', symbol: true }, { name: 'AAPB', value: 'AAPB', symbol: true }];
  assert.equal(completeFrom(shown, 'AAP', 0), 'AAPL', 'what is typed already is skipped');
  assert.equal(completeFrom(shown, 'aap', 1), 'AAPB');
  assert.equal(completeFrom(shown, 'AAP', 2), 'AAPL', 'and round again');
  assert.equal(completeFrom(shown, 'AAP', -1), 'AAPB', 'Shift+Tab from the start: the last');
  // APPL: nothing local, but the server's search puts AAPL on top.
  assert.equal(complete('APPL'), 'APPL');
  assert.equal(completeFrom([{ name: 'AAPL', value: 'AAPL' }, { name: 'APP', value: 'APP' }], 'APPL', 0), 'AAPL');
  assert.equal(completeFrom([], 'XYZ', 0), 'XYZ');
  assert.equal(completeFrom(suggest('fx'), 'fx', 0), 'FX ', 'FX with a space is not what was typed');
});

test('a link that would change something saved never runs by itself: it asks in one line', () => {
  assert.deepEqual(linkPlan('ALERTS AAPL > 350'), { url: 'ALERTS', show: 'ALERTS', ask: { run: 'ALERTS AAPL > 350', url: 'ALERTS', question: 'Add alert AAPL > 350?', verb: 'ADD' } });
  assert.deepEqual(linkPlan('WATCH ADD TSLA NVDA').ask, { run: 'WATCH ADD TSLA NVDA', url: 'WATCH', question: 'Add TSLA, NVDA to your watchlist?', verb: 'ADD' });
  assert.equal(linkPlan('WATCH REMOVE AAPL').ask.question, 'Remove AAPL from your watchlist?');
  assert.equal(linkPlan('ALERTS CLEAR').ask.verb, 'CLEAR');
  assert.equal(linkPlan('DESK RESET').ask.run, 'DESK RESET');
  assert.equal(linkPlan('PF BUY AAPL 10 @ 200').show, 'PF');
  assert.match(linkPlan('PF BUY AAPL 10 @ 200').ask.question, /changes your portfolio/);
  assert.match(linkPlan('TAPE ADD AAPL').ask.question, /changes your ticker tape/);
  // Nothing to ask: plain screens, LOGIN and LOGOUT (PRO only), and bad words.
  for (const c of ['AAPL', 'ALERTS', 'WATCH', 'HOME', 'LOGOUT', 'LOGIN BB-7KQ2-M9XD-HT4P-WZ3C', 'ALERTS ZZZZZZZ > 5']) assert.equal(linkPlan(c).ask, null, c);
  assert.equal(linkPlan('LOGIN BB-7KQ2-M9XD-HT4P-WZ3C').show, 'PRO', 'a key in a link never runs');
  // A DESK preset loads like typed (DESK itself asks over panels of your own); the
  // address bar keeps just DESK.
  for (const p of ['WEIRD', 'MACRO', 'CRYPTO']) assert.deepEqual(linkPlan(`DESK ${p}`), { url: 'DESK', show: `DESK ${p}`, ask: null });
  assert.deepEqual(linkPlan('DESK 2 CRYPTO'), { url: 'DESK 2', show: 'DESK 2 CRYPTO', ask: null });
});

test('aliases never slip past the link confirm, and the URL keeps only the plain screen', () => {
  assert.equal(urlFor('ALERT AAPL > 350').url, 'ALERTS', 'ALERT is ALERTS: the words never reach the URL');
  assert.equal(urlFor('ALERT CLEAR').url, 'ALERTS');
  assert.deepEqual(linkPlan('ALERT AAPL > 350'), { url: 'ALERTS', show: 'ALERTS', ask: { run: 'ALERT AAPL > 350', url: 'ALERTS', question: 'Add alert AAPL > 350?', verb: 'ADD' } });
  assert.equal(linkPlan('ALERT CLEAR').ask.verb, 'CLEAR');
  assert.equal(linkPlan('WATCHLIST ADD TSLA').ask.question, 'Add TSLA to your watchlist?');
  assert.equal(linkPlan('WATCHLIST ADD TSLA').url, 'WATCH');
  assert.equal(linkPlan('PORTFOLIO BUY AAPL 10 @ 200').url, 'PF');
  assert.equal(linkPlan('W ADD TSLA').url, 'WATCH');
  // WAGE saves a number in this browser: a link asks; WAGE alone only shows it.
  assert.deepEqual(linkPlan('WAGE 35'), { url: 'WAGE', show: 'WAGE', ask: { run: 'WAGE 35', url: 'WAGE', question: 'Save your wage as $35 an hour?', verb: 'SAVE' } });
  assert.equal(linkPlan('WAGE OFF').ask.verb, 'FORGET');
  assert.equal(linkPlan('WAGE').ask, null);
  // TAPE ON, OFF and CLEAR change the tape; TAPE alone shows it.
  for (const c of ['TAPE ON', 'TAPE OFF', 'TAPE CLEAR']) assert.equal(linkPlan(c).url, 'TAPE', c), assert.ok(linkPlan(c).ask, c);
  assert.equal(linkPlan('TAPE').ask, null);
  // Every question carries the plain screen the address bar goes back to.
  for (const c of ['ALERTS AAPL > 350', 'WATCH ADD TSLA', 'DESK RESET', 'DESK 3 RESET']) assert.equal(linkPlan(c).ask.url, linkPlan(c).url, c);
  assert.equal(linkPlan('DESK 3 RESET').url, 'DESK 3');
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
