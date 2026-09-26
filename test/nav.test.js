import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCommand, suggest, COMMANDS, FKEYS, FUNCTION_BAR, TICKER_FUNCTIONS, fkeyFor, isMenuKey, escGoesBack, screenTitle, urlFor, freshDot,
  keybarHtml, panelByNumber, panelNumberInput, freshOverdue,
} from '../public/app.js';
import {
  REGISTRY, LISTED, CATEGORIES, findCommand, byCategory, categoriesInUse, searchCommands, START_HERE, START_KEYS,
} from '../public/registry.js';
import { EXTRA } from '../public/commands.js';
import { COMPANY } from '../public/company.js';
import { MARKETS_EXTRA } from '../public/commands-markets.js';
import { resolveTopic, startHere } from '../public/screens/help.js';
import { parseTapeSwitch, tapeOn, setTapeOn, tapeItems, TAPE_ON_KEY } from '../public/tape.js';
import { menuItems } from '../public/menu.js';

// Every word the router handles by name: the command files, plus every
// `head === 'X'`, the SIMPLE set and FUNDAMENTALS in app.js.
function routedHeads() {
  const src = readFileSync('public/app.js', 'utf8');
  const heads = new Set([...src.matchAll(/head === '([A-Z0-9]+)'/g)].map((m) => m[1]));
  const simple = /const SIMPLE = new Set\(\[([^\]]*)\]\)/.exec(src)[1];
  for (const m of simple.matchAll(/'([A-Z]+)'/g)) heads.add(m[1]);
  const fund = /const FUNDAMENTALS = \{([^}]*)\}/.exec(src)[1];
  for (const m of fund.matchAll(/([A-Z]+):/g)) heads.add(m[1]);
  for (const c of [...EXTRA, ...COMPANY, ...MARKETS_EXTRA]) heads.add(c.name);
  return [...heads];
}

test('registry: every routed command has an entry', () => {
  const heads = routedHeads();
  for (const want of ['WORLD', 'CLOCK', 'MOVERS', 'HEATMAP', 'SECTORS', 'COMPARE', 'COMMODITIES', 'CRYPTO', 'PROFILE', 'HISTORY',
    'DIVIDENDS', 'NEWS', 'CURVE', 'BONDS', 'FXMATRIX', 'EARNINGS', 'CALENDAR', 'LOAN', 'COMPOUND', 'FINANCIALS', 'SCREEN', 'WATCH',
    'PORTFOLIO', 'DESK', 'WHATIF', 'BUY', 'CPI', 'RATES', 'FX', 'MARKETS', 'HOME', 'INSIDERS', 'OWNERS', 'FILINGS', 'SHORTS', 'BEATS',
    'VALUE', 'IPOS', 'SPLITS', 'EXDIV', 'OPTIONS', 'ECONOMY', 'FEDPATH', 'BREADTH', 'HELP', 'MENU', 'TAPE', 'CHART', 'WAGE', '420']) {
    assert.ok(heads.includes(want), `${want} is routed`);
  }
  for (const h of heads) assert.ok(findCommand(h), `${h} has a registry entry`);
  // The aliases the router knows are in the registry too.
  for (const a of ['PF', 'H', '?', 'M', 'WATCHLIST', 'INFLATION', 'SCREENER']) assert.ok(findCommand(a), a);
  assert.equal(findCommand('PF').name, 'PORTFOLIO');
});

test('registry: entries are complete, unique and in a known category', () => {
  const words = new Set();
  for (const c of REGISTRY) {
    for (const w of [c.name, ...(c.aliases || [])]) {
      assert.ok(!words.has(w), `${w} is used once`);
      words.add(w);
    }
    assert.ok(CATEGORIES.includes(c.category), `${c.name}: ${c.category}`);
    assert.ok(c.summary && c.syntax, `${c.name} has a summary and syntax`);
    assert.ok(Array.isArray(c.examples), c.name);
    if (!c.hidden) assert.ok(Array.isArray(c.keywords) && c.keywords.length, `${c.name} has search words`);
    if (!c.soon && !c.hidden) {
      assert.ok(c.examples.length, `${c.name} has an example`);
      assert.ok(c.source && c.delay, `${c.name} has a source and a delay`);
    }
  }
  assert.ok(categoriesInUse().includes('Start here'));
  assert.equal(categoriesInUse()[0], 'Start here');
  assert.ok(categoriesInUse().includes('Legal') && categoriesInUse().includes('Pro'));
});

test('registry: every example parses and runs its own command', () => {
  for (const c of LISTED) {
    for (const ex of c.examples) {
      const p = parseCommand(ex);
      assert.ok(!['UNKNOWN', 'SOON'].includes(p.name), `${ex} runs`);
      assert.equal(p.error, undefined, `${ex} parses`);
    }
  }
  for (const [c] of START_HERE) {
    assert.ok(!['UNKNOWN', 'SOON'].includes(parseCommand(c).name), c);
    assert.equal(parseCommand(c).error, undefined, c);
  }
  assert.equal(parseCommand('AAPL NEWS').name, 'TICKERNEWS');
});

test('registry feeds the command bar, the function bar and ticker-first grammar', () => {
  assert.deepEqual(FUNCTION_BAR, ['CHART', 'NEWS', 'FINANCIALS', 'PROFILE', 'HISTORY', 'DIVIDENDS', 'OPTIONS', 'INSIDERS', 'OWNERS', 'FILINGS', 'SHORTS', 'BEATS', 'VALUE']);
  for (const fn of ['CHART', 'NEWS', 'EARNINGS', 'COMPARE', 'WATCH', 'INSIDERS']) assert.ok(TICKER_FUNCTIONS.includes(fn), fn);
  assert.equal(parseCommand('AAPL EARNINGS').name, 'SOON');
  const names = COMMANDS.map((c) => c.name);
  assert.ok(!names.includes('420'), '420 stays hidden');
  assert.ok(!names.includes('<TICKER>') && !names.includes('ALERTS') && !names.includes('BUY'));
  assert.ok(names.includes('PRO') && names.includes('AFFORD') && names.includes('TERMS'));
  assert.deepEqual(names.slice(-2), ['HELP', 'MENU']);
  for (const c of COMMANDS) assert.equal(c.hint, findCommand(c.name).summary);
  assert.equal(suggest('4').length, 0);
  // Synonyms: YIELD finds the rate screens, after the symbols.
  const y = suggest('yield').map((s) => s.name);
  assert.ok(y.includes('RATES') || y.includes('CURVE') || y.includes('BONDS'), y.join());
  assert.deepEqual(suggest('go').map((s) => s.value), ['GOLD', 'GOLDFUT'], 'two letters: no synonym matches');
  assert.equal(suggest('CHART ')[0].usage, true);
  assert.ok(suggest('MEN').some((s) => s.name === 'MENU'));
});

test('HELP search: names, words and synonyms', () => {
  assert.equal(searchCommands('insider')[0].name, 'INSIDERS');
  const yieldNames = searchCommands('yield').map((c) => c.name);
  for (const n of ['CURVE', 'BONDS', 'RATES', 'DIVIDENDS']) assert.ok(yieldNames.includes(n), `yield: ${n}`);
  const div = searchCommands('dividend').map((c) => c.name);
  assert.ok(div.includes('DIVIDENDS') && div.includes('EXDIV'));
  assert.ok(searchCommands('dividends').some((c) => c.name === 'DIVIDENDS'));
  const earn = searchCommands('earnings').map((c) => c.name);
  assert.ok(earn.includes('EARNINGS') && earn.includes('BEATS'));
  assert.equal(searchCommands('fx')[0].name, 'FX');
  assert.equal(searchCommands('pf')[0].name, 'PORTFOLIO');
  assert.ok(searchCommands('mortgage').some((c) => c.name === 'LOAN'));
  assert.ok(searchCommands('bitcoin').some((c) => c.name === 'CRYPTO'));
  assert.deepEqual(searchCommands(''), []);
  assert.deepEqual(searchCommands('zzzz'), []);
  assert.ok(!searchCommands('funding').some((c) => c.name === '420'));
});

test('HELP <command>: detail, ticker or search', () => {
  assert.deepEqual(parseCommand('help').args, { topic: null });
  assert.deepEqual(parseCommand('help fx').args, { topic: 'FX' });
  assert.equal(parseCommand('? fx').name, 'HELP');
  assert.equal(resolveTopic('FX').entry.name, 'FX');
  assert.equal(resolveTopic('PF').entry.name, 'PORTFOLIO');
  const t = resolveTopic('AAPL');
  assert.equal(t.entry.name, '<TICKER>');
  assert.equal(t.ticker, 'AAPL');
  assert.equal(resolveTopic('NVDA INSIDERS').entry.name, 'INSIDERS');
  assert.equal(resolveTopic('short sellers').entry.name, 'SHORTS', 'a plain phrase finds its command');
  assert.deepEqual(resolveTopic('volume spike'), { query: 'volume spike' });
  assert.equal(resolveTopic('420').entry, undefined, '420 has no help page');
  assert.deepEqual(resolveTopic(null), {});
  assert.deepEqual(screenTitle(parseCommand('HELP FX')), { title: 'HELP FX', sub: 'How to use FX' });
});

test('MENU: a command and a launcher with the same data as HELP', () => {
  assert.equal(parseCommand('menu').name, 'MENU');
  const items = menuItems();
  assert.ok(items.length > 40);
  assert.ok(items.every((c) => !c.pattern && !c.soon && c.name !== 'MENU' && c.examples.length));
  for (const cat of categoriesInUse()) {
    if (cat === 'Pro') continue;
    assert.ok(byCategory(cat).some((c) => items.includes(c)) || cat === 'Start here', cat);
  }
});

function memStore() {
  const m = new Map();
  return { get: (k, f) => (m.has(k) ? m.get(k) : f), set: (k, v) => m.set(k, v) };
}

test('tape: off by default, TAPE ON and OFF, a screen of its own', () => {
  const store = memStore();
  assert.equal(tapeOn(store), false);
  setTapeOn(store, true);
  assert.equal(tapeOn(store), true);
  assert.equal(store.get(TAPE_ON_KEY), true);
  assert.notEqual(TAPE_ON_KEY, 'bb.tape', 'bb.tape is the Pro tape list');
  setTapeOn(store, false);
  assert.equal(tapeOn(store), false);
  assert.deepEqual(parseTapeSwitch(['ON']), { action: 'on' });
  assert.deepEqual(parseTapeSwitch(['OFF']), { action: 'off' });
  assert.equal(parseTapeSwitch([]), null);
  assert.equal(parseTapeSwitch(['ADD', 'AAPL']), null, 'ADD, REMOVE and RESET are Pro words (pro.js)');
  const on = parseCommand('tape on');
  assert.equal(on.name, 'TAPE');
  assert.deepEqual(on.args, { action: 'on' });
  assert.equal(urlFor('TAPE ON').url, 'TAPE', 'a setting: the URL shows the TAPE screen, not the switch');
  assert.equal(urlFor('TAPE ADD AAPL').url, 'TAPE');
  assert.deepEqual(parseCommand('TAPE').args, { action: 'show' });
  assert.equal(parseCommand('TAPE ADD AAPL').args.action, 'add');
  assert.equal(parseCommand('TAPE X').error, 'usage');
  assert.equal(suggest('TAPE X')[0].usage, true);
  assert.deepEqual(tapeItems({ instruments: [{ id: 'A', tape: true }, { id: 'B' }] }).map((q) => q.id), ['A']);
  assert.deepEqual(tapeItems(null), []);
  // The tape is not in the page by default and sits above the status line when on.
  const html = readFileSync('public/index.html', 'utf8');
  assert.match(html, /id="tape-bar" class="tape"[^>]*hidden/);
  assert.ok(html.indexOf('id="tape-bar"') < html.indexOf('class="statusline"'));
  assert.ok(html.indexOf('class="statusline"') < html.indexOf('id="keybar"'));
});

test('key bar: real F-keys, never F5, F11 or F12, five on a phone', () => {
  const keys = FKEYS.map((k) => k.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ['F5', 'F11', 'F12']) assert.ok(!keys.includes(k), k);
  assert.deepEqual(FKEYS.map((k) => `${k.key} ${k.label}`), [
    'F1 HELP', 'F2 HOME', 'F3 DESK', 'F4 MARKETS', 'F6 NEWS', 'F7 WATCH', 'F8 PORTFOLIO', 'F9 SCREEN', 'F10 WHATIF',
  ]);
  for (const k of FKEYS) {
    const p = parseCommand(k.cmd);
    assert.equal(p.name, findCommand(k.label).name, `${k.key} runs its label`);
    assert.equal(p.error, undefined);
  }
  assert.equal(FKEYS.filter((k) => k.mobile).length, 5);
  assert.equal(fkeyFor({ key: 'F3' }).cmd, 'DESK');
  assert.equal(fkeyFor({ key: 'F3', ctrlKey: true }), null);
  assert.equal(fkeyFor({ key: 'F5' }), null);
  assert.equal(fkeyFor({ key: 'a' }), null);
  assert.equal(isMenuKey({ key: 'k', ctrlKey: true }), true);
  assert.equal(isMenuKey({ key: 'K', metaKey: true }), true);
  assert.equal(isMenuKey({ key: 'k' }), false);
  assert.equal(isMenuKey({ key: 'k', ctrlKey: true, shiftKey: true }), false);
});

test('back: Esc goes back only when nothing else wants it', () => {
  assert.equal(escGoesBack({ depth: 1 }), true);
  assert.equal(escGoesBack({ depth: 0 }), false, 'nowhere to go back to');
  assert.equal(escGoesBack({ depth: 2, inputValue: 'AA' }), false, 'first Esc clears the bar');
  assert.equal(escGoesBack({ depth: 2, suggestOpen: true }), false, 'first Esc closes the list');
  assert.equal(escGoesBack({ depth: 2, menuOpen: true }), false, 'Esc closes the menu');
  assert.equal(escGoesBack(), false);
});

test('screen name: a title for the command bar label on every screen', () => {
  assert.deepEqual(screenTitle(parseCommand('AAPL')), { title: 'AAPL', sub: '' });
  assert.equal(screenTitle(parseCommand('AAPL NEWS')).sub, findCommand('NEWS').summary);
  assert.equal(screenTitle(parseCommand('MARKETS')).title, 'MARKETS');
  assert.equal(screenTitle(parseCommand('PF')).sub, findCommand('PORTFOLIO').summary);
  assert.equal(screenTitle(parseCommand('420')).sub, '');
  assert.equal(screenTitle(parseCommand('NOPE NOPE')).title, 'Unknown command');
  // No screen-head row: the name sits in the command bar, the star next to it.
  const html = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(html, /screenhead|screen-sub|screen-actions|id="back"/);
  const bar = /<div class="commandbar">[\s\S]*?<\/form>/.exec(html)[0];
  assert.ok(bar.indexOf('id="screen-title"') < bar.indexOf('class="prompt"'), 'the name is left of the prompt');
  assert.match(bar, /id="head-star"/, 'the watch star is in the label');
  assert.match(html, /id="status-legal"/, 'a slot for the legal line');
});

test('SHARE is in the key bar, right side, before MENU', () => {
  const html = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(html, /id="share"/, 'not in the page frame any more');
  const keys = keybarHtml();
  assert.equal(keys.match(/id="share"/g).length, 1);
  assert.ok(keys.indexOf('id="share"') > keys.indexOf('class="fkeys"'));
  assert.ok(keys.indexOf('id="share"') < keys.indexOf('id="menu-btn"'));
  assert.match(keys, />SHARE</);
});

test('panel numbers: the panel labelled "n)" is found, other screens have none', () => {
  const fakePanel = (text) => ({ querySelector: (sel) => (sel === '.panel-head > .panel-label' ? { textContent: text } : null) });
  const panels = ['1) MARKETS', '2) S&P 500', '3) NEWS'].map(fakePanel);
  const root = { querySelectorAll: (sel) => (sel === '.panel' ? panels : []) };
  for (const n of [1, 2, 3]) assert.equal(panelByNumber(root, String(n)), panels[n - 1]);
  assert.equal(panelByNumber(root, '4'), null);
  assert.equal(panelByNumber({ querySelectorAll: () => [fakePanel('10) X')] }, '1'), null, '10) is not 1)');
});

test('panel numbers: a number and Enter opens a panel; digits typed as a command stay a command', () => {
  assert.equal(panelNumberInput('3'), 3, '3 Enter on HOME');
  assert.equal(panelNumberInput('12'), 12, '12 Enter (a screen with 12 panels)');
  for (const c of ['3988.HK', '1810.HK', 'CPI 100 2000', '0', '123', '3 5', 'AAPL', '']) assert.equal(panelNumberInput(c), null, c);
  // 3 Enter on HOME finds NEWS; 2 Enter the S&P 500 chart.
  const fakePanel = (text) => ({ querySelector: () => ({ textContent: text }) });
  const home = ['1) MARKETS', '2) S&P 500', '3) NEWS'].map(fakePanel);
  assert.equal(panelByNumber({ querySelectorAll: () => home }, String(panelNumberInput('3'))), home[2]);
  assert.equal(panelByNumber({ querySelectorAll: () => home }, String(panelNumberInput('2'))), home[1]);
  // 3988.HK typed on HOME or MARKETS: no digit is taken on keydown off a stock screen, and
  // Enter runs it as a command (the resolver), not as panel 3.
  const src = readFileSync('public/app.js', 'utf8');
  assert.doesNotMatch(src, /maximize\(e\.key\)/, 'no panel on a bare digit keydown');
  assert.match(src, /\(embed \|\| !tickerBar\.hidden\)/, 'instant 1-9 only with the stock function bar');
  assert.match(src, /typed && !embed && tickerBar\.hidden \? panelNumberInput\(clean\)/);
  assert.equal(parseCommand('3988.HK').input, '3988.HK');
});

test('freshness: the dot goes stale when updates stop', () => {
  const at = Date.parse('2026-09-25T16:00:00Z');
  assert.equal(freshOverdue({ at, every: 15_000 }, at + 30_000), false, 'within a minute');
  assert.equal(freshOverdue({ at, every: 15_000 }, at + 61_000), true, 'a minute with no 15-second update');
  assert.equal(freshOverdue({ at, every: 300_000 }, at + 500_000), false, 'news: 5 minutes apart');
  assert.equal(freshOverdue({ at, every: 300_000 }, at + 601_000), true);
  assert.equal(freshOverdue({ at, every: 0 }, at + 3_600_000), false, 'a screen that loads once');
});

test('freshness: a dot by the clock, the time in its tooltip; the status line keeps messages', () => {
  assert.deepEqual(freshDot('2026-09-25T16:00:00Z', false), { state: 'fresh', title: 'Updated 12:00:00 ET' });
  assert.deepEqual(freshDot('2026-09-25T16:00:00Z', true), { state: 'stale', title: 'Last known data 12:00:00 ET' });
  const html = readFileSync('public/index.html', 'utf8');
  const clock = /<div class="clock"[\s\S]*?<\/div>/.exec(html)[0];
  assert.match(clock, /id="fresh-dot"/);
  const line = /<div class="statusline"[\s\S]*?<\/div>/.exec(html)[0];
  assert.match(line, /<span id="status-legal" class="status-legal"><span class="legal-line">Not advice<\/span>.*<a href="\/terms">Terms<\/a>/);
  assert.doesNotMatch(line, /UPDATED|Information only/);
  assert.doesNotMatch(readFileSync('public/screens/help.js', 'utf8'), /PICK A CATEGORY/, 'no permanent hint in the status line');
});

test('HELP start here: one plain list, no cards, one line of keys', () => {
  const html = startHere();
  assert.doesNotMatch(html, /hs-card|hs-try|hs-rule|hs-n\b|How it works|Try these first|Help and navigation/);
  assert.equal((html.match(/class="hs-row"/g) || []).length, START_HERE.length);
  assert.ok(START_HERE.length >= 15 && START_HERE.length <= 20);
  for (const [c] of START_HERE) assert.match(html, new RegExp(`data-cmd="${c}"`));
  for (const c of ['AAPL', 'AAPL NEWS', 'MARKETS', 'NEWS', 'RATES', 'HEATMAP', 'SCREEN', 'WATCH', 'PORTFOLIO', 'DESK', 'WHATIF', 'MENU']) {
    assert.ok(START_HERE.some(([x]) => x === c), c);
  }
  assert.equal((html.match(/class="hs-keys"/g) || []).length, 1);
  assert.deepEqual(START_KEYS.map(([k]) => k), ['Enter', 'Tab', 'Esc', 'Ctrl K', '/', '1-9', 'number Enter', 'F1-F10']);
});

test('copy rules for the navigation files', () => {
  const files = ['public/registry.js', 'public/menu.js', 'public/tape.js', 'public/nav.css', 'public/screens/help.js', 'public/screens/tape.js', 'public/index.html', 'public/app.js'];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /amber|#ffb|hsl\((3\d|4\d|5\d),/i, `${f}: amber`);
  }
});
