// SECTORS: periods, members, pt, breadth, keys, URL, --, the map, SWIM and BREADTH rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  makeSectors, periodBases, periodMove, yearBefore, cleanPeriod, mapLimit, SECTOR_ETFS, PERIODS as DATA_PERIODS, BASES_RETRY,
} from '../data/sectors.js';
import { SP100, SECTORS } from '../data/sp100.js';
import {
  parse, sectorsCmd, swimCmd, toInput, memberCaps, contributions, startCap, showWho, listedLine, WHO_MIN, tileShows, TILE_MIN, listedMove, breadth, fmtBreadth, topContributors, fmtPt, whoLine,
  sectorModel, tableHtml, treeKey, mapLayout, nextBox, mapSvg, mapFill, mapHeight, PERIODS, MAP_SCALE, secOfKey, SPLIT_MIN_W,
} from '../public/screens/sectors.js';
import { parse as fishParse, SPECIES } from '../public/screens/fishtank.js';
import { matchWeird } from '../public/commands-weird.js';
import { parseCommand, urlFor } from '../public/app.js';
import { findCommand, REGISTRY, ALIASES } from '../public/registry.js';
import { sectorTable } from '../public/screens/breadth.js';
import { sectorBreadth } from '../data/breadth.js';

const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body, headers: { get: () => null } });
const at = (d) => Date.parse(`${d}T04:00:00Z`); // midnight New York in summer
const NOW = Date.parse('2026-09-25T18:00:00Z'); // a Friday afternoon in New York

// ---- data: periods and bases ------------------------------------------------------------

test('sectors data: the five periods, anything else is 1D', () => {
  assert.deepEqual(DATA_PERIODS, ['1D', '1W', '1M', 'YTD', '1Y']);
  assert.deepEqual(PERIODS, DATA_PERIODS, 'the screen and the server agree');
  assert.equal(cleanPeriod('ytd'), 'YTD');
  assert.equal(cleanPeriod('5Y'), '1D');
  assert.equal(cleanPeriod(undefined), '1D');
  assert.equal(yearBefore('2026-09-25'), '2025-09-25');
  assert.equal(yearBefore('2028-02-29'), '2027-02-28');
});

test('sectors data: each period starts from the right past close', () => {
  const pts = [
    { t: at('2025-09-01'), v: 50 },
    { t: at('2025-12-31'), v: 80 },
    { t: at('2026-08-25'), v: 90 },
    { t: at('2026-09-18'), v: 95 },
    { t: at('2026-09-24'), v: 99 },
  ];
  assert.deepEqual(periodBases(pts, '2026-09-25'), { '1W': 95, '1M': 90, YTD: 80, '1Y': 50 });
  // Closes that start after a period's day: that period is unknown, not the first close.
  assert.deepEqual(periodBases(pts.slice(2), '2026-09-25'), { '1W': 95, '1M': 90, YTD: null, '1Y': null });
  assert.deepEqual(periodBases([], '2026-09-25'), { '1W': null, '1M': null, YTD: null, '1Y': null });
  assert.equal(periodMove('1D', { last: 110, changePct: 1.5 }, null), 1.5);
  assert.equal(periodMove('1D', { last: 110, changePct: null }, null), null, 'no day move: null, never 0');
  assert.equal(periodMove('1W', { last: 104.5, changePct: 1 }, { '1W': 95 }), 10);
  assert.equal(periodMove('1Y', { last: 104.5 }, { '1Y': null }), null);
  assert.equal(periodMove('1M', { last: null }, { '1M': 90 }), null);
});

test('sectors data: mapLimit keeps order and at most n running', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 2));
    running -= 1;
    return x * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
  assert.ok(peak <= 3);
});

function fakeWorld({ failCharts = new Set(), now = () => NOW, warm = false } = {}) {
  const etfRows = SECTOR_ETFS.map((e) => (e.id === 'XLB'
    ? { symbol: e.src, code: 0, last: '100.00', change: 'UNCH', change_pct: 'UNCH', last_time: '2026-09-25T14:00:00.000-0400' }
    : { symbol: e.src, code: 0, last: '104.50', change: '+1.00', change_pct: '+0.97%', last_time: '2026-09-25T14:00:00.000-0400' }));
  const fetchImpl = async () => json({ FormattedQuoteResult: { FormattedQuote: etfRows } });
  const calls = [];
  const getChart = async (sym, spec) => {
    calls.push({ sym, spec });
    if (failCharts.has(sym)) throw new Error('down');
    return { points: [{ t: at('2025-09-01'), v: 50 }, { t: at('2025-12-31'), v: 80 }, { t: at('2026-08-25'), v: 90 }, { t: at('2026-09-18'), v: 95 }] };
  };
  const stocks = SP100.map((m, i) => ({
    ...m, last: 104.5, marketCap: (i + 1) * 1e10, changePct: m.ticker === 'NVDA' ? null : 1,
  }));
  const getStocks = async () => ({ stocks, stale: false, asOfList: '2026-09-21' });
  const s = makeSectors({ fetchImpl, getChart, getStocks, now, warm });
  return { ...s, calls };
}

test('sectors data: 1D needs no past closes; 1W to 1Y fetch them once a day', async () => {
  let t = NOW;
  const w = fakeWorld({ now: () => t });
  const d1 = await w.getSectors({ period: '1D' });
  assert.equal(d1.period, '1D');
  assert.equal(w.calls.length, 0, '1D is the day move from the quote');
  assert.equal(d1.sectors.length, 11);
  assert.equal(d1.members.length, SP100.length);
  const xlk = d1.sectors.find((x) => x.id === 'XLK');
  assert.equal(xlk.key, 'TECH');
  assert.equal(xlk.move, 0.97);
  assert.equal(d1.sectors.find((x) => x.id === 'XLB').move, null, 'no day move: null (--), never 0');
  assert.equal(d1.members.find((m) => m.ticker === 'NVDA').move, null);

  const d2 = await w.getSectors({ period: '1w' });
  assert.equal(d2.period, '1W');
  assert.equal(w.calls.length, 11 + SP100.length, 'every ETF and member once');
  assert.ok(w.calls.every((c) => c.spec.from === '2025-09-15'), 'a year and ten days back');
  assert.equal(d2.sectors.find((x) => x.id === 'XLK').move, 10);
  assert.equal(d2.members.find((m) => m.ticker === 'NVDA').move, 10, 'the period move needs no day move');
  const d3 = await w.getSectors({ period: 'YTD' });
  assert.equal(w.calls.length, 11 + SP100.length, 'same day: no new fetches');
  assert.ok(Math.abs(d3.members[0].move - 30.625) < 1e-9);
  t = NOW + 24 * 3600_000;
  await w.getSectors({ period: '1M' });
  assert.equal(w.calls.length, 2 * (11 + SP100.length), 'a new day starts over');
});

test('sectors data: a 1D visit warms the past closes without waiting on them', async () => {
  const w = fakeWorld({ warm: true });
  const d = await w.getSectors();
  assert.equal(d.period, '1D');
  assert.ok(w.calls.length > 0, 'the loading has started');
  await w.getBases();
  const n = w.calls.length;
  assert.equal(n, 11 + SP100.length);
  await w.getSectors({ period: '1Y' });
  assert.equal(w.calls.length, n, '1Y then needs no fetch');
});

test('sectors data: a missing chart is --, and only it is tried again', async () => {
  let t = NOW;
  const w = fakeWorld({ failCharts: new Set(['AAPL', 'XLE']), now: () => t });
  const d = await w.getSectors({ period: '1M' });
  assert.equal(d.members.find((m) => m.ticker === 'AAPL').move, null);
  assert.equal(d.sectors.find((x) => x.id === 'XLE').move, null);
  assert.ok(Math.abs(d.members.find((m) => m.ticker === 'MSFT').move - (104.5 / 90 * 100 - 100)) < 1e-9);
  const before = w.calls.length;
  t = NOW + BASES_RETRY + 1;
  await w.getSectors({ period: '1M' });
  assert.deepEqual(w.calls.slice(before).map((c) => c.sym).sort(), ['AAPL', 'XLE']);
});

test('sectors data: a slow or dead source never holds a request long', async () => {
  let t = NOW;
  let releaseAapl;
  const aapl = new Promise((r) => { releaseAapl = r; });
  const pts = { points: [{ t: at('2025-09-01'), v: 50 }, { t: at('2025-12-31'), v: 80 }, { t: at('2026-08-25'), v: 90 }, { t: at('2026-09-18'), v: 95 }] };
  const hang = new Set();
  const calls = [];
  const getChart = (sym) => {
    calls.push(sym);
    if (sym === 'AAPL' && calls.filter((c) => c === 'AAPL').length === 1) return aapl.then(() => pts);
    if (hang.has(sym)) return new Promise(() => {}); // never answers
    if (sym === 'XLE') return Promise.reject(new Error('down'));
    return Promise.resolve(pts);
  };
  const fetchImpl = async () => json({ FormattedQuoteResult: { FormattedQuote: SECTOR_ETFS.map((e) => ({ symbol: e.src, code: 0, last: '104.50', change: '+1', change_pct: '+1%' })) } });
  const stocks = SP100.map((m) => ({ ...m, last: 104.5, marketCap: 1e11, changePct: 1 }));
  const s = makeSectors({ fetchImpl, getChart, getStocks: async () => ({ stocks }), now: () => t, warm: false, basesWait: 300 });
  const t0 = Date.now();
  const d = await s.getSectors({ period: '1W' });
  const waited = Date.now() - t0;
  assert.ok(waited >= 250 && waited < 1500, `a new day waits basesWait at most (${waited} ms)`);
  assert.equal(d.members.find((m) => m.ticker === 'AAPL').move, null, 'still loading: --');
  assert.equal(d.members.find((m) => m.ticker === 'MSFT').move, 10, 'what came in is used');
  releaseAapl();
  await s.getBases(); // the load finishes: XLE missing
  // Later the same day the source is dead: the saved closes at once, XLE retried behind.
  hang.add('XLE');
  t = NOW + BASES_RETRY + 1;
  const before = calls.length;
  const t1 = Date.now();
  const d2 = await s.getSectors({ period: '1W' });
  assert.ok(Date.now() - t1 < 100, 'the same day: no wait');
  assert.equal(d2.members.find((m) => m.ticker === 'AAPL').move, 10);
  assert.deepEqual(calls.slice(before), ['XLE'], 'only the missing one is tried again');
});

// ---- the numbers ----------------------------------------------------------------------------

const MEMBERS = [
  { ticker: 'AMZN', name: 'Amazon', sector: 'DISC', marketCap: 2.4e12, move: 1 },
  { ticker: 'TSLA', name: 'Tesla', sector: 'DISC', marketCap: 1.2e12, move: 2 },
  { ticker: 'HD', name: 'Home Depot', sector: 'DISC', marketCap: 0.4e12, move: -1 },
  { ticker: 'GM', name: 'General Motors', sector: 'DISC', marketCap: null, move: 3 },
  { ticker: 'SBUX', name: 'Starbucks', sector: 'DISC', marketCap: 1e11, move: null },
];

test('sectors: weights sum to 1 and pt sums to the listed members move', () => {
  const rows = contributions(MEMBERS);
  const w = rows.filter((r) => r.weight != null);
  assert.equal(w.length, 3, 'no cap or no move: left out');
  assert.ok(Math.abs(w.reduce((t, r) => t + r.weight, 0) - 1) < 1e-12);
  const start = 2.4 / 1.01 + 1.2 / 1.02 + 0.4 / 0.99;
  assert.ok(Math.abs(rows.find((r) => r.ticker === 'AMZN').weight - (2.4 / 1.01) / start) < 1e-12, 'weight by the cap at the start');
  assert.equal(rows.find((r) => r.ticker === 'GM').pt, null);
  assert.equal(rows.find((r) => r.ticker === 'SBUX').pt, null);
  const real = ((2.4 + 1.2 + 0.4) / start - 1) * 100;
  assert.ok(Math.abs(listedMove(rows) - real) < 1e-9, 'the pt add up to the listed members\' real move');
  assert.equal(listedMove(contributions([{ ticker: 'X', marketCap: 1, move: null }])), null);
  assert.deepEqual(contributions([]), []);
});

test('sectors: pt weights by the cap at the start of the period', () => {
  // Two equal caps today, one doubled and one flat: together they rose a third, not a half.
  const rows = contributions([{ ticker: 'A', marketCap: 1e12, move: 100 }, { ticker: 'B', marketCap: 1e12, move: 0 }]);
  assert.ok(Math.abs(rows[0].weight - 1 / 3) < 1e-12);
  assert.ok(Math.abs(rows[1].weight - 2 / 3) < 1e-12);
  assert.ok(Math.abs(listedMove(rows) - 100 / 3) < 1e-9, '+33.33%, not +50%');
  assert.equal(startCap(2e12, 100), 1e12);
  assert.equal(startCap(1e12, -100), null, 'a total loss has no start cap');
  assert.equal(startCap(null, 5), null);
  assert.equal(startCap(1e12, null), null);
});

test('sectors: GOOG and GOOGL count as one company', () => {
  const caps = memberCaps([
    { ticker: 'GOOG', marketCap: 4e12 }, { ticker: 'GOOGL', marketCap: 4e12 }, { ticker: 'META', marketCap: 2e12 },
  ]);
  assert.equal(caps.get('GOOG'), 2e12);
  assert.equal(caps.get('GOOGL'), 2e12);
  assert.equal(caps.get('META'), 2e12);
  assert.equal(memberCaps([{ ticker: 'GOOGL', marketCap: 4e12 }]).get('GOOGL'), 4e12, 'one class listed: the whole cap');
});

test('sectors: breadth counts known moves only', () => {
  const b = breadth(MEMBERS);
  assert.deepEqual(b, { up: 3, known: 4, total: 5 });
  assert.equal(fmtBreadth(b), '3/4 up');
  assert.equal(fmtBreadth(breadth([{ move: null }])), '--');
  assert.equal(fmtBreadth(breadth([])), '--');
});

test('sectors: who moved it is the two biggest pt either way, facts only', () => {
  const rows = contributions(MEMBERS);
  assert.deepEqual(topContributors(rows).map((r) => r.ticker), ['AMZN', 'TSLA']);
  assert.equal(whoLine(rows), 'AMZN +0.60 pt, TSLA +0.59 pt');
  const neg = contributions([{ ticker: 'A', marketCap: 1, move: 1 }, { ticker: 'B', marketCap: 3, move: -2 }]);
  assert.equal(whoLine(neg), 'B −1.51 pt, A +0.24 pt');
  assert.equal(whoLine([]), '--');
  assert.equal(fmtPt(null), '--');
  assert.equal(fmtPt(0.004), '0.00 pt');
});

test('sectors: the listed total comes first; who moved it only when it can explain the ETF', () => {
  const sec = (id, move, members) => ({ id, move, members: contributions(members) });
  const three = [
    { ticker: 'A', marketCap: 3, move: 1 }, { ticker: 'B', marketCap: 2, move: 1 }, { ticker: 'C', marketCap: 1, move: -1 },
  ];
  const up = sec('XLK', 0.4, three);
  assert.equal(WHO_MIN, 3);
  assert.ok(showWho(up));
  assert.match(listedLine(up), /^Listed 3 of XLK: \+0\.\d\d% · A \+0\.\d\d pt, B \+0\.\d\d pt$/);
  // XLRE: one listed member moving against the ETF. The total, never "AMT +1.06 pt".
  const re = sec('XLRE', -0.22, [{ ticker: 'AMT', marketCap: 1e11, move: 1.06 }]);
  assert.ok(!showWho(re));
  assert.equal(listedLine(re), 'Listed 1 of XLRE: +1.06%');
  const against = sec('XLY', -0.3, three);
  assert.ok(!showWho(against), 'listed total up, ETF down: no who line');
  assert.equal(listedLine(against).includes('·'), false);
  assert.ok(!showWho(sec('XLY', null, three)), 'no ETF move: nothing to explain');
  assert.ok(showWho(sec('XLY', 0, three)), 'a flat ETF is not the opposite side');
  assert.equal(listedLine(sec('XLB', 0.1, [])), 'Listed 0 of XLB: --');
});

test('sectors: the model keeps the ETF order and sorts members by cap', () => {
  const d = {
    sectors: [{ id: 'XLY', key: 'DISC', name: 'Consumer Discretionary', move: 0.5 }, { id: 'XLB', key: 'MAT', name: 'Materials', move: null }],
    members: [...MEMBERS].reverse(),
  };
  const m = sectorModel(d);
  assert.deepEqual(m.map((s) => s.id), ['XLY', 'XLB']);
  assert.deepEqual(m[0].members.map((x) => x.ticker), ['AMZN', 'TSLA', 'HD', 'SBUX', 'GM']);
  assert.deepEqual(m[1].members, []);
  assert.equal(m[1].move, null);
  assert.deepEqual(sectorModel(null), []);
});

// ---- URL state -------------------------------------------------------------------------------

test('sectors: period and view in the command and the URL', () => {
  assert.deepEqual(parse([]), { period: '1D', view: 'TABLE' });
  assert.deepEqual(parse(['map', '1m']), { period: '1M', view: 'MAP' });
  assert.deepEqual(parse(['XYZ', 'YTD']), { period: 'YTD', view: 'TABLE' }, 'other words ignored');
  assert.equal(sectorsCmd({}), 'SECTORS');
  assert.equal(sectorsCmd({ period: '1W' }), 'SECTORS 1W');
  assert.equal(sectorsCmd({ period: '1D', view: 'MAP' }), 'SECTORS MAP');
  assert.equal(sectorsCmd({ period: 'YTD', view: 'MAP' }), 'SECTORS YTD MAP');
  for (const p of PERIODS) for (const v of ['TABLE', 'MAP']) assert.deepEqual(parse(sectorsCmd({ period: p, view: v }).split(' ').slice(1)), { period: p, view: v });
  const c = parseCommand('SECTORS 1W MAP');
  assert.equal(c.name, 'SECTORS');
  assert.deepEqual(c.args, { period: '1W', view: 'MAP' });
  assert.equal(c.input, 'SECTORS 1W MAP');
  assert.deepEqual(parseCommand('sectors').args, { period: '1D', view: 'TABLE' });
  assert.equal(parseCommand('SECTORS FOO map 1y').input, 'SECTORS 1Y MAP', 'the URL keeps the clean form');
  assert.equal(parseCommand('SECTORS 1D TABLE').input, 'SECTORS');
  assert.equal(urlFor('SECTORS FOO 1W').url, 'SECTORS 1W', 'a link with junk opens at the clean URL');
  assert.equal(toInput({ period: 'YTD', view: 'TABLE' }), 'SECTORS YTD');
});

test('sectors: HELP entry, every example runs, no pro-terminal function codes', () => {
  const h = findCommand('SECTORS');
  assert.ok(h.examples.includes('SECTORS 1M'));
  for (const e of h.examples) assert.equal(parseCommand(e).name, 'SECTORS', e);
  const names = [...REGISTRY.map((c) => c.name), ...Object.keys(ALIASES)];
  assert.ok(names.includes('SECTORS') && names.length > 50);
  for (const bad of ['IMAP', 'MEMB', 'MOV', 'RRG']) {
    assert.ok(!names.includes(bad), `${bad} is not a command`);
    assert.notEqual(parseCommand(bad).name, bad);
  }
});

// ---- TABLE -----------------------------------------------------------------------------------

const MODEL = sectorModel({
  sectors: [
    { id: 'XLK', key: 'TECH', name: 'Technology', move: 1.2 },
    { id: 'XLY', key: 'DISC', name: 'Consumer Discretionary', move: null },
  ],
  members: [...MEMBERS, { ticker: 'NVDA', name: 'Nvidia', sector: 'TECH', marketCap: 4e12, move: 2 }],
});

test('sectors table: collapsed is one line a sector, -- for an unknown move', () => {
  const html = tableHtml(MODEL);
  assert.equal((html.match(/class="sc-row/g) || []).length, 2);
  assert.equal((html.match(/class="sc-mem/g) || []).length, 0);
  assert.match(html, /data-cmd="XLK"/, 'the ETF links by its symbol');
  assert.match(html, /data-cmd="XLY"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /1\/1 up/);
  assert.match(html, /sc-move flat">--</, 'unknown move: --');
  assert.doesNotMatch(html, /0\.00%/, 'never a made-up 0.00%');
});

test('sectors table: an open sector shows who moved it, SWIM and its members', () => {
  const withMove = MODEL.map((s) => (s.id === 'XLY' ? { ...s, move: 0.5 } : s));
  const html = tableHtml(withMove, { open: new Set(['XLY']) });
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Listed 5 of XLY: \+1\.09% · AMZN \+0\.60 pt, TSLA \+0\.59 pt/);
  assert.match(tableHtml(MODEL, { open: new Set(['XLY']) }), /Listed 5 of XLY: \+1\.09%</, 'no ETF move: the total only');
  assert.match(html, /data-cmd="FISHTANK DISC"[^>]*>SWIM</);
  assert.equal((html.match(/class="sc-mem/g) || []).length, 5);
  assert.match(html, /data-k="m:XLY:GM"[\s\S]*?--<\/td>/, 'no cap: pt --');
  assert.equal(swimCmd('TECH'), 'FISHTANK TECH');
});

// A table as rows with data-k, in the order SECTORS draws them, for treeKey.
function fakeTable(model, state) {
  const rows = [];
  for (const s of model) {
    rows.push({ dataset: { k: `s:${s.id}`, sec: s.id } });
    if (state.open.has(s.id)) {
      rows.push({ dataset: { k: `w:${s.id}`, parent: s.id } });
      for (const m of s.members) rows.push({ dataset: { k: `m:${s.id}:${m.ticker}`, parent: s.id, cmd: m.ticker } });
    }
  }
  for (const r of rows) r.closest = () => r;
  return { querySelectorAll: () => rows, rows };
}

function press(state, model, key, ran = []) {
  const host = fakeTable(model, state);
  const tr = host.rows.find((r) => r.dataset.k === state.cur) || host.rows[0];
  let prevented = false;
  const e = { key, target: tr, preventDefault: () => { prevented = true; }, stopPropagation() {} };
  const took = treeKey(e, host, {
    isOpen: (id) => state.open.has(id),
    cursor: (r) => { if (r) state.cur = r.dataset.k; },
    top: () => { state.cur = 'BAR'; },
    open: (id, on) => { state.cur = `s:${id}`; if (on) state.open.add(id); else state.open.delete(id); },
    all: (on, sec) => { if (on) for (const s of model) state.open.add(s.id); else { state.open.clear(); state.cur = `s:${sec}`; } },
    enter: (r, sec, isSec) => ran.push(isSec ? sec : r.dataset.cmd || `SWIM ${sec}`),
    more: { M: () => ran.push('MAP') },
  });
  assert.equal(took, prevented);
  return took;
}

test('sectors keys: arrows, Right/Enter open, Left closes, Space toggles, E and C', () => {
  const state = { open: new Set(), cur: 's:XLK' };
  const ran = [];
  press(state, MODEL, 'ArrowDown');
  assert.equal(state.cur, 's:XLY');
  press(state, MODEL, 'ArrowRight');
  assert.ok(state.open.has('XLY'), 'Right opens');
  press(state, MODEL, 'ArrowRight');
  assert.equal(state.cur, 'w:XLY', 'Right on an open sector steps in');
  press(state, MODEL, 'Enter', ran);
  assert.deepEqual(ran, ['SWIM XLY']);
  press(state, MODEL, 'ArrowDown');
  assert.equal(state.cur, 'm:XLY:AMZN');
  press(state, MODEL, 'Enter', ran);
  assert.deepEqual(ran, ['SWIM XLY', 'AMZN'], 'Enter on a member opens its quote');
  press(state, MODEL, 'ArrowLeft');
  assert.ok(!state.open.has('XLY'), 'Left from a member closes its sector');
  assert.equal(state.cur, 's:XLY', 'and the cursor goes back to the sector');
  press(state, MODEL, 'Enter');
  assert.ok(state.open.has('XLY'), 'Enter opens a closed sector');
  press(state, MODEL, 'Enter', ran);
  assert.equal(ran.at(-1), 'XLY', 'Enter on an open sector opens the ETF');
  press(state, MODEL, ' ');
  assert.ok(!state.open.has('XLY'), 'Space toggles');
  press(state, MODEL, 'e');
  assert.deepEqual([...state.open].sort(), ['XLK', 'XLY'], 'E opens all');
  press(state, MODEL, 'End');
  assert.equal(state.cur, 'm:XLY:GM');
  press(state, MODEL, 'C');
  assert.equal(state.open.size, 0, 'C closes all');
  assert.equal(state.cur, 's:XLY');
  press(state, MODEL, 'Home');
  press(state, MODEL, 'ArrowUp');
  assert.equal(state.cur, 'BAR', 'Up on the top row goes back to the command bar');
  state.cur = 's:XLK';
  press(state, MODEL, 'm', ran);
  assert.equal(ran.at(-1), 'MAP');
  assert.equal(press(state, MODEL, 'x'), false, 'other letters go to the command bar');
  assert.equal(press(state, MODEL, '5'), false);
});

// ---- MAP -------------------------------------------------------------------------------------

test('sectors map: sectors sized by cap, members inside, the zoom fills the map', () => {
  const W = 800;
  const H = 400;
  const lay = mapLayout(MODEL, W, H);
  assert.deepEqual(lay.secs.map((s) => s.id).sort(), ['XLK', 'XLY']);
  const area = (r) => r.w * r.h;
  const total = lay.secs.reduce((t, s) => t + area(s), 0);
  assert.ok(Math.abs(total - W * H) < 1, 'the sectors fill the map');
  const k = lay.secs.find((s) => s.id === 'XLK');
  const y = lay.secs.find((s) => s.id === 'XLY');
  // TECH: NVDA 4e12; DISC: AMZN 2.4 + TSLA 1.2 + HD 0.4 + SBUX 0.1 (GM has no cap).
  assert.ok(Math.abs(area(k) / area(y) - 4 / 4.1) < 1e-6, 'area follows cap');
  assert.equal(lay.cells.filter((c) => c.sector === 'XLY').length, 4, 'no cap: no box');
  for (const c of lay.cells) {
    const s = lay.secs.find((x) => x.id === c.sector);
    assert.ok(c.x >= s.x - 1e-6 && c.y >= s.y + s.head - 1e-6 && c.x + c.w <= s.x + s.w + 1e-6 && c.y + c.h <= s.y + s.h + 1e-6, `${c.ticker} inside its sector`);
  }
  const amzn = lay.cells.find((c) => c.ticker === 'AMZN');
  const tsla = lay.cells.find((c) => c.ticker === 'TSLA');
  assert.ok(Math.abs(area(amzn) / area(tsla) - 2) < 1e-6, 'member area follows cap');
  const z = mapLayout(MODEL, W, H, 'XLY');
  assert.equal(z.secs.length, 1);
  assert.deepEqual([z.secs[0].w, z.secs[0].h], [W, H], 'the zoomed sector fills the map');
  assert.equal(z.cells.length, 4);
  assert.deepEqual(mapLayout([], W, H), { secs: [], cells: [] });
});

test('sectors map: arrows move to the nearest box that way, green and red only', () => {
  const boxes = [
    { id: 'A', x: 0, y: 0, w: 100, h: 100 }, { id: 'B', x: 100, y: 0, w: 100, h: 100 },
    { id: 'C', x: 0, y: 100, w: 100, h: 100 }, { id: 'D', x: 100, y: 100, w: 100, h: 100 },
  ];
  assert.equal(nextBox(boxes, 'A', 'ArrowRight'), 'B');
  assert.equal(nextBox(boxes, 'A', 'ArrowDown'), 'C');
  assert.equal(nextBox(boxes, 'D', 'ArrowLeft'), 'C');
  assert.equal(nextBox(boxes, 'D', 'ArrowUp'), 'B');
  assert.equal(nextBox(boxes, 'A', 'ArrowLeft'), 'A', 'stays at the edge');
  assert.equal(nextBox(boxes, 'nope', 'ArrowLeft'), 'A');
  assert.deepEqual(Object.keys(MAP_SCALE), PERIODS);
  for (const p of PERIODS) {
    for (const v of [-50, -1, 1, 50]) {
      const hue = Number(/hsl\((\d+)/.exec(mapFill(v, p))[1]);
      assert.ok(hue === 0 || hue === 147, `${v} on ${p}: green or red, never amber`);
    }
  }
  assert.equal(mapFill(null), mapFill(0), 'unknown is the flat grey');
  assert.ok(!tileShows({ w: 30, h: 50 }, 'ticker') && tileShows({ w: 40, h: 25 }, 'ticker') && !tileShows({ w: 40, h: 25 }, 'pct'));
  assert.ok(tileShows({ w: 80, h: 50 }, 'pct'));
  const tiny = mapSvg(MODEL, { secs: [], cells: [{ ticker: 'TINY', name: 'T', sector: 'XLK', move: 1, pt: 1, cap: 1, x: 0, y: 0, w: 20, h: 12 }, { ticker: 'MID', name: 'M', sector: 'XLK', move: 1, pt: 1, cap: 1, x: 0, y: 0, w: 50, h: 30 }] }, { w: 100, h: 100 });
  assert.doesNotMatch(tiny, /class="hm-t"[^>]*>TINY</, 'a small box has no label');
  assert.match(tiny, /class="hm-t"[^>]*>MID</);
  assert.equal((tiny.match(/class="hm-p"/g) || []).length, 0, 'a middling box: the ticker only');
  assert.deepEqual(Object.keys(TILE_MIN), ['ticker', 'pct']);
  assert.equal(mapHeight(800, { stretched: 500 }), 500);
  assert.equal(mapHeight(390), 507);
  assert.equal(mapHeight(390, { embed: { viewport: 600, top: 100 } }), 499);
  const svg = mapSvg(MODEL, mapLayout(MODEL, 800, 400), { w: 800, h: 400, cur: 'XLK' });
  assert.match(svg, /class="sc-mcur"/);
  assert.match(svg, /data-cmd="NVDA"/);
  assert.match(mapSvg(MODEL, mapLayout(MODEL, 800, 400, 'XLY'), { w: 800, h: 400, zoom: 'XLY', cur: 'AMZN' }), /3\/4 up/);
});

test('sectors split: the map beside the table picks sectors, it never links away', () => {
  assert.equal(SPLIT_MIN_W, 1280);
  assert.equal(secOfKey('s:XLK'), 'XLK');
  assert.equal(secOfKey('w:XLY'), 'XLY');
  assert.equal(secOfKey('m:XLY:AMZN'), 'XLY');
  assert.equal(secOfKey(null), null);
  const lay = mapLayout(MODEL, 600, 400);
  const side = mapSvg(MODEL, lay, { w: 600, h: 400, cur: 'XLY', select: true });
  assert.doesNotMatch(side, /data-cmd=|href=/, 'no links: a tile selects its sector');
  assert.match(side, /<g class="hm-a" data-sec="XLY" data-t="AMZN">/);
  assert.match(side, /class="sc-mcur"/, 'the cursor row\'s sector is outlined');
  const y = lay.secs.find((x) => x.id === 'XLY');
  assert.match(side, new RegExp(`sc-mcur" x="${(y.x + 1).toFixed(1)}" y="${(y.y + 1).toFixed(1)}"`));
  assert.match(mapSvg(MODEL, lay, { w: 600, h: 400 }), /data-cmd="AMZN"/, 'the full map still links');
});

// ---- SWIM and BREADTH ------------------------------------------------------------------------

test('SWIM: FISHTANK takes a sector and keeps it in the URL', () => {
  for (const key of Object.keys(SECTORS)) assert.ok(SPECIES[key], `${key} has a species`);
  assert.deepEqual(fishParse(['tech']), { args: { sector: 'TECH' }, input: 'FISHTANK TECH' });
  assert.deepEqual(fishParse(['INDUS']), { args: { sector: 'IND' }, input: 'FISHTANK IND' });
  assert.equal(fishParse([]), null);
  assert.equal(fishParse(['NOPE']), null);
  assert.deepEqual(matchWeird('FISHTANK', ['TECH']), { name: 'FISHTANK', args: { sector: 'TECH' }, input: 'FISHTANK TECH', url: 'FISHTANK TECH' });
  assert.deepEqual(matchWeird('FISHTANK', []), { name: 'FISHTANK', args: {}, input: 'FISHTANK', url: 'FISHTANK' });
  assert.equal(parseCommand('FISHTANK DISC').args.sector, 'DISC');
  for (const e of SECTOR_ETFS) assert.ok(SPECIES[e.key], `${e.id} links a lit sector`);
});

test('BREADTH: sector rows open to their members the same way', () => {
  const sectors = [{ sector: 'DISC', name: 'Consumer Discretionary', up: 3, down: 1, unchanged: 0, upPct: 75 }];
  const closed = sectorTable(sectors, null);
  assert.match(closed, /data-k="s:DISC" data-sec="DISC"/);
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /sc-mem/);
  const loading = sectorTable(sectors, null, { open: new Set(['DISC']) });
  assert.match(loading, /LOADING/);
  const members = new Map([['DISC', contributions(MEMBERS)]]);
  const html = sectorTable(sectors, null, { open: new Set(['DISC']), members });
  assert.equal((html.match(/class="sc-mem/g) || []).length, 5);
  assert.match(html, /data-cmd="AMZN"/);
  assert.match(html, /num up">\+1\.00%/, 'a rise sits in the Up column');
  assert.match(html, /num down">−1\.00%/, 'a fall in the Down column');
});

test('BREADTH: its counts and its member rows come from the same list', () => {
  const src = readFileSync('data/breadth.js', 'utf8');
  assert.match(src, /import \{ getFishtank, SP100_AS_OF \} from '\.\/sp100\.js'/, 'every member, cap or not (not the HEATMAP list)');
  assert.match(src, /heatmap = allMembers/);
  // A member without a cap still counts, on both sides.
  const stocks = [
    { ticker: 'A', sector: 'DISC', changePct: 1, marketCap: 1e11 },
    { ticker: 'B', sector: 'DISC', changePct: -1, marketCap: null },
    { ticker: 'C', sector: 'DISC', changePct: 2, marketCap: null },
  ];
  const counts = sectorBreadth(stocks)[0];
  const rows = breadth(stocks.map((m) => ({ ...m, move: m.changePct })));
  assert.equal(counts.up, rows.up);
  assert.equal(counts.total, rows.known);
});

// ---- copy rules ------------------------------------------------------------------------------

test('sectors copy: no banned brand word, no em dash, no emoji, no amber, no advice words', () => {
  const files = ['public/screens/sectors.js', 'data/sectors.js', 'public/screens/breadth.js'];
  // SECTORS' own stylesheet, loaded with the screen (it was a block of commands.css).
  const block = readFileSync('public/screens/sectors.css', 'utf8');
  assert.ok(block.length > 100);
  for (const [f, s] of [...files.map((f) => [f, readFileSync(f, 'utf8')]), ['screens/sectors.css', block]]) {
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, `${f}: emoji`);
    assert.doesNotMatch(s, /amber|orange|#f5a|#ffa|#ff9/i, `${f}: amber`);
    assert.doesNotMatch(s, /\b(leading|lagging|leader|laggard|buy|sell|best|worst|you should|we recommend)\b/i, `${f}: advice or ranking words`);
  }
  const h = findCommand('SECTORS');
  assert.doesNotMatch(`${h.summary} ${h.syntax}`, /\b(leading|lagging|best|worst|buy)\b/i);
});
