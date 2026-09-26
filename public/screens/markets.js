// MARKETS: one dense table of world markets. Also exports the shared helpers
// (number formats, panels, price tick flashes) used by the other screens.

import { freshTag } from '../freshness.js';

const MINUS = '−';

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function q(c) {
  return '?' + new URLSearchParams({ c }).toString();
}

export function fmtNum(n, decimals = 2) {
  if (!Number.isFinite(n)) return '--';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (n < 0 && Number(s.replace(/,/g, '')) !== 0 ? MINUS : '') + s;
}

export function fmtSigned(n, decimals = 2) {
  if (!Number.isFinite(n)) return '--';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (Number(s.replace(/,/g, '')) === 0) return s;
  return (n > 0 ? '+' : MINUS) + s;
}

export function fmtPct(n) {
  return Number.isFinite(n) ? fmtSigned(n, 2) + '%' : '--';
}

export function dirOf(n) {
  if (!Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

export function nyTime(iso, seconds = false) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined, hourCycle: 'h23',
  });
}

// "2026-09-24" -> "09/24"; a full timestamp -> "13:02" (New York).
export function fmtAsOf(asOf) {
  if (!asOf) return '--';
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return `${asOf.slice(5, 7)}/${asOf.slice(8, 10)}`;
  return nyTime(asOf);
}

// A terminal panel: inverted label strip on top, content below.
export function panel(n, label, body, { meta = '', cmd = '', cls = '', metaId = '', bodyCls = '' } = {}) {
  const text = esc(`${n}) ${label}`.toUpperCase());
  const lab = cmd
    ? `<a class="panel-label" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}">${text}</a>`
    : `<h2 class="panel-label">${text}</h2>`;
  return `<section class="panel ${cls}">
    <header class="panel-head">${lab}<span class="panel-meta"${metaId ? ` id="${metaId}"` : ''}>${meta}</span></header>
    <div class="panel-body ${bodyCls}">${body}</div>
  </section>`;
}

export const LOADING = '<p class="loading">LOADING...</p>';

// Price tick flash: compare with the last value seen for this key.
const seen = new Map();
export function tick(key, value) {
  const prev = seen.get(key);
  if (Number.isFinite(value)) seen.set(key, value);
  if (prev === undefined || !Number.isFinite(value) || prev === value) return '';
  return value > prev ? ' tick-up' : ' tick-down';
}
export function settleTicks(root, ms = 400) {
  if (!root.querySelector('.tick-up, .tick-down')) return;
  setTimeout(() => root.querySelectorAll('.tick-up, .tick-down').forEach((el) => el.classList.remove('tick-up', 'tick-down')), ms);
}

// Which command a market row opens: every named instrument has its own screen.
export function cmdForInstrument(id) {
  return id ? String(id) : null;
}

// A row that opens a screen: click anywhere on it, or focus it and press Enter.
export function rowAttrs(cmd) {
  return cmd ? ` class="row-link" data-cmd="${esc(cmd)}" tabindex="0"` : '';
}

// The name link stays for middle-click and copy link; the row itself takes the focus.
export function nameCell(name, cmd, extra = '') {
  return cmd
    ? `<th scope="row" class="name"><a href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" tabindex="-1">${esc(name)}</a>${extra}</th>`
    : `<th scope="row" class="name">${esc(name)}${extra}</th>`;
}

function marketRow(m, compact, chg = true) {
  const d = dirOf(m.change);
  const cmd = cmdForInstrument(m.id);
  return `<tr${rowAttrs(cmd)}>
      ${nameCell(m.name, cmd)}
      <td class="tag">${freshTag(m)}</td>
      <td class="num last${tick(`mk:${m.id}:last`, m.last)}">${fmtNum(m.last, m.decimals)}</td>
      ${chg ? `<td class="num chg ${d}">${fmtSigned(m.change, m.decimals)}</td>` : ''}
      <td class="num pct ${d}">${fmtPct(m.changePct)}</td>
      ${compact ? '' : `<td class="num time dim">${esc(fmtAsOf(m.asOf))}</td>`}
    </tr>`;
}

const HEAD = (compact) => `<thead><tr><th scope="col">Name</th><th scope="col" class="tag"><span class="offscreen">Real time or delayed</span></th><th scope="col" class="num">Last</th><th scope="col" class="num chg">Chg</th><th scope="col" class="num">%Chg</th>${compact ? '' : '<th scope="col" class="num time">Time</th>'}</tr></thead>`;

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

// HOME and MARKETS: one small table per group, flowing into columns on wide screens.
// Every group table uses the same fixed column widths, so the RT/DLY tags and the
// numbers line up from one group to the next. time adds the last-trade time column;
// chg: false leaves out the change column (HOME shows % only), cls names the wrapper.
export function marketsColumns(instruments, { time = false, chg = true, cls = '' } = {}) {
  const groups = [];
  for (const m of instruments) {
    const g = groups[groups.length - 1];
    if (g && g.name === m.group) g.rows.push(m); else groups.push({ name: m.group, rows: [m] });
  }
  const cols = `<colgroup><col><col class="c-tag"><col class="c-last">${chg ? '<col class="c-chg">' : ''}<col class="c-pct">${time ? '<col class="c-time">' : ''}</colgroup>`;
  const span = 4 + (chg ? 1 : 0) + (time ? 1 : 0);
  return `<div class="${cls || `mk-cols${time ? ' mk-cols-time' : ''}`}">${groups.map((g) => `<table class="grid-table mk-group">
    ${cols}<tbody><tr class="group-row"><th colspan="${span}" scope="rowgroup">${esc(g.name)}</th></tr>${g.rows.map((m) => marketRow(m, !time, chg)).join('')}</tbody>
  </table>`).join('')}</div>`;
}

// Replace a table that refreshes on a timer without losing the focused row.
export function rerender(root, html) {
  const focused = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-cmd') : null;
  root.innerHTML = html;
  if (focused) root.querySelector(`[data-cmd="${CSS.escape(focused)}"][tabindex="0"]`)?.focus({ preventScroll: true });
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Markets', LOADING, { cls: 'panel-solo', metaId: 'mk-meta', meta: 'NAME, LAST, CHANGE, TIME' });
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#mk-meta');

  async function load() {
    try {
      const data = await ctx.fetchJSON('/api/markets', { signal: ctx.signal });
      rerender(body, marketsColumns(data.instruments, { time: true }));
      settleTicks(body);
      meta.textContent = `${data.instruments.length} INSTRUMENTS`;
      ctx.updated(data.updated, data.stale, data.instruments);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH MARKETS', 'warn');
    }
  }

  load();
  ctx.live(load, 15_000);
}
