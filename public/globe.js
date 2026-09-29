// The BBRK globe (BBRK and SPONSOR): a small globe drawn on a canvas in the terminal's
// style. Land is ice-blue dots (public/geo/globe-dots.json, made from the WORLDMAP
// Natural Earth map by scripts/build-globe-dots.js), lit by the real sun: the night side
// is dimmer. Every visitor of the last 7 days is a little pixel figure (globe-sprites.js),
// in a tight bunch round their place: a country at its centre, and a city with 3 or more
// visitors at its place rounded to whole degrees (about 100 km). The server does the
// folding (GET /api/bbrk): the browser only ever gets those places and their counts,
// never a city list, never anything about one visitor, so each figure is made up from
// the place, a number and the day.
//
// Drag it round (mouse or touch; on a phone a mostly vertical drag still scrolls the
// page), with a little momentum after letting go; it turns by itself again after
// IDLE_MS (at 1x). Arrow keys turn it while it has focus. Zoom from 1x to ZOOM_MAX:
// the wheel (or a trackpad pinch) over the globe, toward the pointer; two fingers on it
// on a phone; a double click or double tap; the + and - buttons (and keys); 1x goes
// back. Zoomed in, it is a round lens: the canvas stays the same size, the land gets
// denser (from the WORLDMAP outlines, public/geo/world-110m.json) and the figures a
// little bigger. Hover or tap a bunch: "Tokyo · 12 visitors this week". A place with
// someone on now bobs its first figure (from HERE_MIN people on now, like N HERE NOW).
// At most FPS frames a second, only while it is on screen and the tab is visible.
// Reduced motion: a still globe (it still turns and zooms by hand), no bobbing.

import { HERE_MIN } from './here-now.js';
import { project, LAT_TOP, LAT_BOTTOM } from './screens/worldmap-geo.js';
import { draw as drawSprite, spriteHex, colorFor, dayKey, budget, spotsFor } from './globe-sprites.js';

export const DOTS_URL = new URL('./geo/globe-dots.json', import.meta.url).href;
export const WORLD_URL = new URL('./geo/world-110m.json', import.meta.url).href;
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
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
export const ZOOM_STEP = 2; // a button, a key, a double click
export const DOUBLE_MS = 350; // two taps this close together are a double tap
export const SPRITE_CAP = 240; // figures drawn at most, in all
export const PLACE_Z1 = 9; // figures a place shows at 1x (times the zoom squared); the rest is its +N

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
const LIGHT = [1, 0.7, 0.45];
const LIGHT_ZOOM = [1, 0.8, 0.62];

// The land dots four times as dense, for a big globe: a dot half way between two
// neighbours along a parallel, then a row half way between two rows, where both have land.
// Made once from the shipped grid (rows every `step` degrees of latitude, about `step`
// degrees of distance apart along each), so no new map data. [[lon, lat], ...]
export function denseDots(dots, step = 2.5) {
  const rows = new Map();
  for (const [lon, lat] of dots) {
    const k = Math.round(lat * 10);
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push(lon);
  }
  const lats = [...rows.keys()].sort((a, b) => a - b);
  const along = (lat) => step / Math.max(0.2, Math.cos(lat * RAD));
  const full = lats.map((k) => {
    const lat = k / 10;
    const lons = rows.get(k).sort((a, b) => a - b);
    const gap = along(lat);
    const out = [];
    lons.forEach((l, i) => {
      out.push(l);
      const n = lons[i + 1];
      if (n !== undefined && Math.abs(n - l - gap) < 0.35 * gap) out.push((l + n) / 2);
    });
    return { lat, lons: out, gap };
  });
  const res = [];
  full.forEach((r, i) => {
    for (const l of r.lons) res.push([l, r.lat]);
    const up = full[i + 1];
    if (!up || Math.abs(up.lat - r.lat - step) > 0.3 * step) return;
    let j = 0;
    for (const l of r.lons) {
      while (j < up.lons.length - 1 && Math.abs(up.lons[j + 1] - l) <= Math.abs(up.lons[j] - l)) j += 1;
      const q = up.lons[j];
      if (q !== undefined && Math.abs(q - l) <= up.gap / 2) res.push([(l + q) / 2, (r.lat + up.lat) / 2]);
    }
  });
  return res;
}

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

// The label for a bunch: 'United States · 45 visitors this week', 'Tokyo · 12 visitors
// this week', and for a country that also has city bunches, 'United States, elsewhere ·
// 4 visitors this week'.
export function tipText(item, names = {}) {
  if (!item || !(item.n > 0)) return '';
  const place = item.kind === 'city' ? item.name : `${PLAIN_NAMES[item.cc] || names[item.cc] || item.cc}${item.part ? ', elsewhere' : ''}`;
  return `${place} · ${count(item.n)} ${item.n === 1 ? 'visitor' : 'visitors'} this week`;
}

// Pulses only from HERE_MIN people on now (1 is most likely the viewer).
export const pulsesOn = (live) => Number.isInteger(live) && live >= HERE_MIN;

// The place near a point (px, py on the canvas), or null. placed: [{ item, x, y, r }] of
// the places on the near side, as drawn (r: how far its bunch reaches).
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

// The globe's caption: '7D by place · 4 live now'.
export function globeCaption(d) {
  const live = d?.audience?.live;
  return `7D by place${fin(live) ? ` · ${count(live)} live now` : ''}`;
}

// The canvas's words for a screen reader: the countries and their visitors.
export function globeLabel(d) {
  const g = d?.audience?.globe;
  const list = (g?.countries || []).slice(0, 8).map((c) => `${c.cc} ${count(c.visitors)}`).join(', ');
  return `Globe of visitors by country, last 7 days${list ? `: ${list}` : ''}${fin(g?.other) && g.other > 0 ? `, other ${count(g.other)}` : ''}.`;
}

// ---- zoom -----------------------------------------------------------------------------

export const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(z) ? z : ZOOM_MIN));

// The other way round from ortho(): a point on the unit disc (y down) -> [lon, lat], or
// null off the globe.
export function unortho(x, y, lon0, tilt = TILT) {
  const Y = -y;
  const r2 = x * x + Y * Y;
  if (!(r2 <= 1)) return null;
  const Z = Math.sqrt(1 - r2);
  const t = tilt * RAD;
  const sp = Math.cos(t) * Y + Math.sin(t) * Z;
  const cpcl = -Math.sin(t) * Y + Math.cos(t) * Z;
  return [wrapLon(lon0 + Math.atan2(x, cpcl) / RAD), Math.asin(Math.max(-1, Math.min(1, sp))) / RAD];
}

// Zoom to next, keeping the place under the pointer under it: dx, dy the pointer from
// the centre (px), R the globe's radius at 1x. -> { lon0, tilt, zoom } (the globe turns a
// little so that place stays put; off the globe, it zooms on the middle).
export function zoomAt(view, next, dx = 0, dy = 0, R = 0) {
  const zoom = clampZoom(next);
  const out = { lon0: view.lon0, tilt: view.tilt, zoom };
  if (!(R > 0) || (!dx && !dy)) return out;
  const was = clampZoom(view.zoom);
  const p = unortho(dx / (R * was), dy / (R * was), view.lon0, view.tilt);
  const u = dx / (R * zoom);
  const v = dy / (R * zoom);
  if (!p || u * u + v * v >= 1) return out;
  for (let i = 0; i < 16; i++) {
    const q = unortho(u, v, out.lon0, out.tilt);
    if (!q) break;
    const dLon = wrapLon(p[0] - q[0]);
    const dLat = p[1] - q[1];
    out.lon0 = wrapLon(out.lon0 + dLon);
    out.tilt = clampTilt(out.tilt + dLat);
    if (Math.abs(dLon) < 1e-6 && Math.abs(dLat) < 1e-6) break;
  }
  return out;
}

// A wheel event -> the zoom factor: a mouse wheel notch (100 px) about 1.2x; a trackpad
// pinch (ctrl + wheel, small steps) quicker per pixel.
export function wheelFactor(e) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const k = e.ctrlKey ? 0.01 : 0.0018;
  return Math.exp(-Math.max(-300, Math.min(300, (e.deltaY || 0) * unit)) * k);
}

// Is x, y (px on the canvas) on the globe? geom: { c, R }.
export const overGlobe = (x, y, geom) => geom.R > 0 && Math.hypot(x - geom.c, y - geom.c) <= geom.R + 2;

// Land detail for a zoom: 1 the shipped dots (made denser, denseDots), 2 to 4 finer
// grids from the map outlines, LOD_STEP degrees apart.
export const LOD_STEP = { 2: 0.8, 3: 0.5, 4: 0.35 };
export const levelFor = (zoom) => (zoom < 1.5 ? 1 : zoom < 3 ? 2 : zoom < 4.5 ? 3 : 4);

// CSS px a figure pixel: 2 at 1x (a 16 px figure), 3 from 2x, 4 from 4x.
export const spritePx = (zoom) => (zoom < 2 ? 2 : zoom < 4 ? 3 : 4);

// Figures a place shows at this zoom before its +N.
export const perPlace = (zoom) => Math.round(PLACE_Z1 * clampZoom(zoom) ** 2);

// ---- the figures ------------------------------------------------------------------------

// Where the figures go. places: [{ x, y, count, tagW? }] (their centres, px), biggest
// first; pitch: px from one figure's centre to the next; size: a figure's width (px).
// Each place fills the grid spots round it (spotsFor), nearest first, skipping any spot
// another figure already has: no two figures ever overlap, and a small place next to a
// big one sits round its edge. A place with a +N (tagW: its width, px) then takes the
// first free spots for it, side by side, so the label covers no figure either.
// -> the places, each with sprites: [[left, top], ...], box: [left, top, right, bottom]
// and tag: [left, middle] or null.
export function layoutSprites(places, { pitch, size }) {
  const grid = new Map();
  const cell = (v) => Math.floor(v / pitch) + 32768;
  const key = (cx, cy) => cx * 65536 + cy;
  const free = (x, y) => {
    const cx = cell(x);
    const cy = cell(y);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = grid.get(key(cx + i, cy + j));
        if (list) for (let k = 0; k < list.length; k += 2) if (Math.abs(list[k] - x) < pitch - 0.01 && Math.abs(list[k + 1] - y) < pitch - 0.01) return false;
      }
    }
    return true;
  };
  const take = (x, y) => {
    const k = key(cell(x), cell(y));
    const list = grid.get(k);
    if (list) list.push(x, y); else grid.set(k, [x, y]);
  };
  return places.map((pl) => {
    const cells = pl.tagW > 0 ? Math.max(1, Math.ceil((pl.tagW - size) / pitch) + 1) : 0;
    const spots = spotsFor(pl.count * 3 + 160);
    const sprites = [];
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let k = 0; k < spots.length && sprites.length < pl.count; k++) {
      const x = pl.x + spots[k][0] * pitch;
      const y = pl.y + spots[k][1] * pitch;
      if (!free(x, y)) continue;
      take(x, y);
      sprites.push([x - size / 2, y - size / 2]);
      left = Math.min(left, x - size / 2); top = Math.min(top, y - size / 2);
      right = Math.max(right, x + size / 2); bottom = Math.max(bottom, y + size / 2);
    }
    let tag = null;
    for (let k = 0; cells && sprites.length && k < spots.length && !tag; k++) {
      const x = pl.x + spots[k][0] * pitch;
      const y = pl.y + spots[k][1] * pitch;
      let ok = true;
      for (let c = 0; c < cells && ok; c++) ok = free(x + c * pitch, y);
      if (!ok) continue;
      for (let c = 0; c < cells; c++) take(x + c * pitch, y);
      tag = [x - size / 2, y];
    }
    return { ...pl, sprites, tag, box: sprites.length ? [left, top, right, bottom] : [pl.x, pl.y, pl.x, pl.y] };
  });
}

// The place whose figure is under a point (within slop px), else the nearest place
// (pickDot). placed: [{ item, x, y, r, sprites, size }].
export function pickSprite(placed, px, py, slop = 2) {
  let best = null;
  let bestD = Infinity;
  for (const p of placed) {
    if (!(p.item.n > 0) || !p.sprites) continue;
    for (const [sx, sy] of p.sprites) {
      const dx = Math.max(sx - px, 0, px - (sx + p.size));
      const dy = Math.max(sy - py, 0, py - (sy + p.size));
      const d = Math.hypot(dx, dy);
      if (d <= slop && d < bestD) { best = p; bestD = d; }
    }
  }
  return best || pickDot(placed, px, py, slop);
}

// ---- the land -----------------------------------------------------------------------------

// Land dots made ready to draw: sines and cosines, sorted into 5 degree squares (so a
// zoomed-in frame only looks at the squares in its lens), and the light of each for the
// sun it was last lit for. pairs: [[lon, lat], ...]; step: degrees between dots.
const BUCKET = 5;
const NB_LON = 360 / BUCKET;
const NB = NB_LON * (180 / BUCKET);
const BUCKET_MARGIN = 4 * RAD; // a square's half diagonal, and a little
function makeLand(pairs, step) {
  const n = pairs.length;
  const bucketOf = (lon, lat) => Math.min(180 / BUCKET - 1, Math.max(0, Math.floor((lat + 90) / BUCKET))) * NB_LON
    + Math.min(NB_LON - 1, Math.max(0, Math.floor((wrapLon(lon) + 180) / BUCKET)));
  const start = new Uint32Array(NB + 1);
  const of = new Uint16Array(n);
  for (let i = 0; i < n; i++) { of[i] = bucketOf(pairs[i][0], pairs[i][1]); start[of[i] + 1] += 1; }
  for (let b = 0; b < NB; b++) start[b + 1] += start[b];
  const fill = start.slice(0, NB);
  const land = {
    n, step, start, lsin: new Float64Array(n), lcos: new Float64Array(n), psin: new Float64Array(n), pcos: new Float64Array(n),
    light: new Uint8Array(n), litFor: null, bx: new Float64Array(NB), by: new Float64Array(NB), bz: new Float64Array(NB),
  };
  for (let i = 0; i < n; i++) {
    const [lon, lat] = pairs[i];
    const j = fill[of[i]]++;
    land.lsin[j] = Math.sin(lon * RAD); land.lcos[j] = Math.cos(lon * RAD);
    land.psin[j] = Math.sin(lat * RAD); land.pcos[j] = Math.cos(lat * RAD);
  }
  for (let b = 0; b < NB; b++) {
    const lat = Math.floor(b / NB_LON) * BUCKET - 90 + BUCKET / 2;
    const lon = (b % NB_LON) * BUCKET - 180 + BUCKET / 2;
    [land.bx[b], land.by[b], land.bz[b]] = unit(lon, lat);
  }
  return land;
}

// Each dot's light (0 day, 1 dusk, 2 night: LIGHT's alphas), again when the sun moves.
function relight(land, sun) {
  if (land.litFor === sun) return;
  land.litFor = sun;
  const [sx, sy, sz] = unit(sun[0], sun[1]);
  const { n, lsin, lcos, psin, pcos, light } = land;
  for (let i = 0; i < n; i++) {
    const d = pcos[i] * lcos[i] * sx + pcos[i] * lsin[i] * sy + psin[i] * sz;
    light[i] = d > 0.1 ? 0 : d > -0.1 ? 1 : 2;
  }
}

let dotsPromise = null;
let worldPromise = null;
// The land as drawn at 1x (denseDots), made once per map per page: BBRK and SPONSOR,
// and every visit to them, share it.
const lands = new WeakMap();
export function landOf(geo) {
  let l = lands.get(geo);
  if (!l) {
    const dots = geo.step ? denseDots(geo.dots, geo.step) : geo.dots;
    l = makeLand(dots, (geo.step || 2.5) / 2);
    l.dots = dots;
    lands.set(geo, l);
  }
  return l;
}

// 'M1 2l3 4 5 6z...' (the map's paths: absolute M, relative l, z) -> rings of [x, y].
export function pathRings(d) {
  const out = [];
  let ring = null;
  let x = 0;
  let y = 0;
  let cmd = null;
  const toks = String(d || '').match(/[MLmlz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  for (let i = 0; i < toks.length;) {
    const t = toks[i];
    if (/[MLmlz]/.test(t)) {
      cmd = t;
      i += 1;
      if (t === 'z') { if (ring) out.push(ring); ring = null; }
      continue;
    }
    const a = Number(toks[i]);
    const b = Number(toks[i + 1]);
    i += 2;
    if (cmd === 'M' || cmd === 'm') {
      if (ring) out.push(ring);
      x = cmd === 'M' ? a : x + a;
      y = cmd === 'M' ? b : y + b;
      ring = [[x, y]];
      cmd = cmd === 'M' ? 'L' : 'l';
    } else {
      x = cmd === 'L' ? a : x + a;
      y = cmd === 'L' ? b : y + b;
      ring?.push([x, y]);
    }
  }
  if (ring) out.push(ring);
  return out;
}

// Land dots every step degrees (and about step degrees apart along each parallel) from
// the WORLDMAP outlines (Robinson: a parallel is a straight line across the map, so each
// row is the stretches between where it crosses a country's edges). [[lon, lat], ...]
export function worldDots(world, step) {
  const shapes = (world?.countries || []).map((c) => pathRings(c.d));
  const out = [];
  for (let lat = LAT_BOTTOM + step / 2; lat < LAT_TOP; lat += step) {
    const [x0, y] = project(0, lat);
    const perDeg = project(1, lat)[0] - x0;
    const along = step / Math.max(0.2, Math.cos(lat * RAD));
    const first = -180 + along / 2;
    for (const rs of shapes) {
      const xs = [];
      for (const r of rs) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
          const [xi, yi] = r[i];
          const [xj, yj] = r[j];
          if ((yi > y) !== (yj > y)) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = (xs[k] - x0) / perDeg;
        const b = (xs[k + 1] - x0) / perDeg;
        for (let m = Math.ceil((a - first) / along); first + m * along <= b; m++) out.push([first + m * along, lat]);
      }
    }
  }
  return out;
}

// The land at a detail level (2 to 4), made once per level per page from the map.
const lods = new WeakMap();
export function lodLand(world, level) {
  let byLevel = lods.get(world);
  if (!byLevel) { byLevel = new Map(); lods.set(world, byLevel); }
  let l = byLevel.get(level);
  if (!l) {
    const step = LOD_STEP[level];
    l = makeLand(worldDots(world, step), step);
    byLevel.set(level, l);
  }
  return l;
}

const loadJson = (url, fetchImpl) => fetchImpl(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error('no globe'))));
export function loadDots(fetchImpl = globalThis.fetch) {
  dotsPromise ||= loadJson(DOTS_URL, fetchImpl).catch((e) => { dotsPromise = null; throw e; });
  return dotsPromise;
}
// The map outlines, only once someone zooms in.
export function loadWorld(fetchImpl = globalThis.fetch) {
  worldPromise ||= loadJson(WORLD_URL, fetchImpl).catch((e) => { worldPromise = null; throw e; });
  return worldPromise;
}

// Draw the globe in canvas. globe: the server's audience.globe (or its countries array).
// Returns { update(globe, live), zoom(z), stop(), running, view, ... }. win and doc for
// the tests are the page's own; now() is the clock the frames use; world() loads the map
// outlines for the zoomed-in land; day the figures' day ('YYYY-MM-DD', else today).
export function mountGlobe(canvas, geo, globe = [], {
  reduceMotion = false, live = null, win = window, doc = document, now = null, world: getWorld = loadWorld, day = null,
} = {}) {
  const ctx2 = canvas.getContext('2d');
  const css = win.getComputedStyle(canvas);
  const land = css.getPropertyValue('--globe-land').trim() || 'rgba(108, 203, 255, .35)';
  const hot = css.getPropertyValue('--globe-hot').trim() || '#CFEAFF';
  const rim = css.getPropertyValue('--globe-rim').trim() || 'rgba(108, 203, 255, .25)';
  const tagBg = css.getPropertyValue('--globe-tag').trim() || 'rgba(5, 8, 12, .85)';
  const font = css.fontFamily || 'monospace';
  const clock = now || (() => (win.performance || globalThis.performance).now());
  const names = geo.names || {};
  let items = globeItems(globe, geo.centres);
  let liveNow = live;
  const view = { lon0: startLon(Array.isArray(globe) ? globe : globe?.countries, geo.centres), tilt: TILT, v: 0, zoom: ZOOM_MIN };
  let frame = 0;
  let last = 0;
  let lastDraw = -Infinity;
  let lastTouch = -Infinity; // when someone last dragged, tapped, hovered a place, zoomed or pressed a key
  let running = false;
  let stopped = false;
  let onScreen = true;
  let dirty = true;
  let placed = [];
  let sun = subsolar();
  let sunAt = 0;
  let today = day || dayKey();
  let geom = { w: 0, R: 0, c: 0 };
  let frameMs = 0;
  // The land at 1x, made once per page (landOf); finer land once the map outlines are in.
  const land1 = landOf(geo);
  let worldMap = null;
  let wantedWorld = false;
  const needWorld = () => {
    if (wantedWorld || typeof getWorld !== 'function') return;
    wantedWorld = true;
    Promise.resolve().then(() => getWorld()).then((w) => { if (stopped) return; worldMap = w; redraw(); }).catch(() => { wantedWorld = false; });
  };
  // Each figure, made once a day: seed -> { hex, color }.
  const looks = new Map();
  const lookOf = (k, j) => {
    const seed = `${k.kind}:${k.cc}:${k.name || ''}:${j}:${today}`;
    let s = looks.get(seed);
    if (!s) { s = { hex: spriteHex(seed), color: colorFor(seed) }; looks.set(seed, s); }
    return s;
  };

  // A +N label's width (px), text and padding, in its own font (set before).
  const tagWidth = (text) => Math.ceil(ctx2.measureText?.(text)?.width || text.length * 7) + 4;

  // Setup for the page (not the tests' bare canvas): focusable, keeps its focus when
  // clicked (app.js), a label for the place under the pointer, the zoom buttons.
  canvas.tabIndex = 0;
  canvas.setAttribute?.('data-own-focus', '');
  const fig = canvas.parentElement;
  const make = fig && typeof doc.createElement === 'function';
  const tip = make ? doc.createElement('span') : null;
  if (tip) {
    tip.className = 'globe-tip';
    tip.hidden = true;
    tip.setAttribute?.('aria-live', 'polite');
    fig.appendChild(tip);
  }
  let tipItem = null;
  const buttons = [];
  const zoomBox = make ? doc.createElement('div') : null;
  if (zoomBox) {
    zoomBox.className = 'globe-zoom';
    for (const [k, text, label] of [['in', '+', 'Zoom in'], ['out', '−', 'Zoom out'], ['reset', '1x', 'Back to 1x']]) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'globe-zoom-btn';
      b.textContent = text;
      b.setAttribute?.('aria-label', label);
      if (b.dataset) b.dataset.zoom = k;
      const fn = () => {
        if (b.getAttribute?.('aria-disabled') === 'true') return;
        setZoom(k === 'in' ? view.zoom * ZOOM_STEP : k === 'out' ? view.zoom / ZOOM_STEP : ZOOM_MIN);
      };
      b.addEventListener?.('click', fn);
      buttons.push([b, fn, k]);
      zoomBox.appendChild?.(b);
    }
    fig.appendChild(zoomBox);
  }
  const syncButtons = () => {
    for (const [b, , k] of buttons) {
      const off = k === 'in' ? view.zoom >= ZOOM_MAX - 1e-6 : view.zoom <= ZOOM_MIN + 1e-6;
      b.setAttribute?.('aria-disabled', off ? 'true' : 'false');
    }
  };
  syncButtons();

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, win.devicePixelRatio || 1); // sharp on a phone, cheap on a 3x one
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
    tip.style.top = `${Math.round((canvas.offsetTop || 0) + Math.max(0, p.y - p.r - 6))}px`;
  }
  function showTip(p) {
    tipItem = p ? p.item : null;
    placeTip();
  }

  function draw(t = clock()) {
    const t0 = (win.performance || globalThis.performance)?.now?.() ?? 0;
    const { w, dpr } = size();
    const R = w / 2 - 6;
    const c = w / 2;
    const zoom = view.zoom;
    geom = { w, R, c };
    if (t - sunAt > 60_000) {
      sun = subsolar(); sunAt = t;
      const d = day || dayKey();
      if (d !== today) { today = d; looks.clear(); }
    }
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, w);
    ctx2.strokeStyle = rim;
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.arc(c, c, R, 0, 2 * Math.PI);
    ctx2.stroke();
    // Land, in three passes (day, dusk, night) to keep the canvas state changes few. Each
    // dot a whole number of device pixels on the pixel grid, so a big globe stays crisp.
    // Zoomed in: finer land (once the map is in), and only the squares in the lens.
    const level = levelFor(zoom);
    if (level > 1 && !worldMap) needWorld();
    const L = level > 1 && worldMap ? lodLand(worldMap, level) : land1;
    relight(L, sun);
    // Dot size, CSS px: at 1x as before; zoomed in, about half the gap between dots, so
    // the coasts read.
    const ds = Math.max(1.4, Math.min(3.2, R * zoom * L.step * (L === land1 ? 0.0088 / 1.25 : 0.0088)));
    const dd = Math.max(1, Math.round(ds * dpr)); // in device px
    const half = dd / 2;
    const ta = view.tilt * RAD;
    const st = Math.sin(ta);
    const ct = Math.cos(ta);
    const s0 = Math.sin(view.lon0 * RAD);
    const c0 = Math.cos(view.lon0 * RAD);
    const cx = c * dpr;
    const Rd = R * zoom * dpr;
    const lens = zoom > 1 ? ((R - ds) / (R * zoom)) ** 2 : Infinity;
    const cosLim = zoom > 1 ? Math.cos(Math.min(Math.PI, Math.asin(1 / zoom) + BUCKET_MARGIN)) : -2;
    const [vx, vy, vz] = unit(view.lon0, view.tilt);
    const { lsin, lcos, psin, pcos, light, start } = L;
    const pass = [[], [], []];
    for (let b = 0; b < NB; b++) {
      const e = start[b + 1];
      if (start[b] === e || (zoom > 1 && vx * L.bx[b] + vy * L.by[b] + vz * L.bz[b] < cosLim)) continue;
      for (let i = start[b]; i < e; i++) {
        // ortho(), with sin and cos of (lon - lon0) from the sums.
        const sl = lsin[i] * c0 - lcos[i] * s0;
        const cl = lcos[i] * c0 + lsin[i] * s0;
        const z = st * psin[i] + ct * pcos[i] * cl;
        if (z <= 0) continue;
        const x = pcos[i] * sl;
        const y = -(ct * psin[i] - st * pcos[i] * cl);
        if (x * x + y * y > lens) continue;
        pass[light[i]].push(Math.round(cx + x * Rd - half), Math.round(cx + y * Rd - half));
      }
    }
    ctx2.setTransform(1, 0, 0, 1, 0, 0);
    ctx2.fillStyle = land;
    const lit = zoom > 1 ? LIGHT_ZOOM : LIGHT; // zoomed in, the night side a little less dim
    for (let k = 0; k < 3; k++) {
      const xy = pass[k];
      ctx2.globalAlpha = lit[k];
      for (let i = 0; i < xy.length; i += 2) ctx2.fillRect(xy[i], xy[i + 1], dd, dd);
    }
    ctx2.globalAlpha = 1;
    drawPeople(t, { R, c, dpr, zoom });
    lastDraw = t;
    dirty = false;
    frameMs = ((win.performance || globalThis.performance)?.now?.() ?? 0) - t0;
    placeTip();
  }

  // The visitors: a figure each, in a bunch round their place, biggest place first.
  function drawPeople(t, { R, c, dpr, zoom }) {
    const spx = spritePx(zoom);
    const size = 8 * spx;
    const pitch = size + spx; // a figure pixel between two figures
    const pp = Math.max(1, Math.round(spx * dpr)); // device px a figure pixel
    const shown = budget(items.map((k) => k.n), { cap: SPRITE_CAP, perPlace: perPlace(zoom) });
    const order = items.map((k, i) => i).sort((a, b) => items[b].n - items[a].n || a - b);
    ctx2.font = `600 11px ${font}`;
    const places = [];
    for (const i of order) {
      const k = items[i];
      const [x, y, z] = ortho(k.at[0], k.at[1], view.lon0, view.tilt);
      if (z <= 0) continue;
      const px = c + x * R * zoom;
      const py = c + y * R * zoom;
      if (Math.hypot(px - c, py - c) > R + pitch * 4) continue; // outside the lens
      const more = k.n - shown[i];
      const tagW = more > 0 ? tagWidth(`+${count(more)}`) : 0;
      places.push({ item: k, i, x: px, y: py, count: shown[i], tagW });
    }
    const laid = layoutSprites(places, { pitch, size });
    const pulse = pulsesOn(liveNow);
    // Clip to the globe: zoomed in, it is a round lens.
    ctx2.save();
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.beginPath();
    ctx2.arc(c, c, R, 0, 2 * Math.PI);
    ctx2.clip();
    ctx2.setTransform(1, 0, 0, 1, 0, 0);
    const snap = (v) => Math.round(v * dpr);
    const rings = [];
    for (const p of laid) {
      const k = p.item;
      p.sprites.forEach(([sx, sy], j) => {
        const look = lookOf(k, j);
        let lift = 0;
        if (j === 0 && k.live && pulse) {
          const ph = reduceMotion ? 0 : (((t + p.i * 700) % PULSE_MS) + PULSE_MS) % PULSE_MS / PULSE_MS;
          lift = Math.round(pp * (0.5 - 0.5 * Math.cos(2 * Math.PI * ph)));
          rings.push([snap(sx), snap(sy), ph]);
        }
        drawSprite(ctx2, look.hex, snap(sx), snap(sy) - lift, pp, look.color);
      });
      // A live place with no figure of its own (all its visitors are in city bunches).
      if (!p.sprites.length && k.live && pulse) rings.push([snap(p.x - size / 2), snap(p.y - size / 2), reduceMotion ? 0.35 : (((t + p.i * 700) % PULSE_MS) + PULSE_MS) % PULSE_MS / PULSE_MS]);
    }
    // Someone on now: a soft square ring out from the first figure; with reduced motion
    // one still ring.
    const sd = size * dpr;
    ctx2.strokeStyle = hot;
    ctx2.lineWidth = Math.max(1, Math.round(dpr));
    for (const [x, y, ph0] of rings) {
      const ph = reduceMotion ? 0.35 : ph0;
      const g = Math.round((2 + ph * 8) * dpr);
      ctx2.globalAlpha = 0.5 * (1 - ph);
      ctx2.strokeRect(x - g + 0.5, y - g + 0.5, sd + 2 * g - 1, sd + 2 * g - 1);
    }
    ctx2.globalAlpha = 1;
    // A place with more visitors than figures: +N in the next free spots of its bunch.
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.font = `600 11px ${font}`;
    ctx2.textBaseline = 'middle';
    for (const p of laid) {
      const more = p.item.n - p.sprites.length;
      if (more <= 0 || !p.tag) continue;
      const text = `+${count(more)}`;
      const x = Math.round(p.tag[0]) + 2;
      const y = Math.round(p.tag[1]);
      ctx2.fillStyle = tagBg;
      ctx2.fillRect(x - 2, y - 7, tagWidth(text), 14);
      ctx2.fillStyle = hot;
      ctx2.fillText(text, x, y + 0.5);
    }
    ctx2.restore();
    placed = laid.map((p) => ({
      item: p.item, x: p.x, y: p.y, size,
      r: Math.max(size / 2, Math.hypot(Math.max(p.x - p.box[0], p.box[2] - p.x), Math.max(p.y - p.box[1], p.box[3] - p.y))),
      sprites: p.sprites, shown: p.sprites.length,
    }));
  }

  function moving(t) {
    return pointer !== null || view.v !== 0 || (view.zoom <= ZOOM_MIN && autoSpeed(t - lastTouch) > 0);
  }

  function tick(t) {
    if (!running) return;
    const dt = last ? Math.min(100, t - last) : 0;
    last = t;
    if (pointer === null && !pinch) {
      if (view.v !== 0) {
        view.lon0 = wrapLon(view.lon0 + view.v * dt);
        view.v = decay(view.v, dt);
        if (view.v === 0) lastTouch = t;
        dirty = true;
      } else {
        // Zoomed in, it stays where it was put.
        const s = view.zoom > ZOOM_MIN ? 0 : autoSpeed(t - lastTouch);
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

  // Zoom to z, toward dx, dy (px from the centre; 0, 0 the middle).
  function setZoom(z, dx = 0, dy = 0) {
    const next = zoomAt(view, z, dx, dy, geom.R);
    if (next.zoom === view.zoom && next.lon0 === view.lon0 && next.tilt === view.tilt) return;
    view.lon0 = next.lon0;
    view.tilt = next.tilt;
    view.zoom = next.zoom;
    view.v = 0;
    touched();
    syncButtons();
    redraw();
  }

  // ---- drag, momentum, pinch, wheel, hover and tap ----
  let pointer = null; // { id, x, y, t, moved, type }
  const touches = new Map(); // touch pointers down: id -> [x, y]
  let pinch = null; // { d0, z0 }: two fingers on the globe
  let lastTap = null; // { t, x, y }: for a double tap
  let lastDouble = -Infinity;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - (r.left || 0), e.clientY - (r.top || 0)];
  };
  const pair = () => [...touches.values()].slice(0, 2);
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = at(e);
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [x, y]);
      if (touches.size >= 2) {
        // Two fingers: a pinch zooms; no drag, no tap.
        const [a, b] = pair();
        pinch = { d0: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), z0: view.zoom };
        pointer = null;
        view.v = 0;
        lastTap = null;
        if (tipItem) showTip(null);
        touched();
        try { canvas.setPointerCapture?.(e.pointerId); } catch { /* not ours to capture */ }
        return;
      }
    }
    pointer = { id: e.pointerId, x, y, sx: x, sy: y, t: e.timeStamp ?? clock(), type: e.pointerType };
    view.v = 0;
    touched();
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* not ours to capture */ }
  }
  function onMove(e) {
    const [x, y] = at(e);
    if (pinch && touches.has(e.pointerId)) {
      touches.set(e.pointerId, [x, y]);
      const [a, b] = pair();
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      setZoom(pinch.z0 * (d / pinch.d0), (a[0] + b[0]) / 2 - geom.c, (a[1] + b[1]) / 2 - geom.c);
      return;
    }
    if (!pointer || e.pointerId !== pointer.id) {
      if (e.pointerType === 'mouse') {
        const p = pickSprite(placed, x, y, 2);
        if (p) touched();
        if ((p?.item || null) !== tipItem) showTip(p);
      }
      return;
    }
    const t = e.timeStamp ?? clock();
    const Rz = geom.R * view.zoom; // zoomed in, a pixel turns it less
    const dLon = -pxToDeg(x - pointer.x, Rz);
    view.lon0 = wrapLon(view.lon0 + dLon);
    // Up and down tilts it with a mouse; on a touch screen that is the page's scroll.
    if (pointer.type !== 'touch') view.tilt = clampTilt(view.tilt + pxToDeg(y - pointer.y, Rz));
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
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (pinch) {
      if (touches.size < 2) pinch = null;
      touched();
      return;
    }
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = pointer;
    pointer = null;
    touched();
    const t = e.timeStamp ?? clock();
    const still = t - p.t > 80; // held still before letting go: no flick
    if (!p.moved) {
      view.v = 0;
      if (!cancelled) {
        const [x, y] = at(e);
        // A second tap close by, soon after the first: zoom in there.
        if (p.type === 'touch' && lastTap && t - lastTap.t <= DOUBLE_MS && Math.hypot(x - lastTap.x, y - lastTap.y) <= 30) {
          lastTap = null;
          lastDouble = clock();
          setZoom(view.zoom * ZOOM_STEP, x - geom.c, y - geom.c);
        } else {
          lastTap = p.type === 'touch' ? { t, x, y } : null;
          showTip(pickSprite(placed, x, y, p.type === 'touch' ? 10 : 4));
        }
      }
    } else if (still || reduceMotion) view.v = 0;
    sync();
  }
  function onDbl(e) {
    if (clock() - lastDouble < 600) return; // a double tap already zoomed
    const [x, y] = at(e);
    e.preventDefault?.();
    setZoom(view.zoom * ZOOM_STEP, x - geom.c, y - geom.c);
  }
  // The wheel zooms only over the globe (the page scrolls anywhere else, and at 1x a
  // scroll down is the page's too). ctrl + wheel is a trackpad pinch.
  function onWheel(e) {
    const [x, y] = at(e);
    if (!overGlobe(x, y, geom)) return;
    const f = wheelFactor(e);
    if (!e.ctrlKey && f < 1 && view.zoom <= ZOOM_MIN) return;
    e.preventDefault();
    if (tipItem) showTip(null);
    setZoom(view.zoom * f, x - geom.c, y - geom.c);
  }
  function onKey(e) {
    if (doc.activeElement !== canvas || e.altKey || e.ctrlKey || e.metaKey) return;
    const zk = { '+': ZOOM_STEP, '=': ZOOM_STEP, '-': 1 / ZOOM_STEP, _: 1 / ZOOM_STEP }[e.key];
    if (zk) {
      // Ours, not the command bar's (app.js sends typing there).
      e.preventDefault();
      e.stopPropagation?.();
      setZoom(view.zoom * zk);
      return;
    }
    const step = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
    if (!step) return;
    e.preventDefault();
    view.v = 0;
    view.lon0 = wrapLon(view.lon0 + step[0] / view.zoom);
    view.tilt = clampTilt(view.tilt + step[1] / view.zoom);
    touched();
    draw();
    // Say the place nearest the middle, if there is one near it.
    const mid = pickDot(placed, geom.c, geom.c, geom.R * 0.35);
    showTip(mid);
  }
  const onLeave = (e) => { if (e.pointerType === 'mouse' && !pointer) showTip(null); };
  const onCancel = (e) => onUp(e, true);
  const handlers = [
    ['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onCancel], ['pointerleave', onLeave],
    ['keydown', onKey], ['dblclick', onDbl], ['wheel', onWheel, { passive: false }],
  ];
  for (const [type, fn, opts] of handlers) canvas.addEventListener?.(type, fn, opts);

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
    // Zoom to z (1 to ZOOM_MAX) on the middle, like the buttons.
    zoom(z) { setZoom(z); },
    stop() {
      stopped = true;
      pause();
      doc.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
      for (const [type, fn, opts] of handlers) canvas.removeEventListener?.(type, fn, opts);
      for (const [b, fn] of buttons) b.removeEventListener?.('click', fn);
      tip?.remove?.();
      zoomBox?.remove?.();
    },
    get running() { return running; },
    get view() { return { ...view }; },
    get moving() { return moving(clock()); },
    get tip() { return tip && !tip.hidden ? tip.textContent : ''; },
    // For the tests: the places as last drawn, and how long that frame took (ms).
    get placed() { return placed.slice(); },
    get frameMs() { return frameMs; },
    get level() { return levelFor(view.zoom) > 1 && worldMap ? levelFor(view.zoom) : 1; },
  };
}
