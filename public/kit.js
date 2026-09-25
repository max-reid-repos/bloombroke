// Shared screen parts, so every screen puts the same thing in the same place.
// Pure string builders (node:test can import them) plus edgeFade() for the browser.
// Styles: kit.css.
//
//   toolbar({ left, right })      the one row under a panel title: filters left,
//                                 a mode pair (segmented) at the right end
//   segmented(items, active)      a mode pair or small set of views: YIELDS | SPREADS
//   rangePills(active, cmdFor)    the full range set, for a chart toolbar (left);
//                                 FROM/TO dates go in toolbar right
//   panelTools({ shown, total, csv })  "40 OF 110" and CSV, for a panel title bar (right)
//   moreButton(label)             the "more rows" control, bottom-left under a table
//   dataTable({ columns, rows, sort })  a table whose label columns hug their content,
//                                 numbers right-aligned; every header sorts, or none
//   sortRows(rows, key, dir)      the sort dataTable uses
//   fmtDate(value, role)          one date format per role: table SEP 24,
//                                 prose Sep 24, 2026, axis SEP '25
//   edgeFade(el)                  fades the edges of a strip that scrolls sideways
//
// Layout classes (kit.css): .with-side (a capped table plus a side panel on wide
// screens), .tag (a plain label, never boxed), .chip (a boxed control), .cell-name
// (a name that truncates before columns drop).

import { PRESETS } from './ranges.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (c) => '?' + new URLSearchParams({ c }).toString();

export function toolbar({ left = '', right = '', label = 'Filters' } = {}) {
  return `<div class="toolbar" role="toolbar" aria-label="${esc(label)}"><div class="toolbar-main">${left}</div>${right ? `<div class="toolbar-end">${right}</div>` : ''}</div>`;
}

// items: [{ label, cmd }] (links that run a command) or [{ label, value }] (buttons
// with data-value, for screens that switch without a new command).
export function segmented(items, active, { label = 'View' } = {}) {
  const one = (it) => {
    const on = it.label === active || (it.value !== undefined && it.value === active);
    const cur = on ? ' aria-current="true"' : '';
    return it.cmd
      ? `<a class="seg-item${on ? ' is-active' : ''}" href="${esc(q(it.cmd))}" data-cmd="${esc(it.cmd)}"${cur}>${esc(it.label)}</a>`
      : `<button type="button" class="seg-item${on ? ' is-active' : ''}" data-value="${esc(it.value ?? it.label)}" aria-pressed="${on}">${esc(it.label)}</button>`;
  };
  return `<nav class="seg" aria-label="${esc(label)}">${items.map(one).join('')}</nav>`;
}

// cmdFor(range) -> the command for that range, e.g. (r) => `AAPL ${r}`.
export function rangePills(active, cmdFor, ranges = PRESETS) {
  return segmented(ranges.map((r) => ({ label: r, cmd: cmdFor(r) })), active, { label: 'Range' });
}

export function panelTools({ shown, total, csv } = {}) {
  const parts = [];
  if (Number.isFinite(shown) && Number.isFinite(total)) parts.push(`<span class="tools-count">${esc(shown)} OF ${esc(total)}</span>`);
  else if (Number.isFinite(total)) parts.push(`<span class="tools-count">${esc(total)}</span>`);
  if (csv) parts.push(`<a class="chip tools-csv" href="${esc(csv.href)}"${csv.name ? ` download="${esc(csv.name)}"` : ''}>CSV</a>`);
  return `<span class="panel-tools">${parts.join('')}</span>`;
}

export function moreButton(label = 'MORE', attrs = '') {
  return `<div class="table-more"><button type="button" class="chip"${attrs ? ` ${attrs}` : ''}>${esc(label)}</button></div>`;
}

const cmp = (a, b) => {
  const na = typeof a === 'number' && Number.isFinite(a);
  const nb = typeof b === 'number' && Number.isFinite(b);
  if (na && nb) return a - b;
  if (na !== nb) return na ? -1 : 1; // numbers before blanks
  if (a == null || a === '') return b == null || b === '' ? 0 : 1;
  if (b == null || b === '') return -1;
  return String(a).localeCompare(String(b));
};

// A stable sort; blanks stay last in both directions.
export function sortRows(rows, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((r, i) => [r, i])
    .sort(([a, i], [b, j]) => {
      const blankA = a[key] == null || a[key] === '' || (typeof a[key] === 'number' && !Number.isFinite(a[key]));
      const blankB = b[key] == null || b[key] === '' || (typeof b[key] === 'number' && !Number.isFinite(b[key]));
      if (blankA !== blankB) return blankA ? 1 : -1;
      return sign * cmp(a[key], b[key]) || i - j;
    })
    .map(([r]) => r);
}

// columns: [{ key, label, num?, name?, fmt?(value, row), cls? }]
// rows: [{ ...values, cmd? }]  (a row with cmd opens it)
// sort: { key, dir } makes every header a sort button (data-sort=key), with an arrow on
// the sorted one. Leave sort out and no header sorts.
export function dataTable({ columns, rows, sort = null, caption = '' }) {
  const sortable = Boolean(sort);
  const list = sortable && sort.key ? sortRows(rows, sort.key, sort.dir) : rows;
  const th = (c) => {
    const cls = [c.num ? 'num' : '', c.name ? 'cell-name' : '', c.cls || ''].filter(Boolean).join(' ');
    if (!sortable) return `<th scope="col"${cls ? ` class="${cls}"` : ''}>${esc(c.label)}</th>`;
    const on = sort.key === c.key;
    const aria = on ? ` aria-sort="${sort.dir === 'desc' ? 'descending' : 'ascending'}"` : '';
    const arrow = on ? (sort.dir === 'desc' ? '▼' : '▲') : '';
    return `<th scope="col"${cls ? ` class="${cls}"` : ''}${aria}><button type="button" class="th-sort${on ? ' is-sorted' : ''}" data-sort="${esc(c.key)}">${esc(c.label)}<span class="sort-arrow" aria-hidden="true">${arrow}</span></button></th>`;
  };
  const td = (c, r) => {
    const v = c.fmt ? c.fmt(r[c.key], r) : esc(r[c.key] ?? '--');
    const cls = [c.num ? 'num' : '', c.name ? 'cell-name' : '', c.cls || ''].filter(Boolean).join(' ');
    return `<td${cls ? ` class="${cls}"` : ''}>${v}</td>`;
  };
  const tr = (r) => `<tr${r.cmd ? ` data-cmd="${esc(r.cmd)}" tabindex="0"` : ''}>${columns.map((c) => td(c, r)).join('')}</tr>`;
  return `<table class="dt${sortable ? ' is-sortable' : ''}">${caption ? `<caption class="offscreen">${esc(caption)}</caption>` : ''}
    <thead><tr>${columns.map(th).join('')}</tr></thead>
    <tbody>${list.map(tr).join('')}</tbody>
  </table>`;
}

// The next sort after a header click: a new column starts high to low for numbers and
// A to Z for words; the same column flips.
export function nextSort(sort, key, numeric) {
  if (sort?.key === key) return { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' };
  return { key, dir: numeric ? 'desc' : 'asc' };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// value: 'YYYY-MM-DD' (a calendar day), a timestamp string, a Date, or epoch ms.
// Timestamps are read in New York time. Returns '--' for anything unreadable.
export function fmtDate(value, role = 'table') {
  let y; let m; let d;
  const day = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
  } else {
    const t = value instanceof Date ? value : new Date(value);
    if (value == null || value === '' || Number.isNaN(t.getTime())) return '--';
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(t);
    const get = (k) => Number(parts.find((p) => p.type === k)?.value);
    [y, m, d] = [get('year'), get('month'), get('day')];
  }
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '--';
  const mon = MONTHS[m - 1];
  if (role === 'axis') return `${mon} '${String(y).slice(-2)}`;
  if (role === 'prose') return `${mon[0]}${mon.slice(1).toLowerCase()} ${d}, ${y}`;
  return `${mon} ${String(d).padStart(2, '0')}`;
}

// Browser only: mark which edges of a sideways-scrolling strip have more to show, so
// kit.css can fade them. Returns a cleanup.
export function edgeFade(el) {
  if (!el) return () => {};
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('fade-l', el.scrollLeft > 2);
    el.classList.toggle('fade-r', max - el.scrollLeft > 2);
  };
  el.classList.add('scroll-x');
  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
  return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
}
