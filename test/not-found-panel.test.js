// NO SUCH TICKER. YET. and its one Did-you-mean line (screens/nosuch.js): the close match
// by ticker or by name (closeMatch) on top of the restored card, Enter opens it; and
// company names in the command bar (APPLE is AAPL, LEHMAN is its stone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCommand, tickerToCheck } from '../public/app.js';
import { resolveInput } from '../public/resolve.js';
import { tickerForName } from '../public/known-tickers.js';
import { didYouMeanHtml } from '../public/cards.js';
import {
  closeness, candidates, closestRows, graveByName, stoneFor, notFoundKeys, shortName, noSuchExtra, closeMatch, withoutMatch, guessCount, didYouMeanLine,
  keysAfterLine, wireNoSuch, yardHtml, TITLE_YET,
} from '../public/screens/nosuch.js';
import { loadGraveyard } from '../lib/og-nosuch.js';

const GRAVES = loadGraveyard();
const THLM = { id: 'THLM', name: 'TH Lehman & Co Inc', cmd: 'THLM' };
const rowsFor = (typed, found = {}) => closestRows(typed, candidates({ found, graves: GRAVES, typed }));
const names = (rows) => rows.map((r) => r.name);

// ---- Matching ------------------------------------------------------------------------------

test('matches: by ticker and by name, graveyard stones and live instruments together', () => {
  // LEHM: Lehman Brothers (a stone: the name starts with it, and LEH is inside it) first,
  // then the live company the symbol search found.
  const lehm = rowsFor('LEHM', { symbols: [THLM] });
  assert.equal(lehm[0].kind, 'grave');
  assert.equal(lehm[0].name, 'Lehman Brothers');
  assert.equal(lehm[0].cmd, 'GRAVEYARD LEH');
  assert.equal(lehm[0].what, 'graveyard · filed 2008');
  assert.ok(lehm.some((r) => r.kind === 'live' && r.id === 'THLM' && r.name === 'TH Lehman & Co'), 'the search row, its name without Inc');
  // A typo of a company name: APPLEE is Apple; TESLAA Tesla; ENRN Enron (a stone).
  assert.deepEqual([rowsFor('APPLEE')[0].id, rowsFor('APPLEE')[0].name], ['AAPL', 'Apple']);
  assert.equal(rowsFor('TESLAA')[0].id, 'TSLA');
  assert.equal(rowsFor('ENRN')[0].cmd, 'GRAVEYARD ENE');
  assert.equal(rowsFor('BLOKBUSTER')[0].cmd, 'GRAVEYARD BBI');
  // By ticker: one letter off (MSFY), or one inside the other (NVDAA); a 2-letter
  // ticker inside the word is too weak (MS in MSFY).
  assert.equal(rowsFor('MSFY')[0].id, 'MSFT');
  assert.equal(rowsFor('NVDAA')[0].id, 'NVDA');
  // Named instruments are live rows too (the same universe the command bar resolves).
  assert.ok(rowsFor('NASDAK').some((r) => r.kind === 'live' && r.id === 'NDX'));
  // Several close: at most 3, best first.
  const amer = rowsFor('AMERICAN');
  assert.equal(amer.length, 3);
  assert.ok(amer.every((r) => /^American /.test(r.name)), names(amer).join(', '));
  // A command one typo away still shows (the resolver's rows).
  const fin = rowsFor('FINANCALS', { commands: [{ name: 'FINANCIALS', summary: 'Income, balance sheet and cash flow', cmd: 'FINANCIALS AAPL' }] });
  assert.deepEqual([fin[0].kind, fin[0].cmd], ['cmd', 'FINANCIALS AAPL']);
  // Nothing close, and never the words typed.
  assert.deepEqual(rowsFor('XQZT'), []);
  assert.ok(!rowsFor('XLY', { symbols: [{ id: 'XLY', name: 'Consumer Discretionary', cmd: 'XLY' }] }).some((r) => r.cmd === 'XLY'));
  assert.equal(closeness('', { names: ['Apple'] }), 0);
  assert.equal(shortName('Apple Inc.'), 'Apple');
  assert.equal(shortName('Meta Platforms, Inc.'), 'Meta Platforms');
});

test('a graveyard company typed by name is its stone; its old ticker is not a name', () => {
  for (const [typed, t] of [['LEHMAN', 'LEH'], ['LEHMAN BROTHERS', 'LEH'], ['lehman brothers', 'LEH'], ['BLOCKBUSTER', 'BBI'], ['ENRON', 'ENE'], ['TOYS R US', 'TOY'], ['WAMU', 'WM']]) {
    assert.equal(graveByName(typed, GRAVES)?.ticker, t, typed);
  }
  for (const typed of ['LEH', 'LEHMANN', 'APPLE', '', 'LEHMAN FOO']) assert.equal(graveByName(typed, GRAVES), null, typed);
  assert.equal(graveByName('LEHMAN', []), null, 'no list, no stone (the server word check still finds LEHMAN)');
  // app.js: the stone opens as GRAVEYARD <ticker> in the address bar (stoneFor: below).
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const c = `GRAVEYARD \$\{stone\.ticker\}`;\s*replaceUrl\(c\);\s*render\(c, \{ checked: true/);
});

test('keys: Enter opens the Did-you-mean line from the empty bar; a digit opens its item only with the focus in the card', () => {
  let handler = null;
  let list = { hidden: true };
  const doc = { addEventListener: (t, h, cap) => { assert.equal(cap, true); handler = h; }, removeEventListener: () => { handler = null; }, getElementById: (id) => (id === 'suggest' ? list : null) };
  const clicked = [];
  const row = { inPanel: true, closest: (s) => (/\ba\b/.test(s) ? {} : null) }; // a focused row link
  const el = {
    isConnected: true,
    contains: (t) => Boolean(t?.inPanel),
    querySelector: (sel) => { const m = /\[data-key="(\d)"\]/.exec(sel); return m && Number(m[1]) <= 4 ? { click: () => clicked.push(m[1]) } : null; },
  };
  const stop = notFoundKeys(el, { doc });
  const press = (key, target, extra = {}) => { const e = { key, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; handler(e); return e.defaultPrevented; };
  const bar = (value = '') => ({ id: 'cmd', value, closest: () => null });
  const page = { closest: () => null };
  assert.equal(press('Enter', bar()), true, 'Enter in the empty bar: the closest');
  assert.equal(press('Enter', page), true, 'Enter on the page: the closest');
  assert.equal(press('2', row), true, 'a digit with the focus in the panel');
  assert.equal(press('4', { inPanel: true, closest: () => null }), true);
  assert.deepEqual(clicked, ['1', '1', '2', '4']);
  // A digit in the command bar is typing (3988.HK); "2 Enter" there is app.js's numberedItem.
  assert.equal(press('2', bar()), false, 'the empty bar: typing a digit');
  assert.equal(press('3', bar('A')), false, 'typing A3 stays typing');
  assert.equal(press('2', page), false, 'focus outside the panel');
  assert.equal(press('9', row), false, 'no row 9');
  assert.equal(press('Enter', bar('AAPL')), false, 'Enter runs what is typed');
  assert.equal(press('Enter', row), false, 'a focused link opens itself');
  assert.equal(press('Enter', { closest: (s) => (/input/.test(s) ? {} : null) }), false, 'another field');
  assert.equal(press('Enter', bar(), { ctrlKey: true }), false);
  list = { hidden: false };
  assert.equal(press('Enter', bar()), false, 'the suggestion list is open: its own pick');
  assert.deepEqual(clicked, ['1', '1', '2', '4']);
  stop();
  assert.equal(handler, null);
  // From the bar a number and Enter opens that item (app.js panelNumberInput and numberedItem, data-key).
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const n = typed && !embed && tickerBar\.hidden \? panelNumberInput\(clean\) : null;\s*if \(n\) \{\s*const item = numberedItem\(screen, n\);/);
});


// ---- The Did-you-mean line on the restored NO SUCH card --------------------------------------

// The card as app.js showDidYouMean draws it (cards.js didYouMeanHtml with this screen's slots).
const page = (typed, ticker, found = {}, info = { grave: null, ipo: true }) => {
  const top = closeMatch(typed, { found, graves: GRAVES });
  const shown = withoutMatch(found, top);
  const extra = noSuchExtra(ticker || typed, info, { ticker, next: guessCount(shown, typed, ticker) + 1, yard: GRAVES.slice(0, 4), top });
  const html = didYouMeanHtml(typed, shown, ticker, { extra: { ...extra, kicker: extra.kicker || (ticker ? TITLE_YET : 'Unknown command') } });
  return top ? keysAfterLine(html) : html;
};

test('Did you mean: a close match (LEHM) adds one line on top; Enter opens it', () => {
  const top = closeMatch('LEHM', { found: { symbols: [THLM] }, graves: GRAVES });
  assert.deepEqual([top.kind, top.id, top.name, top.cmd], ['grave', 'LEH', 'Lehman Brothers', 'GRAVEYARD LEH']);
  assert.equal(didYouMeanLine(top), '<span class="ns-dym">Did you mean <a href="?c=GRAVEYARD+LEH" data-cmd="GRAVEYARD LEH" data-key="1" data-dym>LEH, Lehman Brothers</a>?</span>');
  const html = page('LEHM', 'LEHM', { symbols: [THLM] });
  // The line first (the kit's alert slot, above the kicker and the hero), then the old page.
  assert.match(html, /^<section class="card ns-card"[^>]*><p class="card-alert" role="status"><span class="ns-dym">Did you mean <a href="\?c=GRAVEYARD\+LEH" data-cmd="GRAVEYARD LEH" data-key="1" data-dym>LEH, Lehman Brothers<\/a>\?<\/span><\/p><div class="card-head"><p class="tag card-kicker">No such ticker\. Yet\.<\/p><h2 class="card-hero card-hero-60 num">\$LEHM<\/h2><p class="card-sub">Nobody has listed it\. Be the first\.<\/p>/);
  assert.equal((html.match(/Did you mean/g) || []).length, 1, 'one line');
  const order = ['ns-dym', '>IPO IT</button>', 'class="ns-mini"', 'NOT A REAL SECURITY', 'class="ns-yard"', 'Want it on Bloombroke?', 'data-cmd="THLM"', 'ALL COMMANDS'].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the old page, in its order');
  assert.equal((html.match(/class="ns-mini-stone"/g) || []).length, 4, 'THE GRAVEYARD row of 4');
  // Keys: the line 1 (Enter), then the guess and IPO IT one down.
  assert.match(html, /data-cmd="IPO IT LEHM" data-ipo data-key="3">IPO IT</);
  assert.match(html, /data-cmd="THLM" data-key="2"/);
  assert.deepEqual([...html.matchAll(/data-key="(\d)"/g)].map((m) => m[1]).sort(), ['1', '2', '3']);
  for (const gone of [/Nothing close/, /Check the spelling/, /nf-row|nf-panel|NOT A TICKER/]) assert.doesNotMatch(html, gone, String(gone));
});

test('Did you mean: nothing close (XQZT), no line: the previous page as it was', () => {
  assert.equal(closeMatch('XQZT', { graves: GRAVES }), null);
  assert.equal(closeMatch('FOO BAR', { found: { commands: [{ name: 'WHY', cmd: 'WHY AAPL', summary: 'Why it moved' }] } }), null, 'a guess by meaning alone is not close');
  const html = page('XQZT', 'XQZT');
  assert.doesNotMatch(html, /card-alert|ns-dym|data-dym|Did you mean/);
  assert.match(html, /card-kicker">No such ticker\. Yet\.<\/p><h2 class="card-hero card-hero-60 num">\$XQZT<\/h2><p class="card-sub">Nobody has listed it\. Be the first\.<\/p>/);
  assert.match(html, /<button type="button" class="btn card-btn btn-solid ns-ipo-btn" data-cmd="IPO IT XQZT" data-ipo data-key="1">IPO IT<\/button>/);
  assert.match(html, /\$XQZT<\/span><span class="ns-mini-stamp" aria-hidden="true">NOT A REAL SECURITY/);
  assert.match(html, /<h3 class="hs-h">The graveyard<\/h3>/);
  assert.match(html, /data-prefill="Please add: XQZT">Tell us\.<\/a>/);
  assert.match(html, /ALL COMMANDS/);
  assert.doesNotMatch(html, /Nothing close/);
});

test('Did you mean: the match is never also one of the guesses', () => {
  const found = { symbols: [{ id: 'AAPL', name: 'Apple Inc.', cmd: 'AAPL' }, THLM], commands: [] };
  const top = closeMatch('APPLEE', { found, graves: GRAVES });
  assert.equal(top.cmd, 'AAPL');
  assert.deepEqual(withoutMatch(found, top).symbols.map((s) => s.cmd), ['THLM']);
  assert.equal(withoutMatch(found, null), found, 'no match: the guesses as they were');
  const html = page('APPLEE', null, found, { grave: null, ipo: false });
  assert.equal((html.match(/data-cmd="AAPL"/g) || []).length, 1, 'AAPL once: the line');
  assert.match(html, /Did you mean <a href="\?c=AAPL" data-cmd="AAPL" data-key="1" data-dym>AAPL, Apple<\/a>\?/);
  assert.match(html, /data-cmd="THLM" data-key="2"/, 'the other guess, key 2');
  // Keys past the line: one down; past 9 no key; the line keeps 1.
  assert.equal(keysAfterLine('<a data-key="1" data-dym></a><b data-key="1"></b><c data-key="8"></c><d data-key="9"></d>'), '<a data-key="1" data-dym></a><b data-key="2"></b><c data-key="9"></c><d></d>');
});

test('Did you mean: Enter is wired only with the line, never on a stone card', () => {
  let added = 0;
  const doc = { addEventListener: () => { added += 1; }, removeEventListener: () => {}, getElementById: () => null };
  const el = { isConnected: true, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
  wireNoSuch(el, 'XQZT', { grave: null }, { doc })();
  assert.equal(added, 0, 'no line: no key handler (the old page)');
  wireNoSuch(el, 'LEHM', { grave: null }, { doc, enter: true })();
  assert.equal(added, 1, 'the line: Enter opens it');
  const leh = GRAVES.find((e) => e.ticker === 'LEH');
  assert.equal(noSuchExtra('LEH', { grave: leh }, { top: { cmd: 'X', id: 'X', name: 'X' } }).alert, undefined, 'a stone card has no line');
  assert.deepEqual(noSuchExtra(null, { grave: null }), {}, 'no word, no match: nothing');
  assert.deepEqual(Object.keys(noSuchExtra(null, { grave: null }, { top: closeMatch('LEHM', { graves: GRAVES }) })), ['alert'], 'a DESK panel: the line only');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const top = ns && !info\.grave \? ns\.closeMatch\(typed, \{ found, graves \}\) : null;\s*if \(ns\) found = ns\.withoutMatch\(found, top\);/);
  assert.match(app, /view\.innerHTML = cards && top \? ns\.keysAfterLine\(html\) : html;/);
  assert.match(app, /ns\.wireNoSuch\(view, word, info, \{ status: setStatus, enter: Boolean\(top\) \}\)/);
  assert.match(app, /yard: info\.grave \? \[\] : ns\.yardPick\(graves\)/);
  assert.doesNotMatch(app, /ns\.notFound\(/, 'the NOT A TICKER panel is gone');
});

test('the restored page: the red status line, THE GRAVEYARD row without counts, its styles', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /else setStatus\(rows \? 'NOT FOUND\. PICK ONE BELOW, OR TYPE HELP' : ticker \? 'NO SUCH TICKER\. TYPE HELP' : 'UNKNOWN COMMAND\. TYPE HELP', 'warn'\);/);
  assert.match(app, /else if \(top\) setStatus\(`NOT FOUND\. ENTER OPENS \$\{String\(top\.id \|\| top\.name\)\.toUpperCase\(\)\}, OR TYPE HELP`, 'warn'\);/);
  assert.doesNotMatch(yardHtml(GRAVES.slice(0, 4)), /respect|data-count/, 'no count on the small stones');
  const src = readFileSync(new URL('../public/screens/nosuch.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Nothing close|notFoundHtml|notFoundStatus|fillPrices|nf-row/, 'the panel is gone');
  const css = readFileSync(new URL('../public/screens/nosuch.css', import.meta.url), 'utf8');
  assert.match(css, /\.ns-yard \{/);
  assert.match(css, /\.ns-mini-stone \{/);
  assert.doesNotMatch(css, /\.nf-/);
  assert.match(css, /\.status-msg\[data-kind="note"\] \{ color: var\(--text-2\); \}/, 'app.js lookupFailed');
  const dym = css.slice(css.indexOf('/* The Did-you-mean line'));
  for (const m of dym.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(m[1]) >= 12, m[0]);
  assert.match(dym, /\.ns-card > \.card-alert \{ font-size: 14px;/, 'the line at 14 px');
});

test('a dead ticker typed on its own keeps its stone card', () => {
  const leh = GRAVES.find((e) => e.ticker === 'LEH');
  assert.match(JSON.stringify(noSuchExtra('LEH', { grave: leh })), /No such ticker\. Not anymore\./);
});


// ---- The command bar: names -----------------------------------------------------------------

test('command bar: an unambiguous company name opens its ticker', async () => {
  const expect = { APPLE: 'AAPL', TESLA: 'TSLA', NVIDIA: 'NVDA', MICROSOFT: 'MSFT', AMAZON: 'AMZN', GOOGLE: 'GOOGL', NETFLIX: 'NFLX', 'COCA COLA': 'KO', 'coca-cola': 'KO', apple: 'AAPL' };
  for (const [typed, t] of Object.entries(expect)) {
    const r = await resolveInput(typed, { search: async () => [], checkTicker: async () => false });
    assert.deepEqual([r.confident, r.command], [true, t], typed);
  }
  // META is a ticker and Meta's name: the quote at once.
  assert.deepEqual([parseCommand('META').name, parseCommand('META').args.ticker], ['QUOTE', 'META']);
  // A 5-letter name (APPLE, TESLA) is not asked about as a ticker: app.js skips the quote
  // check for a known name and goes straight to the resolver.
  assert.equal(tickerToCheck(parseCommand('APPLE')), 'APPLE');
  assert.equal(tickerForName('APPLE')?.id, 'AAPL');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(ticker && !tickerForName\(ticker\)\) \{/);
});

test('command bar: graveyard names, typos and ambiguous words are not resolved (they reach the NO SUCH card)', async () => {
  for (const typed of ['LEHMAN', 'LEHMAN BROTHERS', 'BLOCKBUSTER', 'ENRON', 'APPLEE', 'LEHM', 'XQZT']) {
    const r = await resolveInput(typed, { search: async () => [], checkTicker: async () => false });
    assert.equal(r.confident, false, typed);
  }
  const amer = await resolveInput('AMERICAN', {
    search: async () => [{ id: 'AXP', name: 'American Express Company', kind: 'stock' }, { id: 'AAL', name: 'American Airlines Group Inc.', kind: 'stock' }],
    checkTicker: async () => false,
  });
  assert.equal(amer.confident, false, 'two strong names: pick one on the card');
  assert.deepEqual(amer.symbols.map((s) => s.id), ['AXP', 'AAL']);
});

test('command bar: a word that is a command stays a command', () => {
  for (const w of ['HELP', 'HOME', 'DESK', 'MARKETS', 'NEWS', 'WATCH', 'PRO', 'ME', 'CHAT', 'GRID', 'WEIRD', 'GUESS', 'WHATIF', 'GRAVEYARD', 'SPONSOR', 'BBRK', 'FISHTANK']) {
    const c = parseCommand(w);
    assert.notEqual(c.name, 'UNKNOWN', w);
    assert.notEqual(c.name, 'QUOTE', w);
    assert.equal(tickerToCheck(c), null, `${w} is never looked up`);
  }
});

// ---- Command guesses and routing (review fixes) ------------------------------------------------

test('command guesses from the resolver are listed, and first on a tie', async () => {
  const first = async (typed) => {
    const found = await resolveInput(typed, { search: async () => [], checkTicker: async () => false });
    return rowsFor(typed, found);
  };
  assert.equal((await first('RATSE'))[0].cmd, 'RATES');
  const cmp = await first('COMPAER');
  assert.equal(cmp[0].name, 'COMPARE', cmp.map((r) => r.name).join(', '));
  const news = await first('NEWZ');
  assert.equal(news[0].cmd, 'NEWS', news.map((r) => r.name).join(', '));
  // MOVESR: the resolver's guess (by what the command does) is kept, though its name is far.
  const moves = await first('MOVESR');
  assert.ok(moves.some((r) => r.kind === 'cmd' && r.name === 'WHY'), moves.map((r) => r.name).join(', '));
  // One word typed is matched word by word: NEWZ is not "New Zealand ..." by prefix.
  assert.equal(closeness('NEWZ', { names: ['New Zealand 50'] }) < 80, true);
  assert.equal(closeness('LEHM', { names: ['Lehman Brothers'] }), 80);
  assert.equal(closeness('american exp', { names: ['American Express'] }), 80, 'more words: the name starts with them');
});

test('routing: a name opens its stone; LEH alone keeps its card; a stone that beat a quote keeps its $ link', () => {
  const leh = GRAVES.find((e) => e.ticker === 'LEH');
  const ene = GRAVES.find((e) => e.ticker === 'ENE');
  assert.equal(stoneFor('LEHMAN', 'LEHMAN', { grave: leh }, GRAVES)?.ticker, 'LEH');
  assert.equal(stoneFor('LEHMAN BROTHERS', null, { grave: null }, GRAVES)?.ticker, 'LEH');
  assert.equal(stoneFor('ENRON', 'ENRON', { grave: ene }, [])?.ticker, 'ENE', 'the list did not load: the server word check');
  assert.equal(stoneFor('LEH', 'LEH', { grave: leh }, GRAVES), null, 'LEH typed: its stone card');
  assert.equal(stoneFor('LEHMAN', 'LEHMAN', { grave: leh, wins: true }, GRAVES, { quote: true }), null, 'beat a quote: the card with its $ link');
  assert.equal(stoneFor('LEHM', 'LEHM', { grave: null }, GRAVES), null, 'a typo: the NO SUCH card');
  assert.match(JSON.stringify(noSuchExtra('LEH', { grave: leh, wins: true }, { quote: true })), /Quote: \$LEH, another listing/);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const stone = ns\?\.stoneFor\(typed, word, info, graves, \{ quote \}\);/);
});

test('the lookup itself failed: a neutral line, never "Not a ticker", nothing on Enter', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /search: \(text\) => searchSymbols\(text, signal\)\.catch\(\(e\) => \{ if \(e\.name !== 'AbortError'\) searchDown = true; throw e; \}\)/);
  assert.match(app, /if \(searchDown\) \{ lookupFailed\(view, typed\); return; \}\s*await showDidYouMean\(view, typed, found, ticker, signal\);/);
  assert.match(app, /if \(err\.name === 'AbortError' \|\| signal\.aborted\) return;\s*lookupFailed\(view, typed\);/);
  const fn = app.slice(app.indexOf('function lookupFailed('), app.indexOf('function lookupFailed(') + 500);
  assert.match(fn, /Could not look that up\. Try again in a minute\./);
  assert.match(fn, /setStatus\('COULD NOT LOOK THAT UP\. TRY AGAIN', 'note'\);/, 'colour 2, like the panel');
  assert.doesNotMatch(fn, /notFound|data-key|Not a ticker|'warn'/);
});

test('by-meaning command guesses never lead over a real match; typo guesses do on a tie', async () => {
  const rows = async (typed, extra = {}) => {
    const found = await resolveInput(typed, { search: async () => [], checkTicker: async () => false });
    return rowsFor(typed, { ...found, symbols: [...(found.symbols || []), ...(extra.symbols || [])] });
  };
  // WEATHER: the resolver guesses OMENS by meaning; Tether (two letters off) is the Enter row.
  const weather = await rows('WEATHER');
  assert.notEqual(weather[0].cmd, 'OMENS', weather.map((r) => r.name).join(', '));
  assert.ok(weather.some((r) => r.cmd === 'OMENS'), 'still listed');
  // HOUSE: WAFFLE by meaning; a real ticker match (HOUS) leads.
  const house = await rows('HOUSE', { symbols: [{ id: 'HOUS', name: 'Anywhere Real Estate Inc', cmd: 'HOUS' }] });
  assert.equal(house[0].cmd, 'HOUS', house.map((r) => r.name).join(', '));
  assert.ok(house.some((r) => r.cmd === 'WAFFLE'));
  // FOO BAR: only guesses by meaning: they are the rows.
  const foo = await rows('FOO BAR');
  assert.ok(foo.length && foo.every((r) => r.kind === 'cmd'), foo.map((r) => r.name).join(', '));
  // Floors: 50 a typo away (COMPAER, COMPARE), 30 by meaning (MOVESR, WHY).
  const floors = (typed, commands) => candidates({ found: { commands }, typed }).filter((c) => c.kind === 'cmd').map((c) => c.floor);
  assert.deepEqual(floors('COMPAER', [{ name: 'COMPARE', cmd: 'COMPARE AAPL MSFT NVDA' }]), [50]);
  assert.deepEqual(floors('MOVESR', [{ name: 'WHY', cmd: 'WHY AAPL' }]), [30]);
  assert.deepEqual(floors('show me financals', [{ name: 'FINANCIALS', cmd: 'FINANCIALS AAPL' }]), [50], 'a typo in any word');
});
