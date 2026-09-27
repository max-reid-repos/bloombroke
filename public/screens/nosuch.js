// NO SUCH TICKER. YET. (the screen), GRAVEYARD and IPO IT.
//
// The not-found screen (app.js showDidYouMean) asks /api/nosuch about the word typed:
//  - a famous dead ticker gets its tombstone, a share row and its sources;
//  - any other A-Z word of 1 to 5 letters the server allows gets IPO IT, a joke listing
//    certificate (the IPO IT <WORD> screen, card at /og/ipo.png);
//  - and one line to ask us to add it (FEEDBACK, prefilled "Please add: WORD").
// GRAVEYARD lists every entry; GRAVEYARD LEH shows one. The pure parts are ../nosuch.js.

import { esc, q, panel, metaNote } from './markets.js';
import { goal } from '../goal.js';
import { setPrefill } from './feedback.js';
import { findGrave, dayText, tombstoneLine, srcHost, graveLinks, ipoLinks, pickGraves, IPO_STAMP, FEEDBACK_PREFILL } from '../nosuch.js';

export const TITLE_YET = 'No such ticker. Yet.';
export const TITLE_GONE = 'No such ticker. Not anymore.';
export const HELP_LINE = `<p class="muted ns-help">Type <a class="code" href="${esc(q('HELP'))}" data-cmd="HELP">HELP</a> for every command.</p>`;

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

let graveyard = null;
export async function loadGraveyard(signal) {
  if (!graveyard) {
    graveyard = fetch('/api/graveyard', { signal, headers: { Accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error('Could not load the graveyard. Try again.'); return r.json(); })
      .then((d) => d.entries || [])
      .catch((e) => { graveyard = null; throw e; });
  }
  return graveyard;
}

// ---- Pieces --------------------------------------------------------------------------------

export function tombstoneHtml(e) {
  const lines = [
    `<span class="ns-rip">R.I.P.</span>`,
    `<span class="ns-tk">${esc(e.ticker)}</span>`,
    `<span class="ns-name">${esc(e.name)}</span>`,
    Number.isInteger(e.listed) ? `<span class="ns-hand">Listed ${esc(e.listed)}</span>` : '',
    `<span class="ns-hand">${esc(e.what)}</span>`,
    `<span class="ns-day">${esc(dayText(e.date))}</span>`,
  ].join('');
  return `<div class="ns-grave"><div class="ns-stone" role="img" aria-label="${esc(tombstoneLine(e))}">${lines}</div></div>`;
}

function sourcesHtml(e) {
  const links = e.src.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(srcHost(u))}</a>`).join(', ');
  return `<p class="muted ns-src">Source: ${links}. ${code('GRAVEYARD', 'See the graveyard')}.</p>`;
}

function shareRow(links, kind) {
  return `<div class="wi-share ns-share">
      <a class="wi-btn" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer" data-share="${kind}" data-via="x">SHARE ON X</a>
      <button type="button" class="wi-btn" data-copy="${esc(links.url)}" data-share="${kind}" data-via="link">COPY LINK</button>
    </div>`;
}

// A small live preview of the IPO IT certificate: the same paper, the word, the stamp.
// A link: clicking it is IPO IT.
export function ipoPreviewHtml(word) {
  const paper = '/img/whatif/certificate.webp';
  return `<a class="ns-mini" href="${esc(q(`IPO IT ${word}`))}" data-cmd="${esc(`IPO IT ${word}`)}" data-ipo aria-label="${esc(`IPO IT ${word}: make the listing certificate`)}">
      <img src="${paper}" width="1536" height="1024" alt="">
      <span class="ns-mini-big">$${esc(word)}</span><span class="ns-mini-stamp">${esc(IPO_STAMP)}</span>
    </a>`;
}

// THE GRAVEYARD: a row of small tombstones, each opening its GRAVEYARD entry.
export function yardHtml(list) {
  if (!list?.length) return '';
  return `<section class="ns-yard"><h3 class="hs-h">The graveyard</h3><div class="ns-yard-row">${list.map((e) => `<a class="ns-mini-stone" href="${esc(q(`GRAVEYARD ${e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${e.ticker}`)}" title="${esc(tombstoneLine(e))}" aria-label="${esc(tombstoneLine(e))}">${esc(e.ticker)}</a>`).join('')}</div></section>`;
}

// What goes under the "Did you mean" rows on the not-found screen. word: the one word
// typed (or null); info: noSuchInfo's answer; next: the key number for IPO IT; quote: a
// tombstone that beat a non-US quote links the quote ($LEH); yard: entries for THE
// GRAVEYARD row.
export function noSuchExtra(word, info, { ticker = null, next = 1, quote = false, yard = [] } = {}) {
  if (info?.grave) {
    const e = info.grave;
    const hint = quote ? `<p class="muted ns-quote">Quote: <a class="code dim" href="?c=${encodeURIComponent(`$${e.ticker}`)}" data-cmd="${esc(`$${e.ticker}`)}">$${esc(e.ticker)}</a></p>` : '';
    return `${tombstoneHtml(e)}${shareRow(graveLinks(e, origin()), 'grave')}${hint}${sourcesHtml(e)}`;
  }
  if (!word) return '';
  const w = esc(word);
  const canIpo = Boolean(ticker && info?.ipo);
  const ipo = canIpo
    ? `<p class="ns-ipo"><span>Nobody has listed <span class="ns-tag">$${w}</span>. Be the first.</span> <button type="button" class="wi-btn ns-ipo-btn" data-cmd="${esc(`IPO IT ${word}`)}" data-ipo${next <= 9 ? ` data-key="${next}"` : ''}>IPO IT</button></p>`
    : '';
  const ask = `<p class="ns-ask">Want it on Bloombroke? <a href="${esc(q('FEEDBACK'))}" data-cmd="FEEDBACK" data-prefill="${esc(FEEDBACK_PREFILL(word))}">Tell us.</a></p>`;
  return ipo + ask + (canIpo ? ipoPreviewHtml(word) : '') + yardHtml(yard);
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

// Clicks on the not-found screen: FEEDBACK gets its prefill, IPO IT and shares count.
// (These run before app.js's own click handler, which runs the command.)
export function wireNoSuch(el, word, info) {
  if (info?.grave) goal('graveyard_seen', null, { once: info.grave.ticker });
  else if (word) goal('notfound_seen', null, { once: word });
  const onClick = (e) => {
    const f = e.target.closest?.('[data-prefill]');
    if (f) setPrefill(f.dataset.prefill);
    if (e.target.closest?.('[data-ipo]')) goal('ipo_made', null, { once: word });
  };
  el.addEventListener('click', onClick);
  wireShare(el);
  return () => el.removeEventListener('click', onClick);
}

function wireShare(el, copy) {
  for (const b of el.querySelectorAll('[data-share]')) {
    b.addEventListener('click', async () => {
      if (b.dataset.share === 'ipo') goal('ipo_shared', { via: b.dataset.via });
      if (!b.dataset.copy) return;
      let ok = false;
      try {
        if (copy) ok = await copy(b.dataset.copy);
        else { await navigator.clipboard.writeText(b.dataset.copy); ok = true; }
      } catch { ok = false; }
      b.textContent = ok ? 'COPIED' : 'COPY FAILED';
      setTimeout(() => { if (b.isConnected) b.textContent = 'COPY LINK'; }, 1600);
    });
  }
}

// ---- GRAVEYARD -----------------------------------------------------------------------------

export function graveyardTable(list) {
  const rows = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return `<table class="grid-table ns-table">
    <thead><tr><th scope="col">Ticker</th><th scope="col">Name</th><th scope="col" class="ns-what">What happened</th><th scope="col" class="num">Date</th><th scope="col" class="ns-srccol">Source</th></tr></thead>
    <tbody>${rows.map((e) => `<tr>
      <td>${code(`GRAVEYARD ${e.ticker}`, e.ticker)}</td>
      <td class="ns-cell">${esc(e.name)}</td>
      <td class="ns-what ns-cell dim">${esc(e.what)}</td>
      <td class="num">${esc(dayText(e.date))}</td>
      <td class="ns-srccol"><a href="${esc(e.src[0])}" target="_blank" rel="noopener noreferrer">${esc(srcHost(e.src[0]))}</a></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderGraveyard(el, cmd, ctx) {
  const t = cmd.args?.ticker || null;
  el.innerHTML = panel('1', 'Graveyard', '<p class="loading">LOADING...</p>', { cls: 'panel-solo' });
  ctx.status('LOADING...');
  loadGraveyard(ctx.signal).then((list) => {
    if (!el.isConnected) return;
    const e = t ? findGrave(list, t) : null;
    if (e) {
      el.innerHTML = panel('1', `Graveyard: ${e.ticker}`, `${tombstoneHtml(e)}${shareRow(graveLinks(e, origin()), 'grave')}${sourcesHtml(e)}`, { cls: 'panel-solo' });
      wireShare(el, ctx.copy);
      goal('graveyard_seen', null, { once: e.ticker });
      ctx.status(`${e.ticker}: ${e.what.toUpperCase()} ${dayText(e.date).toUpperCase()}`);
      return;
    }
    const miss = t ? `<p class="notice">No ${esc(t)} in the graveyard.</p>` : '';
    el.innerHTML = panel('1', 'Graveyard', `${miss}${graveyardTable(list)}`, { cls: 'panel-solo', meta: metaNote(`${list.length} TICKERS THAT ARE GONE`) });
    ctx.status(`GRAVEYARD: ${list.length} FAMOUS TICKERS THAT ARE GONE`);
  }).catch((err) => {
    if (err.name === 'AbortError' || !el.isConnected) return;
    el.innerHTML = panel('1', 'Graveyard', `<p class="notice">${esc(err.message)}</p>`, { cls: 'panel-solo' });
    ctx.status('GRAVEYARD: NOT LOADED', 'warn');
  });
}

// ---- IPO IT --------------------------------------------------------------------------------

function plainPage(el, ctx) {
  el.innerHTML = panel('1', 'No such ticker', HELP_LINE, { cls: 'panel-solo' });
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
