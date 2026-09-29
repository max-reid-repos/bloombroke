// GRAVEYARD v2: the walkable cemetery, the stone pages, the table, ZOMBIES, F to pay
// respects, the click-to-load video, and ON THIS DAY on HOME. The pure parts are
// ../nosuch.js; the server is lib/graveyard.js and lib/og-nosuch.js.
//
//   GRAVEYARD          the cemetery (a phone gets the table): arrows walk, Enter opens,
//                      T switches to the table
//   GRAVEYARD TABLE    every stone in a dense table, newest first
//   GRAVEYARD MOURNED  the table, most respects first
//   GRAVEYARD ZOMBIES  companies that died and came back
//   GRAVEYARD TODAY    today's anniversary stone
//   GRAVEYARD LEH      one stone: F pays respects

import { esc, q, panel, metaNote } from './markets.js';
import { goal } from '../goal.js';
import {
  findGrave, dayText, tombstoneLine, srcHost, graveLinks, stoneYears, flowersFor, respectsText, onThisDayLine, ytEmbed,
  SECTIONS, sectionOf, siteCaption, timelinePoints, cliffOf, eventLabel,
} from '../nosuch.js';
import { cardPage, cardRows, raw } from '../kit.js';

const origin = () => (typeof location !== 'undefined' ? location.origin : 'https://bloombroke.com');
export const code = (c, label = c, extra = '') => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}"${extra}>${esc(label)}</a>`;
const ext = (href, label, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;

// ---- Data from the server -----------------------------------------------------------------

let graveyard = null;
// { entries, zombies, art: { stone, cemetery } }.
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

// ---- Pieces ------------------------------------------------------------------------------

const PETALS = ['#C98A9A', '#9C8FC4', '#EDE3C8', '#8FB8D8', '#B7C99A'];
// n small drawn flowers (inline SVG, no styles), for the foot of a stone.
export function flowersHtml(n) {
  const k = flowersFor(n);
  let out = '';
  for (let i = 0; i < k; i += 1) {
    const c = PETALS[i % PETALS.length];
    const tilt = ((i * 37) % 21) - 10;
    out += `<svg class="gv-flower" viewBox="0 0 20 30" width="16" height="24" aria-hidden="true"><g transform="rotate(${tilt} 10 30)"><path d="M10 30 C10 22 9 16 10 11" stroke="#6F8F5E" stroke-width="1.6" fill="none"/><circle cx="10" cy="6" r="3.2" fill="${c}" stroke="#2A1A10" stroke-width=".7"/><circle cx="6.6" cy="9" r="3.2" fill="${c}" stroke="#2A1A10" stroke-width=".7"/><circle cx="13.4" cy="9" r="3.2" fill="${c}" stroke="#2A1A10" stroke-width=".7"/><circle cx="10" cy="8.4" r="1.6" fill="#E9D59A"/></g></svg>`;
  }
  return out;
}

// The stone: art (when drawn) or a pencil-grey stone, the words on its face, the company's
// doodle at its foot and the flowers. small: the cemetery's and ZOMBIES' size.
export function stoneHtml(e, { n = 0, small = false } = {}) {
  const art = e.art || {};
  const face = small
    ? `${e.zombie ? '<span class="gv-rip">RETURNED</span>' : ''}<span class="gv-tk">${esc(e.ticker)}</span>`
    : `<span class="gv-rip">${e.zombie ? 'RETURNED' : 'R.I.P.'}</span><span class="gv-tk">${esc(e.ticker)}</span><span class="gv-name">${esc(e.name)}</span><span class="gv-years">${esc(stoneYears(e))}</span>${e.epitaph ? `<span class="gv-epitaph">${esc(e.epitaph)}</span>` : ''}`;
  return `<figure class="gv-stone${small ? ' is-small' : ''}${e.zombie ? ' is-zombie' : ''}${art.stone ? ' has-art' : ''}" role="img" aria-label="${esc(tombstoneLine(e))}">
      ${art.stone ? `<img class="gv-art" src="${esc(art.stone)}" width="560" height="778" alt="">` : ''}
      <div class="gv-face">${face}</div>
      ${art.doodle && !small ? `<img class="gv-doodle" src="${esc(art.doodle)}" width="384" height="384" alt="">` : ''}
      ${small ? '' : `<div class="gv-flowers" data-flowers>${flowersHtml(n)}</div>`}
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

// The video: our own art (the company's doodle) and a play mark, with the channel. Nothing
// is asked of YouTube or Google until the click; the click swaps in the
// youtube-nocookie.com player (wireVideo).
// channel: false leaves the channel off the label (the stone card lists it in + Details).
export function videoHtml(e, { channel = true } = {}) {
  if (!ytEmbed(e.video?.id)) return '';
  const label = `Play: ${e.video.title}${e.video.channel ? ` (${e.video.channel})` : ''}`;
  const doodle = e.art?.doodle;
  return `<button type="button" class="gv-video" data-yt="${esc(e.video.id)}" aria-label="${esc(label)}" title="${esc(label)}">
      ${doodle ? `<img src="${esc(doodle)}" width="384" height="384" alt="">` : ''}<span class="gv-play" aria-hidden="true"></span>
      <span class="gv-vlabel">PLAY VIDEO${channel && e.video.channel ? ` · ${esc(e.video.channel)}` : ''}</span>
    </button>`;
}

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
      b.replaceWith(f);
    }, { once: true });
  }
}

// LAST WEBSITE as a picture: the Internet Archive's copy of the homepage near the end, in
// an old monitor, a link to the snapshot. Without a capture: nothing here (the Sources
// line keeps the LAST WEBSITE text link).
export function siteHtml(e) {
  if (!e.wayback || !e.art?.site) return '';
  const cap = siteCaption(e.wayback);
  return `<a class="gv-site" href="${esc(e.wayback)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`${cap}: the last website`)}">
      <span class="gv-screen"><img src="${esc(e.art.site)}" width="800" height="500" alt="" loading="lazy"></span>
      <span class="gv-sitecap">${esc(cap)}</span>
    </a>`;
}

// The timeline strip: only sourced dates, and the cliff for the RIP WHATIF line.
export function timelineHtml(e) {
  const pts = timelinePoints(e);
  const cliff = cliffOf(e);
  // The drop is drawn to scale: $1,000 at the top line, $0 at the bottom.
  const worth = cliff ? Number(cliff.to.replace(/[$,]/g, '')) : NaN;
  const end = Number.isFinite(worth) ? Math.max(6, Math.min(50, 14 + 36 * (1 - worth / 1000))) : 50;
  const mid = (14 + end) / 2;
  const svg = cliff ? `<figure class="gv-cliff${worth >= 1000 ? ' is-up' : ''}" title="${esc(e.peakLine)}" aria-label="${esc(e.peakLine)}">
      <svg viewBox="0 0 120 54" width="120" height="54" aria-hidden="true"><path d="M2 14 H58 L66 ${mid.toFixed(1)} L72 ${end.toFixed(1)} H118" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M2 14 H58 L66 ${mid.toFixed(1)} L72 ${end.toFixed(1)} H118 V54 H2 Z" fill="currentColor" opacity=".12"/></svg>
      <figcaption><span class="gv-cliff-a">${esc(cliff.from)}</span><span class="gv-cliff-b">${esc(cliff.to)}</span></figcaption>
    </figure>` : '';
  return `<div class="gv-tl"><ol>${pts.map((p) => `<li><span class="gv-tl-l">${esc(p.label)}</span><span class="gv-tl-d">${esc(p.when)}</span></li>`).join('')}</ol>${svg}</div>`;
}

// One stone as a card page (kit.js cardPage), for GRAVEYARD LEH and for a dead ticker
// typed on its own (NO SUCH TICKER, screens/nosuch.js). Above + Details: the ticker, what
// happened and when, F PAY RESPECTS and the count, the facts (founded or listed, the year
// it died, the peak, what $1,000 at the peak became), the stone, the video and the last
// website (the art, never cropped), and the share links. + Details: the timeline and its
// cliff, the name, the cause, the RIP WHATIF line, the comeback, the video's title, the
// keys, every source.
const money = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function stoneFacts(e) {
  const year = (d) => String(d || '').slice(0, 4);
  const cliff = cliffOf(e);
  const worth = cliff ? Number(cliff.to.replace(/[$,]/g, '')) : NaN;
  const pct = Number.isFinite(worth) ? Math.round((worth / 1000 - 1) * 100) : null;
  return [
    Number.isInteger(e.founded) ? { label: 'Founded', value: String(e.founded) } : Number.isInteger(e.listed) ? { label: 'Listed', value: String(e.listed) } : null,
    { label: eventLabel(e.what), value: year(e.date) },
    e.zombie && e.back?.date ? { label: 'Returned', value: year(e.back.date) } : null,
    e.peak?.price > 0 && e.peak.src?.length ? { label: 'Peak', value: money(e.peak.price) } : null,
    // What $1,000 at the peak became: a loss, or a gain for a company bought out above it.
    pct !== null ? { label: pct > 0 ? 'Gain' : 'Loss', value: `${Math.abs(pct)}%`, cls: pct < 0 ? 'down' : pct > 0 ? 'up' : '' } : null,
  ].filter(Boolean);
}

// The card's slots, so NO SUCH TICKER can put its own kicker and links in.
export function stoneSlots(e, n = 0) {
  const video = videoHtml(e, { channel: false });
  const site = siteHtml(e);
  const links = graveLinks(e, origin());
  const rows = [
    ['Name', e.name],
    e.cause ? ['Cause', e.cause] : null,
    peakLineHtml(e) ? ['What if', e.peakLine] : null,
    e.zombie && e.back?.date ? ['Came back', `${dayText(e.back.date)}.`] : null,
    video ? ['Video', `${e.video.title}${e.video.channel ? ` (${e.video.channel})` : ''}`] : null,
    ['Keys', 'Esc, then F pays respects.'],
    ['Sources', raw(sourcesHtml(e, { linkSite: !e.art?.site }))],
  ];
  return {
    wide: true, cls: 'gv-card', label: `Graveyard: ${e.ticker}`,
    kicker: 'Graveyard',
    hero: e.ticker, heroSize: 60,
    // The name is on the stone (and in + Details); the words say what happened.
    sub: `${e.what} ${dayText(e.date)}.`,
    act: raw(`<button type="button" class="btn card-btn btn-solid gv-f" data-respect="${esc(e.ticker)}"><kbd>F</kbd> PAY RESPECTS</button>`),
    note: raw(`<span class="gv-count num" data-count>${esc(respectsText(n))}</span>`),
    facts: stoneFacts(e),
    media: raw(`<div class="gv-card-media${video ? ' has-video' : ''}${site ? ' has-site' : ''}">`
      + `<div class="gv-card-stone">${stoneHtml(e, { n })}</div>`
      + (video ? `<div class="gv-card-video">${video}</div>` : '')
      + (site ? `<div class="gv-card-site">${site}</div>` : '')
      + '</div>'),
    links: [
      `<a class="card-link" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer" data-share="grave" data-via="x">SHARE ON X</a>`,
      `<button type="button" class="card-link" data-copy="${esc(links.url)}" data-share="grave" data-via="link">COPY LINK</button>`,
    ],
    details: raw(`${timelineHtml(e)}${cardRows(rows)}`),
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

// F (with the focus on the page, see sceneKeys) or the button pays respects to the stone.
export function wireRespects(el, ticker, { status = () => {} } = {}) {
  const pay = async () => {
    const d = await payRespect(ticker);
    if (!el.isConnected) return;
    status(...respectStatus(ticker, d));
    if (!d || d.busy) return;
    const c = el.querySelector('[data-count]');
    if (c) c.textContent = respectsText(d.n);
    const f = el.querySelector('[data-flowers]');
    if (f) f.innerHTML = flowersHtml(d.n);
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

// GRAVEYARD v3: the stones stand on the empty cemetery's terraces, one section each, in a
// gentle perspective (the back terrace a little smaller and higher, the front one larger
// and lower), and the bought-out ones by their signpost on the side plot. Everything is
// placed in % of the painting (1536x1024, the stage), which covers the scene and is
// cropped to the terraces (stageFor). An area runs x0..x1 along its path with the stones'
// feet at y, or lists its own slots; sign: the centre of its wooden signpost's board.
// wrap: a row that would have to shrink its stones below scale goes into two staggered
// lines on its terrace instead, the second one from wrap.x0 (or past the side plot's last
// stone) with its feet at wrap.y. The side plot's stones past
// its slots carry on along its last line, step apart.
export const ART_W = 1536;
export const ART_H = 1024;
export const AREAS = {
  DOTCOM: { x0: 43, x1: 82, y: 35.8, scale: 0.85, sign: { x: 37.7, y: 32.9 } },
  CRISIS: { x0: 31, x1: 84, y: 52.6, scale: 0.92, sign: { x: 26.2, y: 45.6 } },
  RECENT: { x0: 12, x1: 83, y: 75.8, scale: 1, wrap: { x0: 34, y: 64.2 }, sign: { x: 8.0, y: 65.1 } },
  // The side plot: three by its signpost (the one left of it a little lower, so its top
  // clears the tag at any width), the rest on the grass below the hedge, clear of
  // RECENT's board.
  BOUGHT: {
    scale: 0.8, step: 4.6, sign: { x: 8.3, y: 44.9 },
    slots: [[3.5, 55.5], [14.7, 52.6], [19.2, 52.6], [12.3, 62], [16.9, 62], [21.5, 62], [26.1, 62]],
  },
};
export const STONE_W = 4.4; // a stone's width at scale 1, in % of the painting's width
export const STONE_RATIO = 778 / 560; // height / width of the stone art
export const GAP = 0.9; // a stone is at most this share of the room along its row
// Famous ones stand a little larger; so does a stone with many respects (capped).
export const FAMOUS = new Set(['LEH', 'ENE', 'WCOM', 'BBI', 'TWTR', 'YHOO', 'SIVB', 'BBBY', 'WE', 'TOY', 'NSCP', 'SHLD', 'BSC']);
const grow = (e, n) => (FAMOUS.has(e.ticker) ? 1.14 : 1) * (1 + Math.min(0.1, Math.log10(1 + (n[e.ticker] || 0)) * 0.04));

// The painting's size and offset in a scene w x h: it covers the scene and is shifted so
// the terraces (FOCUS, a height in the painting) sit in the middle. BAND (% of the
// painting's height, the back row's tallest stone to the front row's feet) is always in
// view: in a scene too wide and short for that, the painting is narrower than the scene
// (the yard's own sky and grass show at the sides) rather than cut through the rows. The
// yard is never taller than w / 1.5 (graveyard.css), so the sides are never cut.
export const FOCUS = 0.53;
export const BAND = [25.5, 77.5];
export function stageFor(w, h) {
  const ratio = ART_W / ART_H;
  const sw = Math.min(Math.max(w, h * ratio), (h * ratio * 100) / (BAND[1] - BAND[0]));
  const sh = sw / ratio;
  let top = h / 2 - FOCUS * sh;
  top = Math.min(top, h - (BAND[1] / 100) * sh); // the front row above the fold
  top = Math.max(top, -(BAND[0] / 100) * sh); // the back row below the top
  top = Math.max(h - sh, Math.min(0, top));
  const left = (w - sw) / 2;
  return { sw, sh, top, left };
}

// Where each stone stands: { e, sec, row (for the arrows, back to front), x, y (its foot),
// size }, in % of the painting. Oldest first along each path.
export function layout(list, { counts = {}, areas = AREAS } = {}) {
  const bySec = new Map(SECTIONS.map((x) => [x.id, []]));
  for (const e of list) bySec.get(sectionOf(e)).push(e);
  // Where the side plot's stones end (its extra stones carry on along its last line): a
  // wrapped row's second line starts a step past that.
  let sideEnd = -Infinity;
  for (const [sec, stones] of bySec) {
    const a = areas[sec];
    if (!a.slots || !stones.length) continue;
    const [lx] = a.slots[a.slots.length - 1];
    const xs = stones.map((_, i) => (i < a.slots.length ? a.slots[i][0] : lx + (i - a.slots.length + 1) * (a.step || STONE_W)));
    sideEnd = Math.max(sideEnd, Math.max(...xs) + (a.step || STONE_W));
  }
  const spots = [];
  for (const [sec, stones] of bySec) {
    const a = areas[sec];
    stones.sort((p, r) => (p.date < r.date ? -1 : p.date > r.date ? 1 : 0));
    if (a.slots) {
      const [lx, ly] = a.slots[a.slots.length - 1];
      stones.forEach((e, i) => {
        const [x, y] = i < a.slots.length ? a.slots[i] : [lx + (i - a.slots.length + 1) * (a.step || STONE_W), ly];
        spots.push({ e, sec, x, y, size: a.scale * grow(e, counts) * (y < 56 ? 0.94 : 1) });
      });
      continue;
    }
    const room = (a.x1 - a.x0) / Math.max(1, stones.length);
    if (a.wrap && (GAP * room) / STONE_W < a.scale && stones.length > 1) {
      // Two lines: every other stone on the path, the rest on a line behind it, which starts
      // right of the side plot. The lines are far enough apart that no stone hides another.
      const lines = [[a.x0, a.y, stones.filter((_, i) => i % 2 === 0)], [Math.max(a.wrap.x0, sideEnd), a.wrap.y, stones.filter((_, i) => i % 2 === 1)]];
      const fit = Math.min(...lines.map(([x0, , s]) => (GAP * (a.x1 - x0)) / s.length / STONE_W));
      for (const [x0, y, s] of lines) {
        const step = (a.x1 - x0) / s.length;
        s.forEach((e, i) => spots.push({ e, sec, x: x0 + step * (i + 0.5), y, size: Math.min(a.scale * grow(e, counts), fit) }));
      }
      continue;
    }
    const fit = (GAP * room) / STONE_W; // never wider than the gap to the next stone
    stones.forEach((e, i) => {
      spots.push({ e, sec, x: a.x0 + room * (i + 0.5), y: a.y, size: Math.min(a.scale * grow(e, counts), fit) });
    });
  }
  const ys = [...new Set(spots.map((s) => s.y.toFixed(1)))].sort((p, r) => p - r);
  for (const s of spots) s.row = ys.indexOf(s.y.toFixed(1));
  return spots;
}

// Each stone's box in px in a scene w x h: { left, top, right, bottom }, the foot at y.
export function boxes(spots, w, h) {
  const st = stageFor(w, h);
  return spots.map((s) => {
    const bw = (STONE_W / 100) * st.sw * s.size;
    const bh = bw * STONE_RATIO;
    const cx = st.left + (s.x / 100) * st.sw;
    const bottom = st.top + (s.y / 100) * st.sh;
    return { t: s.e.ticker, left: cx - bw / 2, right: cx + bw / 2, top: bottom - bh, bottom };
  });
}
// The signposts' label boxes (about 8 px a letter), in px: the stones must not cover them.
export function signBoxes(w, h) {
  const st = stageFor(w, h);
  return SECTIONS.map((x) => {
    const a = AREAS[x.id];
    const cx = st.left + (a.sign.x / 100) * st.sw;
    const cy = st.top + (a.sign.y / 100) * st.sh;
    const bw = x.label.length * 7 + 10;
    return { t: `sign:${x.id}`, left: cx - bw / 2, right: cx + bw / 2, top: cy - 9, bottom: cy + 9 };
  });
}
// The pairs of boxes that overlap, and the boxes that leave the scene.
export function clashes(list, w, h) {
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (a.left < 0 || a.top < 0 || a.right > w || a.bottom > h) out.push([a.t, 'edge']);
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push([a.t, b.t]);
    }
  }
  return out;
}

// The next stone for an arrow key: along the row for left and right, the nearest in the next
// row for up and down. -1 stays put.
export function stepStone(spots, i, key) {
  if (!spots.length) return -1;
  if (i < 0) return 0;
  const cur = spots[i];
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const dir = key === 'ArrowLeft' ? -1 : 1;
    const row = spots.map((s, k) => ({ s, k })).filter(({ s }) => s.row === cur.row).sort((a, b) => a.s.x - b.s.x);
    const at = row.findIndex(({ k }) => k === i);
    const next = row[at + dir];
    return next ? next.k : i;
  }
  const rows = [...new Set(spots.map((s) => s.row))].sort((a, b) => a - b);
  const want = rows[rows.indexOf(cur.row) + (key === 'ArrowUp' ? -1 : 1)];
  if (want === undefined) return i;
  const row = spots.map((s, k) => ({ s, k })).filter(({ s }) => s.row === want);
  return row.sort((a, b) => Math.abs(a.s.x - cur.x) - Math.abs(b.s.x - cur.x))[0].k;
}

// The hover and focus label: 'Lehman Brothers · 2008 · 3 respects'.
export const tipText = (e, n = 0) => `${e.name} · ${e.date.slice(0, 4)} · ${respectsText(n)}`;

function cemeteryHtml(spots, art) {
  const stones = spots.map((s, i) => `<a class="gv-plot${s.sec === 'BOUGHT' ? ' is-bought' : ''}" href="${esc(q(`GRAVEYARD ${s.e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${s.e.ticker}`)}" data-i="${i}" aria-label="${esc(tombstoneLine(s.e))}">${stoneHtml({ ...s.e, art: { stone: art.stone } }, { small: true })}</a>`).join('');
  const signs = SECTIONS.map((x) => `<span class="gv-sign" data-sec="${x.id}">${esc(x.label)}</span>`).join('');
  const bg = art.yard || art.cemetery;
  return `<div class="gv-yard${bg ? ' has-art' : ''}">
      <div class="gv-stage">
        ${bg ? `<img class="gv-bg" src="${esc(bg)}" width="1536" height="1024" alt="">` : ''}
        ${signs}${stones}
        <p class="gv-tip" aria-live="polite" hidden></p>
      </div>
      <p class="gv-corner">${code('GRAVEYARD ZOMBIES', 'ZOMBIES')}</p>
    </div>`;
}

function renderCemetery(el, data, ctx) {
  let n = counts || {};
  const spots = layout(data.entries, { counts: n });
  el.innerHTML = panel('1', 'Graveyard', cemeteryHtml(spots, data.art), { cls: 'panel-solo gv-panel', meta: `${metaNote('ESC THEN ARROWS')} ${code('GRAVEYARD TABLE', 'TABLE')}` });
  for (const sign of el.querySelectorAll('.gv-sign')) {
    const a = AREAS[sign.dataset.sec];
    sign.style.left = `${a.sign.x}%`;
    sign.style.top = `${a.sign.y}%`;
  }
  // The painting covers the scene, cropped to the terraces; again on every resize.
  const yard = el.querySelector('.gv-yard');
  const stage = el.querySelector('.gv-stage');
  const fitStage = () => {
    const st = stageFor(yard.clientWidth, yard.clientHeight);
    stage.style.width = `${st.sw}px`;
    stage.style.height = `${st.sh}px`;
    stage.style.left = `${st.left}px`;
    stage.style.top = `${st.top}px`;
  };
  fitStage();
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(fitStage);
    ro.observe(yard);
    ctx.onCleanup(() => ro.disconnect());
  }
  const plots = [...el.querySelectorAll('.gv-plot')];
  const place = () => plots.forEach((p, i) => {
    const s = spots[i];
    p.style.left = `${s.x}%`;
    p.style.top = `${s.y}%`;
    p.style.setProperty('--s', String(s.size.toFixed(3)));
    p.style.zIndex = String(10 + s.row);
  });
  place();
  const tip = el.querySelector('.gv-tip');
  let on = -1;
  const pick = (i) => {
    if (i < 0 || i >= plots.length) return;
    plots[on]?.classList.remove('is-on');
    on = i;
    plots[on].classList.add('is-on');
    const s = spots[on];
    tip.textContent = tipText(s.e, n[s.e.ticker] || 0);
    tip.hidden = false;
    const lift = (STONE_W / 100) * stage.clientWidth * s.size * STONE_RATIO + 14; // above the lifted stone
    tip.style.left = `${Math.max(8, Math.min(92, s.x))}%`;
    tip.style.top = `calc(${s.y}% - ${lift.toFixed(0)}px)`;
  };
  plots.forEach((p, i) => { p.addEventListener('mouseenter', () => pick(i)); p.addEventListener('focus', () => pick(i)); });

  loadRespects(ctx.signal).then((fresh) => {
    if (!el.isConnected) return;
    n = fresh;
    const again = layout(data.entries, { counts: n });
    again.forEach((s, i) => { spots[i] = s; });
    place();
    if (on >= 0) pick(on);
  });
  ctx.onCleanup(sceneKeys(el, (ev) => {
    if (ev.key.startsWith('Arrow')) { pick(stepStone(spots, on < 0 ? 0 : on, ev.key)); return true; }
    if (ev.key === 'Enter' && on >= 0 && !ev.target.closest?.('a, button')) { ctx.run(`GRAVEYARD ${spots[on].e.ticker}`); return true; }
    if (ev.key === 't' || ev.key === 'T') { ctx.run('GRAVEYARD TABLE'); return true; }
    return false;
  }));
  ctx.status(`GRAVEYARD: ${data.entries.length} STONES`);
}

// ---- The table -------------------------------------------------------------------------------

// grouped: one block per cemetery section (the phone's cemetery), in the scene's order.
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

// ---- Zombies and one stone ---------------------------------------------------------------------

export function zombiesHtml(list) {
  if (!list.length) return '<p class="panel-msg">No zombies yet.</p>';
  return `<div class="gv-zombies">${list.map((e) => `<a class="gv-plot is-flat" href="${esc(q(`GRAVEYARD ${e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${e.ticker}`)}" aria-label="${esc(tombstoneLine(e))}">${stoneHtml(e, { small: true })}<span class="gv-zname">${esc(e.name)}</span></a>`).join('')}</div>`;
}

function renderStone(el, e, ctx) {
  const draw = (n) => {
    el.innerHTML = stonePageHtml(e, n);
    wireShare(el, ctx.copy);
    wireVideo(el);
  };
  draw(counts?.[e.ticker] || 0);
  loadRespects(ctx.signal).then((n) => {
    if (!el.isConnected) return;
    const c = el.querySelector('[data-count]');
    if (c) c.textContent = respectsText(n[e.ticker] || 0);
    const f = el.querySelector('[data-flowers]');
    if (f) f.innerHTML = flowersHtml(n[e.ticker] || 0);
  });
  ctx.onCleanup(wireRespects(el, e.ticker, { status: ctx.status }));
  goal('graveyard_seen', null, { once: e.ticker });
  ctx.status(`${e.ticker}: ${e.what.toUpperCase()} ${dayText(e.date).toUpperCase()}`);
}

const phone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 639px)').matches;

export function renderGraveyard(el, cmd, ctx) {
  const t = cmd.args?.ticker || null;
  const view = cmd.args?.view || null;
  el.innerHTML = panel('1', 'Graveyard', '<p class="loading">LOADING...</p>', { cls: 'panel-solo' });
  ctx.status('LOADING...');
  loadGraveyardAll(ctx.signal).then(async (data) => {
    if (!el.isConnected) return;
    if (view === 'ZOMBIES') {
      el.innerHTML = panel('1', 'Graveyard: zombies', zombiesHtml(data.zombies), { cls: 'panel-solo', meta: `${metaNote('DIED AND CAME BACK')} ${code('GRAVEYARD', 'CEMETERY')}` });
      ctx.status(`ZOMBIES: ${data.zombies.length} THAT CAME BACK`);
      return;
    }
    if (view === 'TODAY') {
      let items = [];
      try { items = (await (await fetch('/api/onthisday', { signal: ctx.signal })).json()).items || []; } catch { items = []; }
      if (!el.isConnected) return;
      if (items.length === 1) { renderStone(el, items[0], ctx); return; }
      if (items.length > 1) {
        el.innerHTML = panel('1', 'Graveyard: on this day', zombiesHtml(items), { cls: 'panel-solo', meta: metaNote(`${items.length} ON THIS DAY`) });
        ctx.status(`GRAVEYARD: ${items.length} ON THIS DAY`);
        return;
      }
      el.innerHTML = panel('1', 'Graveyard: on this day', `<p class="notice">No anniversary today.</p><p class="muted">${code('GRAVEYARD', 'See the graveyard')}.</p>`, { cls: 'panel-solo' });
      ctx.status('GRAVEYARD: NO ANNIVERSARY TODAY');
      return;
    }
    const e = t ? findGrave(data.entries, t) || findGrave(data.zombies, t) : null;
    if (e) { renderStone(el, e, ctx); return; }
    const miss = t ? `<p class="notice">No ${esc(t)} in the graveyard.</p>` : '';
    if (view === 'TABLE' || view === 'MOURNED' || t || phone()) { renderTable(el, data, ctx, { mourned: view === 'MOURNED', miss, grouped: !view && !t }); return; }
    renderCemetery(el, data, ctx);
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
