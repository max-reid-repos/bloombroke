// SECTORS: the 11 sector ETFs over a period (1D 1W 1M YTD 1Y), each one opening to its
// S&P 100 members. TABLE is one dense list; MAP is the same as boxes sized by market cap.
// A member's "pt" is its cap share among the listed members of its sector times its move:
// approximate, and only the members listed, never the whole ETF.
//
// Keys (the table or the map has the focus; Down from an empty command bar moves there):
//   TABLE  Up Down move, Right or Enter opens a sector, Left closes it, Space toggles,
//          E opens all, C closes all, Enter on a stock opens it, M the map
//   MAP    arrows move, Enter or Space goes into a sector, Enter on a stock opens it,
//          Esc or Space comes back out, M the table
// SECTORS 1M, SECTORS YTD MAP: the period and the view are in the URL.

import { esc, q, fmtPct, fmtSigned, dirOf, panel, metaNote, LOADING } from './markets.js';
import { toolbar, segmented, rangePills } from '../kit.js';
import { squarify, heatFill, tileLabels, sectorLabel, fitHeight } from './heatmap.js';
import { sizeGuard } from './size-guard.js';

export const PERIODS = ['1D', '1W', '1M', 'YTD', '1Y'];
export const VIEWS = ['TABLE', 'MAP'];

// Words after SECTORS: a period and TABLE or MAP, in any order. Anything else is ignored.
export function parse(words = []) {
  let period = '1D';
  let view = 'TABLE';
  for (const w of words) {
    const u = String(w).toUpperCase();
    if (PERIODS.includes(u)) period = u;
    else if (VIEWS.includes(u)) view = u;
  }
  return { period, view };
}

// The command (and so the URL) for a period and a view: plain SECTORS for 1D TABLE.
export function sectorsCmd({ period = '1D', view = 'TABLE' } = {}) {
  return ['SECTORS', period !== '1D' ? period : '', view === 'MAP' ? 'MAP' : ''].filter(Boolean).join(' ');
}

// FISHTANK with one sector lit.
export const swimCmd = (key) => `FISHTANK ${key}`;

// ---- The numbers ---------------------------------------------------------------------

// Share classes of one company both carry the whole company's cap (GOOG and GOOGL do):
// each class gets its part, so the company counts once.
export const SHARE_CLASS = { GOOG: 'GOOGL' };

// members -> Map(ticker -> the cap it counts with). Members without a cap are left out.
export function memberCaps(members) {
  const company = (t) => SHARE_CLASS[t] || t;
  const n = new Map();
  for (const m of members) if (m.marketCap > 0) n.set(company(m.ticker), (n.get(company(m.ticker)) || 0) + 1);
  return new Map(members.filter((m) => m.marketCap > 0).map((m) => [m.ticker, m.marketCap / n.get(company(m.ticker))]));
}

// Members of one sector -> the same rows with weight and pt. weight: the member's share
// of the cap of the members that have a cap and a known move (the weights sum to 1).
// pt: weight x move, in percentage points (they sum to the listed members' move).
// No cap or no move: weight and pt null.
export function contributions(members) {
  const caps = memberCaps(members);
  const counts = (m) => caps.has(m.ticker) && Number.isFinite(m.move);
  const total = members.filter(counts).reduce((t, m) => t + caps.get(m.ticker), 0);
  return members.map((m) => {
    if (!(total > 0) || !counts(m)) return { ...m, weight: null, pt: null };
    const weight = caps.get(m.ticker) / total;
    return { ...m, weight, pt: weight * m.move };
  });
}

// The cap-weighted move of the listed members (the sum of their pt), or null.
export function listedMove(rows) {
  const ok = rows.filter((r) => Number.isFinite(r.pt));
  return ok.length ? ok.reduce((t, r) => t + r.pt, 0) : null;
}

// How many members rose, of those with a known move.
export function breadth(members) {
  const known = members.filter((m) => Number.isFinite(m.move));
  return { up: known.filter((m) => m.move > 0).length, known: known.length, total: members.length };
}
export const fmtBreadth = (b) => (b?.known ? `${b.up}/${b.known} up` : '--');

// The n members with the biggest pt either way.
export function topContributors(rows, n = 2) {
  return rows.filter((r) => Number.isFinite(r.pt)).sort((a, b) => Math.abs(b.pt) - Math.abs(a.pt) || a.ticker.localeCompare(b.ticker)).slice(0, n);
}

export const fmtPt = (pt) => (Number.isFinite(pt) ? `${fmtSigned(pt, 2)} pt` : '--');

// "AMZN +0.62 pt, TSLA +0.40 pt", or -- when no member has a pt.
export function whoLine(rows) {
  const top = topContributors(rows);
  return top.length ? top.map((r) => `${r.ticker} ${fmtPt(r.pt)}`).join(', ') : '--';
}

// /api/sectors -> one entry per sector in the list's order, with its members (biggest
// cap first), their pt and the sector's breadth.
export function sectorModel(d) {
  const by = new Map();
  for (const m of d?.members || []) {
    if (!by.has(m.sector)) by.set(m.sector, []);
    by.get(m.sector).push(m);
  }
  return (d?.sectors || []).map((s) => {
    const list = [...(by.get(s.key) || [])].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0) || a.ticker.localeCompare(b.ticker));
    const members = contributions(list);
    return { ...s, move: Number.isFinite(s.move) ? s.move : null, members, breadth: breadth(members) };
  });
}

// ---- TABLE ---------------------------------------------------------------------------

// A centred bar for a % value, scaled to `max`.
export function pctBar(p, max) {
  if (!Number.isFinite(p) || !(max > 0)) return '';
  const w = Math.min(50, (Math.abs(p) / max) * 50);
  const x = p >= 0 ? 50 : 50 - w;
  return `<svg class="pbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="pbar-mid" x="49.75" y="0" width="0.5" height="8"/><rect class="pbar-v ${p >= 0 ? 'up' : 'down'}" x="${x.toFixed(2)}" y="1" width="${Math.max(0.5, w).toFixed(2)}" height="6"/></svg>`;
}

const symLink = (sym) => `<a href="${esc(q(sym))}" data-cmd="${esc(sym)}" tabindex="-1">${esc(sym)}</a>`;

function sectorRow(s, open, max) {
  return `<tr class="sc-row${open ? ' is-open' : ''}" data-k="s:${esc(s.id)}" data-sec="${esc(s.id)}" tabindex="-1" aria-expanded="${open}">
    <th scope="row" class="sc-sym"><span class="sc-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>${symLink(s.id)}</th>
    <td class="sc-name">${esc(s.name)}</td>
    <td class="num sc-move ${dirOf(s.move)}">${fmtPct(s.move)}</td>
    <td class="sc-bar">${pctBar(s.move, max)}</td>
    <td class="num sc-x">${esc(fmtBreadth(s.breadth))}</td>
  </tr>`;
}

// Under an open sector: the two biggest pt, and SWIM (FISHTANK with that sector lit).
function whoRow(s) {
  const swim = s.key ? ` <a class="sc-swim" href="${esc(q(swimCmd(s.key)))}" data-cmd="${esc(swimCmd(s.key))}" tabindex="-1">SWIM</a>` : '';
  return `<tr class="sc-who" data-k="w:${esc(s.id)}" data-parent="${esc(s.id)}" tabindex="-1">
    <td colspan="5"><span class="sc-who-t">${esc(whoLine(s.members))}</span>${swim}</td>
  </tr>`;
}

function memberRow(m, s) {
  return `<tr class="sc-mem row-link" data-k="m:${esc(s.id)}:${esc(m.ticker)}" data-parent="${esc(s.id)}" data-cmd="${esc(m.ticker)}" tabindex="-1">
    <th scope="row" class="sc-sym">${symLink(m.ticker)}</th>
    <td class="sc-name">${esc(m.name)}</td>
    <td class="num sc-move ${dirOf(m.move)}">${fmtPct(m.move)}</td>
    <td class="sc-bar"></td>
    <td class="num sc-x ${dirOf(Number.isFinite(m.pt) ? Math.round(m.pt * 100) / 100 : null)}">${esc(fmtPt(m.pt))}</td>
  </tr>`;
}

// model: sectorModel(). open: a Set of the open sector ids.
export function tableHtml(model, { open = new Set() } = {}) {
  const moves = model.map((s) => Math.abs(s.move)).filter(Number.isFinite);
  const max = Math.max(0.5, ...moves);
  const body = model.map((s) => sectorRow(s, open.has(s.id), max)
    + (open.has(s.id) ? whoRow(s) + s.members.map((m) => memberRow(m, s)).join('') : '')).join('');
  return `<table class="grid-table sc-table">
    <thead class="offscreen"><tr><th scope="col">Symbol</th><th scope="col">Name</th><th scope="col">Move</th><th scope="col">Bar</th><th scope="col">Up, or pt</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// Keys for a table whose sector rows (tr[data-sec]) open to child rows (tr[data-parent]),
// every row with a data-k. SECTORS and BREADTH share them:
//   Up Down Home End move (Up on the top row: ops.top), Right or Enter opens a sector,
//   Right on an open one steps into it, Left closes (from a child too), Space toggles,
//   E opens all, C closes all, Enter on an open sector or a child: ops.enter.
// ops: { isOpen(id), cursor(tr), top(), open(id, on), all(on, sec), enter(tr, sec, isSec), more: { KEY(tr, sec) } }.
// Returns true when the key was taken.
export function treeKey(e, host, ops) {
  const tr = e.target?.closest?.('tr[data-k]');
  if (!tr || e.target !== tr || e.ctrlKey || e.metaKey || e.altKey) return false;
  const all = [...host.querySelectorAll('tr[data-k]')];
  const i = all.indexOf(tr);
  const sec = tr.dataset.sec || tr.dataset.parent;
  const isSec = Boolean(tr.dataset.sec);
  const open = ops.isOpen(sec);
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const acts = {
    ArrowDown: () => ops.cursor(all[Math.min(all.length - 1, i + 1)]),
    ArrowUp: () => (i === 0 ? ops.top?.() : ops.cursor(all[i - 1])),
    Home: () => ops.cursor(all[0]),
    End: () => ops.cursor(all[all.length - 1]),
    ArrowRight: () => { if (isSec && !open) ops.open(sec, true); else if (isSec) ops.cursor(all[i + 1]); },
    ArrowLeft: () => { if (open) ops.open(sec, false); },
    ' ': () => ops.open(sec, !open),
    Enter: () => (isSec && !open ? ops.open(sec, true) : ops.enter(tr, sec, isSec)),
    E: () => ops.all(true, sec),
    C: () => ops.all(false, sec),
  };
  const act = acts[k] || (ops.more?.[k] ? () => ops.more[k](tr, sec) : null);
  if (!act) return false;
  e.preventDefault();
  e.stopPropagation();
  act();
  return true;
}

// Roving focus: only the row under the cursor is in the Tab order.
export function focusTreeRow(host, tr, { focus = true } = {}) {
  if (!tr) return;
  for (const r of host.querySelectorAll('tr[data-k]')) r.tabIndex = -1;
  tr.tabIndex = 0;
  if (focus) {
    tr.focus({ preventScroll: true });
    tr.scrollIntoView?.({ block: 'nearest' });
  }
}

// ---- MAP -----------------------------------------------------------------------------

// Colour scale per period: the move that gets the deepest green or red.
export const MAP_SCALE = { '1D': 3, '1W': 5, '1M': 8, YTD: 20, '1Y': 25 };
export const mapFill = (move, period = '1D') => heatFill(Number.isFinite(move) ? (move * 3) / (MAP_SCALE[period] || 3) : NaN);

// Boxes for a w x h map: sectors sized by their listed members' cap, members inside
// sized by cap. zoom: one sector id, drawn alone over the whole map.
// -> { secs: [{ id, key, name, move, x, y, w, h, head }], cells: [{ ticker, sector, move, pt, cap, x, y, w, h }] }
export function mapLayout(model, w, h, zoom = null) {
  const groups = model
    .filter((s) => !zoom || s.id === zoom)
    .map((s) => {
      const caps = memberCaps(s.members);
      const ms = s.members.filter((m) => caps.has(m.ticker)).map((m) => ({ m, cap: caps.get(m.ticker) }));
      return { s, ms, cap: ms.reduce((t, x) => t + x.cap, 0) };
    })
    .filter((g) => g.cap > 0);
  const rects = squarify(groups.map((g) => g.cap), { x: 0, y: 0, w, h });
  const secs = [];
  const cells = [];
  groups.forEach((g, i) => {
    const r = rects[i];
    if (!r) return;
    const head = zoom ? Math.min(20, r.h / 4) : r.h > 40 && r.w > 56 ? 16 : 0;
    secs.push({ id: g.s.id, key: g.s.key, name: g.s.name, move: g.s.move, x: r.x, y: r.y, w: r.w, h: r.h, head });
    const inner = { x: r.x + 1, y: r.y + head + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - head - 2) };
    const cr = squarify(g.ms.map((x) => x.cap), inner);
    g.ms.forEach((x, j) => {
      const c = cr[j];
      if (c) cells.push({ ticker: x.m.ticker, name: x.m.name, sector: g.s.id, move: x.m.move, pt: x.m.pt, cap: x.cap, x: c.x, y: c.y, w: c.w, h: c.h });
    });
  });
  return { secs, cells };
}

// The box to move to from `cur` with an arrow key: the nearest centre that way, a
// sideways step counting double. Stays put at the edge.
export function nextBox(items, cur, key) {
  const c = items.find((i) => i.id === cur);
  if (!c) return items[0]?.id ?? null;
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  let near = null;
  let nearD = Infinity;
  for (const i of items) {
    if (i === c) continue;
    const dx = i.x + i.w / 2 - cx;
    const dy = i.y + i.h / 2 - cy;
    const along = key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy;
    const across = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
    if (along < 1) continue;
    const d = along + 2 * across;
    if (d < nearD) { nearD = d; near = i; }
  }
  return near ? near.id : c.id;
}

const f1 = (n) => n.toFixed(1);

// The map as SVG. cur: the sector id (overview) or ticker (zoomed) under the cursor.
export function mapSvg(model, lay, { w, h, period = '1D', zoom = null, cur = null } = {}) {
  const parts = [];
  const byId = new Map(model.map((s) => [s.id, s]));
  for (const s of lay.secs) {
    parts.push(`<g class="sc-msec" data-sec="${esc(s.id)}"><rect class="hm-sec" x="${f1(s.x)}" y="${f1(s.y)}" width="${f1(s.w)}" height="${f1(s.h)}"/>`);
    if (s.head >= 12) {
      const extra = zoom ? ` · ${fmtBreadth(byId.get(s.id)?.breadth)} · ${whoLine(byId.get(s.id)?.members || [])}` : '';
      const base = zoom ? `${s.id} ${s.name}` : s.id;
      const label = sectorLabel(base, `${fmtPct(s.move)}${extra}`, s.w);
      if (label) parts.push(`<text class="hm-sec-t" x="${f1(s.x + 4)}" y="${f1(s.y + Math.min(12, s.head - 3) + (zoom ? 2 : 0))}">${esc(label)}</text>`);
    }
    parts.push('</g>');
  }
  for (const c of lay.cells) {
    const pctText = fmtPct(c.move);
    const { fs, ps } = tileLabels(c.w, c.h, c.ticker.length, pctText.length);
    const cx = c.x + c.w / 2;
    const block = ps ? fs * 0.72 + ps * 0.35 + ps * 0.72 : 0;
    const ty = ps ? c.y + (c.h - block) / 2 + fs * 0.72 : c.y + c.h / 2 + fs * 0.35;
    const text = fs
      ? `<text class="hm-t" x="${f1(cx)}" y="${f1(ty)}" font-size="${fs}" text-anchor="middle">${esc(c.ticker)}</text>`
        + (ps ? `<text class="hm-p" x="${f1(cx)}" y="${f1(ty + ps * 0.35 + ps * 0.72)}" font-size="${ps}" text-anchor="middle">${esc(pctText)}</text>` : '')
      : '';
    const tip = `${c.name} (${c.ticker}) ${pctText}, ${fmtPt(c.pt)}`;
    parts.push(`<a class="hm-a" href="${esc(q(c.ticker))}" data-cmd="${esc(c.ticker)}" data-t="${esc(c.ticker)}" tabindex="-1" aria-label="${esc(tip)}">`
      + `<rect class="hm-cell" x="${f1(c.x + 0.5)}" y="${f1(c.y + 0.5)}" width="${f1(Math.max(0, c.w - 1))}" height="${f1(Math.max(0, c.h - 1))}" fill="${mapFill(c.move, period)}"/>`
      + `${text}<title>${esc(tip)}</title></a>`);
  }
  const box = zoom ? lay.cells.find((c) => c.ticker === cur) : lay.secs.find((s) => s.id === cur);
  if (box) parts.push(`<rect class="sc-mcur" x="${f1(box.x + 1)}" y="${f1(box.y + 1)}" width="${f1(Math.max(0, box.w - 2))}" height="${f1(Math.max(0, box.h - 2))}"/>`);
  return `<svg class="heatmap sc-map-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${parts.join('')}</svg>`;
}

// Map height: the room left in a stretched panel (desktop), a DESK panel's height, or
// taller than wide on a phone.
export function mapHeight(width, { stretched = 0, embed = null } = {}) {
  if (embed) return fitHeight(embed.viewport, embed.top);
  if (stretched >= 200) return Math.floor(stretched);
  return Math.round(Math.max(320, Math.min(900, width * 1.3)));
}

// ---- The screen ----------------------------------------------------------------------

// Kept across re-renders (a new period or view is a new command): which sectors are
// open, the row under the cursor, and the map's zoom and cursor.
const state = { open: new Set(), cur: null, zoom: null, mcur: null, refocus: false };

const PT_TIP = 'Approx., listed members only. pt = a member\'s share of the listed members\' market cap times its move, in percentage points. The sector ETF holds more than these members.';
const KEYS_TIP = 'Down from the empty command bar (or Tab) moves in. Right or Enter opens a sector, Left closes it, Space toggles, E opens all, C closes all, Enter on a stock opens it, M: table or map. On the map: arrows move, Enter goes in, Esc comes out.';

export function render(el, cmd, ctx) {
  const { period, view } = cmd.args?.period ? cmd.args : parse([]);
  const meta = `${metaNote('S&P 100 members', PT_TIP)}<span class="dim" aria-hidden="true">·</span>${metaNote('←→ E C M', KEYS_TIP)}`;
  const bar = toolbar({
    left: rangePills(period, (p) => sectorsCmd({ period: p, view }), PERIODS),
    right: segmented(VIEWS.map((v) => ({ label: v, cmd: sectorsCmd({ period, view: v }) })), view, { label: 'View' }),
    label: 'Period and view',
  });
  el.innerHTML = panel('1', 'Sectors', `${bar}<div class="sc-host${view === 'MAP' ? ' is-map' : ''}">${LOADING}</div>`, { cls: 'panel-solo sc-panel', meta, bodyCls: 'flush sc-body' });
  const host = el.querySelector('.sc-host');
  const cmdInput = typeof document === 'object' ? document.getElementById('cmd') : null;
  let model = null;
  let lay = null;
  const guard = sizeGuard();

  const switchView = (v) => { state.refocus = true; ctx.run(sectorsCmd({ period, view: v })); };

  // ---- TABLE ----
  function focusRow(tr, { focus = true } = {}) {
    if (!tr) return;
    state.cur = tr.dataset.k;
    focusTreeRow(host, tr, { focus });
  }
  const rowFor = (k) => (k ? host.querySelector(`tr[data-k="${CSS.escape(k)}"]`) : null);
  function drawTable() {
    const had = host.contains(document.activeElement) || state.refocus;
    state.refocus = false;
    host.innerHTML = `<div class="sc-scroll">${tableHtml(model, state)}</div>`;
    const tr = rowFor(state.cur) || rowFor(state.cur?.startsWith('s:') ? null : `s:${state.cur?.split(':')[1]}`) || host.querySelector('tr.sc-row');
    focusRow(tr, { focus: had });
  }
  function setOpen(id, on) {
    if (on) state.open.add(id); else state.open.delete(id);
    drawTable();
  }
  function tableKey(e) {
    treeKey(e, host, {
      isOpen: (id) => state.open.has(id),
      cursor: focusRow,
      top: () => cmdInput?.focus(),
      open: (id, on) => {
        state.cur = `s:${id}`;
        setOpen(id, on);
      },
      all: (on, sec) => {
        if (on) for (const s of model) state.open.add(s.id);
        else { state.open.clear(); state.cur = `s:${sec}`; }
        drawTable();
      },
      enter: (tr, sec, isSec) => {
        if (isSec) ctx.run(sec);
        else if (tr.dataset.cmd) ctx.run(tr.dataset.cmd);
        else tr.querySelector('.sc-swim')?.click();
      },
      more: { M: (tr, sec) => { state.zoom = state.open.has(sec) ? sec : null; state.mcur = sec; switchView('MAP'); } },
    });
  }

  // ---- MAP ----
  function mapSize() {
    const w = Math.floor(host.clientWidth);
    const stretched = window.matchMedia?.('(min-width: 1100px)').matches && !ctx.embed ? host.clientHeight : 0;
    const embed = ctx.embed ? { viewport: window.innerHeight, top: host.getBoundingClientRect().top } : null;
    return { w, h: mapHeight(w, { stretched, embed }) };
  }
  function drawMap(size = null) {
    const { w, h } = size || mapSize();
    if (!w || !model) return;
    const had = host.contains(document.activeElement) || state.refocus;
    state.refocus = false;
    if (state.zoom && !model.some((s) => s.id === state.zoom)) state.zoom = null;
    lay = mapLayout(model, w, h, state.zoom);
    const items = state.zoom ? lay.cells.map((c) => ({ ...c, id: c.ticker })) : lay.secs;
    if (!items.some((b) => b.id === state.mcur)) state.mcur = items[0]?.id ?? null;
    const cur = items.find((b) => b.id === state.mcur);
    const label = cur ? (state.zoom ? `${cur.ticker} ${fmtPct(cur.move)} ${fmtPt(cur.pt)}` : `${cur.id} ${cur.name} ${fmtPct(cur.move)}`) : 'Sector map';
    host.innerHTML = `<div class="sc-map" tabindex="0" role="group" aria-roledescription="map" aria-label="${esc(label)}">${mapSvg(model, lay, { w, h, period, zoom: state.zoom, cur: state.mcur })}</div>`;
    guard.drawn(w, host.clientHeight || h, performance.now());
    if (had) host.querySelector('.sc-map').focus({ preventScroll: true });
  }
  function zoomTo(id) {
    state.zoom = id;
    state.mcur = id ? model.find((s) => s.id === id)?.members.find((m) => m.marketCap > 0)?.ticker ?? null : state.mcur;
    drawMap();
  }
  function zoomOut() {
    const was = state.zoom;
    state.zoom = null;
    state.mcur = was;
    drawMap();
  }
  function mapKey(e) {
    if (!e.target.closest?.('.sc-map') || !lay) return;
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const items = state.zoom ? lay.cells.map((c) => ({ ...c, id: c.ticker })) : lay.secs;
    let act = null;
    if (k.startsWith('Arrow')) act = () => { state.mcur = nextBox(items, state.mcur, k); drawMap(); };
    else if (k === 'Enter') act = () => (state.zoom ? state.mcur && ctx.run(state.mcur) : state.mcur && zoomTo(state.mcur));
    else if (k === ' ') act = () => (state.zoom ? zoomOut() : state.mcur && zoomTo(state.mcur));
    else if ((k === 'Escape' || k === 'Backspace' || k === 'C') && state.zoom) act = zoomOut;
    else if (k === 'M') {
      act = () => {
        const sec = state.zoom || state.mcur;
        if (state.zoom) state.open.add(state.zoom);
        state.cur = sec ? `s:${sec}` : null;
        switchView('TABLE');
      };
    }
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  }
  host.addEventListener('click', (e) => {
    if (view === 'MAP') {
      if (e.target.closest?.('a[data-cmd]')) return;
      const g = e.target.closest?.('.sc-msec');
      if (!g) return;
      if (state.zoom) zoomOut(); else zoomTo(g.dataset.sec);
      return;
    }
    const tr = e.target.closest?.('tr.sc-row');
    if (!tr || e.target.closest('a[data-cmd]')) return;
    state.cur = tr.dataset.k;
    setOpen(tr.dataset.sec, !state.open.has(tr.dataset.sec));
  });
  host.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !model) return;
    if (view === 'MAP') mapKey(e); else tableKey(e);
  });

  // Down from the empty command bar moves into the table or the map.
  const onDocKey = (e) => {
    if (e.key !== 'ArrowDown' || e.defaultPrevented || !cmdInput || e.target !== cmdInput || cmdInput.value !== '' || !model) return;
    const t = view === 'MAP' ? host.querySelector('.sc-map') : host.querySelector('tr[data-k][tabindex="0"]');
    if (!t) return;
    e.preventDefault();
    t.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', onDocKey);

  const ro = view === 'MAP' && typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => { const s = guard.next(host.clientWidth, host.clientHeight, performance.now()); if (s && model) drawMap(); })
    : null;
  ro?.observe(host);
  ctx.onCleanup(() => { ro?.disconnect(); document.removeEventListener('keydown', onDocKey); });

  function draw() {
    if (view === 'MAP') drawMap(); else drawTable();
  }

  async function load() {
    try {
      const d = await ctx.fetchJSON(`/api/sectors?p=${encodeURIComponent(period)}`, { signal: ctx.signal });
      model = sectorModel(d);
      draw();
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!model) host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH SECTORS', 'warn');
    }
  }

  load();
  ctx.live(load, 60_000);
}
