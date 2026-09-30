// NOT FOUND: words that open nothing (app.js showDidYouMean hands them to showNotFound),
// and the GRAVEYARD and IPO IT screens. What was typed decides the page:
//  - a famous dead ticker (LEH): its stone card (graveyard.js stonePageHtml), "Not anymore.";
//  - ticker-shaped words (XQZT, LEHM, $ABCD, ABC.B): NO SUCH TICKER. YET. The $TICKER is
//    the hero, IPO IT the action, and the picture a listing certificate made out to what
//    was typed (today's date, a serial from the letters, NOT A REAL SECURITY), shared
//    with SHARE ON X · COPY LINK. Dead tickers whose letters match stand under the words
//    (LEHM: LEH), 3 at most, none at random. "Tell us." asks us to add it;
//  - anything else (HIUHASBDAS, several words): the UNKNOWN COMMAND panel: the closest
//    command or name when one is close (Enter), and TRY ONE, the registry's START HERE
//    rows (keys 1 to 5).
// A close match by ticker or by name (live tickers and names, graveyard stones) adds ONE
// line on top of the ticker page, "Did you mean LEH, Lehman Brothers?", which Enter opens
// (closeMatch). A graveyard company's name (LEHMAN, ENRON) opens its stone (graveByName).
// GRAVEYARD lists every entry. The pure parts are ../nosuch.js.

import { esc, q, panel, fmtNum, fmtPct, dirOf } from './markets.js';
import { goal } from '../goal.js';
import { setPrefill } from './feedback.js';
import { nyToday } from '../ranges.js';
import { START_HERE } from '../registry.js';
import { didYouMeanHtml } from '../cards.js';
import { tombstoneLine, ipoLinks, eventLabel, dayText, dymRows, IPO_STAMP, FEEDBACK_PREFILL, MAX_ROWS } from '../nosuch.js';
import {
  loadGraveyardAll, loadRespects, showRespects, shareRow, wireShare, wireRespects, renderGraveyard, graveyardTable, wireVideo, stoneHtml, stoneSlots, stonePageHtml,
} from './graveyard.js';
import { SP100_NAMES, OTHER_NAMES, nameKey } from '../known-tickers.js';
import { INSTRUMENTS } from '../instruments.js';
import { editDistance, fuzzyCommands } from '../resolve.js';
import { cardPage, cardLink, cardRows, usageCard, raw } from '../kit.js';

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

// ---- Which page ----------------------------------------------------------------------------

// Ticker-shaped: 1 to 5 letters, an optional $ in front and an optional class (.B).
export const TICKER_SHAPE = /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
export const tickerShaped = (typed) => TICKER_SHAPE.test(String(typed ?? '').trim().toUpperCase());

// ---- The certificate -------------------------------------------------------------------------

// A serial number from the letters: the same word always gets the same six digits.
export function certSerial(word) {
  let h = 2166136261;
  for (const ch of String(word || '').toUpperCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return String(100000 + (h % 900000));
}

// The listing certificate as the page's picture: the WHATIF paper (the coloured-pencil
// frame, the wax seal), made out to what was typed: ONE SHARE on the ribbon, $XQZT, the
// issue date (today, New York) and the serial; $0.00 in the seal, and the NOT A REAL
// SECURITY stamp across it. Words drawn on the paper are the picture's (aria-label).
export function certHtml(word, { day = nyToday() } = {}) {
  const w = String(word || '').toUpperCase();
  const issued = dayText(day);
  const serial = certSerial(w);
  const label = `A listing certificate: one share of $${w}, issued ${issued}, No. ${serial}. Price $0.00. Stamped ${IPO_STAMP}.`;
  return `<figure class="ns-cert2${w.length > 5 ? ' is-long' : ''}" role="img" aria-label="${esc(label)}">
      <img class="ns-paper" src="/img/whatif/certificate.webp" width="1536" height="1024" alt="">
      <span class="nsc nsc-ribbon" aria-hidden="true">ONE SHARE</span>
      <span class="nsc nsc-big" aria-hidden="true">$${esc(w)}</span>
      <span class="nsc nsc-l1" aria-hidden="true">Issued ${esc(issued)}</span>
      <span class="nsc nsc-l2" aria-hidden="true">No. ${esc(serial)}</span>
      <span class="nsc nsc-seal" aria-hidden="true">$0.00</span>
      <span class="nsc-stamp" aria-hidden="true">${esc(IPO_STAMP)}</span>
    </figure>`;
}

// ---- Dead tickers that match the letters typed -------------------------------------------------

// The graveyard's stones whose ticker (or name) is close to the letters typed, closest
// first, max at most: LEHM -> LEH. Nothing close: none (never a random stone).
export function graveMatches(typed, graves, max = 3) {
  const t = String(typed || '').trim().toUpperCase().replace(/^\$/, '');
  if (!t) return [];
  return (graves || [])
    .filter((e) => e?.ticker && e.ticker !== t)
    .map((e) => ({ e, s: Math.max(closeness(t, { tickers: [e.ticker] }), closeness(t, { names: [e.name, ...(e.also || [])] }) >= 70 ? 70 : 0) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || (a.e.date < b.e.date ? 1 : -1))
    .slice(0, max)
    .map((r) => r.e);
}

// Those stones, in the stone page's own art (the cemetery's small stone), each opening its
// GRAVEYARD page.
export function ripRowHtml(list) {
  if (!list?.length) return '';
  return `<section class="ns-rip"><h3 class="tag ns-h">In the graveyard</h3><div class="ns-rip-row">${list.map((e) => `<a class="ns-rip-stone" href="${esc(q(`GRAVEYARD ${e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${e.ticker}`)}" title="${esc(tombstoneLine(e))}">${stoneHtml(e, { small: true })}</a>`).join('')}</div></section>`;
}

// ---- The Did-you-mean line -----------------------------------------------------------------

// The one line on top when the words are close to something real: "Did you mean LEH,
// Lehman Brothers?" (a command: its name alone). A link with key 1 that Enter opens in the
// empty command bar (data-enter, notFoundKeys); the page's other keys move down one.
export function didYouMeanLine(top) {
  if (!top?.cmd) return '';
  const id = top.kind === 'cmd' ? '' : String(top.id || '');
  const name = String(top.name || id);
  const label = id && name.toUpperCase() !== id.toUpperCase() ? `${id}, ${name}` : id || name;
  return `<span class="ns-dym">Did you mean <a href="${esc(q(top.cmd))}" data-cmd="${esc(top.cmd)}" data-key="1" data-enter data-dym>${esc(label)}</a>?</span>`;
}

// The card's numbered items one key down, the line being key 1; past 9 an item has no key.
export function keysAfterLine(html) {
  return String(html).replace(/ data-key="([1-9])"(?! data-enter data-dym)/g, (m, k) => (Number(k) < 9 ? ` data-key="${Number(k) + 1}"` : ''));
}

// ---- The pages -------------------------------------------------------------------------------

const ask = (word) => `<span class="ns-ask">Want it on Bloombroke? <a href="${esc(q('FEEDBACK'))}" data-cmd="FEEDBACK" data-prefill="${esc(FEEDBACK_PREFILL(word))}">Tell us.</a></span>`;

// A dead ticker typed on its own (LEH): the stone page's slots with "Not anymore.", the
// share links, and the other listing's quote ($LEH on Frankfurt); no line on top.
export function noSuchExtra(word, info, { quote = false, top = null } = {}) {
  if (info?.grave) {
    const e = info.grave;
    const q$ = `$${e.ticker}`;
    return { ...stoneSlots(e, 0), cls: 'ns-card gv-card', kicker: TITLE_GONE, links: quote ? [cardLink({ label: q$, cmd: q$, attrs: `title="${esc(`Quote: ${q$}, another listing`)}"` })] : [] };
  }
  // A DESK panel: the line only, on the kit's plain card (cards.js didYouMeanHtml).
  const line = didYouMeanLine(top);
  return line ? { alert: raw(line) } : {};
}

// NO SUCH TICKER. YET.: the words left ($XQZT the hero, IPO IT the action, the matching
// stones, "Tell us."), the certificate right with its share links. info.ipo false (a word
// IPO IT may not list): no certificate, the words alone. top: the Did-you-mean line.
export function tickerPageHtml({ typed, word, info = {}, top = null, graves = [], day, origin: at = origin() }) {
  const w = String(word || typed || '').trim().toUpperCase().replace(/^\$/, '');
  const canIpo = Boolean(info?.ipo);
  const key = top ? 2 : 1;
  const graveRow = ripRowHtml(graveMatches(w, graves));
  const links = ipoLinks(w, at);
  // The share links under the certificate (the page's picture is what gets shared): the
  // IPO IT page, whose card (/og/ipo.png) shows the ticker typed.
  const share = '<p class="gv-share">'
    + `<a class="card-link" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer" data-share="ipo" data-via="x">SHARE ON X</a><span class="gv-sep" aria-hidden="true">·</span>`
    + `<button type="button" class="card-link" data-copy="${esc(links.url)}" data-share="ipo" data-via="link">COPY LINK</button></p>`;
  const art = canIpo ? raw(`<div class="ns-cert-col">${certHtml(w, { day })}${share}</div>`) : '';
  return cardPage({
    wide: true, split: canIpo, cls: 'ns-card ns-tk', label: `No such ticker: $${w}`,
    alert: top ? raw(didYouMeanLine(top)) : '',
    art,
    kicker: TITLE_YET, hero: `$${w}`, heroSize: w.length <= 6 ? 96 : 60,
    sub: canIpo ? 'Nobody has listed it. Be the first.' : 'Check the spelling.',
    act: raw(canIpo
      ? `<button type="button" class="btn card-btn btn-solid ns-ipo-btn" data-cmd="${esc(`IPO IT ${w}`)}" data-ipo data-key="${key}">IPO IT</button>`
      : `<a class="btn card-btn btn-solid" href="${esc(q('HELP'))}" data-cmd="HELP" data-key="${key}">HELP</a>`),
    media: graveRow ? raw(graveRow) : '',
    links: [ask(w)],
    details: raw(cardRows([
      canIpo ? ['Certificate', 'A joke for a ticker nobody has. Not a real security, and nothing is sold.'] : null,
      graveRow ? ['Graveyard', 'Dead tickers stand here only when their letters match what you typed.'] : null,
      ['Keys', top ? 'Enter opens the line on top. Esc goes back.' : 'Esc goes back.'],
    ].filter(Boolean))),
  });
}

// TRY ONE: the registry's START HERE rows, keys 1 to 5, what each does in small letters.
const lower = (s) => `${String(s || '').charAt(0).toLowerCase()}${String(s || '').slice(1)}`;
export const tryRows = (list = START_HERE) => list.slice(0, 5).map(([cmd, what]) => [cmd, lower(what)]);
// A row that is a stock (AAPL): its price is shown live.
const isStock = (cmd) => SP100_NAMES.some(([id]) => id === cmd);

// One row: the command, what it does, its key (a number, or Enter). live: a ticker row
// holds its last price and day change, filled after (fillLive).
const row = (cmd, what, key, attrs = '') => `<a class="ns-row" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}"${attrs}><span class="ns-cmd">${esc(cmd)}</span><span class="ns-what">${esc(what)}</span>${isStock(cmd) ? `<span class="ns-live num" data-live="${esc(cmd)}"></span>` : '<span class="ns-live"></span>'}<kbd class="ns-k">${esc(key)}</kbd></a>`;

// UNKNOWN COMMAND: the kit's numbered panel. The closest command or name when one is close
// (Enter), TRY ONE (1 to 5, without the CLOSEST row), Ctrl K and "Tell us what you wanted".
export function unknownHtml({ typed, top = null, rows = tryRows() }) {
  const words = String(typed || '').trim().replace(/\s+/g, ' ');
  const known = new Map(rows);
  const short = (c) => known.get(c.cmd) || lower(String(c.what || c.name).split(/[:.]/)[0]);
  const closest = top?.cmd ? row(top.cmd, top.kind === 'cmd' ? short(top) : top.kind === 'grave' ? `${top.name} · ${top.what}` : top.name, 'Enter', ' data-enter') : '';
  const tries = rows.filter(([cmd]) => cmd !== top?.cmd);
  const body = '<p class="ns-unk-line">Not a command, a ticker or a company we know.</p>'
    + (closest ? `<h3 class="tag ns-h">Closest</h3><div class="ns-rows">${closest}</div>` : '')
    + `<h3 class="tag ns-h">Try one</h3><div class="ns-rows">${tries.map(([cmd, what], i) => row(cmd, what, String(i + 1), ` data-key="${i + 1}"`)).join('')}</div>`
    + `<p class="ns-unk-foot"><a href="${esc(q('MENU'))}" data-cmd="MENU"><kbd>Ctrl K</kbd> every command</a> · <a href="${esc(q('FEEDBACK'))}" data-cmd="FEEDBACK" data-prefill="${esc(FEEDBACK_PREFILL(words))}">Tell us what you wanted</a></p>`;
  return panel('1', `Unknown command: ${words}`, body, { meta: '<span class="ns-esc"><kbd>Esc</kbd> back</span>', cls: 'panel-solo ns-unk' });
}

// Everything showNotFound draws: { kind, html, status: [text, kind], enter }.
//   stone: a dead ticker typed on its own; desk: a DESK panel (the kit's plain card and the
//   line); ticker: NO SUCH TICKER. YET.; unknown: the UNKNOWN COMMAND panel.
export function notFoundPage({ typed, word = null, found = {}, ticker = null, info = {}, graves = [], quote = false, embed = false, day } = {}) {
  if (info?.grave) {
    const e = info.grave;
    return { kind: 'stone', html: stonePageHtml(e, 0, noSuchExtra(word, info, { quote })), status: [`${e.ticker}: ${String(e.what).toUpperCase()}`, 'warn'], enter: false };
  }
  const top = closeMatch(typed, { found, graves });
  const shaped = Boolean(ticker) || tickerShaped(typed);
  if (embed) {
    const shown = withoutMatch(found, top);
    const html = didYouMeanHtml(typed, shown, ticker, { extra: { ...noSuchExtra(null, {}, { top }), kicker: ticker ? TITLE_YET : 'Unknown command' } });
    const rows = guessCount(shown, typed, ticker);
    return { kind: 'desk', html: top ? keysAfterLine(html) : html, status: [rows ? 'NOT FOUND. PICK ONE BELOW, OR TYPE HELP' : ticker ? 'NO SUCH TICKER. TYPE HELP' : 'UNKNOWN COMMAND. TYPE HELP', 'warn'], enter: false };
  }
  const openName = top ? String(top.id || top.name).toUpperCase() : '';
  if (shaped) {
    return {
      kind: 'ticker', html: tickerPageHtml({ typed, word: ticker || word || typed, info, top, graves, day }), enter: Boolean(top),
      status: [top ? `NOT FOUND. ENTER OPENS ${openName}, OR TYPE HELP` : info?.ipo ? 'NO SUCH TICKER. IPO IT, OR TYPE HELP' : 'NO SUCH TICKER. TYPE HELP', 'note'],
    };
  }
  // Plain words (stock screener, whats the fed doing): nothing close by spelling, so the
  // resolver's first guess by meaning is CLOSEST.
  const g = found?.commands?.[0];
  const pick = top || (g?.cmd ? { kind: 'cmd', id: '', name: g.name || g.cmd, cmd: g.cmd, what: g.summary || '' } : null);
  return {
    kind: 'unknown', html: unknownHtml({ typed, top: pick }), enter: Boolean(pick),
    status: [pick ? `UNKNOWN COMMAND. ENTER OPENS ${pick.kind === 'cmd' ? String(pick.name).toUpperCase() : openName}, OR TRY ONE ABOVE` : 'UNKNOWN COMMAND. TRY ONE ABOVE', 'note'],
  };
}

// A ticker row's last price and day change: from /api/quotes (the server keeps a quote
// 15 s). Offline, slow or no price: null, and the row shows nothing (never 0).
export async function liveQuote(sym, { fetchImpl = globalThis.fetch, wait = 2500, signal } = {}) {
  try {
    const ask$ = fetchImpl(`/api/quotes?${new URLSearchParams({ s: sym })}`, { signal, headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null));
    const d = await Promise.race([ask$, new Promise((r) => { setTimeout(r, wait, null); })]);
    const qt = (d?.quotes || []).find((x) => x.ticker === sym);
    return qt && Number.isFinite(qt.last) && qt.last > 0 ? qt : null;
  } catch {
    return null;
  }
}
export const liveHtml = (qt) => (qt ? `${esc(fmtNum(qt.last))}${Number.isFinite(qt.changePct) ? ` <span class="${dirOf(qt.changePct)}">${esc(fmtPct(qt.changePct))}</span>` : ''}` : '');

export async function fillLive(el, opts = {}) {
  for (const n of el.querySelectorAll?.('[data-live]') || []) {
    const qt = await liveQuote(n.dataset.live, opts);
    if (qt && n.isConnected) n.innerHTML = liveHtml(qt);
  }
}

// Browser: draw the page for the words typed into view, set the status line, and wire
// it (keys, share, IPO IT, respects on a stone card, the live price). Returns a cleanup.
export function showNotFound(view, { status = () => {}, embed = false, word = null, info = {}, ...rest } = {}) {
  const p = notFoundPage({ ...rest, word, info, embed });
  view.innerHTML = p.html;
  status(...p.status);
  if (embed) return () => {};
  const stop = wireNoSuch(view, word, info, { status, enter: p.enter });
  const ac = new AbortController();
  if (p.kind === 'unknown') fillLive(view, { signal: ac.signal });
  return () => { ac.abort(); stop(); };
}

// Clicks on the page: FEEDBACK gets its prefill, IPO IT and shares count, and F pays
// respects to a tombstone. (Clicks run before app.js's own handler, which runs the
// command.) status: the status line; enter: Enter opens the [data-enter] item.
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
  const stopKeys = !info?.grave ? notFoundKeys(el, { doc, enter }) : () => {};
  if (info?.grave) wireVideo(el); // its video loads on a click, as on GRAVEYARD LEH
  // The candles for its respects so far (the count itself shows only after F).
  if (info?.grave) loadRespects().then((n) => { if (el.isConnected) showRespects(el, n[info.grave.ticker] || 0); });
  return () => { el.removeEventListener('click', onClick); stop(); stopKeys(); };
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

// ---- Keys ------------------------------------------------------------------------------------

// Enter opens the [data-enter] item (the Did-you-mean line, CLOSEST) when the command bar
// is empty (or the focus is on the page, not on a link or a field); only with enter. A
// digit opens its [data-key] item only with the focus in the page: in the bar a digit is
// typing (3988.HK), and "2 Enter" there opens item 2 (app.js numberedItem). Returns a
// cleanup.
export function notFoundKeys(el, { doc = globalThis.document, enter = true } = {}) {
  const handler = (ev) => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing || ev.repeat || !el.isConnected) return;
    const isEnter = ev.key === 'Enter';
    if (!(isEnter ? enter : /^[1-9]$/.test(ev.key))) return;
    const t = ev.target;
    if (!isEnter) {
      if (!el.contains?.(t)) return; // a digit: only with the focus in the panel
    } else if (t?.id === 'cmd') {
      if (t.value !== '') return;
      const list = doc.getElementById?.('suggest');
      if (list && !list.hidden) return;
    } else if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
    else if (t?.closest?.('a, button, summary, [data-cmd]')) return; // a focused link opens itself
    const item = el.querySelector(isEnter ? '[data-enter]' : `[data-key="${ev.key}"]`);
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
