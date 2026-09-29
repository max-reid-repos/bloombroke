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
import { toolbar, segmented, cardPage, cardButton, cardLink, raw, edgeFade } from '../kit.js';
import { createReplay, isBehind } from '../whatif-replay.js';
import { videoSupport, makeVideo, downloadBlob, VIDEO_NEEDS } from '../whatif-video.js';
import { parseMine, formWords, mineLabel, MINE_DOODLE, MINE_EXAMPLES } from '../whatif-mine.js';
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

// ---- Picker ---------------------------------------------------------------------
// A shelf of doodle cards per tab. Keys: arrows move, Space picks, Enter runs, [ and ]
// change the shelf. On a habit card, typing a number goes into its years box.
// A card shows its doodle and name; the year and price show once it is picked.

// A family with many models (19 iPhones) is one card. Picking it picks one model, `pick`
// (the one people share most), and shows a row of chips, one per model, to change it.
// The commands stay the same: WHATIF IPHONE6, WHATIF IPHONE (every iPhone picked).
export const FAMILY_CARDS = {
  IPHONE: { name: 'iPhone', pick: 'iphone6' },
  PLAYSTATION: { name: 'PlayStation', pick: 'ps4' },
  XBOX: { name: 'Xbox', pick: 'xboxone' },
  GEFORCE: { name: 'GeForce', pick: 'rtx3080' },
};

// A shelf's cards, in catalogue order: { item } or, where a family's first model is,
// { fam, name, doodle, items } (its models on this shelf, in catalogue order).
export function shelfCards(cat, shelf) {
  const out = [];
  const fams = new Map();
  const items = shelfItems(cat, shelf);
  for (const p of items) {
    const f = FAMILY_CARDS[p.family] && items.filter((x) => x.family === p.family).length > 1 ? p.family : '';
    if (!f) { out.push({ item: p }); continue; }
    if (!fams.has(f)) {
      const card = { fam: f, name: FAMILY_CARDS[f].name, doodle: p.doodle, items: [] };
      fams.set(f, card);
      out.push(card);
    }
    fams.get(f).items.push(p);
  }
  return out;
}
// The model a family card picks first.
export const familyPick = (fam) => (fam.items.some((p) => p.id === FAMILY_CARDS[fam.fam]?.pick) ? FAMILY_CARDS[fam.fam].pick : fam.items[0].id);
// Chip words: the model without the family's shared first word ("iPhone 6" -> "6") or a
// note in brackets ("iPhone 3G (on contract)" -> "3G"; the card and tooltip keep it).
export function chipLabels(items) {
  const names = items.map((p) => (p.short || p.name).replace(/\s*\([^)]*\)$/, ''));
  const first = `${names[0].split(' ')[0]} `;
  return names.every((n) => n.startsWith(first) && n.length > first.length) ? names.map((n) => n.slice(first.length)) : names;
}
// A chip picked: that model instead (add: false), or added or dropped (add: true). The
// last one picked stays (the family card drops the family). ids: the family's models in
// order; on: the picked ones. Returns the picked ones after, in the family's order.
export function chipPick(ids, on, id, { add = false } = {}) {
  const set = new Set(on);
  if (!add) return [id];
  if (!set.has(id)) set.add(id);
  else if (set.size > 1) set.delete(id);
  return ids.filter((x) => set.has(x));
}
// A key on a chip: what it does. i: the chip it is on, n: how many there are.
export function chipKey(key, { shift = false, i = 0, n = 1 } = {}) {
  const go = (j) => ({ go: Math.max(0, Math.min(n - 1, j)) });
  switch (key) {
    case 'ArrowRight': return go(i + 1);
    case 'ArrowLeft': return go(i - 1);
    case 'Home': return go(0);
    case 'End': return go(n - 1);
    case ' ': return { pick: true, add: shift };
    case 'Enter': return { run: true };
    case 'Escape': case 'ArrowUp': return { back: true };
    case '[': return { shelf: -1 };
    case ']': return { shelf: 1 };
    default: return null;
  }
}
// The year and price a picked card shows.
const pickedMeta = (p) => `${p.date.slice(0, 4)} ${fmtUsd(p.price)}`;

const EXAMPLES = ['WHATIF IPHONE6 IPHONE8 LATTE:3Y', 'WHATIF MODEL3 RTX3080', 'WHATIF BEER:10Y BETTING', MINE_EXAMPLES[0]];
const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;
export const PICKER_KEYS = 'SPACE PICK · ENTER RUN';
export const PICKER_KEYS_LONG = 'Arrows move. Space picks. Enter runs. [ and ] change the shelf. On a model chip, Shift+Space adds it.';
export const PICKER_INTRO = 'Pick what you bought. See what the stock would be worth now.';

const doodleImg = (doodle) => `<img class="wi-doodle" src="${esc(art(`doodle-${doodle || 'box'}.webp`))}" width="384" height="384" alt="" loading="lazy" decoding="async">`;
const boxHtml = (on) => `<span class="wi-box" aria-hidden="true">${on ? '[x]' : '[ ]'}</span>`;

export function cardHtml(p, picks) {
  const on = picks.has(p.id);
  // A habit keeps its years box (typing a number on the card goes into it).
  const meta = p.kind === 'monthly'
    ? `<span class="wi-cmeta"><label class="wi-years"><span class="offscreen">Years or dates for ${esc(p.name)}</span><input type="text" inputmode="text" maxlength="9" value="${esc(picks.get(p.id) || `${p.defaultYears}Y`)}" data-spec="${esc(p.id)}" spellcheck="false" autocomplete="off"></label></span>`
    : `<span class="wi-cmeta num" data-meta${on ? '' : ' hidden'}>${esc(pickedMeta(p))}</span>`;
  return `<li class="wi-card${on ? ' is-on' : ''}" role="option" aria-selected="${on}" tabindex="-1" data-id="${esc(p.id)}" title="${esc(`${p.name}, ${p.company} ${p.ticker}`)}">
    ${doodleImg(p.doodle)}${boxHtml(on)}<span class="wi-cname">${esc(p.name)}</span>${meta}
  </li>`;
}

// A family card: the family's name, or the model's once one is picked (with its year and
// price); "3 PICKED" for several.
export function familyCardParts(fam, picks) {
  const on = fam.items.filter((p) => picks.has(p.id));
  if (on.length === 1) return { on: true, name: on[0].name, meta: pickedMeta(on[0]) };
  return { on: on.length > 0, name: fam.name, meta: on.length ? `${on.length} PICKED` : '' };
}
export function familyCardHtml(fam, picks) {
  const { on, name, meta } = familyCardParts(fam, picks);
  const p0 = fam.items[0];
  return `<li class="wi-card wi-fam${on ? ' is-on' : ''}" role="option" aria-selected="${on}" tabindex="-1" data-fam="${esc(fam.fam)}" title="${esc(`${fam.name}: ${fam.items.length} models, ${p0.company} ${p0.ticker}`)}">
    ${doodleImg(fam.doodle)}${boxHtml(on)}<span class="wi-cname">${esc(name)}</span><span class="wi-cmeta num" data-meta${meta ? '' : ' hidden'}>${esc(meta)}</span>
  </li>`;
}

// The chips of a picked family, over the RUN bar: one per model, its year beside it.
// The one the roving focus starts on is the first picked.
export function chipsHtml(fam, picks) {
  const labels = chipLabels(fam.items);
  const start = Math.max(0, fam.items.findIndex((p) => picks.has(p.id)));
  return `<span class="tag wi-chips-label">${esc(fam.name)}</span><span class="wi-chips-row" role="group" aria-label="${esc(`${fam.name}: which model`)}" data-chips="${esc(fam.fam)}">${fam.items.map((p, i) => `<button type="button" class="chip wi-chip" data-chip="${esc(p.id)}" aria-pressed="${picks.has(p.id)}" tabindex="${i === start ? 0 : -1}" title="${esc(`${p.name}: ${pickedMeta(p)}`)}" aria-label="${esc(`${p.name}, ${p.date.slice(0, 4)}`)}">${esc(labels[i])} <span class="wi-chip-y num">${esc(p.date.slice(0, 4))}</span></button>`).join('')}</span>`;
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
      <div class="wi-chips" hidden></div>
      <div class="wi-bar-row">
        <span class="wi-count" id="wi-count"></span>
        <span class="wi-cmd code" id="wi-cmd"></span>
        <button type="button" class="wi-run" id="wi-run">RUN</button>
      </div>
    </div>`, { cls: 'panel-solo wi-panel', meta: `<span class="wi-hint">${metaNote(PICKER_KEYS, PICKER_KEYS_LONG)}</span>` });

  const list = el.querySelector('.wi-shelf');
  const tabBox = el.querySelector('.wi-tabs');
  const countEl = el.querySelector('#wi-count');
  const cmdEl = el.querySelector('#wi-cmd');
  const byId = new Map(allItems(cat).map((p) => [p.id, p]));
  const tray = el.querySelector('.wi-chips');
  let rows = [];
  let fams = new Map(); // this shelf's family cards, by family
  let famOpen = null; // the family whose chips show
  let stopFade = () => {};
  ctx.onCleanup?.(() => stopFade());

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

  // ---- Family cards and their chips.
  const famPicked = (fam) => fam.items.some((p) => picks.has(p.id));
  function drawFam(fam) {
    const row = list.querySelector(`[data-fam="${fam.fam}"]`);
    if (!row) return;
    const { on, name, meta } = familyCardParts(fam, picks);
    row.classList.toggle('is-on', on);
    row.setAttribute('aria-selected', String(on));
    row.querySelector('.wi-box').textContent = on ? '[x]' : '[ ]';
    row.querySelector('.wi-cname').textContent = name;
    const m = row.querySelector('[data-meta]');
    m.textContent = meta;
    m.hidden = !meta;
  }
  // The chips show for the family last picked or moved to, while any of it is picked.
  function drawChips(focusId = '') {
    const fam = famOpen && fams.get(famOpen);
    if (!fam || !famPicked(fam)) { famOpen = null; stopFade(); tray.hidden = true; tray.innerHTML = ''; return; }
    tray.innerHTML = chipsHtml(fam, picks);
    tray.hidden = false;
    stopFade();
    stopFade = edgeFade(tray.querySelector('.wi-chips-row'));
    const chip = focusId && tray.querySelector(`[data-chip="${focusId}"]`);
    if (chip) {
      tray.querySelectorAll('.wi-chip').forEach((c) => { c.tabIndex = c === chip ? 0 : -1; });
      chip.focus({ preventScroll: true });
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else tray.querySelector('.wi-chip[tabindex="0"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function toggleFam(row, { keys = false } = {}) {
    const fam = fams.get(row.dataset.fam);
    if (famPicked(fam)) {
      fam.items.forEach((p) => picks.delete(p.id));
      if (famOpen === fam.fam) famOpen = null;
      drawFam(fam); drawChips(); refresh();
      return;
    }
    const id = familyPick(fam);
    picks.set(id, '');
    famOpen = fam.fam;
    drawFam(fam);
    drawChips(keys ? id : '');
    refresh();
  }
  // A chip: pick this model instead (a click, Space); with Shift (or Ctrl or Cmd on a
  // click), add or drop it, so several models can be picked. The last one stays: the
  // family card drops the family.
  function chooseChip(id, { add = false } = {}) {
    const fam = fams.get(famOpen);
    if (!fam) return;
    const ids = fam.items.map((p) => p.id);
    const after = chipPick(ids, ids.filter((x) => picks.has(x)), id, { add });
    ids.forEach((x) => { if (!after.includes(x)) picks.delete(x); else if (!picks.has(x)) picks.set(x, ''); });
    drawFam(fam);
    drawChips(id);
    refresh();
  }

  function showShelf(name, { focus = true } = {}) {
    // Years typed on this shelf are kept before its cards are redrawn.
    for (const inp of list.querySelectorAll('input[data-spec]')) if (picks.has(inp.dataset.spec)) picks.set(inp.dataset.spec, inp.value);
    shelf = name;
    tabBox.innerHTML = toolbar({ left: tabs(), label: 'Shelves' });
    const cards = shelfCards(cat, shelf);
    fams = new Map(cards.filter((c) => c.fam).map((c) => [c.fam, c]));
    list.innerHTML = ownCardHtml() + mine.map(mineCardHtml).join('') + cards.map((c) => (c.fam ? familyCardHtml(c, picks) : cardHtml(c.item, picks))).join('');
    list.setAttribute('aria-label', `${shelf}: things you bought`);
    rows = [...list.querySelectorAll('.wi-card')];
    if (!fams.has(famOpen)) famOpen = [...fams.values()].find(famPicked)?.fam || null;
    drawChips();
    const first = Math.max(0, rows.findIndex((r) => picks.has(r.dataset.id) || r.dataset.mine || (r.dataset.fam && famPicked(fams.get(r.dataset.fam)))));
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

  function toggle(row, opts) {
    if (row.dataset.own !== undefined) { openForm(); return; }
    if (row.dataset.fam) { toggleFam(row, opts); return; }
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
    const meta = row.querySelector('[data-meta]');
    if (meta) meta.hidden = !on;
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
      ' ': () => toggle(row, { keys: true }),
      Enter: () => runPicks(),
    };
    if (keys[e.key]) { stop(); keys[e.key](); }
  });

  // Moving to a picked family card shows its chips.
  list.addEventListener('focusin', (e) => {
    const row = e.target.closest('[data-fam]');
    if (row && row.dataset.fam !== famOpen && famPicked(fams.get(row.dataset.fam))) { famOpen = row.dataset.fam; drawChips(); }
  });

  // The chips: arrows move, Space picks this model (Shift+Space adds it), Enter runs,
  // Esc or Up goes back to the card.
  tray.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) chooseChip(chip.dataset.chip, { add: e.shiftKey || e.ctrlKey || e.metaKey });
  });
  tray.addEventListener('keydown', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (!chip || e.ctrlKey || e.metaKey || e.altKey) return;
    const chips = [...tray.querySelectorAll('[data-chip]')];
    const i = chips.indexOf(chip);
    const go = (j) => {
      const c = chips[Math.max(0, Math.min(chips.length - 1, j))];
      chips.forEach((x) => { x.tabIndex = x === c ? 0 : -1; });
      c.focus({ preventScroll: true });
      c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const act = chipKey(e.key, { shift: e.shiftKey, i, n: chips.length });
    if (!act) return;
    e.preventDefault(); e.stopPropagation();
    if ('go' in act) go(act.go);
    else if (act.pick) chooseChip(chip.dataset.chip, { add: act.add });
    else if (act.run) runPicks();
    else if (act.back) { const r = list.querySelector(`[data-fam="${famOpen}"]`); if (r) focusRow(rows.indexOf(r)); }
    else if (act.shelf) moveShelf(act.shelf);
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

// The certificate: a picture (role="img"), its words drawn on the paper. Type sizes
// arrive as % of the certificate width; the CSP allows no inline styles, so they are set
// through the DOM after render (see sizeCert).
export function certHtml(m) {
  const alt = `A certificate: ${m.ribbon}, worth ${m.big} today. ${m.spent}. ${m.holding}. ${m.multiple}.`;
  return `<figure class="wi-cert${m.loss ? ' is-loss' : ''}" role="img" aria-label="${esc(alt)}">
      <img class="wc-paper" src="${esc(art('certificate.webp'))}" width="1536" height="1024" alt="">
      <div class="wc wc-receipt">${m.receipt.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
      <div class="wc wc-ribbon" data-fs="${esc(m.fit.ribbon)}">${esc(m.ribbon)}</div>
      <div class="wc wc-big" data-fs="${esc(m.fit.big)}">${esc(m.big)}</div>
      <div class="wc wc-today">worth today</div>
      <div class="wc wc-l1" data-fs="${esc(m.fit.lines)}">${esc(m.spent)}</div>
      <div class="wc wc-l2" data-fs="${esc(m.fit.lines)}">${esc(m.holding)}</div>
      <div class="wc-seal">
        <div class="wc wc-mult" data-fs="${esc(m.fit.mult)}">${esc(m.multiple)}</div>
        ${m.loss ? '<div class="wc wc-strike"></div><div class="wc wc-dodged">dodged</div>' : ''}
      </div>
      <img class="wc-sticker" src="${esc(art(`doodle-${m.doodle}.webp`))}" width="384" height="384" alt="">
    </figure>`;
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

// ---- SHARE --------------------------------------------------------------------------
// One primary button, SHARE, and a small menu under it: Post on X, Save video, Download
// image, Copy link and Embed (not for your own purchases). Each item keeps the attribute
// the share count listens for (ga4.js SHARES): the x.com link, a[download], data-video,
// data-copy and data-embed.

// Save video: a menu item where the browser can make one; else the plain line why.
export function videoHtml(d, support = videoSupport()) {
  if (!d.cert || !d.replay?.points?.length) return '';
  return support
    ? '<button type="button" class="wi-mi" role="menuitem" data-video>Save video</button>'
    : `<span class="wi-mi is-off" role="menuitem" aria-disabled="true">${esc(VIDEO_NEEDS)}</span>`;
}

export function shareHtml(d, links, video = '') {
  const items = [
    `<a class="wi-mi" role="menuitem" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer">Post on X</a>`,
    video,
    `<a class="wi-mi" role="menuitem" href="${esc(links.image)}" download="bloombroke-whatif.png">Download image</a>`,
    `<button type="button" class="wi-mi" role="menuitem" data-copy="${esc(links.url)}">Copy link</button>`,
    d.cert && !d.mine ? `<button type="button" class="wi-mi" role="menuitem" data-embed="${esc(d.cert.command)}" title="Copy one line of HTML that shows this result on your site">Embed</button>` : '',
  ].filter(Boolean);
  return `<div class="wi-sharebox">${cardButton({ label: 'SHARE', primary: true, id: 'wi-share-btn', attrs: 'aria-haspopup="menu" aria-expanded="false" aria-controls="wi-menu"' })}`
    + `<div class="wi-menu" id="wi-menu" role="menu" aria-label="Share" hidden>${items.join('')}</div></div>`
    + (video ? '<span class="wi-vmsg" data-vmsg role="status"></span>' : '');
}

// Opens and closes the menu: a click or Down opens it, Esc closes it (the focus back on
// SHARE), a click outside, Tab or a choice closes it. Up, Down, Home and End move in it.
// While it is open, Esc is caught first on the document (capture), wherever the focus is
// (Safari leaves it on the page after a click), so it never reaches the app's own Esc.
// doc: the document (a test passes a small fake).
export function setupShare(el, ctx, key, { doc = globalThis.document } = {}) {
  const btn = el.querySelector('#wi-share-btn');
  const menu = el.querySelector('#wi-menu');
  if (!btn || !menu) return;
  const items = () => [...menu.querySelectorAll('.wi-mi:not(.is-off)')];
  const onEsc = (e) => {
    if (e.key !== 'Escape' || menu.hidden) return;
    e.preventDefault(); e.stopPropagation();
    close(true);
  };
  const open = (focus) => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    doc.addEventListener('keydown', onEsc, true);
    if (focus) items()[0]?.focus();
  };
  function close(refocus) {
    doc.removeEventListener('keydown', onEsc, true);
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  }
  btn.addEventListener('click', (e) => { if (menu.hidden) open(e.detail === 0); else close(false); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); open(true); }
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(doc.activeElement);
    const to = { ArrowDown: (i + 1) % list.length, ArrowUp: (i - 1 + list.length) % list.length, Home: 0, End: list.length - 1 }[e.key];
    if (to !== undefined) { e.preventDefault(); e.stopPropagation(); list[to]?.focus(); }
    else if (e.key === 'Tab') close(false);
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('a');
    if (b) goal('whatif_share', { via: b.hasAttribute('download') ? 'image' : 'x' }, { once: key });
    if (e.target.closest('.wi-mi:not(.is-off)')) setTimeout(() => close(false), 0);
  });
  const outside = (e) => { if (!menu.hidden && !e.target.closest?.('.wi-sharebox')) close(false); };
  doc.addEventListener('click', outside, true);
  ctx.onCleanup?.(() => { doc.removeEventListener('click', outside, true); doc.removeEventListener('keydown', onEsc, true); });
}

// ---- Result ---------------------------------------------------------------------
// A card page (kit.js cardPage, split): the certificate is the hero (it is the share
// image and carries the amount); beside it (under it on a phone) one sentence with the
// real values, SHARE, a short note, the race chart and REPLAY / CHANGE PICKS. Two or more
// things: the list of them under the chart. Everything else (the small print, the worst
// drop, the table, how it is worked out, sources) is behind + Details.
// While the race runs only the certificate and the chart move; the sentence and the list
// show when it ends, so one amount is on screen at a time.

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

// The short note under SHARE, always in view (legal: the past-returns caution stays up
// front); the full small print (HINDSIGHT_NOTE) is first in + Details.
export const RESULT_NOTE = 'Hindsight. Past returns do not predict future ones.';

// The one sentence under the certificate: what was paid, when, and what it is worth now
// as the maker's stock. What was bought is on the certificate, so it is not said again.
// mine: the parsed MY items of the command (whatif-mine.js), matched to rows by id.
//   "You paid $649.00 in Sep 2014. As Apple stock it is worth $8,701 today."
//   "You paid $2,011 since Oct 2016. As McDonald's stock it is worth $3,418 today."
//   "You paid $1,947 in all. As stock in 2 companies they are worth $9,120 today."
export function resultSentence(d, mine = []) {
  const rows = d.rows || [];
  const t = d.total;
  const worth = fmtUsd(t.value);
  // A company of three words or more goes by its ticker, so the line stays one line.
  const co = (r) => { const c = shortCompany(r.company); return c && c.split(/\s+/).length <= 2 ? c : r.ticker; };
  if (rows.length !== 1) {
    const tickers = new Set(rows.map((r) => r.ticker));
    const where = tickers.size === 1 ? `${co(rows[0])} stock` : `stock in ${tickers.size} companies`;
    return `You paid ${fmtUsd(t.paid)} in all. As ${where} they are worth ${worth} today.`;
  }
  const r = rows[0];
  const item = mine.find((m) => m.id === r.id);
  const now = String(d.asOf || '').slice(0, 7);
  let when;
  if (r.kind === 'once') when = item ? `on ${niceDay(r.bought)}` : `in ${niceMonth(String(r.bought).slice(0, 7))}`;
  else if (item ? item.to : r.to && now && r.to < now) when = `${niceMonth(r.from)} to ${niceMonth(r.to)}`;
  else when = `since ${niceMonth(r.from)}`;
  return `You paid ${fmtUsd(t.paid)}${/^since|^on|^in/.test(when) ? ' ' : ', '}${when}. As ${co(r)} stock it is worth ${worth} today.`;
}

// The things bought, one row each: what, when, paid, shares, worth now, x. In + Details
// for one thing; under the chart for two or more (its sums are the sentence).
export function tableHtml(d) {
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
  return `<div class="wi-receipt">
      <table class="grid-table wi-table">
        <thead><tr><th scope="col">Item</th><th scope="col" class="num wi-when">Bought</th><th scope="col" class="num">Paid</th><th scope="col" class="num wi-sh">Shares</th><th scope="col" class="num">Worth now</th><th scope="col" class="num">x</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// + Details: the table (one thing), the small print (its exact words), how it is worked
// out, the notes and sources, and START OVER.
function detailsHtml(d, { table = false } = {}) {
  const asOf = d.asOf ? (/^\d{4}-\d{2}-\d{2}$/.test(d.asOf) ? `the ${fmtDay(d.asOf)} close` : `${nyTime(d.asOf)} ET`) : 'now';
  const notes = d.rows.map((r) => `<li><span class="wi-note-name">${esc(r.name)}</span> ${esc(r.note || '')}${r.clamped ? ` ${esc(r.startNote || 'Starts when the shares began trading.')}` : ''} <a href="${esc(r.src)}" target="_blank" rel="noopener noreferrer">source</a></li>`).join('');
  const small = [
    HINDSIGHT_NOTE,
    riskLine(d),
    d.rows.length > 1 ? dropList(d.rows) : '',
    `Prices: close on purchase date, split-adjusted, price return only. Live price as of ${asOf}${d.stale ? ' (last known)' : ''}. Source: ${d.source}.`,
    d.rows.some((r) => r.kind === 'monthly') ? HABIT_LONG : '',
    d.replay?.cpi?.last ? jarLong(d.replay.cpi.last) : '',
    d.replay?.cpi?.gap || '', // a month BLS never published (Oct 2025), carried forward
  ].filter(Boolean);
  return `${table ? tableHtml(d) : ''}
      <ul class="how-list">${small.map((l) => `<li${/^Worst drop/.test(l) ? ' class="wi-drop"' : ''}>${esc(l)}</li>`).join('')}</ul>
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
      <p class="wi-over"><a class="code" href="${esc(q('WHATIF'))}" data-cmd="WHATIF">START OVER</a></p>`;
}

// The result page. key: the command as typed; links: shareLinks(d.cert); video: videoHtml(d).
export function resultHtml(d, { key, links = null, mine = [], video = '' } = {}) {
  const multi = d.rows.length > 1;
  const editCmd = `WHATIF EDIT ${String(key || '').replace(/^WHATIF\s*/, '')}`;
  const chart = replayHtml(d);
  return cardPage({
    split: Boolean(d.cert), cls: 'wi-result', label: 'WHATIF result',
    art: d.cert ? raw(certHtml(d.cert)) : '',
    // Each sentence on a line of its own (a phone wraps them as it must).
    sub: raw(resultSentence(d, mine).split(/(?<=\.) (?=[A-Z])/).map((l) => `<span class="wi-line">${esc(l)}</span>`).join(' ')),
    act: d.cert && links ? raw(shareHtml(d, links, video)) : '',
    note: RESULT_NOTE,
    chart: chart ? raw(chart) : '',
    media: multi ? raw(tableHtml(d)) : '',
    links: [
      chart ? cardLink({ label: 'REPLAY', attrs: 'data-replay title="Replay (Space)"' }) : '',
      cardLink({ label: 'CHANGE PICKS', cmd: editCmd }),
    ],
    details: raw(detailsHtml(d, { table: !multi })),
  });
}

// ---- REPLAY ------------------------------------------------------------------------

export const HABIT_LONG = 'Habits are bought once a month, on the first trading day. The month still running counts only the days so far.';
export const jarLong = (last) => `CASH IN A JAR: the same cash, deflated by CPI-U from the BLS, to ${fmtMonth(last)}. Later months use the latest value.`;

// The race: three thin lines, each named at its end on the chart (whatif-replay.js).
// The values are in the chart's label, for a screen reader.
export function replayHtml(d) {
  const pts = d.replay?.points;
  if (!pts?.length) return '';
  const last = pts[pts.length - 1];
  const label = `Replay from ${fmtDay(pts[0].d)} to today: stock ${fmtUsd(last.stock)}, cash in a jar ${fmtUsd(last.jar)}, spent ${fmtUsd(last.spent)}.`;
  return `<div class="wi-replay"><canvas class="wr-canvas" role="img" aria-label="${esc(label)}"></canvas></div>`;
}

// onEnd: when the race ends (at once with reduced motion, or with no race at all).
function setupReplay(el, d, ctx, { onEnd = () => {} } = {}) {
  const box = el.querySelector('.wi-replay');
  if (!box) { onEnd(); return; }
  const pts = d.replay.points;
  const card = el.querySelector('.wi-result');
  const cert = el.querySelector('.wi-cert');
  const certBig = cert?.querySelector('.wc-big');
  const certSpent = cert?.querySelector('.wc-l1');
  // Everything that rolls, with its final text and classes, put back exactly at the end.
  const rolling = [certBig, certSpent].filter(Boolean);
  const finals = rolling.map((n) => [n, n.textContent, n.className]);
  const show = (f) => {
    if (f.done) {
      for (const [n, text, cls] of finals) { n.textContent = text; n.className = cls; }
      return;
    }
    if (certBig) certBig.textContent = fmtUsd(f.stock);
    if (certSpent) certSpent.textContent = `You spent ${fmtUsd(f.spent)}`;
    cert?.classList.toggle('is-behind', isBehind(f));
  };
  const player = createReplay(box.querySelector('.wr-canvas'), pts, {
    onFrame: show,
    onDone: () => {
      card?.classList.remove('is-racing');
      onEnd();
      if (!cert) return;
      cert.classList.remove('is-racing', 'is-behind', 'is-stamped');
      void cert.offsetWidth; // restart the stamp
      cert.classList.add('is-stamped');
    },
  });
  // The certificate shows from the start, its number rolling; the seal stamps at the end.
  // The sentence and the list wait for the end (one amount on screen at a time).
  const replay = () => {
    card?.classList.add('is-racing');
    cert?.classList.remove('is-stamped');
    cert?.classList.add('is-racing');
    player.play();
  };
  el.querySelectorAll('[data-replay]').forEach((b) => b.addEventListener('click', replay));

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
      el.innerHTML = panel('1', WHATIF_TITLE, resultHtml(d, { key, links, mine: plan.mine, video: videoHtml(d) }), { cls: 'panel-solo wi-panel' });
      sizeCert(el);
      setupShare(el, ctx, key);
      // The status line says the multiple when the race ends, not before (one amount at a time).
      ctx.status('');
      setupReplay(el, d, ctx, { onEnd: () => ctx.status(`WHATIF: ${fmtX(d.total.multiple)}${d.stale ? ' (LAST KNOWN PRICES)' : ''}`, d.stale ? 'warn' : '') });
      el.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
        const ok = await copyText(e.currentTarget.dataset.copy);
        ctx.status(ok ? 'LINK COPIED' : 'COPY THE LINK FROM THE ADDRESS BAR', ok ? '' : 'warn');
        if (ok) goal('whatif_share', { via: 'link' }, { once: key });
      });
      // EMBED: copies the iframe line (public/embed-snippet.js); the status line says so.
      el.querySelector('[data-embed]')?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        const ok = await copyText(whatifEmbedSnippet(b.dataset.embed));
        ctx.status(ok ? 'EMBED CODE COPIED' : 'COULD NOT COPY', ok ? '' : 'warn');
        if (ok) goal('whatif_embed', { kind: 'whatif' }, { once: b.dataset.embed });
      });
      goal('whatif_run', undefined, { once: key });
    });
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    errorView(el, err.message);
    ctx.status('WHATIF: CHECK THE LIST', 'warn');
  });
}
