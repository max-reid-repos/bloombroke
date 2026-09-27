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
  findGrave, dayText, tombstoneLine, srcHost, graveLinks, stoneYears, flowersFor, respectsText, onThisDayLine, ytThumb, ytEmbed,
} from '../nosuch.js';

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
    ? `<span class="gv-rip">${e.zombie ? 'RETURNED' : 'R.I.P.'}</span><span class="gv-tk">${esc(e.ticker)}</span>`
    : `<span class="gv-rip">${e.zombie ? 'RETURNED' : 'R.I.P.'}</span><span class="gv-tk">${esc(e.ticker)}</span><span class="gv-name">${esc(e.name)}</span><span class="gv-years">${esc(stoneYears(e))}</span>${e.epitaph ? `<span class="gv-epitaph">${esc(e.epitaph)}</span>` : ''}`;
  return `<figure class="gv-stone${small ? ' is-small' : ''}${e.zombie ? ' is-zombie' : ''}${art.stone ? ' has-art' : ''}" role="img" aria-label="${esc(tombstoneLine(e))}">
      ${art.stone ? `<img class="gv-art" src="${esc(art.stone)}" width="560" height="778" alt="">` : ''}
      <div class="gv-face">${face}</div>
      ${art.doodle && !small ? `<img class="gv-doodle" src="${esc(art.doodle)}" width="384" height="384" alt="">` : ''}
      ${small ? '' : `<div class="gv-flowers" data-flowers>${flowersHtml(n)}</div>`}
    </figure>`;
}

export function sourcesHtml(e) {
  const links = e.src.map((u) => ext(u, srcHost(u))).join(', ');
  return `<p class="muted ns-src">${e.wayback ? `${ext(e.wayback, 'LAST WEBSITE', 'gv-last')} · ` : ''}Source: ${links}. ${code('GRAVEYARD', 'See the graveyard')}.</p>`;
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
// Every source behind the line, by host (the same host once).
export function peakLineHtml(e) {
  const list = Array.isArray(e.peakSrc) ? e.peakSrc : e.peakSrc ? [e.peakSrc] : [];
  if (!e.peakLine || !list.length) return '';
  const seen = new Set();
  const links = list.filter((u) => { const h = srcHost(u); if (seen.has(h)) return false; seen.add(h); return true; })
    .map((u) => ext(u, srcHost(u), 'dim')).join(', ');
  return `<p class="gv-whatif">${esc(e.peakLine)} <span class="gv-srcs">${links}</span></p>`;
}

// The video: a still and a play mark. Nothing from YouTube but the still loads until the
// click; the click swaps in the youtube-nocookie.com player (wireVideo).
export function videoHtml(e) {
  const thumb = ytThumb(e.video?.id);
  if (!thumb) return '';
  const label = `Play: ${e.video.title}${e.video.channel ? ` (${e.video.channel})` : ''}`;
  return `<button type="button" class="gv-video" data-yt="${esc(e.video.id)}" aria-label="${esc(label)}" title="${esc(label)}">
      <img src="${esc(thumb)}" width="480" height="360" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="gv-play" aria-hidden="true"></span>
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

export function respectsHtml(e, n) {
  return `<p class="gv-respects"><button type="button" class="wi-btn gv-f" data-respect="${esc(e.ticker)}"><kbd>F</kbd> PAY RESPECTS</button> <span class="gv-count num" data-count>${esc(respectsText(n))}</span></p>`;
}

// The stone page's words and links beside the stone.
export function factsHtml(e, n) {
  const back = e.zombie ? `<p class="gv-fact gv-what">Came back ${esc(dayText(e.back.date))}.</p><p class="gv-cause">${esc(e.back.what)}.</p>` : '';
  return `<div class="gv-facts">
      <p class="gv-fact gv-what">${esc(e.what)} ${esc(dayText(e.date))}.</p>${back}
      ${e.cause ? `<p class="gv-cause">${esc(e.cause)}</p>` : ''}
      ${peakLineHtml(e)}
      ${respectsHtml(e, n)}
      ${videoHtml(e)}
      ${shareRow(graveLinks(e, origin()), 'grave')}
      ${sourcesHtml(e)}
    </div>`;
}

export function stonePageHtml(e, n) {
  return `<div class="gv-page">${stoneHtml(e, { n })}${factsHtml(e, n)}</div>`;
}

// F (or the button) pays respects to the stone on screen. F works from the empty command
// bar or anywhere outside a field. Returns a cleanup.
export function wireRespects(el, ticker, { status = () => {} } = {}) {
  const pay = async () => {
    const d = await payRespect(ticker);
    if (!el.isConnected) return;
    if (!d) { status('RESPECTS NOT SAVED. TRY AGAIN', 'warn'); return; }
    const c = el.querySelector('[data-count]');
    if (c) c.textContent = respectsText(d.n);
    const f = el.querySelector('[data-flowers]');
    if (f) f.innerHTML = flowersHtml(d.n);
    el.querySelector('.gv-stone')?.classList.add('is-mourned');
    status(d.counted ? `${ticker}: RESPECTS PAID` : `${ticker}: ALREADY PAID TODAY`);
  };
  const onClick = (ev) => { if (ev.target.closest?.('[data-respect]')) pay(); };
  const onKey = (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
    const t = ev.target;
    const bar = t?.id === 'cmd';
    if (bar ? t.value !== '' : t?.closest?.('input, textarea, select, [contenteditable]')) return;
    ev.preventDefault();
    ev.stopPropagation();
    pay();
  };
  el.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey, true);
  return () => { el.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey, true); };
}

// ---- The cemetery -----------------------------------------------------------------------------

// Where each stone stands, in % of the scene: rows from the back (small, high) to the front
// (big, low), oldest at the back. size: the stone's scale, by peak market value when known.
export function layout(list, { rows = 4 } = {}) {
  const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const per = Math.max(1, Math.ceil(sorted.length / rows));
  const caps = sorted.map((e) => e.peak?.cap).filter((v) => Number.isFinite(v) && v > 0).map(Math.log10);
  const lo = caps.length ? Math.min(...caps) : 0;
  const hi = caps.length ? Math.max(...caps) : 0;
  const jitter = (t, k) => { let s = 0; for (const ch of t) s = (s * 31 + ch.charCodeAt(0)) % 1000; return (((s * (k + 7)) % 100) / 100 - 0.5); };
  return sorted.map((e, i) => {
    const r = Math.floor(i / per);
    const inRow = Math.min(per, sorted.length - r * per);
    const c = i - r * per;
    const x = 6 + ((c + 0.5 + (r % 2 ? 0.25 : -0.25)) / inRow) * 88 + jitter(e.ticker, 1) * 3;
    const y = 46 + (rows > 1 ? (r / (rows - 1)) * 44 : 22) + jitter(e.ticker, 2) * 3; // on the grass, below the hills
    const cap = Number.isFinite(e.peak?.cap) && e.peak.cap > 0 && hi > lo ? (Math.log10(e.peak.cap) - lo) / (hi - lo) : null;
    const size = (0.74 + r * 0.1) * (cap === null ? 1 : 0.82 + cap * 0.46);
    return { e, row: r, x: Math.max(4, Math.min(96, x)), y, size };
  });
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
  const want = cur.row + (key === 'ArrowUp' ? -1 : 1);
  const row = spots.map((s, k) => ({ s, k })).filter(({ s }) => s.row === want);
  if (!row.length) return i;
  return row.sort((a, b) => Math.abs(a.s.x - cur.x) - Math.abs(b.s.x - cur.x))[0].k;
}

function cemeteryHtml(spots, art) {
  const stones = spots.map((s, i) => `<a class="gv-plot" href="${esc(q(`GRAVEYARD ${s.e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${s.e.ticker}`)}" data-i="${i}" aria-label="${esc(tombstoneLine(s.e))}">${stoneHtml({ ...s.e, art: { stone: art.stone } }, { small: true })}</a>`).join('');
  return `<div class="gv-yard${art.cemetery ? ' has-art' : ''}">
      ${art.cemetery ? `<img class="gv-bg" src="${esc(art.cemetery)}" width="1536" height="1024" alt="">` : ''}
      <div class="gv-ground">${stones}</div>
      <p class="gv-caption" aria-live="polite"></p>
      <p class="gv-corner">${code('GRAVEYARD ZOMBIES', 'ZOMBIES')}</p>
    </div>`;
}

function renderCemetery(el, data, ctx) {
  const spots = layout(data.entries);
  el.innerHTML = panel('1', 'Graveyard', cemeteryHtml(spots, data.art), { cls: 'panel-solo gv-panel', meta: `${metaNote('ARROWS ENTER')} ${code('GRAVEYARD TABLE', 'T TABLE')}` });
  const plots = [...el.querySelectorAll('.gv-plot')];
  plots.forEach((p, i) => {
    const s = spots[i];
    p.style.left = `${s.x}%`;
    p.style.top = `${s.y}%`;
    p.style.setProperty('--s', String(s.size.toFixed(3)));
    p.style.zIndex = String(10 + s.row);
  });
  const caption = el.querySelector('.gv-caption');
  let on = -1;
  const pick = (i) => {
    if (i < 0 || i >= plots.length) return;
    plots[on]?.classList.remove('is-on');
    on = i;
    plots[on].classList.add('is-on');
    const e = spots[on].e;
    caption.textContent = `${e.ticker} · ${e.name} · ${e.date.slice(0, 4)}`;
  };
  pick(spots.length - 1);
  plots.forEach((p, i) => p.addEventListener('mouseenter', () => pick(i)));
  const onKey = (ev) => {
    const t = ev.target;
    const bar = t?.id === 'cmd';
    if (bar ? t.value !== '' : t?.closest?.('input, textarea, select')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (document.querySelector('#suggest:not([hidden])')) return;
    let handled = true;
    if (ev.key.startsWith('Arrow')) pick(stepStone(spots, on, ev.key));
    else if (ev.key === 'Enter' && on >= 0) ctx.run(`GRAVEYARD ${spots[on].e.ticker}`);
    else if (ev.key === 't' || ev.key === 'T') ctx.run('GRAVEYARD TABLE');
    else handled = false;
    if (handled) { ev.preventDefault(); ev.stopPropagation(); }
  };
  document.addEventListener('keydown', onKey, true);
  ctx.onCleanup(() => document.removeEventListener('keydown', onKey, true));
  ctx.status(`GRAVEYARD: ${data.entries.length} STONES`);
}

// ---- The table -------------------------------------------------------------------------------

export function graveyardTable(list, n = {}, { mourned = false } = {}) {
  const rows = [...list].sort(mourned
    ? (a, b) => (n[b.ticker] || 0) - (n[a.ticker] || 0) || (a.date < b.date ? 1 : -1)
    : (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return `<table class="grid-table ns-table">
    <thead><tr><th scope="col">Ticker</th><th scope="col">Name</th><th scope="col" class="ns-what">What happened</th><th scope="col" class="num">Date</th><th scope="col" class="num ns-what">Respects</th><th scope="col" class="ns-srccol">Source</th></tr></thead>
    <tbody>${rows.map((e) => `<tr>
      <td>${code(`GRAVEYARD ${e.ticker}`, e.ticker)}</td>
      <td class="ns-cell">${esc(e.name)}</td>
      <td class="ns-what ns-cell dim">${esc(e.what)}</td>
      <td class="num">${esc(dayText(e.date))}</td>
      <td class="num ns-what">${esc((n[e.ticker] || 0).toLocaleString('en-US'))}</td>
      <td class="ns-srccol">${ext(e.src[0], srcHost(e.src[0]))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderTable(el, data, ctx, { mourned = false, miss = '' } = {}) {
  const draw = (n) => {
    const sort = mourned ? `${code('GRAVEYARD TABLE', 'NEWEST')} · MOST MOURNED` : `NEWEST · ${code('GRAVEYARD MOURNED', 'MOST MOURNED')}`;
    el.innerHTML = panel('1', 'Graveyard', `${miss}${graveyardTable(data.entries, n, { mourned })}`, { cls: 'panel-solo', meta: `${sort} · ${code('GRAVEYARD', 'CEMETERY')}` });
  };
  draw(counts || {});
  loadRespects(ctx.signal).then((n) => { if (el.isConnected) draw(n); });
  const onKey = (ev) => {
    const t = ev.target;
    const bar = t?.id === 'cmd';
    if (bar ? t.value !== '' : t?.closest?.('input, textarea, select')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || (ev.key !== 't' && ev.key !== 'T')) return;
    ev.preventDefault();
    ev.stopPropagation();
    ctx.run('GRAVEYARD');
  };
  document.addEventListener('keydown', onKey, true);
  ctx.onCleanup(() => document.removeEventListener('keydown', onKey, true));
  ctx.status(`GRAVEYARD: ${data.entries.length} FAMOUS TICKERS THAT ARE GONE`);
}

// ---- Zombies and one stone ---------------------------------------------------------------------

export function zombiesHtml(list) {
  if (!list.length) return '<p class="panel-msg">No zombies yet.</p>';
  return `<div class="gv-zombies">${list.map((e) => `<a class="gv-plot is-flat" href="${esc(q(`GRAVEYARD ${e.ticker}`))}" data-cmd="${esc(`GRAVEYARD ${e.ticker}`)}" aria-label="${esc(tombstoneLine(e))}">${stoneHtml(e, { small: true })}<span class="gv-zname">${esc(e.name)}</span></a>`).join('')}</div>`;
}

function renderStone(el, e, ctx) {
  const draw = (n) => {
    el.innerHTML = panel('1', `Graveyard: ${e.ticker}`, stonePageHtml(e, n), { cls: 'panel-solo', meta: metaNote('F PAY RESPECTS') });
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
      if (items[0]) { renderStone(el, items[0], ctx); return; }
      el.innerHTML = panel('1', 'Graveyard: on this day', `<p class="notice">No anniversary today.</p><p class="muted">${code('GRAVEYARD', 'See the graveyard')}.</p>`, { cls: 'panel-solo' });
      ctx.status('GRAVEYARD: NO ANNIVERSARY TODAY');
      return;
    }
    const e = t ? findGrave(data.entries, t) || findGrave(data.zombies, t) : null;
    if (e) { renderStone(el, e, ctx); return; }
    const miss = t ? `<p class="notice">No ${esc(t)} in the graveyard.</p>` : '';
    if (view === 'TABLE' || view === 'MOURNED' || t || phone()) { renderTable(el, data, ctx, { mourned: view === 'MOURNED', miss }); return; }
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

export async function mountOnThisDay(head, { signal } = {}) {
  if (!head) return;
  try {
    const r = await fetch('/api/onthisday', { signal, headers: { Accept: 'application/json' } });
    const d = r.ok ? await r.json() : null;
    const e = d?.items?.[0];
    if (!e || !head.isConnected || head.querySelector('.gv-otd')) return;
    head.querySelector('.panel-meta')?.insertAdjacentHTML('beforebegin', onThisDayHtml(e));
  } catch { /* no line */ }
}
