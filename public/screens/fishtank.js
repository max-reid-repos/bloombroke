// FISHTANK: the S&P 100 as sea life in a tank, drawn on one canvas. One animal per stock:
// size from market cap, colour and depth from today's % change (winners swim near the
// surface, losers near the floor), species from the GICS sector. Animals of a sector
// school together. Hover one for its name, click it to open it. The legend under the
// title strip lights up one sector at a time.
// Data: the same S&P 100 batch as HEATMAP, every member (/api/fishtank), every 60s.

import { esc, q, fmtPct, nyTime, panel, LOADING } from './markets.js';
import { sizeGuard } from './size-guard.js';
import { parseSprite, paintSprite, spriteCache, blit } from '../pixel-sprite.js';
import { SPECIES, parseFishtank as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { SPECIES, parse };

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

// The fish that always show their ticker: the BIG biggest companies (by market cap) and
// today's top and bottom mover. -> { big: [ticker], winner, loser }. A company with two
// share classes (Alphabet A and C) counts once, as its first class.
export const BIG = 5;
const companyOf = (s) => String(s.name || s.ticker).replace(/\s+[A-Z]$/, '');
export function alwaysNamed(stocks, n = BIG) {
  const seen = new Set();
  const big = stocks
    .filter((s) => s.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.ticker < b.ticker ? -1 : 1))
    .filter((s) => { const k = companyOf(s); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n)
    .map((s) => s.ticker);
  const ex = pickExtremes(stocks);
  return { big, winner: ex.winner?.ticker || null, loser: ex.loser?.ticker || null };
}

// NAMES: the toggle in the strip that names every fish (pressed) or only the always-named
// few. A button, so a click, Enter or Space; never in a DESK panel.
export function namesToggleHtml(on = false) {
  return `<button type="button" class="chip ft-names" id="ft-names" aria-pressed="${on}" title="Show the ticker of every fish">NAMES</button>`;
}

// The ticker tags to draw, in order: [{ f, tag, must }] with tag crab, winner, loser, big,
// sector or name. Nothing lit: every crab, the day's winner and loser, the biggest
// companies (big), then with NAMES on (all) every other fish. A sector lit: only its own fish
// are tagged (a dimmed tag would take the room first), in the same order, then the rest
// of the sector. must: always drawn, even over another tag (the others give way).
export function tagPlan(fish, { winner = null, loser = null, active = null, big = [], all = false } = {}) {
  const lit = (f) => !active || f.sector === active;
  const out = [];
  for (const f of fish) if (f.kind === 'crab' && lit(f)) out.push({ f, tag: 'crab', must: f === winner || f === loser || big.includes(f) });
  const tagged = new Set();
  for (const [tag, f] of [['winner', winner], ['loser', loser], ...big.map((b) => ['big', b])]) {
    if (f && f.kind !== 'crab' && lit(f) && !tagged.has(f)) { out.push({ f, tag, must: true }); tagged.add(f); }
  }
  if (active || all) {
    for (const f of fish) if (lit(f) && f.kind !== 'crab' && !tagged.has(f)) out.push({ f, tag: active ? 'sector' : 'name', must: false });
  }
  return out;
}

// The tank is one Tab stop; inside it the arrows walk the fish in this order: biggest
// company first (fish is kept sorted by cap), stopping at either end. -> the next index,
// or i for a key that does not move (Tab leaves the tank as usual).
export function nextFishIndex(i, key, n) {
  if (!(n > 0)) return -1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return i < 0 ? 0 : Math.min(n - 1, i + 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return i < 0 ? 0 : Math.max(0, i - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return i;
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
// A fish's drawn sprite size in CSS px (dw, dh), or, before it has one, its length.
const drawnW = (f) => (f.dw > 0 ? f.dw : f.len);
const drawnH = (f) => (f.dh > 0 ? f.dh : f.len * 0.6);

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
  // Separation: fish that share a depth push apart sideways. The reach follows the drawn
  // sprite widths (plus a fifth for room), the depth test their drawn heights, and the push
  // grows with FISH_SCALE, so bigger fish clear each other as fast as the old, smaller ones did.
  for (let i = 0; i < fish.length; i += 1) {
    const a = fish[i];
    for (let j = i + 1; j < fish.length; j += 1) {
      const b = fish[j];
      const reach = (drawnW(a) + drawnW(b)) * 0.6;
      if (Math.abs(a.y - b.y) > (drawnH(a) + drawnH(b)) * 0.55) continue;
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
    const margin = Math.min(W / 2, drawnW(f) * 0.6 + 8);
    if (f.x < margin) ax += (margin - f.x) * 4;
    else if (f.x > W - margin) ax -= (f.x - (W - margin)) * 4;
    const vmax = f.speed * 1.6;
    f.vx = clamp(f.vx + ax * dt, -vmax, vmax);
    f.x += f.vx * dt;
    const lo = Math.min(W / 2, drawnW(f) * 0.5);
    if (f.x < lo) { f.x = lo; f.vx = Math.abs(f.vx) * 0.3 + 0.5; } else if (f.x > W - lo) { f.x = W - lo; f.vx = -Math.abs(f.vx) * 0.3 - 0.5; }
    if (Math.abs(f.vx) > 1) f.face += (Math.sign(f.vx) - f.face) * Math.min(1, dt * 2.5);
  }
}

// ---- The sprites ------------------------------------------------------------------
// Each species as pixel art, the same family as the globe critters (public/pixel-sprite.js
// has the format): facing right, '#' body, '+' a darker shade (fins, stripes, a shell),
// 'o' the eye, '.' clear. Two frames each: a tail flick, a tentacle pulse, walking legs.

export const FISH_SPRITES = {
  swordfish: [[
    '.......+..............',
    '.......++.............',
    '+......+++............',
    '++....#######.........',
    '.++.#########o#.......',
    '..+###################',
    '.++.##########........',
    '++.....++.............',
    '+.....................',
  ], [
    '.......+..............',
    '.......++.............',
    '.......+++............',
    '+.....#######.........',
    '++..#########o#.......',
    '.++###################',
    '++..##########........',
    '+......++.............',
    '......................',
  ]],
  shark: [[
    '+.......#...........',
    '++......##..........',
    '.++.....###.........',
    '..++.###########....',
    '...+###########o##..',
    '..++###########+####',
    '.+...#########......',
    '.........++.........',
    '........+...........',
  ], [
    '........#...........',
    '+.......##..........',
    '++......###.........',
    '.+++.###########....',
    '...+###########o##..',
    '.+++###########+####',
    '++...#########......',
    '.........++.........',
    '........+...........',
  ]],
  eel: [[
    '....####................',
    '..########.....########.',
    '++##....#############o##',
    '++........+++++....###..',
  ], [
    '++........#####.........',
    '++##....###############.',
    '..########.....######o##',
    '....++++...........###..',
  ]],
  angler: [[
    '......+++++.....',
    '...........+....',
    '....######..##..',
    '..##########....',
    '+.#######o###...',
    '++###########...',
    '+.#######+#+#...',
    '++######++++++..',
    '+.######+#+#+##.',
    '...##########...',
    '....++....++....',
  ], [
    '......+++++.##..',
    '...........+....',
    '....######......',
    '..##########....',
    '.+#######o###...',
    '++###########...',
    '.+#######+#+#...',
    '++######++++++..',
    '.+######+#+#+##.',
    '...##########...',
    '.....++....++...',
  ]],
  dolphin: [[
    '.......+...........',
    '.......++..........',
    '+....#########.....',
    '++.############....',
    '.++############o#..',
    '..##############+##',
    '...###########.....',
    '.......++..........',
    '........+..........',
  ], [
    '.......+...........',
    '.......++..........',
    '.....#########.....',
    '...############....',
    '..#############o#..',
    '.+##############+##',
    '++.###########.....',
    '+......++..........',
    '........+..........',
  ]],
  jelly: [[
    '...#####...',
    '.#########.',
    '###########',
    '##+##+##+##',
    '+++++++++++',
    '.#.+.#.+.#.',
    '.#.+.#.+.#.',
    '..#.+.#.+.#',
    '..#.+.#.+.#',
    '.#.+.#.+.#.',
    '.#...#...#.',
  ], [
    '....###....',
    '..#######..',
    '.#########.',
    '.#+##+##+#.',
    '.+++++++++.',
    '.#.+.#.+.#.',
    '..#.+.#.+.#',
    '..#.+.#.+.#',
    '.#.+.#.+.#.',
    '.#.+.#.+.#.',
    '..#...#...#',
  ]],
  clown: [[
    '......+++......',
    '+...#+##+##+#..',
    '++.##+##+##+##.',
    '.++##+##+##+#o#',
    '.++##+##+##+###',
    '++.##+##+##+##.',
    '+...#+##+##+#..',
    '......++.+.....',
  ], [
    '......+++......',
    '....#+##+##+#..',
    '+..##+##+##+##.',
    '++.##+##+##+#o#',
    '++.##+##+##+###',
    '+..##+##+##+##.',
    '....#+##+##+#..',
    '......++.+.....',
  ]],
  goldfish: [[
    '+.......++.......',
    '++.....+++.......',
    '+++..#######.....',
    '.+++#########....',
    '..++##########o#.',
    '...+############.',
    '..++###########..',
    '.+++##########...',
    '+++..########....',
    '++......+..+.....',
    '+................',
  ], [
    '........++.......',
    '+......+++.......',
    '++...#######.....',
    '+++.#########....',
    '.+++##########o#.',
    '..++############.',
    '.+++###########..',
    '++++##########...',
    '++...########....',
    '+.......+..+.....',
    '.................',
  ]],
  puffer: [[
    '.............',
    '....+...+....',
    '.+..#####..+.',
    '..#########..',
    '.###########.',
    '+#######o###+',
    '.##+#####+##.',
    '+###########+',
    '.##+##+####..',
    '..#########..',
    '.+..#####..+.',
    '....+...+....',
    '.............',
  ], [
    '....+...+....',
    '.+..+...+..+.',
    '..+.#####.+..',
    '..#########..',
    '.###########.',
    '++#######o###',
    '.##+#####+##.',
    '++###########',
    '.##+##+####..',
    '..#########..',
    '..+.#####.+..',
    '.+..+...+..+.',
    '....+...+....',
  ]],
  crab: [[
    '..+++++.........',
    '.+#####+....o.o.',
    '+##++++#+...#.#.',
    '+#+####+#+..###.',
    '+#+#++#+#+.####.',
    '+#+##+#+#+######',
    '.+#++++#+#####.#',
    '..++++++###..##.',
    '......#.#.#.....',
    '.....#.#.#......',
  ], [
    '..+++++.........',
    '.+#####+....o.o.',
    '+##++++#+...#.#.',
    '+#+####+#+..###.',
    '+#+#++#+#+.#####',
    '+#+##+#+#+######',
    '.+#++++#+######.',
    '..++++++###.....',
    '.....#.#.#......',
    '......#.#.#.....',
  ]],
  lobster: [[
    '............++++++..',
    '...............####.',
    '+.............##..##',
    '++#+#+#+#######o##..',
    '+##+#+#+##########..',
    '++#+#+#+#######.....',
    '+.............##..##',
    '...............####.',
    '......+.+.+.+.......',
  ], [
    '............++++++..',
    '...............####.',
    '..............######',
    '.+#+#+#+#######o##..',
    '+##+#+#+##########..',
    '.+#+#+#+#######.....',
    '..............######',
    '...............####.',
    '.....+.+.+.+........',
  ]],
  fish: [[
    '.....+++......',
    '+..#######....',
    '++#########o#.',
    '.+############',
    '++###########.',
    '+..#######....',
    '......++......',
  ], [
    '.....+++......',
    '...#######....',
    '+.#########o#.',
    '++############',
    '.+###########.',
    '++.#######....',
    '+.....++......',
  ]],
};

const SPRITES = Object.fromEntries(Object.entries(FISH_SPRITES).map(([k, frames]) => [k, frames.map((rows, i) => parseSprite(rows, `${k} ${i}`))]));
export const spriteOf = (kind, frame = 0) => (SPRITES[kind] || SPRITES.fish)[frame ? 1 : 0];

// Whether a fish is drawn mirrored: facing left. The jellyfish drifts the same way up
// whichever way it goes, so it never flips (a flip would jump its tentacles).
export const mirrored = (kind, face) => kind !== 'jelly' && face < 0;

// How long each species is drawn, as a share of its fish length: the round ones stay
// shorter, so a jellyfish is not as tall as a swordfish is long.
const FIT = { jelly: 0.65, puffer: 0.8, crab: 0.85, goldfish: 0.9, clown: 0.9, angler: 0.9 };

// Device pixels per sprite pixel for a fish `len` CSS px long: a whole number, so the
// sprite is about as long as the fish's size says and never stretched by a fraction.
export function spriteScale(len, spriteW, dpr = 1, fit = 1) {
  if (!(len > 0) || !(spriteW > 0)) return 1;
  return Math.max(1, Math.round((len * (dpr > 0 ? dpr : 1) * fit) / spriteW));
}

// Frame swaps a second, per species (a swimmer's tail flicks faster the faster it swims).
const RATE = { jelly: 1.2, puffer: 1.4, crab: 3, lobster: 1.6, eel: 2.2, angler: 1.4 };
const rateOf = (kind, speed) => RATE[kind] || 1.8 + speed * 0.05;

// The frame to show at time t (s), with its own phase `ph` (radians): two frames swapped
// `rate` times a second. Reduced motion: always the first frame.
export function animFrame(t, ph = 0, rate = 2, reduced = false) {
  if (reduced || !(rate > 0) || !(t > 0)) return 0;
  return Math.floor(t * rate + ph / 6.2832) % 2 ? 1 : 0;
}

// Colours in buckets: flat, and five steps each way up to full strength at a 3% move
// (fishColor), so the sprite cache holds a few dozen canvases, not one per fish.
export const LEVELS = 5;
const EYE = 'hsl(213, 43%, 5%)';
const LIT = 'hsl(206, 100%, 94%)';
export function colorLevel(pct) {
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.005) return 0;
  return Math.sign(pct) * Math.max(1, Math.ceil(Math.min(1, Math.abs(pct) / 3) * LEVELS - 1e-9));
}
export function spriteColors(pct) {
  const lv = colorLevel(pct);
  const c = fishColor((lv / LEVELS) * 3);
  return { key: String(lv), body: hsl(c), shade: hsl({ ...c, l: clamp(c.l - 15, 8, 90) }), eye: EYE };
}

// A legend glyph: the species at the biggest whole scale that fits a 26 x 16 CSS px
// box at this pixel ratio, in ice blue. The canvas is exactly the sprite times that scale
// in device pixels and shown at that size, so every pixel is the same whole size.
const GLYPH_COLORS = { body: 'hsl(201, 70%, 70%)', shade: 'hsl(201, 55%, 50%)', eye: EYE };
export function drawGlyph(canvas, kind, dpr = 1) {
  const b = canvas?.getContext?.('2d');
  if (!b) return;
  const d = clamp(dpr > 0 ? dpr : 1, 1, 3);
  const sp = spriteOf(kind);
  const p = Math.max(1, Math.floor(Math.min((26 * d) / sp.w, (16 * d) / sp.h)));
  canvas.width = sp.w * p; canvas.height = sp.h * p;
  if (canvas.style) { canvas.style.width = `${canvas.width / d}px`; canvas.style.height = `${canvas.height / d}px`; }
  b.imageSmoothingEnabled = false;
  b.clearRect?.(0, 0, canvas.width, canvas.height);
  paintSprite(b, sp, 0, 0, p, GLYPH_COLORS);
}

// ---- The tank ----------------------------------------------------------------------

const SURFACE = 16; // px from the top to the waterline
export const SCALE_PX = 13; // the 0% and the surface and floor % labels
export const TAG_PX = 12; // a ticker tag
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

function makeTank(host, canvas, tip, { onOpen, reduced, sectorName, onDpr: dprChanged = () => {}, onFocusFish = () => {}, keys = true }) {
  const g = canvas.getContext('2d');
  const font = (getComputedStyle(host).fontFamily || 'monospace');
  let W = 0; let H = 0; let dpr = 1;
  let bg = null; // the still background, drawn once per size
  let fish = []; // one per stock
  const byTicker = new Map();
  let bubbles = [];
  let weeds = [];
  let labels = { winner: null, loser: null, big: [] }; // the always-named tickers
  let allNames = false; // NAMES: every fish named
  let range = 0; // the % change at the surface (and, negative, at the floor)
  let active = null; // the lit sector, or null
  let last = 0; let clock = 0;
  let pointer = null; // { x, y } over the canvas
  let hover = null;
  let focusF = null; // the fish with the keyboard focus ring (Tab, the arrows)
  let tipFish = []; // TIPS (pro/tips.js): small ice-blue fish, named on hover or tap only
  const textW = new Map(); // label widths, measured once per text
  const runner = makeRunner((now) => frame(now), { onStart: () => { last = 0; } });
  runner.hold('data'); // nothing to draw until the first batch

  const floorY = () => H - FLOOR;
  const unit = () => Math.max(1, Math.round(dpr)); // one scenery pixel, in device pixels
  const sprites = spriteCache();
  const band = () => ({ top: SURFACE + 14, bot: floorY() - 12 });
  const centre = (key) => sectorCentre(key, clock, W);

  function paintBackground() {
    bg = document.createElement('canvas');
    bg.width = Math.round(W * dpr); bg.height = Math.round(H * dpr);
    const b = bg.getContext('2d');
    // Everything pixel is drawn in device pixels, in whole units of u.
    const u = unit();
    const DW = bg.width; const DH = bg.height;
    const snap = (v) => Math.round(v / u) * u;
    // The water: flat bands, a shade darker each step down.
    const BANDS = 8;
    for (let i = 0; i < BANDS; i += 1) {
      const k = i / (BANDS - 1);
      const y0 = snap((DH * i) / BANDS); const y1 = i === BANDS - 1 ? DH : snap((DH * (i + 1)) / BANDS);
      b.fillStyle = `hsl(${Math.round(206 + 7 * k)}, ${Math.round(52 - 9 * k)}%, ${(10 - 6 * k).toFixed(1)}%)`;
      b.fillRect(0, y0, DW, y1 - y0);
    }
    // Light from above: a few faint beams in stair steps, fading a step at a time.
    const sy = SURFACE * dpr; const floorD = floorY() * dpr;
    const stepH = u * 6;
    const steps = Math.max(1, Math.ceil((floorD - sy) / stepH));
    for (let i = 0; i < 5; i += 1) {
      const x = W * dpr * (0.12 + i * 0.2 + (seeded('beam', i) - 0.5) * 0.08);
      const wTop = (18 + seeded('bw', i) * 40) * dpr;
      for (let j = 0; j < steps; j += 1) {
        const k = j / steps;
        const a = Math.round(0.045 * (1 - k) * 200) / 200; // fades in whole steps
        if (a <= 0) break;
        b.fillStyle = `${ICE} ${a})`;
        const lx = snap(x + H * dpr * 0.18 * k); const rx = snap(x + wTop + H * dpr * 0.28 * k);
        b.fillRect(lx, snap(sy + j * stepH), rx - lx, stepH);
      }
    }
    // The waterline: a tint above it and a dashed rule of whole pixels.
    b.fillStyle = `${ICE} 0.035)`;
    b.fillRect(0, 0, DW, Math.round(sy));
    b.fillStyle = `${ICE} 0.32)`;
    for (let x = 0; x < DW; x += u * 10) b.fillRect(x, Math.round(sy), u * 6, u);
    // Flat (0%): a solid thin rule across the tank, one scenery pixel tall, labelled on the
    // left wall. The move that reaches the surface and the floor are labelled there too.
    const { top, bot } = band();
    const mid = Math.round((top + bot) / 2);
    b.fillStyle = 'hsla(208, 30%, 60%, 0.3)';
    b.fillRect(0, Math.round(mid * dpr), DW, u);
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.font = `${SCALE_PX}px ${font}`;
    b.fillStyle = 'hsla(208, 30%, 72%, 0.8)';
    b.textBaseline = 'middle';
    b.textAlign = 'left';
    b.fillText('0%', 6, mid - 10);
    if (range) {
      b.fillText(fmtPct(range), 6, top);
      b.fillText(fmtPct(-range), 6, bot);
    }
    // The sand: a low stepped dune, a lit top row and a two-tone dither under it.
    b.setTransform(1, 0, 0, 1, 0, 0);
    const c = u * 2; // one sand cell
    const dune = (x) => floorD + (2 + Math.sin(x / (90 * dpr) + 1.3) * 1.6 + Math.sin(x / (37 * dpr)) * 0.8) * dpr;
    const DARK = ['hsl(208, 30%, 13%)', 'hsl(210, 32%, 10%)', 'hsl(212, 34%, 7%)'];
    for (let x = 0, i = 0; x < DW; x += c, i += 1) {
      const top = snap(dune(x));
      b.fillStyle = 'hsla(206, 60%, 80%, 0.45)';
      b.fillRect(x, top, c, u);
      for (let y = top + u, j = 0; y < DH; y += c, j += 1) {
        const k = (y - top) / Math.max(1, DH - top);
        const band = k < 0.34 ? 0 : k < 0.67 ? 1 : 2;
        b.fillStyle = DARK[band];
        b.fillRect(x, y, c, c);
        // The dither: every other cell a step lighter, thinning out with depth.
        if ((i + j) % 2 === 0 && seeded(`s${i}`, j) > k * 0.9) {
          b.fillStyle = band ? DARK[band - 1] : 'hsl(206, 30%, 17%)';
          b.fillRect(x, y, u, u);
        }
      }
      // A few pale grains.
      const g0 = seeded(`t${i}`);
      if (g0 > 0.82) {
        b.fillStyle = `hsla(206, 40%, ${Math.round(48 + g0 * 32)}%, 0.5)`;
        b.fillRect(x, snap(top + u + (DH - top) * seeded(`g${i}`) * 0.8), u, u);
      }
    }
  }

  // Seaweed: a stalk of square blocks (WEED css px each) with a leaf now and then,
  // swaying a whole block at a time.
  const WEED = 4;
  // A narrow (phone) tank gets fewer, shorter stalks, so the seaweed never hides the fish.
  function makeWeeds() {
    const narrow = W < 640;
    const n = clamp(Math.round(W / 190), narrow ? 2 : 3, 9);
    weeds = Array.from({ length: n }, (_, i) => ({
      x: Math.round(W * ((i + 0.5) / n + (seeded('weed', i) - 0.5) * 0.6 / n)),
      n: Math.round(clamp(H * (narrow ? 0.06 + seeded('wh', i) * 0.08 : 0.12 + seeded('wh', i) * 0.16), 48, 220) / WEED),
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
          speed, ph: seeded(s.ticker, 5) * 6.28, jit: (seeded(s.ticker, 11) - 0.5) * 2, rate: rateOf(kind, speed),
        };
        byTicker.set(s.ticker, f);
        born = true;
      }
      f.s = s;
      f.kind = kind;
      f.sector = SPECIES[s.sector] ? s.sector : null;
      f.depth = pctToDepth(s.changePct, range);
      f.pal = spriteColors(s.changePct);
      f.cap = s.marketCap;
      return f;
    });
    for (const t of [...byTicker.keys()]) if (!seen.has(t)) byTicker.delete(t);
    fish.sort((a, b) => (b.cap || 0) - (a.cap || 0)); // big fish at the back
    labels = alwaysNamed(stocks);
    applySize(lim, maxCap);
    if (born) settle();
    if (hover && !hover.tip && byTicker.get(hover.s.ticker) !== hover) setHover(null);
    if (focusF) setFocus(byTicker.get(focusF.s.ticker) || null);
    runner.hold('data', false);
    if (!runner.running) frame(performance.now(), true);
  }

  function applySize(lim = sizeLimits(W, H), maxCap = fish.reduce((m, f) => Math.max(m, f.cap > 0 ? f.cap : 0), 0)) {
    for (const f of fish) {
      f.len = capToSize(f.cap, maxCap, lim);
      // The sprite's whole-number scale and its drawn size in CSS px.
      const sp = spriteOf(f.kind);
      f.px = spriteScale(f.len, sp.w, dpr, FIT[f.kind]);
      f.dw = (sp.w * f.px) / dpr; f.dh = (sp.h * f.px) / dpr;
      f.x = f.x01 * W;
      if (f.y == null || reduced()) f.y = targetY(f);
    }
  }

  // ---- TIPS: a tip names a small fish (pro/tips.js; /api/fishtank's tips, newest 100).
  // They are no stock: ice blue, the smallest size (half again for $20 and up), at a
  // depth of their own, swimming wall to wall. Hover or tap names one; nothing opens.
  // No tips: the list is empty and the tank is as it was.
  const TIP_PAL = { key: 'tip', body: 'hsl(201, 70%, 70%)', shade: 'hsl(201, 55%, 50%)', eye: EYE };
  function setTips(list) {
    const was = new Map(tipFish.map((f) => [f.key, f]));
    tipFish = (Array.isArray(list) ? list : []).slice(0, 100).filter((t) => t && typeof t.name === 'string').map((t, i) => {
      const key = `${t.name}#${i}`;
      let f = was.get(key);
      if (!f) {
        const dir = seeded(key, 7) < 0.5 ? -1 : 1;
        const speed = 8 + seeded(key, 3) * 10;
        const x01 = 0.04 + seeded(key) * 0.92;
        f = { tip: true, key, kind: 'fish', pal: TIP_PAL, x01, x: x01 * (W || 800), vx: dir * speed, face: dir, y: null, a: 1, ph: seeded(key, 5) * 6.28, rate: rateOf('fish', speed), depth: 0.12 + seeded(key, 9) * 0.76 };
      }
      f.name = t.name.slice(0, 16);
      f.big = Boolean(t.big);
      return f;
    });
    if (hover?.tip && !tipFish.includes(hover)) setHover(null);
    sizeTips();
    if (!runner.running && W) frame(performance.now(), true);
  }
  function tipY(f) {
    const { top, bot } = band();
    const pad = f.dh / 2;
    return clamp(top + f.depth * (bot - top), top + pad, bot - pad);
  }
  function sizeTips(lim = sizeLimits(W || 800, H || 500)) {
    const sp = spriteOf('fish');
    for (const f of tipFish) {
      f.len = lim.min * (f.big ? 1.5 : 1);
      f.px = spriteScale(f.len, sp.w, dpr, FIT.fish);
      f.dw = (sp.w * f.px) / dpr; f.dh = (sp.h * f.px) / dpr;
      if (W) f.x = f.x01 * W;
      if (f.y == null || reduced()) f.y = tipY(f);
    }
  }
  function stepTips(dt) {
    for (const f of tipFish) {
      if (f === hover) continue;
      f.x += f.vx * dt;
      if (f.x < f.dw / 2) { f.x = f.dw / 2; f.vx = Math.abs(f.vx); }
      if (f.x > W - f.dw / 2) { f.x = W - f.dw / 2; f.vx = -Math.abs(f.vx); }
      f.face = f.vx < 0 ? -1 : 1;
      f.x01 = f.x / W;
    }
  }

  // Depth is data: a fish's y comes from its % change. The hermit crab walks the sand,
  // so its move shows as a tick and a label instead.
  function targetY(f) {
    if (f.kind === 'crab') return floorY() + 1 - f.dh / 2;
    const { top, bot } = band();
    const pad = f.dh / 2;
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
    sizeTips();
    for (const f of tipFish) f.y = tipY(f);
    frame(performance.now(), true);
  }

  // Light up one sector (null: all).
  function setActive(key) {
    active = key;
    if (!runner.running) frame(performance.now(), true);
  }

  // ---- drawing ----

  // One fish: its cached sprite canvas, scaled up by a whole number, at whole device
  // pixels (the context is in device pixels here). The hovered fish gets a pale outline.
  function drawFish(f, t, lit, calm) {
    const sp = spriteOf(f.kind, animFrame(t, f.ph, f.rate, calm));
    const img = sprites.get(sp, f.pal.key, f.pal, mirrored(f.kind, f.face), lit ? LIT : null);
    const p = f.px; const o = lit ? p : 0;
    g.globalAlpha = f.a;
    blit(g, img, Math.round(f.x * dpr - (sp.w * p) / 2) - o, Math.round(f.bobY * dpr - (sp.h * p) / 2) - o, p);
    g.globalAlpha = 1;
  }

  const measure = (text) => {
    let w = textW.get(text);
    if (w == null) { w = g.measureText(text).width; textW.set(text, w); }
    return w;
  };

  // A tiny tag beside the fish, on whichever side has room. With `taken` (the tags drawn
  // so far this frame), a tag that would cover another tries the other side, then gives
  // way: hovering the fish still names it.
  // must: drawn even when both sides are taken (an always-named fish).
  function drawLabel(f, text, color, alpha = 1, taken = null, must = false) {
    g.font = `600 ${TAG_PX}px ${font}`;
    const tw = measure(text);
    const gap = f.dw / 2 + 6;
    const y = f.bobY;
    const sides = f.x + gap + tw + 4 <= W ? [f.x + gap, f.x - gap - tw] : [f.x - gap - tw, f.x + gap];
    const clear = (x) => !taken || !taken.some((r) => x - 3 < r.x + r.w && r.x < x + tw + 3 && Math.abs(r.y - y) < TAG_PX + 4);
    const x = sides.find(clear) ?? (must ? sides[0] : null);
    if (x == null) return;
    taken?.push({ x: x - 3, y, w: tw + 6 });
    g.globalAlpha = alpha;
    g.fillStyle = 'hsla(213, 43%, 4%, 0.72)';
    g.fillRect(x - 3, y - TAG_PX / 2 - 2, tw + 6, TAG_PX + 4);
    g.fillStyle = color;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(text, x, y);
    g.globalAlpha = 1;
  }

  // The crab's move: a small up or down pixel arrow over its shell (device pixels).
  function drawTick(f) {
    const p = f.s.changePct;
    if (!Number.isFinite(p) || p === 0) return;
    const u = unit();
    const x = Math.round((f.x * dpr) / u) * u; const y = Math.round(((f.bobY - f.dh / 2 - 7) * dpr) / u) * u;
    g.globalAlpha = f.a;
    g.fillStyle = p > 0 ? 'hsl(147, 70%, 62%)' : 'hsl(0, 100%, 74%)';
    for (let r = 0; r < 3; r += 1) {
      const row = p > 0 ? r : 2 - r; // the wide row at the bottom for up, at the top for down
      g.fillRect(x - row * u, y + r * u, (row * 2 + 1) * u, u);
    }
    g.globalAlpha = 1;
  }

  // The keyboard focus ring: a square of whole scenery pixels round the fish, ice blue
  // (device pixels, like the sprites).
  function drawRing(f) {
    const u = unit();
    const w = 2 * u;
    const pad = 4 * dpr;
    const x0 = Math.round((f.x * dpr - (f.dw * dpr) / 2 - pad) / u) * u;
    const y0 = Math.round((f.bobY * dpr - (f.dh * dpr) / 2 - pad) / u) * u;
    const x1 = Math.round((f.x * dpr + (f.dw * dpr) / 2 + pad) / u) * u;
    const y1 = Math.round((f.bobY * dpr + (f.dh * dpr) / 2 + pad) / u) * u;
    g.fillStyle = 'hsl(201, 100%, 78%)';
    g.fillRect(x0, y0, x1 - x0, w); g.fillRect(x0, y1 - w, x1 - x0, w);
    g.fillRect(x0, y0, w, y1 - y0); g.fillRect(x1 - w, y0, w, y1 - y0);
  }

  // Tones of the seaweed, darkest at the root.
  const WEED_TONES = ['hsla(186, 50%, 36%, 0.95)', 'hsla(186, 50%, 42%, 0.85)', 'hsla(186, 50%, 48%, 0.72)'];
  function drawWeeds(t) {
    const u = unit();
    const B = Math.max(u, Math.round(WEED * dpr / u) * u);
    const tq = Math.floor(t * 3) / 3; // the sway moves in steps, three a second
    const base = Math.round((floorY() - 1) * dpr);
    for (let tone = 0; tone < WEED_TONES.length; tone += 1) {
      g.fillStyle = WEED_TONES[tone];
      for (const w of weeds) {
        const from = Math.floor((w.n * tone) / 3); const to = Math.floor((w.n * (tone + 1)) / 3);
        for (let i = from; i < to; i += 1) {
          const k = i / w.n;
          const sway = t ? Math.sin(tq * 0.9 + w.ph + i * 0.18) * (0.3 + k * 2.2) : Math.sin(w.ph + i * 0.2) * 0.6;
          const x = Math.round(w.x * dpr / u) * u + Math.round(sway) * B;
          const y = base - (i + 1) * B;
          g.fillRect(x, y, B, B);
          if (i > 2 && i % 4 === 0) g.fillRect(x + ((i >> 2) % 2 ? B : -B), y, B, B); // a leaf
        }
      }
    }
  }

  // Bubbles: small squares rising a whole pixel at a time; the big ones hollow.
  function drawBubbles(t, dt) {
    const u = unit();
    g.fillStyle = `${ICE} 0.45)`;
    for (let i = 0; i < bubbles.length; i += 1) {
      const b = bubbles[i];
      if (dt) {
        b.y -= b.v * dt;
        if (b.y < SURFACE + 2) { bubbles[i] = newBubble(i); continue; }
      }
      const x = Math.round((b.x * dpr) / u) * u + Math.round(Math.sin(t * 1.6 + b.ph) * 1.2) * u;
      const y = Math.round((b.y * dpr) / u) * u;
      if (b.r < 2) { g.fillRect(x, y, 2 * u, 2 * u); continue; }
      // A 4 x 4 ring with its corners off.
      g.fillRect(x + u, y, 2 * u, u); g.fillRect(x + u, y + 3 * u, 2 * u, u);
      g.fillRect(x, y + u, u, 2 * u); g.fillRect(x + 3 * u, y + u, u, 2 * u);
    }
  }

  // The fish under a point, front ones first. The fish already hovered gets a slightly
  // bigger target, so its gentle bob never flickers the readout on and off.
  const inside = (f, px, py, k = 1) => {
    const dx = (px - f.x) / (Math.max(7, f.dw * 0.5) * k);
    const ddy = (py - f.bobY) / (Math.max(6, f.dh * 0.5) * k);
    return dx * dx + ddy * ddy <= 1;
  };
  function hitTest(px, py) {
    if (hover && (fish.includes(hover) || tipFish.includes(hover)) && inside(hover, px, py, 1.4)) return hover;
    for (let i = tipFish.length - 1; i >= 0; i -= 1) if (inside(tipFish[i], px, py)) return tipFish[i]; // drawn in front
    for (let i = fish.length - 1; i >= 0; i -= 1) if (inside(fish[i], px, py)) return fish[i];
    return null;
  }

  // The readout: filled and measured here, on a pointer event, never in frame().
  let tipW = 0; let tipH = 0; let tipFor = null;
  function setHover(f) {
    if (f === hover) return;
    hover = f;
    if (!f) { canvas.style.cursor = ''; if (focusF) showTip(focusF); else tip.hidden = true; return; }
    showTip(f);
    canvas.style.cursor = 'pointer';
  }
  // The readout for one fish: its name, sector and move.
  function showTip(f) {
    if (f.tip) {
      tip.innerHTML = `<b>${esc(f.name)}</b> <span class="ft-tip-sec">· a tip</span>`;
      tip.hidden = false;
      tipW = tip.offsetWidth; tipH = tip.offsetHeight;
      tipFor = f;
      return;
    }
    const s = f.s;
    const dir = s.changePct > 0 ? 'up' : s.changePct < 0 ? 'down' : 'flat';
    const sec = f.sector ? sectorName(f.sector) : '';
    tip.innerHTML = `<b>${esc(s.ticker)}</b> ${esc(s.name)}${sec ? ` <span class="ft-tip-sec">· ${esc(sec)}</span>` : ''} <span class="${dir}">${esc(fmtPct(s.changePct))}</span>`;
    tip.hidden = false;
    tipW = tip.offsetWidth; tipH = tip.offsetHeight;
    tipFor = f;
  }
  // Keep the readout by its fish: writes only.
  function placeTip() {
    const on = tipFor;
    if (!on || tip.hidden) return;
    const x = clamp(on.x - tipW / 2, 4, Math.max(4, W - tipW - 4));
    const upper = on.bobY - on.dh / 2 - tipH - 6 - (on === focusF ? 4 : 0);
    const y = upper > 2 ? upper : on.bobY + on.dh / 2 + 6;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function frame(now, still = false) {
    if (!W || !H) return;
    const dt = still || !last ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    const calm = reduced();
    const t = calm ? 0 : clock;
    // Pixels first, in device pixels: the still background, weeds, fish, bubbles, ticks.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(bg, 0, 0);
    drawWeeds(t);
    if (dt) {
      schoolStep(fish, dt, W, { centre, hold: hover || focusF });
      for (const f of fish) { f.x01 = f.x / W; f.y += (targetY(f) - f.y) * Math.min(1, dt * 0.8); }
    }
    for (const f of fish) {
      f.bobY = f.y + (calm || f.kind === 'crab' ? 0 : Math.sin(t * 0.7 + f.ph) * 2.5);
      const want = sectorAlpha(f.sector, active);
      f.a = dt ? f.a + (want - f.a) * Math.min(1, dt * 8) : want;
    }
    if (tipFish.length) {
      if (dt) stepTips(dt);
      const want = sectorAlpha(null, active);
      for (const f of tipFish) {
        f.bobY = f.y + (calm ? 0 : Math.sin(t * 0.9 + f.ph) * 2);
        f.a = dt ? f.a + (want - f.a) * Math.min(1, dt * 8) : want;
      }
    }
    for (const f of fish) drawFish(f, t, f === hover || f === focusF, calm);
    for (const f of tipFish) drawFish(f, t, f === hover, calm);
    if (focusF) drawRing(focusF);
    drawBubbles(t, dt);
    for (const f of fish) if (f.kind === 'crab') drawTick(f);
    // Then the tags, in CSS pixels.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const taken = [];
    const plan = tagPlan(fish, {
      winner: labels.winner && byTicker.get(labels.winner), loser: labels.loser && byTicker.get(labels.loser),
      big: labels.big.map((k) => byTicker.get(k)).filter(Boolean), active, all: allNames,
    });
    const moveColor = (p) => (p > 0 ? 'hsl(147, 70%, 62%)' : p < 0 ? 'hsl(0, 100%, 74%)' : 'hsl(206, 45%, 80%)');
    for (const { f, tag, must } of plan) {
      if (tag === 'crab') drawLabel(f, `${f.s.ticker} ${fmtPct(f.s.changePct)}`, f.s.changePct >= 0 ? 'hsl(147, 70%, 62%)' : 'hsl(0, 100%, 74%)', f.a, taken, must);
      else if (tag === 'sector' || tag === 'name') drawLabel(f, f.s.ticker, 'hsl(206, 45%, 80%)', 0.9, taken);
      else drawLabel(f, f.s.ticker, moveColor(f.s.changePct), f.a, taken, true);
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
    dprChanged();
  }
  watchDpr();

  // ---- the keyboard: one Tab stop; the arrows walk the fish, Enter opens one, Esc leaves.
  // Tab and Shift+Tab leave the tank as they would anything else. Coming back, the focus
  // starts on the fish it was on (or the biggest). Not in a DESK panel (keys: false).
  let lastFocus = null; // the ticker in focus when the tank was left
  function setFocus(f) {
    if (f === focusF) return;
    focusF = f;
    if (f) showTip(f); else if (hover) showTip(hover); else tip.hidden = true;
    onFocusFish(f ? f.s : null);
    if (!runner.running) frame(performance.now(), true);
  }
  if (keys) canvas.addEventListener('focus', () => {
    // Only a keyboard focus starts on a fish (a click opens the one under it instead).
    if (!canvas.matches?.(':focus-visible') || focusF || !fish.length) return;
    setFocus((lastFocus && byTicker.get(lastFocus)) || fish[0]);
  });
  if (keys) canvas.addEventListener('blur', () => { if (focusF) lastFocus = focusF.s.ticker; setFocus(null); });
  if (keys) canvas.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !fish.length) return;
    const i = focusF ? fish.indexOf(focusF) : -1;
    if (e.key === 'Enter') {
      if (!focusF) return;
      e.preventDefault(); e.stopPropagation();
      onOpen(focusF.s.ticker);
      return;
    }
    if (e.key === 'Escape') {
      if (!focusF) return;
      e.preventDefault(); e.stopPropagation();
      setFocus(null);
      const bar = document.getElementById?.('cmd');
      if (bar) bar.focus(); else canvas.blur?.();
      return;
    }
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) return; // Tab: out, as usual
    const j = nextFishIndex(i, e.key, fish.length);
    e.preventDefault(); e.stopPropagation();
    if (j >= 0) setFocus(fish[j]);
  });

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
    // A tip fish opens nothing: a tap names it (a phone has no hover).
    if (f?.tip) { setHover(f); if (!runner.running) frame(performance.now(), true); return; }
    if (f) onOpen(f.s.ticker);
  });

  return {
    setStocks,
    setTips,
    setActive,
    resize,
    // NAMES: every fish named, or only the always-named few.
    setAllNames(on) { allNames = Boolean(on); if (!runner.running) frame(performance.now(), true); },
    get allNames() { return allNames; },
    get focused() { return focusF ? focusF.s.ticker : null; },
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
  // The strip: the counts (refreshed), then NAMES (built once, so a refresh never takes
  // the focus off it). No NAMES and no tank keys in a DESK panel.
  const strip = `<span class="ft-head" id="ft-head"></span>${ctx.embed ? '' : `<span class="ft-sep"> · </span>${namesToggleHtml(false)}`}`;
  el.innerHTML = panel('1', 'Fishtank', `<div class="ft-leg" id="ft-leg" role="group" aria-label="Sectors" hidden></div><div class="ft-host" id="ft-host">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'ft-meta', bodyCls: 'flush', meta: strip });
  const host = el.querySelector('#ft-host');
  const meta = el.querySelector('#ft-head') || el.querySelector('#ft-meta');
  const namesBtn = el.querySelector('#ft-names');
  const leg = el.querySelector('#ft-leg');
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => Boolean(motion?.matches);
  let tank = null;
  let stocks = null;
  let left = false;
  let names = {}; // sector key -> GICS name, from the data
  let active = SPECIES[cmd.args?.sector] ? cmd.args.sector : null; // the lit sector (FISHTANK TECH lights one)
  let legKey = '';
  let allNames = false; // NAMES: every fish named
  const sectorName = (k) => names[k] || SPECIES[k]?.short || k;
  // What holds the animation, besides data: kept here so a tank made later starts right.
  const holds = { hidden: document.hidden, offscreen: typeof IntersectionObserver === 'function', reduced: reduced() };
  const applyHolds = () => { if (tank) for (const [k, v] of Object.entries(holds)) tank.hold(k, v); };

  function mount() {
    // The canvas is one Tab stop: then the arrows walk the fish, Enter opens one, Esc
    // leaves. The fish in focus is said in the live line for screen readers. In a DESK
    // panel it is a picture only (no Tab stop, no keys).
    const canvasAttrs = ctx.embed ? 'role="img"' : 'tabindex="0" role="application" aria-roledescription="fish tank"';
    host.innerHTML = `<canvas class="ft-canvas" ${canvasAttrs} aria-label="The S&amp;P 100 as fish"></canvas><div class="ft-tip" hidden></div>`
      + '<p class="offscreen ft-live" aria-live="polite"></p><ul class="ft-sr" aria-label="Every fish"></ul>';
    const live = host.querySelector('.ft-live');
    const onFocusFish = (s) => { if (live) live.textContent = s ? `${s.ticker} ${s.name} ${fmtPct(s.changePct)}. Enter opens it.` : ''; };
    tank = makeTank(host, host.querySelector('canvas'), host.querySelector('.ft-tip'), { onOpen: (t) => ctx.run(t), reduced, sectorName, onDpr: drawGlyphs, onFocusFish, keys: !ctx.embed });
    tank.setAllNames(allNames);
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
    drawGlyphs();
    leg.hidden = !items.length;
  }
  // The legend glyphs at the current pixel ratio: after a build, and again when the
  // ratio changes (a zoom, another monitor), so they stay crisp.
  function drawGlyphs() {
    const d = window.devicePixelRatio || 1;
    leg?.querySelectorAll?.('.ft-leg-btn').forEach((b) => drawGlyph(b.querySelector('canvas'), speciesOf(b.dataset.sector), d));
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
  // NAMES: every fish named; pressed again, only the always-named few.
  namesBtn?.addEventListener('click', () => {
    allNames = !allNames;
    namesBtn.setAttribute('aria-pressed', String(allNames));
    tank?.setAllNames(allNames);
  });
  // Esc clears a lit sector first (and only then goes back a screen, as elsewhere); with
  // a fish in focus, Esc leaves the fish first (the canvas's own keys).
  const onKey = (e) => {
    if (e.key !== 'Escape' || !active || tank?.focused) return;
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
      host.querySelector('canvas').setAttribute('aria-label', `The S&P 100 as fish: ${head.up} up, ${head.down} down.${ctx.embed ? '' : ' The arrow keys move between the fish, Enter opens one.'}`);
      // The same fish as links, for keyboards and screen readers (shown on focus).
      host.querySelector('.ft-sr').innerHTML = [...stocks].sort((a, b) => b.changePct - a.changePct)
        .map((s) => `<li><a href="${esc(q(s.ticker))}" data-cmd="${esc(s.ticker)}">${esc(`${s.ticker} ${s.name}${SPECIES[s.sector] ? ` ${SPECIES[s.sector].short}` : ''} ${fmtPct(s.changePct)}`)}</a></li>`).join('');
      if (!tank.size.W) fit();
      tank.setStocks(stocks);
      tank.setTips(d.tips || null); // TIPS: named fish, only when there are some
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
