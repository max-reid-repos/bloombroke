// DATA (alias SOURCES): where the numbers come from, in eight plain groups. Collapsed,
// each group is one row: what it holds, how often it updates, and FRESH: a dot (green
// when every dataset seen is on its own schedule, a red ring when one is late, grey when
// none is known) and when the group was last checked. A group opens (like SECTORS) to one
// line per dataset: its name, how often it updates, its own dot and data age. The detail (coverage, history, delay,
// a named US government source) sits in each dataset's tooltip; a known gap is a small
// ring by its name. No source classes or licences on screen, never a vendor name.
// DATA <dataset> opens its group with that row lit; DATA <group> (DATA MACRO) opens one.
//
// Keys (the table has the focus; Down from the empty command bar moves in, and nothing
// here reads keys typed in the command bar): Up Down move, Right or Enter opens a group,
// Left closes it, Space toggles, E opens all, C closes all. A click or tap toggles.

import { esc, panel, LOADING, metaNote } from './markets.js';
import { dash } from './company-kit.js';
import { usageCard } from '../kit.js';
import { treeKey, focusTreeRow } from './sectors.js';
import { ageWords, delayWord, lastUpdateWords } from '../provenance.js';
import { NYSE_HOLIDAYS, nyParts, marketStatus } from '../app.js';
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
// [id, short name, updates, rule?]. rule: how FRESH judges it when not by its updates
// word (SCHEDULE). WEIRD takes every weird-* gauge. A dataset the list does not name yet
// falls into a group by its server group (FALLBACK), so none is ever lost.
export const GROUPS = [
  { id: 'prices', name: 'PRICES', what: 'Stocks, ETFs, FX, crypto', updates: 'live', members: [
    ['quotes', 'Quotes', 'live', 'market'], ['futures', 'Futures', 'every minute', 'market'], ['intl', 'World indexes', 'every minute', 'daily'],
    ['sp100', 'S&P 100', 'live', 'market'], ['sectors', 'Sector ETFs', 'live', 'market'], ['bonds', 'Bond yields', 'every minute', 'daily'],
    ['crypto', 'Crypto', 'live'], ['options', 'Options', 'every minute', 'market'], ['value', 'Valuation', 'daily'],
    ['screener', 'Screener', 'daily'], ['fx', 'FX reference rates', 'daily'], ['search', 'Symbol search', 'hourly', 'fetch'],
  ] },
  { id: 'charts', name: 'CHARTS', what: 'Price history', updates: 'every minute', members: [
    ['bars', 'Price history', 'every minute', 'market'], ['whatif', 'WHATIF prices', 'daily', 'fetch'], ['guess', 'GUESS puzzle', 'daily', 'fetch'],
    ['geo', 'World map shapes', 'built in'],
  ] },
  // Company data is dated by the company's own last event (a dividend in August), so
  // it is judged by the fetch, never by its date.
  { id: 'company', name: 'COMPANY DATA', what: 'Earnings, dividends, insiders', updates: 'daily', members: [
    ['profile', 'Profiles', 'daily', 'fetch'], ['earnings', 'Earnings', 'daily', 'fetch'], ['dividends', 'Dividends', 'daily', 'fetch'],
    ['splits-hist', 'Split history', 'daily', 'fetch'], ['insiders', 'Insider trades', 'daily', 'fetch'], ['owners', 'Big holders', 'quarterly', 'fetch'],
    ['shorts', 'Short interest', 'twice a month', 'fetch'], ['ipos', 'IPO and split calendars', 'hourly'],
  ] },
  { id: 'sec', name: 'SEC FILINGS', what: 'Filings, financials', updates: 'live', members: [
    ['sec-feed', 'Latest filings', 'live', 'fetch'], ['sec-subs', 'Company filings', 'live', 'fetch'], ['sec-facts', 'Financials', 'quarterly', 'fetch'],
  ] },
  // Headlines are dated by the newest item: a quiet feed is not a late one.
  { id: 'news', name: 'NEWS', what: 'Headlines, wires', updates: 'live', members: [
    ['news', 'Market headlines', 'live', 'fetch'], ['tickernews', 'Company headlines', 'live', 'fetch'], ['news-wires', 'Press releases', 'live', 'fetch'],
    ['news-macro', 'Fed and jobs news', 'every 5 minutes', 'fetch'], ['news-wsb', 'WSB posts', 'every 5 minutes', 'fetch'], ['newslog', 'Headline log', 'live', 'fetch'],
  ] },
  { id: 'macro', name: 'MACRO', what: 'Rates, inflation, jobs', updates: 'daily', members: [
    ['treasury', 'Treasury curve', 'daily'], ['nyfed', 'Fed funds rate', 'daily'], ['fedfutures', 'Fed funds futures', 'every minute', 'market'],
    ['mortgage', 'Mortgage rates', 'weekly'], ['cpi', 'CPI inflation', 'monthly'], ['economy', 'Economy', 'monthly'],
    ['calendar', 'Economic calendar', 'hourly'],
  ] },
  { id: 'weird', name: 'WEIRD', what: 'Odd real-world gauges', updates: 'live to monthly', members: [] },
  { id: 'counters', name: 'OUR COUNTERS', what: 'Trending, site numbers', updates: 'live', members: [
    ['trending', 'Trending', 'every minute', 'fetch'], ['bbrk', 'Site numbers', 'live', 'fetch'],
  ] },
];
const FALLBACK = { Prices: 'prices', Rates: 'macro', Economy: 'macro', Companies: 'company', News: 'news', WEIRD: 'weird', Tools: 'counters' };

// A delay class in plain words, for a dataset the list does not word itself (the gauges).
const UPDATES = { 'real-time': 'live', 'delayed-10m': 'every minute', 'delayed-15m': 'every minute', 'end-of-day': 'daily', daily: 'daily', weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', static: 'rarely' };
const WEIRD_UPDATES = { bigmac: 'twice a year', beige: 'eight a year' };
// Gauges FRESH judges by their own lag: CANAL runs about 6 days behind, CDC wastewater
// about 3 weeks, box output about 3 months; WAFFLE and PIZZA can be empty for days.
const WEIRD_RULES = { canal: 'days10', sick: 'weeks5', boxes: 'months4', waffle: 'fetch', pizza: 'fetch' };

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
  GROUPS.forEach((g) => g.members.forEach(([id, short, upd, rule], i) => slot.set(id, { gid: g.id, short, upd, rule, i })));
  for (const r of rows || []) {
    if (!r?.id) continue;
    const s = slot.get(r.id);
    if (s) { byId.get(s.gid).rows.push({ ...r, short: s.short, updates: s.upd, rule: s.rule || ruleOf(s.upd), order: s.i }); continue; }
    const weird = String(r.id).startsWith('weird-');
    const gid = weird ? 'weird' : FALLBACK[r.group] || 'counters';
    const key = r.id.replace(/^weird-/, '');
    const updates = (weird && WEIRD_UPDATES[key]) || UPDATES[r.delay] || dash;
    byId.get(gid).rows.push({ ...r, short: weird ? shortWeird(r.name) : r.name, updates, rule: (weird && WEIRD_RULES[key]) || ruleOf(updates), order: 1000 });
  }
  for (const g of out) g.rows.sort((a, b) => a.order - b.order);
  return out.filter((g) => g.rows.length);
}

// ---- FRESH: on schedule ----------------------------------------------------------------

// The rule for an updates word. market: a live price, late after 30 minutes while the
// NYSE is open, else when older than the last session. daily: at most 2 trading days
// behind (a day's data is dated that day and comes out the next business day). The
// rest: the most a dataset's data can age before it is late, in days (monthly data is
// dated the first of its month and comes out weeks after the month ends). fetch: judged
// only by a good fetch (data dated by its own last event). none: built in.
const RULE_OF = { live: 'minutes', 'every minute': 'minutes', 'every 5 minutes': 'minutes', hourly: 'hours3', daily: 'daily', weekly: 'days9', 'twice a month': 'days30', monthly: 'days75', 'eight a year': 'days60', quarterly: 'days120', 'twice a year': 'days200' };
export const ruleOf = (updates) => RULE_OF[updates] || 'none';
const MAX_SECONDS = { minutes: 1800, hours3: 3 * 3600, days9: 9 * 86400, days10: 10 * 86400, days30: 30 * 86400, weeks5: 35 * 86400, days60: 60 * 86400, days75: 75 * 86400, months4: 130 * 86400, days120: 120 * 86400, days200: 200 * 86400 };

// The New York trading day of a time: a date-only stamp (midnight UTC) is its own day.
function tradingDay(iso) {
  if (/T00:00:00(\.000)?Z$/.test(iso)) return iso.slice(0, 10);
  return nyParts(new Date(iso)).date;
}
const isTrading = (day) => { const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); return dow !== 0 && dow !== 6 && !NYSE_HOLIDAYS.has(day); };
// Trading days after asOf's day, up to and including the day of `at` (ms).
export function tradingDaysBehind(asOf, at) {
  let day = tradingDay(asOf);
  const end = nyParts(new Date(at)).date;
  let n = 0;
  for (let i = 0; i < 400 && day < end; i += 1) {
    const t = new Date(`${day}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    day = t.toISOString().slice(0, 10);
    if (isTrading(day)) n += 1;
  }
  return n;
}

// When the source last answered (ms), and how old its data was then (s): NaN if unknown.
const fetchedAt = (r, now) => (Number.isFinite(r.checked_seconds) ? now - r.checked_seconds * 1000 : NaN);
// The age of the last good fetch, s. A counter kept here has no fetch: its data age.
export function fetchAge(r) {
  if (Number.isFinite(r.checked_seconds)) return r.checked_seconds;
  return r.rule === 'fetch' && Number.isFinite(r.age_seconds) ? r.age_seconds : NaN;
}

// One dataset: 'ok' (on schedule), 'late', or 'unknown' (not seen since the server
// started, or built in). Judged at its last fetch, so a feed nobody opened is not late.
export function scheduleState(r, now = Date.now()) {
  const rule = r.rule || 'none';
  if (rule === 'none') return 'unknown';
  if (rule === 'fetch') return Number.isFinite(fetchAge(r)) ? 'ok' : 'unknown';
  const at = fetchedAt(r, now);
  const t = Date.parse(r.as_of || '');
  if (!Number.isFinite(at) || !Number.isFinite(t)) return 'unknown';
  const lag = Math.max(0, (at - t) / 1000);
  if (rule === 'daily') return tradingDaysBehind(r.as_of, at) <= 2 ? 'ok' : 'late';
  if (rule === 'market') {
    if (lag <= MAX_SECONDS.minutes) return 'ok';
    return marketStatus(new Date(at)) === 'OPEN' ? 'late' : tradingDaysBehind(r.as_of, at) <= 1 ? 'ok' : 'late';
  }
  return lag <= (MAX_SECONDS[rule] ?? Infinity) ? 'ok' : 'late';
}

// A group: late when any dataset is late, ok when those known are all on schedule,
// unknown when none is known. late: the late ones; age: its newest good fetch (s).
export function groupFresh(rows, now = Date.now()) {
  const states = (rows || []).map((r) => [r, scheduleState(r, now)]);
  const late = states.filter(([, st]) => st === 'late').map(([r]) => r);
  const ok = states.filter(([, st]) => st === 'ok').length;
  const ages = (rows || []).map(fetchAge).filter(Number.isFinite);
  return { state: late.length ? 'late' : ok ? 'ok' : 'unknown', late, ok, total: states.filter(([r]) => (r.rule || 'none') !== 'none').length, age: ages.length ? Math.min(...ages) : NaN };
}
// The dot: green on schedule, a hollow red ring when late, grey when unknown.
const DOT_STATE = { ok: 'ok', late: 'failing', unknown: 'none' };

// The group dot's tooltip, one line.
export function freshTitle(f) {
  const last = Number.isFinite(f.age) ? ` Last check ${ageWords(f.age)} ago.` : '';
  if (f.state === 'late') return `Late: ${f.late.map((r) => `${r.short} (${r.updates}, data from ${lastUpdateWords(r.as_of)})`).join(', ')}.${last}`;
  if (f.state === 'ok') return `On schedule: ${f.ok} of ${f.total} checked since the server started, each within its usual update gap.${last}`;
  return 'Not checked since the server started.';
}

// The gap text of a row, or '' when it has none.
export const gapOf = (r) => (r.gaps && r.gaps !== '--' && r.gaps !== dash ? String(r.gaps) : '');

// The tooltip of a dataset row: its full name, then the detail.
export function memberTitle(r, now = Date.now()) {
  const src = govSource(r.source);
  return [
    r.name,
    src ? `Source: ${src}` : '',
    r.coverage && r.coverage !== '--' ? `Covers: ${r.coverage}` : '',
    r.history && r.history !== '--' ? `History: ${r.history}` : '',
    r.cadence && r.cadence !== '--' ? `Updates: ${r.cadence}` : '',
    `Delay: ${delayWord(r.delay)}`,
    ageTitle(r),
    { ok: 'On schedule', late: 'Late for its schedule', unknown: '' }[scheduleState(r, now)],
    gapOf(r) ? `Gap: ${gapOf(r)}` : '',
  ].filter(Boolean).join('\n');
}

const dot = (state) => `<span class="sx-dot" data-state="${state}" aria-hidden="true"></span>`;
const ageText = (s) => (Number.isFinite(s) ? ageWords(s) : dash);

function groupTitle(g, sec) {
  return g.id === 'sec' ? `${secLine(sec)}. ${SEC_TIP}` : '';
}

function groupRow(g, open, sec, now) {
  const f = groupFresh(g.rows, now);
  const title = groupTitle(g, sec);
  return `<tr class="dg-group${open ? ' is-open' : ''}" data-k="g:${esc(g.id)}" data-sec="${esc(g.id)}" tabindex="-1" aria-expanded="${open}"${title ? ` title="${esc(title)}"` : ''}>
    <th scope="row" class="dg-name"><span class="dg-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>${esc(g.name)}</th>
    <td class="dg-what">${esc(g.what)}</td>
    <td class="dg-upd">${esc(g.updates)}</td>
    <td class="num dg-fresh" title="${esc(freshTitle(f))}">${dot(DOT_STATE[f.state])}${esc(ageText(f.age))}</td>
  </tr>`;
}

function memberRow(r, g, lit, now) {
  const gap = gapOf(r);
  const mark = gap ? `<span class="dg-gap" role="img" aria-label="${esc(`Gap: ${gap}`)}" title="${esc(gap)}"></span>` : '';
  return `<tr id="data-${esc(r.id)}" class="dg-mem${lit ? ' is-lit' : ''}" data-k="m:${esc(g.id)}:${esc(r.id)}" data-parent="${esc(g.id)}" tabindex="-1" title="${esc(memberTitle(r, now))}">
    <th scope="row" class="dg-name" colspan="2">${esc(r.short)}${mark}</th>
    <td class="dg-upd">${esc(r.updates)}</td>
    <td class="num dg-fresh">${dot(DOT_STATE[scheduleState(r, now)])}${esc(ageText(r.age_seconds))}</td>
  </tr>`;
}

// Does a dataset id match DATA <word>? The id itself, or its family (sec: sec-feed ...).
export const isLit = (id, lit) => Boolean(lit) && (id === lit || String(id).startsWith(`${lit}-`));

// groups: groupRows(). open: a Set of open group ids. lit: DATA <word>. sec: /api/data sec.
// now: the clock FRESH judges by (ms).
export function dataGrid(groups, { open = new Set(), lit = '', sec = null, now = Date.now() } = {}) {
  if (!groups?.length) return '<p class="panel-msg">No datasets listed.</p>';
  const body = groups.map((g) => groupRow(g, open.has(g.id), sec, now)
    + (open.has(g.id) ? g.rows.map((r) => memberRow(r, g, isLit(r.id, lit), now)).join('') : '')).join('');
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

// A command typed wrong: the kit's usage card.
export const dataUsage = () => usageCard({ problem: 'DATA takes one dataset name at most.', format: 'DATA [<dataset>]', example: 'DATA CPI' });

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Data', dataUsage(), { cls: 'panel-solo' });
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
