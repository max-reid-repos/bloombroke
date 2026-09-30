// NOT FOUND (screens/nosuch.js): NO SUCH TICKER. YET. for ticker-shaped words, with its
// one Did-you-mean line (closeMatch, Enter opens it), the UNKNOWN COMMAND panel for
// anything else (CLOSEST, TRY ONE), and company names in the command bar (APPLE is AAPL,
// LEHMAN is its stone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCommand, tickerToCheck } from '../public/app.js';
import { resolveInput } from '../public/resolve.js';
import { tickerForName } from '../public/known-tickers.js';
import { START_HERE } from '../public/registry.js';
import {
  closeness, candidates, closestRows, graveByName, stoneFor, notFoundKeys, shortName, noSuchExtra, closeMatch, withoutMatch, didYouMeanLine,
  keysAfterLine, wireNoSuch, notFoundPage, tickerShaped, tryRows, unknownHtml, liveQuote, liveHtml, showNotFound, TITLE_YET,
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
    querySelector: (sel) => { if (sel === '[data-enter]') return { click: () => clicked.push('E') }; const m = /\[data-key="(\d)"\]/.exec(sel); return m && Number(m[1]) <= 4 ? { click: () => clicked.push(m[1]) } : null; },
  };
  const stop = notFoundKeys(el, { doc });
  const press = (key, target, extra = {}) => { const e = { key, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; handler(e); return e.defaultPrevented; };
  const bar = (value = '') => ({ id: 'cmd', value, closest: () => null });
  const page = { closest: () => null };
  assert.equal(press('Enter', bar()), true, 'Enter in the empty bar: the closest');
  assert.equal(press('Enter', page), true, 'Enter on the page: the closest');
  assert.equal(press('2', row), true, 'a digit with the focus in the panel');
  assert.equal(press('4', { inPanel: true, closest: () => null }), true);
  assert.deepEqual(clicked, ['E', 'E', '2', '4'], 'Enter: the [data-enter] item (the line, CLOSEST)');
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
  assert.deepEqual(clicked, ['E', 'E', '2', '4']);
  stop();
  assert.equal(handler, null);
  // Without a close match: the digits only, Enter is left alone.
  notFoundKeys(el, { doc, enter: false });
  list = { hidden: true };
  assert.equal(press('Enter', bar()), false, 'no line: Enter is not taken');
  assert.equal(press('1', row), true);
  // From the bar a number and Enter opens that item (app.js panelNumberInput and numberedItem, data-key).
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const n = typed && !embed && tickerBar\.hidden \? panelNumberInput\(clean\) : null;\s*if \(n\) \{\s*const item = numberedItem\(screen, n\);/);
});


// ---- NOT FOUND: which page ------------------------------------------------------------------

// The page as app.js showDidYouMean draws it (screens/nosuch.js showNotFound).
const page = (typed, ticker, found = {}, info = { grave: null, ipo: true }) => notFoundPage({ typed, word: ticker || typed, found, ticker, info, graves: GRAVES, day: '2026-09-30' });

test('which page: ticker-shaped words get NO SUCH TICKER, anything else UNKNOWN COMMAND', () => {
  for (const t of ['XQZT', 'LEHM', '$ABCD', 'ABC.B', 'q', 'xqzt']) assert.equal(tickerShaped(t), true, t);
  for (const t of ['HIUHASBDAS', 'FOO BAR', 'TOOLONG', 'A1', '$', 'ABC.DEF', '']) assert.equal(tickerShaped(t), false, t);
  assert.equal(page('XQZT', 'XQZT').kind, 'ticker');
  assert.equal(page('$ABCD', null).kind, 'ticker', 'shape alone decides, with no ticker checked');
  assert.equal(page('HIUHASBDAS', null, {}, { grave: null, ipo: false }).kind, 'unknown');
  assert.equal(page('FOO BAR', null, {}, { grave: null, ipo: false }).kind, 'unknown');
  const leh = GRAVES.find((e) => e.ticker === 'LEH');
  assert.equal(page('LEH', 'LEH', {}, { grave: leh }).kind, 'stone');
  assert.equal(notFoundPage({ typed: 'XQZT', ticker: 'XQZT', embed: true, graves: GRAVES }).kind, 'desk', 'a DESK panel keeps the plain card');
  // A DESK panel: the guesses never repeat the line's match; keys past the line one down.
  const found = { symbols: [{ id: 'AAPL', name: 'Apple Inc.', cmd: 'AAPL' }, THLM], commands: [] };
  const top = closeMatch('APPLEE', { found, graves: GRAVES });
  assert.equal(top.cmd, 'AAPL');
  assert.deepEqual(withoutMatch(found, top).symbols.map((x) => x.cmd), ['THLM']);
  assert.equal(withoutMatch(found, null), found);
  const desk = notFoundPage({ typed: 'APPLEE', found, embed: true, graves: GRAVES }).html;
  assert.equal((desk.match(/data-cmd="AAPL"/g) || []).length, 1, 'AAPL once: the line');
  assert.match(desk, /data-cmd="THLM" data-key="2"/);
  assert.equal(keysAfterLine('<a data-key="1" data-enter data-dym></a><b data-key="1"></b><c data-key="8"></c><d data-key="9"></d>'), '<a data-key="1" data-enter data-dym></a><b data-key="2"></b><c data-key="9"></c><d></d>');
});

test('Did you mean: a close match (LEHM) adds one line on top; Enter opens it; LEH stands under the words', () => {
  const top = closeMatch('LEHM', { found: { symbols: [THLM] }, graves: GRAVES });
  assert.deepEqual([top.kind, top.id, top.name, top.cmd], ['grave', 'LEH', 'Lehman Brothers', 'GRAVEYARD LEH']);
  assert.equal(didYouMeanLine(top), '<span class="ns-dym">Did you mean <a href="?c=GRAVEYARD+LEH" data-cmd="GRAVEYARD LEH" data-key="1" data-enter data-dym>LEH, Lehman Brothers</a>?</span>');
  const p = page('LEHM', 'LEHM', { symbols: [THLM] });
  assert.equal(p.enter, true);
  assert.deepEqual(p.status, ['NOT FOUND. ENTER OPENS LEH, OR TYPE HELP', 'note'], 'colour 2, not red');
  const html = p.html;
  assert.match(html, /^<section class="card card-wide card-split ns-card ns-tk"[^>]*><p class="card-alert" role="status"><span class="ns-dym">Did you mean <a href="\?c=GRAVEYARD\+LEH" data-cmd="GRAVEYARD LEH" data-key="1" data-enter data-dym>LEH, Lehman Brothers<\/a>\?<\/span><\/p>/);
  assert.match(html, /<p class="tag card-kicker">No such ticker\. Yet\.<\/p><h2 class="card-hero card-hero-96 num">\$LEHM<\/h2><p class="card-sub">Nobody has listed it\. Be the first\.<\/p>/);
  assert.equal((html.match(/Did you mean/g) || []).length, 1, 'one line');
  assert.match(html, /data-cmd="IPO IT LEHM" data-ipo data-key="2">IPO IT</);
  assert.deepEqual([...html.matchAll(/data-key="(\d)"/g)].map((m) => m[1]).sort(), ['1', '2']);
  // The stones whose letters match (LEH), in the stone art; the certificate on the right.
  assert.match(html, /class="ns-rip-stone" href="\?c=GRAVEYARD\+LEH"/);
  assert.equal((html.match(/class="ns-rip-stone"/g) || []).length, 1);
  const order = ['ns-dym', 'class="card-art"', 'ns-cert2', 'NOT A REAL SECURITY', 'SHARE ON X', '$LEHM</h2>', '>IPO IT</button>', 'ns-rip', 'Want it on Bloombroke?'].map((x) => html.indexOf(x));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('NO SUCH TICKER: nothing close (XQZT), no line, no stones', () => {
  assert.equal(closeMatch('XQZT', { graves: GRAVES }), null);
  assert.equal(closeMatch('FOO BAR', { found: { commands: [{ name: 'WHY', cmd: 'WHY AAPL', summary: 'Why it moved' }] } }), null, 'a guess by meaning alone is not close');
  const p = page('XQZT', 'XQZT');
  assert.equal(p.enter, false);
  assert.deepEqual(p.status, ['NO SUCH TICKER. IPO IT, OR TYPE HELP', 'note']);
  assert.doesNotMatch(p.html, /card-alert|ns-dym|data-dym|data-enter|Did you mean/);
  assert.doesNotMatch(p.html, /gv-stone|ns-rip/, 'no random stones');
  assert.match(p.html, /<button type="button" class="btn card-btn btn-solid ns-ipo-btn" data-cmd="IPO IT XQZT" data-ipo data-key="1">IPO IT<\/button>/);
  assert.match(p.html, /<span class="nsc nsc-big" aria-hidden="true">\$XQZT<\/span>/);
  assert.match(p.html, /Issued 30 Sep 2026/);
  assert.match(p.html, /data-prefill="Please add: XQZT">Tell us\.<\/a>/);
  assert.match(page('XQZT', 'XQZT', {}, { grave: null, ipo: false }).status[0], /^NO SUCH TICKER\. TYPE HELP$/);
});

test('UNKNOWN COMMAND: the numbered panel; TRY ONE from START HERE; CLOSEST only when close', () => {
  const p = page('HIUHASBDAS', null, {}, { grave: null, ipo: false });
  assert.deepEqual(p.status, ['UNKNOWN COMMAND. TRY ONE ABOVE', 'note']);
  assert.equal(p.enter, false);
  const html = p.html;
  assert.match(html, /^<section class="panel panel-solo ns-unk">/);
  assert.match(html, /<h2 class="panel-label">1\) UNKNOWN COMMAND: HIUHASBDAS<\/h2>/);
  assert.match(html, /<kbd>Esc<\/kbd> back/);
  assert.match(html, /Not a command, a ticker or a company we know\./);
  assert.doesNotMatch(html, /Closest|data-enter/, 'nothing close: no CLOSEST');
  // TRY ONE: the registry's START HERE rows, in order, keys 1 to 5.
  const rows = [...html.matchAll(/<a class="ns-row" href="[^"]*" data-cmd="([^"]+)" data-key="(\d)"><span class="ns-cmd">[^<]+<\/span><span class="ns-what">([^<]+)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows.map((r) => r[0]), START_HERE.slice(0, 5).map(([c]) => c));
  assert.deepEqual(rows.map((r) => r[1]), ['1', '2', '3', '4', '5']);
  assert.deepEqual(tryRows(), START_HERE.slice(0, 5).map(([c, w]) => [c, `${w.charAt(0).toLowerCase()}${w.slice(1)}`]));
  assert.equal((html.match(/data-live=/g) || []).length, 1, 'the stock row (AAPL) alone holds a live price');
  assert.match(html, /data-cmd="MENU"><kbd>Ctrl K<\/kbd> every command<\/a> · <a [^>]*data-cmd="FEEDBACK" data-prefill="Please add: HIUHASBDAS">Tell us what you wanted<\/a>/);
  assert.doesNotMatch(html, /ns-cert|IPO IT|gv-stone/, 'not the certificate');
  // MARKTS: MARKETS is a typo away, the CLOSEST row, Enter.
  const found = { commands: [{ name: 'MARKETS', cmd: 'MARKETS', summary: 'World markets at a glance: indexes, futures' }] };
  const m = page('MARKTS', null, found, { grave: null, ipo: false });
  assert.equal(m.enter, true);
  assert.deepEqual(m.status, ['UNKNOWN COMMAND. ENTER OPENS MARKETS, OR TRY ONE ABOVE', 'note']);
  assert.match(m.html, /<h3 class="tag ns-h">Closest<\/h3><div class="ns-rows"><a class="ns-row" href="\?c=MARKETS" data-cmd="MARKETS" data-enter><span class="ns-cmd">MARKETS<\/span><span class="ns-what">world markets<\/span>/);
  assert.match(m.html, /<kbd class="ns-k">Enter<\/kbd>/);
  assert.equal(unknownHtml({ typed: 'x', rows: [] }).includes('class="ns-row"'), false);
  // MARKETS once: CLOSEST, not again in TRY ONE; the other rows keep keys 1 to 4, in order.
  assert.equal((m.html.match(/data-cmd="MARKETS"/g) || []).length, 1, 'MARKETS once');
  const tries = [...m.html.matchAll(/data-cmd="([^"]+)" data-key="(\d)"/g)].map((x) => `${x[2]}:${x[1]}`);
  assert.deepEqual(tries, START_HERE.slice(0, 5).map(([c]) => c).filter((c) => c !== 'MARKETS').map((c, i) => `${i + 1}:${c}`));
});

test('UNKNOWN COMMAND: plain words get the resolver\'s first guess as CLOSEST (Enter runs it)', async () => {
  const unknown = async (typed) => {
    const found = await resolveInput(typed, { search: async () => [], checkTicker: async () => false });
    return page(typed, null, found, { grave: null, ipo: false });
  };
  for (const [typed, cmd] of [['stock screener', 'SCREEN'], ['whats the fed doing', 'FEDPATH'], ['egg prices', 'EGGPRICE'], ['MARKTS', 'MARKETS']]) {
    const p = await unknown(typed);
    assert.equal(p.kind, 'unknown', typed);
    assert.equal(p.enter, true, typed);
    assert.deepEqual(p.status, [`UNKNOWN COMMAND. ENTER OPENS ${cmd}, OR TRY ONE ABOVE`, 'note'], typed);
    assert.match(p.html, new RegExp(`<h3 class="tag ns-h">Closest</h3><div class="ns-rows"><a class="ns-row" href="\\?c=${cmd}" data-cmd="${cmd}" data-enter>`), typed);
    assert.equal((p.html.match(new RegExp(`data-cmd="${cmd}"`, 'g')) || []).length, 1, `${typed}: ${cmd} once`);
  }
  const s = await unknown('stock screener');
  assert.match(s.html, /<span class="ns-cmd">SCREEN<\/span><span class="ns-what">find stocks by sector, size, price and move<\/span>/);
  // No guess at all: no CLOSEST, nothing on Enter.
  const none = await unknown('HIUHASBDAS');
  assert.equal(none.enter, false);
  assert.doesNotMatch(none.html, /Closest|data-enter/);
  // A guess from a word fragment ("foo" starts "food prices") is no CLOSEST: TRY ONE only.
  for (const typed of ['FOO BAR', 'foo prices']) {
    const found = await resolveInput(typed, { search: async () => [], checkTicker: async () => false });
    assert.equal(found.commands[0]?.name, 'EGGPRICE', `${typed}: the resolver guessed EGGPRICE`);
    const p = await unknown(typed);
    assert.equal(p.enter, false, typed);
    assert.deepEqual(p.status, ['UNKNOWN COMMAND. TRY ONE ABOVE', 'note'], typed);
    assert.doesNotMatch(p.html, /Closest|data-enter|EGGPRICE/, typed);
    assert.match(p.html, /<h3 class="tag ns-h">Try one<\/h3>/, typed);
  }
});

test('UNKNOWN COMMAND: the AAPL row shows its live price when it comes, nothing when it fails (never 0)', async () => {
  const ok = (body) => async () => ({ ok: true, json: async () => body });
  assert.deepEqual(await liveQuote('AAPL', { fetchImpl: ok({ quotes: [{ ticker: 'AAPL', last: 229.87, changePct: 1.23 }] }) }), { ticker: 'AAPL', last: 229.87, changePct: 1.23 });
  assert.equal(await liveQuote('AAPL', { fetchImpl: ok({ quotes: [{ ticker: 'AAPL', last: 0 }] }) }), null, 'a zero price: nothing');
  assert.equal(await liveQuote('AAPL', { fetchImpl: ok({ quotes: [] }) }), null);
  assert.equal(await liveQuote('AAPL', { fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await liveQuote('AAPL', { fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await liveQuote('AAPL', { fetchImpl: () => new Promise(() => {}), wait: 5 }), null, 'slow: nothing');
  assert.equal(liveHtml(null), '');
  assert.match(liveHtml({ last: 229.87, changePct: 1.23 }), /229\.87 <span class="up">\+1\.23%<\/span>/);
  assert.equal(liveHtml({ last: 229.87 }), '229.87', 'no change: the price alone');
});

test('keys and wiring: digits on every NOT FOUND page, Enter only with a line or CLOSEST, never on a stone card', () => {
  const added = [];
  const doc = { addEventListener: (t, h) => { added.push(h); }, removeEventListener: () => {}, getElementById: () => null };
  const el = { isConnected: true, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], querySelector: () => null, contains: () => false };
  wireNoSuch(el, 'XQZT', { grave: null }, { doc })();
  assert.equal(added.length, 1, 'the digit keys');
  wireNoSuch(el, 'LEHM', { grave: null }, { doc, enter: true })();
  assert.equal(added.length, 2);
  const leh = GRAVES.find((e) => e.ticker === 'LEH');
  assert.equal(noSuchExtra('LEH', { grave: leh }, { top: { cmd: 'X', id: 'X', name: 'X' } }).alert, undefined, 'a stone card has no line');
  assert.deepEqual(noSuchExtra(null, { grave: null }), {}, 'no word, no match: nothing');
  assert.deepEqual(Object.keys(noSuchExtra(null, { grave: null }, { top: closeMatch('LEHM', { graves: GRAVES }) })), ['alert'], 'a DESK panel: the line only');
  // app.js hands the words to showNotFound; the stone card keeps its warn line.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /cleanups\.push\(ns\.showNotFound\(view, \{ typed, word, found, ticker, info, graves, quote, embed, status: setStatus \}\)\);/);
  const stone = page('LEH', 'LEH', {}, { grave: leh });
  assert.deepEqual(stone.status, ['LEH: FILED FOR BANKRUPTCY', 'warn']);
  assert.equal(stone.enter, false);
  // showNotFound draws, sets the status line and wires (a DESK panel: nothing wired).
  const seen = [];
  const view = { innerHTML: '', ...el };
  const stop = showNotFound(view, { typed: 'XQZT', word: 'XQZT', ticker: 'XQZT', info: { grave: null, ipo: true }, graves: GRAVES, embed: true, status: (...a) => seen.push(a) });
  assert.match(view.innerHTML, /^<section class="card ns-card"/);
  assert.deepEqual(seen, [['NO SUCH TICKER. TYPE HELP', 'warn']]);
  assert.equal(typeof stop, 'function');
});

test('the NOT FOUND styles: the status line colour 2, the panel as tall as its lines', () => {
  const src = readFileSync(new URL('../public/screens/nosuch.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /yardPick|yardHtml|pickGraves|ns-mini/, 'no random stones, no small preview');
  const css = readFileSync(new URL('../public/screens/nosuch.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.ns-mini|\.ns-yard|\.nf-/);
  assert.match(css, /\.status-msg\[data-kind="note"\] \{ color: var\(--text-2\); \}/, 'app.js lookupFailed and NOT FOUND');
  assert.match(css, /html:not\(\.is-embed\) \.view > \.panel\.ns-unk \{ flex: 0 1 auto !important; min-height: 0; \}/, 'no void under the panel');
  const dym = css.slice(css.indexOf('/* The Did-you-mean line'));
  for (const m of dym.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(m[1]) >= 12, m[0]);
  assert.match(dym, /\.ns-card > \.card-alert \{ font-size: 14px;/, 'the line at 14 px');
  for (const m of css.matchAll(/font-size:\s*max\((\d+)px/g)) assert.ok(Number(m[1]) >= 11, m[0]);
  // The footer's two links look like links (link blue, like "Tell us."), no grey override.
  assert.match(css, /\.ns-unk-foot a \{ color: var\(--accent\); \}/);
  assert.doesNotMatch(css, /\.ns-unk-foot a:hover/);
  // The stamp sits along the bottom, under the serial (the ticker, date and serial stay clear).
  assert.match(css, /\.nsc-stamp \{\n\s*position: absolute; left: 54%; top: 84%; transform: translate\(-50%, -50%\) rotate\(-8deg\);/);
});

test('SHARE ON X · COPY LINK: a dot between the two, under the certificate', () => {
  const html = page('XQZT', 'XQZT').html;
  assert.match(html, /<p class="gv-share"><a class="card-link"[^>]*data-share="ipo" data-via="x">SHARE ON X<\/a><span class="gv-sep" aria-hidden="true">·<\/span><button type="button" class="card-link"[^>]*data-share="ipo" data-via="link">COPY LINK<\/button><\/p>/);
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
