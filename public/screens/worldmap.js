// WORLDMAP: a dark world map. Countries coloured by their main stock index today, the
// CANAL gauge's chokepoints as ship dots, and the WAFFLE gauge's active storms.
// Hover for the numbers; click a country for its index, a chokepoint for CANAL.
// The base map is a prebuilt file (scripts/build-worldmap.js), loaded only here.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING, fmtAsOf } from './markets.js';
import { EXCHANGES, sessionState, statusOf, localParts } from './clock.js';
import { sizeGuard } from './size-guard.js';
import {
  COUNTRY_INDEX, CITY_DOTS, indexFor, indexIds, moveFill, NO_INDEX_FILL, LEGEND_STEPS, FLAT_PCT,
  chokeMarkers, stormMarkers, stormKindWord, placeLabels, fitMap, project, MAP_W, MAP_H,
} from './worldmap-geo.js';

const GEO_URL = new URL('../geo/world-110m.json', import.meta.url).href;
export const LAYERS = ['INDEXES', 'SHIPS', 'STORMS'];
const STORE_KEY = 'bb.worldmap.layers';
// The header line. "today" only while some market on the map is open or at lunch.
export function headerText(allClosed) {
  return `${allClosed ? 'Stock indexes, last session' : 'Stock indexes today'} · Ships through chokepoints · Active storms`;
}

const n0 = (v) => (Number.isFinite(v) ? fmtNum(v, 0) : '--');
const latLon = (lat, lon) => `${Math.abs(lat).toFixed(1)}${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}${lon >= 0 ? 'E' : 'W'}`;

// Saved layer switches -> { INDEXES: true, ... }; anything odd means all on.
export function layerState(saved) {
  const out = {};
  for (const l of LAYERS) out[l] = !(saved && typeof saved === 'object' && saved[l] === false);
  return out;
}

// An index quote and its exchange -> { text, cls, closed, day } for the readout.
export function marketState(quote, exId, date = new Date()) {
  const ex = EXCHANGES[exId];
  if (!ex) return { text: '', cls: '', closed: false, day: null };
  const s = statusOf(ex, sessionState(ex, date), quote?.asOf);
  let day = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(quote?.asOf))) day = quote.asOf;
  else if (quote?.asOf) {
    const t = new Date(quote.asOf);
    if (!Number.isNaN(t.getTime())) day = localParts(ex.tz, t).day;
  }
  return { text: s.text, cls: s.cls, closed: s.text !== 'OPEN' && s.text !== 'LUNCH', day };
}

// Quotes (id -> quote) -> { up, down, open, allClosed } over the map's indexes. A market
// with no quote counts as closed (its hours alone decide nothing on the map).
export function mapCounts(quotes, date = new Date()) {
  let up = 0;
  let down = 0;
  let open = 0;
  for (const c of Object.values(COUNTRY_INDEX)) {
    const qt = quotes?.get(c.id);
    if (!qt) continue;
    if (qt.changePct > 0) up += 1;
    else if (qt.changePct < 0) down += 1;
    if (!marketState(qt, c.ex, date).closed) open += 1;
  }
  return { up, down, open, allClosed: open === 0 };
}

// Before any quote: open or closed by the exchange hours alone.
function allClosedByHours(date = new Date()) {
  return Object.values(COUNTRY_INDEX).every((c) => marketState(null, c.ex, date).closed);
}

function legendHtml(layers, canal) {
  const parts = [];
  if (layers.INDEXES) {
    const sw = (fill) => `<svg class="wm-sw" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" fill="${fill}"/></svg>`;
    const step = (fill, label) => `<span class="wm-step">${sw(fill)}<span>${label}</span></span>`;
    parts.push(`<span class="wm-leg wm-leg-idx">${LEGEND_STEPS.map((p) => step(moveFill(p), p === 0 ? `0 ±${FLAT_PCT}%` : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`)).join('')}`
      + `${step(NO_INDEX_FILL, 'no index')}</span>`);
  }
  if (layers.SHIPS) {
    const day = canal?.asOf ? fmtAsOf(canal.asOf) : 'latest day';
    parts.push(`<span class="wm-leg"><svg class="wm-sw wm-sw-dot" viewBox="0 0 16 16" aria-hidden="true"><circle class="wm-ring" cx="8" cy="8" r="7"/><circle class="wm-dot" cx="8" cy="8" r="4"/></svg>`
      + `<span>ships on ${esc(day)}, ring = 1Y daily avg, <span class="down">red</span> = under half</span></span>`);
  }
  if (layers.STORMS) {
    parts.push(`<span class="wm-leg"><svg class="wm-sw wm-sw-dot" viewBox="-8 -8 16 16" aria-hidden="true">${stormGlyph(true)}</svg><span>NHC storms: Atlantic, East and Central Pacific</span></span>`);
  }
  return parts.join('');
}

// The tropical cyclone symbol, 8px across at scale 1. Filled eye for a hurricane.
function stormGlyph(hurricane) {
  return `<path class="wm-arm" d="M-3 0C-3-4.5 1.5-6.5 5-6M3 0C3 4.5-1.5 6.5-5 6"/><circle class="wm-eye${hurricane ? ' is-hu' : ''}" r="3"/>`;
}

export function render(el, cmd, ctx) {
  let layers = layerState(ctx.store?.get(STORE_KEY, null));
  const toggles = LAYERS.map((l) => `<button type="button" class="wm-tog${layers[l] ? ' is-on' : ''}" data-layer="${l}" aria-pressed="${layers[l]}">${l}</button>`).join('');
  el.innerHTML = panel('1', 'World map', `
    <div class="wm-bar"><p class="wm-sub" id="wm-sub">${esc(headerText(allClosedByHours()))}</p><div class="wm-togs" role="group" aria-label="Map layers">${toggles}</div></div>
    <p class="wm-read" id="wm-read" aria-live="polite">&nbsp;</p>
    <div class="wm-host" id="wm-host">${LOADING}</div>
    <div class="wm-foot" id="wm-foot"><div class="wm-legend" id="wm-legend"></div>
      <p class="wm-src">Sources: CNBC, IMF PortWatch, NHC. Map: Natural Earth.</p></div>`, { cls: 'panel-solo wm-panel', metaId: 'wm-meta' });
  const host = el.querySelector('#wm-host');
  const read = el.querySelector('#wm-read');
  const meta = el.querySelector('#wm-meta');
  const legend = el.querySelector('#wm-legend');
  const foot = el.querySelector('#wm-foot');
  const sub = el.querySelector('#wm-sub');

  let geo = null;
  let quotes = null; // id -> quote
  let canal = null;
  let storms = null;
  let svg = null;
  let scale = 1;
  const names = new Map();

  // ---- drawing ----------------------------------------------------------------
  function baseSvg() {
    const land = geo.countries.map((c) => {
      names.set(c.cc, c.name);
      const idx = indexFor(c.cc);
      const path = `<path class="wm-c" data-cc="${esc(c.cc)}" d="${esc(c.d)}"/>`;
      return idx
        ? `<a class="wm-a" href="${esc(q(idx.id))}" data-cmd="${esc(idx.id)}" data-cc="${esc(c.cc)}" aria-label="${esc(c.name)}">${path}</a>`
        : path;
    }).join('');
    return `<svg class="wm-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="World map">`
      + `<g class="wm-land">${land}</g><g class="wm-cities"></g><g class="wm-ships"></g><g class="wm-storms"></g></svg>`;
  }

  function paintCountries() {
    if (!svg) return;
    svg.classList.toggle('wm-off-idx', !layers.INDEXES);
    for (const p of svg.querySelectorAll('.wm-c[data-cc]')) {
      const idx = indexFor(p.dataset.cc);
      const qt = idx && quotes?.get(idx.id);
      p.setAttribute('fill', qt ? moveFill(qt.changePct) : NO_INDEX_FILL);
    }
  }

  // Markers are sized in screen pixels: k keeps them readable on a phone and not
  // oversized on a wide screen.
  function unit(px) {
    const k = Math.min(1.25, Math.max(0.7, scale));
    return (px * k) / scale;
  }

  // Built once; a refresh or a resize only changes the fill and the radius.
  function paintCities() {
    const g = svg?.querySelector('.wm-cities');
    if (!g) return;
    if (g.firstChild) {
      for (const dot of g.querySelectorAll('.wm-city')) {
        const idx = indexFor(dot.dataset.cc);
        const qt = idx && quotes?.get(idx.id);
        dot.setAttribute('r', unit(3.2).toFixed(2));
        dot.setAttribute('fill', qt ? moveFill(qt.changePct) : NO_INDEX_FILL);
      }
      return;
    }
    g.innerHTML = Object.entries(CITY_DOTS).map(([cc, c]) => {
      const idx = indexFor(cc);
      names.set(cc, c.name);
      const [x, y] = project(...c.at);
      const qt = idx && quotes?.get(idx.id);
      return `<a class="wm-a" href="${esc(q(idx.id))}" data-cmd="${esc(idx.id)}" data-cc="${esc(cc)}" aria-label="${esc(c.name)}">`
        + `<circle class="wm-c wm-city" data-cc="${esc(cc)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${unit(3.2).toFixed(2)}" fill="${qt ? moveFill(qt.changePct) : NO_INDEX_FILL}"/></a>`;
    }).join('');
  }

  // Ship dots and storms share one label pass, so no label lands on another.
  function paintMarkers() {
    const ships = svg?.querySelector('.wm-ships');
    const stormG = svg?.querySelector('.wm-storms');
    if (!ships || !stormG) return;
    const chokes = layers.SHIPS && canal?.rows ? chokeMarkers(canal.rows) : [];
    const cyclones = layers.STORMS && storms ? stormMarkers(storms) : [];
    const fs = unit(11);
    const charW = fs * 0.6;
    const items = [
      ...chokes.map((m) => {
        const r = Math.max(unit(m.r), unit(m.ring));
        const count = Number.isFinite(m.row.total) ? n0(m.row.total) : '--';
        return { m, kind: 'ship', count, x: m.x, y: m.y, r, gap: r + unit(4), w: (count.length + 1 + m.name.length) * charW, h: fs * 1.1, prefer: m.label };
      }),
      ...cyclones.map((m) => ({ m, kind: 'storm', x: m.x, y: m.y, r: unit(6), gap: unit(9), w: (m.name.length + 1 + m.cat.length) * charW, h: fs * 1.1, prefer: 'right' })),
    ];
    const spots = placeLabels(items);
    const text = (it, i, inner) => `<text class="wm-lab" x="${spots[i].tx.toFixed(1)}" y="${spots[i].ty.toFixed(1)}" font-size="${fs.toFixed(2)}" text-anchor="${spots[i].anchor}">${inner}</text>`;
    const shipParts = [];
    const stormParts = [];
    items.forEach((it, i) => {
      const { m } = it;
      const cx = m.x.toFixed(1);
      const cy = m.y.toFixed(1);
      if (it.kind === 'ship') {
        const r = unit(m.r);
        const ring = unit(m.ring);
        const name = `<tspan class="wm-lab-n">${esc(m.name.toUpperCase())}</tspan>`;
        const inner = spots[i].side === 'left' ? `${name} ${esc(it.count)}` : `${esc(it.count)} ${name}`;
        shipParts.push(`<a class="wm-choke${m.low ? ' is-low' : ''}" href="${esc(q('CANAL'))}" data-cmd="CANAL" data-choke="${esc(m.portid)}" aria-label="${esc(`${m.full}: ${it.count} ships`)}">`
          + (ring ? `<circle class="wm-ring" cx="${cx}" cy="${cy}" r="${ring.toFixed(2)}"/>` : '')
          + (r ? `<circle class="wm-dot" cx="${cx}" cy="${cy}" r="${r.toFixed(2)}"/>` : '')
          + `<circle class="wm-hit" cx="${cx}" cy="${cy}" r="${Math.max(r, ring, unit(8)).toFixed(2)}"/>`
          + `${text(it, i, inner)}</a>`);
      } else {
        stormParts.push(`<a class="wm-storm" href="${esc(q('WAFFLE'))}" data-cmd="WAFFLE" data-storm="${esc(m.id)}" aria-label="${esc(`${m.name} ${m.cat}`)}">`
          + `<g transform="translate(${cx} ${cy}) scale(${unit(1).toFixed(3)})">${stormGlyph(/^C\d$/.test(m.cat))}<circle class="wm-hit" r="9"/></g>`
          + `${text(it, i, `${esc(m.name.toUpperCase())} <tspan class="wm-lab-n">${esc(m.cat)}</tspan>`)}</a>`);
      }
    });
    ships.innerHTML = shipParts.join('');
    stormG.innerHTML = stormParts.join('');
  }

  function paintLegend() {
    legend.innerHTML = legendHtml(layers, canal);
  }

  function paintAll() {
    paintCountries();
    paintCities();
    paintMarkers();
    paintLegend();
  }

  // ---- readout ------------------------------------------------------------------
  function countryRead(cc) {
    const name = names.get(cc) || cc;
    const idx = indexFor(cc);
    if (!idx) return `<b>${esc(name)}</b> <span class="dim">no index on this map</span>`;
    const qt = quotes?.get(idx.id);
    if (!qt) return `<b>${esc(name)}</b> <span class="dim">${esc(idx.id)}: no quote right now</span>`;
    const st = marketState(qt, idx.ex);
    const closed = st.closed ? ` <span class="dim">last session ${esc(st.day ? fmtAsOf(st.day) : '--')}</span>` : '';
    return `<b>${esc(name)}</b> ${esc(qt.label || qt.name || idx.id)} <span class="num">${esc(fmtNum(qt.last, qt.decimals ?? 2))}</span> `
      + `<span class="num ${dirOf(qt.changePct)}">${esc(fmtPct(qt.changePct))}</span> <span class="wm-st ${esc(st.cls)}">${esc(st.text)}</span>${closed}`;
  }

  function chokeRead(portid) {
    const r = canal?.rows?.find((x) => x.portid === portid);
    if (!r) return '';
    const vs = Number.isFinite(r.vsAvg) ? `${r.vsAvg > 0 ? '+' : r.vsAvg < 0 ? '−' : ''}${Math.abs(Math.round(r.vsAvg))}%` : '--';
    return `<b>${esc(r.full || r.name)}</b> <span class="dim">${esc(fmtAsOf(r.date || canal.asOf))}</span> <span class="num">${esc(n0(r.total))}</span> ships`
      + ` <span class="dim">7-day avg</span> <span class="num">${esc(n0(r.week))}</span> <span class="dim">1Y avg</span> <span class="num">${esc(n0(r.avgTotal))}</span>`
      + ` <span class="dim">7D vs 1Y</span> <span class="num ${dirOf(r.vsAvg)}">${esc(vs)}</span> <span class="dim">tankers</span> <span class="num">${esc(n0(r.tanker))}</span>`;
  }

  function stormRead(id) {
    const s = storms?.find((x) => x.id === id);
    if (!s) return '';
    const m = stormMarkers([s])[0];
    return `<b>${esc(s.name)}</b> ${esc(stormKindWord(s.kind))}${m && /^C\d$/.test(m.cat) ? ` <span class="num">${esc(m.cat)}</span>` : ''}`
      + ` <span class="num">${esc(n0(s.windKt))}</span> kt <span class="dim">${esc(latLon(s.lat, s.lon))}</span>`;
  }

  function readFor(target) {
    const t = target?.closest?.('[data-choke], [data-storm], [data-cc]');
    if (!t || !host.contains(t)) return null;
    if (t.dataset.choke) return chokeRead(t.dataset.choke);
    if (t.dataset.storm) return stormRead(t.dataset.storm);
    return countryRead(t.dataset.cc);
  }
  function show(target) {
    const html = readFor(target);
    read.innerHTML = html || '&nbsp;';
  }
  host.addEventListener('pointerover', (e) => show(e.target));
  host.addEventListener('pointerleave', () => { read.innerHTML = '&nbsp;'; });
  host.addEventListener('focusin', (e) => show(e.target));

  // On a touch screen the first tap shows the numbers, a second tap opens the screen.
  let pointerType = 'mouse';
  let tapped = null;
  host.addEventListener('pointerdown', (e) => { pointerType = e.pointerType; }, true);
  host.addEventListener('click', (e) => {
    const a = e.target.closest?.('[data-cmd]');
    if (!a || pointerType !== 'touch') return;
    const key = a.dataset.cc || a.dataset.choke || a.dataset.storm;
    if (tapped !== key) {
      e.preventDefault();
      e.stopPropagation();
      tapped = key;
      show(e.target);
    }
  });

  // ---- layers -------------------------------------------------------------------
  el.querySelector('.wm-togs').addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-layer]');
    if (!b) return;
    layers = { ...layers, [b.dataset.layer]: !layers[b.dataset.layer] };
    b.classList.toggle('is-on', layers[b.dataset.layer]);
    b.setAttribute('aria-pressed', String(layers[b.dataset.layer]));
    ctx.store?.set(STORE_KEY, layers);
    paintAll();
  });

  // ---- size: the map fits its box (and the window height), through the size guard ----
  const guard = sizeGuard();
  const now = () => (typeof performance === 'object' ? performance.now() : Date.now());
  // The bottom the map may reach: the panel body's own bottom when it scrolls by itself
  // (wide screens), else the top of the dock.
  function bottom() {
    const body = host.closest('.panel-body');
    const cs = body && getComputedStyle(body);
    if (cs && /auto|scroll/.test(cs.overflowY)) return body.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom || '0') - 1;
    return window.innerHeight - (document.querySelector('.dock')?.offsetHeight || 0) - 16;
  }
  function box() {
    const w = host.clientWidth;
    const top = host.getBoundingClientRect().top;
    if (ctx.embed) {
      const body = host.closest('.panel-body');
      const pad = body ? parseFloat(getComputedStyle(body).paddingBottom || '0') : 0;
      return { w, h: Math.max(120, Math.floor(window.innerHeight - top - foot.offsetHeight - pad - 4)) };
    }
    if (w < 640) return { w, h: Math.round((w * MAP_H) / MAP_W) }; // phones: fit the width
    return { w, h: Math.max(240, Math.floor(bottom() - top - foot.offsetHeight - 8)) };
  }
  function resize(force = false) {
    if (!svg) return;
    const b = box();
    const s = force ? b : guard.next(b.w, b.h, now());
    if (!s || !s.w) return;
    if (force) guard.drawn(b.w, b.h, now());
    const fit = fitMap(s.w, s.h);
    svg.setAttribute('width', String(fit.w));
    svg.setAttribute('height', String(fit.h));
    scale = fit.w / MAP_W || 1;
    paintCities();
    paintMarkers();
  }
  let roTimer = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clearTimeout(roTimer); roTimer = setTimeout(() => resize(), 60); }) : null;
  ro?.observe(host);
  const onWin = () => resize();
  window.addEventListener('resize', onWin);
  ctx.onCleanup(() => { clearTimeout(roTimer); ro?.disconnect(); window.removeEventListener('resize', onWin); });

  // ---- data ---------------------------------------------------------------------
  function summary() {
    if (!quotes) return;
    const n = mapCounts(quotes);
    meta.innerHTML = `<span class="up">${n.up} UP</span> <span class="down">${n.down} DOWN</span> <span class="dim">${n.open} OPEN</span>`;
    sub.textContent = headerText(n.allClosed);
  }

  async function loadQuotes() {
    try {
      const d = await ctx.fetchJSON(`/api/quotes?s=${encodeURIComponent(indexIds().join(','))}`, { signal: ctx.signal });
      quotes = new Map((d.quotes || []).map((x) => [x.ticker, x]));
      summary();
      paintCountries();
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      ctx.status('COULD NOT REFRESH INDEXES', 'warn');
    }
  }
  async function loadCanal() {
    try {
      const d = await ctx.fetchJSON('/api/weird/canal', { signal: ctx.signal });
      canal = d.ok ? d : null;
    } catch (err) {
      if (err.name === 'AbortError') return;
      canal = null;
    }
    paintMarkers();
    paintLegend();
  }
  async function loadStorms() {
    try {
      const d = await ctx.fetchJSON('/api/weird/waffle', { signal: ctx.signal });
      storms = d.ok && Array.isArray(d.storms) ? d.storms : null;
    } catch (err) {
      if (err.name === 'AbortError') return;
      storms = null;
    }
    paintMarkers();
  }

  async function start() {
    try {
      geo = await ctx.fetchJSON(GEO_URL, { signal: ctx.signal });
    } catch (err) {
      if (err.name === 'AbortError') return;
      host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT LOAD THE MAP', 'warn');
      return;
    }
    host.innerHTML = baseSvg();
    svg = host.querySelector('svg');
    paintAll();
    resize(true);
    loadQuotes();
    loadCanal();
    loadStorms();
    ctx.every(loadQuotes, 60_000);
    ctx.every(loadCanal, 30 * 60_000);
    ctx.every(loadStorms, 30 * 60_000);
    ctx.every(summary, 30_000);
  }
  start();
}
