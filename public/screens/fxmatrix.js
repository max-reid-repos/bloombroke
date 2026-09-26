// FXMATRIX: cross rates for nine currencies. Row currency = 1 unit, column = what it buys.
//   FXMATRIX        the rates (ECB reference rates, once a day)
//   FXMATRIX HEAT   each cross coloured by today's % change (CNBC real time; the daily
//                   ECB change when the live quotes are not there, labelled DAILY)

import { esc, q, dirOf, fmtPct, panel, LOADING } from './markets.js';
import { fmtRate } from './fx.js';
import { freshTag } from '../freshness.js';
import { toolbar, segmented } from '../kit.js';

export const FXM_MODES = ['RATES', 'HEAT'];

export function parse(args) {
  if (!args.length) return { mode: 'RATES' };
  if (args.length === 1 && FXM_MODES.includes(args[0])) return { mode: args[0] };
  return { error: 'usage', mode: 'RATES' };
}

// Day-on-day % change of one cell, or null.
export function cellChange(matrix, prev, a, b) {
  const now = matrix?.[a]?.[b];
  const before = prev?.[a]?.[b];
  return Number.isFinite(now) && before > 0 && a !== b ? ((now - before) / before) * 100 : null;
}

// Colour buckets for HEAT, from falling most to rising most.
export const HEAT_BUCKETS = [
  { cls: 'hx-d3', label: '-1% or more down' },
  { cls: 'hx-d2', label: '-0.5 to -1%' },
  { cls: 'hx-d1', label: '-0.1 to -0.5%' },
  { cls: 'hx-0', label: 'within 0.1%' },
  { cls: 'hx-u1', label: '+0.1 to +0.5%' },
  { cls: 'hx-u2', label: '+0.5 to +1%' },
  { cls: 'hx-u3', label: '+1% or more up' },
];

// % change -> its bucket class. Edges go to the stronger bucket: -0.5 is hx-d2, +1 is hx-u3.
export function heatBucket(pct) {
  if (!Number.isFinite(pct)) return 'hx-na';
  if (pct <= -1) return 'hx-d3';
  if (pct <= -0.5) return 'hx-d2';
  if (pct <= -0.1) return 'hx-d1';
  if (pct < 0.1) return 'hx-0';
  if (pct < 0.5) return 'hx-u1';
  if (pct < 1) return 'hx-u2';
  return 'hx-u3';
}

export function heatLegend() {
  return `<ul class="hx-legend" aria-label="Colour key">${HEAT_BUCKETS.map((b) => `<li><span class="hx-sw ${b.cls}" aria-hidden="true"></span>${esc(b.label)}</li>`).join('')}</ul>`;
}

export function matrixTable(d, { heat = false } = {}) {
  const codes = d.codes;
  const head = `<tr><th scope="col" class="fxm-corner">1 unit of</th>${codes.map((c) => `<th scope="col" class="num">${esc(c)}</th>`).join('')}</tr>`;
  const rows = codes.map((a) => `<tr><th scope="row" class="fxm-row">${esc(a)}</th>${codes.map((b) => {
    if (a === b) return '<td class="num fxm-self">--</td>';
    const v = d.matrix[a][b];
    const chg = cellChange(d.matrix, d.prev, a, b);
    const cmd = `FX 1 ${a} ${b}`;
    const title = `1 ${a} = ${fmtRate(v)} ${b}${chg === null ? '' : `, ${fmtPct(chg)} today`}`;
    if (heat) {
      return `<td class="num hx ${heatBucket(chg)}"><a class="fxm-cell" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" title="${esc(title)}">${esc(chg === null ? '--' : fmtPct(chg))}</a></td>`;
    }
    // Neutral numbers; a small coloured arrow carries the day's direction.
    const dir = chg === null ? 'flat' : dirOf(Math.round(chg * 100));
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
    return `<td class="num"><a class="fxm-cell" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" title="${esc(title)}">${esc(fmtRate(v))}<span class="fxm-arr ${dir}" aria-hidden="true">${arrow}</span></a></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="fxm-wrap"><table class="grid-table fxm${heat ? ' fxm-heat' : ''}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase() : '--');

export function render(el, cmd, ctx) {
  const mode = cmd.args?.mode || 'RATES';
  const heat = mode === 'HEAT';
  const modes = segmented(FXM_MODES.map((m) => ({ label: m, cmd: m === 'RATES' ? 'FXMATRIX' : `FXMATRIX ${m}` })), mode, { label: 'Mode' });
  el.innerHTML = panel('1', 'FX matrix', `${toolbar({ right: modes, label: 'Mode' })}<div class="fxm-body">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'fxm-meta', bodyCls: 'flush' });
  if (cmd.args?.error) ctx.status('FXMATRIX TAKES RATES OR HEAT', 'warn');
  const body = el.querySelector('.fxm-body');
  const meta = el.querySelector('#fxm-meta');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/fxmatrix', { signal: ctx.signal });
      if (heat && d.live) {
        body.innerHTML = matrixTable({ codes: d.codes, matrix: d.live.matrix, prev: d.live.prev }, { heat: true }) + heatLegend();
        meta.innerHTML = `${freshTag({ realTime: Boolean(d.live.realTime) })} CHANGE TODAY, CNBC`;
        if (!cmd.args?.error) ctx.updated(d.live.updated, d.live.stale);
      } else if (heat) {
        body.innerHTML = matrixTable(d, { heat: true }) + heatLegend();
        meta.innerHTML = `<span class="fresh is-dly">DAILY</span> ECB ${esc(fmtDay(d.prevDate))} TO ${esc(fmtDay(d.date))}`;
        if (!cmd.args?.error) { ctx.updated(d.updated, d.stale); ctx.status('LIVE FX QUOTES MISSING, DAILY CHANGE SHOWN', 'warn'); }
      } else {
        body.innerHTML = matrixTable(d);
        meta.textContent = `${d.stale ? 'LAST KNOWN RATES' : 'ECB REFERENCE RATES'} ${fmtDay(d.date)}`;
        if (!cmd.args?.error) ctx.updated(d.updated, d.stale);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('FX MATRIX: NO DATA', 'warn');
    }
  }

  load();
  if (heat) ctx.live(load, 30_000);
}
