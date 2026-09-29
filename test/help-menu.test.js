// HELP and the MENU (Ctrl K): one source (registry.js commandGroups). HELP is one
// numbered panel: the key row first, START HERE (five commands, in order), then every
// group as one list. No second input: "/" puts the command bar in find mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandGroups, START_HERE, START_KEYS, START_GROUP, CATEGORIES, findCommand } from '../public/registry.js';
import { helpHtml, keyRow, startHere, filterGroups, listHtml, findMode, canFind, runsAsTyped, HELP_GROUPS } from '../public/screens/help.js';
import { menuGroupsHtml, menuItems } from '../public/menu.js';
import { COMMANDS } from '../public/app.js';

// [[group, [cmd, ...]], ...] from HELP or MENU HTML: data-group sections, data-cmd rows.
function groupsOf(html, rowClass) {
  const out = [];
  for (const m of html.matchAll(/data-group="([^"]+)"([\s\S]*?)(?=data-group="|$)/g)) {
    const cmds = [...m[2].matchAll(new RegExp(`class="${rowClass}" href="[^"]*" data-cmd="([^"]+)"`, 'g'))].map((x) => x[1]);
    out.push([m[1], cmds]);
  }
  return out;
}

test('HELP: the key row comes first, one line, in this order', () => {
  const html = helpHtml();
  assert.ok(html.trimStart().startsWith('<p class="help-keys">'), 'the key row is the first thing in the panel');
  const text = keyRow().replace(/<span class="hk-sep"[^>]*>&middot;<\/span>/g, ' · ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(text, 'Enter run · Tab complete · Esc back · Ctrl K menu · / find · F1-F10 screens · 1-9 the numbered thing on screen');
  assert.equal((keyRow().match(/<kbd>/g) || []).length, 7, 'every key an outlined badge');
  const css = readFileSync('public/screens/help.css', 'utf8');
  assert.match(css, /\.help-keys \{[^}]*font-size: 14px/);
});

test('HELP: START HERE is five commands, in order, then the $ line', () => {
  assert.deepEqual(START_HERE.map(([c]) => c), ['AAPL', 'MARKETS', 'NEWS', 'WHATIF IPHONE6', 'GUESS']);
  const html = startHere();
  assert.deepEqual([...html.matchAll(/class="hl-name" href="[^"]*" data-cmd="([^"]+)"/g)].map((m) => m[1]), START_HERE.map(([c]) => c));
  assert.match(html, /\$ before a ticker always means the stock, e\.g\. <a class="code"[^>]*>\$GOLD<\/a>\./);
  const first = groupsOf(helpHtml(), 'hl-name')[0];
  assert.equal(first[0], START_GROUP);
});

test('HELP: no second input, no category nav, no tabs', () => {
  const src = readFileSync('public/screens/help.js', 'utf8');
  assert.doesNotMatch(src, /<input/, 'the command bar is the only input');
  assert.doesNotMatch(src, /help-cats|help-cat\b|role="tab"/);
  assert.doesNotMatch(helpHtml(), /<input|<nav/);
  assert.doesNotMatch(listHtml('yield'), /<input/);
  // Every group is on the page at once, with its count.
  const html = helpHtml();
  for (const g of commandGroups().slice(1)) assert.ok(html.includes(`data-group="${g.name}"`) && html.includes(`&middot; ${g.items.length}</span>`), g.name);
});

test('HELP and MENU: one source, the same START HERE and the same groups', () => {
  const help = groupsOf(helpHtml(), 'hl-name');
  const menu = groupsOf(menuGroupsHtml(), 'mn-item');
  assert.deepEqual(menu, help);
  assert.deepEqual(help.map(([g]) => g), [START_GROUP, ...CATEGORIES.filter((c) => help.some(([g]) => g === c))]);
  assert.deepEqual(help[0][1], START_HERE.map(([c]) => c));
  assert.deepEqual(HELP_GROUPS, [START_GROUP, ...CATEGORIES]);
  // Every command the menu can find is in a group, once.
  const inGroups = help.slice(1).flatMap(([, cmds]) => cmds);
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

test('HELP find: a word keeps its groups, best first for Enter; nothing found says so', () => {
  const f = filterGroups('yield');
  assert.ok(f.count >= 3);
  assert.ok(!f.groups.some((g) => g.name === START_GROUP));
  assert.ok(f.groups.some((g) => g.name === 'Rates and bonds'));
  assert.equal(filterGroups('insider').best, findCommand('INSIDERS').examples[0]);
  assert.deepEqual(filterGroups('').count, null);
  assert.match(listHtml('zzzz'), /No command matches "zzzz"\. Enter runs what you typed\./);
  assert.match(listHtml('<b>'), /&lt;b&gt;/, 'escaped');
});

// A tiny stand-in for the page: listeners by type, and events that can be stopped.
function fakePage() {
  const on = { doc: {}, bar: {} };
  const add = (where) => (type, fn) => { (on[where][type] ||= []).push(fn); };
  const remove = (where) => (type, fn) => { on[where][type] = (on[where][type] || []).filter((f) => f !== fn); };
  const form = { cls: new Set(), classList: { add: (c) => form.cls.add(c), remove: (c) => form.cls.delete(c) } };
  const bar = { value: '', focused: false, focus() { this.focused = true; }, closest: () => form, addEventListener: add('bar'), removeEventListener: remove('bar') };
  const doc = { addEventListener: add('doc'), removeEventListener: remove('doc') };
  const fire = (type, init) => {
    const e = { type, target: bar, defaultPrevented: false, stopped: false, metaKey: false, ctrlKey: false, altKey: false, ...init,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const fn of on.doc[type] || []) fn(e);
    return e;
  };
  return { doc, bar, form, fire, on };
}

test('"/" puts the command bar in find mode: typing filters HELP, Enter runs the best, Esc leaves', () => {
  const p = fakePage();
  const prompt = { textContent: '>' };
  const filtered = [];
  const ran = [];
  const said = [];
  const stop = findMode({ doc: p.doc, bar: p.bar, promptEl: prompt, onFilter: (t, count) => { filtered.push(t); const r = filterGroups(t); return count ? (r.count ?? 0) : r.best; }, onRun: (c) => ran.push(c), status: (t) => said.push(t) });
  const slash = p.fire('keydown', { key: '/', target: { closest: () => null } });
  assert.ok(slash.defaultPrevented && p.bar.focused && prompt.textContent === '/' && p.form.cls.has('is-find'));
  p.bar.value = 'insider';
  const typed = p.fire('input', {});
  assert.ok(typed.stopped, 'the bar\'s own suggestion list stays shut');
  assert.equal(filtered.at(-1), 'insider');
  assert.match(said.at(-1), /^FIND: \d+ COMMANDS?$/);
  const enter = p.fire('keydown', { key: 'Enter' });
  assert.ok(enter.defaultPrevented);
  assert.deepEqual(ran, [findCommand('INSIDERS').examples[0]]);
  assert.equal(prompt.textContent, '>', 'find mode is over');
  // Esc clears and leaves; a word that matches nothing goes to the bar as a command.
  p.fire('keydown', { key: '/', target: { closest: () => null } });
  p.bar.value = 'yield';
  p.fire('input', {});
  const esc = p.fire('keydown', { key: 'Escape' });
  assert.ok(esc.defaultPrevented && esc.stopped);
  assert.equal(p.bar.value, '');
  p.fire('keydown', { key: '/', target: { closest: () => null } });
  p.bar.value = 'AAPL';
  const run = p.fire('keydown', { key: 'Enter' });
  assert.equal(run.defaultPrevented, false, 'AAPL is not a command name: the bar runs it');
  // "/" in a field with text is just a character.
  p.bar.value = '2020';
  const typedSlash = p.fire('keydown', { key: '/', target: p.bar });
  assert.equal(typedSlash.defaultPrevented, false);
  stop();
  assert.equal((p.on.doc.keydown || []).length, 0, 'listeners go with the screen');
});

test('find mode: only where the bar is on screen, never in a DESK panel or an embed', () => {
  const doc = (embed) => ({ documentElement: { classList: { contains: (c) => embed && c === 'is-embed' } } });
  const bar = (shown) => ({ getClientRects: () => (shown ? [{}] : []) });
  assert.equal(canFind({ doc: doc(false), bar: bar(true) }), true);
  assert.equal(canFind({ doc: doc(true), bar: bar(true) }), false, 'a DESK panel: "/" in USD/JPY stays a character');
  assert.equal(canFind({ doc: doc(false), bar: bar(false) }), false, 'the bar hidden');
  assert.equal(canFind({ doc: doc(false), bar: null }), false);
  const src = readFileSync('public/screens/help.js', 'utf8');
  assert.match(src, /const stop = canFind\(\{ bar \}\)\s*\?\s*findMode\(/, 'render mounts find mode only through canFind');
});

test('find mode on a phone: a bar that holds just "/" enters it', () => {
  const p = fakePage();
  const prompt = { textContent: '>' };
  const stop = findMode({ doc: p.doc, bar: p.bar, promptEl: prompt, onFilter: () => null, onRun: () => {}, status: () => {} });
  p.bar.value = '/';
  const e = p.fire('input', { key: 'Unidentified' });
  assert.ok(e.stopped);
  assert.equal(prompt.textContent, '/');
  assert.equal(p.bar.value, '', 'the "/" itself is not a search');
  p.bar.value = 'USD/';
  stop();
  const later = fakePage();
  const stop2 = findMode({ doc: later.doc, bar: later.bar, promptEl: { textContent: '>' }, onFilter: () => null, onRun: () => {}, status: () => {} });
  later.bar.value = 'USD/JPY';
  assert.equal(later.fire('input', {}).stopped, false, 'a "/" inside other words is typing');
  stop2();
});

test('find mode Enter: IME composing is left alone; commands and tickers run as typed; Ctrl or Cmd with / does nothing', () => {
  for (const t of ['DOW', 'EUR', 'GOLD', 'OIL', 'AAPL', 'NEWS', '$GOLD', 'EUR USD', 'rates']) assert.equal(runsAsTyped(t), true, t);
  for (const t of ['insider', 'yield', 'dividend', 'mortgage', '']) assert.equal(runsAsTyped(t), false, t);
  const p = fakePage();
  const prompt = { textContent: '>' };
  const ran = [];
  const stop = findMode({ doc: p.doc, bar: p.bar, promptEl: prompt, onFilter: (t) => filterGroups(t).best, onRun: (c) => ran.push(c), status: () => {} });
  for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
    const e = p.fire('keydown', { key: '/', target: { closest: () => null }, ...mod });
    assert.equal(e.defaultPrevented, false);
    assert.equal(prompt.textContent, '>');
  }
  p.fire('keydown', { key: '/', target: { closest: () => null } });
  p.bar.value = 'insider';
  const ime = p.fire('keydown', { key: 'Enter', isComposing: true });
  assert.equal(ime.defaultPrevented, false);
  assert.deepEqual(ran, []);
  assert.equal(prompt.textContent, '/', 'still finding');
  p.bar.value = 'GOLD';
  const gold = p.fire('keydown', { key: 'Enter' });
  assert.equal(gold.defaultPrevented, false, 'the bar runs GOLD as typed');
  assert.deepEqual(ran, []);
  assert.equal(p.bar.value, 'GOLD');
  assert.equal(prompt.textContent, '>');
  stop();
});
