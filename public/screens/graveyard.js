// GRAVEYARD: the cemetery (rows of stones by era, and the CAME BACK row), the stone pages,
// the table, F to pay respects (candles at the stone's foot), the click-to-load video, and
// ON THIS DAY on HOME. The pure parts are ../nosuch.js; the server is lib/graveyard.js and
// lib/og-nosuch.js.
//
//   GRAVEYARD          the cemetery: arrows move, Enter opens, T (or TABLE) lists
//   GRAVEYARD TABLE    every stone in a dense table, newest first
//   GRAVEYARD MOURNED  the table, most respects first
//   GRAVEYARD ZOMBIES  the cemetery, at its CAME BACK row
//   GRAVEYARD TODAY    today's anniversary stone
//   GRAVEYARD LEH      one stone: F pays respects

import { esc, q, panel, metaNote, fmtNum, fmtPct } from './markets.js';
import { goal } from '../goal.js';
import { nyToday } from '../ranges.js';
import {
  findGrave, dayText, tombstoneLine, srcHost, graveLinks, stoneYears, respectsText, onThisDayLine, ytEmbed,
  SECTIONS, sectionOf, siteCaption, timelinePoints, cliffOf,
} from '../nosuch.js';
import { cardPage, cardRows, raw } from '../kit.js';

const origin = () => (typeof location !== 'undefined' ? location.origin : 'https://bloombroke.com');
export const code = (c, label = c, extra = '') => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}"${extra}>${esc(label)}</a>`;
const ext = (href, label, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
const year = (d) => String(d || '').slice(0, 4);
const newest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

// ---- Data from the server -----------------------------------------------------------------

let graveyard = null;
// { entries, zombies, art: { stone, cemetery, yard } }.
export async function loadGraveyardAll(signal) {
  if (!graveyard) {
    graveyard = fetch('/api/graveyard', { signal, headers: { Accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error('Could not load the graveyard. Try again.'); return r.json(); })
      .then((d) => ({ entries: d.entries || [], zombies: d.zombies || [], art: d.art || {} }))
      .catch((e) => { graveyard = null; throw e; });
  }
  return graveyard;
}

let counts = null;
export async function loadRespects(signal) {
  try {
    const r = await fetch('/api/respects', { signal, headers: { Accept: 'application/json' } });
    counts = r.ok ? (await r.json()).counts || {} : counts || {};
  } catch { counts = counts || {}; }
  return counts;
}

// One respect for this stone: { n, counted } or null (offline, refused).
export async function payRespect(ticker) {
  try {
    const r = await fetch('/api/respect', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ticker }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (counts) counts[ticker] = d.n;
    return d;
  } catch {
    return null;
  }
}

// ---- Words -------------------------------------------------------------------------------

// How it died, in two or three plain words for a line: 'filed', 'seized', 'bought out'...
export function diedVerb(e) {
  const w = String(e?.what || '');
  if (/^Filed/.test(w)) return 'filed';
  if (/Seized|[Cc]losed by/.test(w)) return 'seized';
  if (/private/.test(w)) return 'went private';
  if (/[Ss]hut ?down|shutdown/.test(w)) return 'shut down';
  if (/Delisted/.test(w)) return 'delisted';
  if (/^Bought|sold/i.test(w)) return 'bought out';
  return 'gone';
}

// A name on one line: 'AMR Corporation (American Airlines)' -> 'American Airlines',
// 'Marvel Entertainment Group' -> 'Marvel'.
export function shortName(e) {
  const n = String(e?.name || '');
  const inner = /\(([^)]+)\)\s*$/.exec(n);
  if (inner) return inner[1];
  return n.replace(/ (Entertainment Group|Group|Corporation|Holdings)$/, '') || n;
}

// The words cut on a stone: its epitaph without a sentence that repeats the filing (the
// sub under the name says it once): '158 years. Filed 15 Sep 2008.' -> '158 years.'.
export function engraving(e) {
  return String(e?.epitaph || '').split(/(?<=\.)\s+/).filter((s) => s && !/^Filed\b/.test(s)).join(' ');
}

// Pressing F reveals the count, never before: 'You are the first', 'You and 12 others'.
export function revealText(n) {
  const v = Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;
  if (v <= 1) return 'You are the first';
  const others = v - 1;
  return `You and ${others.toLocaleString('en-US')} ${others === 1 ? 'other' : 'others'}`;
}

// The hover and focus label: how and when it died, and its respects only above zero.
export const tipText = (e, n = 0) => `${diedVerb(e)} ${year(e.date)}${n > 0 ? ` · ${respectsText(n)}` : ''}`;

// ---- Candles -----------------------------------------------------------------------------

// One small drawn candle per respect at the stone's foot, MAX_CANDLES at most (the count
// is words, after the press). None at zero: just the ground.
export const MAX_CANDLES = 12;
export function candlesFor(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(MAX_CANDLES, Math.floor(v)) : 0;
}
const INK = 'hsl(25, 40%, 11%)';
// fresh: the last candle was just lit (it rises in).
export function candlesHtml(n, { fresh = false } = {}) {
  const k = candlesFor(n);
  let out = '';
  for (let i = 0; i < k; i += 1) {
    const h = 15 + ((i * 7) % 5); // a little uneven, drawn by hand
    const t = 34 - h;
    const tilt = ((i * 37) % 7) - 3;
    out += `<svg class="gv-candle${fresh && i === k - 1 ? ' is-new' : ''}" viewBox="-1 0 14 34" aria-hidden="true"><g transform="rotate(${tilt} 6 34)">`
      + `<path class="gv-flame" d="M6 ${t - 11} C8.7 ${t - 7.4} 8.5 ${t - 4.2} 6 ${t - 2.4} C3.5 ${t - 4.2} 3.3 ${t - 7.4} 6 ${t - 11} Z" fill="hsl(45, 96%, 64%)" stroke="${INK}" stroke-width=".7"/>`
      + `<ellipse cx="6" cy="${t - 5}" rx="1.1" ry="2" fill="hsl(50, 100%, 90%)"/>`
      + `<path d="M6 ${t - 2.4} V${t}" stroke="${INK}" stroke-width=".9"/>`
      + `<path d="M3.1 ${t + 0.6} Q6 ${t - 0.6} 8.9 ${t + 0.6} V33.4 H3.1 Z" fill="hsl(45, 45%, 88%)" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"/>`
      + `<path d="M4.4 ${t + 3} V${31.5}" stroke="${INK}" stroke-opacity=".3" stroke-width=".6"/>`
      + '</g></svg>';
  }
  return out;
}

// The candles for n respects (a count loaded after the page drew). After a press the
// press's own count wins (a slower load does not take a candle away).
export function showRespects(el, n, { fresh = false, force = false } = {}) {
  if (!el || (el.dataset?.paid && !force)) return;
  const c = el.querySelector?.('[data-candles]');
  if (c) c.innerHTML = candlesHtml(n, { fresh });
}

// ---- The stone ---------------------------------------------------------------------------

// The one stone drawing: the art (stone.webp) or a pencil-grey stone, the words on its face.
// The full stone (a stone page, the share image's look): R.I.P. (a zombie: RETURNED), the
// ticker, the name, the years, the engraving, the company's doodle and the candles. small
// (the cemetery): the ticker only.
export function stoneHtml(e, { n = 0, small = false } = {}) {
  const art = e.art || {};
  const words = engraving(e);
  const face = small
    ? `<span class="gv-tk">${esc(e.ticker)}</span>`
    : `<span class="gv-rip">${e.zombie ? 'RETURNED' : 'R.I.P.'}</span><span class="gv-tk">${esc(e.ticker)}</span><span class="gv-name">${esc(e.name)}</span><span class="gv-years">${esc(stoneYears(e))}</span>${words ? `<span class="gv-epitaph">${esc(words)}</span>` : ''}`;
  return `<figure class="gv-stone${small ? ' is-small' : ''}${e.zombie ? ' is-zombie' : ''}${art.stone ? ' has-art' : ''}" role="img" aria-label="${esc(tombstoneLine(e))}">
      ${art.stone ? `<img class="gv-art" src="${esc(art.stone)}" width="560" height="778" alt="">` : ''}
      <div class="gv-face">${face}</div>
      ${art.doodle && !small ? `<img class="gv-doodle" src="${esc(art.doodle)}" width="384" height="384" alt="">` : ''}
      ${small ? '' : `<div class="gv-candles" data-candles>${candlesHtml(n)}</div>`}
    </figure>`;
}

// Every source behind the page (the event, its dates, the cause, the RIP WHATIF prices,
// the facts, the comeback), each once, behind one small SOURCES (N) that opens the list.
export function pageSources(e) {
  const all = [...e.src, ...(e.foundedSrc || []), ...(e.listedSrc || []), ...(e.anniversarySrc || []), ...(e.causeSrc || []),
    ...(e.peakLine ? e.peakSrc || [] : []), ...(e.back?.src || []), ...(e.keyFactsSrc || [])];
  return [...new Set(all.filter((u) => srcHost(u)))];
}

export function sourcesHtml(e, { linkSite = true } = {}) {
  const list = pageSources(e);
  const count = new Map();
  const items = list.map((u) => {
    const h = srcHost(u);
    const k = (count.get(h) || 0) + 1;
    count.set(h, k);
    return `<li>${ext(u, k > 1 ? `${h} ${k}` : h)}</li>`;
  }).join('');
  return `<div class="muted ns-src gv-links">${e.wayback && linkSite ? `${ext(e.wayback, 'LAST WEBSITE', 'gv-last')} · ` : ''}<details class="gv-sources"><summary>SOURCES (${list.length})</summary><ul>${items}</ul></details> · ${code('GRAVEYARD', 'See the graveyard')}</div>`;
}

export function shareRow(links, kind) {
  return `<div class="wi-share ns-share">
      <a class="wi-btn" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer" data-share="${kind}" data-via="x">SHARE ON X</a>
      <button type="button" class="wi-btn" data-copy="${esc(links.url)}" data-share="${kind}" data-via="link">COPY LINK</button>
    </div>`;
}

export function wireShare(el, copy) {
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

// RIP WHATIF: the sourced peak line, or nothing.
// Only with its sources (they are listed under SOURCES).
export function peakLineHtml(e) {
  const list = Array.isArray(e.peakSrc) ? e.peakSrc : e.peakSrc ? [e.peakSrc] : [];
  if (!e.peakLine || !list.length) return '';
  return `<p class="gv-whatif">${esc(e.peakLine)}</p>`;
}

// The video loads on a click only: nothing is asked of YouTube or Google before. A
// "Watch the video" link on the stone page puts the youtube-nocookie.com player under its
// line (wireVideo).
export function wireVideo(el) {
  for (const b of el.querySelectorAll('[data-yt]')) {
    b.addEventListener('click', () => {
      const src = ytEmbed(b.dataset.yt);
      if (!src) return;
      const f = document.createElement('iframe');
      f.className = 'gv-player';
      f.src = src;
      f.title = b.getAttribute('aria-label') || 'Video';
      f.allow = 'autoplay; encrypted-media; picture-in-picture';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      (b.closest('p') || b).after(f);
      b.setAttribute('aria-disabled', 'true');
    }, { once: true });
  }
}

// The last homepage as words: 'lehman.com in 2008' (the Internet Archive's capture).
export function siteLabel(wayback) {
  const m = /^(.+), [A-Z][a-z]{2} (\d{4}) · /.exec(siteCaption(wayback));
  return m ? `${m[1]} in ${m[2]}` : '';
}

// The cliff: the RIP WHATIF line as a small picture, $1,000 at the peak falling (to scale)
// to what it was worth. Nothing without the line.
export function cliffHtml(e) {
  const cliff = cliffOf(e);
  if (!cliff) return '';
  // The drop is drawn to scale: $1,000 at the top line, $0 at the bottom.
  const worth = Number(cliff.to.replace(/[$,]/g, ''));
  const end = Number.isFinite(worth) ? Math.max(6, Math.min(50, 14 + 36 * (1 - worth / 1000))) : 50;
  const mid = (14 + end) / 2;
  return `<figure class="gv-cliff${worth >= 1000 ? ' is-up' : ''}" title="${esc(e.peakLine)}" aria-label="${esc(e.peakLine)}">
      <svg viewBox="0 0 120 54" width="120" height="54" aria-hidden="true"><path d="M2 14 H58 L66 ${mid.toFixed(1)} L72 ${end.toFixed(1)} H118" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M2 14 H58 L66 ${mid.toFixed(1)} L72 ${end.toFixed(1)} H118 V54 H2 Z" fill="currentColor" opacity=".12"/></svg>
      <figcaption><span class="gv-cliff-a">${esc(cliff.from)}</span><span class="gv-cliff-b">${esc(cliff.to)}</span></figcaption>
    </figure>`;
}

// The timeline strip: only sourced dates, and the cliff (cliff: false leaves it out; the
// stone card's + Details has the strip only).
export function timelineHtml(e, { cliff = true } = {}) {
  const pts = timelinePoints(e);
  return `<div class="gv-tl"><ol>${pts.map((p) => `<li><span class="gv-tl-l">${esc(p.label)}</span><span class="gv-tl-d">${esc(p.when)}</span></li>`).join('')}</ol>${cliff ? cliffHtml(e) : ''}</div>`;
}

// ---- One stone as a card page ---------------------------------------------------------------

// kit.js cardPage, split: the words left, the stone (the one picture) right; a phone shows
// the stone first. For GRAVEYARD LEH and for a dead ticker typed on its own (NO SUCH
// TICKER, screens/nosuch.js). Above + Details: GRAVEYARD · LEH, the name, what happened
// and when, F PAY RESPECTS (the count only after the press), two facts at most, the share
// links, the short story, and one line to the video and the last homepage. + Details: the
// timeline, the cause, the RIP WHATIF line, the comeback, the video's title, the keys and
// every source.
const money = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Two facts at most, both from the data: the peak, and what $1,000 at the peak became.
export function stoneFacts(e) {
  const cliff = cliffOf(e);
  const worth = cliff ? Number(cliff.to.replace(/[$,]/g, '')) : NaN;
  return [
    e.peak?.price > 0 && e.peak.src?.length ? { label: 'Peak', value: money(e.peak.price) } : null,
    cliff ? { label: `$1,000 at peak, by ${cliff.by}`, value: cliff.to, cls: worth < 1000 ? 'down' : worth > 1000 ? 'up' : '' } : null,
  ].filter(Boolean).slice(0, 2);
}

// The short story: the sourced key facts, as one paragraph.
export const storyText = (e) => (Array.isArray(e.keyFacts) ? e.keyFacts.join(' ') : '');

// The line under the story: the video (a click loads it) and the last homepage (our copy,
// full size; else the archive's page).
export function moreLinks(e) {
  const out = [];
  if (ytEmbed(e.video?.id)) {
    const label = `Play: ${e.video.title}${e.video.channel ? ` (${e.video.channel})` : ''}`;
    out.push(`<button type="button" class="card-link gv-watch" data-yt="${esc(e.video.id)}" aria-label="${esc(label)}">Watch the video</button>`);
  }
  const site = siteLabel(e.wayback);
  if (site && e.art?.site) out.push(`<a class="card-link" href="${esc(e.art.site)}" target="_blank" rel="noopener">${esc(site)}</a>`);
  else if (site) out.push(`<a class="card-link" href="${esc(e.wayback)}" target="_blank" rel="noopener noreferrer">${esc(site)}</a>`);
  return out;
}

// The card's slots, so NO SUCH TICKER can put its own kicker and links in.
export function stoneSlots(e, n = 0) {
  const links = graveLinks(e, origin());
  const story = storyText(e);
  const more = moreLinks(e);
  const rows = [
    e.cause ? ['Cause', e.cause] : null,
    peakLineHtml(e) ? ['What if', e.peakLine] : null,
    e.zombie && e.back?.date ? ['Came back', `${dayText(e.back.date)}.`] : null,
    ytEmbed(e.video?.id) ? ['Video', `${e.video.title}${e.video.channel ? ` (${e.video.channel})` : ''}`] : null,
    ['Keys', 'Esc, then F pays respects.'],
    ['Sources', raw(sourcesHtml(e, { linkSite: !e.art?.site }))],
  ];
  const facts = stoneFacts(e);
  return {
    wide: true, split: true, cls: 'gv-card', label: `Graveyard: ${e.name}`,
    art: raw(`<div class="gv-card-stone">${stoneHtml(e, { n })}</div>`),
    kicker: `Graveyard · ${e.ticker}`,
    hero: e.name, heroSize: 44,
    sub: `${e.what} ${dayText(e.date)}.`,
    act: raw(`<button type="button" class="btn card-btn btn-solid gv-f" data-respect="${esc(e.ticker)}"><kbd>F</kbd> PAY RESPECTS</button>`),
    // Nothing before the press: then "You and 12 others" (wireRespects).
    note: raw('<span class="gv-count" data-reveal hidden></span>'),
    facts: facts.length ? facts : null,
    media: raw('<div class="gv-body">'
      + '<p class="card-links gv-share">'
      + `<a class="card-link" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer" data-share="grave" data-via="x">SHARE ON X</a> `
      + `<button type="button" class="card-link" data-copy="${esc(links.url)}" data-share="grave" data-via="link">COPY LINK</button></p>`
      + (story ? `<p class="gv-story">${esc(story)}</p>` : '')
      + (more.length ? `<p class="gv-more">${more.join(' <span class="gv-dot" aria-hidden="true">·</span> ')}</p>` : '')
      + '</div>'),
    links: [],
    details: raw(`${timelineHtml(e, { cliff: false })}${cardRows(rows)}`),
  };
}

export function stonePageHtml(e, n = 0) {
  return cardPage(stoneSlots(e, n));
}

// A scene (a stone page, the cemetery, the table) takes its keys (F, T, arrows, Enter) only
// while the command bar does NOT have the focus: typing F, FX, T or TSLA, and arrow-key
// history, always go to the bar. Esc in an empty bar moves the focus to the scene (a second
// Esc goes back a screen as usual), and so does a click or tap on the scene. onKey(ev)
// returns true when it used the key. Returns a cleanup.
export function sceneKeys(scene, onKey, { doc = globalThis.document } = {}) {
  scene.tabIndex = -1;
  scene.dataset.ownFocus = '';
  scene.classList.add('gv-scene');
  const handler = (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const t = ev.target;
    const bar = doc.getElementById?.('cmd');
    if (t === bar || t?.id === 'cmd') {
      const listOpen = doc.getElementById?.('suggest') && !doc.getElementById('suggest').hidden;
      if (ev.key === 'Escape' && !t.value && !listOpen && !ev.defaultPrevented && scene.isConnected !== false) {
        ev.preventDefault();
        scene.focus?.({ preventScroll: true });
      }
      return;
    }
    if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (onKey(ev) === true) { ev.preventDefault(); ev.stopPropagation(); }
  };
  const focusIt = (ev) => { if (!ev.target?.closest?.('a, button, summary, input, iframe')) scene.focus?.({ preventScroll: true }); };
  doc.addEventListener('keydown', handler, true);
  scene.addEventListener?.('pointerdown', focusIt);
  return () => { doc.removeEventListener('keydown', handler, true); scene.removeEventListener?.('pointerdown', focusIt); };
}

// The status line after a respect: paid, already paid today, or the check is full.
export function respectStatus(ticker, d) {
  if (!d) return ['RESPECTS NOT SAVED. TRY AGAIN', 'warn'];
  if (d.busy) return ['RESPECTS ARE BUSY, TRY LATER', 'warn'];
  return [d.counted ? `${ticker}: RESPECTS PAID` : `${ticker}: ALREADY PAID TODAY`, ''];
}

// F (with the focus on the page, see sceneKeys) or the button pays respects to the stone:
// a candle is lit and the count shows ("You and 12 others").
export function wireRespects(el, ticker, { status = () => {} } = {}) {
  const pay = async () => {
    const d = await payRespect(ticker);
    if (!el.isConnected) return;
    status(...respectStatus(ticker, d));
    if (!d || d.busy) return;
    el.dataset.paid = '1';
    const c = el.querySelector('[data-reveal]');
    if (c) { c.textContent = revealText(d.n); c.hidden = false; }
    showRespects(el, d.n, { fresh: Boolean(d.counted), force: true });
    el.querySelector('.gv-stone')?.classList.add('is-mourned');
  };
  const onClick = (ev) => { if (ev.target.closest?.('[data-respect]')) pay(); };
  el.addEventListener('click', onClick);
  const stop = sceneKeys(el, (ev) => {
    if ((ev.key !== 'f' && ev.key !== 'F') || ev.repeat) return false;
    pay();
    return true;
  });
  return () => { el.removeEventListener('click', onClick); stop(); };
}

// ---- The cemetery -----------------------------------------------------------------------------

// A band of sky cropped from the painting, with one stone to open (LATEST, or ON THIS DAY
// when a death's month and day is today's in New York), then the rows by era, front terrace
// first, and the CAME BACK row (the companies that died and came back, with their live
// price where they trade today). The rows wrap; the panel ends after the last one.
export const ROWS = [...['RECENT', 'CRISIS', 'DOTCOM', 'BOUGHT'].map((id) => SECTIONS.find((x) => x.id === id)), { id: 'BACK', label: 'CAME BACK' }];
export const HINT = 'arrows move · Enter opens · TABLE lists';

// The rows with their stones, newest first in each; empty rows left out.
export function rowsOf(entries = [], zombies = []) {
  return ROWS.map((r) => ({ ...r, stones: (r.id === 'BACK' ? [...zombies] : entries.filter((e) => sectionOf(e) === r.id)).sort(newest) }))
    .filter((r) => r.stones.length);
}

// The stone the sky band opens: ON THIS DAY only when a death's (or filing's) month and day
// is today's in New York, in an earlier year; else LATEST, the most recent death.
export function heroPick(list = [], today = '') {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : '';
  const on = day ? list.filter((e) => { const a = e.anniversary || e.date; return a.slice(5) === day.slice(5) && a.slice(0, 4) < day.slice(0, 4); }) : [];
  if (on.length) return { kicker: 'On this day', e: [...on].sort(newest)[0] };
  const latest = [...list].sort(newest)[0];
  return latest ? { kicker: 'Latest', e: latest } : null;
}
export const heroLine = (e) => `${e.name} · ${e.ticker} · ${diedVerb(e)} ${year(e.date)}`;

function skyHtml(hero, bg) {
  const e = hero?.e;
  return `<div class="gv-sky">
      ${bg ? `<img class="gv-sky-art" src="${esc(bg)}" width="1536" height="1024" alt="">` : ''}
      ${e ? `<a class="gv-hero" href="${esc(q(`GRAVEYARD ${e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${e.ticker}`)}" data-hero>
        <span class="tag gv-kicker">${esc(hero.kicker)}</span>
        <span class="gv-hero-line"><span class="gv-hero-name">${esc(e.name)}</span> · ${esc(e.ticker)} · ${esc(`${diedVerb(e)} ${year(e.date)}`)} <kbd>Enter</kbd></span>
      </a>` : ''}
    </div>`;
}

// The live price where a company that came back trades today: '$79.84 -1.01%' ('AAL
// $12.30 +0.4%' when that is another ticker). Nothing without a price.
export function liveHtml(e, quote) {
  if (!e?.tradesAs || !quote || !Number.isFinite(quote.last)) return '';
  const dir = quote.changePct > 0 ? 'up' : quote.changePct < 0 ? 'down' : '';
  const pct = Number.isFinite(quote.changePct) ? ` <span class="num${dir ? ` ${dir}` : ''}">${esc(fmtPct(quote.changePct))}</span>` : '';
  return `${e.tradesAs !== e.ticker ? `${esc(e.tradesAs)} ` : ''}<span class="num">$${esc(fmtNum(quote.last))}</span>${pct}`;
}

// One stone in a row: the stone with its ticker, the name under it, the hover label; a
// company that came back: a one-line name, 'died 2009 · back 2010' and its live price.
export function plotHtml(e, i, stone, { bought = false, n = 0 } = {}) {
  const c = `GRAVEYARD ${e.ticker}`;
  const back = e.zombie && e.back?.date;
  return `<a class="gv-plot${bought ? ' is-bought' : ''}${back ? ' is-back' : ''}" href="${esc(q(c))}" data-cmd="${esc(c)}" data-i="${i}" aria-label="${esc(tombstoneLine(e))}">`
    + stoneHtml({ ...e, art: { stone } }, { small: true })
    + `<span class="gv-pname">${esc(back ? shortName(e) : e.name)}</span>`
    + (back ? `<span class="gv-back">died ${year(e.date)} · back ${year(e.back.date)}</span>${e.tradesAs ? `<span class="gv-live" data-live="${esc(e.tradesAs)}"></span>` : ''}` : '')
    + `<span class="gv-tip" data-tip>${esc(tipText(e, n))}</span></a>`;
}

// One row: its label (a tiny key on BOUGHT OUT: the pale stones were sold, not bankrupt),
// the count, and its stones. from: the first stone's number.
export function rowHtml(row, stone, { from = 0, n = {} } = {}) {
  const key = row.id === 'BOUGHT' ? '<span class="gv-key"><span class="gv-swatch" aria-hidden="true"></span>pale stone: sold, not bankrupt</span>' : '';
  return `<section class="gv-row" data-row="${esc(row.id)}" id="gv-row-${esc(row.id)}">
      <h3 class="gv-row-label"><span class="gv-row-name">${esc(row.label)}</span> <span class="gv-row-n num">${row.stones.length}</span>${key}</h3>
      <div class="gv-row-stones">${row.stones.map((e, k) => plotHtml(e, from + k, stone, { bought: row.id === 'BOUGHT', n: n[e.ticker] || 0 })).join('')}</div>
    </section>`;
}

export function cemeteryHtml(rows, art, hero, n = {}) {
  let from = 0;
  const body = rows.map((r) => { const h = rowHtml(r, art.stone, { from, n }); from += r.stones.length; return h; }).join('');
  return `<div class="gv-yard">${skyHtml(hero, art.yard || art.cemetery)}<div class="gv-rows">${body}</div></div>`;
}

// The next stone for an arrow key, from the stones' places on screen ({ x, y }: the top
// left, in px): left and right along the rows, up and down to the nearest stone on the line
// above or below. -1: no stones.
export function stepGrid(pts, i, key) {
  if (!pts.length) return -1;
  if (i < 0 || i >= pts.length) return 0;
  if (key === 'ArrowLeft') return Math.max(0, i - 1);
  if (key === 'ArrowRight') return Math.min(pts.length - 1, i + 1);
  const cur = pts[i];
  const down = key === 'ArrowDown';
  const next = pts.map((p, k) => ({ p, k })).filter(({ p }) => (down ? p.y > cur.y + 4 : p.y < cur.y - 4));
  if (!next.length) return i;
  const line = down ? Math.min(...next.map(({ p }) => p.y)) : Math.max(...next.map(({ p }) => p.y));
  return next.filter(({ p }) => Math.abs(p.y - line) <= 4).sort((a, b) => Math.abs(a.p.x - cur.x) - Math.abs(b.p.x - cur.x))[0].k;
}

// The CAME BACK row's live prices: one /api/quotes call; nothing shows when it fails.
export async function loadLive(el, list, { signal, fetchImpl = globalThis.fetch } = {}) {
  const syms = [...new Set(list.map((e) => e.tradesAs).filter(Boolean))];
  if (!syms.length) return {};
  let byId = {};
  try {
    const r = await fetchImpl(`/api/quotes?s=${syms.map(encodeURIComponent).join(',')}`, { signal, headers: { Accept: 'application/json' } });
    const d = r.ok ? await r.json() : null;
    for (const qt of d?.quotes || []) if (qt?.ticker) byId[qt.ticker] = qt;
  } catch { byId = {}; }
  if (!el?.isConnected) return byId;
  for (const e of list) {
    const slot = e.tradesAs && el.querySelector(`[data-live="${e.tradesAs}"]`);
    if (slot) slot.innerHTML = liveHtml(e, byId[e.tradesAs]);
  }
  return byId;
}

function renderCemetery(el, data, ctx, { at = '' } = {}) {
  const n = counts || {};
  const rows = rowsOf(data.entries, data.zombies);
  const all = rows.flatMap((r) => r.stones);
  const hero = heroPick([...data.entries, ...data.zombies], nyToday());
  el.innerHTML = panel('1', 'Graveyard', cemeteryHtml(rows, data.art, hero, n), {
    cls: 'panel-solo gv-panel', meta: `${metaNote(`${all.length} STONES`)} · ${code('GRAVEYARD TABLE', 'TABLE')}`,
  });
  const plots = [...el.querySelectorAll('.gv-plot')];
  let on = -1;
  const pick = (i) => {
    if (i < 0 || i >= plots.length) return;
    plots[on]?.classList.remove('is-on');
    on = i;
    plots[on].classList.add('is-on');
    plots[on].scrollIntoView?.({ block: 'nearest' });
  };
  const places = () => plots.map((p) => { const r = p.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  loadRespects(ctx.signal).then((fresh) => {
    if (!el.isConnected) return;
    plots.forEach((p, i) => { const t = p.querySelector('[data-tip]'); if (t) t.textContent = tipText(all[i], fresh[all[i].ticker] || 0); });
  });
  loadLive(el, data.zombies, { signal: ctx.signal });
  ctx.onCleanup(sceneKeys(el, (ev) => {
    if (ev.key.startsWith('Arrow')) {
      // The first arrow picks the stone the sky band names; then they walk.
      if (on < 0) pick(Math.max(0, all.indexOf(hero?.e)));
      else pick(stepGrid(places(), on, ev.key));
      return true;
    }
    if (ev.key === 'Enter' && !ev.target.closest?.('a, button')) {
      const e = on >= 0 ? all[on] : hero?.e;
      if (!e) return false;
      ctx.run(`GRAVEYARD ${e.ticker}`);
      return true;
    }
    if (ev.key === 't' || ev.key === 'T') { ctx.run('GRAVEYARD TABLE'); return true; }
    return false;
  }));
  // GRAVEYARD ZOMBIES: the CAME BACK row, its first stone picked.
  if (at === 'BACK') {
    const row = el.querySelector('#gv-row-BACK');
    if (row) {
      row.scrollIntoView?.({ block: 'start' });
      const first = row.querySelector('.gv-plot');
      if (first) pick(plots.indexOf(first));
    }
  }
  ctx.status(HINT);
}

// ---- The table -------------------------------------------------------------------------------

// grouped: one block per cemetery section, in the scene's order.
export function graveyardTable(list, n = {}, { mourned = false, grouped = false } = {}) {
  const order = mourned
    ? (a, b) => (n[b.ticker] || 0) - (n[a.ticker] || 0) || (a.date < b.date ? 1 : -1)
    : (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const row = (e) => `<tr>
      <td>${code(`GRAVEYARD ${e.ticker}`, e.ticker)}</td>
      <td class="ns-cell">${esc(e.name)}</td>
      <td class="ns-what ns-cell dim">${esc(e.what)}</td>
      <td class="num">${esc(dayText(e.date))}</td>
      <td class="num ns-what">${esc((n[e.ticker] || 0).toLocaleString('en-US'))}</td>
      <td class="ns-srccol">${ext(e.src[0], srcHost(e.src[0]))}</td>
    </tr>`;
  const body = grouped
    ? [...SECTIONS].reverse().map((x) => { const r = list.filter((e) => sectionOf(e) === x.id).sort(order); return r.length ? `<tr class="gv-sec"><th scope="rowgroup" colspan="6">${esc(x.label)}</th></tr>${r.map(row).join('')}` : ''; }).join('')
    : [...list].sort(order).map(row).join('');
  return `<table class="grid-table ns-table">
    <thead><tr><th scope="col">Ticker</th><th scope="col">Name</th><th scope="col" class="ns-what">What happened</th><th scope="col" class="num">Date</th><th scope="col" class="num ns-what">Respects</th><th scope="col" class="ns-srccol">Source</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderTable(el, data, ctx, { mourned = false, miss = '', grouped = false } = {}) {
  const draw = (n) => {
    const sort = mourned ? `${code('GRAVEYARD TABLE', 'NEWEST')} · MOST MOURNED` : `NEWEST · ${code('GRAVEYARD MOURNED', 'MOST MOURNED')}`;
    el.innerHTML = panel('1', 'Graveyard', `${miss}${graveyardTable(data.entries, n, { mourned, grouped })}`, { cls: 'panel-solo', meta: `${sort} · ${code('GRAVEYARD', 'CEMETERY')}` });
  };
  draw(counts || {});
  loadRespects(ctx.signal).then((n) => { if (el.isConnected) draw(n); });
  ctx.onCleanup(sceneKeys(el, (ev) => {
    if (ev.key !== 't' && ev.key !== 'T') return false;
    ctx.run('GRAVEYARD');
    return true;
  }));
  ctx.status(`GRAVEYARD: ${data.entries.length} FAMOUS TICKERS THAT ARE GONE`);
}

// ---- One stone ---------------------------------------------------------------------------------

function renderStone(el, e, ctx) {
  el.innerHTML = stonePageHtml(e, counts?.[e.ticker] || 0);
  wireShare(el, ctx.copy);
  wireVideo(el);
  loadRespects(ctx.signal).then((n) => { if (el.isConnected) showRespects(el, n[e.ticker] || 0); });
  ctx.onCleanup(wireRespects(el, e.ticker, { status: ctx.status }));
  goal('graveyard_seen', null, { once: e.ticker });
  ctx.status('F pays respects · Esc back');
}

export function renderGraveyard(el, cmd, ctx) {
  const t = cmd.args?.ticker || null;
  const view = cmd.args?.view || null;
  el.innerHTML = panel('1', 'Graveyard', '<p class="loading">LOADING...</p>', { cls: 'panel-solo' });
  ctx.status('LOADING...');
  loadGraveyardAll(ctx.signal).then(async (data) => {
    if (!el.isConnected) return;
    if (view === 'TODAY') {
      let items = [];
      try { items = (await (await fetch('/api/onthisday', { signal: ctx.signal })).json()).items || []; } catch { items = []; }
      if (!el.isConnected) return;
      if (items.length === 1) { renderStone(el, items[0], ctx); return; }
      if (items.length > 1) {
        const row = { id: 'TODAY', label: 'On this day', stones: items };
        el.innerHTML = panel('1', 'Graveyard: on this day', `<div class="gv-yard"><div class="gv-rows">${rowHtml(row, data.art.stone)}</div></div>`, { cls: 'panel-solo gv-panel', meta: metaNote(`${items.length} ON THIS DAY`) });
        ctx.status(`GRAVEYARD: ${items.length} ON THIS DAY`);
        return;
      }
      el.innerHTML = panel('1', 'Graveyard: on this day', `<p class="notice">No anniversary today.</p><p class="muted">${code('GRAVEYARD', 'See the graveyard')}.</p>`, { cls: 'panel-solo gv-panel' });
      ctx.status('GRAVEYARD: NO ANNIVERSARY TODAY');
      return;
    }
    const e = t ? findGrave(data.entries, t) || findGrave(data.zombies, t) : null;
    if (e) { renderStone(el, e, ctx); return; }
    const miss = t ? `<p class="notice">No ${esc(t)} in the graveyard.</p>` : '';
    if (view === 'TABLE' || view === 'MOURNED' || t) { renderTable(el, data, ctx, { mourned: view === 'MOURNED', miss }); return; }
    renderCemetery(el, data, ctx, { at: view === 'ZOMBIES' ? 'BACK' : '' });
  }).catch((err) => {
    if (err.name === 'AbortError' || !el.isConnected) return;
    el.innerHTML = panel('1', 'Graveyard', `<p class="notice">${esc(err.message)}</p>`, { cls: 'panel-solo' });
    ctx.status('GRAVEYARD: NOT LOADED', 'warn');
  });
}

// ---- ON THIS DAY on HOME ---------------------------------------------------------------------

// One quiet line in the MARKETS title strip on HOME, when a stone died on today's date.
export function onThisDayHtml(e) {
  return `<a class="gv-otd" href="${esc(q(`GRAVEYARD ${e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${e.ticker}`)}" title="${esc(tombstoneLine(e))}">${esc(onThisDayLine(e))}</a>`;
}

// Several on one day: the line shows each in turn, every ROTATE_MS.
export const ROTATE_MS = 6000;
export async function mountOnThisDay(head, { signal, every = (fn, ms) => setInterval(fn, ms) } = {}) {
  if (!head) return;
  try {
    const r = await fetch('/api/onthisday', { signal, headers: { Accept: 'application/json' } });
    const d = r.ok ? await r.json() : null;
    const items = d?.items || [];
    if (!items.length || !head.isConnected || head.querySelector('.gv-otd')) return;
    head.querySelector('.panel-meta')?.insertAdjacentHTML('beforebegin', onThisDayHtml(items[0]));
    if (items.length < 2) return;
    let i = 0;
    const id = every(() => {
      const a = head.querySelector('.gv-otd');
      if (!a || !head.isConnected) { clearInterval(id); return; }
      i = (i + 1) % items.length;
      a.outerHTML = onThisDayHtml(items[i]);
    }, ROTATE_MS);
  } catch { /* no line */ }
}
