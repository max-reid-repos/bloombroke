// FISHTANK: the S&P 100 as sea life in a tank, drawn on one canvas. One animal per stock:
// size from market cap, colour and depth from today's % change (winners swim near the
// surface, losers near the floor), species from the GICS sector. Animals of a sector
// school together. Hover one for its name, click it to open it. The legend under the
// title strip lights up one sector at a time.
// Data: the same S&P 100 batch as HEATMAP, every member (/api/fishtank), every 60s.

import { esc, q, fmtPct, nyTime, panel, LOADING } from './markets.js';
import { sizeGuard } from './size-guard.js';

// ---- Pure mapping (tested in test/fishtank.test.js) ------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The % change that reaches the surface or the floor: the biggest move today, never
// under 1% so a quiet day does not fling the fish to the walls.
export function depthRange(stocks) {
  let m = 0;
  for (const s of stocks) if (Number.isFinite(s.changePct)) m = Math.max(m, Math.abs(s.changePct));
  return Math.max(1, m);
}

// % change -> depth, 0 = surface, 1 = floor, 0.5 = flat. A square-root curve keeps the
// order but spreads the crowd of small moves over the tank instead of one line.
export function pctToDepth(pct, range = 3) {
  if (!Number.isFinite(pct) || !(range > 0)) return 0.5;
  const t = Math.sqrt(Math.min(1, Math.abs(pct) / range));
  return 0.5 - 0.5 * Math.sign(pct) * t;
}

// Market cap -> fish length in px. Length grows with sqrt(cap), so a fish's area follows
// its cap; the biggest company is `max` long, and no fish is shorter than `min`. With no
// cap (or no largest cap) every fish gets the same `fallback` length.
export function capToSize(cap, maxCap, { max = 80, min = 12, fallback = 26 } = {}) {
  if (!(cap > 0) || !(maxCap > 0)) return fallback;
  return clamp(max * Math.sqrt(cap / maxCap), min, max);
}

// % change -> fish colour: green up, red down, steel when flat. Brighter and more
// saturated as the move grows, full strength at 3%.
export function fishColor(pct) {
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.005) return { h: 208, s: 18, l: 46 };
  const t = Math.min(1, Math.abs(pct) / 3);
  return pct > 0
    ? { h: 147, s: Math.round(34 + 40 * t), l: Math.round(34 + 28 * t) }
    : { h: 0, s: Math.round(44 + 52 * t), l: Math.round(40 + 28 * t) };
}

export const hsl = ({ h, s, l }, a = 1) => (a >= 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${a})`);

// The biggest winner (up only) and biggest loser (down only); null when there is none.
// Ties go to the first ticker in A-Z order, so the pick is stable between refreshes.
export function pickExtremes(stocks) {
  let winner = null;
  let loser = null;
  for (const s of stocks) {
    const p = s.changePct;
    if (!Number.isFinite(p)) continue;
    if (p > 0 && (!winner || p > winner.changePct || (p === winner.changePct && s.ticker < winner.ticker))) winner = s;
    if (p < 0 && (!loser || p < loser.changePct || (p === loser.changePct && s.ticker < loser.ticker))) loser = s;
  }
  return { winner, loser };
}

// "S&P 100 · 63 up · 37 down · updated 14:32" (New York time).
export function tankHeader(stocks, updated) {
  const up = stocks.filter((s) => s.changePct > 0).length;
  const down = stocks.filter((s) => s.changePct < 0).length;
  return { up, down, text: `S&P 100 · ${up} up · ${down} down · updated ${nyTime(updated)}` };
}

// A stable number in [0, 1) for a ticker and a salt: the same fish swims the same way on
// every load.
export function seeded(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---- Species: one per GICS sector ---------------------------------------------------

// Sector key (the same keys as HEATMAP, data/sp100.js) -> legend name and species. The
// legend lists them in this order.
export const SPECIES = {
  TECH: { short: 'TECH', kind: 'swordfish' },
  FIN: { short: 'FIN', kind: 'shark' },
  UTIL: { short: 'UTIL', kind: 'eel' },
  ENERGY: { short: 'ENERGY', kind: 'angler' },
  COMM: { short: 'COMM', kind: 'dolphin' },
  HEALTH: { short: 'HEALTH', kind: 'jelly' },
  DISC: { short: 'DISC', kind: 'clown' },
  STAPLES: { short: 'STAPLES', kind: 'goldfish' },
  IND: { short: 'INDUS', kind: 'puffer' },
  RE: { short: 'RE', kind: 'crab' },
  MAT: { short: 'MAT', kind: 'lobster' },
};

export const SPECIES_NAME = {
  swordfish: 'swordfish', shark: 'shark', eel: 'electric eel', angler: 'anglerfish', dolphin: 'dolphin',
  jelly: 'jellyfish', clown: 'clownfish', goldfish: 'goldfish', puffer: 'pufferfish', crab: 'hermit crab',
  lobster: 'lobster', fish: 'fish',
};

// A sector's species; a stock with no (or an unknown) sector is a plain fish.
export const speciesOf = (sector) => SPECIES[sector]?.kind || 'fish';

// How fast each species moves, as a share of its fish's own cruising speed.
const PACE = {
  swordfish: 1.2, shark: 1.1, dolphin: 1.15, clown: 0.9, goldfish: 0.75, eel: 0.8, angler: 0.7,
  puffer: 0.6, lobster: 0.5, jelly: 0.3, crab: 0.3, fish: 1,
};

// The legend: one entry per sector that has at least one stock, in SPECIES order.
export function legendItems(stocks) {
  const n = new Map();
  for (const s of stocks) if (SPECIES[s.sector]) n.set(s.sector, (n.get(s.sector) || 0) + 1);
  return Object.keys(SPECIES).filter((k) => n.has(k)).map((k) => ({ key: k, ...SPECIES[k], count: n.get(k) }));
}

// Legend buttons: pressing one lights up its sector, pressing it again clears it.
export const toggleSector = (active, key) => (active === key ? null : key);

// A fish's opacity while a sector is lit: its own sector at full, the rest dimmed.
export const DIM = 0.25;
export const sectorAlpha = (sector, active) => (!active || sector === active ? 1 : DIM);

export function legendHtml(items, active, names = {}) {
  return items.map((it) => {
    const name = names[it.key] || it.short;
    // The accessible name starts with the words on the button (TECH, Technology: ...).
    const head = name === it.short ? it.short : `${it.short}, ${name}`;
    const label = `${head}: ${SPECIES_NAME[it.kind]}, ${it.count} ${it.count === 1 ? 'stock' : 'stocks'}`;
    return `<button type="button" class="ft-leg-btn" data-sector="${esc(it.key)}" aria-pressed="${it.key === active}"`
      + ` aria-label="${esc(label)}" title="${esc(label)}"><canvas class="ft-glyph" width="52" height="32" aria-hidden="true"></canvas>`
      + `<span>${esc(it.short)}</span></button>`;
  }).join('');
}

// The ticker tags to draw, in order: [{ f, tag }] with tag crab, winner, loser or sector.
// Nothing lit: every crab, then the day's winner and loser. A sector lit: only its own
// fish are tagged (a dimmed tag would take the room first), crabs, winner and loser, then
// the rest of the sector.
export function tagPlan(fish, { winner = null, loser = null, active = null } = {}) {
  const lit = (f) => !active || f.sector === active;
  const out = [];
  for (const f of fish) if (f.kind === 'crab' && lit(f)) out.push({ f, tag: 'crab' });
  const tagged = new Set();
  for (const [tag, f] of [['winner', winner], ['loser', loser]]) {
    if (f && f.kind !== 'crab' && lit(f) && !tagged.has(f)) { out.push({ f, tag }); tagged.add(f); }
  }
  if (active) for (const f of fish) if (f.sector === active && f.kind !== 'crab' && !tagged.has(f)) out.push({ f, tag: 'sector' });
  return out;
}

// ---- Schools ------------------------------------------------------------------------

// Where each sector's school gathers across the tank, left to right. Chosen so the big
// schools (TECH, HEALTH, FIN) sit apart.
const SCHOOL_ORDER = ['UTIL', 'HEALTH', 'RE', 'TECH', 'STAPLES', 'MAT', 'FIN', 'ENERGY', 'COMM', 'DISC', 'IND'];

// The x a sector's school gathers around at time t (s): its own slot plus a slow drift
// (a few minutes a swing), inside the tank. null for a stock with no sector.
export function sectorCentre(key, t, W) {
  const i = SCHOOL_ORDER.indexOf(key);
  if (i < 0 || !(W > 0)) return null;
  const base = W * (0.06 + 0.88 * (i + 0.5) / SCHOOL_ORDER.length);
  const drift = W * 0.12 * Math.sin(t * (0.028 + seeded(key, 21) * 0.02) + seeded(key, 23) * 6.28);
  return clamp(base + drift, W * 0.07, W * 0.93);
}

// One step of the school: a light boids rule on x only. Each fish cruises at its own
// pace, is pulled towards its sector's centre (a slow species as gently, so every school
// spreads about as wide), matches its school's speed, keeps clear of fish at its own
// depth, and turns before the walls. Depth (y) is data and is never
// touched here. `hold` (the hovered fish) slows to a stop.
export function schoolStep(fish, dt, W, { centre = () => null, hold = null, spread = W * 0.11 } = {}) {
  if (!(dt > 0) || !(W > 0) || !fish.length) return;
  const span = Math.max(60, spread);
  const mean = new Map();
  for (const f of fish) {
    f.ax = 0;
    if (!f.sector) continue;
    const m = mean.get(f.sector) || { v: 0, n: 0 };
    m.v += f.vx; m.n += 1;
    mean.set(f.sector, m);
  }
  // Separation: fish that share a depth push apart sideways. The reach follows the fish
  // lengths (plus a fifth for room), and the push grows with FISH_SCALE, so bigger fish clear
  // each other as fast as the old, smaller ones did.
  for (let i = 0; i < fish.length; i += 1) {
    const a = fish[i];
    for (let j = i + 1; j < fish.length; j += 1) {
      const b = fish[j];
      const reach = (a.len + b.len) * 0.6;
      if (Math.abs(a.y - b.y) > reach * 0.55) continue;
      const dx = b.x - a.x;
      if (Math.abs(dx) >= reach) continue;
      const push = (1 - Math.abs(dx) / reach) * 36 * FISH_SCALE;
      const s = dx > 0 ? 1 : dx < 0 ? -1 : (i % 2 ? 1 : -1);
      a.ax -= s * push; b.ax += s * push;
    }
  }
  for (const f of fish) {
    if (f === hold) { f.vx *= Math.max(0, 1 - dt * 6); continue; }
    let ax = f.ax;
    const cx = f.sector ? centre(f.sector) : null;
    if (cx != null) ax += (cx - f.x) * ((0.85 * f.speed) / span);
    const m = mean.get(f.sector);
    if (m && m.n > 1) ax += (m.v / m.n - f.vx) * 0.35;
    ax += ((f.vx < 0 ? -1 : 1) * f.speed - f.vx) * 0.8; // cruise
    const margin = Math.min(W / 2, f.len * 0.6 + 8);
    if (f.x < margin) ax += (margin - f.x) * 4;
    else if (f.x > W - margin) ax -= (f.x - (W - margin)) * 4;
    const vmax = f.speed * 1.6;
    f.vx = clamp(f.vx + ax * dt, -vmax, vmax);
    f.x += f.vx * dt;
    const lo = Math.min(W / 2, f.len * 0.5);
    if (f.x < lo) { f.x = lo; f.vx = Math.abs(f.vx) * 0.3 + 0.5; } else if (f.x > W - lo) { f.x = W - lo; f.vx = -Math.abs(f.vx) * 0.3 - 0.5; }
    if (Math.abs(f.vx) > 1) f.face += (Math.sign(f.vx) - f.face) * Math.min(1, dt * 2.5);
  }
}

// ---- Drawing the species ---------------------------------------------------------
// Each is drawn at the origin facing right, `L` long, in its direction colour `col`.
// Same family as the plain fish: filled body, a lighter rim, darker fins, a square eye.

const LIT = 'hsl(206, 100%, 94%)';
const EYE = 'hsl(213, 43%, 5%)';
const shade = (c, dl, a = 0.9) => hsl({ ...c, l: clamp(c.l + dl, 4, 94) }, a);

function rim(g, col, lit, a = 0.9) {
  g.lineWidth = lit ? 1.5 : 1;
  g.strokeStyle = lit ? LIT : shade(col, 22, a);
  g.stroke();
}
function eye(g, x, y, L, k = 0.045) {
  const s = Math.max(1.5, L * k);
  g.fillStyle = EYE;
  g.fillRect(x - s / 2, y - s / 2, s, s);
}
function finFill(g, col, a = 0.8) { g.fillStyle = shade(col, -8, a); g.fill(); }

// A soft ice-white glow for the anglerfish lure, drawn once.
let glow = null;
function glowSprite() {
  if (glow) return glow;
  glow = document.createElement('canvas');
  glow.width = 32; glow.height = 32;
  const b = glow.getContext('2d');
  const r = b.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'hsla(195, 100%, 97%, 0.95)');
  r.addColorStop(0.25, 'hsla(197, 100%, 82%, 0.5)');
  r.addColorStop(1, 'hsla(201, 100%, 70%, 0)');
  b.fillStyle = r;
  b.fillRect(0, 0, 32, 32);
  return glow;
}

function plainFish(g, L, col, w, lit) {
  const Hh = L * 0.42;
  g.beginPath();
  g.moveTo(-L * 0.26, 0);
  g.lineTo(-L * 0.5, -Hh * 0.46 + w);
  g.lineTo(-L * 0.43, w * 0.6);
  g.lineTo(-L * 0.5, Hh * 0.46 + w);
  g.closePath();
  finFill(g, col);
  g.beginPath();
  g.moveTo(L * 0.5, 0);
  g.quadraticCurveTo(L * 0.1, -Hh, -L * 0.3, w * 0.25);
  g.quadraticCurveTo(L * 0.1, Hh, L * 0.5, 0);
  g.fillStyle = hsl(col, 0.9);
  g.fill();
  rim(g, col, lit);
  if (L >= 16) {
    g.beginPath();
    g.moveTo(L * 0.2, -Hh * 0.28);
    g.quadraticCurveTo(L * 0.14, 0, L * 0.2, Hh * 0.28);
    g.strokeStyle = shade(col, -14, 0.8);
    g.lineWidth = 1;
    g.stroke();
    eye(g, L * 0.32, -Hh * 0.1, L);
  }
}

// Swordfish: slim body, a long bill, a tall sail and a crescent tail.
function swordfish(g, L, col, w, lit) {
  const H = L * 0.12;
  g.beginPath();
  g.moveTo(-L * 0.32, 0);
  g.quadraticCurveTo(-L * 0.39, -H * 0.6 + w * 0.5, -L * 0.5, -H * 2.1 + w);
  g.quadraticCurveTo(-L * 0.42, w * 0.4, -L * 0.5, H * 2.1 + w);
  g.quadraticCurveTo(-L * 0.39, H * 0.6 + w * 0.5, -L * 0.32, 0);
  finFill(g, col, 0.85);
  g.beginPath();
  g.moveTo(L * 0.13, -H * 0.8);
  g.quadraticCurveTo(L * 0.1, -H * 2.9, -L * 0.01, -H * 2.8);
  g.quadraticCurveTo(L * 0.01, -H * 1.6, -L * 0.07, -H * 0.8);
  g.closePath();
  finFill(g, col, 0.85);
  if (L >= 18) {
    g.beginPath();
    g.moveTo(L * 0.15, H * 0.5);
    g.quadraticCurveTo(L * 0.06, H * 1.5, -L * 0.07, H * 1.8);
    g.quadraticCurveTo(L * 0.05, H * 1.0, L * 0.09, H * 0.6);
    g.closePath();
    finFill(g, col, 0.75);
  }
  g.beginPath();
  g.moveTo(L * 0.25, -H * 0.3);
  g.lineTo(L * 0.5, -H * 0.12);
  g.lineTo(L * 0.25, H * 0.25);
  g.quadraticCurveTo(L * 0.04, H * 1.2, -L * 0.33, H * 0.2);
  g.lineTo(-L * 0.33, -H * 0.2);
  g.quadraticCurveTo(L * 0.02, -H * 1.3, L * 0.25, -H * 0.3);
  g.fillStyle = hsl(col, 0.9);
  g.fill();
  rim(g, col, lit);
  eye(g, L * 0.19, -H * 0.25, L, 0.04);
}

// Shark: pointed snout, a tall swept dorsal fin, long upper tail lobe, gill slits.
function shark(g, L, col, w, lit) {
  const H = L * 0.14;
  g.beginPath();
  g.moveTo(-L * 0.3, -H * 0.35);
  g.quadraticCurveTo(-L * 0.4, -H * 0.9 + w * 0.5, -L * 0.5, -H * 2.2 + w);
  g.quadraticCurveTo(-L * 0.43, -H * 0.5 + w * 0.6, -L * 0.41, w * 0.4);
  g.lineTo(-L * 0.47, H * 1.15 + w * 0.8);
  g.quadraticCurveTo(-L * 0.38, H * 0.5, -L * 0.3, H * 0.3);
  g.closePath();
  finFill(g, col, 0.85);
  g.beginPath();
  g.moveTo(L * 0.1, -H * 0.85);
  g.quadraticCurveTo(L * 0.04, -H * 1.7, -L * 0.07, -H * 2.5);
  g.quadraticCurveTo(-L * 0.06, -H * 1.35, -L * 0.13, -H * 0.72);
  g.closePath();
  finFill(g, col, 0.9);
  g.beginPath();
  g.moveTo(L * 0.17, H * 0.55);
  g.quadraticCurveTo(L * 0.09, H * 1.35, -L * 0.03, H * 2);
  g.quadraticCurveTo(L * 0.04, H * 1.05, L * 0.06, H * 0.75);
  g.closePath();
  finFill(g, col, 0.85);
  g.beginPath();
  g.moveTo(L * 0.5, -H * 0.05);
  g.quadraticCurveTo(L * 0.45, -H * 0.85, L * 0.26, -H * 0.95);
  g.quadraticCurveTo(-L * 0.05, -H * 1.1, -L * 0.32, -H * 0.28);
  g.lineTo(-L * 0.32, H * 0.26);
  g.quadraticCurveTo(-L * 0.02, H * 0.95, L * 0.28, H * 0.72);
  g.quadraticCurveTo(L * 0.44, H * 0.55, L * 0.5, -H * 0.05);
  g.fillStyle = hsl(col, 0.9);
  g.fill();
  rim(g, col, lit);
  if (L >= 26) {
    g.beginPath();
    for (let i = 0; i < 3; i += 1) {
      const x = L * (0.2 - i * 0.035);
      g.moveTo(x, -H * 0.35); g.lineTo(x - L * 0.01, H * 0.3);
    }
    g.strokeStyle = shade(col, -16, 0.8);
    g.lineWidth = 1;
    g.stroke();
  }
  eye(g, L * 0.34, -H * 0.3, L, 0.035);
}

// Electric eel: a long wavy ribbon with a fin along its belly, and now and then a tiny
// spark.
function eel(g, L, col, t, ph, lit, still) {
  const n = 16;
  const top = []; const bot = [];
  const thick = Math.max(1.6, L * 0.065);
  for (let i = 0; i <= n; i += 1) {
    const u = i / n;
    const x = L * (0.5 - u);
    const y = Math.sin(u * 8.5 - t * 4 + ph) * L * 0.06 * (0.2 + u);
    const hw = thick * (u < 0.12 ? 0.55 + u * 3.75 : 1 - (u - 0.12) * 1.06);
    top.push([x, y - hw]); bot.push([x, y + hw]);
  }
  if (L >= 20) {
    g.beginPath();
    for (let i = 3; i <= n - 1; i += 1) (i === 3 ? g.moveTo(bot[i][0], bot[i][1]) : g.lineTo(bot[i][0], bot[i][1] + thick * 0.35 * (1 - i / n) + 0.5));
    g.strokeStyle = shade(col, 20, 0.5);
    g.lineWidth = 1;
    g.stroke();
  }
  g.beginPath();
  g.moveTo(top[0][0], top[0][1]);
  g.quadraticCurveTo(L * 0.5 + thick * 0.9, (top[0][1] + bot[0][1]) / 2, bot[0][0], bot[0][1]);
  for (let i = 1; i <= n; i += 1) g.lineTo(bot[i][0], bot[i][1]);
  for (let i = n; i >= 1; i -= 1) g.lineTo(top[i][0], top[i][1]);
  g.closePath();
  g.fillStyle = hsl(col, 0.9);
  g.fill();
  rim(g, col, lit);
  eye(g, L * 0.44, top[1][1] + thick * 0.45, L, 0.035);
  if (!still) {
    const k = (t * 0.23 + ph) % 1;
    if (k < 0.022) {
      const m = Math.round(n * 0.45);
      const [x, y] = top[m];
      g.beginPath();
      g.moveTo(x - 4, y - 2); g.lineTo(x - 1, y - 5); g.lineTo(x + 1, y - 3); g.lineTo(x + 4, y - 7);
      g.strokeStyle = 'hsla(195, 100%, 92%, 0.9)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
}

// Anglerfish: a big head with an open underbite and a few teeth, a small tail, and a
// stalk from its brow ending in a glowing ice-blue lure.
function angler(g, L, col, t, ph, w, lit) {
  const H = L * 0.26;
  g.beginPath();
  g.moveTo(-L * 0.26, 0);
  g.lineTo(-L * 0.47, -H * 0.75 + w);
  g.quadraticCurveTo(-L * 0.42, w * 0.5, -L * 0.47, H * 0.75 + w);
  g.closePath();
  finFill(g, col);
  const sway = Math.sin(t * 1.4 + ph) * L * 0.03;
  const lx = L * 0.5; const ly = -H * 1.3 + sway;
  g.beginPath();
  g.moveTo(L * 0.14, -H * 1.02);
  g.quadraticCurveTo(L * 0.3, -H * 2.1, lx, ly);
  g.strokeStyle = shade(col, 12, 0.85);
  g.lineWidth = 1;
  g.stroke();
  g.beginPath();
  g.moveTo(L * 0.4, -H * 0.22);
  g.bezierCurveTo(L * 0.36, -H * 1.3, -L * 0.02, -H * 1.3, -L * 0.28, -H * 0.3);
  g.lineTo(-L * 0.28, H * 0.3);
  g.bezierCurveTo(-L * 0.05, H * 1.2, L * 0.36, H * 1.2, L * 0.47, H * 0.12);
  g.lineTo(L * 0.17, H * 0.06);
  g.closePath();
  g.fillStyle = hsl(col, 0.9);
  g.fill();
  rim(g, col, lit);
  if (L >= 20) {
    g.beginPath();
    for (let i = 0; i < 4; i += 1) {
      const u = 0.25 + i * 0.22;
      const x = L * (0.17 + (0.47 - 0.17) * u); const y = H * (0.06 + 0.06 * u);
      g.moveTo(x - L * 0.018, y); g.lineTo(x, y - H * 0.28); g.lineTo(x + L * 0.018, y);
    }
    g.fillStyle = 'hsla(206, 60%, 90%, 0.85)';
    g.fill();
  }
  eye(g, L * 0.2, -H * 0.62, L);
  const r = Math.max(7, L * 0.34) * (1 + 0.12 * Math.sin(t * 2.1 + ph));
  g.drawImage(glowSprite(), lx - r, ly - r, r * 2, r * 2);
  g.fillStyle = 'hsl(195, 100%, 96%)';
  const d = Math.max(1.5, L * 0.035);
  g.fillRect(lx - d / 2, ly - d / 2, d, d);
}

// Dolphin: a short beak and rounded melon, a curved dorsal fin, flukes that beat up and
// down.
function dolphin(g, L, col, w, lit) {
  g.beginPath();
  g.moveTo(-L * 0.37, 0);
  g.lineTo(-L * 0.5, -L * 0.1 + w * 0.6);
  g.quadraticCurveTo(-L * 0.45, w * 0.3, -L * 0.5, L * 0.08 + w * 0.6);
  g.closePath();
  finFill(g, col);
  g.beginPath();
  g.moveTo(L * 0.02, -L * 0.13);
  g.quadraticCurveTo(-L * 0.02, -L * 0.27, -L * 0.13, -L * 0.29);
  g.quadraticCurveTo(-L * 0.08, -L * 0.2, -L * 0.11, -L * 0.1);
  g.closePath();
  finFill(g, col, 0.9);
  g.beginPath();
  g.moveTo(L * 0.5, L * 0.02);
  g.lineTo(L * 0.41, -L * 0.005);
  g.quadraticCurveTo(L * 0.38, -L * 0.12, L * 0.26, -L * 0.13);
  g.bezierCurveTo(L * 0.05, -L * 0.15, -L * 0.2, -L * 0.1, -L * 0.38, -L * 0.022);
  g.lineTo(-L * 0.38, L * 0.022);
  g.bezierCurveTo(-L * 0.15, L * 0.09, L * 0.15, L * 0.13, L * 0.34, L * 0.07);
  g.quadraticCurveTo(L * 0.43, L * 0.045, L * 0.5, L * 0.02);
  g.fillStyle = hsl(col, 0.9);
  g.fill();
  rim(g, col, lit);
  if (L >= 16) {
    g.beginPath();
    g.moveTo(L * 0.19, L * 0.07);
    g.quadraticCurveTo(L * 0.13, L * 0.17, L * 0.06, L * 0.2);
    g.quadraticCurveTo(L * 0.1, L * 0.12, L * 0.11, L * 0.085);
    g.closePath();
    finFill(g, col, 0.85);
    g.beginPath();
    g.moveTo(L * 0.42, L * 0.022); g.lineTo(L * 0.34, L * 0.03);
    g.strokeStyle = shade(col, -16, 0.8);
    g.lineWidth = 1;
    g.stroke();
  }
  eye(g, L * 0.31, -L * 0.035, L, 0.035);
}

// Jellyfish: a bell with a scalloped rim that pulses, trailing tentacles.
function jelly(g, L, col, t, ph, lit) {
  const p = Math.sin(t * 1.6 + ph);
  const bw = L * 0.3 * (1 + 0.07 * p);
  const bh = L * 0.34 * (1 - 0.06 * p);
  const rimY = L * 0.06;
  g.lineCap = 'round';
  g.lineWidth = 1;
  g.strokeStyle = shade(col, 8, 0.55);
  g.beginPath();
  for (let j = 0; j < 5; j += 1) {
    const x0 = -bw * 0.72 + j * (bw * 1.44 / 4);
    g.moveTo(x0, rimY);
    for (let s = 1; s <= 7; s += 1) {
      g.lineTo(x0 + Math.sin(s * 0.85 - t * 2 + ph + j * 1.3) * L * 0.035 * (s / 7 + 0.3), rimY + s * L * 0.058);
    }
  }
  g.stroke();
  g.beginPath();
  for (let j = 0; j < 2; j += 1) {
    const x0 = (j ? 1 : -1) * bw * 0.16;
    g.moveTo(x0, rimY);
    for (let s = 1; s <= 5; s += 1) g.lineTo(x0 + Math.sin(s * 1.1 - t * 1.6 + ph + j * 2) * L * 0.03, rimY + s * L * 0.05);
  }
  g.lineWidth = Math.max(1.5, L * 0.04);
  g.strokeStyle = shade(col, 4, 0.5);
  g.stroke();
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(-bw, rimY);
  g.bezierCurveTo(-bw * 1.04, rimY - bh * 1.33, bw * 1.04, rimY - bh * 1.33, bw, rimY);
  const n = 5;
  for (let i = 0; i < n; i += 1) {
    const x0 = bw - (2 * bw * i) / n; const x1 = bw - (2 * bw * (i + 1)) / n;
    g.quadraticCurveTo((x0 + x1) / 2, rimY + bh * 0.16, x1, rimY);
  }
  g.closePath();
  g.fillStyle = hsl(col, 0.6);
  g.fill();
  rim(g, col, lit);
  if (L >= 20) {
    g.beginPath();
    g.ellipse(0, rimY - bh * 0.42, bw * 0.46, bh * 0.28, 0, Math.PI, 2 * Math.PI);
    g.strokeStyle = shade(col, 22, 0.45);
    g.lineWidth = 1;
    g.stroke();
  }
}

// Clownfish: a round-nosed oval with three pale bands edged dark, rounded fins.
function clown(g, L, col, w, lit) {
  const H = L * 0.25;
  const edge = shade(col, -24, 0.9);
  g.beginPath();
  g.moveTo(-L * 0.27, 0);
  g.bezierCurveTo(-L * 0.4, -H * 1.3 + w, -L * 0.55, -H * 0.7 + w, -L * 0.5, w);
  g.bezierCurveTo(-L * 0.55, H * 0.7 + w, -L * 0.4, H * 1.3 + w, -L * 0.27, 0);
  finFill(g, col, 0.85);
  g.strokeStyle = edge; g.lineWidth = 1; g.stroke();
  g.beginPath();
  g.moveTo(L * 0.2, -H * 0.86);
  g.quadraticCurveTo(L * 0.1, -H * 1.6, 0, -H * 1.05);
  g.quadraticCurveTo(-L * 0.12, -H * 1.55, -L * 0.24, -H * 0.5);
  g.closePath();
  finFill(g, col, 0.85);
  g.strokeStyle = edge; g.stroke();
  const body = () => {
    g.beginPath();
    g.moveTo(L * 0.45, H * 0.05);
    g.bezierCurveTo(L * 0.43, -H * 1.1, -L * 0.12, -H * 1.18, -L * 0.3, -H * 0.3);
    g.lineTo(-L * 0.3, H * 0.3);
    g.bezierCurveTo(-L * 0.12, H * 1.18, L * 0.43, H * 1.1, L * 0.45, H * 0.05);
  };
  body();
  g.fillStyle = hsl(col, 0.92);
  g.fill();
  g.save();
  body();
  g.clip();
  const bw = Math.max(0.9, L * 0.045);
  g.beginPath();
  for (const bx of [0.25, 0.02, -0.22]) {
    const x = L * bx;
    g.moveTo(x + bw, -H * 1.3);
    g.quadraticCurveTo(x + L * 0.05 + bw, 0, x + bw, H * 1.3);
    g.lineTo(x - bw, H * 1.3);
    g.quadraticCurveTo(x + L * 0.05 - bw, 0, x - bw, -H * 1.3);
    g.closePath();
  }
  g.fillStyle = `hsla(${col.h}, 30%, 92%, 0.9)`;
  g.fill();
  if (L >= 20) { g.strokeStyle = edge; g.lineWidth = 1; g.stroke(); }
  g.restore();
  body();
  rim(g, col, lit);
  eye(g, L * 0.35, -H * 0.2, L);
}

// Goldfish: a round body, a tall dorsal fin and a flowing double fan tail.
function goldfish(g, L, col, t, ph, w, lit) {
  const w2 = Math.sin(t * 2.2 + ph + 1.3) * L * 0.035;
  for (const [sgn, ww] of [[-1, w], [1, w2]]) {
    g.beginPath();
    g.moveTo(-L * 0.07, sgn * L * 0.03);
    g.bezierCurveTo(-L * 0.18, sgn * L * 0.2 + ww, -L * 0.36, sgn * L * 0.26 + ww, -L * 0.49, sgn * L * 0.2 + ww);
    g.bezierCurveTo(-L * 0.56, sgn * L * 0.12 + ww, -L * 0.46, sgn * L * 0.03 + ww * 0.5, -L * 0.3, 0);
    g.lineTo(-L * 0.07, 0);
    g.closePath();
    g.fillStyle = shade(col, 4, 0.55);
    g.fill();
    rim(g, col, lit, 0.6);
  }
  if (L >= 28) {
    g.beginPath();
    for (const sgn of [-1, 1]) for (let i = 0; i < 3; i += 1) {
      g.moveTo(-L * 0.1, sgn * L * 0.02);
      g.lineTo(-L * (0.3 + i * 0.07), sgn * L * (0.2 - i * 0.04) + (sgn < 0 ? w : w2) * 0.8);
    }
    g.strokeStyle = shade(col, 18, 0.3);
    g.lineWidth = 1;
    g.stroke();
  }
  g.beginPath();
  g.moveTo(L * 0.2, -L * 0.17);
  g.bezierCurveTo(L * 0.14, -L * 0.4, -L * 0.02, -L * 0.37, -L * 0.07, -L * 0.1);
  g.closePath();
  finFill(g, col, 0.75);
  g.beginPath();
  g.moveTo(L * 0.14, L * 0.16);
  g.quadraticCurveTo(L * 0.06, L * 0.33 + w2 * 0.5, -L * 0.02, L * 0.31 + w2 * 0.5);
  g.quadraticCurveTo(L * 0.06, L * 0.22, L * 0.08, L * 0.17);
  g.closePath();
  finFill(g, col, 0.7);
  g.beginPath();
  g.moveTo(L * 0.38, L * 0.01);
  g.bezierCurveTo(L * 0.35, -L * 0.25, -L * 0.05, -L * 0.27, -L * 0.1, -L * 0.01);
  g.bezierCurveTo(-L * 0.06, L * 0.26, L * 0.34, L * 0.25, L * 0.38, L * 0.01);
  g.fillStyle = hsl(col, 0.92);
  g.fill();
  rim(g, col, lit);
  eye(g, L * 0.27, -L * 0.06, L, 0.055);
}

// Pufferfish: a round, gently breathing body ringed with short spikes, a pale belly,
// a small tail.
function puffer(g, L, col, t, ph, w, lit) {
  const R = L * 0.3 * (1 + 0.04 * Math.sin(t * 0.9 + ph));
  const cx = L * 0.04;
  g.beginPath();
  g.moveTo(cx - R * 0.85, 0);
  g.lineTo(-L * 0.5, -L * 0.13 + w);
  g.quadraticCurveTo(-L * 0.44, w * 0.5, -L * 0.5, L * 0.13 + w);
  g.closePath();
  finFill(g, col);
  g.beginPath();
  const n = 18;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + 0.17;
    if (Math.cos(a) > 0.9) continue; // the mouth
    const c = Math.cos(a); const s = Math.sin(a);
    g.moveTo(cx + c * R * 0.95, s * R * 0.95);
    g.lineTo(cx + c * R * 1.22, s * R * 1.22);
  }
  g.strokeStyle = shade(col, 16, 0.9);
  g.lineWidth = 1;
  g.stroke();
  g.beginPath();
  g.arc(cx, 0, R, 0, Math.PI * 2);
  g.fillStyle = hsl(col, 0.92);
  g.fill();
  g.beginPath();
  g.arc(cx, 0, R, Math.PI * 0.14, Math.PI * 0.86);
  g.closePath();
  g.fillStyle = shade(col, 16, 0.55);
  g.fill();
  g.beginPath();
  g.arc(cx, 0, R, 0, Math.PI * 2);
  rim(g, col, lit);
  if (L >= 16) {
    const f = Math.sin(t * 6 + ph) * L * 0.03;
    g.beginPath();
    g.moveTo(cx + R * 0.12, R * 0.05);
    g.quadraticCurveTo(cx - R * 0.1, -R * 0.2 + f, cx - R * 0.22, -R * 0.08 + f);
    g.quadraticCurveTo(cx - R * 0.12, R * 0.2 + f, cx + R * 0.12, R * 0.05);
    g.fillStyle = shade(col, 12, 0.55);
    g.fill();
  }
  if (L >= 26) {
    g.fillStyle = shade(col, -18, 0.7);
    for (const [dx, dy] of [[-0.35, -0.5], [-0.05, -0.62], [-0.55, -0.12], [0.2, -0.72]]) g.fillRect(cx + dx * R, dy * R, 1.5, 1.5);
  }
  eye(g, cx + R * 0.48, -R * 0.3, L, 0.06);
}

// Hermit crab: a spiral shell on its back, walking legs, one big claw, eyes on stalks.
// Drawn standing on y = +0.2L.
function crab(g, L, col, t, ph, lit, walking) {
  const step = walking ? Math.sin(t * 8 + ph) : 0;
  g.strokeStyle = shade(col, 10, 0.9);
  g.lineWidth = Math.max(1, L * 0.035);
  g.beginPath();
  for (let k = 0; k < 3; k += 1) {
    const bx = L * (0.08 + k * 0.08);
    const sw = step * (k % 2 ? 1 : -1) * L * 0.035;
    g.moveTo(bx, L * 0.05);
    g.lineTo(bx + L * 0.05 + sw * 0.5, L * 0.08);
    g.lineTo(bx + L * 0.02 + sw, L * 0.2);
  }
  g.stroke();
  g.beginPath();
  g.moveTo(L * 0.24, 0); g.lineTo(L * 0.28, -L * 0.15);
  g.moveTo(L * 0.27, 0); g.lineTo(L * 0.33, -L * 0.13);
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = EYE;
  const e = Math.max(1.5, L * 0.04);
  g.fillRect(L * 0.28 - e / 2, -L * 0.15 - e / 2, e, e);
  g.fillRect(L * 0.33 - e / 2, -L * 0.13 - e / 2, e, e);
  g.beginPath();
  g.ellipse(L * 0.2, L * 0.04, L * 0.1, L * 0.06, 0, 0, Math.PI * 2);
  g.fillStyle = shade(col, -6, 0.95);
  g.fill();
  g.save();
  g.translate(L * 0.36, L * 0.07);
  g.rotate(-0.25);
  g.beginPath();
  g.ellipse(0, 0, L * 0.09, L * 0.06, 0, 0, Math.PI * 2);
  g.fillStyle = shade(col, 4, 0.95);
  g.fill();
  rim(g, col, lit);
  g.beginPath();
  g.moveTo(L * 0.09, 0); g.lineTo(L * 0.01, 0);
  g.strokeStyle = EYE;
  g.lineWidth = 1;
  g.stroke();
  g.restore();
  g.beginPath();
  g.moveTo(L * 0.16, L * 0.13);
  g.bezierCurveTo(L * 0.24, -L * 0.3, -L * 0.22, -L * 0.44, -L * 0.44, -L * 0.2);
  g.bezierCurveTo(-L * 0.38, -L * 0.02, -L * 0.3, L * 0.17, L * 0.16, L * 0.13);
  g.fillStyle = hsl(col, 0.92);
  g.fill();
  rim(g, col, lit);
  g.beginPath();
  const turns = L >= 22 ? 2.4 : 1.5;
  for (let i = 0; i <= 28; i += 1) {
    const a = (i / 28) * turns * Math.PI * 2;
    const r = L * 0.2 * (1 - i / 32);
    const x = -L * 0.06 + Math.cos(a + 2.4) * r; const y = -L * 0.07 + Math.sin(a + 2.4) * r * 0.85;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.strokeStyle = shade(col, -18, 0.75);
  g.lineWidth = 1;
  g.stroke();
}

// Lobster: carapace, a segmented tail and fan, one big claw, long antennae swept back.
function lobster(g, L, col, t, ph, w, lit) {
  const sw = Math.sin(t * 1.3 + ph) * L * 0.04;
  g.beginPath();
  g.moveTo(L * 0.34, -L * 0.05);
  g.quadraticCurveTo(L * 0.66, -L * 0.28, L * 0.05, -L * 0.36 + sw);
  g.moveTo(L * 0.34, -L * 0.03);
  g.quadraticCurveTo(L * 0.58, -L * 0.2, L * 0.16, -L * 0.28 + sw * 0.7);
  g.strokeStyle = shade(col, 8, 0.7);
  g.lineWidth = 1;
  g.stroke();
  g.beginPath();
  for (let k = 0; k < 4; k += 1) {
    const bx = L * (0.08 + k * 0.055);
    g.moveTo(bx, L * 0.07); g.lineTo(bx - L * 0.03, L * 0.19);
  }
  g.strokeStyle = shade(col, 6, 0.85);
  g.stroke();
  g.beginPath();
  g.moveTo(-L * 0.33, L * 0.02);
  g.lineTo(-L * 0.5, -L * 0.07 + w * 0.3);
  g.lineTo(-L * 0.47, L * 0.04 + w * 0.3);
  g.lineTo(-L * 0.5, L * 0.14 + w * 0.3);
  g.closePath();
  finFill(g, col);
  g.beginPath();
  g.moveTo(L * 0.05, -L * 0.1);
  g.quadraticCurveTo(-L * 0.16, -L * 0.12, -L * 0.34, -L * 0.03);
  g.lineTo(-L * 0.34, L * 0.07);
  g.quadraticCurveTo(-L * 0.16, L * 0.1, L * 0.05, L * 0.09);
  g.closePath();
  g.fillStyle = hsl(col, 0.9);
  g.fill();
  rim(g, col, lit);
  if (L >= 18) {
    g.beginPath();
    for (let k = 0; k < 4; k += 1) { const x = -L * (0.03 + k * 0.075); g.moveTo(x, -L * 0.1 + k * 0.012 * L); g.lineTo(x, L * 0.09); }
    g.strokeStyle = shade(col, -16, 0.7);
    g.lineWidth = 1;
    g.stroke();
  }
  g.beginPath();
  g.moveTo(L * 0.26, L * 0.06); g.lineTo(L * 0.38, L * 0.11);
  g.strokeStyle = shade(col, 4, 0.9);
  g.lineWidth = Math.max(1, L * 0.035);
  g.stroke();
  g.beginPath();
  g.moveTo(L * 0.4, -L * 0.02);
  g.quadraticCurveTo(L * 0.38, -L * 0.12, L * 0.18, -L * 0.12);
  g.quadraticCurveTo(L * 0.03, -L * 0.1, L * 0.03, 0);
  g.quadraticCurveTo(L * 0.04, L * 0.1, L * 0.2, L * 0.1);
  g.quadraticCurveTo(L * 0.34, L * 0.08, L * 0.4, -L * 0.02);
  g.fillStyle = hsl(col, 0.92);
  g.fill();
  rim(g, col, lit);
  g.save();
  g.translate(L * 0.47, L * 0.12);
  g.rotate(-0.12);
  g.beginPath();
  g.moveTo(-L * 0.09, 0);
  g.quadraticCurveTo(-L * 0.04, -L * 0.07, L * 0.1, -L * 0.02);
  g.lineTo(L * 0.01, -L * 0.004);
  g.lineTo(L * 0.09, L * 0.03);
  g.quadraticCurveTo(-L * 0.02, L * 0.06, -L * 0.09, 0);
  g.fillStyle = hsl(col, 0.92);
  g.fill();
  rim(g, col, lit);
  g.restore();
  eye(g, L * 0.33, -L * 0.07, L, 0.04);
}

// Draw one animal of `kind` at the origin, facing right. `t` is the animation clock (0
// when still), `ph` its own phase.
export function drawSpecies(g, kind, L, col, { t = 0, ph = 0, speed = 20, lit = false, still = false } = {}) {
  const w = still ? 0 : Math.sin(t * (5 + speed * 0.12) + ph) * L * 0.08;
  switch (kind) {
    case 'swordfish': return swordfish(g, L, col, w, lit);
    case 'shark': return shark(g, L, col, w * 0.8, lit);
    case 'eel': return eel(g, L, col, t, ph, lit, still);
    case 'angler': return angler(g, L, col, t, ph, w, lit);
    case 'dolphin': {
      g.rotate(still ? 0 : Math.sin(t * 1.3 + ph) * 0.05);
      return dolphin(g, L, col, still ? 0 : Math.sin(t * 3 + ph) * L * 0.08, lit);
    }
    case 'jelly': return jelly(g, L, col, t, ph, lit);
    case 'clown': return clown(g, L, col, w, lit);
    case 'goldfish': return goldfish(g, L, col, t, ph, w, lit);
    case 'puffer': return puffer(g, L, col, t, ph, w, lit);
    case 'crab': return crab(g, L, col, t, ph, lit, !still);
    case 'lobster': return lobster(g, L, col, t, ph, w, lit);
    default: return plainFish(g, L, col, w, lit);
  }
}

// Hit area of each species around its centre: half-height as a share of its length, and
// how far below the centre it sits.
const HIT = { jelly: [0.36, 0.06], puffer: [0.36, 0], goldfish: [0.3, 0], angler: [0.32, 0], crab: [0.3, -0.05], clown: [0.28, 0] };

// A legend glyph: the species small, in ice blue, fitted to a 26 x 16 box.
const GLYPH = { jelly: [15, -1], puffer: [19, 0], crab: [19, 1], goldfish: [21, 0], clown: [20, 0], angler: [18, 1], lobster: [19, 1] };
const GLYPH_COL = { h: 201, s: 70, l: 70 };
function drawGlyph(canvas, kind) {
  const b = canvas.getContext?.('2d');
  if (!b) return;
  const [L, dy] = GLYPH[kind] || [22, 0];
  b.setTransform?.(2, 0, 0, 2, 0, 0);
  b.clearRect?.(0, 0, 26, 16);
  b.translate?.(13, 8 + dy);
  drawSpecies(b, kind, L, GLYPH_COL, { still: true });
}

// ---- The tank ----------------------------------------------------------------------

const SURFACE = 16; // px from the top to the waterline
const FLOOR = 22; // px of sand at the bottom
const FRAME_MS = 1000 / 60 - 1.5; // about 60fps at most, whatever the display rate
const ICE = 'hsla(201, 100%, 78%,';

// Fish length limits for a tank w x h. FISH_SCALE sizes every species up together; the
// longest fish is also held to MAX_OF_H of the tank height, so on a short, wide tank the
// mega-caps do not fill the water.
export const FISH_SCALE = 1.4;
export const MAX_OF_H = 0.19;
export function sizeLimits(w, h) {
  const k = FISH_SCALE;
  const max = Math.max(30, Math.min(clamp(Math.sqrt(w * h) * 0.085 * k, 30 * k, 88 * k), h * MAX_OF_H));
  return { max, min: Math.min(Math.max(9 * k, max * 0.16), max * 0.3), fallback: max * 0.4 };
}

// The animation loop. It draws at most about 60 times a second, and only while nothing
// holds it: 'data' (no batch yet), 'hidden' (the tab), 'offscreen' (a DESK panel scrolled
// away), 'reduced' (prefers-reduced-motion). destroy() holds it for good.
export function makeRunner(frame, {
  raf = (cb) => requestAnimationFrame(cb), caf = (id) => cancelAnimationFrame(id), frameMs = FRAME_MS, onStart,
} = {}) {
  const holds = new Set();
  let id = 0; let on = false; let lastDraw = -Infinity;
  function loop(now) {
    id = raf(loop);
    if (now - lastDraw < frameMs) return;
    lastDraw = now;
    frame(now);
  }
  function sync() {
    const go = holds.size === 0;
    if (go && !on) { on = true; lastDraw = -Infinity; onStart?.(); id = raf(loop); } else if (!go && on) { on = false; caf(id); id = 0; }
  }
  return {
    hold(reason, yes = true) {
      if (holds.has('left')) return;
      if (yes) holds.add(reason); else holds.delete(reason);
      sync();
    },
    get running() { return on; },
    destroy() { holds.add('left'); sync(); },
  };
}

function makeTank(host, canvas, tip, { onOpen, reduced, sectorName }) {
  const g = canvas.getContext('2d');
  const font = (getComputedStyle(host).fontFamily || 'monospace');
  let W = 0; let H = 0; let dpr = 1;
  let bg = null; // the still background, drawn once per size
  let fish = []; // one per stock
  const byTicker = new Map();
  let bubbles = [];
  let weeds = [];
  let labels = { winner: null, loser: null };
  let range = 0; // the % change at the surface (and, negative, at the floor)
  let active = null; // the lit sector, or null
  let last = 0; let clock = 0;
  let pointer = null; // { x, y } over the canvas
  let hover = null;
  const textW = new Map(); // label widths, measured once per text
  const runner = makeRunner((now) => frame(now), { onStart: () => { last = 0; } });
  runner.hold('data'); // nothing to draw until the first batch

  const floorY = () => H - FLOOR;
  const band = () => ({ top: SURFACE + 14, bot: floorY() - 12 });
  const centre = (key) => sectorCentre(key, clock, W);

  function paintBackground() {
    bg = document.createElement('canvas');
    bg.width = Math.round(W * dpr); bg.height = Math.round(H * dpr);
    const b = bg.getContext('2d');
    b.scale(dpr, dpr);
    const water = b.createLinearGradient(0, 0, 0, H);
    water.addColorStop(0, 'hsl(206, 52%, 10%)');
    water.addColorStop(0.55, 'hsl(211, 44%, 6%)');
    water.addColorStop(1, 'hsl(213, 43%, 4%)');
    b.fillStyle = water;
    b.fillRect(0, 0, W, H);
    // Light from above: a few faint slanted beams.
    for (let i = 0; i < 5; i += 1) {
      const x = W * (0.12 + i * 0.2 + (seeded('beam', i) - 0.5) * 0.08);
      const wTop = 18 + seeded('bw', i) * 40;
      const beam = b.createLinearGradient(0, SURFACE, 0, floorY());
      beam.addColorStop(0, `${ICE} 0.045)`);
      beam.addColorStop(1, `${ICE} 0)`);
      b.fillStyle = beam;
      b.beginPath();
      b.moveTo(x, SURFACE); b.lineTo(x + wTop, SURFACE);
      b.lineTo(x + wTop + H * 0.28, floorY()); b.lineTo(x + H * 0.18, floorY());
      b.closePath(); b.fill();
    }
    // The waterline: a dashed rule with a tint above it.
    b.fillStyle = `${ICE} 0.035)`;
    b.fillRect(0, 0, W, SURFACE);
    b.strokeStyle = `${ICE} 0.32)`;
    b.lineWidth = 1;
    b.setLineDash([6, 4]);
    b.beginPath(); b.moveTo(0, SURFACE + 0.5); b.lineTo(W, SURFACE + 0.5); b.stroke();
    b.setLineDash([]);
    // Depth marks on the left wall: the move that reaches the surface, flat, the floor.
    const { top, bot } = band();
    const mid = Math.round((top + bot) / 2) + 0.5;
    b.strokeStyle = 'hsla(210, 24%, 40%, 0.22)';
    b.setLineDash([2, 6]);
    b.beginPath(); b.moveTo(0, mid); b.lineTo(W, mid); b.stroke();
    b.setLineDash([]);
    b.font = `10px ${font}`;
    b.fillStyle = 'hsla(208, 24%, 58%, 0.6)';
    b.textBaseline = 'middle';
    b.textAlign = 'left';
    b.fillText('0%', 6, mid - 8);
    if (range) {
      b.fillText(fmtPct(range), 6, top);
      b.fillText(fmtPct(-range), 6, bot);
    }
    // The sand: a low dune with a lit edge and a scatter of pixel grains.
    const fy = floorY();
    const dune = (x) => fy + 2 + Math.sin(x / 90 + 1.3) * 1.6 + Math.sin(x / 37) * 0.8;
    const sand = b.createLinearGradient(0, fy, 0, H);
    sand.addColorStop(0, 'hsl(208, 30%, 13%)');
    sand.addColorStop(1, 'hsl(212, 34%, 7%)');
    b.beginPath();
    b.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) b.lineTo(x, dune(x));
    b.lineTo(W, H);
    b.closePath();
    b.fillStyle = sand;
    b.fill();
    b.beginPath();
    for (let x = 0; x <= W; x += 6) (x ? b.lineTo(x, dune(x)) : b.moveTo(x, dune(x)));
    b.strokeStyle = 'hsla(206, 60%, 80%, 0.45)';
    b.lineWidth = 1;
    b.stroke();
    for (let x = 3; x < W; x += 7) {
      const k = seeded(`s${x}`);
      const y = dune(x) + 4 + k * (H - dune(x) - 7);
      b.fillStyle = `hsla(206, 40%, ${48 + k * 32}%, ${0.25 + k * 0.35})`;
      b.fillRect(x + Math.round(seeded(`t${x}`) * 5), Math.round(y), k > 0.8 ? 2 : 1, 1);
    }
  }

  function makeWeeds() {
    const n = clamp(Math.round(W / 190), 3, 9);
    weeds = Array.from({ length: n }, (_, i) => ({
      x: Math.round(W * ((i + 0.5) / n + (seeded('weed', i) - 0.5) * 0.6 / n)),
      n: Math.round(clamp(H * (0.12 + seeded('wh', i) * 0.16), 60, 220) / 13),
      ph: seeded('wp', i) * 6.28,
    }));
  }

  function makeBubbles() {
    const n = clamp(Math.round((W * H) / 26000), 8, 42);
    bubbles = Array.from({ length: n }, (_, i) => newBubble(i, true));
  }

  function newBubble(i, anywhere = false) {
    const fromWeed = weeds.length && Math.random() < 0.5 ? weeds[i % weeds.length].x + 4 : Math.random() * W;
    return {
      x: fromWeed, y: anywhere ? SURFACE + Math.random() * (floorY() - SURFACE) : floorY() - 2,
      r: 0.8 + Math.random() * 2.2, v: 14 + Math.random() * 22, ph: Math.random() * 6.28,
    };
  }

  // A few seconds of schooling in one go, so a new tank opens with its schools formed.
  function settle(steps = 120) {
    if (!W) return;
    for (let i = 0; i < steps; i += 1) schoolStep(fish, 1 / 30, W, { centre });
    for (const f of fish) { f.x01 = f.x / W; f.face = f.vx < 0 ? -1 : 1; }
  }

  // New data: keep each fish where it is, move it towards its new depth and colour.
  function setStocks(stocks) {
    const was = range;
    range = depthRange(stocks);
    if (range !== was && W) paintBackground();
    const maxCap = stocks.reduce((m, s) => Math.max(m, s.marketCap > 0 ? s.marketCap : 0), 0);
    const lim = sizeLimits(W || 800, H || 500);
    const seen = new Set();
    let born = false;
    fish = stocks.map((s) => {
      seen.add(s.ticker);
      let f = byTicker.get(s.ticker);
      const kind = speciesOf(s.sector);
      if (!f || f.kind !== kind) {
        const dir = seeded(s.ticker, 7) < 0.5 ? -1 : 1;
        const speed = (10 + seeded(s.ticker, 3) * 18) * PACE[kind];
        const cx = sectorCentre(s.sector, clock, 1);
        const x01 = cx == null ? 0.04 + seeded(s.ticker) * 0.92 : clamp(cx + (seeded(s.ticker) - 0.5) * 0.2, 0.03, 0.97);
        f = {
          x01, x: x01 * (W || 800), vx: dir * speed, dir, face: dir, y: null, a: 1,
          speed, ph: seeded(s.ticker, 5) * 6.28, jit: (seeded(s.ticker, 11) - 0.5) * 2,
        };
        byTicker.set(s.ticker, f);
        born = true;
      }
      f.s = s;
      f.kind = kind;
      f.sector = SPECIES[s.sector] ? s.sector : null;
      f.depth = pctToDepth(s.changePct, range);
      f.col = fishColor(s.changePct);
      f.cap = s.marketCap;
      return f;
    });
    for (const t of [...byTicker.keys()]) if (!seen.has(t)) byTicker.delete(t);
    fish.sort((a, b) => (b.cap || 0) - (a.cap || 0)); // big fish at the back
    const ex = pickExtremes(stocks);
    labels = { winner: ex.winner?.ticker || null, loser: ex.loser?.ticker || null };
    applySize(lim, maxCap);
    if (born) settle();
    if (hover && byTicker.get(hover.s.ticker) !== hover) setHover(null);
    runner.hold('data', false);
    if (!runner.running) frame(performance.now(), true);
  }

  function applySize(lim = sizeLimits(W, H), maxCap = fish.reduce((m, f) => Math.max(m, f.cap > 0 ? f.cap : 0), 0)) {
    for (const f of fish) {
      f.len = capToSize(f.cap, maxCap, lim);
      f.x = f.x01 * W;
      if (f.y == null || reduced()) f.y = targetY(f);
    }
  }

  // Depth is data: a fish's y comes from its % change. The hermit crab walks the sand,
  // so its move shows as a tick and a label instead.
  function targetY(f) {
    if (f.kind === 'crab') return floorY() + 3 - f.len * 0.2;
    const { top, bot } = band();
    const pad = f.len * 0.22;
    return clamp(top + f.depth * (bot - top) + f.jit * 5, top + pad, bot - pad);
  }

  // The box changed size (through the size guard): resize the canvas and the scene.
  function resize(w, h) {
    W = w; H = h;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    paintBackground();
    makeWeeds();
    makeBubbles();
    applySize();
    for (const f of fish) f.y = targetY(f);
    frame(performance.now(), true);
  }

  // Light up one sector (null: all).
  function setActive(key) {
    active = key;
    if (!runner.running) frame(performance.now(), true);
  }

  // ---- drawing ----

  function drawFish(f, t, lit, still) {
    g.save();
    g.globalAlpha = f.a;
    g.translate(f.x, f.bobY);
    if (f.kind !== 'jelly') g.scale(Math.abs(f.face) < 0.08 ? 0.08 * Math.sign(f.face || 1) : f.face, 1);
    drawSpecies(g, f.kind, f.len, f.col, { t, ph: f.ph, speed: f.speed, lit, still });
    g.restore();
  }

  const measure = (text) => {
    let w = textW.get(text);
    if (w == null) { w = g.measureText(text).width; textW.set(text, w); }
    return w;
  };

  // A tiny tag beside the fish, on whichever side has room. With `taken` (the tags drawn
  // so far this frame), a tag that would cover another tries the other side, then gives
  // way: hovering the fish still names it.
  function drawLabel(f, text, color, alpha = 1, taken = null) {
    g.font = `600 10px ${font}`;
    const tw = measure(text);
    const gap = f.len * 0.5 + 7;
    const y = f.kind === 'crab' ? f.bobY - f.len * 0.1 : f.bobY;
    const sides = f.x + gap + tw + 4 <= W ? [f.x + gap, f.x - gap - tw] : [f.x - gap - tw, f.x + gap];
    const clear = (x) => !taken || !taken.some((r) => x - 3 < r.x + r.w && r.x < x + tw + 3 && Math.abs(r.y - y) < 13);
    const x = sides.find(clear);
    if (x == null) return;
    taken?.push({ x: x - 3, y, w: tw + 6 });
    g.globalAlpha = alpha;
    g.fillStyle = 'hsla(213, 43%, 4%, 0.72)';
    g.fillRect(x - 3, y - 7, tw + 6, 13);
    g.fillStyle = color;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(text, x, y);
    g.globalAlpha = 1;
  }

  // The crab's move: a small up or down tick over its shell.
  function drawTick(f) {
    const p = f.s.changePct;
    if (!Number.isFinite(p) || p === 0) return;
    const x = f.x - f.face * f.len * 0.08; const y = f.bobY - f.len * 0.45 - 5;
    g.globalAlpha = f.a;
    g.beginPath();
    if (p > 0) { g.moveTo(x - 3.5, y + 2); g.lineTo(x + 3.5, y + 2); g.lineTo(x, y - 2.5); } else { g.moveTo(x - 3.5, y - 2); g.lineTo(x + 3.5, y - 2); g.lineTo(x, y + 2.5); }
    g.closePath();
    g.fillStyle = p > 0 ? 'hsl(147, 70%, 62%)' : 'hsl(0, 100%, 74%)';
    g.fill();
    g.globalAlpha = 1;
  }

  function drawWeeds(t) {
    g.font = `600 13px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    for (const w of weeds) {
      for (let i = 0; i < w.n; i += 1) {
        const k = i / w.n;
        const sway = reduced() ? Math.sin(w.ph + i * 0.5) * 2 : Math.sin(t * 0.9 + w.ph + i * 0.45) * (1.5 + k * 7);
        g.fillStyle = `hsla(186, 50%, ${36 + k * 16}%, ${0.95 - k * 0.35})`;
        g.fillText(i % 2 ? ')' : '(', w.x + sway, floorY() - 2 - i * 13);
      }
    }
  }

  function drawBubbles(t, dt) {
    g.strokeStyle = `${ICE} 0.4)`;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < bubbles.length; i += 1) {
      const b = bubbles[i];
      if (dt) {
        b.y -= b.v * dt;
        if (b.y < SURFACE + 2) { bubbles[i] = newBubble(i); continue; }
      }
      const x = b.x + Math.sin(t * 1.6 + b.ph) * 2.5;
      g.moveTo(x + b.r, b.y);
      g.arc(x, b.y, b.r, 0, 6.2832);
    }
    g.stroke();
  }

  // The fish under a point, front ones first. The fish already hovered gets a slightly
  // bigger target, so its gentle bob never flickers the readout on and off.
  const inside = (f, px, py, k = 1) => {
    const [hh, dy] = HIT[f.kind] || [0.24, 0];
    const dx = (px - f.x) / (Math.max(7, f.len * 0.5) * k);
    const ddy = (py - f.bobY - dy * f.len) / (Math.max(6, f.len * hh) * k);
    return dx * dx + ddy * ddy <= 1;
  };
  function hitTest(px, py) {
    if (hover && fish.includes(hover) && inside(hover, px, py, 1.4)) return hover;
    for (let i = fish.length - 1; i >= 0; i -= 1) if (inside(fish[i], px, py)) return fish[i];
    return null;
  }

  // The readout: filled and measured here, on a pointer event, never in frame().
  let tipW = 0; let tipH = 0;
  function setHover(f) {
    if (f === hover) return;
    hover = f;
    if (!f) { tip.hidden = true; canvas.style.cursor = ''; return; }
    const s = f.s;
    const dir = s.changePct > 0 ? 'up' : s.changePct < 0 ? 'down' : 'flat';
    const sec = f.sector ? sectorName(f.sector) : '';
    tip.innerHTML = `<b>${esc(s.ticker)}</b> ${esc(s.name)}${sec ? ` <span class="ft-tip-sec">· ${esc(sec)}</span>` : ''} <span class="${dir}">${esc(fmtPct(s.changePct))}</span>`;
    tip.hidden = false;
    tipW = tip.offsetWidth; tipH = tip.offsetHeight;
    canvas.style.cursor = 'pointer';
  }
  // Keep the readout by its fish: writes only.
  function placeTip() {
    if (!hover) return;
    const x = clamp(hover.x - tipW / 2, 4, Math.max(4, W - tipW - 4));
    const upper = hover.bobY - hover.len * 0.4 - tipH - 8;
    const y = upper > 2 ? upper : hover.bobY + hover.len * 0.4 + 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function frame(now, still = false) {
    if (!W || !H) return;
    const dt = still || !last ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    const calm = reduced();
    const t = calm ? 0 : clock;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg, 0, 0, W, H);
    drawWeeds(t);
    if (dt) {
      schoolStep(fish, dt, W, { centre, hold: hover });
      for (const f of fish) { f.x01 = f.x / W; f.y += (targetY(f) - f.y) * Math.min(1, dt * 0.8); }
    }
    for (const f of fish) {
      f.bobY = f.y + (calm || f.kind === 'crab' ? 0 : Math.sin(t * 0.7 + f.ph) * 2.5);
      const want = sectorAlpha(f.sector, active);
      f.a = dt ? f.a + (want - f.a) * Math.min(1, dt * 8) : want;
    }
    for (const f of fish) drawFish(f, t, f === hover, calm || !dt);
    drawBubbles(t, dt);
    for (const f of fish) if (f.kind === 'crab') drawTick(f);
    const taken = [];
    const plan = tagPlan(fish, { winner: labels.winner && byTicker.get(labels.winner), loser: labels.loser && byTicker.get(labels.loser), active });
    for (const { f, tag } of plan) {
      if (tag === 'crab') drawLabel(f, `${f.s.ticker} ${fmtPct(f.s.changePct)}`, f.s.changePct >= 0 ? 'hsl(147, 70%, 62%)' : 'hsl(0, 100%, 74%)', f.a, taken);
      else if (tag === 'sector') drawLabel(f, f.s.ticker, 'hsl(206, 45%, 80%)', 0.9, taken);
      else drawLabel(f, f.s.ticker, tag === 'winner' ? 'hsl(147, 70%, 62%)' : 'hsl(0, 100%, 74%)', f.a, taken);
    }
    placeTip();
  }

  // A new screen resolution (the window moved to another display, or a zoom): redraw
  // the canvas sharp at the new pixel ratio. The query is re-armed for the next change.
  let dprQuery = null;
  function watchDpr() {
    dprQuery?.removeEventListener?.('change', onDpr);
    dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) || null;
    dprQuery?.addEventListener?.('change', onDpr);
  }
  function onDpr() {
    watchDpr();
    if (W && H) resize(W, H);
  }
  watchDpr();

  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.offsetX, y: e.offsetY };
    setHover(hitTest(pointer.x, pointer.y));
    if (!runner.running) frame(performance.now(), true);
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    setHover(null);
    if (!runner.running) frame(performance.now(), true);
  });
  canvas.addEventListener('click', (e) => {
    const f = hitTest(e.offsetX, e.offsetY);
    if (f) onOpen(f.s.ticker);
  });

  return {
    setStocks,
    setActive,
    resize,
    hold: (reason, on) => runner.hold(reason, on),
    get running() { return runner.running; },
    redraw: () => frame(performance.now(), true),
    get size() { return { W, H }; },
    destroy() {
      runner.destroy();
      dprQuery?.removeEventListener?.('change', onDpr);
    },
  };
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Fishtank', `<div class="ft-leg" id="ft-leg" role="group" aria-label="Sectors" hidden></div><div class="ft-host" id="ft-host">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'ft-meta', bodyCls: 'flush' });
  const host = el.querySelector('#ft-host');
  const meta = el.querySelector('#ft-meta');
  const leg = el.querySelector('#ft-leg');
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => Boolean(motion?.matches);
  let tank = null;
  let stocks = null;
  let left = false;
  let names = {}; // sector key -> GICS name, from the data
  let active = null; // the lit sector
  let legKey = '';
  const sectorName = (k) => names[k] || SPECIES[k]?.short || k;
  // What holds the animation, besides data: kept here so a tank made later starts right.
  const holds = { hidden: document.hidden, offscreen: typeof IntersectionObserver === 'function', reduced: reduced() };
  const applyHolds = () => { if (tank) for (const [k, v] of Object.entries(holds)) tank.hold(k, v); };

  function mount() {
    host.innerHTML = '<canvas class="ft-canvas" role="img" aria-label="The S&amp;P 100 as fish"></canvas><div class="ft-tip" hidden></div><ul class="ft-sr" aria-label="Every fish"></ul>';
    tank = makeTank(host, host.querySelector('canvas'), host.querySelector('.ft-tip'), { onOpen: (t) => ctx.run(t), reduced, sectorName });
    applyHolds();
  }

  // The legend: a button per sector. Built again only when the set of sectors changes,
  // so a refresh never takes the focus away.
  function buildLegend() {
    if (!leg) return;
    const items = legendItems(stocks);
    const key = items.map((i) => `${i.key}${i.count}`).join(' ');
    if (key === legKey) return;
    legKey = key;
    if (active && !items.some((i) => i.key === active)) setActive(null);
    leg.innerHTML = legendHtml(items, active, names);
    leg.querySelectorAll?.('.ft-leg-btn').forEach((b) => drawGlyph(b.querySelector('canvas'), speciesOf(b.dataset.sector)));
    leg.hidden = !items.length;
  }
  function setActive(key) {
    active = key;
    leg?.querySelectorAll?.('.ft-leg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sector === active)));
    tank?.setActive(active);
  }
  leg?.addEventListener('click', (e) => {
    const b = e.target.closest?.('.ft-leg-btn');
    if (b) setActive(toggleSector(active, b.dataset.sector));
  });
  // Esc clears a lit sector first (and only then goes back a screen, as elsewhere).
  const onKey = (e) => {
    if (e.key !== 'Escape' || !active) return;
    const t = e.target;
    if (t?.closest?.('select, textarea') || (t?.matches?.('input') && t.value)) return;
    e.preventDefault();
    e.stopPropagation();
    setActive(null);
  };
  document.addEventListener('keydown', onKey, true);

  // Size: the canvas sits absolutely inside the box, so it never changes the box; the
  // box size goes through the shared size guard, so a scrollbar that comes and goes
  // cannot start a redraw loop.
  const guard = sizeGuard();
  const now = () => performance.now();
  function fit() {
    if (!tank) return;
    const s = guard.next(host.clientWidth, host.clientHeight, now());
    if (s) tank.resize(s.w, s.h);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  ro?.observe(host);
  // Off screen (a DESK panel scrolled away): no frames.
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => { holds.offscreen = !entries[entries.length - 1].isIntersecting; applyHolds(); })
    : null;
  io?.observe(host);

  const onVis = () => { holds.hidden = document.hidden; applyHolds(); };
  document.addEventListener('visibilitychange', onVis);
  const onMotion = () => { holds.reduced = reduced(); applyHolds(); if (holds.reduced) tank?.redraw(); };
  motion?.addEventListener?.('change', onMotion);
  ctx.onCleanup(() => {
    left = true;
    ro?.disconnect();
    io?.disconnect();
    tank?.destroy();
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onKey, true);
    motion?.removeEventListener?.('change', onMotion);
  });

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/fishtank', { signal: ctx.signal });
      if (left) return;
      stocks = d.stocks;
      if (d.sectors) names = d.sectors;
      if (!tank) mount();
      buildLegend();
      const head = tankHeader(stocks, d.updated);
      meta.innerHTML = `<span class="ft-idx">S&amp;P 100 · </span><span class="up">${head.up} up</span> · <span class="down">${head.down} down</span>`
        + `<span class="ft-upd"> · updated ${esc(nyTime(d.updated))}</span><span class="ft-key"><span class="ft-sep"> · </span><span class="ft-long">size = company size</span><span class="ft-short">size = cap</span> · depth = today's %</span>`;
      host.querySelector('canvas').setAttribute('aria-label', `The S&P 100 as fish: ${head.up} up, ${head.down} down`);
      // The same fish as links, for keyboards and screen readers (shown on focus).
      host.querySelector('.ft-sr').innerHTML = [...stocks].sort((a, b) => b.changePct - a.changePct)
        .map((s) => `<li><a href="${esc(q(s.ticker))}" data-cmd="${esc(s.ticker)}">${esc(`${s.ticker} ${s.name}${SPECIES[s.sector] ? ` ${SPECIES[s.sector].short}` : ''} ${fmtPct(s.changePct)}`)}</a></li>`).join('');
      if (!tank.size.W) fit();
      tank.setStocks(stocks);
      tank.setActive(active);
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError' || left) return;
      if (!stocks) host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH FISHTANK', 'warn');
    }
  }

  load();
  ctx.live(load, 60_000);
}
