// MARKETS: one dense table of world markets. Also exports the shared helpers
// (number formats, panels, price tick flashes) used by the other screens.

import { delayTag, freshLegend } from '../freshness.js';

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
// Only a delayed row carries a mark (DLY); the strip says the rest are real time.
// day: MARKETS' small dim day after the name when the last trade is not from today (staleDay).
function marketRow(m, compact, chg = true, day = '') {
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

// Replace a table that refreshes on a timer without losing the focused row.
export function rerender(root, html) {
  const focused = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-cmd') : null;
  root.innerHTML = html;
  if (focused) root.querySelector(`[data-cmd="${CSS.escape(focused)}"][tabindex="0"]`)?.focus({ preventScroll: true });
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
