// DATA in eight groups: every dataset in exactly one group, FRESH is "on schedule" per
// dataset cadence and the group's last check, the keys open and close groups (never from the command bar), gaps as a ring
// with a tooltip, and a collapsed screen of few words.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATASETS, dataRows } from '../lib/provenance.js';
import { GAUGES } from '../data/weird/index.js';
import {
  GROUPS, groupRows, scheduleState, groupFresh, freshTitle, tradingDaysBehind, fetchAge, ruleOf, dataGrid, memberTitle, govSource, gapOf, openFor, dataOps, intoTable, isLit, SEC_TIP,
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

// A dataset as /api/data sends it, checked `chk` seconds before NOW, its data dated asOf.
const ds = (rule, asOf, chk = 5, extra = {}) => ({ id: 'x', short: 'X', updates: 'daily', rule, as_of: asOf, checked_seconds: chk, age_seconds: Math.round((NOW - Date.parse(asOf)) / 1000), ...extra });
// NOW is Friday 2026-09-25 16:00:30 ET (market just closed). SUN: Sunday evening ET.
const SUN = Date.parse('2026-09-27T23:00:00.000Z');
const OPEN = Date.parse('2026-09-24T15:00:00.000Z'); // Thursday 11:00 ET

test('schedule words map to rules; built in is never judged', () => {
  assert.deepEqual(['live', 'every minute', 'hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'built in', 'rarely'].map(ruleOf),
    ['minutes', 'minutes', 'hours3', 'daily', 'days9', 'days75', 'days120', 'none', 'none']);
  assert.equal(scheduleState(ds('none', '2020-01-01T00:00:00.000Z')), 'unknown');
  assert.equal(scheduleState({ rule: 'daily', as_of: null, checked_seconds: null, age_seconds: null }, NOW), 'unknown', 'not seen: grey, never a guess');
});

test('on schedule: live feeds within minutes', () => {
  const at = (asOf, chk) => ds('minutes', asOf, chk);
  assert.equal(scheduleState(at('2026-09-25T19:50:30.000Z', 60), NOW), 'ok', '9 min behind at the fetch');
  assert.equal(scheduleState(at('2026-09-25T18:00:30.000Z', 60), NOW), 'late', 'two hours behind');
  // Judged at the fetch: a feed nobody opened for hours is not late.
  assert.equal(scheduleState(at('2026-09-25T16:59:00.000Z', 3 * 3600), NOW), 'ok');
});

test('on schedule: a live price is late while the NYSE is open, not over a weekend', () => {
  const t = (asOf, now) => scheduleState({ rule: 'market', as_of: asOf, checked_seconds: 10 }, now);
  assert.equal(t(new Date(OPEN - 5 * 60_000).toISOString(), OPEN), 'ok');
  assert.equal(t(new Date(OPEN - 2 * 3600_000).toISOString(), OPEN), 'late', 'market open, two hours stale');
  assert.equal(t('2026-09-25T00:00:00.000Z', SUN), 'ok', 'Friday\'s close on Sunday');
  assert.equal(t('2026-09-25T20:00:00.000Z', SUN), 'ok');
  assert.equal(t('2026-09-23T20:00:00.000Z', SUN), 'late', 'Wednesday\'s price on Sunday');
});

test('on schedule: daily at most 2 trading days behind, weekends and NYSE holidays skipped', () => {
  assert.equal(tradingDaysBehind('2026-09-25T00:00:00.000Z', SUN), 0, 'Friday, seen on Sunday');
  assert.equal(tradingDaysBehind('2026-09-24T00:00:00.000Z', SUN), 1);
  assert.equal(tradingDaysBehind('2026-09-04T00:00:00.000Z', Date.parse('2026-09-08T14:00:00.000Z')), 1, 'Labor Day Sep 7 not counted');
  const d = (asOf, now) => scheduleState({ rule: 'daily', as_of: asOf, checked_seconds: 10 }, now);
  assert.equal(d('2026-09-24T00:00:00.000Z', SUN), 'ok', 'Thursday\'s rate on Sunday');
  assert.equal(d('2026-09-22T00:00:00.000Z', SUN), 'late', 'Tuesday\'s on Sunday: 3 trading days behind');
  assert.equal(d('2026-09-23T00:00:00.000Z', NOW), 'ok');
});

test('on schedule: weekly, monthly (dated the 1st), quarterly', () => {
  const s = (rule, asOf) => scheduleState(ds(rule, asOf, 60), NOW);
  assert.equal(s('days9', '2026-09-17T00:00:00.000Z'), 'ok');
  assert.equal(s('days9', '2026-09-10T00:00:00.000Z'), 'late');
  assert.equal(s('days75', '2026-08-01T00:00:00.000Z'), 'ok', 'August CPI in late September');
  assert.equal(s('days75', '2026-06-01T00:00:00.000Z'), 'late', 'June data in late September');
  assert.equal(s('days120', '2026-07-31T00:00:00.000Z'), 'ok');
  assert.equal(s('days120', '2026-04-30T00:00:00.000Z'), 'late');
  // Company data, dated by its own last event: judged by the fetch only.
  assert.equal(scheduleState(ds('fetch', '2025-01-01T00:00:00.000Z', 30), NOW), 'ok');
  assert.equal(scheduleState({ rule: 'fetch', checked_seconds: null, age_seconds: null }, NOW), 'unknown');
  assert.equal(fetchAge({ rule: 'fetch', checked_seconds: null, age_seconds: 7 }), 7, 'a counter kept here: its own age');
});

test('group FRESH: red when any is late, green when all seen are on time, grey when none; text = last check', () => {
  const ok = { ...ds('days75', '2026-08-01T00:00:00.000Z', 40), short: 'CPI', updates: 'monthly' };
  const late = { ...ds('days75', '2026-05-01T00:00:00.000Z', 300), short: 'Boxes', updates: 'monthly' };
  const unseen = { rule: 'daily', as_of: null, checked_seconds: null, age_seconds: null };
  assert.equal(groupFresh([ok, unseen], NOW).state, 'ok');
  assert.equal(groupFresh([ok, unseen], NOW).age, 40, 'the newest good fetch');
  const f = groupFresh([ok, late], NOW);
  assert.equal(f.state, 'late');
  assert.match(freshTitle(f), /^Late: Boxes \(monthly, data from May 1\)\. Last check 40s ago\.$/);
  assert.equal(groupFresh([unseen], NOW).state, 'unknown');
  assert.equal(freshTitle(groupFresh([unseen], NOW)), 'Not checked since the server started.');
  assert.match(freshTitle(groupFresh([ok, unseen], NOW)), /^On schedule: 1 of 2 checked/);
  // Drawn: the dot's state and the last check, the one-line tooltip on the cell.
  const rows = groupRows([{ id: 'cpi', group: 'Economy', name: 'CPI-U inflation (CPI)', delay: 'monthly', as_of: '2026-08-01T00:00:00.000Z', checked_seconds: 12, age_seconds: 57 * 86400 }]);
  const html = dataGrid(rows, { open: new Set(['macro']), now: NOW });
  assert.match(html, /<td class="num dg-fresh" title="On schedule: [^"]+"><span class="sx-dot" data-state="ok"[^>]*><\/span>12s<\/td>/);
  assert.match(html, /<tr id="data-cpi"[\s\S]*?<td class="dg-upd">monthly<\/td>\s*<td class="num dg-fresh"><span class="sx-dot" data-state="ok"[^>]*><\/span>57d<\/td>/, 'the member: cadence and its own data age');
  const red = dataGrid(groupRows([{ id: 'cpi', group: 'Economy', name: 'CPI', delay: 'monthly', as_of: '2026-05-01T00:00:00.000Z', checked_seconds: 12, age_seconds: 1 }]), { now: NOW });
  assert.match(red, /title="Late: CPI inflation[^"]*"><span class="sx-dot" data-state="failing"/);
});

test('every listed dataset has a rule its updates word or its own names', () => {
  for (const g of groupRows(allRows())) for (const r of g.rows) {
    assert.ok(['minutes', 'market', 'hours3', 'daily', 'days9', 'days10', 'days30', 'weeks5', 'days60', 'days75', 'months4', 'days120', 'days200', 'fetch', 'none'].includes(r.rule), `${r.id}: ${r.rule}`);
  }
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
