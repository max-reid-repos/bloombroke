// A leading $ always means the stock: $GOLD is Gold.com, $M is Macy's. Plain words keep
// opening what they open today (GOLD is spot gold, M is MARKETS), with a "Stock: $GOLD"
// hint when the word is also a listed stock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand, stockId, stockHintFor, tickerToCheck, tickerFunctions, toQuery, fromQuery, urlFor,
  suggest, stockRows, symbolSuggestions, completeFrom, didYouMeanHtml,
} from '../public/app.js';
import { resolveInput } from '../public/resolve.js';
import { SHADOWED_TICKERS } from '../public/known-tickers.js';
import { normalizeTicker, tickerSource, companyTicker, makeQuotes } from '../data/quotes.js';
import { parseLookup } from '../data/search.js';
import { quoteTicker } from '../lib/og.js';
import { startHere } from '../public/screens/help.js';
import { createCache } from '../data/cache.js';

// What each plain word opened before $ existed: [command, ticker].
const TODAY = {
  M: ['MARKETS', null], H: ['HELP', null], DOW: ['QUOTE', 'DJI'], GOLD: ['QUOTE', 'GOLD'], WTI: ['QUOTE', 'WTI'],
  BTC: ['QUOTE', 'BTC'], ETH: ['QUOTE', 'ETH'], CORN: ['QUOTE', 'CORN'], DAX: ['QUOTE', 'DAX'], ASX: ['QUOTE', 'ASX200'],
  USDX: ['QUOTE', 'DXY'], XPT: ['QUOTE', 'PLATINUM'], TRON: ['QUOTE', 'TRXUSD'], HELP: ['HELP', null], DESK: ['DESK', null],
  CHAT: ['CHAT', null], IPOS: ['IPOS', null], LOAN: ['LOAN', null], GIFT: ['GIFT', null],
};
const COLLISIONS = Object.keys(TODAY);

test('$: every shadowed ticker opens the stock with $, and today\'s screen without', () => {
  assert.deepEqual([...SHADOWED_TICKERS].sort(), [...COLLISIONS].sort());
  for (const t of COLLISIONS) {
    const plain = parseCommand(t);
    assert.deepEqual([plain.name, plain.args?.ticker ?? null], TODAY[t], `${t} as today`);
    for (const typed of [`$${t}`, `$${t.toLowerCase()}`, ` $${t} `]) {
      const c = parseCommand(typed);
      assert.equal(c.name, 'QUOTE', typed);
      assert.equal(c.args.ticker, `$${t}`, typed);
      assert.equal(c.input, `$${t}`);
    }
    assert.equal(stockId(t), `$${t}`);
    assert.equal(tickerToCheck(parseCommand(`$${t}`)), `$${t}`, 'a $ stock is checked for a quote first');
    assert.equal(stockHintFor(t, plain), `$${t}`, `${t} shows the hint`);
    assert.equal(stockHintFor(`$${t}`, parseCommand(`$${t}`)), null, 'no hint on the stock itself');
    // The server asks the source for the plain symbol, never the instrument.
    assert.equal(normalizeTicker(`$${t}`), `$${t}`);
    assert.equal(tickerSource(`$${t}`), t);
    assert.equal(companyTicker(`$${t}`), t);
  }
  assert.equal(stockHintFor('GOLD 5Y', parseCommand('GOLD 5Y')), '$GOLD 5Y');
  assert.equal(stockHintFor('HELP SHORTS', parseCommand('HELP SHORTS')), null, 'the hint is for the word alone');
  assert.equal(stockHintFor('AAPL', parseCommand('AAPL')), null);
  assert.equal(stockHintFor('MARKETS', parseCommand('MARKETS')), null);
});

test('$: periods and functions after the stock; no $ needed where nothing clashes', () => {
  assert.deepEqual(parseCommand('$GOLD 5Y').args, { ticker: '$GOLD', range: '5Y' });
  assert.equal(parseCommand('$GOLD 5Y').input, '$GOLD 5Y');
  assert.equal(parseCommand('CHART $GOLD 5Y').args.ticker, '$GOLD');
  const fin = parseCommand('$CHAT FINANCIALS');
  assert.deepEqual([fin.name, fin.args.ticker], ['FINANCIALS', '$CHAT']);
  for (const fn of ['NEWS', 'PROFILE', 'HISTORY', 'DIVIDENDS', 'OPTIONS', 'INSIDERS', 'OWNERS', 'FILINGS', 'SHORTS', 'BEATS', 'VALUE', 'WHY']) {
    const c = parseCommand(`$DOW ${fn}`);
    assert.notEqual(c.name, 'SOON', fn);
    assert.equal(c.args.ticker, '$DOW', fn);
  }
  assert.ok(tickerFunctions('$GOLD').every((f) => f.ready), 'the whole function bar works for $GOLD');
  assert.equal(parseCommand('$brk.b').args.ticker, 'BRK.B', '$ on a plain ticker is just the ticker');
  assert.equal(parseCommand('$AAPL 5Y').input, 'AAPL 5Y');
  assert.equal(parseCommand('$1200').name, 'UNKNOWN', 'a dollar amount is not a stock');
  assert.equal(parseCommand('AFFORD $1200 BIKE').name, 'AFFORD');
});

test('$: the URL keeps $M, and ?c=%24M works too', () => {
  assert.equal(toQuery('$M'), '?c=$M');
  assert.equal(toQuery('$gold 5y'), '?c=$GOLD+5Y');
  assert.equal(fromQuery('?c=$M'), '$M');
  assert.equal(fromQuery('?c=%24M'), '$M');
  assert.equal(urlFor('$M').url, '$M');
  for (const t of ['$M', '$GOLD 5Y', '$CHAT FINANCIALS', '$HELP']) {
    const back = parseCommand(fromQuery(toQuery(t)));
    assert.deepEqual(back, parseCommand(t), t);
  }
  // Share links: the card is the stock's.
  assert.equal(quoteTicker('$M', parseCommand), '$M');
  assert.equal(quoteTicker('$GOLD 5Y', parseCommand), '$GOLD');
  assert.equal(quoteTicker('GOLD', parseCommand), 'GOLD');
});

test('$: unknown $XXXXX is checked, then gets the NO SUCH TICKER screen', async () => {
  const c = parseCommand('$XXXXX');
  const ticker = tickerToCheck(c);
  assert.equal(ticker, 'XXXXX');
  const deps = { search: async () => [], checkTicker: async () => false, stockId };
  const r = await resolveInput('$XXXXX', deps);
  assert.equal(r.confident, false);
  assert.deepEqual(r.commands, [], 'no command suggestions for a $ word');
  assert.match(didYouMeanHtml('$XXXXX', r, ticker), /No ticker called <span class="code">XXXXX<\/span>/);
  // $ never falls back to a name or an instrument: $APPLE is no Apple, $GOLDX no gold.
  const apple = await resolveInput('$APPLE', deps);
  assert.equal(apple.confident, false);
  assert.ok(!apple.symbols.some((s) => s.id === 'AAPL'));
});

test('$: the resolver and did-you-mean speak $', async () => {
  // The quote check had a gap; the symbol list has the stock GOLD.
  const deps = { search: async () => parseLookup([{}, { symbolName: 'GOLD', countryCode: 'US', issueType: 'STOCK', companyName: 'Gold.com Inc' }]), checkTicker: async () => false, stockId };
  assert.deepEqual(await resolveInput('$gold', deps), { confident: true, from: '$gold', command: '$GOLD' });
  // A plain name finds the stock under the id that opens it: Macy's is $M, not MARKETS.
  const macys = { search: async () => stockRows([{ id: 'M', name: "Macy's Inc", kind: 'stock' }]), checkTicker: async () => false, stockId };
  assert.deepEqual(await resolveInput('macys', macys), { confident: true, from: 'macys', command: '$M' });
  // Never the words typed, $ or not.
  const seen = { search: async () => [{ id: '$GOLD', name: 'Gold.com Inc', kind: 'stock' }], checkTicker: async () => true, stockId };
  for (const typed of ['$GOLD', '$gold']) {
    const r = await resolveInput(typed, seen);
    assert.ok(!r.symbols?.some((s) => s.cmd === '$GOLD'), typed);
  }
});

test('$: Tab and the suggestion list offer stocks only, as $ + ticker', () => {
  assert.deepEqual(suggest('$GO'), [], 'no commands or instruments after $');
  assert.ok(suggest('GO').some((s) => s.value === 'GOLD'), 'plain GO still lists spot gold');
  const rows = [{ id: 'GOLD', name: 'Gold / US Dollar Spot', kind: 'spot' }, { id: '$GOLD', name: 'Gold.com Inc', kind: 'stock' }, { id: 'GOOG', name: 'Alphabet C', kind: 'stock' }, { id: 'M', name: "Macy's Inc", kind: 'stock' }];
  assert.deepEqual(stockRows(rows).map((r) => r.id), ['GOLD', '$GOLD', 'GOOG', '$M']);
  assert.deepEqual(stockRows(rows, true).map((r) => r.id), ['$GOLD', '$GOOG', '$M']);
  const list = symbolSuggestions(stockRows(rows, true));
  assert.equal(completeFrom(list, '$GO'), '$GOLD');
  assert.deepEqual(parseLookup([{}, { symbolName: 'GOLD', countryCode: 'US', issueType: 'STOCK' }, { symbolName: 'DOW', countryCode: 'US', issueType: 'STOCK' }]).map((r) => r.id), ['$GOLD', '$DOW']);
});

test('$: HELP says it in one line', () => {
  const html = startHere();
  assert.match(html, /\$ \+ ticker always means the stock, e\.g\. <a class="code" href="\?c=\$GOLD" data-cmd="\$GOLD">\$GOLD<\/a>\./);
});

test('$: the server quotes the stock GOLD for $GOLD and spot gold for GOLD', async () => {
  const asked = [];
  const row = (symbol, name, last) => ({ symbol, code: 0, name, last: String(last), change: '0.10', change_pct: '+0.10%' });
  const q = makeQuotes({
    fetchImpl: async (url) => {
      const syms = new URL(url).searchParams.get('symbols').split('|');
      asked.push(syms);
      return { ok: true, status: 200, json: async () => ({ FormattedQuoteResult: { FormattedQuote: syms.map((s) => (s.startsWith('.') || s.includes('=') || s.startsWith('@') || syms.length > 5 ? { symbol: s, code: 0, last: '100', change: '1', change_pct: '1%' } : row(s, s === 'GOLD' ? 'Gold.com Inc' : `${s} Inc`, 44))) } }) };
    },
    cache: createCache(),
  });
  const stock = await q.getQuote('$GOLD');
  assert.deepEqual([stock.ticker, stock.name, stock.kind, stock.last], ['$GOLD', 'Gold.com Inc', 'stock', 44]);
  assert.deepEqual(asked[0], ['GOLD'], 'the source is asked for GOLD, the plain symbol');
  const spot = await q.getQuote('GOLD');
  assert.equal(spot.kind, 'spot');
  const list = await q.getQuoteList(['$GOLD', 'GOLD', '$M']);
  assert.deepEqual(list.quotes.map((x) => [x.ticker, x.kind]), [['$GOLD', 'stock'], ['GOLD', 'spot'], ['$M', 'stock']]);
  assert.deepEqual(list.missing, []);
});
