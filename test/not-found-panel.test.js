// NOT A TICKER: the numbered panel that replaced NO SUCH TICKER. YET. (screens/nosuch.js
// notFound), and company names in the command bar (APPLE is AAPL, LEHMAN is its stone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCommand, tickerToCheck } from '../public/app.js';
import { resolveInput } from '../public/resolve.js';
import { tickerForName } from '../public/known-tickers.js';
import {
  closeness, candidates, closestRows, graveByName, notFoundHtml, notFoundStatus, notFoundKeys, fillPrices, liveText, shortName, noSuchExtra,
} from '../public/screens/nosuch.js';
import { loadGraveyard } from '../lib/og-nosuch.js';

const GRAVES = loadGraveyard();
const THLM = { id: 'THLM', name: 'TH Lehman & Co Inc', cmd: 'THLM' };
const rowsFor = (typed, found = {}) => closestRows(typed, candidates({ found, graves: GRAVES }));
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
  // app.js: the stone opens as GRAVEYARD <ticker> in the address bar; the server's own
  // word check (/api/nosuch) is the fallback when the list did not load.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const stone = ns\?\.graveByName\(typed, graves\) \|\| \(info\.grave && info\.grave\.ticker !== word \? info\.grave : null\);/);
  assert.match(app, /const c = `GRAVEYARD \$\{stone\.ticker\}`;\s*replaceUrl\(c\);\s*render\(c, \{ checked: true/);
});

// ---- The panel -----------------------------------------------------------------------------

const LEHM_ROWS = rowsFor('LEHM', { symbols: [THLM] });

test('the panel: a numbered strip, CLOSEST with the hero row and digits, OR with IPO and HELP', () => {
  const html = notFoundHtml({ typed: 'LEHM', rows: LEHM_ROWS, ipo: 'LEHM' });
  assert.match(html, /^<div class="nf"><section class="panel panel-solo nf-panel">/);
  assert.match(html, /<h2 class="panel-label">1\) NOT A TICKER: LEHM<\/h2><span class="panel-meta"><a class="nf-back" href="\?c=HOME" data-cmd="HOME" data-back><kbd>Esc<\/kbd> BACK<\/a><\/span>/);
  assert.match(html, /<p class="tag nf-kick">Closest<\/p><a class="nf-row nf-hero" href="\?c=GRAVEYARD\+LEH" data-cmd="GRAVEYARD LEH" data-key="1"><span class="nf-name">Lehman Brothers<\/span><span class="nf-meta"><span class="nf-dot" aria-hidden="true">·<\/span><span class="nf-tk">LEH<\/span><span class="nf-dot" aria-hidden="true">·<\/span><span class="nf-what">graveyard · filed 2008<\/span><\/span><kbd class="nf-key">Enter<\/kbd><\/a>/);
  assert.match(html, /data-cmd="THLM" data-key="2"><span class="nf-name">TH Lehman &amp; Co<\/span>[\s\S]*?<span class="nf-tk">THLM<\/span>[\s\S]*?<span class="nf-what" data-price="THLM">live<\/span><\/span><kbd class="nf-key">2<\/kbd>/);
  const or = html.split('<p class="tag nf-kick">Or</p>')[1];
  assert.match(or, /data-cmd="IPO IT LEHM" data-key="3" data-ipo><span class="nf-name">IPO LEHM<\/span>[\s\S]*?a certificate for a stock that does not exist[\s\S]*?<kbd class="nf-key">3<\/kbd>/);
  assert.match(or, /data-cmd="HELP" data-key="4"><span class="nf-name">HELP<\/span>[\s\S]*?every command[\s\S]*?<kbd class="nf-key">4<\/kbd>/);
  assert.equal((html.match(/class="nf-row nf-hero"/g) || []).length, 1, 'one hero row');
  assert.equal((html.match(/<kbd class="nf-key">Enter<\/kbd>/g) || []).length, 1);
  // Without IPO IT (a word it cannot list): HELP takes the next number.
  assert.match(notFoundHtml({ typed: 'LEHM', rows: LEHM_ROWS, ipo: null }), /data-cmd="HELP" data-key="3"/);
  // More than one word: NOT FOUND, never IPO.
  assert.match(notFoundHtml({ typed: 'lehman  brotherz', rows: LEHM_ROWS.slice(0, 1) }), /1\) NOT FOUND: LEHMAN BROTHERZ/);
  assert.doesNotMatch(notFoundHtml({ typed: '<b>', rows: [] }), /<b>/, 'escaped');
});

test('the matched state never shows the certificate, nor the old NO SUCH pieces', () => {
  const html = notFoundHtml({ typed: 'LEHM', rows: LEHM_ROWS, ipo: 'LEHM' });
  for (const gone of [/certificate\.webp/, /ns-mini/, /NOT A REAL SECURITY/, /ns-mini-stone/, /No such ticker/i, /Be the first/, /card-hero/, /\$LEHM/, /btn-solid/, /Nothing close/]) {
    assert.doesNotMatch(html, gone, String(gone));
  }
});

test('nothing close: the panel flips to the certificate, SHARE, Tell us and HELP', () => {
  const html = notFoundHtml({ typed: 'XQZT', rows: [], ipo: 'XQZT' });
  const body = html.split('<div class="panel-body ">')[1];
  assert.match(html, /1\) NOT A TICKER: XQZT/);
  // In order: Nothing close., the certificate with the word and its stamp, Nobody has listed it., SHARE, Tell us . HELP.
  const order = ['Nothing close.', 'certificate.webp', '$XQZT</span>', 'NOT A REAL SECURITY', 'Nobody has listed it.', '>SHARE</a>', 'Tell us.', '>HELP</a>'].map((s) => body.indexOf(s));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in this order');
  // One white action: SHARE, the IPO certificate's own share (the X post, counted as ipo_shared).
  assert.equal((html.match(/btn-solid/g) || []).length, 1);
  assert.match(html, /<a class="btn card-btn btn-solid" href="https:\/\/x\.com\/intent\/post\?text=I\+listed\+%24XQZT[^"]*" target="_blank" rel="noopener noreferrer" data-share="ipo" data-via="x">SHARE<\/a>/);
  assert.match(html, /Want it on Bloombroke\? <a href="\?c=FEEDBACK" data-cmd="FEEDBACK" data-prefill="Please add: XQZT">Tell us\.<\/a><\/span> <span class="nf-dot" aria-hidden="true">·<\/span> <a href="\?c=HELP" data-cmd="HELP">HELP<\/a>/);
  assert.doesNotMatch(html, /nf-row|Be the first|No such ticker/i, 'no rows, no old title');
  // A word IPO IT cannot list (too long, refused): no certificate, no SHARE.
  const plain = notFoundHtml({ typed: 'ZORBLAT', rows: [], ipo: null });
  assert.match(plain, /Nothing close\.[\s\S]*Check the spelling\.[\s\S]*Tell us\.[\s\S]*>HELP<\/a>/);
  assert.doesNotMatch(plain, /certificate|btn-solid|Nobody has listed it/);
});

test('the status line: says what Enter does, in the second text colour (never the loss red)', () => {
  assert.deepEqual(notFoundStatus('LEHM', LEHM_ROWS), ['Not a ticker. Enter opens the closest.', 'note']);
  assert.deepEqual(notFoundStatus('XQZT', []), ['Not a ticker. Nothing close.', 'note']);
  assert.deepEqual(notFoundStatus('FOO BAR', LEHM_ROWS), ['Not found. Enter opens the closest.', 'note']);
  const css = readFileSync(new URL('../public/screens/nosuch.css', import.meta.url), 'utf8');
  assert.match(css, /\.status-msg\[data-kind="note"\] \{ color: var\(--text-2\); \}/);
  const src = readFileSync(new URL('../public/screens/nosuch.js', import.meta.url), 'utf8');
  assert.match(src, /status\(\.\.\.notFoundStatus\(words, rows\)\);/);
  assert.doesNotMatch(src.slice(src.indexOf('export function notFound('), src.indexOf('// ---- IPO IT')), /'warn'/);
});

test('keys: Enter opens the closest, a digit its row; typing, a focused link and an open list keep their keys', () => {
  let handler = null;
  let list = { hidden: true };
  const doc = { addEventListener: (t, h, cap) => { assert.equal(cap, true); handler = h; }, removeEventListener: () => { handler = null; }, getElementById: (id) => (id === 'suggest' ? list : null) };
  const clicked = [];
  const el = { isConnected: true, querySelector: (sel) => { const m = /\[data-key="(\d)"\]/.exec(sel); return m && Number(m[1]) <= 4 ? { click: () => clicked.push(m[1]) } : null; } };
  const stop = notFoundKeys(el, { doc });
  const press = (key, target, extra = {}) => { const e = { key, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; handler(e); return e.defaultPrevented; };
  const bar = (value = '') => ({ id: 'cmd', value });
  const page = { closest: () => null };
  assert.equal(press('Enter', bar()), true);
  assert.equal(press('2', bar()), true);
  assert.equal(press('4', page), true);
  assert.deepEqual(clicked, ['1', '2', '4']);
  assert.equal(press('9', bar()), false, 'no row 9');
  assert.equal(press('3', bar('A')), false, 'typing A3 stays typing');
  assert.equal(press('Enter', bar('AAPL')), false, 'Enter runs what is typed');
  assert.equal(press('Enter', { closest: (s) => (/\ba\b/.test(s) ? {} : null) }), false, 'a focused link opens itself');
  assert.equal(press('1', { closest: (s) => (/input/.test(s) ? {} : null) }), false, 'another field');
  assert.equal(press('Enter', bar(), { ctrlKey: true }), false);
  list = { hidden: false };
  assert.equal(press('Enter', bar()), false, 'the suggestion list is open: its own pick');
  assert.deepEqual(clicked, ['1', '2', '4']);
  stop();
  assert.equal(handler, null);
  // The rows carry the keys: 1 (Enter) for the hero, then 2, 3... (app.js "2 Enter" works too).
  const html = notFoundHtml({ typed: 'LEHM', rows: LEHM_ROWS, ipo: 'LEHM' });
  assert.deepEqual([...html.matchAll(/data-key="(\d)"/g)].map((m) => m[1]), ['1', '2', '3', '4']);
});

test('live rows: price and change fill in from one quotes call; "live" stays when it fails', async () => {
  assert.equal(liveText(null), 'live');
  assert.match(liveText({ last: 331.74, changePct: -1.97 }), /^live 331\.74 \S1\.97%$/);
  assert.equal(liveText({ last: 4154.99, changePct: 1.2, decimals: 2 }), 'live 4,154.99 +1.20%');
  const cells = [{ dataset: { price: 'AAPL' }, isConnected: true, textContent: 'live' }, { dataset: { price: 'THLM' }, isConnected: true, textContent: 'live' }];
  const el = { querySelectorAll: () => cells };
  let asked = '';
  await fillPrices(el, { fetchImpl: async (url) => { asked = url; return { ok: true, json: async () => ({ quotes: [{ ticker: 'AAPL', last: 200, changePct: 1 }] }) }; } });
  assert.equal(asked, '/api/quotes?s=AAPL%2CTHLM');
  assert.equal(cells[0].textContent, 'live 200.00 +1.00%');
  assert.equal(cells[1].textContent, 'live', 'no quote: live');
  await fillPrices(el, { fetchImpl: async () => { throw new Error('offline'); } });
});

test('a dead ticker typed on its own keeps its stone card; other words get nothing from noSuchExtra', () => {
  const leh = GRAVES.find((e) => e.ticker === 'LEH');
  assert.match(JSON.stringify(noSuchExtra('LEH', { grave: leh })), /No such ticker\. Not anymore\./);
  assert.deepEqual(noSuchExtra('MAXX', { grave: null, ipo: true }), {});
  const css = readFileSync(new URL('../public/screens/nosuch.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /ns-yard|ns-mini-stone|ns-media/, 'the stone tiles and the old media slot are gone');
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

test('command bar: graveyard names, typos and ambiguous words are not resolved (they reach the panel)', async () => {
  for (const typed of ['LEHMAN', 'LEHMAN BROTHERS', 'BLOCKBUSTER', 'ENRON', 'APPLEE', 'LEHM', 'XQZT']) {
    const r = await resolveInput(typed, { search: async () => [], checkTicker: async () => false });
    assert.equal(r.confident, false, typed);
  }
  const amer = await resolveInput('AMERICAN', {
    search: async () => [{ id: 'AXP', name: 'American Express Company', kind: 'stock' }, { id: 'AAL', name: 'American Airlines Group Inc.', kind: 'stock' }],
    checkTicker: async () => false,
  });
  assert.equal(amer.confident, false, 'two strong names: pick one on the panel');
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
