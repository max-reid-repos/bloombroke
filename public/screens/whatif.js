// WHATIF: in hindsight, the maker's stock instead of the thing. A picker of things people bought, and a
// receipt of what that money would be worth today in the maker's stock.
//
// WHATIF                      the picker: a shelf of doodle cards in tabs
// WHATIF VICES                the picker, on the VICES shelf (GADGETS, GAMES, HABITS too)
// WHATIF IPHONE               the picker, with every iPhone picked
// WHATIF EDIT IPHONE6 LATTE   the picker, with these picked
// WHATIF IPHONE6 LATTE:3Y     the result, with the REPLAY race and SAVE VIDEO
// WHATIF MY 1200 AAPL 2015    your own purchase (free for everyone)

import { esc, q, fmtNum, panel, metaNote, LOADING, nyTime } from './markets.js';
import { toolbar, segmented } from '../kit.js';
import { createReplay, fmtCounter, isBehind } from '../whatif-replay.js';
import { videoSupport, makeVideo, downloadBlob, VIDEO_NEEDS } from '../whatif-video.js';
import { parseMine, formWords, mineLabel, fmtAmount, MINE_DOODLE, MINE_EXAMPLES } from '../whatif-mine.js';
import { whatifEmbedSnippet } from '../embed-snippet.js'; // EMBED: the iframe line
import { goal } from '../goal.js'; // GOALS

let catalogCache = null;
async function loadCatalog(ctx) {
  if (!catalogCache) catalogCache = await ctx.fetchJSON('/api/whatif/catalog', { signal: ctx.signal });
  return catalogCache;
}

// ---- Pure helpers (tested) ------------------------------------------------------

const word = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const allItems = (cat) => [...cat.products, ...cat.recurring];

// Which ids a family word (IPHONE, APPLE, CAR) covers.
export function familyIds(cat, fam) {
  const f = word(fam);
  const hit = (w) => w === f || w === f.replace(/S$/, '');
  return allItems(cat).filter((p) => hit(word(p.family)) || hit(word(p.company)) || hit(word(p.category))).map((p) => p.id);
}

// ---- Shelves ---------------------------------------------------------------------
// The picker's tabs. An item is on the shelves it names (Big Mac: HABITS and VICES),
// else on one by its kind and category.
export const SHELVES = ['GADGETS', 'CARS', 'GAMES', 'HABITS', 'VICES'];
// Words that open a shelf with nothing picked. CARS stays a family word (every Tesla),
// as it always was. The server knows the same list (data/whatif.js SHELF_WORDS).
export const SHELF_WORDS = ['GADGETS', 'GAMES', 'HABITS', 'VICES'];
const CATEGORY_SHELF = { car: 'CARS', console: 'GAMES', gpu: 'GAMES', vr: 'GAMES' };
export function shelvesOf(p) {
  if (Array.isArray(p.shelves) && p.shelves.length) return p.shelves.map((x) => String(x).toUpperCase());
  if (p.kind === 'monthly') return ['HABITS'];
  return [CATEGORY_SHELF[p.category] || 'GADGETS'];
}
export const shelfItems = (cat, shelf) => allItems(cat).filter((p) => shelvesOf(p).includes(shelf));

// Tokens -> { mode: 'picker' | 'result' | 'error', picks: Map(id -> spec), mine: [MY items],
// shelf, words: the words to send (your own purchases written the canonical way) }
export function planWhatif(tokens, cat) {
  const ids = new Map(allItems(cat).map((p) => [p.id.toUpperCase(), p]));
  const edit = tokens[0] === 'EDIT';
  let toks = edit ? tokens.slice(1) : tokens;
  const picks = new Map();
  let mine = [];
  let families = 0;
  let shelf = null;
  const firstShelf = () => {
    const first = allItems(cat).find((p) => p.id === [...picks.keys()][0]);
    return shelf || (first ? shelvesOf(first)[0] : SHELVES[0]);
  };
  try {
    ({ mine, rest: toks } = parseMine(toks));
  } catch (err) {
    return { mode: 'error', message: err.message, picks, mine: [], shelf: SHELVES[0], words: tokens };
  }
  const words = [...toks, ...mine.flatMap((m) => m.words)];
  for (const t of toks) {
    const [head, spec = ''] = t.split(':');
    const item = ids.get(head);
    if (item) { picks.set(item.id, spec); continue; }
    if (SHELF_WORDS.includes(head) && !spec) { families += 1; shelf ||= head; continue; }
    const fam = familyIds(cat, head);
    if (fam.length && !spec) { families += 1; fam.forEach((id) => { if (!picks.has(id)) picks.set(id, ''); }); continue; }
    return { mode: 'result', picks, mine, shelf: firstShelf(), words }; // unknown word: the server explains it
  }
  const mode = edit || (!toks.length && !mine.length) || (families === toks.length && !mine.length) ? 'picker' : 'result';
  return { mode, picks, mine, shelf: firstShelf(), words };
}

// Years box -> spec. "5" and "5Y" -> "5Y"; "2015" and "2015-2024" stay.
export function normalizeSpec(v, fallbackYears) {
  const s = String(v || '').trim().toUpperCase();
  if (/^\d{1,2}$/.test(s)) return `${s}Y`;
  if (/^\d{1,2}Y$/.test(s) || /^\d{4}(-\d{4})?$/.test(s)) return s;
  return `${fallbackYears}Y`;
}

// mine: your own purchases (MY items), after the catalogue picks.
export function commandFor(picks, cat, mine = []) {
  const out = ['WHATIF'];
  for (const p of allItems(cat)) {
    if (!picks.has(p.id)) continue;
    const spec = p.kind === 'monthly' ? normalizeSpec(picks.get(p.id), p.defaultYears) : '';
    out.push((spec ? `${p.id}:${spec}` : p.id).toUpperCase());
  }
  for (const m of mine) out.push(...m.words);
  return out.join(' ');
}


export function fmtUsd(n) {
  if (!Number.isFinite(n)) return '--';
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : 2;
  return (n < 0 ? '−' : '') + '$' + a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
// The same rule as the certificate (data/whatif-cert.js multiple), so the page and the
// image never disagree: 11.1x on both, not 11.12x beside 11.1x.
export const fmtX = (m) => (Number.isFinite(m) ? `${fmtNum(m, m >= 100 ? 0 : m >= 0.1 ? 1 : 2)}x` : '--');

// Picker columns: a long family (Apple has 20-odd items) is cut into runs of at most
// `max`, so the columns come out even instead of one tall column and an empty one.
export function splitGroups(groups, max = 12) {
  const out = [];
  for (const g of groups) {
    const n = Math.ceil(g.items.length / max);
    if (n <= 1) { out.push(g); continue; }
    const size = Math.ceil(g.items.length / n);
    for (let i = 0; i < n; i += 1) out.push({ ...g, items: g.items.slice(i * size, (i + 1) * size), part: i + 1 });
  }
  return out;
}
export const fmtShares = (n) => (n >= 1000 ? fmtNum(n, 0) : n >= 1 ? fmtNum(n, 3) : fmtNum(n, 4));

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function fmtDay(isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}
export function fmtMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// One dry line, picked by outcome and by what was bought. The same command always gets
// the same line. Hindsight only: the lines describe what happened, never what anyone
// should do. QUIPS: things bought once. GADGET_QUIPS join them for gadgets only.
export const QUIPS = {
  big: [
    'In hindsight, the company did better than the product.',
    'Somewhere, a shareholder thanks you for your purchase.',
  ],
  gain: [
    'This time, the stock beat the stuff.',
    'The money grew. You just were not holding it.',
  ],
  loss: [
    'Good news: you dodged this one.',
    'The product held up better than the stock.',
  ],
};
export const GADGET_QUIPS = {
  big: ['The gadget is in a drawer somewhere. The stock is not.'],
  gain: ['The stock did better than the gadget.'],
  loss: ['For once, the gadget was the better buy.'],
};
export const HABIT_QUIPS = {
  big: ['The habit is long gone. The shares would not be.', 'All those small buys, in hindsight, added up.'],
  gain: ['In hindsight, the habit money grew.'],
  loss: ['For once, spending it was the smart move.'],
};
export const WHATIF_TITLE = 'WHATIF: what if you had bought the stock?';
export const HINDSIGHT_NOTE = 'Hindsight only. Past returns do not predict future returns. Not a recommendation.';

// "−43%". Drops are shown with a real minus sign.
export function fmtDrop(pct) {
  if (!Number.isFinite(pct)) return '--';
  const r = Math.round(Math.abs(pct));
  return r === 0 ? '0%' : `−${r}%`;
}
const monthWord = (month) => (month === 'now' ? 'TODAY' : /^\d{4}-\d{2}$/.test(month || '') ? fmtMonth(month) : '');
// The drop's range, high to low: "FEB 2025 TO SEP 2026", or "FEB 2025 TO TODAY" when the
// low is today's price. Only the low month when the high is not known.
export function dropRange(w) {
  const to = monthWord(w?.month);
  if (!to) return '';
  const from = monthWord(w.peakMonth);
  return from && from !== to ? `${from} TO ${to}` : to === 'TODAY' ? 'today' : to;
}

// The risk line under every result: the worst fall of a holding between its purchase and
// today, at month-end prices. Several holdings: the worst one, named.
export function riskLine(d) {
  const w = d.risk?.worst;
  if (!w) return 'Worst drop along the way: not available right now. Prices can fall a long way before they recover.';
  if (w.pct > -0.5) return 'Worst drop along the way: none at month-end prices, so far. That can change.';
  const when = dropRange(w);
  const who = d.rows.length > 1 ? `, in ${w.ticker} (${w.name})` : '';
  return `Worst drop along the way: ${fmtDrop(w.pct)}${when ? ` (${when})` : ''}${who}, based on month-end prices.`;
}

// Several holdings: every one's worst drop, in the order of the table.
export function dropList(rows) {
  const parts = rows.map((r) => {
    const w = r.worstDrop;
    if (!w) return `${r.name} --`;
    const when = w.pct > -0.5 ? '' : dropRange(w);
    return `${r.name} ${fmtDrop(w.pct)}${when ? ` (${when})` : ''}`;
  });
  return `Worst drop along the way, by holding, month-end prices: ${parts.join('; ')}.`;
}

export function hashText(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// kind: 'thing' | 'gadget' | 'habit' (see quipKind).
export function quipFor(multiple, key, kind = 'thing') {
  const bucket = multiple > 5 ? 'big' : multiple >= 1 ? 'gain' : 'loss';
  const list = kind === 'habit' ? HABIT_QUIPS[bucket] : kind === 'gadget' ? [...GADGET_QUIPS[bucket], ...QUIPS[bucket]] : QUIPS[bucket];
  return list[hashText(key) % list.length];
}

// ---- Picker ---------------------------------------------------------------------
// A shelf of doodle cards per tab. Keys: arrows move, Space picks, Enter runs, [ and ]
// change the shelf. On a habit card, typing a number goes into its years box.

const EXAMPLES = ['WHATIF IPHONE6 IPHONE8 LATTE:3Y', 'WHATIF MODEL3 RTX3080', 'WHATIF BEER:10Y BETTING', MINE_EXAMPLES[0]];
const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;
export const PICKER_KEYS = 'SPACE PICK · ENTER RUN';
export const PICKER_KEYS_LONG = 'Arrows move. Space picks. Enter runs. [ and ] change the shelf.';
export const PICKER_INTRO = 'Pick what you bought. See what the stock would be worth now.';

export function cardHtml(p, picks) {
  const on = picks.has(p.id);
  const box = `<span class="wi-box" aria-hidden="true">${on ? '[x]' : '[ ]'}</span>`;
  const img = `<img class="wi-doodle" src="${esc(art(`doodle-${p.doodle || 'box'}.webp`))}" width="384" height="384" alt="" loading="lazy" decoding="async">`;
  const meta = p.kind === 'monthly'
    ? `<span class="wi-cmeta"><span class="dim">${esc(p.ticker)}</span><label class="wi-years"><span class="offscreen">Years or dates for ${esc(p.name)}</span><input type="text" inputmode="text" maxlength="9" value="${esc(picks.get(p.id) || `${p.defaultYears}Y`)}" data-spec="${esc(p.id)}" spellcheck="false" autocomplete="off"></label></span>`
    : `<span class="wi-cmeta num">${esc(p.date.slice(0, 4))} ${esc(fmtUsd(p.price))}</span>`;
  return `<li class="wi-card${on ? ' is-on' : ''}" role="option" aria-selected="${on}" tabindex="-1" data-id="${esc(p.id)}" title="${esc(`${p.name}, ${p.company} ${p.ticker}`)}">
    ${img}${box}<span class="wi-cname">${esc(p.name)}</span>${meta}
  </li>`;
}

// The YOUR OWN card (first on every shelf) and a card per purchase of your own.
export function ownCardHtml() {
  return `<li class="wi-card wi-own" role="option" aria-selected="false" tabindex="-1" data-own title="Your own purchase: any stock or ETF, any date">
    <img class="wi-doodle" src="${esc(art(`doodle-${MINE_DOODLE}.webp`))}" width="384" height="384" alt="" loading="lazy" decoding="async"><span class="wi-box" aria-hidden="true">[+]</span><span class="wi-cname">YOUR OWN</span><span class="wi-cmeta">Any stock</span>
  </li>`;
}
export function mineCardHtml(m) {
  return `<li class="wi-card is-on" role="option" aria-selected="true" tabindex="-1" data-mine="${esc(m.id)}" title="${esc(mineLabel(m))}">
    <img class="wi-doodle" src="${esc(art(`doodle-${MINE_DOODLE}.webp`))}" width="384" height="384" alt="" loading="lazy" decoding="async"><span class="wi-box" aria-hidden="true">[x]</span><span class="wi-cname">${esc(mineLabel(m))}</span><span class="wi-cmeta dim">YOUR OWN</span>
  </li>`;
}
// The inline form, one sentence: [$ 15] [a week] in [AAPL] since [2015]  ADD.
// "once" turns "since" into "on". TO stays in the command only.
export const FORM_HOW = [['ONCE', 'once'], ['DAY', 'a day'], ['WEEK', 'a week'], ['MONTH', 'a month']];
export const FORM_START = 'WEEK';
export function formHints(how) {
  return how === 'ONCE'
    ? { word: 'on', amount: '1200', date: '2015-03', dateTitle: 'A year, a month or a day: 2015, 2015-03 or 2015-03-02' }
    : { word: 'since', amount: '15', date: '2015', dateTitle: 'A year or a month: 2015 or 2015-03' };
}
export function ownFormHtml() {
  const h = formHints(FORM_START);
  const input = (name, label, attrs) => `<input ${attrs} data-f="${name}" aria-label="${label}" spellcheck="false" autocomplete="off">`;
  return `<div class="wi-ownform" hidden>
      <div class="wo-line">
        <span class="wo-amt"><span class="wo-cur" aria-hidden="true">$</span>${input('amount', 'Amount in dollars', `type="text" inputmode="numeric" maxlength="11" placeholder="${h.amount}"`)}</span>
        <select data-f="how" aria-label="How often">${FORM_HOW.map(([v, t]) => `<option value="${v}"${v === FORM_START ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <span class="wo-w">in</span>
        ${input('ticker', 'Stock ticker', 'type="text" class="wo-tk" maxlength="8" placeholder="AAPL" autocapitalize="characters"')}
        <span class="wo-w" data-wo="date">${h.word}</span>
        ${input('date', 'Date', `type="text" class="wo-dt" maxlength="10" placeholder="${h.date}" title="${h.dateTitle}"`)}
        <button type="button" class="wi-btn wo-add" data-wo="add">ADD</button>
        <button type="button" class="wo-close" data-wo="close" aria-label="Close" title="Close (Esc)">&times;</button>
      </div>
      <p class="wo-msg" data-wo="msg" role="status"></p>
    </div>`;
}

function renderPicker(el, ctx, cat, picks, startShelf = SHELVES[0], mine = []) {
  let shelf = SHELVES.includes(startShelf) ? startShelf : SHELVES[0];
  const tabs = () => segmented(SHELVES.map((x) => ({ label: x, value: x })), shelf, { label: 'Shelves' });
  el.innerHTML = panel('1', WHATIF_TITLE, `
    <p class="wi-intro" title="${esc(`Or type it: ${EXAMPLES[0]}`)}">${esc(PICKER_INTRO)}</p>
    <div class="wi-tabs">${toolbar({ left: tabs(), label: 'Shelves' })}</div>
    ${ownFormHtml()}
    <ul class="wi-shelf" role="listbox" aria-multiselectable="true" aria-label="Things you bought" data-own-focus></ul>
    <div class="wi-bar">
      <span class="wi-count" id="wi-count"></span>
      <span class="wi-cmd code" id="wi-cmd"></span>
      <button type="button" class="wi-run" id="wi-run">RUN</button>
    </div>`, { cls: 'panel-solo wi-panel', meta: `<span class="wi-hint">${metaNote(PICKER_KEYS, PICKER_KEYS_LONG)}</span>` });

  const list = el.querySelector('.wi-shelf');
  const tabBox = el.querySelector('.wi-tabs');
  const countEl = el.querySelector('#wi-count');
  const cmdEl = el.querySelector('#wi-cmd');
  const byId = new Map(allItems(cat).map((p) => [p.id, p]));
  let rows = [];

  function refresh() {
    const once = [...picks.keys()].map((id) => byId.get(id)).filter((p) => p.kind === 'once');
    const spent = once.reduce((n, p) => n + p.price, 0) + mine.filter((m) => m.kind === 'once').reduce((n, m) => n + m.amount, 0);
    const n = picks.size + mine.length;
    const onceN = once.length + mine.filter((m) => m.kind === 'once').length;
    countEl.textContent = n ? `${n} PICKED${onceN ? `, ${fmtUsd(spent)} ONE-OFF` : ''}` : 'NOTHING PICKED';
    cmdEl.textContent = n ? commandFor(picks, cat, mine) : '';
    ctx.status(n ? `WHATIF: ${n} PICKED` : '');
  }

  function cols() {
    if (rows.length < 2) return 1;
    const top = rows[0].offsetTop;
    const n = rows.findIndex((r) => r.offsetTop !== top);
    return n < 0 ? rows.length : n;
  }

  function focusRow(i, { scroll = true } = {}) {
    if (!rows.length) return;
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    rows.forEach((x) => { x.tabIndex = -1; });
    r.tabIndex = 0;
    r.focus({ preventScroll: true });
    if (scroll) r.scrollIntoView({ block: 'nearest' });
  }

  function showShelf(name, { focus = true } = {}) {
    // Years typed on this shelf are kept before its cards are redrawn.
    for (const inp of list.querySelectorAll('input[data-spec]')) if (picks.has(inp.dataset.spec)) picks.set(inp.dataset.spec, inp.value);
    shelf = name;
    tabBox.innerHTML = toolbar({ left: tabs(), label: 'Shelves' });
    list.innerHTML = ownCardHtml() + mine.map(mineCardHtml).join('') + shelfItems(cat, shelf).map((p) => cardHtml(p, picks)).join('');
    list.setAttribute('aria-label', `${shelf}: things you bought`);
    rows = [...list.querySelectorAll('.wi-card')];
    const first = Math.max(0, rows.findIndex((r) => picks.has(r.dataset.id) || r.dataset.mine));
    if (rows[first]) rows[first].tabIndex = 0;
    if (focus && !window.matchMedia('(pointer: coarse)').matches) focusRow(first, { scroll: false });
  }
  const moveShelf = (dir) => showShelf(SHELVES[(SHELVES.indexOf(shelf) + dir + SHELVES.length) % SHELVES.length]);

  // YOUR OWN: the form. A purchase of your own: remove it.
  const form = el.querySelector('.wi-ownform');
  const f = (name) => form.querySelector(`[data-f="${name}"]`);
  const wo = (name) => form.querySelector(`[data-wo="${name}"]`);
  function syncForm() {
    const h = formHints(f('how').value);
    wo('date').textContent = h.word;
    f('amount').placeholder = h.amount;
    f('date').placeholder = h.date;
    f('date').title = h.dateTitle;
  }
  function openForm() {
    form.hidden = false;
    syncForm();
    f('amount').focus();
  }
  function closeForm() {
    form.hidden = true;
    const own = list.querySelector('[data-own]');
    if (own) focusRow(rows.indexOf(own));
  }
  // Adds the purchase in the form; true when it was added.
  function addOwn() {
    try {
      const words = formWords({ amount: f('amount').value, ticker: f('ticker').value, date: f('date').value, how: f('how').value });
      const [item] = parseMine(words).mine;
      if (!mine.some((m) => m.id === item.id)) mine.push(item);
      wo('msg').textContent = '';
      ['amount', 'ticker', 'date'].forEach((k) => { f(k).value = ''; });
      showShelf(shelf, { focus: false });
      refresh();
      return true;
    } catch (err) {
      wo('msg').textContent = err.message;
      return false;
    }
  }
  form.addEventListener('change', syncForm);
  form.addEventListener('input', () => { wo('msg').textContent = ''; });
  wo('add').addEventListener('click', () => { if (addOwn()) closeForm(); });
  wo('close').addEventListener('click', closeForm);
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input, select')) {
      e.preventDefault(); e.stopPropagation();
      // Enter adds it and runs, like the years box.
      const empty = !f('amount').value && !f('ticker').value && !f('date').value;
      if (empty || addOwn()) runPicks();
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeForm(); }
  });

  function toggle(row) {
    if (row.dataset.own !== undefined) { openForm(); return; }
    if (row.dataset.mine) {
      mine = mine.filter((m) => m.id !== row.dataset.mine);
      showShelf(shelf);
      refresh();
      return;
    }
    const id = row.dataset.id;
    if (picks.has(id)) picks.delete(id);
    else picks.set(id, row.querySelector('input')?.value || '');
    const on = picks.has(id);
    row.classList.toggle('is-on', on);
    row.setAttribute('aria-selected', String(on));
    row.querySelector('.wi-box').textContent = on ? '[x]' : '[ ]';
    refresh();
  }

  function runPicks() {
    for (const inp of el.querySelectorAll('input[data-spec]')) {
      if (picks.has(inp.dataset.spec)) picks.set(inp.dataset.spec, inp.value);
    }
    if (!picks.size && !mine.length) { ctx.status('PICK AT LEAST ONE THING', 'warn'); return; }
    ctx.run(commandFor(picks, cat, mine));
  }

  list.addEventListener('keydown', (e) => {
    const inInput = e.target.matches('input');
    const row = e.target.closest('.wi-card');
    if (!row || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = rows.indexOf(row);
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (inInput) {
      if (e.key === 'Enter') { stop(); runPicks(); }
      else if (e.key === 'Escape') { stop(); focusRow(i); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { stop(); focusRow(i + (e.key === 'ArrowDown' ? cols() : -cols())); }
      return;
    }
    const input = row.querySelector('input');
    // A habit card: a number (or Y) goes straight into its years box.
    if (input && /^[0-9Yy]$/.test(e.key)) { e.stopPropagation(); input.focus(); return; }
    const keys = {
      ArrowRight: () => focusRow(i + 1),
      ArrowLeft: () => focusRow(i - 1),
      ArrowDown: () => focusRow(i + cols()),
      ArrowUp: () => focusRow(i - cols()),
      Home: () => focusRow(0),
      End: () => focusRow(rows.length - 1),
      '[': () => moveShelf(-1),
      ']': () => moveShelf(1),
      ' ': () => toggle(row),
      Enter: () => runPicks(),
    };
    if (keys[e.key]) { stop(); keys[e.key](); }
  });

  // [ and ] also work from the shelf tabs.
  tabBox.addEventListener('keydown', (e) => {
    if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); moveShelf(e.key === ']' ? 1 : -1); }
  });
  tabBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (b) showShelf(b.dataset.value);
  });

  list.addEventListener('click', (e) => {
    const row = e.target.closest('.wi-card');
    if (!row || e.target.closest('label, input')) return;
    toggle(row);
    rows.forEach((x) => { x.tabIndex = -1; });
    row.tabIndex = 0;
    row.focus({ preventScroll: true });
  });

  list.addEventListener('input', (e) => {
    const id = e.target.dataset.spec;
    if (!id) return;
    if (!picks.has(id)) {
      const row = e.target.closest('.wi-card');
      row.classList.add('is-on');
      row.setAttribute('aria-selected', 'true');
      row.querySelector('.wi-box').textContent = '[x]';
    }
    picks.set(id, e.target.value);
    refresh();
  });

  list.addEventListener('focusin', (e) => { if (e.target.matches('input[data-spec]')) e.target.select(); });
  el.querySelector('#wi-run').addEventListener('click', runPicks);
  refresh();
  // Start on the first picked card (or the first card) so the arrows work at once.
  showShelf(shelf, { focus: false });
  if (!window.matchMedia('(pointer: coarse)').matches) {
    setTimeout(() => { const r = rows.find((x) => x.tabIndex === 0); if (r?.isConnected) r.focus({ preventScroll: true }); }, 0);
  }
}

// ---- Certificate ----------------------------------------------------------------
// The server sends the words and numbers (d.cert, from data/whatif-cert.js); the same
// ones are drawn on the share image at /og/whatif.png.

const art = (file) => new URL(`../img/whatif/${file}`, import.meta.url).href;

export function shareLinks(m, origin) {
  const url = `${origin}/${q(m.command)}`;
  return {
    url,
    x: `https://x.com/intent/post?${new URLSearchParams({ text: m.share, url })}`,
    image: `/og/whatif.png?${new URLSearchParams({ c: m.command })}`,
  };
}

// Type sizes arrive as % of the certificate width; the CSP allows no inline styles, so
// they are set through the DOM after render (see sizeCert).
// actions: the quiet row under the buttons. video: the SAVE VIDEO button (videoHtml).
export function certHtml(m, links, actions = '', video = '') {
  const alt = `A certificate: ${m.ribbon}, worth ${m.big} today. ${m.spent}. ${m.holding}. ${m.multiple}.`;
  return `<figure class="wi-cert${m.loss ? ' is-loss' : ''}">
      <img class="wc-paper" src="${esc(art('certificate.webp'))}" width="1536" height="1024" alt="${esc(alt)}">
      <div class="wc wc-receipt" aria-hidden="true">${m.receipt.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
      <div class="wc wc-ribbon" data-fs="${esc(m.fit.ribbon)}" aria-hidden="true">${esc(m.ribbon)}</div>
      <div class="wc wc-big" data-fs="${esc(m.fit.big)}" aria-hidden="true">${esc(m.big)}</div>
      <div class="wc wc-today" aria-hidden="true">worth today</div>
      <div class="wc wc-l1" data-fs="${esc(m.fit.lines)}" aria-hidden="true">${esc(m.spent)}</div>
      <div class="wc wc-l2" data-fs="${esc(m.fit.lines)}" aria-hidden="true">${esc(m.holding)}</div>
      <div class="wc-seal" aria-hidden="true">
        <div class="wc wc-mult" data-fs="${esc(m.fit.mult)}">${esc(m.multiple)}</div>
        ${m.loss ? '<div class="wc wc-strike"></div><div class="wc wc-dodged">dodged</div>' : ''}
      </div>
      <img class="wc-sticker" src="${esc(art(`doodle-${m.doodle}.webp`))}" width="384" height="384" alt="">
    </figure>
    <div class="wi-share">
      <a class="wi-btn" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer">SHARE ON X</a>
      ${video}
      <a class="wi-btn" href="${esc(links.image)}" download="bloombroke-whatif.png">DOWNLOAD IMAGE</a>
      <button type="button" class="wi-btn" data-copy="${esc(links.url)}">COPY LINK</button>
    </div>
    ${video ? '<p class="wi-vmsg" data-vmsg role="status"></p>' : ''}
    ${actions}`;
}

function sizeCert(el) {
  for (const n of el.querySelectorAll('.wi-cert [data-fs]')) {
    const v = Number(n.dataset.fs);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (n.matches('.wc-l1, .wc-l2')) n.style.setProperty('--fs', String(v));
    else n.style.fontSize = `${v}cqw`;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---- Result ---------------------------------------------------------------------
// One hero: the number, the multiple beside it, one line of what it is. Everything else
// (small print, worst drop, sources, the maths) sits behind one + Details toggle.

const NICE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2015-01' -> 'Jan 2015'; '2015-01-02' -> '2 Jan 2015'.
export function niceMonth(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  return y && m ? `${NICE_MONTHS[m - 1]} ${y}` : '--';
}
export function niceDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y && m && d ? `${d} ${NICE_MONTHS[m - 1]} ${y}` : '--';
}
// "Apple Inc." -> "Apple": the company as people say it.
export const shortCompany = (c) => String(c || '').replace(/,?\s+(Inc\.?|Corp\.?|Corporation|Ltd\.?|plc)$/i, '').trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The one line under the big number: what was bought, when, and what was paid.
// mine: the parsed MY items of the command (whatif-mine.js), matched to rows by id.
// Catalogue items use the certificate's ribbon ("iPhone 6", "10 years of Big Macs",
// "3 iPhones"), made on the server from the catalogue's short names.
// { lead, paid }: paid is false where the lead already says the amount.
export function heroParts(d, mine = []) {
  const rows = d.rows || [];
  const ribbon = d.cert?.ribbon;
  const co = (r) => shortCompany(r.company) || r.ticker;
  if (rows.length === 1) {
    const r = rows[0];
    const item = mine.find((m) => m.id === r.id);
    if (item?.kind === 'once') return { lead: `${fmtAmount(item.amount)} in ${co(r)} on ${niceDay(r.bought)}.`, paid: false };
    if (item) {
      const when = item.to ? `from ${niceMonth(r.from)} to ${niceMonth(r.to)}` : `since ${niceMonth(r.from)}`;
      return { lead: `${fmtAmount(item.amount)} a ${item.per} in ${co(r)} ${when}.`, paid: true };
    }
    if (r.kind === 'once') return { lead: `${ribbon || r.name}, ${niceMonth(String(r.bought).slice(0, 7))}, as ${co(r)} stock.`, paid: true };
    return { lead: `${cap(ribbon || r.name)}, as ${co(r)} stock.`, paid: true };
  }
  const tickers = new Set(rows.map((r) => r.ticker));
  const where = tickers.size === 1 ? `${co(rows[0])} stock` : `stock in ${tickers.size} companies`;
  return { lead: `${cap(ribbon || `${rows.length} things`)}, as ${where}.`, paid: true };
}

export function heroLine(d, mine = []) {
  const { lead, paid } = heroParts(d, mine);
  return paid ? `${lead} You paid ${fmtUsd(d.total.paid)}.` : lead;
}

// Which quips fit: gadgets, other things bought once, habits. None for your own
// purchases or a mix of one-offs and habits.
export function quipKind(d, cat) {
  const rows = d.rows || [];
  if (!rows.length || rows.some((r) => r.mine)) return '';
  const byId = new Map(allItems(cat).map((p) => [p.id, p]));
  const items = rows.map((r) => byId.get(r.id));
  if (items.some((p) => !p)) return '';
  if (rows.every((r) => r.kind === 'monthly')) return 'habit';
  if (rows.every((r) => r.kind === 'once')) return items.every((p) => shelvesOf(p).includes('GADGETS')) ? 'gadget' : 'thing';
  return '';
}

function resultHtml(d, key, links, cat, mine) {
  const t = d.total;
  const dir = t.multiple >= 1 ? 'up' : 'down';
  const rows = d.rows.map((r) => {
    const loss = r.multiple < 1;
    const bought = r.kind === 'once'
      ? fmtDay(r.bought)
      : `${fmtMonth(r.from)} TO ${fmtMonth(r.to)}<span class="dim"> (${r.buys})</span>`;
    // The row opens the stock's chart from the day it was bought.
    const start = r.kind === 'once' ? r.bought : /^\d{4}-\d{2}$/.test(r.from || '') ? `${r.from}-01` : r.from;
    const cmd = /^\d{4}-\d{2}-\d{2}$/.test(start || '') ? `${r.ticker} FROM ${start}` : `${r.ticker} 5Y`;
    return `<tr class="row-link${loss ? ' is-loss' : ''}" data-cmd="${esc(cmd)}" tabindex="0">
      <th scope="row" class="name"><a href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" tabindex="-1">${esc(r.name)}</a>${r.mine ? '' : ` <a class="dim wi-tk" href="${esc(q(r.ticker))}" data-cmd="${esc(r.ticker)}" tabindex="-1">${esc(r.ticker)}</a>`}<span class="wi-when-m dim">${bought}</span></th>
      <td class="num wi-when">${bought}</td>
      <td class="num">${esc(fmtUsd(r.paid))}</td>
      <td class="num wi-sh">${esc(fmtShares(r.shares))}</td>
      <td class="num last ${loss ? 'down' : ''}">${esc(fmtUsd(r.value))}</td>
      <td class="num ${loss ? 'down' : 'up'}">${esc(fmtX(r.multiple))}</td>
    </tr>`;
  }).join('');
  const asOf = d.asOf ? (/^\d{4}-\d{2}-\d{2}$/.test(d.asOf) ? `the ${fmtDay(d.asOf)} close` : `${nyTime(d.asOf)} ET`) : 'now';
  const notes = d.rows.map((r) => `<li><span class="wi-note-name">${esc(r.name)}</span> ${esc(r.note || '')}${r.clamped ? ` ${esc(r.startNote || 'Starts when the shares began trading.')}` : ''} <a href="${esc(r.src)}" target="_blank" rel="noopener noreferrer">source</a></li>`).join('');
  const editCmd = `WHATIF EDIT ${key.replace(/^WHATIF\s*/, '')}`;
  // CHANGE PICKS and START OVER: a quiet second row under the share buttons.
  const actions = `<div class="wi-actions">
      <a class="code" href="${esc(q(editCmd))}" data-cmd="${esc(editCmd)}">CHANGE PICKS</a>
      <a class="code" href="${esc(q('WHATIF'))}" data-cmd="WHATIF">START OVER</a>
      ${d.cert && !d.mine ? `<button type="button" class="code wi-embed" data-embed="${esc(d.cert.command)}" title="Copy one line of HTML that shows this result on your site">EMBED</button>` : ''}
    </div>`;
  const hero = heroParts(d, mine);
  const kind = quipKind(d, cat);
  const quip = kind ? quipFor(t.multiple, key, kind) : '';
  const small = [
    HINDSIGHT_NOTE,
    riskLine(d),
    d.rows.length > 1 ? dropList(d.rows) : '',
    `Prices: close on purchase date, split-adjusted, price return only. Live price as of ${asOf}${d.stale ? ' (last known)' : ''}. Source: ${d.source}.`,
    d.rows.some((r) => r.kind === 'monthly') ? HABIT_LONG : '',
    d.replay?.cpi?.last ? jarLong(d.replay.cpi.last) : '',
    d.replay?.cpi?.gap || '', // a month BLS never published (Oct 2025), carried forward
  ].filter(Boolean);
  return `
    <div class="wi-layout${d.cert ? '' : ' no-cert'}">
    <div class="wi-head">
    <p class="hero num wi-hero"><span class="hero-value ${dir}">${esc(fmtUsd(t.value))}</span><span class="wi-x ${dir}">${esc(fmtX(t.multiple))}</span></p>
    <p class="wi-sentence">${esc(hero.lead)}${hero.paid ? ` You paid <span class="num wi-paid">${esc(fmtUsd(t.paid))}</span>.` : ''}</p>
    ${quip ? `<p class="wi-quip">${esc(quip)}</p>` : ''}
    </div>
    ${replayHtml(d)}
    ${d.cert ? `<div class="wi-certcol">${certHtml(d.cert, links, actions, videoHtml(d))}</div>` : ''}
    <div class="wi-body">
    <div class="wi-receipt">
      <table class="grid-table wi-table">
        <thead><tr><th scope="col">Item</th><th scope="col" class="num wi-when">Bought</th><th scope="col" class="num">Paid</th><th scope="col" class="num wi-sh">Shares</th><th scope="col" class="num">Worth now</th><th scope="col" class="num">x</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row" class="name">Total</th><td class="wi-when"></td><td class="num">${esc(fmtUsd(t.paid))}</td><td class="wi-sh"></td><td class="num last ${dir}">${esc(fmtUsd(t.value))}</td><td class="num ${dir}">${esc(fmtX(t.multiple))}</td></tr></tfoot>
      </table>
    </div>
    ${d.cert ? '' : actions}
    <details class="how wi-details">
      <summary>Details</summary>
      <ul class="how-list">${small.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="how-h">How it is calculated</p>
      <ul class="how-list">
        <li>Shares: the price you paid, divided by the stock's split-adjusted close on the day you bought it (or the last trading day before).</li>
        <li>Worth now: those shares times today's price.</li>
        <li>Habits: one buy a month, on the first trading day, of what that month cost you.</li>
        <li>Price return only. Dividends and spin-offs are left out, so long holds come out a little low.</li>
        <li>Worst drop: the biggest fall from a high to a later low, using the price on the day of the first buy, each month-end close after it and today's price. Falls within a month can be deeper.</li>
        <li>REPLAY: STOCK is the shares bought so far at each first-of-month close (and on each purchase day). CASH IN A JAR is the same dollars kept as cash, each deflated by CPI-U (BLS) from the month it was spent. SPENT is the running total paid.</li>
        <li>Hindsight: the list is picked after the fact. Nobody knew these results when the money was spent. Costs, taxes and currency moves are left out.</li>
      </ul>
      <p class="how-h">Notes and sources</p>
      <ul class="how-list">${notes}</ul>
    </details>
    </div>
    </div>`;
}

// ---- REPLAY ------------------------------------------------------------------------

// The title strip: the small print only, short, with its exact long form as the tooltip.
// The rest of what used to sit there is in + Details.
export const HINDSIGHT_STRIP = 'Hindsight. Past returns do not predict future ones. Not a recommendation.';
export const HABIT_LONG = 'Habits are bought once a month, on the first trading day. The month still running counts only the days so far.';
export const jarLong = (last) => `CASH IN A JAR: the same cash, deflated by CPI-U from the BLS, to ${fmtMonth(last)}. Later months use the latest value.`;
export function resultMeta() {
  return metaNote(HINDSIGHT_STRIP, HINDSIGHT_NOTE);
}
const money = (n) => (n > 0 ? `−${fmtUsd(n)}` : fmtUsd(0));

// SAVE VIDEO sits on the share row, second after SHARE ON X. Where the browser cannot
// make one, a plain line says why instead.
export function videoHtml(d, support = videoSupport()) {
  if (!d.cert || !d.replay?.points?.length) return '';
  return support
    ? '<button type="button" class="wi-btn" data-video>SAVE VIDEO</button>'
    : `<span class="wi-vneeds">${esc(VIDEO_NEEDS)}</span>`;
}

// The race: a date, the three lines' names and values in their colours, and a small
// REPLAY control, over the chart.
export function replayHtml(d) {
  const pts = d.replay?.points;
  if (!pts?.length) return '';
  const last = pts[pts.length - 1];
  const label = `Replay from ${fmtDay(pts[0].d)} to today: stock ${fmtUsd(last.stock)}, cash in a jar ${fmtUsd(last.jar)}, spent ${fmtUsd(last.spent)}.`;
  return `<section class="wi-replay" aria-label="Replay">
      <div class="wr-head">
        <span class="wr-date num" data-wr="date">${esc(fmtDay(last.d))}</span>
        <span class="wr-key wr-stock">STOCK <span class="num" data-wr="stock">${esc(fmtUsd(last.stock))}</span></span>
        <span class="wr-key wr-jar">CASH IN A JAR <span class="num" data-wr="jar">${esc(fmtUsd(last.jar))}</span></span>
        <span class="wr-key wr-spent">SPENT <span class="num" data-wr="spent">${esc(money(last.spent))}</span></span>
        <button type="button" class="wr-play" data-replay title="Replay (Space)">REPLAY</button>
      </div>
      <canvas class="wr-canvas" role="img" aria-label="${esc(label)}"></canvas>
    </section>`;
}

function setupReplay(el, d, ctx) {
  const box = el.querySelector('.wi-replay');
  if (!box) return;
  const pts = d.replay.points;
  const last = pts[pts.length - 1];
  const $ = (k) => box.querySelector(`[data-wr="${k}"]`);
  const hero = el.querySelector('.hero-value');
  const mult = el.querySelector('.wi-x');
  const paid = el.querySelector('.wi-paid');
  const cert = el.querySelector('.wi-cert');
  const certBig = cert?.querySelector('.wc-big');
  const certSpent = cert?.querySelector('.wc-l1');
  // Everything that rolls, with its final text and classes, put back exactly at the end.
  const rolling = [hero, mult, paid, certBig, certSpent].filter(Boolean);
  const finals = rolling.map((n) => [n, n.textContent, n.className]);
  const setDir = (n, dir) => { n.classList.toggle('up', dir === 'up'); n.classList.toggle('down', dir === 'down'); };
  const show = (f) => {
    $('date').textContent = f.done ? fmtDay(last.d) : fmtCounter(f.t);
    $('stock').textContent = fmtUsd(f.stock);
    $('jar').textContent = fmtUsd(f.jar);
    $('spent').textContent = money(f.spent);
    if (f.done) {
      for (const [n, text, cls] of finals) { n.textContent = text; n.className = cls; }
      return;
    }
    const dir = isBehind(f) ? 'down' : 'up';
    const x = f.spent > 0 ? f.stock / f.spent : NaN;
    if (hero) { hero.textContent = fmtUsd(f.stock); setDir(hero, dir); }
    if (mult) { mult.textContent = fmtX(x); setDir(mult, dir); }
    if (paid) paid.textContent = fmtUsd(f.spent);
    if (certBig) certBig.textContent = fmtUsd(f.stock);
    if (certSpent) certSpent.textContent = `You spent ${fmtUsd(f.spent)}`;
    cert?.classList.toggle('is-behind', dir === 'down');
  };
  const player = createReplay(box.querySelector('.wr-canvas'), pts, {
    onFrame: show,
    onDone: () => {
      if (!cert) return;
      cert.classList.remove('is-racing', 'is-behind', 'is-stamped');
      void cert.offsetWidth; // restart the stamp
      cert.classList.add('is-stamped');
    },
  });
  // The certificate shows from the start, its number rolling; the seal stamps at the end.
  const replay = () => { cert?.classList.remove('is-stamped'); cert?.classList.add('is-racing'); player.play(); };
  box.querySelector('[data-replay]').addEventListener('click', replay);

  // Space replays, while the command bar is empty (or nothing else has the focus).
  const onKey = (e) => {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || !box.isConnected) return;
    const t = e.target;
    const bar = t?.id === 'cmd';
    if (bar ? t.value !== '' : t?.closest?.('input, select, textarea, button, a, summary, [data-own-focus], [tabindex="0"]')) return;
    e.preventDefault();
    e.stopPropagation();
    replay();
  };
  document.addEventListener('keydown', onKey, true);
  ctx.onCleanup?.(() => { document.removeEventListener('keydown', onKey, true); player.destroy(); });

  const vbtn = el.querySelector('[data-video]');
  vbtn?.addEventListener('click', async () => {
    const msg = el.querySelector('[data-vmsg]');
    vbtn.disabled = true;
    msg.textContent = 'MAKING VIDEO';
    try {
      const { blob, filename } = await makeVideo({ m: d.cert, replay: d.replay, command: d.cert.command }, {
        signal: ctx.signal,
        onProgress: (p) => { msg.textContent = `MAKING VIDEO ${Math.round(p * 100)}%`; },
      });
      // Left the screen while it was being made: nothing is saved.
      if (ctx.signal?.aborted || !box.isConnected) return;
      downloadBlob(blob, filename);
      goal('whatif_video', undefined, { once: d.cert.command });
      msg.textContent = `SAVED ${filename}`;
      ctx.status('VIDEO SAVED');
    } catch (err) {
      if (err?.name === 'AbortError' || ctx.signal?.aborted) return;
      msg.textContent = err?.message === VIDEO_NEEDS ? VIDEO_NEEDS : 'THE VIDEO DID NOT WORK. TRY AGAIN.';
      ctx.status('VIDEO NOT SAVED', 'warn');
    } finally {
      vbtn.disabled = false;
    }
  });
  replay();
}

function errorView(el, message) {
  el.innerHTML = panel('1', 'WHATIF', `
    <p class="notice">${esc(message)}</p>
    <p class="muted">Type ${code('WHATIF')} to pick from the list, or try one of these.</p>
    <p class="muted examples">${EXAMPLES.map(code).join(' ')}</p>`, { cls: 'panel-solo' });
}

export function render(el, cmd, ctx) {
  const tokens = cmd.args?.tokens || [];
  el.innerHTML = panel('1', 'WHATIF', LOADING, { cls: 'panel-solo' });
  loadCatalog(ctx).then((cat) => {
    const plan = planWhatif(tokens, cat);
    if (plan.mode === 'error') { errorView(el, plan.message); ctx.status('WHATIF: CHECK THE WORDS', 'warn'); return null; }
    if (plan.mode === 'picker') { renderPicker(el, ctx, cat, plan.picks, plan.shelf, plan.mine); return null; }
    ctx.status('WHATIF: DOING THE MATHS');
    const key = cmd.input;
    return ctx.fetchJSON(`/api/whatif?${new URLSearchParams({ c: plan.words.join(' ') })}`, { signal: ctx.signal }).then((d) => {
      if (d.picker) { renderPicker(el, ctx, cat, plan.picks, plan.shelf, plan.mine); return; }
      const links = d.cert ? shareLinks(d.cert, location.origin) : null;
      el.innerHTML = panel('1', WHATIF_TITLE, resultHtml(d, key, links, cat, plan.mine), { cls: 'panel-solo wi-panel', meta: resultMeta(d) });
      sizeCert(el);
      setupReplay(el, d, ctx);
      el.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
        const ok = await copyText(e.currentTarget.dataset.copy);
        ctx.status(ok ? 'LINK COPIED' : 'COPY THE LINK FROM THE ADDRESS BAR', ok ? '' : 'warn');
        if (ok) goal('whatif_share', { via: 'link' }, { once: key });
      });
      // EMBED: copies the iframe line (public/embed-snippet.js), says so on the button.
      el.querySelector('[data-embed]')?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        const ok = await copyText(whatifEmbedSnippet(b.dataset.embed));
        if (ok) { b.textContent = 'COPIED'; setTimeout(() => { b.textContent = 'EMBED'; }, 2000); }
        ctx.status(ok ? 'EMBED CODE COPIED' : 'COULD NOT COPY', ok ? '' : 'warn');
        if (ok) goal('whatif_embed', { kind: 'whatif' }, { once: b.dataset.embed });
      });
      ctx.status(`WHATIF: ${fmtX(d.total.multiple)}${d.stale ? ' (LAST KNOWN PRICES)' : ''}`, d.stale ? 'warn' : '');
      goal('whatif_run', undefined, { once: key });
      el.querySelector('.wi-share')?.addEventListener('click', (e) => { const b = e.target.closest('a'); if (b) goal('whatif_share', { via: b.hasAttribute('download') ? 'image' : 'x' }, { once: key }); });
    });
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    errorView(el, err.message);
    ctx.status('WHATIF: CHECK THE LIST', 'warn');
  });
}
