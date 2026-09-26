// BONDS: government bond yields by country and maturity.
//   BONDS           YIELDS: 2Y, 5Y, 10Y and 30Y by region, with today's change in bp
//   BONDS SPREADS   each 10Y against the US 10Y and the German 10Y
//   BONDS CURVE     10Y minus 2Y for each country

import { esc, q, fmtNum, fmtSigned, dirOf, panel, metaNote, LOADING, tick, settleTicks, rowAttrs, nameCell, rerender } from './markets.js';
import { toolbar, segmented } from '../kit.js';

export const BOND_TABS = ['YIELDS', 'SPREADS', 'CURVE'];
export const REGIONS = ['Americas', 'Europe', 'Asia-Pacific'];

export function parse(args) {
  if (!args.length) return { tab: 'YIELDS' };
  if (args.length === 1 && BOND_TABS.includes(args[0])) return { tab: args[0] };
  return { error: 'usage', tab: 'YIELDS' };
}

// A bar from 0 to the highest yield on screen.
export function levelBar(v, max) {
  if (!Number.isFinite(v) || !(max > 0)) return '';
  const w = Math.max(0.5, Math.min(100, (v / max) * 100));
  return `<svg class="pbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="pbar-level" x="0" y="1" width="${w.toFixed(2)}" height="6"/></svg>`;
}

// Yields in percent -> the gap in basis points. Changes in percentage points -> the
// change of that gap in basis points. null when either side is missing.
export function spreadBp(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) * 1000) / 10 : null;
}
export function spreadChangeBp(ca, cb) {
  return Number.isFinite(ca) && Number.isFinite(cb) ? Math.round((ca - cb) * 1000) / 10 : null;
}

// Rows -> { country, us, de, curve } figures for SPREADS and CURVE.
export function bondFigures(grid) {
  const find = (cc) => grid.find((r) => r.cc === cc)?.cells['10Y'] || null;
  const us = find('US');
  const de = find('DE');
  return grid.map((r) => {
    const ten = r.cells['10Y'];
    const two = r.cells['2Y'];
    return {
      ...r,
      vsUs: r.cc === 'US' ? null : spreadBp(ten?.last, us?.last),
      vsUsChg: r.cc === 'US' ? null : spreadChangeBp(ten?.change, us?.change),
      vsDe: r.cc === 'DE' ? null : spreadBp(ten?.last, de?.last),
      vsDeChg: r.cc === 'DE' ? null : spreadChangeBp(ten?.change, de?.change),
      curve: spreadBp(ten?.last, two?.last),
      curveChg: spreadChangeBp(ten?.change, two?.change),
    };
  });
}

// Basis points; the unit is in the panel header.
const bpText = (v) => (Number.isFinite(v) ? fmtSigned(v, 1) : '--');
const bpDir = (v) => (Number.isFinite(v) ? dirOf(Math.round(v * 10)) : 'flat');
const pct = (v) => (Number.isFinite(v) ? `${fmtNum(v, 3)}%` : '--');

function yieldCell(c, key) {
  if (!c) return `<td class="num bg-cell${key ? ' bg-key' : ''}"><span class="dim">--</span></td>`;
  return `<td class="num bg-cell${key ? ' bg-key' : ''}"><a class="bg-y${tick(`bg:${c.id}`, c.last)}" href="${esc(q(c.cmd || c.id))}" data-cmd="${esc(c.cmd || c.id)}" tabindex="-1" title="${esc(`${c.id} as of ${c.asOf || '--'}`)}">${esc(fmtNum(c.last, 3))}</a> <span class="bg-d ${dirOf(Math.round(c.change * 1000))}">${esc(fmtSigned(c.change * 100, 1))}</span></td>`;
}

const groupRow = (region, cols) => `<tr class="group-row"><th colspan="${cols}" scope="rowgroup">${esc(region)}</th></tr>`;
const byRegion = (rows, cols, rowHtml) => REGIONS.map((reg) => {
  const list = rows.filter((r) => r.region === reg);
  return list.length ? groupRow(reg, cols) + list.map(rowHtml).join('') : '';
}).join('');
const cmdOf = (r) => r.cells['10Y']?.cmd || r.cells['10Y']?.id || null;

export function yieldsTable(grid, terms) {
  const max = Math.max(...grid.map((r) => r.cells['10Y']?.last).filter(Number.isFinite));
  const cols = terms.length + 2;
  return `<table class="grid-table bg-table">
    <thead><tr><th scope="col">Country</th>${terms.map((t) => `<th scope="col" class="num${t === '10Y' ? ' bg-key' : ''}">${esc(t)} <span class="bg-unit">% · bp</span></th>`).join('')}<th scope="col" class="bar-cell">10Y level</th></tr></thead>
    <tbody>${byRegion(grid, cols, (r) => `<tr${rowAttrs(cmdOf(r))}>
      ${nameCell(r.name, cmdOf(r))}
      ${terms.map((t) => yieldCell(r.cells[t], t === '10Y')).join('')}
      <td class="bar-cell">${levelBar(r.cells['10Y']?.last, max)}</td>
    </tr>`)}</tbody>
  </table>`;
}

export function spreadsTable(figs) {
  return `<table class="grid-table bg-table">
    <thead><tr><th scope="col">Country</th><th scope="col" class="num m-hide">10Y</th><th scope="col" class="num">vs US 10Y</th><th scope="col" class="num">Chg</th><th scope="col" class="num">vs DE 10Y</th><th scope="col" class="num">Chg</th></tr></thead>
    <tbody>${byRegion(figs, 6, (r) => `<tr${rowAttrs(cmdOf(r))}>
      ${nameCell(r.name, cmdOf(r))}
      <td class="num last m-hide">${esc(pct(r.cells['10Y']?.last))}</td>
      <td class="num">${esc(bpText(r.vsUs))}</td>
      <td class="num bp ${bpDir(r.vsUsChg)}">${esc(bpText(r.vsUsChg))}</td>
      <td class="num">${esc(bpText(r.vsDe))}</td>
      <td class="num bp ${bpDir(r.vsDeChg)}">${esc(bpText(r.vsDeChg))}</td>
    </tr>`)}</tbody>
  </table>`;
}

export function curveTable(figs) {
  return `<table class="grid-table bg-table">
    <thead><tr><th scope="col">Country</th><th scope="col" class="num m-hide">2Y</th><th scope="col" class="num m-hide">10Y</th><th scope="col" class="num">10Y minus 2Y</th><th scope="col" class="num">Chg</th><th scope="col" class="st">Shape</th></tr></thead>
    <tbody>${byRegion(figs, 6, (r) => `<tr${rowAttrs(cmdOf(r))}>
      ${nameCell(r.name, cmdOf(r))}
      <td class="num m-hide">${esc(pct(r.cells['2Y']?.last))}</td>
      <td class="num m-hide">${esc(pct(r.cells['10Y']?.last))}</td>
      <td class="num last">${esc(bpText(r.curve))}</td>
      <td class="num bp ${bpDir(r.curveChg)}">${esc(bpText(r.curveChg))}</td>
      <td class="st dim">${Number.isFinite(r.curve) ? (r.curve < 0 ? 'INVERTED' : 'NORMAL') : '--'}</td>
    </tr>`)}</tbody>
  </table>`;
}

// How to read each view, short, in the title strip; the long form is the tooltip.
const NOTES = {
  YIELDS: ['CHG IN BP, 1 BP = 0.01%', 'Each cell: the yield in percent, then today\'s change in basis points (1 bp = 0.01%). Tap a yield to chart it. -- means the source has no quote for that maturity.'],
  SPREADS: ['VS THE US OR GERMAN 10Y', 'Spread: the country\'s 10-year yield minus the US or German 10-year, in basis points. Chg: how much that gap moved today.'],
  CURVE: ['BELOW 0 = INVERTED', '10-year yield minus 2-year yield, in basis points. Below zero the curve is inverted: short-term borrowing costs more than long-term.'],
};

export function render(el, cmd, ctx) {
  const tab = cmd.args?.tab || 'YIELDS';
  const views = segmented(BOND_TABS.map((t) => ({ label: t, cmd: t === 'YIELDS' ? 'BONDS' : `BONDS ${t}` })), tab, { label: 'View' });
  el.innerHTML = panel('1', 'Government bonds', `${toolbar({ left: views, label: 'View' })}<div class="bg-body">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'bd-meta', meta: metaNote(...NOTES[tab]), bodyCls: 'flush' });
  if (cmd.args?.error) ctx.status('BONDS TAKES YIELDS, SPREADS OR CURVE', 'warn');
  const body = el.querySelector('.bg-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/bonds', { signal: ctx.signal });
      const grid = d.grid || [];
      const html = tab === 'SPREADS' ? spreadsTable(bondFigures(grid)) : tab === 'CURVE' ? curveTable(bondFigures(grid)) : yieldsTable(grid, d.terms);
      rerender(body, html);
      settleTicks(body);
      el.querySelector('#bd-meta').innerHTML = `<span class="m-hide">${grid.length} COUNTRIES · </span>${tab === 'YIELDS' ? 'PERCENT A YEAR' : 'BASIS POINTS'} · ${metaNote(...NOTES[tab])}`;
      const items = grid.flatMap((r) => Object.values(r.cells).filter(Boolean).map((c) => ({ kind: 'yield', realTime: c.realTime })));
      if (!cmd.args?.error) ctx.updated(d.updated, d.stale, items);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH BONDS', 'warn');
    }
  }

  load();
  ctx.every(load, 60_000);
}
