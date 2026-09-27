// The resolver: names, plain words and ticker lists become commands. No network: the
// symbol search and the ticker check are fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput, splitWords, strongMatch, commandForWord, needsTicker, fuzzyCommands } from '../public/resolve.js';
import { tickerForName, SP100_NAMES, KNOWN_TICKERS } from '../public/known-tickers.js';
import { SP100 } from '../data/sp100.js';
import { findCommand, PHRASES } from '../public/registry.js';
import { parseCommand, screenTitle, fullName, tickerToCheck, didYouMeanHtml, resolvedNote, DEFAULT_TITLE, BOOT_LINES } from '../public/app.js';
import { resolveTopic } from '../public/screens/help.js';
import { consentKey } from '../public/consent.js';

// What the CNBC symbol lookup answered for these words (trimmed).
const SEARCH = {
  TESLA: [{ id: 'TSLA', name: 'Tesla Inc', kind: 'stock' }, { id: 'YTSLF', name: 'Tesla (TSLA) Yield Shares Purpose ETF', kind: 'etf' }, { id: 'TXLZF', name: 'Tesla Exploration Ltd', kind: 'stock' }],
  COCA: [{ id: 'KO', name: 'Coca-Cola Co', kind: 'stock' }, { id: 'CCEP', name: 'Coca-Cola Europacific Partners PLC', kind: 'stock' }, { id: 'COKE', name: 'Coca-Cola Consolidated Inc', kind: 'stock' }],
  ROKU: [{ id: 'ROKU', name: 'Roku Inc', kind: 'stock' }],
  'ROYAL BANK OF CANADA': [{ id: 'RY', name: 'Royal Bank of Canada', kind: 'stock' }],
  MICRO: [{ id: 'MSFT', name: 'Microsoft Corporation', kind: 'stock' }, { id: 'MU', name: 'Micron Technology Inc', kind: 'stock' }],
  XYZQ: [],
};
const REAL = new Set(['ROKU', 'XYZ']);
const calls = [];
const deps = {
  search: async (text) => { calls.push(text); return SEARCH[text.toUpperCase()] || []; },
  checkTicker: async (t) => REAL.has(t),
};
const run = (s) => resolveInput(s, deps);

test('resolver: company names run their ticker', async () => {
  assert.deepEqual(await run('nvidia'), { confident: true, from: 'nvidia', command: 'NVDA' });
  assert.equal((await run('tesla news')).command, 'TSLA NEWS');
  assert.equal((await run('TESLA NEWS')).command, 'TSLA NEWS');
  assert.equal((await run('apple financials')).command, 'AAPL FINANCIALS');
  assert.equal((await run('coca cola')).command, 'KO');
  assert.equal((await run("McDonald's")).command, 'MCD');
  assert.equal((await run('show me the price of tesla')).command, 'TSLA');
  assert.equal((await run('tesla 5y')).command, 'TSLA 5Y');
  assert.equal((await run('booking holdings')).command, 'BKNG', 'a company name beats a phrase inside it');
  assert.equal((await run('royal bank of canada')).command, 'RY', 'names outside the local list come from the search');
  assert.equal((await run('roku')).confident, false, 'ROKU is a ticker, so the router shows it without the resolver');
});

test('resolver: several tickers in a row compare', async () => {
  assert.equal((await run('AAPL MSFT NVDA')).command, 'COMPARE AAPL MSFT NVDA');
  assert.equal((await run('apple microsoft')).command, 'COMPARE AAPL MSFT');
  assert.equal((await run('roku vs tesla')).command, 'COMPARE ROKU TSLA');
  assert.equal((await run('AAPL MSFT NVDA 5Y')).command, 'COMPARE AAPL MSFT NVDA 5Y');
});

test('resolver: plain words find the command, for the ticker when one is given', async () => {
  const cases = {
    revenue: 'HELP FINANCIALS',
    'income statement': 'HELP FINANCIALS',
    'apple revenue': 'AAPL FINANCIALS',
    'apple income statement': 'AAPL FINANCIALS',
    'apple balance sheet': 'AAPL FINANCIALS BALANCE',
    'short interest': 'HELP SHORTS',
    'tesla short interest': 'TSLA SHORTS',
    insider: 'HELP INSIDERS',
    'nvda insider': 'NVDA INSIDERS',
    'yield curve': 'CURVE',
    dividend: 'HELP DIVIDENDS',
    'ko dividend': 'KO DIVIDENDS',
    'options chain': 'HELP OPTIONS',
    'aapl options chain': 'AAPL OPTIONS',
    'apple earnings': 'AAPL BEATS',
    'earnings calendar': 'EARNINGS',
  };
  for (const [words, want] of Object.entries(cases)) assert.equal((await run(words)).command, want, words);
});

test('resolver: unsure words get Did you mean rows, never a guess', async () => {
  const coca = await run('coca');
  assert.equal(coca.confident, false, 'three Coca-Cola companies: ask');
  assert.deepEqual(coca.symbols.map((s) => s.id), ['KO', 'CCEP', 'COKE']);
  const micro = await run('micro');
  assert.equal(micro.confident, false);
  assert.deepEqual(micro.symbols.map((s) => s.cmd), ['MSFT', 'MU']);
  const typo = await run('FINANCALS');
  assert.equal(typo.confident, false);
  assert.equal(typo.commands[0].name, 'FINANCIALS');
  const mixed = await run('apple rates');
  assert.equal(mixed.confident, false);
  assert.ok(mixed.commands.some((c) => c.name === 'RATES'));
  assert.equal(mixed.symbols[0].id, 'AAPL');
  const none = await run('xyzq');
  assert.deepEqual([none.confident, none.commands, none.symbols], [false, [], []]);
  const fnRows = await run('tesla blorp insiders');
  assert.equal(fnRows.confident, false);
  assert.equal(fnRows.symbols.find((s) => s.id === 'TSLA').cmd, 'TSLA INSIDERS', 'symbol rows carry the function typed');
});

test('resolver: strong match rules and word parts', () => {
  assert.equal(strongMatch('tesla', SEARCH.TESLA).id, 'TSLA', 'Tesla Inc is the name plus a suffix; OTC F and Y shares are ignored');
  assert.equal(strongMatch('coca', SEARCH.COCA), null);
  assert.equal(strongMatch('coca cola', SEARCH.COCA).id, 'KO');
  assert.equal(strongMatch('micro', SEARCH.MICRO), null);
  assert.equal(strongMatch('', SEARCH.TESLA), null);
  assert.deepEqual(splitWords('Apple\'s revenue?').map((p) => p.kind), ['name', 'phrase']);
  assert.deepEqual(splitWords('show me AAPL 5Y').map((p) => p.kind), ['filler', 'filler', 'other', 'range']);
  assert.equal(needsTicker(findCommand('SHORTS')), true);
  assert.equal(needsTicker(findCommand('NEWS')), false);
  assert.deepEqual(fuzzyCommands('MARKTES').map((c) => c.name), ['MARKETS']);
  for (const [name, list] of Object.entries(PHRASES)) assert.ok(findCommand(name), `PHRASES names a real command: ${name}`), assert.ok(list.length);
});

test('known tickers: the S&P 100 list matches data/sp100.js, names resolve offline', () => {
  assert.deepEqual(SP100_NAMES.map(([id]) => id).sort(), SP100.map((r) => r.ticker).sort());
  assert.equal(tickerForName('nvidia').id, 'NVDA');
  assert.equal(tickerForName('Coca-Cola').id, 'KO');
  assert.equal(tickerForName('google').id, 'GOOGL');
  assert.equal(tickerForName('ford').id, 'F');
  assert.equal(tickerForName('bike'), null);
  assert.ok(KNOWN_TICKERS.has('SPY') && KNOWN_TICKERS.has('AAPL') && !KNOWN_TICKERS.has('BIKE'));
});

test('router: an unchecked ticker screen is checked first; listed tickers and instruments are not', () => {
  assert.equal(tickerToCheck(parseCommand('TESLA')), 'TESLA');
  assert.equal(tickerToCheck(parseCommand('TESLA NEWS')), 'TESLA');
  assert.equal(tickerToCheck(parseCommand('FINANCIALS APPLE')), 'APPLE');
  assert.equal(tickerToCheck(parseCommand('AAPL')), null);
  assert.equal(tickerToCheck(parseCommand('GOLD')), null);
  assert.equal(tickerToCheck(parseCommand('MARKETS')), null);
  assert.equal(tickerToCheck(parseCommand('PF ADD ROKU 1 @ 50')), null, 'saved-list changes are never held');
  assert.equal(parseCommand('nvidia').name, 'UNKNOWN', 'the resolver, not the parser, handles names');
  assert.equal(parseCommand('AAPL MSFT NVDA').name, 'UNKNOWN');
});

test('router: Did you mean rows run on click and on keys 1 to 9', () => {
  const html = didYouMeanHtml('COCA', { commands: [{ cmd: 'HELP FINANCIALS', summary: 'Income' }], symbols: [{ cmd: 'KO', name: 'Coca-Cola Co' }] });
  assert.match(html, /Nothing called <span class="code">COCA<\/span>/);
  assert.match(html, /Did you mean/);
  assert.match(html, /data-cmd="HELP FINANCIALS" data-key="1">HELP FINANCIALS<\/a><span class="hc-sum">Income/);
  assert.match(html, /data-cmd="KO" data-key="2">KO<\/a><span class="hc-sum">Coca-Cola Co/);
  assert.match(didYouMeanHtml('XYZQ', {}, 'XYZQ'), /No ticker called <span class="code">XYZQ<\/span>/);
  assert.doesNotMatch(didYouMeanHtml('<b>', {}), /<b>/, 'escaped');
  assert.equal(resolvedNote('NVDA', 'NVIDIA'), "Showing NVDA (from 'nvidia')");
});

test('HELP <word>: keywords, plurals and typos open the command', () => {
  assert.equal(resolveTopic('SHORT').entry.name, 'SHORTS');
  assert.equal(resolveTopic('SHORT INTEREST').entry.name, 'SHORTS');
  assert.equal(resolveTopic('DIVIDEND').entry.name, 'DIVIDENDS');
  assert.equal(resolveTopic('INSIDER').entry.name, 'INSIDERS');
  assert.equal(resolveTopic('YIELD CURVE').entry.name, 'CURVE');
  assert.equal(resolveTopic('FINANCALS').entry.name, 'FINANCIALS');
  assert.equal(resolveTopic('SHORT').from, 'SHORT');
  assert.equal(resolveTopic('TSLA').ticker, 'TSLA', 'a listed ticker stays a ticker');
  assert.equal(resolveTopic('ROKU').ticker, 'ROKU', 'an unlisted ticker-shaped word with no command stays a ticker');
  assert.equal(resolveTopic('YIELD').query, 'yield', 'a word many commands share searches');
  assert.equal(commandForWord('nothing like it'), null);
});

test('titles: aliases show their full names', () => {
  assert.equal(screenTitle(parseCommand('PORTFOLIO')).title, 'PORTFOLIO');
  assert.equal(screenTitle(parseCommand('PF')).title, 'PORTFOLIO');
  assert.equal(screenTitle(parseCommand('WATCHLIST')).title, 'WATCH');
  assert.equal(screenTitle(parseCommand('M')).title, 'MARKETS');
  assert.equal(screenTitle(parseCommand('SCREENER')).title, 'SCREEN');
  assert.equal(screenTitle(parseCommand('INFLATION 100 2015')).title, 'CPI 100 2015');
  assert.equal(screenTitle(parseCommand('RATE')).title, 'RATES');
  assert.equal(screenTitle(parseCommand('? FX')).title, 'HELP FX');
  assert.equal(fullName('PF ADD AAPL 10 @ 150'), 'PORTFOLIO ADD AAPL 10 @ 150');
  assert.equal(screenTitle(parseCommand('AAPL')).title, 'AAPL', 'tickers stay as typed');
});

test('first minute: the site does not sound paid; typing during the notice is kept', () => {
  assert.equal(DEFAULT_TITLE, 'Bloombroke: a free market terminal. Pro $420 a year.');
  assert.ok(BOOT_LINES.some(([t]) => /free/.test(t)));
  assert.ok(!BOOT_LINES.some(([t]) => /32,000/.test(t)));
  let typed = '';
  for (const key of ['n', 'v', 'i', 'd', 'i', 'a']) typed = consentKey(typed, { key }).typed;
  assert.equal(typed, 'nvidia');
  assert.deepEqual(consentKey('nvidiax', { key: 'Backspace' }), { typed: 'nvidia', action: 'type' });
  assert.deepEqual(consentKey('nvidia', { key: 'Enter' }), { typed: 'nvidia', action: 'accept' });
  assert.deepEqual(consentKey('', { key: ' ' }), { typed: '', action: 'pass' }, 'space with nothing typed presses ACCEPT');
  assert.deepEqual(consentKey('tesla', { key: ' ' }), { typed: 'tesla ', action: 'type' });
  assert.equal(consentKey('a', { key: 'c', ctrlKey: true }).action, 'pass', 'shortcuts stay with the browser');
  assert.equal(consentKey('a', { key: 'Tab' }).action, 'pass');
});
