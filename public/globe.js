// The BBRK globe (BBRK and SPONSOR): a small globe drawn on a canvas in the terminal's
// style. Land is ice-blue dots (public/geo/globe-dots.json, made from the WORLDMAP
// Natural Earth map by scripts/build-globe-dots.js), lit by the real sun: the night side
// is dimmer. Visitor places are brighter dots, sized by the last 7 days' visitors: a
// country at its centre, and a city with 3 or more visitors at its place rounded to whole
// degrees (about 100 km). The server does the folding (GET /api/bbrk): the browser only
// ever gets those dots, never a city list, never anything about one visitor.
//
// Drag it round (mouse or touch; on a phone a mostly vertical drag still scrolls the
// page), with a little momentum after letting go; it turns by itself again after
// IDLE_MS. Arrow keys turn it while it has focus. Hover or tap a dot: "Tokyo · 12 this
// week". Places with someone on now pulse softly (from HERE_MIN people on now, like N
// HERE NOW). At most FPS frames a second, only while it is on screen and the tab is
// visible. Reduced motion: a still globe (it still turns by hand), no pulses.

import { HERE_MIN } from './here-now.js';

export const DOTS_URL = new URL('./geo/globe-dots.json', import.meta.url).href;
export const TILT = 18; // degrees: the north pole leans toward the viewer
export const TILT_MIN = -40;
export const TILT_MAX = 70;
export const TURN_DEG_PER_SEC = 6;
export const FPS = 30;
export const IDLE_MS = 4000; // after a drag, a tap or a key, it turns by itself again
export const RAMP_MS = 1200; // and gets back to full speed over this long
export const FRICTION = 0.94; // momentum kept each 1/60 s
export const V_MAX = 0.6; // deg/ms, the fastest flick
export const V_STOP = 0.002; // deg/ms: slower than this, the flick is over
export const KEY_STEP = 15; // degrees an arrow key turns
export const PULSE_MS = 2400;
export const TAP_PX = 6; // a press that moves less than this is a tap

const RAD = Math.PI / 180;

// Orthographic projection. lon, lat in degrees; lon0 the centre meridian; tilt the
// latitude at the centre. -> [x, y, z] on the unit disc (y down), z > 0 on the near side.
export function ortho(lon, lat, lon0, tilt = TILT) {
  const l = (lon - lon0) * RAD;
  const p = lat * RAD;
  const t = tilt * RAD;
  const cp = Math.cos(p);
  const x = cp * Math.sin(l);
  const y = Math.cos(t) * Math.sin(p) - Math.sin(t) * cp * Math.cos(l);
  const z = Math.sin(t) * Math.sin(p) + Math.cos(t) * cp * Math.cos(l);
  return [x, -y, z];
}

// Any longitude -> the same one in [-180, 180).
export function wrapLon(l) {
  return ((((l + 180) % 360) + 360) % 360) - 180;
}

export const clampTilt = (t) => Math.max(TILT_MIN, Math.min(TILT_MAX, t));

// Pixels dragged -> degrees turned, for a globe of radius R px: the point under the
// pointer follows it near the centre.
export const pxToDeg = (px, R) => (R > 0 ? (px / R) / RAD : 0);

// Momentum after dt ms (v in deg/ms): FRICTION a sixtieth of a second, 0 once slow.
export function decay(v, dt, friction = FRICTION) {
  const next = v * friction ** (Math.max(0, dt) / (1000 / 60));
  return Math.abs(next) < V_STOP ? 0 : next;
}

export const clampV = (v) => Math.max(-V_MAX, Math.min(V_MAX, v));

// The turning speed by itself (deg/s), idleMs after the last touch: 0 for IDLE_MS, then
// up to TURN_DEG_PER_SEC over RAMP_MS.
export function autoSpeed(idleMs) {
  if (!(idleMs >= IDLE_MS)) return 0;
  return TURN_DEG_PER_SEC * Math.min(1, (idleMs - IDLE_MS) / RAMP_MS);
}

// Where the sun is overhead now: [lon, lat] in degrees (the usual low-precision solar
// formulas, well under a degree off).
export function subsolar(date = new Date()) {
  const d = date.getTime() / 86400000 - 10957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * d;
  return [wrapLon(ra - gmst), dec / RAD];
}

const unit = (lon, lat) => {
  const cp = Math.cos(lat * RAD);
  return [cp * Math.cos(lon * RAD), cp * Math.sin(lon * RAD), Math.sin(lat * RAD)];
};

// How high the sun is at lon, lat: the cosine of its angle from overhead (1 noon, 0 on
// the day and night line, below 0 at night).
export function daylight(lon, lat, sun) {
  const a = unit(lon, lat);
  const b = unit(sun[0], sun[1]);
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// A land dot's brightness from its daylight: day, dusk, night.
export const shade = (d) => (d > 0.1 ? 1 : d > -0.1 ? 0.7 : 0.45);

// Dot radius (px) for a place's visitors, against the biggest place.
export function dotRadius(visitors, max, { min = 2.2, big = 7 } = {}) {
  if (!(visitors > 0) || !(max > 0)) return 0;
  return min + (big - min) * Math.sqrt(visitors / max);
}

// Where the globe starts: facing the country with the most visitors, else the Atlantic.
export function startLon(countries, centres) {
  const c = countries?.[0] && centres?.[countries[0].cc];
  return c ? c[0] : -40;
}

const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const count = (n) => Math.round(n).toLocaleString('en-US');

// The server's globe (or, as before, just its countries) -> the places to draw:
// [{ kind, cc, name?, at: [lon, lat], n, part?, live? }]. A country whose visitors are
// all in city dots (rest 0) has no dot of its own; it is kept (n 0) only to pulse.
export function globeItems(globe, centres = {}) {
  const g = Array.isArray(globe) ? { countries: globe } : globe || {};
  const out = [];
  for (const c of Array.isArray(g.countries) ? g.countries : []) {
    const at = centres[c?.cc];
    if (!at || !(c.visitors > 0)) continue;
    const n = fin(c.rest) ? c.rest : c.visitors;
    if (n <= 0 && !c.live) continue;
    out.push({ kind: 'country', cc: c.cc, at, n: Math.max(0, n), part: fin(c.rest), live: Boolean(c.live) });
  }
  for (const c of Array.isArray(g.cities) ? g.cities : []) {
    if (!Array.isArray(c?.at) || !fin(c.at[0]) || !fin(c.at[1]) || !(c.visitors > 0) || typeof c.name !== 'string') continue;
    out.push({ kind: 'city', cc: c.cc, name: c.name, at: c.at, n: c.visitors, live: Boolean(c.live) });
  }
  return out;
}

// Map names that read badly in a label, in plain words.
export const PLAIN_NAMES = {
  US: 'United States', BA: 'Bosnia and Herzegovina', CD: 'DR Congo', CF: 'Central African Republic', DO: 'Dominican Republic',
  GQ: 'Equatorial Guinea', SB: 'Solomon Islands', SS: 'South Sudan', FK: 'Falkland Islands', EH: 'Western Sahara', CYN: 'Northern Cyprus',
};

// The label for a dot: 'United States · 45 this week', 'Tokyo · 12 this week', and for
// a country that also has city dots, 'United States, elsewhere · 4 this week'.
export function tipText(item, names = {}) {
  if (!item || !(item.n > 0)) return '';
  const place = item.kind === 'city' ? item.name : `${PLAIN_NAMES[item.cc] || names[item.cc] || item.cc}${item.part ? ', elsewhere' : ''}`;
  return `${place} · ${count(item.n)} this week`;
}

// Pulses only from HERE_MIN people on now (1 is most likely the viewer).
export const pulsesOn = (live) => Number.isInteger(live) && live >= HERE_MIN;

// The dot under a point (px, py on the canvas), or null. placed: [{ item, x, y, r }] of
// the dots on the near side, as drawn.
export function pickDot(placed, px, py, slop = 8) {
  let best = null;
  let bestD = Infinity;
  for (const p of placed) {
    if (!(p.item.n > 0)) continue;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d <= p.r + slop && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

// The globe's caption: '7D by country · 4 live now'.
export function globeCaption(d) {
  const live = d?.audience?.live;
  return `7D by country${fin(live) ? ` · ${count(live)} live now` : ''}`;
}

// The canvas's words for a screen reader: the countries and their visitors.
export function globeLabel(d) {
  const g = d?.audience?.globe;
  const list = (g?.countries || []).slice(0, 8).map((c) => `${c.cc} ${count(c.visitors)}`).join(', ');
  return `Globe of visitors by country, last 7 days${list ? `: ${list}` : ''}${fin(g?.other) && g.other > 0 ? `, other ${count(g.other)}` : ''}.`;
}

let dotsPromise = null;
export function loadDots(fetchImpl = globalThis.fetch) {
  dotsPromise ||= fetchImpl(DOTS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error('no globe')))).catch((e) => { dotsPromise = null; throw e; });
  return dotsPromise;
}

// Draw the globe in canvas. globe: the server's audience.globe (or its countries array).
// Returns { update(globe, live), stop(), running, view }. win and doc for the tests are
// the page's own; now() is the clock the frames use.
export function mountGlobe(canvas, geo, globe = [], { reduceMotion = false, live = null, win = window, doc = document, now = null } = {}) {
  const ctx2 = canvas.getContext('2d');
  const css = win.getComputedStyle(canvas);
  const land = css.getPropertyValue('--globe-land').trim() || 'rgba(108, 203, 255, .35)';
  const hot = css.getPropertyValue('--globe-hot').trim() || '#CFEAFF';
  const rim = css.getPropertyValue('--globe-rim').trim() || 'rgba(108, 203, 255, .25)';
  const clock = now || (() => (win.performance || globalThis.performance).now());
  const names = geo.names || {};
  let items = globeItems(globe, geo.centres);
  let liveNow = live;
  const view = { lon0: startLon(Array.isArray(globe) ? globe : globe?.countries, geo.centres), tilt: TILT, v: 0 };
  let frame = 0;
  let last = 0;
  let lastDraw = -Infinity;
  let lastTouch = -Infinity; // when someone last dragged, tapped, hovered a dot or pressed a key
  let running = false;
  let stopped = false;
  let onScreen = true;
  let dirty = true;
  let placed = [];
  let sun = subsolar();
  let sunAt = 0;
  let geom = { w: 0, R: 0, c: 0 };

  // Setup for the page (not the tests' bare canvas): focusable, keeps its focus when
  // clicked (app.js), and a label for the dot under the pointer.
  canvas.tabIndex = 0;
  canvas.setAttribute?.('data-own-focus', '');
  const fig = canvas.parentElement;
  const tip = fig && typeof doc.createElement === 'function' ? doc.createElement('span') : null;
  if (tip) {
    tip.className = 'globe-tip';
    tip.hidden = true;
    tip.setAttribute?.('aria-live', 'polite');
    fig.appendChild(tip);
  }
  let tipItem = null;

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.max(80, Math.round(r.width));
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr); }
    return { w, dpr };
  }

  function placeTip() {
    if (!tip) return;
    const p = tipItem && placed.find((x) => x.item === tipItem);
    if (!p) { tip.hidden = true; tipItem = null; return; }
    tip.textContent = tipText(p.item, names);
    tip.hidden = false;
    const fw = fig.clientWidth || geom.w;
    const tw = tip.offsetWidth || 0;
    const left = (canvas.offsetLeft || 0) + p.x;
    tip.style.left = `${Math.round(Math.max(0, Math.min(left - tw / 2, fw - tw)))}px`;
    tip.style.top = `${Math.round((canvas.offsetTop || 0) + p.y - p.r - 6)}px`;
  }
  function showTip(p) {
    tipItem = p ? p.item : null;
    placeTip();
  }

  function draw(t = clock()) {
    const { w, dpr } = size();
    const R = w / 2 - 6;
    const c = w / 2;
    geom = { w, R, c };
    if (t - sunAt > 60_000) { sun = subsolar(); sunAt = t; }
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, w);
    ctx2.strokeStyle = rim;
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.arc(c, c, R, 0, 2 * Math.PI);
    ctx2.stroke();
    // Land, in three passes (day, dusk, night) to keep the canvas state changes few.
    const scale = Math.max(1, Math.min(1.8, w / 220));
    const ds = 1.8 * Math.min(1.4, scale);
    ctx2.fillStyle = land;
    const pass = { 1: [], 0.7: [], 0.45: [] };
    for (const [lon, lat] of geo.dots) {
      const [x, y, z] = ortho(lon, lat, view.lon0, view.tilt);
      if (z <= 0) continue;
      pass[shade(daylight(lon, lat, sun))].push(c + x * R - ds / 2, c + y * R - ds / 2);
    }
    for (const a of [1, 0.7, 0.45]) {
      const xy = pass[a];
      ctx2.globalAlpha = a;
      for (let i = 0; i < xy.length; i += 2) ctx2.fillRect(xy[i], xy[i + 1], ds, ds);
    }
    ctx2.globalAlpha = 1;
    // Visitor places.
    const dotScale = Math.min(1.4, scale); // bigger globe, a little bigger dots, never loud
    const max = items.reduce((m, x) => Math.max(m, x.n), 0);
    const pulse = pulsesOn(liveNow);
    placed = [];
    ctx2.fillStyle = hot;
    ctx2.strokeStyle = hot;
    for (let i = 0; i < items.length; i++) {
      const k = items[i];
      const [x, y, z] = ortho(k.at[0], k.at[1], view.lon0, view.tilt);
      if (z <= 0) continue;
      const px = c + x * R;
      const py = c + y * R;
      const r = dotRadius(k.n, max, { min: 2.2 * dotScale, big: 7 * dotScale }) || 2 * dotScale;
      placed.push({ item: k, x: px, y: py, r });
      if (k.n > 0) {
        ctx2.globalAlpha = 0.9;
        ctx2.beginPath();
        ctx2.arc(px, py, r, 0, 2 * Math.PI);
        ctx2.fill();
      }
      if (pulse && k.live) {
        // A soft ring out from the dot; with reduced motion one still ring.
        const ph = reduceMotion ? 0.35 : (((t + i * 700) % PULSE_MS) + PULSE_MS) % PULSE_MS / PULSE_MS;
        ctx2.globalAlpha = 0.5 * (1 - ph);
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.arc(px, py, r + 2 + ph * 10 * dotScale, 0, 2 * Math.PI);
        ctx2.stroke();
      }
    }
    ctx2.globalAlpha = 1;
    lastDraw = t;
    dirty = false;
    placeTip();
  }

  function moving(t) {
    return pointer !== null || view.v !== 0 || autoSpeed(t - lastTouch) > 0;
  }

  function tick(t) {
    if (!running) return;
    const dt = last ? Math.min(100, t - last) : 0;
    last = t;
    if (pointer === null) {
      if (view.v !== 0) {
        view.lon0 = wrapLon(view.lon0 + view.v * dt);
        view.v = decay(view.v, dt);
        if (view.v === 0) lastTouch = t;
        dirty = true;
      } else {
        const s = autoSpeed(t - lastTouch);
        if (s > 0) { view.lon0 = wrapLon(view.lon0 + (dt / 1000) * s); dirty = true; }
      }
    }
    const pulsing = pulsesOn(liveNow) && items.some((k) => k.live);
    if ((dirty || pulsing) && t - lastDraw >= 1000 / FPS - 2) draw(t);
    frame = win.requestAnimationFrame(tick);
  }
  function wanted() { return !stopped && !reduceMotion && !doc.hidden && onScreen; }
  function start() {
    if (running || !wanted()) return;
    running = true;
    last = 0;
    frame = win.requestAnimationFrame(tick);
  }
  function pause() {
    running = false;
    win.cancelAnimationFrame(frame);
  }
  const sync = () => (wanted() ? start() : pause());
  const touched = () => { lastTouch = clock(); };
  const redraw = () => { dirty = true; if (!running) draw(); };

  // ---- drag, momentum, hover and tap ----
  let pointer = null; // { id, x, y, t, moved, type }
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - (r.left || 0), e.clientY - (r.top || 0)];
  };
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = at(e);
    pointer = { id: e.pointerId, x, y, sx: x, sy: y, t: e.timeStamp ?? clock(), type: e.pointerType };
    view.v = 0;
    touched();
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* not ours to capture */ }
  }
  function onMove(e) {
    const [x, y] = at(e);
    if (!pointer || e.pointerId !== pointer.id) {
      if (e.pointerType === 'mouse') {
        const p = pickDot(placed, x, y);
        if (p) touched();
        if ((p?.item || null) !== tipItem) showTip(p);
      }
      return;
    }
    const t = e.timeStamp ?? clock();
    const dLon = -pxToDeg(x - pointer.x, geom.R);
    view.lon0 = wrapLon(view.lon0 + dLon);
    // Up and down tilts it with a mouse; on a touch screen that is the page's scroll.
    if (pointer.type !== 'touch') view.tilt = clampTilt(view.tilt + pxToDeg(y - pointer.y, geom.R));
    const dt = Math.max(1, t - pointer.t);
    view.v = clampV(0.6 * (dLon / dt) + 0.4 * view.v);
    pointer.x = x;
    pointer.y = y;
    pointer.t = t;
    if (Math.hypot(x - pointer.sx, y - pointer.sy) >= TAP_PX) { pointer.moved = true; if (tipItem) showTip(null); }
    touched();
    redraw();
  }
  function onUp(e, cancelled = false) {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = pointer;
    pointer = null;
    touched();
    const still = (e.timeStamp ?? clock()) - p.t > 80; // held still before letting go: no flick
    if (!p.moved) {
      view.v = 0;
      if (!cancelled) { const [x, y] = at(e); showTip(pickDot(placed, x, y, p.type === 'touch' ? 14 : 8)); }
    } else if (still || reduceMotion) view.v = 0;
    sync();
  }
  function onKey(e) {
    if (doc.activeElement !== canvas || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
    if (!step) return;
    e.preventDefault();
    view.v = 0;
    view.lon0 = wrapLon(view.lon0 + step[0]);
    view.tilt = clampTilt(view.tilt + step[1]);
    touched();
    draw();
    // Say the place nearest the middle, if there is one near it.
    const mid = pickDot(placed, geom.c, geom.c, geom.R * 0.35);
    showTip(mid);
  }
  const onLeave = (e) => { if (e.pointerType === 'mouse' && !pointer) showTip(null); };
  const onCancel = (e) => onUp(e, true);
  const listen = (el, type, fn) => el.addEventListener?.(type, fn);
  const unlisten = (el, type, fn) => el.removeEventListener?.(type, fn);
  const handlers = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onCancel], ['pointerleave', onLeave], ['keydown', onKey]];
  for (const [type, fn] of handlers) listen(canvas, type, fn);

  // ---- only while on screen and the tab is visible ----
  const onVis = () => sync();
  doc.addEventListener('visibilitychange', onVis);
  let io = null;
  if (typeof win.IntersectionObserver === 'function') {
    io = new win.IntersectionObserver((entries) => {
      onScreen = entries.some((x) => x.isIntersecting);
      sync();
    });
    io.observe(canvas);
  }
  draw();
  start();
  return {
    update(next, nextLive = liveNow) {
      const old = tipItem && `${tipItem.kind}:${tipItem.cc}:${tipItem.name || ''}`;
      items = globeItems(next, geo.centres);
      liveNow = nextLive;
      tipItem = old ? items.find((k) => `${k.kind}:${k.cc}:${k.name || ''}` === old) || null : null;
      redraw();
    },
    stop() {
      stopped = true;
      pause();
      doc.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
      for (const [type, fn] of handlers) unlisten(canvas, type, fn);
      tip?.remove?.();
    },
    get running() { return running; },
    get view() { return { ...view }; },
    get moving() { return moving(clock()); },
    get tip() { return tip && !tip.hidden ? tip.textContent : ''; },
    // For the tests: the dots as last drawn.
    get placed() { return placed.slice(); },
  };
}
