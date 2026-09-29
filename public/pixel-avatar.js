// PIXEL avatars and name colours: one small module for ME, CHAT, DRIVE and the top bar.
//
// An avatar is 8x8 pixels drawn in ME, stored as 64 bits in 16 lowercase hex characters,
// row-major, top row first: bit 63 (the first hex digit's high bit) is the top-left pixel,
// and 1 is lit. No avatar (null): the initials of the username, or the seat's digits, in a
// tiny 3x5 pixel font. In HTML it draws as an inline SVG, one path in the name colour
// (currentColor) on a faint tile of the same colour; shape-rendering crispEdges keeps the
// pixels square at any whole size. draw() paints one on a canvas.
//
// The stable API (no imports; other builds use it as is):
//   decode(hex) -> 8x8 booleans (rows of columns), or null
//   encode(grid) -> hex (grid: 8x8 booleans, or 64 in a row)
//   draw(ctx, hex, x, y, px, color)   a canvas 2D context; px: the size of one pixel
//   initials(text) -> hex: the 1 or 2 initials of a username (or a seat number) drawn
//
// Name colours: 8 fixed ones, style.css --name-0 .. --name-7, applied by a data-nc="N"
// attribute (style.css has the 8 rules: the site's CSP allows no inline styles). No colour
// picked: the seat picks one (seat % 8), so a chat of people who never chose still reads apart.
// Pure string builders: node:test imports them.

export const SIZE = 8;
export const COLORS = 8;
export const HEX_RE = /^[0-9a-f]{16}$/;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- bits <-> hex ------------------------------------------------------------------------

// 8x8 booleans (or 64 in a row) -> 16 lowercase hex characters.
export function encode(grid) {
  const bits = flat(grid);
  let out = '';
  for (let r = 0; r < SIZE; r++) {
    let byte = 0;
    for (let c = 0; c < SIZE; c++) if (bits[r * SIZE + c]) byte |= 1 << (SIZE - 1 - c);
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

// 8x8 booleans -> 64 in a row; 64 in a row stay as they are.
export function flat(grid) {
  if (!Array.isArray(grid)) return blank();
  return Array.isArray(grid[0]) ? grid.flatMap((row) => Array.from({ length: SIZE }, (_, c) => Boolean(row?.[c]))).slice(0, SIZE * SIZE) : grid.map(Boolean);
}

// 16 hex characters -> 8x8 booleans (rows of columns), or null when it is not an avatar.
export function decode(hex) {
  const bits = bitsFromHex(hex);
  if (!bits) return null;
  return Array.from({ length: SIZE }, (_, r) => bits.slice(r * SIZE, r * SIZE + SIZE));
}

// 16 hex characters -> 64 booleans in a row (top row first), or null.
export function bitsFromHex(hex) {
  const h = String(hex ?? '').toLowerCase();
  if (!HEX_RE.test(h)) return null;
  const bits = [];
  for (let r = 0; r < SIZE; r++) {
    const byte = parseInt(h.slice(r * 2, r * 2 + 2), 16);
    for (let c = 0; c < SIZE; c++) bits.push(Boolean(byte & (1 << (SIZE - 1 - c))));
  }
  return bits;
}

export const blank = () => Array(SIZE * SIZE).fill(false);

// ---- initials ----------------------------------------------------------------------------

// A 3x5 pixel font: five rows of three, 1 = on.
export const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '010101010101010',
  9: '010101011001110',
};

// Up to two characters for a person: a username's first letter and the start of its
// second word (tom_lee: TL), or its next capital or digit (TomLee: TL), else its first
// two letters (tom: TO); no username: the seat's last two digits.
export function initialsOf(name, seat = null) {
  const s = String(name ?? '').replace(/[^A-Za-z0-9_]/g, '');
  if (s.replace(/_/g, '')) {
    const parts = s.split('_').filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    const w = parts[0];
    const at = w.slice(1).search(/[A-Z0-9]/);
    return (at >= 0 ? w[0] + w[1 + at] : w.slice(0, 2)).toUpperCase();
  }
  return Number.isInteger(seat) && seat > 0 ? String(seat).slice(-2) : '';
}

// The initials drawn into the 8x8 grid: two glyphs side by side (a column apart), one
// glyph in the middle; one row down from the top.
export function initialsBits(text) {
  const bits = blank();
  const chars = String(text ?? '').toUpperCase().split('').filter((ch) => FONT[ch]).slice(0, 2);
  const x0 = chars.length === 1 ? 2 : 0;
  chars.forEach((ch, i) => {
    const g = FONT[ch];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) if (g[r * 3 + c] === '1') bits[(r + 2) * SIZE + x0 + i * 4 + c] = true;
    }
  });
  return bits;
}

// initials('tom_lee') -> the hex of TL drawn; initials('42') -> 42.
export function initials(text) {
  return encode(initialsBits(initialsOf(text)));
}

// The pixels to draw for a person (64 in a row): their avatar, or their initials.
export function bitsOf(p) {
  return bitsFromHex(p?.avatar) || initialsBits(initialsOf(p?.name ?? p?.username, p?.seat ?? null));
}

// A canvas: the lit pixels of hex at (x, y), each px by px, in color. false: not an avatar.
export function draw(ctx, hex, x, y, px, color) {
  const bits = bitsFromHex(hex);
  if (!bits || !ctx) return false;
  ctx.fillStyle = color;
  for (let i = 0; i < SIZE * SIZE; i++) if (bits[i]) ctx.fillRect(x + (i % SIZE) * px, y + Math.floor(i / SIZE) * px, px, px);
  return true;
}

// ---- colours -------------------------------------------------------------------------------

// The colour number for a person: the one they picked, else seat % 8.
export function colorOf(p) {
  if (Number.isInteger(p?.color) && p.color >= 0 && p.color < COLORS) return p.color;
  const seat = Number(p?.seat);
  return Number.isInteger(seat) && seat > 0 ? seat % COLORS : 0;
}
export const colorVar = (i) => `var(--name-${Number.isInteger(i) && i >= 0 && i < COLORS ? i : 0})`;
// The colour as markup: data-nc="N" (style.css colours it).
export const colorAttr = (i) => `data-nc="${Number.isInteger(i) && i >= 0 && i < COLORS ? i : 0}"`;

// ---- drawing -------------------------------------------------------------------------------

// The SVG path of the lit pixels: one rectangle per run in a row.
export function pathOf(bits) {
  let d = '';
  for (let r = 0; r < SIZE; r++) {
    let c = 0;
    while (c < SIZE) {
      if (!bits[r * SIZE + c]) { c++; continue; }
      let n = 0;
      while (c + n < SIZE && bits[r * SIZE + c + n]) n++;
      d += `M${c} ${r}h${n}v1h-${n}z`;
      c += n;
    }
  }
  return d;
}

// The avatar: an inline SVG, size by size CSS pixels (a whole multiple of 8 stays crisp).
// inline: false leaves the colour to a parent's data-nc (ME's hero and grid).
export function avatarSvg(p, { size = 16, inline = true, cls = '', bits = null } = {}) {
  const n = colorOf(p);
  const px = Number.isInteger(size) && size > 0 ? size : 16;
  const colour = inline ? ` ${colorAttr(n)}` : '';
  return `<svg class="px-av${cls ? ` ${esc(cls)}` : ''}" viewBox="0 0 8 8" width="${px}" height="${px}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"${colour}>`
    + '<rect width="8" height="8" fill="currentColor" opacity=".16"/>'
    + `<path fill="currentColor" d="${pathOf(bits || bitsOf(p))}"/></svg>`;
}

// A username in its colour, or SEAT 42 in the plain colour.
export function nameHtml(p, { cls = '' } = {}) {
  const c = cls ? ` class="${esc(cls)}"` : '';
  if (!p?.name) return `<span${c}>SEAT ${esc(p?.seat ?? '--')}</span>`;
  return `<span${c} ${colorAttr(colorOf(p))}>${esc(p.name)}</span>`;
}
