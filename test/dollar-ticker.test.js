// A leading $ always means the stock: $GOLD is Gold.com, $M is Macy's. Plain words keep
// opening what they open today (GOLD is spot gold, M is MARKETS), with a "Stock: $GOLD"
// hint when the word is also a listed stock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCommand, stockId, stockHintFor, tickerToCheck, tickerFunctions, toQuery, fromQuery, urlFor,
  suggest, stockRows, symbolSuggestions, completeFrom,
} from '../public/app.js';
import { didYouMeanHtml } from '../public/cards.js';
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
    // DESK: no hint (it landed in the desk's tool bar as a panel's "Stock: $DESK").
    assert.equal(stockHintFor(t, plain), t === 'DESK' ? null : `$${t}`, `${t} shows the hint`);
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

test('$DESK: DESK shows no "Stock: $DESK" in its bar, and $DESK still opens the stock', () => {
  for (const raw of ['DESK', 'DESK 2', 'DESK WEIRD', 'DESK RESET']) assert.equal(stockHintFor(raw, parseCommand(raw)), null, raw);
  assert.equal(parseCommand('DESK').name, 'DESK');
  const c = parseCommand('$DESK');
  assert.deepEqual([c.name, c.args.ticker], ['QUOTE', '$DESK']);
  // The hint's place in the page: a panel's title strip or HELP's search bar, never the DESK bar.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /view\.querySelector\('\.panel-head, \.help-search'\)/);
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
  assert.match(didYouMeanHtml('$XXXXX', r, ticker), /<p class="tag card-kicker">No such ticker\. Yet\.<\/p><h2 class="card-hero card-hero-60 num">\$XXXXX<\/h2>/);
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
  assert.match(html, /\$ before a ticker always means the stock, e\.g\. <a class="code" href="\?c=\$GOLD" data-cmd="\$GOLD">\$GOLD<\/a>\./);
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

// ---- $ everywhere a command takes a symbol ------------------------------------------
import { parseSymbols } from '../public/watchlist.js';
import { parseCsv, readPfForm } from '../public/portfolio.js';
import { resolveAlertSymbol } from '../public/alerts.js';
import { tapeSymbol, parseTape } from '../public/pro.js';
import { parse as parseCompare, addTicker } from '../public/screens/compare.js';
import { parseMine, formWords } from '../public/whatif-mine.js';
import { whatifTokens } from '../data/whatif-cert.js';
import { resolveTopic as helpTopic } from '../public/screens/help.js';
import { parseAdd, tickerOf, retarget, embedSrc, parseDesks, serializeDesks, defaultDesks, addPanel } from '../public/desk-layout.js';
import { stockIdOf } from '../public/known-tickers.js';

test('$ everywhere: the shared stock id agrees with the router', () => {
  for (const t of [...COLLISIONS, 'W', 'AAPL', 'BRK.B', 'SPX', 'NEWS', 'HOME', 'PF', 'CPI', 'FX', 'F', 'X']) {
    assert.equal(stockIdOf(`$${t}`), stockId(t), t);
  }
  assert.equal(stockIdOf('GOLD'), null, 'no $, no stock');
  assert.equal(stockIdOf('$1200'), null, 'an amount is no stock');
});

test('$ everywhere: WATCH ADD $GOLD watches the stock; WATCH ADD GOLD spot gold', () => {
  for (const t of COLLISIONS) {
    assert.deepEqual(parseCommand(`WATCH ADD $${t}`).args.ids, [`$${t}`], t);
    assert.deepEqual(parseSymbols([`$${t.toLowerCase()}`]).ids, [`$${t}`], 'the WATCH add field too');
  }
  assert.deepEqual(parseCommand('WATCH ADD GOLD').args.ids, ['GOLD']);
  assert.deepEqual(parseCommand('WATCH ADD DOW').args.ids, ['DJI']);
  assert.deepEqual(parseCommand('W ADD $M').args.ids, ['$M']);
  assert.deepEqual(parseCommand('WATCH ADD $AAPL').args.ids, ['AAPL']);
  assert.deepEqual(parseSymbols(['$GOLD,GOLD,$1200']), { ids: ['$GOLD', 'GOLD'], bad: ['1200'] });
});

test('$ everywhere: PORTFOLIO ADD $M holds Macy\'s; plain GOLD is spot gold', () => {
  const m = parseCommand('PORTFOLIO ADD $M 10 @ 20');
  assert.deepEqual([m.args.action, m.args.ticker, m.args.shares, m.args.cost], ['add', '$M', 10, 20]);
  assert.equal(parseCommand('PF ADD $GOLD 5 @ 40').args.ticker, '$GOLD');
  assert.equal(parseCommand('PF ADD GOLD 1 @ 3000').args.ticker, 'GOLD');
  assert.equal(parseCommand('PF SELL $M 5').args.ticker, '$M');
  assert.equal(readPfForm({ ticker: '$gold', shares: '5', price: '40' }).ticker, '$GOLD');
  assert.deepEqual(parseCsv('$GOLD,5,40\nGOLD,1,3000').holdings.map((h) => h.ticker), ['$GOLD', 'GOLD']);
});

test('$ everywhere: ALERTS $GOLD > 30 watches the stock; ALERTS GOLD > 3000 spot gold', () => {
  const a = parseCommand('ALERTS $GOLD > 30').args.alert;
  assert.deepEqual([a.kind, a.sym, a.op, a.level], ['quote', '$GOLD', '>', 30]);
  assert.equal(parseCommand('ALERTS $GOLD>30').args.alert.sym, '$GOLD');
  assert.equal(parseCommand('ALERTS GOLD > 3000').args.alert.sym, 'GOLD');
  assert.equal(parseCommand('ALERTS $M < 20').args.alert.sym, '$M');
  for (const t of COLLISIONS) assert.deepEqual(resolveAlertSymbol([`$${t}`]), { kind: 'quote', sym: `$${t}` }, t);
});

test('$ everywhere: COMPARE and its add field', () => {
  assert.deepEqual(parseCommand('COMPARE $GOLD $DOW AAPL').args.tickers, ['$GOLD', '$DOW', 'AAPL']);
  assert.deepEqual(parseCommand('COMPARE GOLD AAPL').args.tickers, ['GOLD', 'AAPL']);
  assert.deepEqual(parseCompare(['$GOLD', 'GOLD']).tickers, ['$GOLD', 'GOLD'], 'the stock and the metal side by side');
  assert.equal(addTicker(['AAPL'], '1Y', '$gold'), 'COMPARE AAPL $GOLD 1Y');
  assert.equal(addTicker(['AAPL'], '1Y', '$msft'), 'COMPARE AAPL MSFT 1Y');
});

test('$ everywhere: TAPE, WHATIF MY and HELP', () => {
  assert.equal(tapeSymbol('$GOLD'), '$GOLD');
  assert.equal(tapeSymbol('GOLD'), 'GOLD');
  assert.deepEqual(parseCommand('TAPE ADD $GOLD $M').args.symbols, ['$GOLD', '$M']);
  assert.deepEqual(parseTape(['ADD', 'GOLD']).symbols, ['GOLD']);
  // WHATIF MY: your own purchase of the stock.
  const now = new Date('2026-09-27T12:00:00Z');
  assert.equal(parseMine(['MY', '1000', '$GOLD', '2020'], now).mine[0].ticker, '$GOLD');
  assert.equal(parseMine(['MY', '1000', 'GOLD', '2020'], now).mine[0].ticker, 'GOLD');
  assert.deepEqual(formWords({ amount: '1000', ticker: '$gold', date: '2020' }, now), ['MY', '1000', '$GOLD', '2020']);
  assert.deepEqual(whatifTokens('WHATIF MY 1000 $GOLD 2020'), ['MY', '1000', '$GOLD', '2020'], 'the server takes it');
  assert.equal(whatifTokens('MY 1000 $<SCRIPT> 2020'), null);
  assert.deepEqual(parseCommand('WHATIF MY 1000 $GOLD 2020').args.tokens, ['MY', '1000', '$GOLD', '2020']);
  // HELP $GOLD: the stock's functions.
  assert.equal(helpTopic('$GOLD').ticker, '$GOLD');
  assert.equal(helpTopic('GOLD').ticker, undefined);
});

test('$ everywhere: DESK panels', () => {
  assert.deepEqual(parseAdd('+ $gold'), { cmd: '$GOLD' });
  const panels = addPanel([], '$GOLD');
  assert.equal(tickerOf(panels[0].cmd, parseCommand), '$GOLD');
  assert.equal(tickerOf('GOLD', parseCommand), 'GOLD', 'plain GOLD stays the metal');
  assert.equal(retarget('NEWS AAPL', '$GOLD', parseCommand), 'NEWS $GOLD');
  assert.equal(retarget('FINANCIALS AAPL', '$M', parseCommand), 'FINANCIALS $M');
  // The panel's frame loads the stock.
  const src = new URL(embedSrc('$GOLD 5Y'), 'https://bloombroke.com');
  assert.deepEqual(parseCommand(src.searchParams.get('c')).args, { ticker: '$GOLD', range: '5Y' });
  // Saved and loaded again, the panel is still the stock.
  const state = defaultDesks();
  state.desks[0].panels = panels;
  const back = parseDesks(JSON.parse(JSON.stringify(serializeDesks(state))));
  assert.equal(back.state.desks[0].panels[0].cmd, '$GOLD');
});
