// NO SUCH TICKER. YET. (the screen), GRAVEYARD and IPO IT.
//
// Words that open nothing (app.js showDidYouMean) get the NO SUCH card (cards.js
// didYouMeanHtml, kit.js cardPage). It asks /api/nosuch about the word typed:
//  - a famous dead ticker (LEH) gets its stone card (graveyard.js stoneSlots);
//  - any other A-Z word of 1 to 5 letters the server allows gets IPO IT, a joke listing
//    certificate (the IPO IT <WORD> screen, card at /og/ipo.png), and THE GRAVEYARD row;
//  - and one line to ask us to add it (FEEDBACK, prefilled "Please add: WORD").
// A close match by ticker or by name (live tickers and names, graveyard stones) adds ONE
// line on top, "Did you mean LEH, Lehman Brothers?", which Enter opens (closeMatch). A
// graveyard company's name (LEHMAN, ENRON) opens its stone (graveByName). GRAVEYARD lists
// every entry. The pure parts are ../nosuch.js.

import { esc, q, panel } from './markets.js';
import { goal } from '../goal.js';
import { setPrefill } from './feedback.js';
import { tombstoneLine, ipoLinks, pickGraves, dymRows, eventLabel, IPO_STAMP, FEEDBACK_PREFILL, MAX_ROWS } from '../nosuch.js';
import {
  loadGraveyardAll, loadRespects, showRespects, shareRow, wireShare, wireRespects, renderGraveyard, graveyardTable, stoneSlots, fitStone, wireVideo,
} from './graveyard.js';
import { SP100_NAMES, OTHER_NAMES, nameKey } from '../known-tickers.js';
import { INSTRUMENTS } from '../instruments.js';
import { editDistance, fuzzyCommands } from '../resolve.js';
import { cardLink, usageCard, raw } from '../kit.js';

export { graveyardTable };

export const TITLE_YET = 'No such ticker. Yet.';
export const TITLE_GONE = 'No such ticker. Not anymore.';
// The ALL COMMANDS link on the card (the same as app.js HELP_LINE).
export const HELP_LINE = cardLink({ label: 'ALL COMMANDS', cmd: 'HELP' });

const origin = () => (typeof location !== 'undefined' ? location.origin : 'https://bloombroke.com');

// ---- Data from the server -----------------------------------------------------------------

const infoCache = new Map();
// { grave, ipo, wins } for one word (wins: the tombstone beats a non-US quote). Offline
// or slow: nothing special (no tombstone, no IPO IT).
export async function noSuchInfo(word, { signal, fetchImpl = globalThis.fetch, wait = 2500 } = {}) {
  const w = String(word || '').toUpperCase();
  if (!/^[A-Z]{1,12}$/.test(w)) return { grave: null, ipo: false };
  if (infoCache.has(w)) return infoCache.get(w);
  const none = { grave: null, ipo: false, wins: false };
  try {
    const ask = fetchImpl(`/api/nosuch?${new URLSearchParams({ t: w })}`, { signal, headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null));
    const d = await Promise.race([ask, new Promise((r) => { setTimeout(r, wait, null); })]);
    if (!d) return none;
    const out = { grave: d.grave && d.grave.ticker ? d.grave : null, ipo: d.ipo === true, wins: d.wins === true };
    infoCache.set(w, out);
    return out;
  } catch {
    return none;
  }
}

// The stones (not the zombies): none when the list does not load in time.
export async function loadGraves(signal, wait = 1500) {
  try {
    return await Promise.race([loadGraveyardAll(signal).then((d) => d.entries), new Promise((r) => { setTimeout(r, wait, []); })]);
  } catch {
    return [];
  }
}

// ---- Pieces --------------------------------------------------------------------------------

// A small live preview of the IPO IT certificate: the same paper, the word, the stamp.
// A link: clicking it is IPO IT.
export function ipoPreviewHtml(word) {
  const paper = '/img/whatif/certificate.webp';
  return `<a class="ns-mini" href="${esc(q(`IPO IT ${word}`))}" data-cmd="${esc(`IPO IT ${word}`)}" data-ipo aria-label="${esc(`IPO IT ${word}: make the listing certificate`)}">
      <img src="${paper}" width="1536" height="1024" alt="">
      <span class="ns-mini-big" aria-hidden="true">$${esc(word)}</span><span class="ns-mini-stamp" aria-hidden="true">${esc(IPO_STAMP)}</span>
    </a>`;
}

// THE GRAVEYARD: a row of small tombstones, each opening its GRAVEYARD entry. No count
// on them (respects show on a stone's own page, after F).
export function yardHtml(list) {
  if (!list?.length) return '';
  return `<section class="ns-yard"><h3 class="hs-h">The graveyard</h3><div class="ns-yard-row">${list.map((e) => `<a class="ns-mini-stone" href="${esc(q(`GRAVEYARD ${e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${e.ticker}`)}" title="${esc(tombstoneLine(e))}" aria-label="${esc(tombstoneLine(e))}">${esc(e.ticker)}</a>`).join('')}</div></section>`;
}

// n random entries for THE GRAVEYARD row (a fresh pick each visit).
export function yardPick(graves, n = 4, rand = Math.random) {
  return pickGraves(graves, n, rand);
}

// The one line on top when the words are close to something real: "Did you mean LEH,
// Lehman Brothers?" (a command: its name alone). A link with key 1: Enter in the empty
// command bar opens it (notFoundKeys; the status line says so), and the card's other keys
// move down one (keysAfterLine).
export function didYouMeanLine(top) {
  if (!top?.cmd) return '';
  const id = top.kind === 'cmd' ? '' : String(top.id || '');
  const name = String(top.name || id);
  const label = id && name.toUpperCase() !== id.toUpperCase() ? `${id}, ${name}` : id || name;
  return `<span class="ns-dym">Did you mean <a href="${esc(q(top.cmd))}" data-cmd="${esc(top.cmd)}" data-key="1" data-dym>${esc(label)}</a>?</span>`;
}

// The card's numbered items (the guesses, IPO IT) one key down, the line being key 1;
// past 9 an item has no key.
export function keysAfterLine(html) {
  return String(html).replace(/ data-key="([1-9])"(?! data-dym)/g, (m, k) => (Number(k) < 9 ? ` data-key="${Number(k) + 1}"` : ''));
}

// The slots this screen adds to the NO SUCH card (app.js didYouMeanHtml, kit.js cardPage).
// word: the one word typed (or null); info: noSuchInfo's answer; next: the key number for
// IPO IT; quote: a tombstone that beat a non-US quote links the quote ($LEH); yard:
// entries for THE GRAVEYARD row; top: the close match (closeMatch), the line on top.
//  - a famous dead ticker: its stone card (graveyard.js stoneSlots), "Not anymore.";
//  - a word IPO IT can list: "Be the first.", IPO IT, the certificate and the row;
//  - any other word: the row. And "Tell us." to ask us to add it.
export function noSuchExtra(word, info, { ticker = null, next = 1, quote = false, yard = [], top = null } = {}) {
  if (info?.grave) {
    const e = info.grave;
    const s = stoneSlots(e, 0);
    const q$ = `$${e.ticker}`;
    // The share links, and the other listing's quote ($LEH on Frankfurt); no ALL COMMANDS.
    return { ...s, kicker: TITLE_GONE, help: false, links: [...s.links, ...(quote ? [cardLink({ label: q$, cmd: q$, attrs: `title="${esc(`Quote: ${q$}, another listing`)}"` })] : [])] };
  }
  const line = didYouMeanLine(top);
  const alert = line ? { alert: raw(line) } : {};
  if (!word) return alert;
  const canIpo = Boolean(ticker && info?.ipo);
  const ask = `<span class="ns-ask">Want it on Bloombroke? <a href="${esc(q('FEEDBACK'))}" data-cmd="FEEDBACK" data-prefill="${esc(FEEDBACK_PREFILL(word))}">Tell us.</a></span>`;
  const media = (canIpo ? ipoPreviewHtml(word) : '') + yardHtml(yard);
  return {
    ...alert,
    ...(canIpo ? {
      sub: 'Nobody has listed it. Be the first.',
      act: raw(`<button type="button" class="btn card-btn btn-solid ns-ipo-btn" data-cmd="${esc(`IPO IT ${word}`)}" data-ipo${next <= 9 ? ` data-key="${next}"` : ''}>IPO IT</button>`),
    } : {}),
    media: media ? raw(`<div class="ns-media">${media}</div>`) : '',
    links: [ask],
  };
}

// Clicks on the NO SUCH card: FEEDBACK gets its prefill, IPO IT and shares count, and F
// pays respects to a tombstone. (Clicks run before app.js's own handler, which runs the
// command.) status: the status line; enter: the Did-you-mean line is there (Enter opens it).
export function wireNoSuch(el, word, info, { status = () => {}, enter = false, doc = globalThis.document } = {}) {
  if (info?.grave) goal('graveyard_seen', null, { once: info.grave.ticker });
  else if (word) goal('notfound_seen', null, { once: word });
  const onClick = (e) => {
    const f = e.target.closest?.('[data-prefill]');
    if (f) setPrefill(f.dataset.prefill);
    if (e.target.closest?.('[data-ipo]')) goal('ipo_made', null, { once: word });
  };
  el.addEventListener('click', onClick);
  wireShare(el);
  const stop = info?.grave ? wireRespects(el, info.grave.ticker, { status }) : () => {};
  const stopFit = info?.grave ? fitStone(el) : () => {}; // the stone card's media row, to the first view
  const stopKeys = enter && !info?.grave ? notFoundKeys(el, { doc }) : () => {};
  if (info?.grave) wireVideo(el); // its video loads on a click, as on GRAVEYARD LEH
  // The candles for its respects so far (the count itself shows only after F).
  if (info?.grave) loadRespects().then((n) => { if (el.isConnected) showRespects(el, n[info.grave.ticker] || 0); });
  return () => { el.removeEventListener('click', onClick); stop(); stopFit(); stopKeys(); };
}

// ---- Did you mean: matching ------------------------------------------------------------------

const MIN_LEN = 3; // shorter words match only a ticker exactly
const squash = (s) => nameKey(s).replace(/ /g, '');

// How close a candidate is to the words typed: 0 (not at all) to 100 (the same).
// Tickers: the same (100), one inside the other (LEHM, LEH: 60), one letter off (45).
// Names: the same (95), the name starts with the words (80: one word typed is matched
// word by word, so NEWZ is not "New Zealand"), a later word of the name does (70), one
// or two letters off (APPLEE, Apple: 50).
export function closeness(typed, { names = [], tickers = [] } = {}) {
  const t = squash(typed);
  const T = t.toUpperCase();
  const spaced = nameKey(typed);
  const oneWord = !spaced.includes(' ');
  if (!t) return 0;
  let best = 0;
  const at = (n) => { if (n > best) best = n; };
  for (const id of tickers) {
    const k = String(id || '').toUpperCase().replace(/^\$/, '');
    if (!k) continue;
    if (k === T) at(100);
    else if (T.length >= MIN_LEN && k.length >= MIN_LEN && (T.startsWith(k) || k.startsWith(T))) at(60);
    else if (T.length >= MIN_LEN && k.length >= MIN_LEN && editDistance(T, k) === 1) at(45);
  }
  const typos = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0;
  for (const n of names) {
    const key = nameKey(n);
    const whole = key.replace(/ /g, '');
    if (!whole) continue;
    if (whole === t) at(95);
    else if (t.length >= MIN_LEN && (oneWord ? key.split(' ')[0].startsWith(t) : key.startsWith(spaced))) at(80);
    else if (t.length >= MIN_LEN && oneWord && key.split(' ').some((w) => w.startsWith(t))) at(70);
    else if (typos) {
      const d = Math.min(editDistance(t, whole), editDistance(t, key.split(' ')[0]));
      if (d <= typos) at(55 - 5 * d);
    }
  }
  return best;
}

// "Apple Inc." -> "Apple"; "TH Lehman & Co Inc" -> "TH Lehman & Co".
export function shortName(name) {
  return String(name || '').replace(/,?\s+(Inc|Incorporated|Corp|Corporation|Company|Ltd|Limited|plc)\.?$/i, '').trim();
}

// Everything the words might mean: { kind: live | grave | cmd, id, name, cmd, what, names,
// tickers, floor }. found: the resolver's rows (app.js resolveInput: the symbol search and
// commands a typo away); graves: the graveyard's stones. The same names and tickers the
// command bar resolves (known-tickers.js, instruments.js) are always in.
export function candidates({ found = {}, graves = [], typed = '' } = {}) {
  const out = new Map();
  // The command names a typo away from a word typed (the resolver's own test).
  const words = String(typed).toUpperCase().split(/\s+/).filter(Boolean);
  const typo = new Set([...words, words.join('')].flatMap((w) => fuzzyCommands(w).map((c) => c.name)));
  const add = (c) => { if (c.cmd && !out.has(c.cmd)) out.set(c.cmd, c); };
  // A search row matched the words upstream: close enough to list (floor), not to lead.
  for (const s of found.symbols || []) add({ kind: 'live', id: s.id, name: shortName(s.name) || s.id, cmd: s.cmd || s.id, names: [s.name || ''], tickers: [s.id], floor: 30 });
  for (const e of graves || []) {
    if (!e?.ticker) continue;
    add({ kind: 'grave', id: e.ticker, name: e.name, cmd: `GRAVEYARD ${e.ticker}`, what: `graveyard · ${eventLabel(e.what).toLowerCase()} ${String(e.date).slice(0, 4)}`, names: [e.name, ...(e.also || [])], tickers: [e.ticker] });
  }
  for (const [id, ...names] of [...SP100_NAMES, ...OTHER_NAMES]) add({ kind: 'live', id, name: names[0], cmd: id, names, tickers: [id] });
  for (const i of INSTRUMENTS) add({ kind: 'live', id: i.id, name: i.name, cmd: i.id, names: [i.name, ...i.aliases], tickers: [i.id] });
  // The resolver's command guesses: always listed, first on a tie. A typo away (COMPAER is
  // COMPARE) as close as a name one letter off (50); by what the command does (MOVESR is
  // WHY, HOUSE is WAFFLE) only when nothing real is closer (30).
  for (const c of found.commands || []) add({ kind: 'cmd', id: '', name: c.name, cmd: c.cmd, what: c.summary || '', names: [c.name], floor: typo.has(c.name) ? 50 : 30 });
  return [...out.values()];
}

// The closest rows, best first, MAX_ROWS at most; never the words typed themselves.
export function closestRows(typed, list) {
  const same = squash(typed);
  return (list || [])
    .filter((c) => squash(c.cmd) !== same)
    .map((c) => ({ c, s: Math.max(closeness(typed, c), c.floor || 0) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || (b.c.kind === 'cmd') - (a.c.kind === 'cmd') || a.c.name.length - b.c.name.length)
    .slice(0, MAX_ROWS)
    .map((r) => r.c);
}

// The one close match for the Did-you-mean line: the closest candidate that is close by
// its ticker or its name (never a guess by meaning alone), or null (no line).
export function closeMatch(typed, { found = {}, graves = [] } = {}) {
  const words = String(typed || '').trim().replace(/\s+/g, ' ');
  if (!words) return null;
  const close = candidates({ found, graves, typed: words }).filter((c) => closeness(words, c) > 0);
  return closestRows(words, close)[0] || null;
}

// The resolver's rows without the line's match, so the card's guesses never repeat it.
export function withoutMatch(found = {}, top = null) {
  if (!top?.cmd) return found;
  const k = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const same = (c) => k(c) === k(top.cmd);
  return { ...found, commands: (found.commands || []).filter((c) => !same(c.cmd)), symbols: (found.symbols || []).filter((x) => !same(x.cmd)) };
}

// How many guesses the card shows (cards.js didYouMeanHtml): IPO IT's key comes after them.
export const guessCount = (found, typed, ticker) => dymRows(found, typed, ticker).length;

// A graveyard company typed by name: LEHMAN, LEHMAN BROTHERS, TOYS R US -> its entry.
// Only its name or its other words (data/graveyard.json "also"), never its old ticker
// (LEH typed is the stone card, see noSuchExtra).
export function graveByName(typed, graves) {
  const key = nameKey(typed);
  const flat = key.replace(/ /g, '').toUpperCase();
  if (!key) return null;
  return (graves || []).find((e) => e?.ticker && (nameKey(e.name) === key || (e.also || []).includes(flat))) || null;
}

// Where app.js showDidYouMean sends the words: a graveyard entry to open as GRAVEYARD
// <ticker>, or null (the NO SUCH card, or the stone card). A name or other word opens its stone
// (from the list, or the server's answer when the list did not load); a dead ticker typed
// on its own (LEH), and a stone that beat another listing's quote (quote: its $ link),
// keep the stone card.
export function stoneFor(typed, word, info, graves, { quote = false } = {}) {
  if (quote) return null;
  return graveByName(typed, graves) || (info?.grave && info.grave.ticker !== word ? info.grave : null);
}

// ---- The Did-you-mean line: keys ---------------------------------------------------------

// With the Did-you-mean line on the card: Enter opens it (key 1) when the command bar is
// empty (or the focus is on the page, not on a link or a field). A digit opens its item
// only with the focus in the card: in the bar a digit is typing (3988.HK), and "2 Enter"
// there opens item 2 (app.js numberedItem). Returns a cleanup.
export function notFoundKeys(el, { doc = globalThis.document } = {}) {
  const handler = (ev) => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing || ev.repeat || !el.isConnected) return;
    const n = ev.key === 'Enter' ? '1' : /^[1-9]$/.test(ev.key) ? ev.key : null;
    if (!n) return;
    const t = ev.target;
    if (ev.key !== 'Enter') {
      if (!el.contains?.(t)) return; // a digit: only with the focus in the panel
    } else if (t?.id === 'cmd') {
      if (t.value !== '') return;
      const list = doc.getElementById?.('suggest');
      if (list && !list.hidden) return;
    } else if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
    else if (ev.key === 'Enter' && t?.closest?.('a, button, summary, [data-cmd]')) return; // a focused link opens itself
    const item = el.querySelector(`[data-key="${n}"]`);
    if (!item) return;
    ev.preventDefault();
    ev.stopPropagation();
    item.click();
  };
  doc.addEventListener('keydown', handler, true);
  return () => doc.removeEventListener('keydown', handler, true);
}

// ---- IPO IT --------------------------------------------------------------------------------

// IPO IT without a word it can list: the kit's usage card.
export function ipoUsage() {
  return usageCard({ problem: 'IPO IT needs a made-up ticker.', format: 'IPO IT word', grammar: 'IPO IT <1 to 5 letters, A to Z>', example: 'IPO IT QXZV', notes: [raw(`Type <a class="code" href="${esc(q('HELP'))}" data-cmd="HELP">HELP</a> for every command.`)] });
}

function plainPage(el, ctx) {
  el.innerHTML = panel('1', 'No such ticker', ipoUsage(), { cls: 'panel-solo' });
  ctx.status('UNKNOWN COMMAND. TYPE HELP', 'warn');
}

export function ipoHtml(word, links) {
  return `<figure class="ns-cert"><img src="${esc(links.image)}" width="1200" height="630" alt="${esc(`A listing certificate for $${word}. Shares outstanding: 1. Price: $0.00. Exchange: your imagination. Stamped NOT A REAL SECURITY.`)}"></figure>
    ${shareRow(links, 'ipo')}
    <p class="muted ns-help">A joke, not a real security. Type any made-up ticker to list your own.</p>`;
}

function renderIpo(el, cmd, ctx) {
  const word = cmd.args?.word;
  if (!word) { plainPage(el, ctx); return; }
  el.innerHTML = panel('1', 'Listing certificate', '<p class="loading">LOADING...</p>', { cls: 'panel-solo' });
  noSuchInfo(word, { signal: ctx.signal }).then((info) => {
    if (!el.isConnected || ctx.signal?.aborted) return;
    if (!info.ipo) { plainPage(el, ctx); return; }
    el.innerHTML = panel('1', 'Listing certificate', ipoHtml(word, ipoLinks(word, origin())), { cls: 'panel-solo' });
    wireShare(el, ctx.copy);
    ctx.status(`$${word}: LISTED. NOT REALLY.`);
  });
}

export function render(el, cmd, ctx) {
  if (cmd.name === 'GRAVEYARD') return renderGraveyard(el, cmd, ctx);
  return renderIpo(el, cmd, ctx);
}

export const NOSUCH_SCREENS = { GRAVEYARD: { render }, IPOIT: { render } };
