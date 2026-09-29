// Pixel sprites written as ASCII art: one string a row, one character a pixel. The same
// family as the globe critters (globe-sprites.js) and the ME avatars (pixel-avatar.js):
// whole square pixels, flat colours, no smoothing. FISHTANK draws its sea life with it.
//
//   '.'  transparent
//   '#'  body (the main colour)
//   '+'  shade (a darker tone of the main colour: fins, stripes, a shell)
//   'o'  eye
//
// A sprite is parsed once into runs (one rectangle per run of one colour in a row), then
// painted once per colour set onto a small offscreen canvas, one canvas pixel a sprite
// pixel. blit() scales that canvas up by a whole number with smoothing off, so a hundred
// sprites a frame cost a hundred drawImage calls. Pure parts (parseSprite) are tested in
// test/fishtank.test.js.

export const PALETTE_CHARS = '.#+o';
const INK = { '#': 'body', '+': 'shade', o: 'eye' };

// ['..##..', '.#++#.'] -> { w, h, runs: [[x, y, n, ch], ...] }. Throws on uneven rows or a
// character outside PALETTE_CHARS, so a typo in a sprite fails the tests, not the page.
export function parseSprite(rows, name = 'sprite') {
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${name}: no rows`);
  const w = rows[0].length;
  const runs = [];
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`${name}: row ${y} is ${row.length} wide, not ${w}`);
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (!PALETTE_CHARS.includes(ch)) throw new Error(`${name}: unknown pixel '${ch}' at ${x},${y}`);
      let n = 1;
      while (x + n < w && row[x + n] === ch) n += 1;
      if (ch !== '.') runs.push([x, y, n, ch]);
      x += n;
    }
  });
  return { w, h: rows.length, runs };
}

// Paint a parsed sprite with its top left at x, y, `px` canvas pixels a sprite pixel,
// mirrored when `flip`. colors: { body, shade, eye }. Whole pixels only.
export function paintSprite(ctx, sp, x, y, px, colors, flip = false) {
  const p = Math.max(1, Math.round(px));
  const x0 = Math.round(x); const y0 = Math.round(y);
  for (const [rx, ry, n, ch] of sp.runs) {
    const c = colors[INK[ch]];
    if (!c) continue;
    ctx.fillStyle = c;
    const cx = flip ? sp.w - rx - n : rx;
    ctx.fillRect(x0 + cx * p, y0 + ry * p, n * p, p);
  }
}

// A one-pixel ring round a sprite's lit pixels (the hovered fish), painted into a canvas
// one pixel bigger on every side.
function paintOutline(ctx, sp, color, flip) {
  const lit = new Set();
  for (const [rx, ry, n] of sp.runs) for (let i = 0; i < n; i += 1) lit.add(`${flip ? sp.w - 1 - (rx + i) : rx + i},${ry}`);
  ctx.fillStyle = color;
  for (const k of lit) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!lit.has(`${x + dx},${y + dy}`)) ctx.fillRect(x + dx + 1, y + dy + 1, 1, 1);
    }
  }
}

// Offscreen canvases, one per sprite, colour set, direction and outline, made on first
// use. `make(w, h)` returns a canvas (document.createElement in the page; the tests pass
// their own). The outline version is one pixel bigger on every side. At most `limit`
// canvases in all: past that it starts again empty (FISHTANK needs about a thousand at
// the very most: 24 sprites x 11 colours x 2 directions x plain or outlined).
export function spriteCache(make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, limit = 1500) {
  const map = new Map();
  let count = 0;
  return {
    get(sp, colorKey, colors, flip = false, outline = null) {
      const key = `${colorKey}|${flip ? 1 : 0}|${outline || ''}`;
      let per = map.get(sp);
      if (!per) { per = new Map(); map.set(sp, per); }
      let c = per.get(key);
      if (c) return c;
      if (count >= limit) { map.clear(); count = 0; per = new Map(); map.set(sp, per); }
      const pad = outline ? 1 : 0;
      c = make(sp.w + pad * 2, sp.h + pad * 2);
      const b = c.getContext('2d');
      if (outline) paintOutline(b, sp, outline, flip);
      paintSprite(b, sp, pad, pad, 1, colors, flip);
      per.set(key, c);
      count += 1;
      return c;
    },
    get size() { return count; },
    clear() { map.clear(); count = 0; },
  };
}

// Draw a cached sprite canvas with its top left at x, y, scaled up by the whole number
// `px`, with smoothing off: crisp square pixels. The caller works in device pixels.
export function blit(ctx, img, x, y, px) {
  const p = Math.max(1, Math.round(px));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, Math.round(x), Math.round(y), img.width * p, img.height * p);
}
