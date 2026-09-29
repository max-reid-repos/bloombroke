// WHATIF: in hindsight, the maker's stock instead of the thing. A picker of things people bought, and a
// receipt of what that money would be worth today in the maker's stock.
//
// WHATIF                      the picker: a shelf of doodle cards in tabs
// WHATIF VICES                the picker, on the VICES shelf (GADGETS, GAMES, HABITS too)
// WHATIF IPHONE               the picker, with every iPhone in the basket
// WHATIF EDIT IPHONE6 LATTE   the picker, with these in the basket
// WHATIF IPHONE6 LATTE:3Y     the result, with the REPLAY race and SAVE VIDEO
// WHATIF MY 1200 AAPL 2015    your own purchase (free for everyone)

import { esc, q, fmtNum, panel, metaNote, LOADING, nyTime } from './markets.js';
import { toolbar, segmented, cardPage, cardButton, cardLink, raw, edgeFade } from '../kit.js';
import { createReplay, isBehind } from '../whatif-replay.js';
import { videoSupport, makeVideo, downloadBlob, VIDEO_NEEDS } from '../whatif-video.js';
import { parseMine, formWords, mineLabel, mineShort, MineError, MINE_DOODLE, MINE_EXAMPLES } from '../whatif-mine.js';
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
// The shelf is the screen: big doodle cards, four to a row (two on a phone), a pencil
// line under each row, in tabs (GADGETS CARS GAMES HABITS VICES).
//   A click or Enter on a card runs it at once.
//   A family card (iPhone, PlayStation, Xbox, GeForce) opens its model chips under its
//   row; a click or Enter on a chip runs that model.
//   Space (or a click on the small box) adds a card or chip to the basket. RUN, the
//   page's one white button, shows once the basket holds two or more: "RUN 3".
//   YOUR OWN is one line above the shelf: AAPL 2019-01-01 5000, Enter runs it.
// Keys: arrows move (Down from a family card's row goes into its chips), Esc closes the
// chips, [ and ] change the shelf. On a habit card, typing a number goes into its years box.

// A family with many models (19 iPhones) is one card; its chips pick the model. The
// commands stay the same: WHATIF IPHONE6, WHATIF IPHONE (every iPhone in the basket).
// pick: the model Space adds from the card (the one people share most).
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
// The model Space on a family card adds.
export const familyPick = (fam) => (fam.items.some((p) => p.id === FAMILY_CARDS[fam.fam]?.pick) ? FAMILY_CARDS[fam.fam].pick : fam.items[0].id);
// Chip words: the model without the family's shared first word ("iPhone 6" -> "6") or a
// note in brackets ("iPhone 3G (on contract)" -> "3G"; the tooltip keeps it).
export function chipLabels(items) {
  const names = items.map((p) => (p.short || p.name).replace(/\s*\([^)]*\)$/, ''));
  const first = `${names[0].split(' ')[0]} `;
  return names.every((n) => n.startsWith(first) && n.length > first.length) ? names.map((n) => n.slice(first.length)) : names;
}
// A key on a chip: what it does. i: the chip it is on, n: how many there are.
export function chipKey(key, { i = 0, n = 1 } = {}) {
  const go = (j) => ({ go: Math.max(0, Math.min(n - 1, j)) });
  switch (key) {
    case 'ArrowRight': return go(i + 1);
    case 'ArrowLeft': return go(i - 1);
    case 'Home': return go(0);
    case 'End': return go(n - 1);
    case ' ': return { add: true };
    case 'Enter': return { run: true };
    case 'Escape': return { close: true };
    case 'ArrowUp': return { back: true };
    case 'ArrowDown': return { down: true };
    case '[': return { shelf: -1 };
    case ']': return { shelf: 1 };
    default: return null;
  }
}
// The year and price a card's tooltip shows.
const pickedMeta = (p) => `${p.date.slice(0, 4)} ${fmtUsd(p.price)}`;

const EXAMPLES = ['WHATIF IPHONE6 IPHONE8 LATTE:3Y', 'WHATIF MODEL3 RTX3080', 'WHATIF BEER:10Y BETTING', MINE_EXAMPLES[0]];
const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;
export const PICKER_KEYS = 'ENTER RUN · SPACE ADD';
export const PICKER_KEYS_LONG = 'Arrows move. Enter runs a card, or opens a family\'s models. Space adds it to the basket; RUN runs the basket. [ and ] change the shelf.';
export const OWN_PLACEHOLDER = 'Your own: AAPL 2019-01-01 5000';
const OWN_HOW = 'Type a ticker, a date and dollars, like AAPL 2019-01-01 5000.';
// Cards to a row: four, two on a phone (the same width as whatif.css's phone rule).
export const PHONE_MQ = '(max-width: 639px)';
export const shelfCols = (phone) => (phone ? 2 : 4);

const doodleImg = (doodle) => `<img class="wi-doodle" src="${esc(art(`doodle-${doodle || 'box'}.webp`))}" width="384" height="384" alt="" loading="lazy" decoding="async">`;
// The small box in a card's corner: empty, or checked once the card is in the basket.
// A click on it adds or drops the card (Space does the same).
const BOX = '<span class="wi-box" data-box aria-hidden="true" title="Add to the basket (Space)"></span>';

// The pencil line a row of cards stands on: one slightly uneven stroke and a fainter
// second pass, in the doodles' pencil colour (whatif.css --wi-pencil). No image file.
export const SHELF_LINE = '<svg class="wi-line" viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
  + '<path d="M2 6.4 C 44 5.2, 92 7.1, 140 6 S 226 4.9, 270 6.3 S 352 7.4, 398 5.6" vector-effect="non-scaling-stroke"/>'
  + '<path class="wi-line-2" d="M9 8.1 C 88 8.8, 150 7.2, 224 8 S 332 8.9, 391 7.7" vector-effect="non-scaling-stroke"/></svg>';

export function cardHtml(p, picks) {
  const on = picks.has(p.id);
  // A habit keeps its years box (typing a number on the card goes into it).
  const years = p.kind === 'monthly'
    ? `<label class="wi-years"><span class="offscreen">Years or dates for ${esc(p.name)}</span><input type="text" inputmode="text" maxlength="9" value="${esc(picks.get(p.id) || `${p.defaultYears}Y`)}" data-spec="${esc(p.id)}" spellcheck="false" autocomplete="off"></label>`
    : '';
  const tip = p.kind === 'monthly' ? `${p.name}, ${p.company} ${p.ticker}` : `${p.name}: ${pickedMeta(p)}, ${p.company} ${p.ticker}`;
  return `<li class="wi-card${on ? ' is-on' : ''}" role="option" aria-selected="${on}" tabindex="-1" data-id="${esc(p.id)}" title="${esc(tip)}">${doodleImg(p.doodle)}${BOX}<span class="wi-cname">${esc(p.name)}</span>${years}</li>`;
}

// A family card: the family's name and how many models, or the model's name once one is
// in the basket ("iPhone 6"); "iPhone, 2 models" for several.
export function familyCardParts(fam, picks) {
  const on = fam.items.filter((p) => picks.has(p.id));
  if (on.length === 1) return { on: true, name: on[0].name };
  return { on: on.length > 0, name: on.length ? `${fam.name}, ${on.length} models` : fam.name };
}
export function familyCardHtml(fam, picks, open = false) {
  const { on, name } = familyCardParts(fam, picks);
  const p0 = fam.items[0];
  return `<li class="wi-card wi-fam${on ? ' is-on' : ''}" role="option" aria-selected="${on}" aria-expanded="${open}" tabindex="-1" data-fam="${esc(fam.fam)}" title="${esc(`${fam.name}: ${fam.items.length} models, ${p0.company} ${p0.ticker}`)}">${doodleImg(fam.doodle)}${BOX}<span class="wi-cname">${esc(name)}</span><span class="wi-cmeta">${fam.items.length} models</span></li>`;
}

// A family's chips, under its row: one per model, its year beside it. A click or Enter
// runs the model; Space or the box adds it to the basket. The roving focus starts on
// the first one in the basket (or the first).
export function chipsHtml(fam, picks) {
  const labels = chipLabels(fam.items);
  const start = Math.max(0, fam.items.findIndex((p) => picks.has(p.id)));
  return `<span class="tag wi-chips-label">${esc(fam.name)}</span><span class="wi-chips-row" role="group" aria-label="${esc(`${fam.name}: which model`)}" data-chips="${esc(fam.fam)}">${fam.items.map((p, i) => `<button type="button" class="chip wi-chip${picks.has(p.id) ? ' is-on' : ''}" role="option" data-chip="${esc(p.id)}" aria-selected="${picks.has(p.id)}" tabindex="${i === start ? 0 : -1}" title="${esc(`${p.name}: ${pickedMeta(p)}`)}" aria-label="${esc(`${p.name}, ${p.date.slice(0, 4)}`)}">${BOX}${esc(labels[i])} <span class="wi-chip-y num">${esc(p.date.slice(0, 4))}</span></button>`).join('')}</span>`;
}

// A purchase of your own (from the line above the shelf, or from WHATIF EDIT MY ...):
// a card on every shelf, first. A click runs it; Space adds it to the basket or drops it.
export function mineCardHtml(m, on = true) {
  return `<li class="wi-card wi-mine${on ? ' is-on' : ''}" role="option" aria-selected="${on}" tabindex="-1" data-mine="${esc(m.id)}" title="${esc(mineLabel(m))}">
    ${doodleImg(MINE_DOODLE)}${BOX}<span class="wi-cname">${esc(mineLabel(m))}</span><span class="wi-cmeta">YOUR OWN</span>
  </li>`;
}

// YOUR OWN: one line above the shelf. Enter runs it.
export function ownInputHtml() {
  return `<form class="wi-own" data-own novalidate>`
    + '<label class="offscreen" for="wi-own-in">Your own purchase: a ticker, a date and dollars</label>'
    + `<input id="wi-own-in" class="wi-own-in" type="text" maxlength="80" placeholder="${esc(OWN_PLACEHOLDER)}" title="${esc(`${OWN_HOW} Or a habit: 5 A DAY SBUX SINCE 2018.`)}" spellcheck="false" autocomplete="off" autocapitalize="characters" enterkeyhint="go">`
    + '</form>';
}

// The line typed as YOUR OWN -> the command's words (MY ...), or throws MineError.
// The command's own order works (1200 AAPL 2015, 5 A DAY SBUX SINCE 2018, with or
// without WHATIF MY in front), and so does a ticker, a date and dollars in any order
// (AAPL 2019-01-01 5000): whatif-mine.js parses both.
export function ownWords(text, now = new Date()) {
  const toks = String(text || '').toUpperCase().split(/\s+/).map((t) => t.replace(/,$/, '')).filter(Boolean);
  if (toks[0] === 'WHATIF') toks.shift();
  if (toks[0] === 'MY') toks.shift();
  if (!toks.length) throw new MineError(OWN_HOW);
  let first;
  try {
    const { mine, rest } = parseMine(['MY', ...toks], now);
    if (mine.length && !rest.length) return mine.flatMap((m) => m.words);
  } catch (err) {
    first = err;
  }
  const ti = toks.findIndex((t) => /[A-Z]/.test(t));
  if (toks.length === 3 && ti >= 0 && toks.filter((t) => /[A-Z]/.test(t)).length === 1) {
    const [a, b] = toks.filter((_, i) => i !== ti);
    // The date: the one with a dash; else the one that is not dollars ($, a comma);
    // else the one that reads as a year (1900 to 2100); else the first.
    const year = (t) => /^\d{4}$/.test(t) && Number(t) >= 1900 && Number(t) <= 2100;
    const money = (t) => /[$,]/.test(t);
    let dateFirst = true;
    if (a.includes('-') !== b.includes('-')) dateFirst = a.includes('-');
    else if (money(a) !== money(b)) dateFirst = money(b);
    else if (year(a) !== year(b)) dateFirst = year(a);
    const [date, amount] = dateFirst ? [a, b] : [b, a];
    return formWords({ amount, ticker: toks[ti], date, how: 'ONCE' }, now);
  }
  throw first instanceof MineError ? first : new MineError(OWN_HOW);
}

function renderPicker(el, ctx, cat, picks, startShelf = SHELVES[0], mine = []) {
  let shelf = SHELVES.includes(startShelf) ? startShelf : SHELVES[0];
  const mineOn = new Set(mine.map((m) => m.id)); // your own purchases in the basket
  const phone = window.matchMedia(PHONE_MQ);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const tabs = () => segmented(SHELVES.map((x) => ({ label: x, value: x })), shelf, { label: 'Shelves' });
  el.innerHTML = panel('1', WHATIF_TITLE, `
    <div class="wi-tabs">${toolbar({ left: tabs(), right: ownInputHtml(), label: 'Shelves' })}</div>
    <p class="wi-own-msg" data-own-msg role="status"></p>
    <div class="wi-shelf" role="listbox" aria-multiselectable="true" aria-label="Things you bought" data-own-focus></div>
    <div class="wi-bar" hidden>
      <span class="wi-count" id="wi-count"></span>
      <button type="button" class="wi-run btn-solid" id="wi-run">RUN</button>
    </div>`, { cls: 'panel-solo wi-panel wi-picker', meta: `<span class="wi-hint">${metaNote(PICKER_KEYS, PICKER_KEYS_LONG)}</span>` });

  const shelfEl = el.querySelector('.wi-shelf');
  const tabBox = el.querySelector('.wi-tabs');
  const bar = el.querySelector('.wi-bar');
  const countEl = el.querySelector('#wi-count');
  const runBtn = el.querySelector('#wi-run');
  const ownForm = el.querySelector('[data-own]');
  const ownIn = el.querySelector('#wi-own-in');
  const ownMsg = el.querySelector('[data-own-msg]');
  const byId = new Map(allItems(cat).map((p) => [p.id, p]));
  let cols = shelfCols(phone.matches);
  let cards = []; // this shelf's card elements, in order
  let fams = new Map(); // this shelf's family cards, by family
  let famOpen = null; // the family whose chips show
  let current = 0; // the card with the roving focus
  let stopFade = () => {};

  const basketMine = () => mine.filter((m) => mineOn.has(m.id));
  function refresh() {
    const n = picks.size + mineOn.size;
    bar.hidden = n < 2;
    runBtn.textContent = `RUN ${n}`;
    const names = [...allItems(cat).filter((p) => picks.has(p.id)).map((p) => p.name), ...basketMine().map(mineShort)];
    countEl.textContent = n >= 2 ? names.join(', ') : '';
    ctx.status('');
  }

  // Years typed on this shelf are kept before its cards are redrawn.
  function keepYears() {
    for (const inp of shelfEl.querySelectorAll('input[data-spec]')) if (picks.has(inp.dataset.spec)) picks.set(inp.dataset.spec, inp.value);
  }
  const famPicked = (fam) => fam.items.some((p) => picks.has(p.id));

  // The shelf: rows of cards, each on its pencil line; an open family's chips under its row.
  function drawShelf() {
    keepYears();
    stopFade();
    const items = [...mine.map((m) => ({ mine: m })), ...shelfCards(cat, shelf)];
    fams = new Map(items.filter((c) => c.fam).map((c) => [c.fam, c]));
    if (!fams.has(famOpen)) famOpen = null;
    let html = '';
    for (let i = 0, r = 0; i < items.length; i += cols, r += 1) {
      const row = items.slice(i, i + cols);
      html += `<ul class="wi-row${r % 2 ? ' is-odd' : ''}" role="group">${row.map((c) => (c.mine ? mineCardHtml(c.mine, mineOn.has(c.mine.id)) : c.fam ? familyCardHtml(c, picks, c.fam === famOpen) : cardHtml(c.item, picks))).join('')}</ul>${SHELF_LINE}`;
      const open = row.find((c) => c.fam && c.fam === famOpen);
      if (open) html += `<div class="wi-chips">${chipsHtml(open, picks)}</div>`;
    }
    shelfEl.innerHTML = html;
    shelfEl.setAttribute('aria-label', `${shelf}: things you bought`);
    cards = [...shelfEl.querySelectorAll('.wi-card')];
    current = Math.max(0, Math.min(cards.length - 1, current));
    cards.forEach((c, i) => { c.tabIndex = i === current ? 0 : -1; });
    const row = shelfEl.querySelector('.wi-chips-row');
    if (row && phone.matches) stopFade = edgeFade(row);
  }

  function focusCard(i, { scroll = true } = {}) {
    if (!cards.length) return;
    current = Math.max(0, Math.min(cards.length - 1, i));
    cards.forEach((x, j) => { x.tabIndex = j === current ? 0 : -1; });
    cards[current].focus({ preventScroll: true });
    if (scroll) cards[current].scrollIntoView({ block: 'nearest' });
  }
  const famIndex = () => cards.findIndex((c) => c.dataset.fam === famOpen);
  const rowOf = (i) => Math.floor(i / cols);
  function focusChip(id = '') {
    const chips = [...shelfEl.querySelectorAll('[data-chip]')];
    const chip = (id && chips.find((c) => c.dataset.chip === id)) || chips.find((c) => c.tabIndex === 0) || chips[0];
    if (!chip) return;
    chips.forEach((c) => { c.tabIndex = c === chip ? 0 : -1; });
    chip.focus({ preventScroll: true });
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function showShelf(name, { focus = true } = {}) {
    keepYears();
    shelf = name;
    famOpen = null;
    tabBox.querySelectorAll('.seg-item').forEach((b) => {
      const on = b.dataset.value === shelf;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    current = 0;
    drawShelf();
    const first = cards.findIndex((c) => c.classList.contains('is-on'));
    current = Math.max(0, first);
    cards.forEach((c, i) => { c.tabIndex = i === current ? 0 : -1; });
    if (focus && !coarse) focusCard(current, { scroll: false });
  }
  const moveShelf = (dir) => showShelf(SHELVES[(SHELVES.indexOf(shelf) + dir + SHELVES.length) % SHELVES.length]);

  // Opens or closes a family's chips (only one family's at a time).
  function toggleChips(fam, { keys = false } = {}) {
    famOpen = famOpen === fam ? null : fam;
    drawShelf();
    if (famOpen && keys) focusChip();
    else focusCard(current, { scroll: false });
  }

  // ---- Running.
  const run = (command) => ctx.run(command);
  function runCard(card) {
    if (card.dataset.mine) { run(commandFor(new Map(), cat, mine.filter((m) => m.id === card.dataset.mine))); return; }
    const id = card.dataset.id;
    run(commandFor(new Map([[id, card.querySelector('input[data-spec]')?.value || picks.get(id) || '']]), cat));
  }
  function runBasket() {
    keepYears();
    if (!picks.size && !mineOn.size) { ctx.status('ADD AT LEAST ONE THING', 'warn'); return; }
    run(commandFor(picks, cat, basketMine()));
  }
  // A click or Enter: a family opens its chips; any other card runs.
  function activate(card, opts) {
    if (card.dataset.fam) toggleChips(card.dataset.fam, opts);
    else runCard(card);
  }

  // ---- The basket.
  function toggleBasket(card) {
    if (card.dataset.mine) {
      if (mineOn.has(card.dataset.mine)) mineOn.delete(card.dataset.mine); else mineOn.add(card.dataset.mine);
    } else if (card.dataset.fam) {
      // A family: its first model goes in (its chips open, to change it), or all of it out.
      const fam = fams.get(card.dataset.fam);
      if (famPicked(fam)) fam.items.forEach((p) => picks.delete(p.id));
      else { picks.set(familyPick(fam), ''); famOpen = fam.fam; }
    } else {
      const id = card.dataset.id;
      if (picks.has(id)) picks.delete(id);
      else picks.set(id, card.querySelector('input[data-spec]')?.value || '');
    }
    drawShelf();
    focusCard(current, { scroll: false });
    refresh();
  }
  function toggleChip(id) {
    if (picks.has(id)) picks.delete(id); else picks.set(id, '');
    drawShelf();
    focusChip(id);
    refresh();
  }

  // ---- Keys on the shelf.
  shelfEl.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const chips = [...shelfEl.querySelectorAll('[data-chip]')];
      const act = chipKey(e.key, { i: chips.indexOf(chip), n: chips.length });
      if (!act) return;
      stop();
      const fi = famIndex();
      if ('go' in act) {
        const c = chips[act.go];
        chips.forEach((x) => { x.tabIndex = x === c ? 0 : -1; });
        c.focus({ preventScroll: true });
        c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (act.add) toggleChip(chip.dataset.chip);
      else if (act.run) run(commandFor(new Map([[chip.dataset.chip, '']]), cat));
      else if (act.close) { current = fi; toggleChips(famOpen); }
      else if (act.back) focusCard(fi);
      else if (act.down) { const next = (rowOf(fi) + 1) * cols; if (next < cards.length) focusCard(next); }
      else if (act.shelf) moveShelf(act.shelf);
      return;
    }
    const card = e.target.closest('.wi-card');
    if (!card) return;
    const i = cards.indexOf(card);
    if (e.target.matches('input')) {
      if (e.key === 'Enter') { stop(); keepYears(); runCard(card); }
      else if (e.key === 'Escape') { stop(); focusCard(i); }
      return;
    }
    const input = card.querySelector('input');
    // A habit card: a number (or Y) goes straight into its years box.
    if (input && /^[0-9Yy]$/.test(e.key)) { e.stopPropagation(); input.focus(); return; }
    const fi = famOpen ? famIndex() : -1;
    const keys = {
      ArrowRight: () => focusCard(i + 1),
      ArrowLeft: () => focusCard(i - 1),
      // Down from the row of an open family goes into its chips; Up from the row under it too.
      ArrowDown: () => (fi >= 0 && rowOf(i) === rowOf(fi) ? focusChip() : rowOf(i) < rowOf(cards.length - 1) && focusCard(i + cols)),
      ArrowUp: () => (fi >= 0 && rowOf(i) === rowOf(fi) + 1 ? focusChip() : i - cols >= 0 && focusCard(i - cols)),
      Home: () => focusCard(0),
      End: () => focusCard(cards.length - 1),
      '[': () => moveShelf(-1),
      ']': () => moveShelf(1),
      ' ': () => toggleBasket(card),
      Enter: () => activate(card, { keys: true }),
      ...(famOpen ? { Escape: () => { current = fi; toggleChips(famOpen); } } : {}),
    };
    if (keys[e.key]) { stop(); keys[e.key](); }
  });

  // ---- Clicks: the box (or Shift, Ctrl or Cmd) adds to the basket; else it runs.
  shelfEl.addEventListener('click', (e) => {
    if (e.target.closest('label, input')) return;
    const add = Boolean(e.target.closest('[data-box]')) || e.shiftKey || e.ctrlKey || e.metaKey;
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      if (add) toggleChip(chip.dataset.chip);
      else run(commandFor(new Map([[chip.dataset.chip, '']]), cat));
      return;
    }
    const card = e.target.closest('.wi-card');
    if (!card) return;
    current = cards.indexOf(card);
    if (add) toggleBasket(card);
    else activate(card, { keys: e.detail === 0 });
  });
  shelfEl.addEventListener('input', (e) => { if (e.target.dataset.spec && picks.has(e.target.dataset.spec)) picks.set(e.target.dataset.spec, e.target.value); });
  shelfEl.addEventListener('focusin', (e) => {
    if (e.target.matches('input[data-spec]')) e.target.select();
    const card = e.target.closest('.wi-card');
    if (card && cards.includes(card)) current = cards.indexOf(card);
  });

  // [ and ] also work from the shelf tabs.
  tabBox.addEventListener('keydown', (e) => {
    if (e.target === ownIn) return;
    if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); moveShelf(e.key === ']' ? 1 : -1); }
  });
  tabBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (b) showShelf(b.dataset.value);
  });

  // YOUR OWN: Enter runs it; a line it cannot read says why, under it.
  ownForm.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      run(['WHATIF', ...ownWords(ownIn.value)].join(' '));
    } catch (err) {
      ownMsg.textContent = err.message;
    }
  });
  ownIn.addEventListener('input', () => { ownMsg.textContent = ''; });
  ownIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); focusCard(current); }
    else if (e.key === 'Escape' && ownIn.value) { e.preventDefault(); e.stopPropagation(); ownIn.value = ''; ownMsg.textContent = ''; }
  });

  runBtn.addEventListener('click', runBasket);
  // Four to a row, two on a phone: redrawn when the window crosses the line.
  const onWidth = () => { cols = shelfCols(phone.matches); drawShelf(); };
  phone.addEventListener?.('change', onWidth);
  ctx.onCleanup?.(() => { stopFade(); phone.removeEventListener?.('change', onWidth); });

  refresh();
  // Start on the first card in the basket (or the first card) so the arrows work at once.
  showShelf(shelf, { focus: false });
  if (!coarse) {
    setTimeout(() => { const r = cards[current]; if (r?.isConnected) r.focus({ preventScroll: true }); }, 0);
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

// On a phone the certificate keeps its title, the big amount and "worth today"; its small
// lines (spent, shares, the seal) leave the paper for this one line under it (whatif.css
// shows it under 600 px). The same words and numbers as the certificate's (d.cert), so
// nothing is worked out twice. aria-hidden: the certificate's label already says them.
//   "Spent $649.00 · 25.7 shares · 13.2x"
export function certLine(m) {
  const held = String(m.holding || '').replace(/ of .*$/, '').replace(/^in /, '');
  return [String(m.spent || '').replace(/^You spent/, 'Spent'), held, m.multiple].filter(Boolean).join(' · ');
}
export const certLineHtml = (m) => `<p class="wi-certline num" aria-hidden="true">${esc(certLine(m))}</p>`;

// The title never goes under 11 px (a long one is fitted smaller on a phone).
function sizeCert(el) {
  for (const n of el.querySelectorAll('.wi-cert [data-fs]')) {
    const v = Number(n.dataset.fs);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (n.matches('.wc-l1, .wc-l2')) n.style.setProperty('--fs', String(v));
    else if (n.matches('.wc-ribbon')) n.style.fontSize = `max(11px, ${v}cqw)`;
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
// image and says every amount once); beside it (under it on a phone): SHARE, a short
// note, the race chart and REPLAY / CHANGE PICKS. Everything else (the table, the small
// print, the worst drop, how it is worked out, sources) is behind + Details.
// While the race runs only the certificate and the chart move; the phone's line under
// the certificate shows when it ends, so one amount is on screen at a time.

// The short note under SHARE, always in view (legal: the past-returns caution stays up
// front); the full small print (HINDSIGHT_NOTE) is first in + Details.
export const RESULT_NOTE = 'Hindsight. Past returns do not predict future ones.';

// The things bought, one row each: what, when, paid, shares, worth now, x. In + Details
// (the certificate says the sums).
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
        <li>REPLAY: STOCK is the shares bought so far at each first-of-month close (and on each purchase day). CASH IN A JAR is the same dollars kept as cash, each deflated by CPI-U (BLS) from the month it was spent.</li>
        <li>Hindsight: the list is picked after the fact. Nobody knew these results when the money was spent. Costs, taxes and currency moves are left out.</li>
      </ul>
      <p class="how-h">Notes and sources</p>
      <ul class="how-list">${notes}</ul>
      <p class="wi-over"><a class="code" href="${esc(q('WHATIF'))}" data-cmd="WHATIF">START OVER</a></p>`;
}

// The result page. key: the command as typed; links: shareLinks(d.cert); video: videoHtml(d).
// No certificate (it could not be made): the table stays in view instead.
export function resultHtml(d, { key, links = null, video = '' } = {}) {
  const editCmd = `WHATIF EDIT ${String(key || '').replace(/^WHATIF\s*/, '')}`;
  const chart = replayHtml(d);
  return cardPage({
    split: Boolean(d.cert), cls: 'wi-result', label: 'WHATIF result',
    art: d.cert ? raw(certHtml(d.cert) + certLineHtml(d.cert)) : '',
    act: d.cert && links ? raw(shareHtml(d, links, video)) : '',
    note: RESULT_NOTE,
    chart: chart ? raw(chart) : '',
    media: d.cert ? '' : raw(tableHtml(d)),
    links: [
      chart ? cardLink({ label: 'REPLAY', attrs: 'data-replay title="Replay (Space)"' }) : '',
      cardLink({ label: 'CHANGE PICKS', cmd: editCmd }),
    ],
    details: raw(detailsHtml(d, { table: Boolean(d.cert) })),
  });
}

// ---- REPLAY ------------------------------------------------------------------------

export const HABIT_LONG = 'Habits are bought once a month, on the first trading day. The month still running counts only the days so far.';
export const jarLong = (last) => `CASH IN A JAR: the same cash, deflated by CPI-U from the BLS, to ${fmtMonth(last)}. Later months use the latest value.`;

// The race: two thin lines, STOCK and CASH IN A JAR, each named at its end on the chart
// (whatif-replay.js). The values are in the chart's label, for a screen reader.
export function replayHtml(d) {
  const pts = d.replay?.points;
  if (!pts?.length) return '';
  const last = pts[pts.length - 1];
  const label = `Replay from ${fmtDay(pts[0].d)} to today: stock ${fmtUsd(last.stock)}, cash in a jar ${fmtUsd(last.jar)}.`;
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
  // The phone's line under it waits for the end (one amount on screen at a time).
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
      el.innerHTML = panel('1', WHATIF_TITLE, resultHtml(d, { key, links, video: videoHtml(d) }), { cls: 'panel-solo wi-panel' });
      sizeCert(el);
      setupShare(el, ctx, key);
      // The status line stays empty: the seal says the multiple. Old prices still warn.
      ctx.status('');
      setupReplay(el, d, ctx, { onEnd: () => { if (d.stale) ctx.status('WHATIF: LAST KNOWN PRICES', 'warn'); } });
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
