// Little pixel figures for the BBRK globe (public/globe.js): one per visitor. Visitors are
// anonymous, so each figure is made up from a seed (the place, the visitor's number there
// and the day): the same seed, the same figure, all day. 8x8 pixels, the same left and
// right (the left 4 columns mirrored), one colour from a few tints of the ice blue.
//
// A figure is 16 lowercase hex characters, one byte a row, top row first, the left pixel
// the high bit (bit 63 = the top left pixel), 1 = lit: the same as the ME avatars
// (public/pixel-avatar.js), so decode() and draw() here can later be swapped for it.

export const SIZE = 8;
export const HEX_RE = /^[0-9a-f]{16}$/;

// 64 booleans (row by row) -> 16 hex characters.
export function encode(bits) {
  let out = '';
  for (let r = 0; r < SIZE; r++) {
    let byte = 0;
    for (let c = 0; c < SIZE; c++) if (bits[r * SIZE + c]) byte |= 1 << (SIZE - 1 - c);
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

// 16 hex characters -> 64 booleans, or null when it is not a figure.
export function decode(hex) {
  const h = String(hex ?? '').toLowerCase();
  if (!HEX_RE.test(h)) return null;
  const bits = [];
  for (let r = 0; r < SIZE; r++) {
    const byte = parseInt(h.slice(r * 2, r * 2 + 2), 16);
    for (let c = 0; c < SIZE; c++) bits.push(Boolean(byte & (1 << (SIZE - 1 - c))));
  }
  return bits;
}

// The lit pixels as runs, one rectangle per run in a row: [col, row, length, ...]. Made
// once per figure.
const runsCache = new Map();
export function runsOf(hex) {
  let runs = runsCache.get(hex);
  if (runs) return runs;
  const bits = decode(hex) || [];
  runs = [];
  for (let r = 0; r < SIZE; r++) {
    let c = 0;
    while (c < SIZE) {
      if (!bits[r * SIZE + c]) { c++; continue; }
      let n = 0;
      while (c + n < SIZE && bits[r * SIZE + c + n]) n++;
      runs.push(c, r, n);
      c += n;
    }
  }
  if (runsCache.size > 4000) runsCache.clear();
  runsCache.set(hex, runs);
  return runs;
}

// Draw a figure with its top left at x, y, px canvas pixels a pixel: whole pixels only,
// so it stays crisp (the caller works in device pixels).
export function draw(ctx, hex, x, y, px, color) {
  const runs = runsOf(hex);
  if (color) ctx.fillStyle = color;
  const p = Math.max(1, Math.round(px));
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  for (let i = 0; i < runs.length; i += 3) ctx.fillRect(x0 + runs[i] * p, y0 + runs[i + 1] * p, runs[i + 2] * p, p);
}

// ---- made up from a seed -------------------------------------------------------------

// A string -> 32 bits (FNV-1a).
export function hash(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A small seeded random source (mulberry32): () -> [0, 1).
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How likely each pixel of the left half is lit (columns 0..3, 3 next to the middle): a
// head and body in the middle, ears or antennae on top, legs at the bottom.
const ODDS = [
  [0.05, 0.35, 0.3, 0.15],
  [0.1, 0.55, 0.85, 0.9],
  [0.3, 0.9, 1, 1],
  [0.45, 0.95, 1, 1],
  [0.4, 0.9, 1, 1],
  [0.25, 0.7, 0.95, 0.85],
  [0.2, 0.55, 0.35, 0.2],
  [0.25, 0.4, 0.15, 0.05],
];

// A figure from a seed: 16 hex characters. Always two eyes (dark pixels in a lit face),
// always the same left and right.
export function spriteHex(seed) {
  const rand = rng(hash(seed));
  const half = ODDS.map((row) => row.map((p) => rand() < p));
  // The eyes: a hole in row 2 or 3, column 1 or 2, lit all round it.
  const er = rand() < 0.5 ? 2 : 3;
  const ec = rand() < 0.6 ? 2 : 1;
  for (let r = er - 1; r <= er + 1; r++) for (let c = ec - 1; c <= Math.min(3, ec + 1); c++) half[r][c] = true;
  half[er][ec] = false;
  // A mouth now and then: a dark pixel low in the middle.
  if (rand() < 0.35) half[er + 2][3] = false;
  const bits = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) bits.push(half[r][c < 4 ? c : 7 - c]);
  return encode(bits);
}

// Tints of the ice blue (style.css --text, --accent, --cmp-2, --text-2 and two between),
// never a warm colour, never the up green or the down red.
export const PALETTE = ['#CFEAFF', '#6CCBFF', '#8AB4FF', '#A6E4F5', '#B7C4F0', '#EAF6FF'];

export const colorFor = (seed) => PALETTE[hash(`c:${seed}`) % PALETTE.length];

// The day part of a seed: 'YYYY-MM-DD' (UTC), so the figures change once a day.
export const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);

// ---- where the figures of a place go -------------------------------------------------

// Grid spots round a place, nearest first (then clockwise from the top): [[dx, dy], ...]
// in whole figure widths, so no two ever overlap. Made once.
let spots = [];
export function spotsFor(n) {
  if (spots.length < n) {
    const k = Math.ceil(Math.sqrt(n)) + 2;
    const all = [];
    for (let y = -k; y <= k; y++) for (let x = -k; x <= k; x++) all.push([x, y]);
    const ang = ([x, y]) => (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);
    all.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2) || ang(a) - ang(b));
    spots = all;
  }
  return spots.slice(0, n);
}

// How many figures each place gets: all of its visitors, at most perPlace, and at most
// cap in all (the biggest places give way first; spare room goes to the biggest).
// counts: visitors per place -> figures per place. The rest of a place is its "+N".
export function budget(counts, { cap = 240, perPlace = Infinity } = {}) {
  const n = counts.map((c) => Math.max(0, Math.floor(Number.isFinite(c) ? c : 0)));
  const want = n.map((c) => Math.min(c, perPlace));
  const total = want.reduce((s, c) => s + c, 0);
  if (total <= cap) return want;
  // The largest level L with sum(min(want, L)) <= cap.
  let lo = 0;
  let hi = Math.max(...want);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (want.reduce((s, c) => s + Math.min(c, mid), 0) <= cap) lo = mid; else hi = mid - 1;
  }
  const out = want.map((c) => Math.min(c, lo));
  let left = cap - out.reduce((s, c) => s + c, 0);
  const order = want.map((c, i) => i).filter((i) => want[i] > out[i]).sort((a, b) => want[b] - want[a] || a - b);
  for (const i of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}
