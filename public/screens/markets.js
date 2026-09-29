// Market rows and the shared helpers (formats, panels, tick flashes) for every screen.

import { delayTag } from '../freshness.js';
import { loadModule } from '../lazy.js';

const MINUS = '−';

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function q(c) {
  return '?' + new URLSearchParams({ c }).toString().replace(/%24/g, '$'); // ?c=$GOLD
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

// A short note on how to read a panel's numbers, in its title strip: never a footnote
// under the panel. The long form, if any, is the tooltip. It wraps instead of being cut.
export function metaNote(text, title = '') {
  return `<span class="meta-note"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
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

// Basis points (0.01 of a percentage point), the one format on every screen: a change
// is signed (+3.8bp), a level such as the 2s10s spread is not (30.5bp). Takes bp.
export function fmtBp(bp, { level = false } = {}) {
  if (!Number.isFinite(bp)) return '--';
  return `${level ? fmtNum(bp, 1) : fmtSigned(bp, 1)}bp`;
}

// A price that moved 2% or more either way: its change cell gets a thin box.
export const BIG_MOVE_PCT = 2;

// Yields and the 2s10s spread show their change in bp (changeBp, worked out on the
// server) in the change cell; the Chg column, where there is one, stays empty for them.
// A price shows its change in %, or -- when the source has no day's move for it.
// day: MARKETS' dim day after the name for a trade not from today.
export function marketRow(m, compact, chg = true, day = '') {
  const bp = m.kind === 'yield';
  const d = dirOf(bp ? m.changeBp : m.change);
  const cmd = m.cmd || cmdForInstrument(m.id);
  const last = m.unit === 'bp' ? fmtBp(m.lastBp, { level: true }) : fmtNum(m.last, m.decimals);
  const big = !bp && Math.abs(m.changePct) >= BIG_MOVE_PCT ? ' is-big' : '';
  return `<tr${rowAttrs(cmd)}>
      ${nameCell(m.name, cmd, day ? ` <span class="mk-day dim">${esc(day)}</span>` : '')}
      <td class="tag">${delayTag(m)}</td>
      <td class="num last${tick(`mk:${m.id}:last`, m.last)}"${m.asOf ? ` title="As of ${esc(fmtAsOf(m.asOf))}${/T/.test(m.asOf) ? ' ET' : ''}"` : ''}>${last}</td>
      ${chg ? `<td class="num chg ${d}">${bp ? '' : fmtSigned(m.change, m.decimals)}</td>` : ''}
      <td class="num pct ${d}${big}">${bp ? fmtBp(m.changeBp) : fmtPct(m.changePct)}</td>
      ${compact ? '' : `<td class="num time dim">${esc(fmtAsOf(m.asOf))}</td>`}
    </tr>`;
}

// HOME: one small table per group, flowing into columns on wide screens.
// Every group table uses the same fixed column widths, so the DLY marks and the
// numbers line up from one group to the next. time adds the last-trade time column;
// chg: false leaves out the change column (HOME shows % only), cls names the wrapper.
// A row with a sub (HOME: Europe, Asia, Energy...) opens a thin sub-heading bar inside
// its group when the sub changes.
export function marketsColumns(instruments, { time = false, chg = true, cls = '' } = {}) {
  const groups = [];
  for (const m of instruments) {
    const g = groups[groups.length - 1];
    if (g && g.name === m.group) g.rows.push(m); else groups.push({ name: m.group, rows: [m] });
  }
  const cols = `<colgroup><col><col class="c-tag"><col class="c-last">${chg ? '<col class="c-chg">' : ''}<col class="c-pct">${time ? '<col class="c-time">' : ''}</colgroup>`;
  const span = 4 + (chg ? 1 : 0) + (time ? 1 : 0);
  return `<div class="${cls || `mk-cols${time ? ' mk-cols-time' : ''}`}">${groups.map((g) => `<table class="grid-table mk-group">
    ${cols}<tbody><tr class="group-row"><th colspan="${span}" scope="rowgroup">${esc(g.name)}</th></tr>${g.rows.map((m, i) => (m.sub && m.sub !== g.rows[i - 1]?.sub
    ? `<tr class="group-row sub-row"><th colspan="${span}" scope="rowgroup">${esc(m.sub)}</th></tr>`
    : '') + marketRow(m, !time, chg)).join('')}</tbody>
  </table>`).join('')}</div>`;
}

// HOME's MARKETS list: four columns, each a group of the MARKETS screen's own
// instruments under short names (the full list and full names stay on MARKETS). A plain
// string starts a sub-heading bar inside the column (Europe, Asia, Commodities...). Every
// column is the same shape, two sub-headings and ten rows, so all four end on one line.
export const HOME_MARKETS = [
  { name: 'US', rows: [
    'Indexes', ['SPX', 'S&P 500'], ['NDX', 'Nasdaq 100'], ['DJI', 'Dow'], ['RUT', 'Russell 2000'], ['SPXEW', 'Equal weight'],
    ['SOX', 'Semis'], ['DJTRANS', 'Transports'],
    'Futures + vol', ['SPFUT', 'S&P 500 fut'], ['NDFUT', 'Nasdaq 100 fut'], ['VIX', 'VIX'],
  ] },
  { name: 'World', rows: [
    'Europe', ['STOXX50', 'Euro Stoxx 50'], ['FTSE', 'FTSE 100'], ['DAX', 'DAX'], ['CAC40', 'CAC 40'],
    'Asia', ['N225', 'Nikkei 225'], ['HSI', 'Hang Seng'], ['SHANGHAI', 'Shanghai'], ['KOSPI', 'KOSPI'], ['NIFTY50', 'Nifty 50'], ['ASX200', 'ASX 200'],
  ] },
  { name: 'Commodities + crypto', rows: [
    'Commodities', ['WTI', 'WTI oil'], ['BRENT', 'Brent oil'], ['NATGAS', 'Natural gas'], ['GOLD', 'Gold (spot)'],
    ['SILVER', 'Silver (spot)'], ['COPPER', 'Copper'], ['WHEAT', 'Wheat'], ['BALTICDRY', 'Baltic Dry'],
    'Crypto', ['BTC', 'Bitcoin'], ['ETH', 'Ether'],
  ] },
  { name: 'FX + rates', rows: [
    'FX', ['DXY', 'Dollar index'], ['EURUSD', 'EUR/USD'], ['USDJPY', 'USD/JPY'], ['GBPUSD', 'GBP/USD'], ['USDCNH', 'USD/CNH'],
    'Rates', ['US3M', 'US 3M'], ['US2Y', 'US 2Y'], ['US10Y', 'US 10Y'], ['US30Y', 'US 30Y'], ['US2S10S', '2s10s'],
  ] },
];

// The HOME rows from /api/markets, regrouped in the order above, each with its group,
// sub-heading and short name. A missing id drops out; a sub-heading with no rows left
// drops with it (it only shows above a row).
export function homeMarkets(instruments) {
  const byId = new Map((instruments || []).map((m) => [m.id, m]));
  return HOME_MARKETS.flatMap((g) => {
    let sub = null;
    const out = [];
    for (const r of g.rows) {
      if (typeof r === 'string') { sub = r; continue; }
      const [id, name] = r;
      if (byId.has(id)) out.push({ ...byId.get(id), name, group: g.name, sub });
    }
    return out;
  });
}

// Replace a table that refreshes on a timer without losing the focused row.
export function rerender(root, html) {
  const focused = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-cmd') : null;
  root.innerHTML = html;
  if (focused) root.querySelector(`[data-cmd="${CSS.escape(focused)}"][tabindex="0"]`)?.focus({ preventScroll: true });
}

// MARKETS comes with the page; its layout is markets-full.js, off the startup bundle.
export const MARKETS_FULL = 'screens/markets-full.js';
export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Markets', LOADING, { cls: 'panel-solo mk-panel', metaId: 'mk-meta' });
  loadModule(MARKETS_FULL).then((m) => { if (!ctx.signal?.aborted) m.render(el, cmd, ctx); }, () => {
    if (!ctx.signal?.aborted) ctx.status?.('COULD NOT LOAD MARKETS', 'warn');
  });
}
