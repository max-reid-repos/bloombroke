// Shared screen parts, so every screen puts the same thing in the same place.
// Pure string builders (node:test can import them) plus edgeFade() and fitToView() for
// the browser. Styles: kit.css. The toolbar, table and date parts live in kit-core.js
// (startup modules import them from there) and come out of here too; the card pages
// below are only in this file, which loads with the first screen that uses the kit.
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
//   cardPage({ art, kicker, hero, sub, act, note, chart, facts, media, links, details })
//                                 one centred column, the slots always in this order
//   cardButton / cardLink / cardForm / cardFacts / cardRows   the parts that go in them
//   cardWords(html)               the words a card shows above its + Details
//   fitToView(el)                 a globe sized to the room left in the first view
//   usageCard(...)                a command typed wrong (15 words at most)
//   emptyState(...)               a list with nothing in it (20 words at most)

export * from './kit-core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (c) => '?' + new URLSearchParams({ c }).toString();

// ---- Card pages ------------------------------------------------------------------------
// One centred column, fixed slots in a fixed order, so every card page reads the same:
//   ART     a small drawing above it all (SPONSOR's terminal), words on it are the picture's
//   KICKER  a small uppercase label (.tag)
//   HERO    one thing, big: a number or a short title (heroSize 96, 60, 44 or 32 px;
//           24 for a usage card's problem)
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
export const HERO_SIZES = [96, 60, 44, 32, 24]; // 24: the usage card's problem line

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
  label = '', id = '', wide = false, cls = '', alert = '', alertWarn = false, art = '',
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
    + (given(art) ? `<div class="card-art">${put(art)}</div>` : '')
    + (head ? `<div class="card-head">${head}</div>` : '')
    + (cta ? `<div class="card-cta">${cta}</div>` : '')
    + (given(chart) ? `<div class="card-chart">${put(chart)}</div>` : '')
    + (facts ? (typeof facts === 'string' ? facts : cardFacts(facts)) : '')
    + (given(media) ? `<div class="card-media">${put(media)}</div>` : '')
    + (foot ? `<div class="card-foot">${foot}</div>` : '')
    + '</section>';
}

// ---- Usage card and empty state ------------------------------------------------------

// Examples carry data-example: app.js examplePlan runs a showing one, prefills a saving one.
const codeLink = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}" data-example>${esc(c)}</a>`;

// A command typed wrong: problem (hero 24), format (short, one line), example (a button);
// grammar (the full shape), more (examples) and notes ([label, text] or text) in + Details.
export function usageCard({ problem, format = '', grammar = '', example = '', more = [], notes = [], label = 'How to type it' } = {}) {
  const rows = [
    grammar ? ['Format', raw(`<span class="code card-grammar">${esc(grammar)}</span>`)] : null,
    more.length ? ['More examples', raw(`<span class="codes">${more.map(codeLink).join(' ')}</span>`)] : null,
    ...notes.filter(Boolean).map((n) => (Array.isArray(n) ? n : ['Note', n])),
  ].filter(Boolean);
  return cardPage({
    cls: 'card-usage', label,
    hero: problem, heroSize: 24,
    sub: format ? raw(`<span class="card-format">${esc(format)}</span>`) : '',
    act: example ? raw(cardButton({ label: example, cmd: example, primary: true, attrs: 'data-example' })) : '',
    details: rows.length ? raw(cardRows(rows)) : '',
  });
}

// An empty list: title, hint (60ch at most), action ({ label, cmd } or raw(html), DESK's
// presets), details (+ Details). small: a side panel's note.
export function emptyState({ title, hint = '', action = null, details = '', small = false, cls = '', id = '', hidden = false } = {}) {
  const act = action && typeof action === 'object' && 'cmd' in action
    ? `<a class="btn empty-btn" href="${esc(q(action.cmd))}" data-cmd="${esc(action.cmd)}" data-example>${esc(action.label || action.cmd)}</a>`
    : given(action) ? put(action) : '';
  return `<div class="empty${small ? ' is-small' : ''}${cls ? ` ${esc(cls)}` : ''}"${id ? ` id="${esc(id)}"` : ''}${hidden ? ' hidden' : ''}>`
    + `<p class="empty-title">${put(title)}</p>`
    + (given(hint) ? `<p class="empty-hint">${put(hint)}</p>` : '')
    + (act ? `<div class="empty-act">${act}</div>` : '')
    + (given(details) ? `<details class="how card-more"><summary>${DETAILS}</summary><div class="card-details">${put(details)}</div></details>` : '')
    + '</div>';
}

// The words a card shows above its + Details: tags, hidden bits and the details out;
// numbers, prices, dates' digits, keys and codes are not words, nor words on a picture
// (role="img" with an aria-label, aria-hidden="true"). The budgets (test/layout-rules.test.js) count with this.
export function cardWords(html) {
  const cut = String(html).split('<details class="how card-more"')[0];
  const text = cut
    .replace(/<([a-z0-9]+)\b[^>]*?\shidden(?=[\s>=])[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<([a-z0-9]+)\b(?:(?=[^>]*\srole="img")(?=[^>]*\saria-label="[^"]+")|(?=[^>]*\saria-hidden="true"))[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return text.split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w))
    .filter((w) => !/^[+\-−$]?\d/.test(w))
    .filter((w) => !/^(BB|GIFT)-[A-Z0-9X.-]+$/.test(w.replace(/[.,]$/, '')));
}

// Browser only: size a card's media (the globe) to the room left in the first view, so
// on a desktop it is never below the fold: between min and max px, written to --fit-w on
// the element (its CSS reads it). Measured as if the page were scrolled to the top, up to
// the dock. A phone (under 640 px) keeps its own size and scrolls. Returns the size.
export function fitToView(el, { min = 220, max = 340, win = globalThis.window, doc = globalThis.document } = {}) {
  if (!el?.isConnected || !win || !doc) return null;
  if (win.matchMedia?.('(max-width: 639px)').matches) { el.style.removeProperty('--fit-w'); return null; }
  const screen = doc.getElementById('screen');
  const own = screen && /auto|scroll/.test(win.getComputedStyle(screen).overflowY);
  const scrolled = own ? screen.scrollTop : (win.scrollY || 0);
  const dock = doc.querySelector('.dock');
  const bottom = Math.min(own ? screen.getBoundingClientRect().bottom : win.innerHeight, dock ? dock.getBoundingClientRect().top : win.innerHeight);
  const top = el.getBoundingClientRect().top + scrolled;
  const canvas = el.querySelector('canvas');
  const extra = canvas ? el.offsetHeight - canvas.offsetHeight : 0; // the caption under it
  const size = Math.max(min, Math.min(max, Math.floor(bottom - top - extra - 8)));
  el.style.setProperty('--fit-w', `${size}px`);
  return size;
}
