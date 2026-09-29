// MARKETS: HOME's markets list at full size (the F4 screen). Loaded on first use (and
// fetched ahead when the page is idle, like the other key bar screens), so its layout
// code is not in the startup bundle; the shared parts (rows, HOME's groups, panels) are
// in markets.js.

import {
  esc, panel, LOADING, nyTime, rerender, settleTicks, marketRow, HOME_MARKETS, fmtNum, fmtSigned, fmtPct, dirOf, nameCell, rowAttrs, tick,
} from './markets.js';
import { delayTag, freshLegend } from '../freshness.js';

// Plain market tables (one table with group rows; FX pairs), off the startup bundle.
const HEAD = (compact) => `<thead><tr><th scope="col">Name</th><th scope="col" class="tag"><span class="offscreen">Delayed</span></th><th scope="col" class="num">Last</th><th scope="col" class="num chg">Chg</th><th scope="col" class="num">%Chg</th>${compact ? '' : '<th scope="col" class="num time">Time</th>'}</tr></thead>`;

export function marketsTable(instruments, { compact = false } = {}) {
  const cols = compact ? 5 : 6;
  let group = '';
  const rows = instruments.map((m) => {
    const head = m.group !== group
      ? `<tr class="group-row"><th colspan="${cols}" scope="rowgroup">${esc((group = m.group))}</th></tr>`
      : '';
    return head + marketRow(m, compact);
  }).join('');
  return `<table class="grid-table">
    ${HEAD(compact)}
    <tbody>${rows}</tbody>
  </table>`;
}

export function fxTable(pairs) {
  const rows = pairs.map((p) => {
    const d = dirOf(p.change);
    return `<tr${rowAttrs(p.id)}>
      ${nameCell(p.pair || p.name, p.id)}
      <td class="tag">${delayTag(p)}</td>
      <td class="num last${tick(`fx:${p.id}:last`, p.last)}">${fmtNum(p.last, p.decimals)}</td>
      <td class="num chg ${d}">${fmtSigned(p.change, p.decimals)}</td>
      <td class="num pct ${d}">${fmtPct(p.changePct)}</td>
    </tr>`;
  }).join('');
  return `<table class="grid-table">
    <thead><tr><th scope="col">Pair</th><th scope="col" class="tag"><span class="offscreen">Delayed</span></th><th scope="col" class="num">Last</th><th scope="col" class="num chg">Chg</th><th scope="col" class="num">%Chg</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// MARKETS: HOME's list at full size. The same groups and sub-groups in the same order
// (HOME_MARKETS), every instrument /api/markets sends under its full name, with Chg. The
// ones HOME leaves out go in their place: after the id named here, else at the end of the
// sub-group their /api/markets group belongs to (a new instrument never goes missing).
export const MARKETS_AFTER = { DJFUT: 'NDFUT', VXN: 'VIX', GOLDFUT: 'GOLD', SILVERFUT: 'SILVER' };
export const MARKETS_PLACE = {
  Americas: ['US', 'Indexes'], 'US futures': ['US', 'Futures + vol'],
  Europe: ['World', 'Europe'], 'Asia Pacific': ['World', 'Asia'],
  Commodities: ['Commodities + crypto', 'Commodities'], Crypto: ['Commodities + crypto', 'Crypto'],
  Currencies: ['FX + rates', 'FX'], Rates: ['FX + rates', 'Rates'],
};

export function marketsGroups(instruments) {
  const list = instruments || [];
  const byId = new Map(list.map((m) => [m.id, m]));
  // Sub-groups in HOME's order: [{ group, sub, ids }].
  const subs = [];
  for (const g of HOME_MARKETS) {
    for (const r of g.rows) {
      if (typeof r === 'string') subs.push({ group: g.name, sub: r, ids: [] });
      else subs[subs.length - 1].ids.push(r[0]);
    }
  }
  const placed = new Set(subs.flatMap((u) => u.ids));
  const extras = list.filter((m) => !placed.has(m.id));
  // Named places first (a chain: SILVERFUT after SILVER), then by group.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const m of extras) {
      if (placed.has(m.id)) continue;
      const after = MARKETS_AFTER[m.id];
      let u = after ? subs.find((x) => x.ids.includes(after)) : null;
      if (u) { u.ids.splice(u.ids.indexOf(after) + 1, 0, m.id); placed.add(m.id); continue; }
      if (pass === 0) continue;
      const [group, sub] = MARKETS_PLACE[m.group] || [m.group || 'Other', m.group || 'Other'];
      u = subs.find((x) => x.group === group && x.sub === sub);
      if (!u) { u = { group, sub, ids: [] }; subs.push(u); }
      u.ids.push(m.id);
      placed.add(m.id);
    }
  }
  return subs.flatMap((u) => u.ids.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id), group: u.group, sub: u.sub })));
}

// Heights in px the column packing weighs: a row, a group title bar, a sub-heading bar.
const ROW_PX = 24;
const HEAD_PX = 20;
const SUB_PX = 18;

// Rows in order -> sub-groups [{ group, sub, rows }], cut into n columns top to bottom so
// the tallest column is as short as it can be. A column never starts under another
// group's title: every block opens with its own group's title bar (head: true) when it
// is the group's first sub-group or the first block of a column. Returns
// [[{ group, sub, rows, head }]] (fewer columns when there are fewer sub-groups).
export function packColumns(rows, n) {
  const units = [];
  for (const m of rows) {
    const u = units[units.length - 1];
    if (u && u.group === m.group && u.sub === m.sub) u.rows.push(m); else units.push({ group: m.group, sub: m.sub, rows: [m] });
  }
  const k = Math.max(1, Math.min(n, units.length));
  const heightOf = (a, b) => {
    let h = 0;
    for (let i = a; i < b; i += 1) h += units[i].rows.length * ROW_PX + SUB_PX + (i === a || units[i - 1].group !== units[i].group ? HEAD_PX : 0);
    return h;
  };
  // Every way to cut units into k runs (k - 1 cuts), the one with the shortest tallest run.
  let best = null;
  const walk = (start, left, cuts) => {
    if (left === 1) {
      const all = [...cuts, units.length];
      let max = 0;
      let from = 0;
      for (const c of all) { max = Math.max(max, heightOf(from, c)); from = c; }
      if (!best || max < best.max) best = { max, cuts: all };
      return;
    }
    for (let c = start + 1; c <= units.length - left + 1; c += 1) walk(c, left - 1, [...cuts, c]);
  };
  walk(0, k, []);
  const out = [];
  let from = 0;
  for (const c of best.cuts) {
    out.push(units.slice(from, c).map((u, i) => ({ ...u, head: i === 0 || units[from + i - 1].group !== u.group })));
    from = c;
  }
  return out;
}

// The New York day of a time: "2026-09-29".
const NY_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const nyDay = (t) => NY_DAY.format(new Date(t));

// A row's last trade day when it is not today in New York, for a small dim mark after the
// name (the hover title never reaches a phone): "Fri" within the last week, "Sep 26"
// before that. '' for a trade from today, or no time at all. asOf: a time, or a day
// ("2026-09-26").
export function staleDay(asOf, now = Date.now()) {
  if (!asOf) return '';
  let day = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null;
  if (!day) { const t = Date.parse(asOf); if (!Number.isFinite(t)) return ''; day = nyDay(t); }
  const today = nyDay(now);
  if (day >= today) return '';
  const noon = (d) => Date.parse(`${d}T12:00:00Z`);
  const at = new Date(noon(day));
  return (noon(today) - noon(day)) / 86_400_000 < 7
    ? at.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// The widest name, in characters, with its day mark (staleDay) when it has one: the name
// column is at least this wide, so no name is ever cut.
export const nameChars = (rows, now = Date.now()) => rows.reduce((w, m) => {
  const day = staleDay(m.asOf, now);
  return Math.max(w, String(m.name || '').length + (day ? day.length + 1 : 0));
}, 0);

// MARKETS as columns: n columns of group blocks (packColumns); chg: false leaves out the
// Chg column. Per row: name (with its day when not today), DLY mark when delayed, last,
// chg, %. Nothing else. now: the time "today" is judged by.
export function marketsFull(rows, { n = 3, chg = true, now = Date.now() } = {}) {
  const span = 4 + (chg ? 1 : 0);
  const cols = `<colgroup><col><col class="c-tag"><col class="c-last">${chg ? '<col class="c-chg">' : ''}<col class="c-pct"></colgroup>`;
  return packColumns(rows, n).map((col) => `<div class="mk-col">${col.map((u) => `<table class="grid-table mk-group">
    ${cols}<tbody>${u.head ? `<tr class="group-row"><th colspan="${span}" scope="rowgroup">${esc(u.group)}</th></tr>` : ''}<tr class="group-row sub-row"><th colspan="${span}" scope="rowgroup">${esc(u.sub)}</th></tr>${u.rows.map((m) => marketRow(m, true, chg, staleDay(m.asOf, now))).join('')}</tbody>
  </table>`).join('')}</div>`).join('');
}

// How MARKETS fits a width: 3 columns, else 2, else 1, each at least the width the widest
// name and the numbers need; with no room for even one, the Chg column goes first, and
// only then may a name wrap (never be cut). colPx(chg): one column's width in px.
export function marketsFit(width, colPx, { max = 3, gap = 1 } = {}) {
  for (let n = max; n >= 1; n -= 1) if (n * colPx(true) + (n - 1) * gap <= width) return { n, chg: true, wrap: false };
  if (colPx(false) <= width) return { n: 1, chg: false, wrap: false };
  return { n: 1, chg: false, wrap: true };
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Markets', LOADING, { cls: 'panel-solo mk-panel', metaId: 'mk-meta' });
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#mk-meta');
  let rows = null;
  let fit = null;
  let now = Date.now(); // "today" for the day marks, set at each paint

  // One column's width at this font: the widest name, the DLY mark and the numbers
  // (the colgroup widths in style.css), plus the cells' side padding.
  const probe = document.createElement('div');
  probe.className = 'mk-probe';
  probe.setAttribute('aria-hidden', 'true');
  const colPx = (chg) => {
    probe.style.setProperty('--mk-name', `${nameChars(rows, now)}ch`);
    probe.classList.toggle('no-chg', !chg);
    if (!probe.isConnected) body.append(probe);
    return Math.ceil(probe.getBoundingClientRect().width);
  };
  function paint() {
    if (!rows) return;
    now = Date.now();
    const next = marketsFit(body.clientWidth - 2, colPx);
    probe.remove();
    fit = next;
    // Classes, not a style attribute: the page's CSP allows no inline styles.
    rerender(body, `<div class="mk-full mk-n${next.n}${next.wrap ? ' is-wrap' : ''}">${marketsFull(rows, { ...next, now })}</div>`);
    settleTicks(body);
  }

  async function load() {
    try {
      const data = await ctx.fetchJSON('/api/markets', { signal: ctx.signal });
      rows = marketsGroups(data.instruments);
      paint();
      const asOf = data.updated ? `AS OF ${nyTime(data.updated)} ET` : '';
      meta.innerHTML = [asOf && esc(asOf), freshLegend(rows)].filter(Boolean).join('<span class="dim"> · </span>');
      ctx.updated(data.updated, data.stale, data.instruments);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH MARKETS', 'warn');
    }
  }

  // A new width may take another column count (or lose the Chg column): lay out again.
  let timer = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!rows || !fit) return;
      const next = marketsFit(body.clientWidth - 2, colPx);
      probe.remove();
      if (next.n !== fit.n || next.chg !== fit.chg || next.wrap !== fit.wrap) paint();
    }, 100);
  }) : null;
  ro?.observe(body);
  ctx.onCleanup?.(() => { ro?.disconnect(); clearTimeout(timer); });

  load();
  ctx.live(load, 15_000);
}
