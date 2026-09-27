// DATA (alias SOURCES): where the numbers come from, in eight plain groups. Collapsed,
// each group is one row: what it holds, how often it updates, and how fresh it is (a
// dot and the age of its oldest data). A group opens (like SECTORS) to one line per
// dataset: its name, how often it updates, its age. The detail (coverage, history, delay,
// a named US government source) sits in each dataset's tooltip; a known gap is a small
// ring by its name. No source classes or licences on screen, never a vendor name.
// DATA <dataset> opens its group with that row lit; DATA <group> (DATA MACRO) opens one.
//
// Keys (the table has the focus; Down from the empty command bar moves in, and nothing
// here reads keys typed in the command bar): Up Down move, Right or Enter opens a group,
// Left closes it, Space toggles, E opens all, C closes all. A click or tap toggles.

import { esc, panel, LOADING, metaNote } from './markets.js';
import { dash } from './company-kit.js';
import { treeKey, focusTreeRow } from './sectors.js';
import { ageWords, delayWord, lastUpdateWords } from '../provenance.js';
import { parseData as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { parse };

// The age cell's tooltip: when the source was last asked, and the data's own time.
export function ageTitle(r) {
  return [
    Number.isFinite(r.checked_seconds) ? `Checked ${ageWords(r.checked_seconds)} ago` : 'Not checked since the server started',
    r.as_of ? `last update ${lastUpdateWords(r.as_of)}` : '',
  ].filter(Boolean).join(' · ');
}

// "SEC filings: seen within ~42s of acceptance", or the same with -- before any.
export function secLine(sec) {
  const n = sec?.seen_within_seconds;
  return `SEC filings: seen within ${Number.isFinite(n) ? `~${n}s` : dash} of acceptance`;
}
export const SEC_TIP = 'Measured: the time from EDGAR accepting a filing to this server seeing it, median of the last 200 filings. FINANCIALS, FILINGS and the E flags refetch that company on the next view.';

// ---- The groups ------------------------------------------------------------------------

// Each group: its plain name, what it holds, how often it updates, and its datasets as
// [id, short name, updates]. WEIRD takes every weird-* gauge. A dataset the list does
// not name yet falls into a group by its server group (FALLBACK), so none is ever lost.
export const GROUPS = [
  { id: 'prices', name: 'PRICES', what: 'Stocks, ETFs, FX, crypto', updates: 'live', members: [
    ['quotes', 'Quotes', 'live'], ['futures', 'Futures', 'every minute'], ['intl', 'World indexes', 'every minute'],
    ['sp100', 'S&P 100', 'live'], ['sectors', 'Sector ETFs', 'live'], ['bonds', 'Bond yields', 'every minute'],
    ['crypto', 'Crypto', 'live'], ['options', 'Options', 'every minute'], ['value', 'Valuation', 'daily'],
    ['screener', 'Screener', 'daily'], ['fx', 'FX reference rates', 'daily'], ['search', 'Symbol search', 'hourly'],
  ] },
  { id: 'charts', name: 'CHARTS', what: 'Price history', updates: 'every minute', members: [
    ['bars', 'Price history', 'every minute'], ['whatif', 'WHATIF prices', 'daily'], ['guess', 'GUESS puzzle', 'daily'],
    ['geo', 'World map shapes', 'built in'],
  ] },
  { id: 'company', name: 'COMPANY DATA', what: 'Earnings, dividends, insiders', updates: 'daily', members: [
    ['profile', 'Profiles', 'daily'], ['earnings', 'Earnings', 'daily'], ['dividends', 'Dividends', 'daily'],
    ['splits-hist', 'Split history', 'daily'], ['insiders', 'Insider trades', 'daily'], ['owners', 'Big holders', 'quarterly'],
    ['shorts', 'Short interest', 'twice a month'], ['ipos', 'IPO and split calendars', 'hourly'],
  ] },
  { id: 'sec', name: 'SEC FILINGS', what: 'Filings, financials', updates: 'live', members: [
    ['sec-feed', 'Latest filings', 'live'], ['sec-subs', 'Company filings', 'live'], ['sec-facts', 'Financials', 'quarterly'],
  ] },
  { id: 'news', name: 'NEWS', what: 'Headlines, wires', updates: 'live', members: [
    ['news', 'Market headlines', 'live'], ['tickernews', 'Company headlines', 'live'], ['news-wires', 'Press releases', 'live'],
    ['news-macro', 'Fed and jobs news', 'every 5 minutes'], ['news-wsb', 'WSB posts', 'every 5 minutes'], ['newslog', 'Headline log', 'live'],
  ] },
  { id: 'macro', name: 'MACRO', what: 'Rates, inflation, jobs', updates: 'daily', members: [
    ['treasury', 'Treasury curve', 'daily'], ['nyfed', 'Fed funds rate', 'daily'], ['fedfutures', 'Fed funds futures', 'every minute'],
    ['mortgage', 'Mortgage rates', 'weekly'], ['cpi', 'CPI inflation', 'monthly'], ['economy', 'Economy', 'monthly'],
    ['calendar', 'Economic calendar', 'hourly'],
  ] },
  { id: 'weird', name: 'WEIRD', what: 'Odd real-world gauges', updates: 'live to monthly', members: [] },
  { id: 'counters', name: 'OUR COUNTERS', what: 'Trending, site numbers', updates: 'live', members: [
    ['trending', 'Trending', 'every minute'], ['bbrk', 'Site numbers', 'live'],
  ] },
];
const FALLBACK = { Prices: 'prices', Rates: 'macro', Economy: 'macro', Companies: 'company', News: 'news', WEIRD: 'weird', Tools: 'counters' };

// A delay class in plain words, for a dataset the list does not word itself (the gauges).
const UPDATES = { 'real-time': 'live', 'delayed-10m': 'every minute', 'delayed-15m': 'every minute', 'end-of-day': 'daily', daily: 'daily', weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', static: 'rarely' };
const WEIRD_UPDATES = { bigmac: 'twice a year', beige: 'eight a year' };

// Named inside a dataset's tooltip; every other source stays unnamed.
const GOV = /^(SEC EDGAR|BLS|US Treasury|Federal Reserve Board|Federal Reserve Bank of New York|National Hurricane Center|National Weather Service|NOAA|CDC)$/;
export function govSource(source) {
  const named = String(source || '').split(/[;,]/).map((s) => s.trim()).filter((s) => GOV.test(s));
  return named.join(', ');
}

// A gauge's plain name: "PIZZA: Pentagon pizza" -> "Pentagon pizza".
const shortWeird = (name) => String(name || '').replace(/^[A-Z0-9]+:\s*/, '');

// Rows from /api/data -> the groups, in order, each with its rows (short name and plain
// updates added). Every row lands in exactly one group.
export function groupRows(rows) {
  const out = GROUPS.map((g) => ({ ...g, rows: [] }));
  const byId = new Map(out.map((g) => [g.id, g]));
  const slot = new Map();
  GROUPS.forEach((g) => g.members.forEach(([id, short, upd], i) => slot.set(id, { gid: g.id, short, upd, i })));
  for (const r of rows || []) {
    if (!r?.id) continue;
    const s = slot.get(r.id);
    if (s) { byId.get(s.gid).rows.push({ ...r, short: s.short, updates: s.upd, order: s.i }); continue; }
    const weird = String(r.id).startsWith('weird-');
    const gid = weird ? 'weird' : FALLBACK[r.group] || 'counters';
    const key = r.id.replace(/^weird-/, '');
    byId.get(gid).rows.push({ ...r, short: weird ? shortWeird(r.name) : r.name, updates: (weird && WEIRD_UPDATES[key]) || UPDATES[r.delay] || dash, order: 1000 });
  }
  for (const g of out) g.rows.sort((a, b) => a.order - b.order);
  return out.filter((g) => g.rows.length);
}

// A group's age: its oldest data (the largest age among its rows), or NaN when none known.
export function groupAge(rows) {
  const ages = (rows || []).map((r) => r.age_seconds).filter(Number.isFinite);
  return ages.length ? Math.max(...ages) : NaN;
}

// The dot: ok (green) when every dataset that can age has been seen since the server
// started, slow (grey) when some have, none (faint) when none. Built-in data never counts.
const known = (r) => Number.isFinite(r.age_seconds) || Number.isFinite(r.checked_seconds);
export function freshState(rows) {
  const live = (rows || []).filter((r) => r.delay !== 'static' || known(r));
  const n = live.filter(known).length;
  if (!n) return 'none';
  return n === live.length ? 'ok' : 'slow';
}

// The gap text of a row, or '' when it has none.
export const gapOf = (r) => (r.gaps && r.gaps !== '--' && r.gaps !== dash ? String(r.gaps) : '');

// The tooltip of a dataset row: its full name, then the detail.
export function memberTitle(r) {
  const src = govSource(r.source);
  return [
    r.name,
    src ? `Source: ${src}` : '',
    r.coverage && r.coverage !== '--' ? `Covers: ${r.coverage}` : '',
    r.history && r.history !== '--' ? `History: ${r.history}` : '',
    r.cadence && r.cadence !== '--' ? `Updates: ${r.cadence}` : '',
    `Delay: ${delayWord(r.delay)}`,
    ageTitle(r),
    gapOf(r) ? `Gap: ${gapOf(r)}` : '',
  ].filter(Boolean).join('\n');
}

const dot = (state) => `<span class="sx-dot" data-state="${state}" aria-hidden="true"></span>`;
const ageText = (s) => (Number.isFinite(s) ? ageWords(s) : dash);

function groupTitle(g, sec) {
  const age = groupAge(g.rows);
  const oldest = Number.isFinite(age) ? g.rows.find((r) => r.age_seconds === age) : null;
  const seen = g.rows.filter(known).length;
  return [
    `${g.rows.length} datasets, ${seen} seen since the server started`,
    oldest ? `Oldest: ${oldest.short}, ${ageWords(age)}` : '',
    g.id === 'sec' ? `${secLine(sec)}. ${SEC_TIP}` : '',
  ].filter(Boolean).join('\n');
}

function groupRow(g, open, sec) {
  const st = freshState(g.rows);
  return `<tr class="dg-group${open ? ' is-open' : ''}" data-k="g:${esc(g.id)}" data-sec="${esc(g.id)}" tabindex="-1" aria-expanded="${open}" title="${esc(groupTitle(g, sec))}">
    <th scope="row" class="dg-name"><span class="dg-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>${esc(g.name)}</th>
    <td class="dg-what">${esc(g.what)}</td>
    <td class="dg-upd">${esc(g.updates)}</td>
    <td class="num dg-fresh">${dot(st)}${esc(ageText(groupAge(g.rows)))}</td>
  </tr>`;
}

function memberRow(r, g, lit) {
  const gap = gapOf(r);
  const mark = gap ? `<span class="dg-gap" role="img" aria-label="${esc(`Gap: ${gap}`)}" title="${esc(gap)}"></span>` : '';
  return `<tr id="data-${esc(r.id)}" class="dg-mem${lit ? ' is-lit' : ''}" data-k="m:${esc(g.id)}:${esc(r.id)}" data-parent="${esc(g.id)}" tabindex="-1" title="${esc(memberTitle(r))}">
    <th scope="row" class="dg-name" colspan="2">${esc(r.short)}${mark}</th>
    <td class="dg-upd">${esc(r.updates)}</td>
    <td class="num dg-fresh">${dot(freshState([r]))}${esc(ageText(r.age_seconds))}</td>
  </tr>`;
}

// Does a dataset id match DATA <word>? The id itself, or its family (sec: sec-feed ...).
export const isLit = (id, lit) => Boolean(lit) && (id === lit || String(id).startsWith(`${lit}-`));

// groups: groupRows(). open: a Set of open group ids. lit: DATA <word>. sec: /api/data sec.
export function dataGrid(groups, { open = new Set(), lit = '', sec = null } = {}) {
  if (!groups?.length) return '<p class="panel-msg">No datasets listed.</p>';
  const body = groups.map((g) => groupRow(g, open.has(g.id), sec)
    + (open.has(g.id) ? g.rows.map((r) => memberRow(r, g, isLit(r.id, lit))).join('') : '')).join('');
  return `<div class="dg-scroll"><table class="grid-table dg-table">
    <colgroup><col class="c-name"><col class="c-what"><col class="c-upd"><col class="c-fresh"></colgroup>
    <thead><tr><th scope="col" class="dg-name" aria-label="Group"></th><th scope="col" class="dg-what">What</th><th scope="col" class="dg-upd">Updates</th><th scope="col" class="num dg-fresh">Fresh</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

// The groups DATA <word> opens: the group named, or those holding a lit dataset.
export function openFor(groups, lit) {
  if (!lit) return [];
  return groups.filter((g) => g.id === lit || g.rows.some((r) => isLit(r.id, lit))).map((g) => g.id);
}

// The treeKey ops for DATA over a state { open: Set, cur: data-k }. draw(): re-render
// and put the cursor on state.cur; cursor(tr): move it; top(): back to the command bar.
export function dataOps(state, { groups, draw, cursor, top }) {
  return {
    isOpen: (id) => state.open.has(id),
    cursor,
    top,
    open: (id, on) => { state.cur = `g:${id}`; if (on) state.open.add(id); else state.open.delete(id); draw(); },
    all: (on, id) => {
      if (on) for (const g of groups()) state.open.add(g.id);
      else { state.open.clear(); state.cur = `g:${id}`; }
      draw();
    },
    // Enter on an open group closes it; on a dataset it does nothing.
    enter: (tr, id, isGroup) => { if (isGroup) { state.cur = `g:${id}`; state.open.delete(id); draw(); } },
  };
}

// Down from the empty command bar moves into the table. Only that key, only then:
// anything typed in the command bar stays the command bar's.
export const intoTable = (e, cmdInput) => Boolean(cmdInput) && e.key === 'ArrowDown' && !e.defaultPrevented && e.target === cmdInput && cmdInput.value === '';

// Kept across re-renders: which groups are open and the row under the cursor.
const state = { open: new Set(), cur: null };

const KEYS_TIP = 'Down from the empty command bar (or Tab) moves in. Right or Enter opens a group, Left closes it, Space toggles, E opens all, C closes all. A click or tap opens and closes. Hover a line for its detail.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Data', `<p class="notice">DATA takes one dataset name at most, like <span class="code">DATA CPI</span>.</p>`, { cls: 'panel-solo' });
    ctx.status('DATA: CHECK THE FORMAT', 'warn');
    return;
  }
  const lit = cmd.args?.id || '';
  el.innerHTML = panel('1', 'Data', LOADING, { cls: 'panel-solo', metaId: 'data-meta', bodyCls: 'flush' });
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#data-meta');
  const cmdInput = typeof document === 'object' ? document.getElementById('cmd') : null;
  let groups = null;
  let sec = null;
  let first = true;

  const rowFor = (k) => (k ? body.querySelector(`tr[data-k="${CSS.escape(k)}"]`) : null);
  function cursor(tr, { focus = true } = {}) {
    if (!tr) return;
    state.cur = tr.dataset.k;
    focusTreeRow(body, tr, { focus });
  }
  function draw() {
    const had = body.contains(document.activeElement);
    const top = body.querySelector('.dg-scroll')?.scrollTop || 0;
    body.innerHTML = dataGrid(groups, { open: state.open, lit, sec });
    const sc = body.querySelector('.dg-scroll');
    if (sc) sc.scrollTop = top;
    const parent = state.cur?.startsWith('m:') ? `g:${state.cur.split(':')[1]}` : null;
    cursor(rowFor(state.cur) || rowFor(parent) || body.querySelector('tr.dg-group'), { focus: had });
  }
  const ops = dataOps(state, { groups: () => groups || [], draw, cursor, top: () => cmdInput?.focus() });

  body.addEventListener('keydown', (e) => { if (groups) treeKey(e, body, ops); });
  body.addEventListener('click', (e) => {
    const tr = e.target.closest?.('tr.dg-group');
    if (!tr || !groups) return;
    const id = tr.dataset.sec;
    state.cur = tr.dataset.k;
    if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
    draw();
    rowFor(state.cur)?.focus({ preventScroll: true });
  });
  const onDocKey = (e) => {
    if (!groups || !intoTable(e, cmdInput)) return;
    const t = body.querySelector('tr[data-k][tabindex="0"]');
    if (!t) return;
    e.preventDefault();
    t.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', onDocKey);
  ctx.onCleanup?.(() => document.removeEventListener('keydown', onDocKey));

  const load = () => ctx.fetchJSON('/api/data', { signal: ctx.signal }).then((d) => {
    groups = groupRows(d.rows);
    sec = d.sec;
    const opening = first;
    if (first) {
      first = false;
      if (lit) {
        state.open = new Set(openFor(groups, lit));
        const g = groups.find((x) => x.id === lit);
        const r = g ? null : groups.flatMap((x) => x.rows.map((row) => [x, row])).find(([, row]) => isLit(row.id, lit));
        state.cur = r ? `m:${r[0].id}:${r[1].id}` : g ? `g:${g.id}` : state.cur;
      }
    }
    draw();
    meta.innerHTML = `${groups.length} GROUPS <span class="dim" aria-hidden="true">·</span> ${metaNote('←→ OPEN', KEYS_TIP)}`;
    if (opening && lit && state.cur?.startsWith('m:')) body.querySelector('tr.is-lit')?.scrollIntoView?.({ block: 'center' });
    ctx.updated(d.updated, false);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('DATA: NO DATA', 'warn');
  });
  load();
  ctx.live(load, 30_000);
}
