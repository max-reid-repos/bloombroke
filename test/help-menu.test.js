// HELP and the MENU (Ctrl K). HELP: a numbered strip, a search box on top, categories
// on the left (START HERE first), one category on the right in three columns. START HERE
// opens with the key row, then five commands, the $ line, the screens and WHATIS. MENU:
// the same groups in five fixed columns, names only; the picked command's line shows in
// the footer; a find lists its matches with their lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandGroups, START_HERE, START_GROUP, CATEGORIES, findCommand, byCategory, categoriesInUse, LISTED, searchCommands } from '../public/registry.js';
import { keyRow, startHere, categoryHtml, helpCategories, DOLLAR_LINE, HELP_GROUPS, helpStrip, helpPlaceholder, commandRow, syntaxParts, COLUMN_HEADS } from '../public/screens/help.js';
import { menuGroupsHtml, menuFoundHtml, menuFootHtml, MENU_FOOT, menuItems, MENU_COLUMNS } from '../public/menu.js';
import { COMMANDS, FKEYS } from '../public/app.js';

// [[group, [cmd, ...]], ...] from MENU HTML: data-group sections, data-cmd rows.
function groupsOf(html, rowClass) {
  const out = [];
  for (const m of html.matchAll(/data-group="([^"]+)"([\s\S]*?)(?=data-group="|$)/g)) {
    const cmds = [...m[2].matchAll(new RegExp(`class="${rowClass}" href="[^"]*" data-cmd="([^"]+)"`, 'g'))].map((x) => x[1]);
    out.push([m[1], cmds]);
  }
  return out;
}
const helpSrc = () => readFileSync('public/screens/help.js', 'utf8');
const navCss = () => readFileSync('public/nav.css', 'utf8');

test('HELP: START HERE opens with the key row, one line, in this order', () => {
  const html = startHere();
  assert.ok(html.trimStart().startsWith('<p class="help-keys">'), 'the key row is the first thing in START HERE');
  const text = keyRow().replace(/<span class="hk-sep"[^>]*>&middot;<\/span>/g, ' · ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(text, 'Enter run · Tab complete · Esc back · Ctrl K menu · / search · F1-F10 screens · 1-9 the numbered thing on screen');
  assert.equal((keyRow().match(/<kbd>/g) || []).length, 7, 'every key an outlined badge');
  assert.match(readFileSync('public/screens/help.css', 'utf8'), /\.help-keys \{[^}]*font-size: 14px/);
  assert.ok(categoryHtml(START_GROUP).indexOf('help-keys') < categoryHtml(START_GROUP).indexOf('hl-row'), 'keys above the five');
});

test('HELP: START HERE is five commands, in order, then the $ line (not "$ + ticker")', () => {
  assert.deepEqual(START_HERE.map(([c]) => c), ['AAPL', 'MARKETS', 'NEWS', 'WHATIF IPHONE6', 'GUESS']);
  const html = startHere();
  assert.deepEqual([...html.matchAll(/class="hl-name" href="[^"]*" data-cmd="([^"]+)"/g)].map((m) => m[1]), START_HERE.map(([c]) => c));
  assert.match(html, /\$ before a ticker always means the stock, e\.g\. <a class="code"[^>]*>\$GOLD<\/a>\./);
  assert.ok(html.includes(DOLLAR_LINE));
  assert.doesNotMatch(html, /\$ \+ ticker|hs-row|hs-list/, 'the old 18-row grid is gone');
  assert.ok(html.indexOf('hl-row') < html.indexOf('$ before'), 'the $ line comes after the five');
});

test('HELP: a search box on top, categories on the left, START HERE first and the default', () => {
  const src = helpSrc();
  assert.match(src, /<div class="help-search">[\s\S]*?<input class="help-q"/, 'the search box (app.js puts a stock hint in .help-search)');
  assert.match(src, /<nav class="help-cats"/);
  assert.match(src, /store\.get\(CAT_KEY, START_GROUP\)/, 'START HERE opens first');
  assert.match(src, /document\.addEventListener\('keydown', onSlash, true\)/, '/ focuses the search box');
  assert.equal(helpCategories()[0], START_GROUP);
  assert.deepEqual(HELP_GROUPS, [START_GROUP, ...CATEGORIES]);
  const css = navCss();
  assert.match(css, /\.help-search \{[^}]*height: 44px/);
  assert.match(css, /\.menu-q, \.help-q \{/);
});

test('HELP: every category and every command in the registry is in the left list', () => {
  assert.deepEqual(helpCategories(), [START_GROUP, ...CATEGORIES.filter((c) => byCategory(c).length)]);
  assert.deepEqual(helpCategories().slice(1), categoriesInUse());
  for (const cat of ['News and info', 'About', 'Economy and calendars', 'Weird data', 'Pro']) assert.ok(helpCategories().includes(cat), cat);
  assert.ok(!helpCategories().includes('Legal'));
  const shown = (cat) => [...categoryHtml(cat).matchAll(/class="hc-name" href="[^"]*" data-cmd="HELP ([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(shown('News and info'), ['NEWS', 'WHATIS', 'MCP', 'HELP', 'MENU', 'EMBED']);
  assert.deepEqual(shown('About'), ['FEEDBACK', 'DATA', 'STATUS', 'CHANGES', 'SPONSOR', 'BBRK', 'TERMS', 'PRIVACY', 'DISCLAIMER']);
  assert.ok(shown('Economy and calendars').includes('HOLIDAYS'));
  // Every listed command (bar patterns, which HELP opens as HELP AAPL) is under its category.
  const all = helpCategories().slice(1).flatMap(shown);
  for (const c of LISTED.filter((x) => !x.pattern)) assert.ok(all.includes(c.name), c.name);
  for (const c of menuItems()) assert.ok(all.includes(c.name), `${c.name} from the menu`);
});

test('HELP and MENU: the same groups, START HERE first', () => {
  const menu = groupsOf(menuGroupsHtml(), 'mn-item');
  assert.deepEqual(menu.map(([g]) => g).sort(), [...helpCategories()].sort());
  assert.deepEqual(menu[0][1], START_HERE.map(([c]) => c));
  const inGroups = menu.slice(1).flatMap(([, cmds]) => cmds);
  assert.equal(inGroups.length, menuItems().length);
  assert.equal(new Set(inGroups).size, inGroups.length);
});

test('MENU groups: NEWS in News and info, BBRK in About, no Legal, MCP not first', () => {
  const groups = Object.fromEntries(commandGroups().map((g) => [g.name, g.items.map((it) => it.name)]));
  assert.ok(!groups.Markets.includes('NEWS') && !groups.Markets.includes('BBRK'));
  assert.ok(groups['News and info'].includes('NEWS'));
  assert.deepEqual(groups.About, ['FEEDBACK', 'DATA', 'STATUS', 'CHANGES', 'SPONSOR', 'BBRK', 'TERMS', 'PRIVACY', 'DISCLAIMER']);
  assert.ok(!('Legal' in groups));
  assert.equal(findCommand('TERMS').category, 'About');
  assert.notEqual(commandGroups()[0].items[0].name, 'MCP');
  assert.equal(commandGroups()[0].items[0].name, 'AAPL');
  assert.deepEqual(COMMANDS.slice(-2).map((c) => c.name), ['HELP', 'MENU'], 'HELP and MENU still come last in the bar');
  assert.match(menuGroupsHtml(), /^<div class="mn-grid"><div class="mn-col"><section class="mn-cat" data-group="Start here">/);
});

test('MENU columns: names only, each line waits for the footer', () => {
  const html = menuGroupsHtml();
  assert.doesNotMatch(html, /mn-sum/, 'no descriptions in the columns');
  for (const g of commandGroups()) {
    for (const it of g.items) assert.ok(html.includes(`data-cmd="${it.cmd.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}" data-sum="${it.summary.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}"`), it.name);
  }
});

test('MENU footer: the picked command and its line; nothing picked keeps the HELP line', () => {
  assert.equal(menuFootHtml('', ''), MENU_FOOT);
  assert.match(MENU_FOOT, /HELP<\/a> has the syntax and examples for every command\./);
  assert.equal(menuFootHtml('CPI', 'Inflation & you'), '<span class="mn-foot-name">CPI</span> Inflation &amp; you');
  const src = readFileSync('public/menu.js', 'utf8');
  assert.match(src, /function mark\(\) \{[\s\S]*?foot\(list\[active\] \|\| null\);/, 'arrow keys update the footer');
  assert.match(src, /active = -1;\s*foot\(null\);/, 'a new paint resets it');
});

test('MENU find: the short list shows each line', () => {
  const found = searchCommands('yield', menuItems());
  const html = menuFoundHtml(found);
  assert.equal((html.match(/class="mn-sum"/g) || []).length, found.length);
  assert.ok(html.startsWith('<ul class="mn-list mn-found">'));
  assert.doesNotMatch(html, /data-sum=/);
});

test('MENU fits one screen: 20px rows in five fixed columns, a fixed search bar, less chrome on a short window', () => {
  const css = navCss();
  assert.match(css, /\.menu-search \{\s*flex: none;/, 'the search bar never shrinks');
  assert.match(css, /\.menu-search \{[^}]*height: 48px/);
  assert.match(css, /\.menu-foot \{\s*flex: none;/);
  assert.match(css, /\.mn-grid \{ display: grid; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/, 'a grid of five columns');
  assert.doesNotMatch(css, /\.mn-grid \{[^}]*columns: \d/, 'no multi-column flow (it split a category)');
  assert.match(css, /\.mn-grid \.mn-item \{[^}]*padding: 0 8px; line-height: 20px;/, '20px rows');
  assert.match(css, /@media \(min-width: 640px\) and \(max-height: 760px\) \{\s*\.menu-overlay \{ padding-top: 8px;[^}]*\}\s*\.menu \{ max-height: calc\(100vh - 16px\); \}/, 'a short window: less room above');
  assert.match(css, /@media \(min-width: 640px\) and \(max-height: 660px\) \{\s*\.mn-grid \.mn-item \{ line-height: 19px; \}/, 'shorter still: 19px rows');
  assert.match(css, /@media \(max-width: 639px\) \{[\s\S]*?\.mn-grid \{ display: block; \}/, 'a phone: one scrolling column');
  assert.match(css, /\.mn-found \.mn-sum \{[^}]*white-space: normal/);
});

test('MENU: five fixed columns, each category whole in one column', () => {
  assert.equal(MENU_COLUMNS.length, 5);
  assert.deepEqual(MENU_COLUMNS, [
    ['Start here', 'Markets', 'News and info'],
    ['Stocks and companies', 'Charts', 'Money tools'],
    ['Weird data'],
    ['Your stuff', 'Rates, FX, crypto', 'Economy and calendars'],
    ['Pro', 'About'],
  ]);
  assert.deepEqual(MENU_COLUMNS.flat().sort(), [...helpCategories()].sort(), 'every group in exactly one column');
  const html = menuGroupsHtml();
  const cols = html.split('<div class="mn-col">').slice(1);
  assert.equal(cols.length, 5);
  const heads = cols.map((c) => [...c.matchAll(/data-group="([^"]+)"/g)].map((m) => m[1].replace(/&#39;/g, "'")));
  assert.deepEqual(heads, MENU_COLUMNS, 'each column holds its categories, in order');
  // No split: every row of a group sits under its own header, in one column.
  const groups = commandGroups();
  for (const [i, names] of MENU_COLUMNS.entries()) {
    for (const n of names) for (const it of groups.find((g) => g.name === n).items) assert.ok(cols[i].includes(`data-cmd="${it.cmd.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}"`), `${it.name} in column ${i + 1}`);
  }
  const src = readFileSync('public/menu.js', 'utf8');
  assert.match(src, /e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowRight'/, 'Left and Right move across the columns');
});

test('HELP: 12 entries on the left, every listed command in exactly one category', () => {
  assert.deepEqual(helpCategories(), ['Start here', 'Markets', 'News and info', 'Stocks and companies', 'Weird data', 'Charts', 'Money tools',
    'Your stuff', 'Rates, FX, crypto', 'Economy and calendars', 'Pro', 'About']);
  assert.equal(helpCategories().length, 12);
  for (const cat of helpCategories().slice(1)) assert.ok(byCategory(cat).length > 2, `${cat} has more than 2 commands`);
  for (const c of LISTED) assert.equal(helpCategories().slice(1).filter((cat) => byCategory(cat).includes(c)).length, 1, c.name);
  assert.equal(findCommand('SCREEN').category, 'Stocks and companies');
  assert.deepEqual(byCategory('Rates, FX, crypto').map((c) => c.name), ['RATES', 'CURVE', 'BONDS', 'FEDPATH', 'FX', 'FXMATRIX', 'CRYPTO', 'COMMODITIES']);
});

test('HELP: a numbered strip on top, its count the real commands (not the <TICKER> pattern rows)', () => {
  const strip = helpStrip();
  assert.match(strip, /^<header class="panel-head help-strip"><h2 class="panel-label">1\) HELP<\/h2><span class="panel-meta">(\d+) COMMANDS · Esc back<\/span><\/header>$/);
  const n = Number(/(\d+) COMMANDS/.exec(strip)[1]);
  const patterns = LISTED.filter((c) => c.pattern);
  assert.deepEqual(patterns.map((c) => c.name), ['<TICKER>', '<TICKER> <FUNCTION>']);
  assert.equal(n, LISTED.length - 2);
  assert.equal(n, helpCategories().slice(1).reduce((t, cat) => t + byCategory(cat).length, 0) - patterns.length, 'the sum of the counts on the left, less the two pattern rows');
  const src = helpSrc();
  assert.ok(src.indexOf('${helpStrip()}') < src.indexOf('<div class="help-search">'), 'the strip is above the search');
  // The hint: "/" and three words on a wide screen; a phone (under 640 px) has no "/" key and less room.
  assert.equal(helpPlaceholder(false), '/ search: insider, yield, dividend');
  assert.equal(helpPlaceholder(true), 'search: insider, yield');
  assert.match(src, /placeholder="\$\{helpPlaceholder\(typeof matchMedia === 'function' && matchMedia\('\(max-width: 639px\)'\)\.matches\)\}"/);
});

test('search (HELP and Ctrl K): a command is found by its own words, never by its category', () => {
  const names = (q, list) => searchCommands(q, list).map((c) => c.name);
  for (const list of [undefined, menuItems()]) {
    const crypto = names('crypto', list);
    assert.equal(crypto[0], 'CRYPTO');
    for (const c of ['RATES', 'CURVE', 'BONDS', 'FEDPATH', 'FX', 'FXMATRIX', 'COMMODITIES']) assert.ok(!crypto.includes(c), `crypto: not ${c}`);
    const fx = names('fx', list);
    assert.deepEqual(fx.slice(0, 2), ['FX', 'FXMATRIX']);
    assert.ok(!fx.includes('CRYPTO') && !fx.includes('COMMODITIES'), fx.join(' '));
    const rates = names('rates', list);
    assert.equal(rates[0], 'RATES');
    for (const c of ['CURVE', 'BONDS', 'FEDPATH', 'FXMATRIX']) assert.ok(rates.includes(c), `rates: ${c}`);
    assert.ok(!rates.includes('CRYPTO') && !rates.includes('COMMODITIES'), rates.join(' '));
  }
  // The category words still find the commands that are about them.
  const weird = names('weird');
  assert.equal(weird[0], 'WEIRD');
  for (const c of ['CANAL', 'PIZZA', 'EGGPRICE', 'GRAVEYARD', 'FISHTANK']) assert.ok(weird.includes(c), `weird: ${c}`);
  assert.deepEqual(names('economy').slice(0, 2), ['ECONOMY', 'CALENDAR']);
  for (const c of ['CALENDAR', 'EARNINGS', 'IPOS', 'SPLITS', 'EXDIV', 'HOLIDAYS']) assert.ok(names('calendars').includes(c), `calendars: ${c}`);
  const pro = names('pro');
  assert.equal(pro[0], 'PRO');
  for (const c of ['GIFT', 'REDEEM', 'CHAT', 'LOGIN', 'LOGOUT', 'FOUNDERS']) assert.ok(pro.includes(c), `pro: ${c}`);
  for (const c of ['CHART', 'GRID', 'COMPARE']) assert.ok(names('charts').includes(c), `charts: ${c}`);
  for (const c of ['WHATIF', 'AFFORD', 'WAGE', 'LOAN', 'COMPOUND', 'CPI']) assert.ok(names('money').includes(c), `money: ${c}`);
  const src = readFileSync(new URL('../public/registry.js', import.meta.url), 'utf8');
  assert.match(src, /const text = `\$\{c\.summary\} \$\{c\.syntax\}`\.toLowerCase\(\);/, 'the matched text has no category');
  assert.doesNotMatch(src, /\n {4}\{\n/, 'no stray indented entry');
});

test('HELP rows: three columns, COMMAND (name, words, options below), WHAT IT DOES, TRY runs the example', () => {
  const row = commandRow(findCommand('FINANCIALS'), 0);
  const cells = [...row.matchAll(/^\s*<span class="(hc-cmd|hc-sum|hc-ex)">/gm)].map((m) => m[1]);
  assert.deepEqual(cells, ['hc-cmd', 'hc-sum', 'hc-ex'], 'three cells');
  assert.match(row, /<a class="hc-name"[^>]*>FINANCIALS<\/a> <span class="hc-args">&lt;ticker&gt;<\/span><span class="hc-opts">\[BALANCE\|CASHFLOW\] \[QUARTERLY\]<\/span>/);
  assert.match(row, /<span class="hc-ex"><a class="code" href="\?c=FINANCIALS\+AAPL" data-cmd="FINANCIALS AAPL">FINANCIALS AAPL<\/a><\/span>/, 'TRY runs the first example');
  assert.doesNotMatch(row, /hc-syn/, 'the command is said once, not three times');
  assert.deepEqual(syntaxParts(findCommand('HISTORY')), { args: '<ticker>', opts: '[<from> [<to>]]' }, 'nested options stay whole');
  assert.deepEqual(syntaxParts(findCommand('PORTFOLIO')), { args: '', opts: '[ADD <ticker> <shares> @ <cost>|SELL <ticker> <shares>|REMOVE <ticker>]' }, 'an alias as the first word');
  assert.deepEqual(syntaxParts(findCommand('<TICKER>')), { args: '', opts: '[<range>]' });
  for (const cat of helpCategories().slice(1)) {
    for (const c of byCategory(cat).filter((x) => !x.soon)) {
      const r = commandRow(c, 0);
      assert.ok(r.includes(`data-cmd="${c.examples[0].replace(/&/g, '&amp;').replace(/'/g, '&#39;')}"`), `${c.name}: TRY runs ${c.examples[0]}`);
    }
  }
  const html = categoryHtml('Stocks and companies');
  assert.match(html, /<div class="hc-cols" aria-hidden="true"><span>Command<\/span><span>What it does<\/span><span>Try<\/span><\/div><ol class="hc-list">/);
  assert.deepEqual(COLUMN_HEADS, ['Command', 'What it does', 'Try']);
  assert.match(navCss(), /\.hc-row, \.hc-cols \{\s*display: grid;\s*grid-template-columns: minmax\(0, 320px\) minmax\(0, 1fr\) minmax\(0, 208px\);/);
});

test('HELP START HERE: the screens on F1 to F10 from the key bar, then WHATIS', () => {
  const html = startHere();
  const screens = [...html.matchAll(/<li class="hf-row"><kbd>([^<]+)<\/kbd><a class="hf-name" href="[^"]*" data-cmd="([^"]+)">([^<]+)<\/a><span class="hl-sum">([^<]*)<\/span>/g)];
  assert.deepEqual(screens.map((m) => m[1]), FKEYS.map((k) => k.key));
  assert.deepEqual(screens.map((m) => m[1]), ['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10']);
  assert.deepEqual(screens.map((m) => [m[2], m[3]]), FKEYS.map((k) => [k.cmd, k.label]));
  for (const m of screens) assert.ok(m[4].length > 10, `${m[3]} says what it is`);
  assert.match(html, /The screens<\/h3>/);
  assert.match(html, /Don't know a word\? <a class="code" href="\?c=WHATIS\+yield" data-cmd="WHATIS yield">WHATIS yield<\/a>\.<\/p>\s*$/);
  const order = ['help-keys', 'hl-row', '$ before', 'The screens', 'hf-row', 'WHATIS yield'].map((k) => html.indexOf(k));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'keys, five, $, screens, WHATIS');
  assert.doesNotMatch(helpSrc(), /'F1'|'HOME', 'DESK'/, 'the screens come from the key bar, not a copy');
});
