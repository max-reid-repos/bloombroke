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
//
// Card pages (the screens that are one thing, not a table: BBRK, SPONSOR, PRO, LOGIN,
// REDEEM, GIFT, FEEDBACK, CHAT without Pro). Styles: kit.css, "Card pages".
//   cardPage({ kicker, hero, sub, act, note, chart, facts, media, links, details })
//                                 one centred column, the slots always in this order
//   cardButton / cardLink / cardForm / cardFacts / cardRows   the parts that go in them
//   cardWords(html)               the words a card shows above its + Details

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
  const n = (v) => esc(v.toLocaleString('en-US'));
  if (Number.isFinite(shown) && Number.isFinite(total)) parts.push(`<span class="tools-count">${n(shown)} OF ${n(total)}</span>`);
  else if (Number.isFinite(total)) parts.push(`<span class="tools-count">${n(total)}</span>`);
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

// ---- Card pages ------------------------------------------------------------------------
// One centred column, fixed slots in a fixed order, so every card page reads the same:
//   KICKER  a small uppercase label (.tag)
//   HERO    one thing, big: a number or a short title (heroSize 96, 60, 44 or 32 px)
//   SUB     one line under it
//   ACT     at most one primary button (solid), one secondary (outline), or a form
//   NOTE    one small dim line (renewal, test mode, a rule)
//   CHART   a chart across the column
//   FACTS   2 to 6 cells: the value above a small label
//   MEDIA   a globe or a list, a fixed size, never cut off
//   LINKS   small dim links
//   + Details (the same .how toggle as WHATIF, closed): everything else, as short rows.
// A text value is escaped; raw(html) passes markup through (the caller escapes).

export const raw = (html) => ({ html: String(html ?? '') });
const put = (v) => (v && typeof v === 'object' && 'html' in v ? v.html : esc(v));
const given = (v) => (v && typeof v === 'object' ? ('html' in v ? Boolean(v.html) : true) : v !== '' && v != null && v !== false);
export const HERO_SIZES = [96, 60, 44, 32];

// A button (primary: solid; otherwise outline), a command link (cmd) or a plain link (href).
export function cardButton({ label, primary = false, id = '', cmd = '', href = '', attrs = '', type = 'button' } = {}) {
  const cls = `btn card-btn${primary ? ' btn-solid' : ''}`;
  const more = `${id ? ` id="${esc(id)}"` : ''}${attrs ? ` ${attrs}` : ''}`;
  if (cmd) return `<a class="${cls}" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}"${more}>${esc(label)}</a>`;
  if (href) return `<a class="${cls}" href="${esc(href)}"${more}>${esc(label)}</a>`;
  return `<button type="${type}" class="${cls}"${more}>${esc(label)}</button>`;
}

// A small dim link for the LINKS row: a command (cmd), a page (href) or a button (id).
export function cardLink({ label, cmd = '', href = '', id = '', attrs = '' } = {}) {
  const more = `${id ? ` id="${esc(id)}"` : ''}${attrs ? ` ${attrs}` : ''}`;
  if (cmd) return `<a class="card-link" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}"${more}>${esc(label)}</a>`;
  if (href) return `<a class="card-link" href="${esc(href)}"${more}>${esc(label)}</a>`;
  return `<button type="button" class="card-link"${more}>${esc(label)}</button>`;
}

// One input and its button, instead of "type X followed by ...". The input has no name,
// so its value never goes into a URL; the screen reads it on submit.
export function cardForm({ id, inputId, label, placeholder = '', button, maxlength = 80, inputMode = 'text' } = {}) {
  return `<form class="card-form" id="${esc(id)}" autocomplete="off" novalidate>`
    + `<input class="card-input" id="${esc(inputId)}" type="text" inputmode="${esc(inputMode)}" maxlength="${Number(maxlength) || 80}" spellcheck="false" autocapitalize="characters" autocorrect="off" enterkeyhint="go" aria-label="${esc(label)}" placeholder="${esc(placeholder)}">`
    + `<button type="submit" class="btn card-btn btn-solid">${esc(button)}</button></form>`;
}

// facts: [{ value, label, cls? }]: the value big, its label small under it.
export function cardFacts(facts = [], { id = '' } = {}) {
  const list = facts.filter(Boolean);
  const cells = list.map((f) => `<div class="card-fact"><dt class="tag">${put(f.label)}</dt><dd class="num${f.cls ? ` ${esc(f.cls)}` : ''}">${put(f.value)}</dd></div>`).join('');
  return `<dl class="card-facts n${list.length}"${id ? ` id="${esc(id)}"` : ''}>${cells}</dl>`;
}

// rows: [[label, text or raw(html)]]: a small label left, the words right. For + Details.
export function cardRows(rows = []) {
  return `<dl class="card-rows">${rows.filter(Boolean).map(([label, text]) => `<div class="card-row"><dt class="tag">${esc(label)}</dt><dd>${put(text)}</dd></div>`).join('')}</dl>`;
}

export const DETAILS = 'Details';

// The page. wide: BBRK's wider column. alert: a one-line message on top (after LOGIN,
// an error). Leave any slot out and it is not drawn.
export function cardPage({
  label = '', id = '', wide = false, cls = '', alert = '', alertWarn = false,
  kicker = '', hero = '', heroSize = 60, heroId = '', heroLabel = '', sub = '', subId = '',
  act = '', note = '', noteId = '', chart = '', facts = null, media = '', links = [], details = '', detailsId = '', detailsOpen = false,
} = {}) {
  const size = HERO_SIZES.includes(heroSize) ? heroSize : 60;
  const attr = (k, v) => (v ? ` ${k}="${esc(v)}"` : '');
  const head = [
    given(kicker) ? `<p class="tag card-kicker">${put(kicker)}</p>` : '',
    given(hero) ? `<h2 class="card-hero card-hero-${size} num"${attr('id', heroId)}${attr('aria-label', heroLabel)}>${put(hero)}</h2>` : '',
    given(sub) ? `<p class="card-sub"${attr('id', subId)}>${put(sub)}</p>` : '',
  ].join('');
  const cta = [
    given(act) ? `<div class="card-act">${put(act)}</div>` : '',
    given(note) ? `<p class="card-note"${attr('id', noteId)}>${put(note)}</p>` : '',
  ].join('');
  const linkRow = (links || []).filter(Boolean);
  const foot = [
    linkRow.length ? `<p class="card-links">${linkRow.join(' ')}</p>` : '',
    given(details) ? `<details class="how card-more"${attr('id', detailsId)}${detailsOpen ? ' open' : ''}><summary>${DETAILS}</summary><div class="card-details">${put(details)}</div></details>` : '',
  ].join('');
  return `<section class="card${wide ? ' card-wide' : ''}${cls ? ` ${esc(cls)}` : ''}"${attr('id', id)}${attr('aria-label', label)}>`
    + (given(alert) ? `<p class="card-alert${alertWarn ? ' warn' : ''}" role="status">${put(alert)}</p>` : '')
    + (head ? `<div class="card-head">${head}</div>` : '')
    + (cta ? `<div class="card-cta">${cta}</div>` : '')
    + (given(chart) ? `<div class="card-chart">${put(chart)}</div>` : '')
    + (facts ? (typeof facts === 'string' ? facts : cardFacts(facts)) : '')
    + (given(media) ? `<div class="card-media">${put(media)}</div>` : '')
    + (foot ? `<div class="card-foot">${foot}</div>` : '')
    + '</section>';
}

// The words a card shows above its + Details: tags, hidden bits and the details out;
// numbers, prices, dates' digits, keys and codes are not words. The word budgets
// (test/layout-rules.test.js) count with this.
export function cardWords(html) {
  const cut = String(html).split('<details class="how card-more"')[0];
  const text = cut
    .replace(/<([a-z0-9]+)\b[^>]*?\shidden(?=[\s>=])[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return text.split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w))
    .filter((w) => !/^[+\-−$]?\d/.test(w))
    .filter((w) => !/^(BB|GIFT)-[A-Z0-9X.-]+$/.test(w.replace(/[.,]$/, '')));
}
