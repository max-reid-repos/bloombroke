// DATA in eight groups: every dataset in exactly one group, a group's age is its oldest
// dataset, the keys open and close groups (never from the command bar), gaps as a ring
// with a tooltip, and a collapsed screen of few words.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATASETS, dataRows } from '../lib/provenance.js';
import { GAUGES } from '../data/weird/index.js';
import {
  GROUPS, groupRows, groupAge, freshState, dataGrid, memberTitle, govSource, gapOf, openFor, dataOps, intoTable, isLit, SEC_TIP,
} from '../public/screens/data.js';
import { treeKey } from '../public/screens/sectors.js';

const NOW = Date.parse('2026-09-25T20:00:30.000Z');
const gauges = GAUGES.map((g) => ({ id: g.id, source: g.source }));
const allRows = () => dataRows({ stats: [], gauges, weird: [], edgar: null, seen: new Map(), now: NOW });

test('groups: eight, in order, with plain words', () => {
  assert.deepEqual(GROUPS.map((g) => g.name), ['PRICES', 'CHARTS', 'COMPANY DATA', 'SEC FILINGS', 'NEWS', 'MACRO', 'WEIRD', 'OUR COUNTERS']);
  for (const g of GROUPS) {
    const n = g.what.split(/\s+/).length;
    assert.ok(n >= 2 && n <= 5, `${g.name}: WHAT is 2 to 5 words`);
    assert.ok(g.updates && g.updates.split(/\s+/).length <= 3, `${g.name}: UPDATES is short`);
  }
});

test('grouping: every dataset lands in exactly one group, none lost', () => {
  const listed = GROUPS.flatMap((g) => g.members.map(([id]) => id));
  assert.equal(new Set(listed).size, listed.length, 'no dataset listed twice');
  for (const d of DATASETS) assert.equal(listed.filter((id) => id === d.id).length, 1, `${d.id} is in one group`);
  for (const id of listed) assert.ok(DATASETS.some((d) => d.id === id), `${id} is a real dataset`);
  const rows = allRows();
  const groups = groupRows(rows);
  const placed = groups.flatMap((g) => g.rows.map((r) => r.id));
  assert.equal(placed.length, rows.length, 'every row placed');
  assert.equal(new Set(placed).size, rows.length, 'each row once');
  const weird = groups.find((g) => g.id === 'weird');
  assert.equal(weird.rows.length, GAUGES.length, 'every gauge in WEIRD');
  assert.ok(weird.rows.every((r) => r.id.startsWith('weird-') && !/^[A-Z]+:/.test(r.short)), 'gauges by their plain name');
  // A dataset the list does not know yet still lands somewhere, by its server group.
  const extra = groupRows([...rows, { id: 'new-thing', group: 'Companies', name: 'New thing', delay: 'daily' }]);
  const co = extra.find((g) => g.id === 'company');
  assert.ok(co.rows.some((r) => r.id === 'new-thing' && r.updates === 'daily'));
  const orphan = groupRows([{ id: 'odd', group: 'Nowhere', name: 'Odd', delay: 'static' }]);
  assert.equal(orphan.length, 1);
});

test('group age = its oldest dataset; the dot says how many have been seen', () => {
  const rows = [
    { id: 'quotes', age_seconds: 12, checked_seconds: 3, delay: 'real-time' },
    { id: 'futures', age_seconds: 10800, checked_seconds: 5, delay: 'delayed-10m' },
    { id: 'intl', age_seconds: null, checked_seconds: null, delay: 'delayed-15m' },
  ];
  assert.equal(groupAge(rows), 10800);
  assert.ok(Number.isNaN(groupAge([{ age_seconds: null }])), 'none known: no made-up age');
  assert.equal(freshState(rows), 'slow');
  assert.equal(freshState(rows.slice(0, 2)), 'ok');
  assert.equal(freshState([rows[2]]), 'none');
  assert.equal(freshState([{ id: 'geo', delay: 'static', age_seconds: null, checked_seconds: null }, rows[0]]), 'ok', 'built-in data never turns the dot grey');
  const g = groupRows(rows.map((r) => ({ ...r, group: 'Prices', name: r.id })));
  const html = dataGrid(g);
  assert.match(html, /data-k="g:prices"[\s\S]*?<td class="num dg-fresh"><span class="sx-dot" data-state="slow"[^>]*><\/span>3h<\/td>/, 'the collapsed row: dot and oldest age');
  assert.doesNotMatch(html, /dg-mem/, 'collapsed: group rows only');
  const none = dataGrid(groupRows([{ ...rows[2], group: 'Prices', name: 'x' }]));
  assert.match(none, /data-state="none"[^>]*><\/span>--<\/td>/);
});

test('collapsed: three columns, no source class, licence, coverage, history or gaps', () => {
  const rows = allRows();
  const html = dataGrid(groupRows(rows));
  assert.equal((html.match(/<tr class="dg-group/g) || []).length, 8);
  assert.match(html, /<th scope="col" class="dg-what">What<\/th><th scope="col" class="dg-upd">Updates<\/th><th scope="col" class="num dg-fresh">Fresh<\/th>/);
  const visible = html.replace(/title="[^"]*"/g, '').replace(/aria-label="[^"]*"/g, '');
  assert.doesNotMatch(visible, /market data provider|public web data|news publishers|licence|third-party|Covers:|History:|Known gaps|Gap:|Oct 2025/i);
  // The words on screen: group names, WHAT, UPDATES, headers.
  const words = visible.replace(/<[^>]+>/g, ' ').split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t));
  assert.ok(words.length <= 50, `collapsed table words: ${words.length}`);
});

test('open group: one line per dataset; gaps as a ring with the words in a tooltip', () => {
  const rows = allRows();
  const groups = groupRows(rows);
  const html = dataGrid(groups, { open: new Set(['macro']) });
  const macro = groups.find((g) => g.id === 'macro');
  assert.equal((html.match(/class="dg-mem/g) || []).length, macro.rows.length);
  assert.match(html, /<tr class="dg-group is-open" data-k="g:macro" data-sec="macro" tabindex="-1" aria-expanded="true"/);
  const cpi = html.match(/<tr id="data-cpi"[\s\S]*?<\/tr>/)[0];
  assert.match(cpi, /CPI inflation<span class="dg-gap" role="img" aria-label="Gap: Oct 2025 not published[^"]*" title="Oct 2025 not published \(US government shutdown\)[^"]*"><\/span>/);
  assert.match(cpi, /title="CPI-U inflation \(CPI\)\nSource: BLS\n[\s\S]*Gap: Oct 2025 not published/);
  assert.match(cpi, /<td class="dg-upd">monthly<\/td>/);
  const futures = html.match(/<tr id="data-fedfutures"[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(futures, /Source:/, 'a non-government source is never named');
  assert.equal(gapOf({ gaps: '--' }), '');
  const nogap = dataGrid(groups, { open: new Set(['news']) }).match(/<tr id="data-news"[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(nogap, /dg-gap/, 'no gap, no ring');
});

test('tooltips: US government sources only, and the SEC delay on SEC FILINGS', () => {
  assert.equal(govSource('SEC EDGAR'), 'SEC EDGAR');
  assert.equal(govSource('National Hurricane Center; stores © OpenStreetMap contributors (ODbL)'), 'National Hurricane Center');
  assert.equal(govSource('Federal Reserve Board, BLS'), 'Federal Reserve Board, BLS');
  assert.equal(govSource('The Economist (CC BY 4.0)'), '');
  assert.equal(govSource('market data provider'), '');
  assert.equal(govSource('reference FX rates (ECB)'), '');
  const rows = allRows();
  for (const r of rows) {
    const t = memberTitle(r);
    assert.doesNotMatch(t, /market data provider|public web data|news publishers|exchange calendars|Economist|Natural Earth/, r.id);
    const src = t.split('\n').find((l) => l.startsWith('Source: '));
    if (src) assert.match(src, /^Source: (SEC EDGAR|BLS|US Treasury|Federal Reserve Board|Federal Reserve Bank of New York|National Hurricane Center|National Weather Service|NOAA|CDC)(, .+)?$/, r.id);
  }
  const html = dataGrid(groupRows(rows), { sec: { seen_within_seconds: 42 } });
  const secRow = html.match(/<tr class="dg-group" data-k="g:sec"[^>]*>/)[0];
  assert.ok(secRow.includes('SEC filings: seen within ~42s of acceptance'));
  assert.ok(secRow.includes(SEC_TIP.slice(0, 40)));
  assert.doesNotMatch(html.match(/<tr class="dg-group" data-k="g:prices"[^>]*>/)[0], /seen within/);
});

test('DATA <word>: the dataset lit in its open group, or the group named', () => {
  const groups = groupRows(allRows());
  assert.deepEqual(openFor(groups, 'cpi'), ['macro']);
  assert.deepEqual(openFor(groups, 'sec'), ['sec']);
  assert.deepEqual(openFor(groups, 'macro'), ['macro']);
  assert.deepEqual(openFor(groups, ''), []);
  assert.ok(isLit('weird-pizza', 'weird') && isLit('cpi', 'cpi') && !isLit('cpi', 'c'));
  const html = dataGrid(groups, { open: new Set(['macro']), lit: 'cpi' });
  assert.match(html, /<tr id="data-cpi" class="dg-mem is-lit"/);
});

// A table as DATA draws it, rows with data-k, for treeKey.
function fakeTable(groups, state) {
  const rows = [];
  for (const g of groups) {
    rows.push({ dataset: { k: `g:${g.id}`, sec: g.id } });
    if (state.open.has(g.id)) for (const r of g.rows) rows.push({ dataset: { k: `m:${g.id}:${r.id}`, parent: g.id } });
  }
  for (const r of rows) r.closest = () => r;
  return { querySelectorAll: () => rows, rows };
}
function press(state, groups, key, target = null) {
  const host = fakeTable(groups, state);
  const tr = target || host.rows.find((r) => r.dataset.k === state.cur) || host.rows[0];
  let prevented = false;
  const e = { key, target: tr, preventDefault: () => { prevented = true; }, stopPropagation() {} };
  const ops = dataOps(state, { groups: () => groups, draw: () => {}, cursor: (r) => { if (r) state.cur = r.dataset.k; }, top: () => { state.cur = 'BAR'; } });
  const took = treeKey(e, host, ops);
  assert.equal(took, prevented);
  return took;
}

test('keys: Right/Enter open, Left closes, E all, C none, Up from the top to the bar', () => {
  const groups = groupRows(allRows());
  const state = { open: new Set(), cur: 'g:prices' };
  press(state, groups, 'ArrowDown');
  assert.equal(state.cur, 'g:charts');
  press(state, groups, 'ArrowRight');
  assert.ok(state.open.has('charts'), 'Right opens');
  press(state, groups, 'ArrowRight');
  assert.equal(state.cur, 'm:charts:bars', 'Right on an open group steps in');
  press(state, groups, 'ArrowLeft');
  assert.ok(!state.open.has('charts'), 'Left from a dataset closes its group');
  assert.equal(state.cur, 'g:charts');
  press(state, groups, 'Enter');
  assert.ok(state.open.has('charts'), 'Enter opens');
  press(state, groups, 'Enter');
  assert.ok(!state.open.has('charts'), 'Enter on an open group closes it');
  press(state, groups, 'e');
  assert.equal(state.open.size, 8, 'E opens all');
  press(state, groups, 'C');
  assert.equal(state.open.size, 0, 'C closes all');
  assert.equal(state.cur, 'g:charts');
  state.cur = 'g:prices';
  press(state, groups, 'ArrowUp');
  assert.equal(state.cur, 'BAR', 'Up on the top row goes back to the command bar');
});

test('keys: nothing typed in the command bar is taken', () => {
  const groups = groupRows(allRows());
  const state = { open: new Set(), cur: 'g:prices' };
  const bar = { tagName: 'INPUT', id: 'cmd', value: '', dataset: {}, closest: () => null };
  for (const k of ['e', 'E', 'c', 'C', 'ArrowRight', 'ArrowLeft', 'Enter', ' ']) {
    assert.equal(press(state, groups, k, bar), false, `${k} in the command bar is the command bar's`);
  }
  assert.equal(state.open.size, 0);
  assert.equal(state.cur, 'g:prices');
  // Down moves into the table only from an empty command bar.
  const ev = (key, target) => ({ key, target, defaultPrevented: false });
  assert.equal(intoTable(ev('ArrowDown', bar), bar), true);
  assert.equal(intoTable(ev('ArrowDown', { ...bar }), bar), false, 'another element');
  assert.equal(intoTable(ev('e', bar), bar), false);
  const typed = { ...bar, value: 'DA' };
  assert.equal(intoTable(ev('ArrowDown', typed), typed), false, 'text in the bar: Down is the bar\'s');
  assert.equal(intoTable(ev('ArrowDown', bar), null), false);
});

test('DATA files: house rules', () => {
  for (const f of ['../public/screens/data.js', '../public/screens/data.css', './data-groups.test.js']) {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, new RegExp(['Bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, new RegExp(String.fromCharCode(0x2014)), f);
    assert.doesNotMatch(s, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, f);
    assert.doesNotMatch(s, new RegExp(['amb', 'er|oran', 'ge|#ffa', '500|#ffb', 'f00'].join(''), 'i'), f);
  }
});
