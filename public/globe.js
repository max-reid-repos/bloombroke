// The BBRK globe: a small turning globe, drawn on a canvas in the terminal's style. Land
// is ice-blue dots (public/geo/globe-dots.json, made from the WORLDMAP Natural Earth
// map by scripts/build-globe-dots.js); visitor countries are brighter dots at each
// country's centre, sized by the last 7 days' visitors. Country totals only (the server
// folds countries under 3 visitors into "other"): never a city, never a person's place.
// It stops while the tab is hidden and draws one still frame with reduced motion.

export const DOTS_URL = new URL('./geo/globe-dots.json', import.meta.url).href;
export const TILT = 18; // degrees: the north pole leans toward the viewer
export const TURN_DEG_PER_SEC = 6;

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

// Dot radius (px) for a country's visitors, against the biggest country.
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

// Draw the globe in canvas. countries: [{ cc, visitors }]. Returns { update(countries),
// stop() }. win and doc for the tests are the page's own.
export function mountGlobe(canvas, geo, countries = [], { reduceMotion = false, win = window, doc = document } = {}) {
  const ctx2 = canvas.getContext('2d');
  const css = win.getComputedStyle(canvas);
  const land = css.getPropertyValue('--globe-land').trim() || 'rgba(108, 203, 255, .35)';
  const hot = css.getPropertyValue('--globe-hot').trim() || '#CFEAFF';
  const rim = css.getPropertyValue('--globe-rim').trim() || 'rgba(108, 203, 255, .25)';
  let list = countries;
  let lon0 = startLon(list, geo.centres);
  let frame = 0;
  let last = 0;
  let running = false;

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.max(80, Math.round(r.width));
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr); }
    return { w, dpr };
  }

  function draw() {
    const { w, dpr } = size();
    const R = w / 2 - 6;
    const c = w / 2;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, w);
    ctx2.strokeStyle = rim;
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.arc(c, c, R, 0, 2 * Math.PI);
    ctx2.stroke();
    ctx2.fillStyle = land;
    for (const [lon, lat] of geo.dots) {
      const [x, y, z] = ortho(lon, lat, lon0);
      if (z <= 0) continue;
      ctx2.fillRect(c + x * R - 0.9, c + y * R - 0.9, 1.8, 1.8);
    }
    const max = list.reduce((m, x) => Math.max(m, x.visitors), 0);
    ctx2.fillStyle = hot;
    for (const k of list) {
      const at = geo.centres[k.cc];
      if (!at) continue;
      const [x, y, z] = ortho(at[0], at[1], lon0);
      if (z <= 0) continue;
      ctx2.beginPath();
      ctx2.arc(c + x * R, c + y * R, dotRadius(k.visitors, max), 0, 2 * Math.PI);
      ctx2.globalAlpha = 0.9;
      ctx2.fill();
      ctx2.globalAlpha = 1;
    }
  }

  function tick(t) {
    if (!running) return;
    if (last) lon0 = (lon0 + ((t - last) / 1000) * TURN_DEG_PER_SEC) % 360;
    last = t;
    draw();
    frame = win.requestAnimationFrame(tick);
  }
  function start() {
    if (running || reduceMotion || doc.hidden) return;
    running = true;
    last = 0;
    frame = win.requestAnimationFrame(tick);
  }
  function pause() {
    running = false;
    win.cancelAnimationFrame(frame);
  }
  const onVis = () => { if (doc.hidden) pause(); else start(); };
  doc.addEventListener('visibilitychange', onVis);
  draw();
  start();
  return {
    update(next) { list = Array.isArray(next) ? next : []; if (!running) draw(); },
    stop() { pause(); doc.removeEventListener('visibilitychange', onVis); },
    get running() { return running; },
  };
}
