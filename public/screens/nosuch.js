// NO SUCH TICKER. YET. (the screen), GRAVEYARD and IPO IT.
//
// The not-found screen (app.js showDidYouMean) asks /api/nosuch about the word typed:
//  - a famous dead ticker gets its tombstone, a share row and its sources;
//  - any other A-Z word of 1 to 5 letters the server allows gets IPO IT, a joke listing
//    certificate (the IPO IT <WORD> screen, card at /og/ipo.png);
//  - and one line to ask us to add it (FEEDBACK, prefilled "Please add: WORD").
// GRAVEYARD lists every entry; GRAVEYARD LEH shows one. The pure parts are ../nosuch.js.

import { esc, q, panel } from './markets.js';
import { goal } from '../goal.js';
import { setPrefill } from './feedback.js';
import { tombstoneLine, ipoLinks, pickGraves, IPO_STAMP, FEEDBACK_PREFILL } from '../nosuch.js';
import {
  loadGraveyardAll, loadRespects, showRespects, shareRow, wireShare, wireRespects, renderGraveyard, graveyardTable, stoneSlots, wireVideo,
} from './graveyard.js';
import { cardLink, usageCard, raw } from '../kit.js';

export { graveyardTable };

export const TITLE_YET = 'No such ticker. Yet.';
export const TITLE_GONE = 'No such ticker. Not anymore.';
// The ALL COMMANDS link on the card (the same as app.js HELP_LINE).
export const HELP_LINE = cardLink({ label: 'ALL COMMANDS', cmd: 'HELP' });

const origin = () => (typeof location !== 'undefined' ? location.origin : 'https://bloombroke.com');
const code = (c, label = c, extra = '') => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}"${extra}>${esc(label)}</a>`;

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

// The stones (not the zombies), for THE GRAVEYARD row.
export async function loadGraveyard(signal) {
  return (await loadGraveyardAll(signal)).entries;
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

// THE GRAVEYARD: a row of small tombstones, each opening its GRAVEYARD entry.
export function yardHtml(list) {
  if (!list?.length) return '';
  return `<section class="ns-yard"><h3 class="hs-h">The graveyard</h3><div class="ns-yard-row">${list.map((e) => `<a class="ns-mini-stone" href="${esc(q(`GRAVEYARD ${e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${e.ticker}`)}" title="${esc(tombstoneLine(e))}" aria-label="${esc(tombstoneLine(e))}">${esc(e.ticker)}</a>`).join('')}</div></section>`;
}

// The slots this screen adds to the NO SUCH card (app.js didYouMeanHtml, kit.js cardPage).
// word: the one word typed (or null); info: noSuchInfo's answer; next: the key number for
// IPO IT; quote: a tombstone that beat a non-US quote links the quote ($LEH); yard:
// entries for THE GRAVEYARD row.
//  - a famous dead ticker: its stone card (graveyard.js stoneSlots), "Not anymore.";
//  - a word IPO IT can list: "Be the first.", IPO IT, the certificate and the row;
//  - any other word: the row. And "Tell us." to ask us to add it.
export function noSuchExtra(word, info, { ticker = null, next = 1, quote = false, yard = [] } = {}) {
  if (info?.grave) {
    const e = info.grave;
    const s = stoneSlots(e, 0);
    const q$ = `$${e.ticker}`;
    // The share links, and the other listing's quote ($LEH on Frankfurt); no ALL COMMANDS.
    return { ...s, kicker: TITLE_GONE, help: false, links: [...s.links, ...(quote ? [cardLink({ label: q$, cmd: q$, attrs: `title="${esc(`Quote: ${q$}, another listing`)}"` })] : [])] };
  }
  if (!word) return {};
  const canIpo = Boolean(ticker && info?.ipo);
  const ask = `<span class="ns-ask">Want it on Bloombroke? <a href="${esc(q('FEEDBACK'))}" data-cmd="FEEDBACK" data-prefill="${esc(FEEDBACK_PREFILL(word))}">Tell us.</a></span>`;
  const media = (canIpo ? ipoPreviewHtml(word) : '') + yardHtml(yard);
  return {
    ...(canIpo ? {
      sub: 'Nobody has listed it. Be the first.',
      act: raw(`<button type="button" class="btn card-btn btn-solid ns-ipo-btn" data-cmd="${esc(`IPO IT ${word}`)}" data-ipo${next <= 9 ? ` data-key="${next}"` : ''}>IPO IT</button>`),
    } : {}),
    media: media ? raw(`<div class="ns-media">${media}</div>`) : '',
    links: [ask],
  };
}

// n random entries for THE GRAVEYARD row; none when the list does not load in time.
export async function yardPick(signal, n = 4, wait = 1500) {
  try {
    const list = await Promise.race([loadGraveyard(signal), new Promise((r) => { setTimeout(r, wait, []); })]);
    return pickGraves(list, n);
  } catch {
    return [];
  }
}

// Clicks on the not-found screen: FEEDBACK gets its prefill, IPO IT and shares count, and
// F pays respects to a tombstone. (Clicks run before app.js's own handler, which runs the
// command.) status: the status line.
export function wireNoSuch(el, word, info, { status = () => {} } = {}) {
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
  if (info?.grave) wireVideo(el); // its video loads on a click, as on GRAVEYARD LEH
  // The candles for its respects so far (the count itself shows only after F).
  if (info?.grave) loadRespects().then((n) => { if (el.isConnected) showRespects(el, n[info.grave.ticker] || 0); });
  return () => { el.removeEventListener('click', onClick); stop(); };
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
