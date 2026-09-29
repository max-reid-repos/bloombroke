// HELP and the MENU (Ctrl K). HELP: a search box on top, categories on the left (START
// HERE first), one category on the right. START HERE opens with the key row, then five
// commands, then the $ line. MENU: the same groups in columns, names only; the picked
// command's line shows in the footer; a find lists its matches with their lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandGroups, START_HERE, START_GROUP, CATEGORIES, findCommand, byCategory, categoriesInUse, LISTED, searchCommands } from '../public/registry.js';
import { keyRow, startHere, categoryHtml, helpCategories, DOLLAR_LINE, HELP_GROUPS } from '../public/screens/help.js';
import { menuGroupsHtml, menuFoundHtml, menuFootHtml, MENU_FOOT, menuItems } from '../public/menu.js';
import { COMMANDS } from '../public/app.js';

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
  assert.ok(html.indexOf('hl-row') < html.indexOf('$ before'), 'the $ line comes last');
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
  assert.deepEqual(menu.map(([g]) => g), helpCategories());
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
  assert.match(menuGroupsHtml(), /^<div class="mn-grid"><section class="mn-cat" data-group="Start here">/);
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

test('MENU fits one screen: 20px rows, 4 columns, 5 on a shorter screen, a fixed search bar', () => {
  const css = navCss();
  assert.match(css, /\.menu-search \{\s*flex: none;/, 'the search bar never shrinks');
  assert.match(css, /\.menu-foot \{\s*flex: none;/);
  assert.match(css, /\.mn-grid \{ columns: 4 150px;/);
  assert.match(css, /@media \(min-width: 640px\) and \(max-height: 890px\) \{\s*\.mn-grid \{ columns: 5 150px;/);
  assert.match(css, /\.mn-grid \.mn-item \{[^}]*padding: 0 8px; line-height: 20px;/, '20px rows');
  assert.match(css, /\.mn-h \{ break-after: avoid; \}/, 'a header keeps its first rows');
  assert.doesNotMatch(css, /\.mn-cat \{[^}]*break-inside: avoid/, 'a long group may run on into the next column');
  assert.match(css, /\.mn-found \.mn-sum \{[^}]*white-space: normal/);
});
