// Share images (Open Graph) and page meta.
//
// GET /og/whatif.png?c=WHATIF+IPHONE6  the WHATIF certificate, 1200x630
// GET /og/default.png                  the site card
//
// Render: satori lays out the card and turns text into paths (fonts bundled in
// assets/fonts), sharp decodes the WebP art and rasterises the SVG to PNG. Rendered
// images and the certificate text behind them are cached on disk for 7 days, keyed by a
// hash of the normalised command, so a share link's title and image always agree.

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { certKey, certModel, normalizeWhatif } from '../data/whatif-cert.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(root, 'public', 'img', 'whatif');
export const CACHE_DIR = path.join(root, 'data', 'cache', 'og');
export const TTL_MS = 7 * 24 * 3600 * 1000;
export const SITE = 'https://bloombroke.com';
export const W = 1200;
export const H = 630;

const C = {
  bg: '#05080C', accent: '#6CCBFF', text: '#CFEAFF', dim: '#7C93A8',
  ink: '#2A1A10', inkSoft: '#5A4330', red: '#C23B2A',
};

// Positions on the certificate art, in % of its width (x) and height (y).
// public/style.css (.wc-*) uses the same numbers.
export const POS = {
  receipt: { left: 7.33, top: 13.3, size: 0.92, line: 2.18, rot: -15 },
  ribbon: { x: 49.6, y: 20.2 },
  big: { x: 49, y: 43.5, rot: -1.5 },
  today: { x: 49, y: 56.5 },
  l1: { x: 49.9, y: 71.3 },
  l2: { x: 49.9, y: 76.9 },
  rosette: { x: 82.5, y: 68.4 },
  sticker: { left: -3, bottom: -5, width: 17, rot: -8 },
};

// ---- Fonts and art ---------------------------------------------------------------

let fonts;
function loadFonts() {
  if (!fonts) {
    const f = (file) => readFileSync(path.join(root, 'assets', 'fonts', file));
    fonts = [
      { name: 'Mono', data: f('JetBrainsMono-Medium.ttf'), weight: 500, style: 'normal' },
      { name: 'Mono', data: f('JetBrainsMono-ExtraBold.ttf'), weight: 800, style: 'normal' },
      { name: 'Hand', data: f('Caveat-Bold.ttf'), weight: 700, style: 'normal' },
    ];
  }
  return fonts;
}

const art = new Map();
async function pngUri(file, width) {
  const key = `${file}@${width}`;
  if (!art.has(key)) {
    art.set(key, sharp(path.join(IMG, file)).resize({ width }).png().toBuffer()
      .then((b) => `data:image/png;base64,${b.toString('base64')}`));
  }
  return art.get(key);
}

// ---- Tiny element helper for satori ---------------------------------------------

const h = (style, children = []) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });
const img = (src, style, width, height) => ({ type: 'img', props: { src, width, height, style } });

// A line of text centred on (cx, cy), in px.
function centred(text, cx, cy, size, style = {}, boxW = 1000) {
  return h({
    position: 'absolute', left: cx - boxW / 2, top: cy - size / 2, width: boxW, height: size,
    justifyContent: 'center', alignItems: 'center', fontSize: size, lineHeight: 1, whiteSpace: 'nowrap', ...style,
  }, [text]);
}

// A line of text sitting on a ruled line at y (its bottom edge), in px.
function onLine(text, cx, y, size, style = {}) {
  return centred(text, cx, y - size * 0.62, size, style);
}

function topLine(command) {
  const max = 88;
  const cmd = command.length > max ? `${command.slice(0, max - 3)}...` : command;
  return h({ position: 'absolute', left: 28, top: 16, right: 28, height: 22, alignItems: 'center', fontFamily: 'Mono', fontWeight: 500, fontSize: 17, color: C.accent, whiteSpace: 'nowrap' }, [
    h({ fontWeight: 800, letterSpacing: 3, marginRight: 22 }, ['BLOOMBROKE']),
    h({ color: C.text }, [`> ${cmd}`]),
  ]);
}

// Small print under the certificate, clear of the sticker on the left.
export const HINDSIGHT_NOTE = 'Hindsight only. Past returns do not predict future returns. Not a recommendation.';
const hindsightNote = () => centred(HINDSIGHT_NOTE, 620, H - 15, 12, { fontFamily: 'Mono', fontWeight: 500, color: C.dim }, 640);

const siteMark = () => h({ position: 'absolute', right: 28, bottom: 16, fontFamily: 'Mono', fontWeight: 500, fontSize: 17, color: C.dim }, ['bloombroke.com']);

// ---- The certificate card ---------------------------------------------------------

export async function certificateTree(m) {
  const cw = 834;
  const ch = 556;
  const left = (W - cw) / 2;
  const top = 44;
  const X = (pct) => (pct / 100) * cw;
  const Y = (pct) => (pct / 100) * ch;
  const S = (pct) => (pct / 100) * cw; // font sizes are % of the width
  const [paper, doodle] = await Promise.all([pngUri('certificate.webp', cw), pngUri(`doodle-${m.doodle}.webp`, 200)]);
  const stickerW = X(POS.sticker.width);

  const ink = { fontFamily: 'Mono', color: C.ink };
  const hand = { fontFamily: 'Hand', color: C.ink };
  const p = POS;
  const lines = S(m.fit.lines);
  const multSize = S(m.fit.mult);

  const rosette = [centred(m.multiple, X(p.rosette.x), Y(p.rosette.y) - (m.loss ? Y(2.2) : 0), multSize, { ...ink, fontWeight: 800, color: m.loss ? C.inkSoft : C.ink })];
  if (m.loss) {
    rosette.push(h({
      position: 'absolute', left: X(p.rosette.x) - X(4.6), top: Y(p.rosette.y) - Y(2.2) - S(0.2), width: X(9.2), height: S(0.45),
      backgroundColor: C.red, borderRadius: S(0.3), transform: 'rotate(-14deg)',
    }));
    rosette.push(centred('dodged', X(p.rosette.x), Y(p.rosette.y) + Y(3.6), S(2.4), { ...hand, color: C.red }));
  }

  const cert = h({ position: 'absolute', left, top, width: cw, height: ch }, [
    img(paper, { position: 'absolute', left: 0, top: 0 }, cw, ch),
    h({
      position: 'absolute', left: X(p.receipt.left), top: Y(p.receipt.top),
      flexDirection: 'column', transform: `rotate(${p.receipt.rot}deg)`, transformOrigin: 'top left',
      fontFamily: 'Mono', fontWeight: 800, fontSize: S(p.receipt.size), lineHeight: `${S(p.receipt.line)}px`, color: C.inkSoft,
    }, m.receipt.map((line) => h({ whiteSpace: 'nowrap' }, [line]))),
    centred(m.ribbon, X(p.ribbon.x), Y(p.ribbon.y), S(m.fit.ribbon), hand),
    centred(m.big, X(p.big.x), Y(p.big.y), S(m.fit.big), { ...ink, fontWeight: 800, letterSpacing: -S(m.fit.big) * 0.04, transform: `rotate(${p.big.rot}deg)`, color: m.loss ? C.red : C.ink }),
    centred('worth today', X(p.today.x), Y(p.today.y), S(2.8), { ...hand, color: C.inkSoft }),
    onLine(m.spent, X(p.l1.x), Y(p.l1.y), lines, { ...ink, fontWeight: 800 }),
    onLine(m.holding, X(p.l2.x), Y(p.l2.y), lines, { ...ink, fontWeight: 500, color: C.inkSoft }),
    ...rosette,
  ]);
  const sticker = img(doodle, {
    position: 'absolute', left: left + X(p.sticker.left), top: top + ch + Y(-p.sticker.bottom) - stickerW,
    transform: `rotate(${p.sticker.rot}deg)`,
  }, stickerW, stickerW);

  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative' }, [topLine(m.command), cert, sticker, hindsightNote(), siteMark()]);
}

export function defaultTree() {
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', flexDirection: 'column' }, [
    topLine('HOME'),
    h({ position: 'absolute', left: 28, right: 28, top: 38, height: 1, backgroundColor: '#1A2733' }),
    h({ position: 'absolute', left: 96, top: 190, flexDirection: 'column', fontFamily: 'Mono', fontWeight: 800, color: C.text }, [
      h({ fontSize: 68, letterSpacing: -2 }, ['The $32,000 terminal.']),
      h({ fontSize: 68, letterSpacing: -2, color: C.accent, marginTop: 10, alignItems: 'center' }, [
        'Now $4.20 a month.',
        h({ width: 34, height: 64, marginLeft: 18, backgroundColor: C.accent }),
      ]),
      h({ fontSize: 24, fontWeight: 500, color: C.dim, marginTop: 42 }, ['A market terminal for normal people. Type a command, get the answer.']),
      h({ fontSize: 20, fontWeight: 500, color: C.text, marginTop: 30, whiteSpace: 'nowrap' },
        ['AAPL', 'FX 500 USD THB', 'WHATIF IPHONE6', 'HELP'].map((c) => h({ marginRight: 34 }, [h({ color: C.accent, marginRight: 12 }, ['>']), c]))),
    ]),
    siteMark(),
  ]);
}

export async function renderPng(tree) {
  const svg = await satori(tree, { width: W, height: H, fonts: loadFonts() });
  return sharp(Buffer.from(svg)).png({ palette: true, quality: 100, effort: 10, compressionLevel: 9 }).toBuffer();
}

// ---- Disk cache ----------------------------------------------------------------------

async function readFresh(file, now = Date.now()) {
  try {
    const s = await stat(file);
    if (now - s.mtimeMs > TTL_MS) return null;
    return await readFile(file);
  } catch { return null; }
}

async function writeAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
  sweep();
}

let lastSweep = 0;
async function sweep() {
  const now = Date.now();
  if (now - lastSweep < 3600 * 1000) return;
  lastSweep = now;
  try {
    for (const f of await readdir(CACHE_DIR)) {
      const full = path.join(CACHE_DIR, f);
      const s = await stat(full).catch(() => null);
      if (s && now - s.mtimeMs > TTL_MS) await unlink(full).catch(() => {});
    }
  } catch { /* nothing to sweep */ }
}

// One render at a time per key, and at most two at once overall.
const inflight = new Map();
let running = 0;
const waiting = [];
async function limited(fn) {
  if (running >= 2) await new Promise((r) => waiting.push(r));
  running += 1;
  try { return await fn(); } finally { running -= 1; waiting.shift()?.(); }
}
function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

// ---- Public API --------------------------------------------------------------------

// The certificate text for ?c=..., or null when c is not a WHATIF result.
// getWhatif: data/whatif-service.js getWhatif (injected for tests).
export async function getCert(c, { catalog, getWhatif, cacheDir = CACHE_DIR }) {
  const norm = normalizeWhatif(c, catalog);
  if (!norm) return null;
  const key = certKey(norm.command);
  const file = path.join(cacheDir, `${key}.json`);
  const hit = await readFresh(file);
  if (hit) { try { return JSON.parse(hit); } catch { /* redo it */ } }
  return once(`json:${key}`, async () => {
    const result = await getWhatif(norm.tokens);
    if (!result?.rows?.length) return null;
    const model = certModel(result, catalog, norm.command);
    // A result on last-known prices is shown, but not kept for a week.
    if (!result.stale) await writeAtomic(file, JSON.stringify(model)).catch((e) => console.error('[og]', e.message));
    return model;
  });
}

export async function whatifPng(c, deps) {
  const model = await getCert(c, deps);
  if (!model) return defaultPng(deps);
  const file = path.join(deps.cacheDir || CACHE_DIR, `${certKey(model.command)}.png`);
  const hit = await readFresh(file);
  if (hit) return hit;
  return once(`png:${file}`, () => limited(async () => {
    const png = await renderPng(await certificateTree(model));
    await writeAtomic(file, png).catch((e) => console.error('[og]', e.message));
    return png;
  }));
}

let defaultCard = null;
export function defaultPng() {
  if (!defaultCard) defaultCard = limited(() => renderPng(defaultTree())).catch((e) => { defaultCard = null; throw e; });
  return defaultCard;
}

// ---- Page meta ---------------------------------------------------------------------

export function escAttr(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Replace the page's share meta (og:*, twitter:*) with these values.
export function withMeta(html, { title, description, image, url, alt }) {
  const tags = [
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:type', 'website'],
    ['property', 'og:image', image],
    ['property', 'og:image:width', String(W)],
    ['property', 'og:image:height', String(H)],
    ['property', 'og:image:alt', alt || title],
    ['property', 'og:url', url],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', image],
  ].filter(([, , v]) => v).map(([k, n, v]) => `<meta ${k}="${n}" content="${escAttr(v)}">`).join('\n  ');
  const clean = String(html)
    .replace(/[ \t]*<meta\s+property="og:[^"]*"[^>]*>\n?/g, '')
    .replace(/[ \t]*<meta\s+name="twitter:[^"]*"[^>]*>\n?/g, '');
  return clean.replace('</head>', `  ${tags}\n</head>`);
}

export const DEFAULT_META = {
  title: 'Bloombroke: the $32,000 terminal. Now $4.20 a month.',
  description: 'A market terminal for normal people. Type a command, get the answer.',
  image: `${SITE}/og/default.png`,
  alt: 'Bloombroke: the $32,000 terminal. Now $4.20 a month.',
};

export function certMeta(model) {
  const q = new URLSearchParams({ c: model.command }).toString();
  return {
    title: model.title,
    description: model.description,
    image: `${SITE}/og/whatif.png?${q}`,
    url: `${SITE}/?${q}`,
    alt: `A certificate: ${model.ribbon}, worth ${model.big} today in stock.`,
  };
}

