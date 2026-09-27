// Share images (Open Graph) and page meta.
//
// GET /og/whatif.png?c=WHATIF+IPHONE6  the WHATIF certificate, 1200x630
// GET /og/quote.png?c=AAPL              a ticker: name, last, change, 1-month line
// GET /og/afford.png?c=AFFORD+1200+...  AFFORD: cost per use and the verdict
// GET /og/default.png                  the site card
//
// Render: satori lays out the card and turns text into paths (fonts bundled in
// assets/fonts), sharp decodes the WebP art and rasterises the SVG to PNG. Rendered
// images and the certificate text behind them are cached on disk for 7 days, keyed by a
// hash of the normalised command, so a share link's title and image always agree.

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { certKey, certModel, normalizeWhatif } from '../data/whatif-cert.js';
import { parseAffordArgs, affordCommand } from '../public/afford.js';
import { buyMaths, fmtMoney, howOften, yearsWord } from '../public/screens/buy.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(root, 'public', 'img', 'whatif');
export const CACHE_DIR = path.join(root, 'data', 'cache', 'og');
export const TTL_MS = 7 * 24 * 3600 * 1000;
export const QUOTE_TTL_MS = 10 * 60 * 1000; // a ticker card is redrawn at most every 10 minutes
export const SITE = 'https://bloombroke.com';
export const W = 1200;
export const H = 630;

const C = {
  bg: '#05080C', accent: '#6CCBFF', text: '#CFEAFF', dim: '#7C93A8', rule: '#1A2733',
  up: '#3DDC84', down: '#FF5C5C',
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
      h({ fontSize: 68, letterSpacing: -2 }, ['A free market terminal.']),
      h({ fontSize: 68, letterSpacing: -2, color: C.accent, marginTop: 10, alignItems: 'center' }, [
        'For normal people.',
        h({ width: 34, height: 64, marginLeft: 18, backgroundColor: C.accent }),
      ]),
      h({ fontSize: 24, fontWeight: 500, color: C.dim, marginTop: 42 }, ['Type a command, get the answer. Pro is $420 a year.']),
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

async function readFresh(file, now = Date.now(), ttl = TTL_MS) {
  try {
    const s = await stat(file);
    if (now - s.mtimeMs > ttl) return null;
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

// WHATIF with your own purchase (MY): endless possible commands, so their cards never go
// to disk. They live in a small in-memory LRU, and one address may render only so many
// new ones in a while (the site card instead).
export const MINE_MEMORY = { models: 500, pngs: 40 };
export const MINE_RATE = { renders: 20, windowMs: 10 * 60_000, addresses: 5000 };
const isMine = (command) => /(^|\s)MY\s/.test(command);
function memoryLru(max) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > max) m.delete(m.keys().next().value); },
    get size() { return m.size; },
    clear() { m.clear(); },
  };
}
export const mineModels = memoryLru(MINE_MEMORY.models);
export const minePngs = memoryLru(MINE_MEMORY.pngs);
// Renders per address in the window: true when one more is allowed.
export function makeRateLimit({ renders, windowMs, addresses } = MINE_RATE, now = () => Date.now()) {
  const seen = new Map(); // ip -> [times]
  return function allow(ip) {
    const t = now();
    const key = String(ip || 'none');
    const recent = (seen.get(key) || []).filter((x) => t - x < windowMs);
    if (recent.length >= renders) { seen.set(key, recent); return false; }
    recent.push(t);
    seen.delete(key);
    seen.set(key, recent);
    while (seen.size > addresses) seen.delete(seen.keys().next().value);
    return true;
  };
}
export const mineRenderAllowed = makeRateLimit();

// The certificate text for ?c=..., or null when c is not a WHATIF result.
// getWhatif: data/whatif-service.js getWhatif (injected for tests).
export async function getCert(c, { catalog, getWhatif, cacheDir = CACHE_DIR }) {
  const norm = normalizeWhatif(c, catalog);
  if (!norm) return null;
  const key = certKey(norm.command);
  if (isMine(norm.command)) {
    const hit = mineModels.get(key);
    if (hit && Date.now() - hit.at < TTL_MS && !hit.stale) return hit.model;
    return once(`json:${key}`, async () => {
      const result = await getWhatif(norm.tokens);
      if (!result?.rows?.length) return null;
      const model = certModel(result, catalog, norm.command);
      mineModels.set(key, { model, at: Date.now(), stale: Boolean(result.stale) });
      return result.stale ? { ...model, stale: true } : model;
    });
  }
  const file = path.join(cacheDir, `${key}.json`);
  const hit = await readFresh(file);
  if (hit) { try { return JSON.parse(hit); } catch { /* redo it */ } }
  return once(`json:${key}`, async () => {
    const result = await getWhatif(norm.tokens);
    if (!result?.rows?.length) return null;
    const model = certModel(result, catalog, norm.command);
    // A result on last-known prices is shown, but not kept for a week, and says so.
    if (result.stale) return { ...model, stale: true };
    await writeAtomic(file, JSON.stringify(model)).catch((e) => console.error('[og]', e.message));
    return model;
  });
}

// { png, real }: real is true only for the result's own card on live prices. The site
// card (a bad list, a MY card over the limit) and a card on last-known prices are not
// real, so the route keeps them for minutes, not a week. ip: the asker's address (only
// MY cards are limited per address).
export async function whatifCard(c, deps, { ip = null, allow = mineRenderAllowed } = {}) {
  const model = await getCert(c, deps);
  if (!model) return { png: await defaultPng(deps), real: false };
  const real = !model.stale;
  if (isMine(model.command)) {
    const key = certKey(model.command);
    const hit = minePngs.get(key);
    if (hit) return { png: hit, real: true };
    if (!allow(ip)) return { png: await defaultPng(deps), real: false };
    const png = await once(`png:mine:${key}${real ? '' : ':stale'}`, () => limited(async () => {
      const out = await renderPng(await certificateTree(model));
      if (real) minePngs.set(key, out);
      return out;
    }));
    return { png, real };
  }
  const file = path.join(deps.cacheDir || CACHE_DIR, `${certKey(model.command)}.png`);
  if (!real) return { png: await once(`png:stale:${file}`, () => limited(async () => renderPng(await certificateTree(model)))), real: false };
  const hit = await readFresh(file);
  if (hit) return { png: hit, real: true };
  const png = await once(`png:${file}`, () => limited(async () => {
    const out = await renderPng(await certificateTree(model));
    await writeAtomic(file, out).catch((e) => console.error('[og]', e.message));
    return out;
  }));
  return { png, real: true };
}

export async function whatifPng(c, deps, opts) {
  return (await whatifCard(c, deps, opts)).png;
}

let defaultCard = null;
export function defaultPng() {
  if (!defaultCard) defaultCard = limited(() => renderPng(defaultTree())).catch((e) => { defaultCard = null; throw e; });
  return defaultCard;
}

// ---- Ticker card --------------------------------------------------------------------

const hash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 24);
const NY = 'America/New_York';

// "2026-09-25T14:14:12.148-0400" -> "SEP 25 2026 14:14 ET"; a date alone -> "SEP 25 2026 CLOSE".
export function asOfText(asOf) {
  if (!asOf) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const d = new Date(dateOnly ? `${asOf}T12:00:00Z` : asOf);
  if (!Number.isFinite(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { timeZone: dateOnly ? 'UTC' : NY, month: 'short', day: '2-digit', year: 'numeric' }).replace(',', '').toUpperCase();
  if (dateOnly) return `${day} CLOSE`;
  const time = d.toLocaleTimeString('en-GB', { timeZone: NY, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time} ET`;
}

const decimalsFor = (q) => (Number.isFinite(q.decimals) ? q.decimals : Math.abs(q.last) < 1 ? 4 : 2);
const fmtFixed = (n, d) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n, d) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${fmtFixed(Math.abs(n), d)}`;

// The words after ?c= that make a ticker card: a symbol, maybe a range. parse is the
// router's parseCommand (injected): commands never count, AAPL and GOLD do.
export function quoteTicker(c, parse) {
  const text = String(c || '').trim();
  if (!text || text.length > 40) return null;
  const cmd = parse(text);
  return cmd?.name === 'QUOTE' && !cmd.error && cmd.args?.ticker ? cmd.args.ticker : null;
}

// Quote + 1-month bars -> the card's words and numbers, all from the data.
export function quoteModel(q, chart, ticker) {
  const dp = decimalsFor(q);
  let points = (chart?.points || []).map((p) => p.v).filter(Number.isFinite);
  if (points.length > 80) {
    const step = Math.ceil(points.length / 80);
    points = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  }
  const first = points[0];
  const monthPct = points.length >= 2 && first ? (q.last / first - 1) * 100 : null;
  const fresh = q.realTime === true ? 'REAL TIME' : q.realTime === false ? 'DELAYED' : '';
  return {
    ticker,
    name: String(q.label || q.name || ticker).slice(0, 48),
    last: fmtFixed(q.last, dp),
    currency: q.currency || '',
    // An unknown move (null) is --, never 0.00 0.00%.
    change: Number.isFinite(q.change) ? signed(q.change, dp) : '--',
    changePct: Number.isFinite(q.changePct) ? `${signed(q.changePct, 2)}%` : '--',
    dir: q.change > 0 ? 'up' : q.change < 0 ? 'down' : 'flat',
    points,
    monthPct: monthPct === null ? null : `${signed(monthPct, 1)}%`,
    monthDir: monthPct > 0 ? 'up' : monthPct < 0 ? 'down' : 'flat',
    asOf: asOfText(q.asOf) || asOfText(q.updated),
    fresh,
    source: '', // no vendor names on share cards
    stale: Boolean(q.stale),
  };
}

// A line chart path for the points, inside w x h.
export function sparkPath(points, w, h, pad = 6) {
  if (points.length < 2) return '';
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const x = (i) => (i / (points.length - 1)) * w;
  const y = (v) => pad + (1 - (v - lo) / span) * (h - pad * 2);
  return points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
}

const tone = (dir) => (dir === 'up' ? C.up : dir === 'down' ? C.down : C.text);
const footLine = (text) => h({ position: 'absolute', left: 64, bottom: 16, right: 260, fontFamily: 'Mono', fontWeight: 500, fontSize: 16, color: C.dim, whiteSpace: 'nowrap' }, [text]);
const rule = () => h({ position: 'absolute', left: 28, right: 28, top: 38, height: 1, backgroundColor: C.rule });

export function quoteTree(m) {
  const sw = 1072;
  const sh = 170;
  const d = sparkPath(m.points, sw, sh);
  const color = tone(m.monthDir);
  const spark = d
    ? {
      type: 'svg',
      props: {
        width: sw, height: sh, viewBox: `0 0 ${sw} ${sh}`, style: { position: 'absolute', left: 64, top: 400 },
        children: [
          { type: 'path', props: { d: `${d} L${sw} ${sh} L0 ${sh} Z`, fill: color, fillOpacity: 0.08, stroke: 'none' } },
          { type: 'path', props: { d, fill: 'none', stroke: color, strokeWidth: 4, strokeLinejoin: 'round', strokeLinecap: 'round' } },
        ],
      },
    }
    : h({ position: 'absolute', left: 64, top: 450, fontFamily: 'Mono', fontWeight: 500, fontSize: 22, color: C.dim }, ['No 1-month chart for this symbol.']);
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, [
    topLine(m.ticker),
    rule(),
    h({ position: 'absolute', left: 64, top: 74, right: 64, alignItems: 'flex-end', whiteSpace: 'nowrap' }, [
      h({ fontWeight: 800, fontSize: 40, color: C.accent, marginRight: 24 }, [m.ticker]),
      h({ fontWeight: 500, fontSize: 28, color: C.text, marginBottom: 3 }, [m.name]),
    ]),
    h({ position: 'absolute', left: 64, top: 134, alignItems: 'flex-end', whiteSpace: 'nowrap' }, [
      h({ fontWeight: 800, fontSize: 120, letterSpacing: -4, color: C.text, lineHeight: 1 }, [m.last]),
      h({ fontWeight: 500, fontSize: 30, color: C.dim, marginLeft: 18, marginBottom: 14 }, [m.currency]),
    ]),
    h({ position: 'absolute', left: 64, top: 284, fontWeight: 800, fontSize: 38, color: tone(m.dir), whiteSpace: 'nowrap' }, [`${m.change}  ${m.changePct}  TODAY`]),
    h({ position: 'absolute', left: 64, top: 356, fontWeight: 500, fontSize: 20, color: C.dim, whiteSpace: 'nowrap' }, [
      h({ marginRight: 16, letterSpacing: 2 }, ['1 MONTH']),
      h({ color, fontWeight: 800 }, [m.monthPct || '']),
    ]),
    spark,
    footLine([`AS OF ${m.asOf || '--'}`, m.fresh, m.source ? `SOURCE: ${m.source}` : ''].filter(Boolean).join(' · ')),
    siteMark(),
  ]);
}

// The card's model for ?c=AAPL, or null when c is not a symbol with a quote.
// deps: { getQuote, getChart, parse } (injected for tests), cacheDir.
export async function getQuoteCard(c, { getQuote, getChart, parse, cacheDir = CACHE_DIR, now = Date.now() }) {
  const ticker = quoteTicker(c, parse);
  if (!ticker) return null;
  const file = path.join(cacheDir, `quote-${hash(ticker)}.json`);
  const hit = await readFresh(file, now, QUOTE_TTL_MS);
  if (hit) { try { return JSON.parse(hit); } catch { /* redo it */ } }
  return once(`quote:${cacheDir}:${ticker}`, async () => {
    const [q, chart] = await Promise.all([getQuote(ticker), Promise.resolve().then(() => getChart(ticker, '1M')).catch(() => null)]);
    if (!q || !Number.isFinite(q.last)) return null;
    const model = quoteModel(q, chart, ticker);
    // Last-known prices are shown, but not kept.
    if (!model.stale && !chart?.stale) await writeAtomic(file, JSON.stringify(model)).catch((e) => console.error('[og]', e.message));
    return model;
  });
}

export async function quotePng(c, deps) {
  const model = await getQuoteCard(c, deps);
  if (!model) return defaultPng();
  const file = path.join(deps.cacheDir || CACHE_DIR, `quote-${hash(JSON.stringify(model))}.png`);
  const hit = await readFresh(file, Date.now(), QUOTE_TTL_MS);
  if (hit) return hit;
  return once(`png:${file}`, () => limited(async () => {
    const png = await renderPng(quoteTree(model));
    if (!model.stale) await writeAtomic(file, png).catch((e) => console.error('[og]', e.message));
    return png;
  }));
}

export function quoteMeta(m) {
  const q = new URLSearchParams({ c: m.ticker }).toString();
  const fresh = m.fresh ? `, ${m.fresh.toLowerCase()}` : '';
  return {
    title: `${m.ticker}: ${m.name} ${m.last}${m.currency ? ` ${m.currency}` : ''}, ${m.changePct} today`,
    description: [`As of ${m.asOf || 'the last trade'}${fresh}.`, m.monthPct ? `1 month: ${m.monthPct}.` : '', m.source ? `Source: ${m.source}.` : '', 'Bloombroke is a free market terminal.'].filter(Boolean).join(' '),
    image: `${SITE}/og/quote.png?${q}`,
    url: `${SITE}/?${q}`,
    alt: `${m.ticker} at ${m.last} ${m.currency}, ${m.changePct} today, with a 1-month price line.`,
  };
}

// ---- AFFORD card ----------------------------------------------------------------------

const VERDICT_TONE = { worth: C.up, sleep: C.accent, skip: C.down };

// ?c=AFFORD+1200+BIKE+2+PER+WEEK -> the card's words and numbers, or null.
export function affordModel(c) {
  const m = /^\s*AFFORD\s+(.+)$/i.exec(String(c || ''));
  if (!m || m[1].length > 120) return null;
  const args = parseAffordArgs(m[1].trim().toUpperCase().split(/\s+/));
  if (args.error) return null;
  const r = buyMaths(args);
  const uses = Number(r.uses.toFixed(1));
  return {
    command: affordCommand(args),
    label: args.label || '',
    price: fmtMoney(r.price),
    perUse: fmtMoney(r.costPerUse),
    how: `used ${howOften(r.times, r.unit)} for ${yearsWord(r.years)}`,
    uses: `${uses.toLocaleString('en-US')} ${uses === 1 ? 'use' : 'uses'}`,
    verdict: r.verdict,
    verdictKey: r.verdictKey,
    line: r.line,
  };
}

export function affordTree(m) {
  const color = VERDICT_TONE[m.verdictKey] || C.accent;
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, [
    topLine(m.command),
    rule(),
    h({ position: 'absolute', left: 64, top: 84, fontWeight: 800, fontSize: 22, letterSpacing: 3, color: C.dim }, ['CAN I AFFORD IT?']),
    h({ position: 'absolute', left: 64, top: 132, width: 640, flexWrap: 'wrap', fontWeight: 500, fontSize: 30, lineHeight: 1.3, color: C.text }, [
      `${m.label ? `${m.label}: ` : ''}${m.price}, ${m.how}, costs`,
    ]),
    h({ position: 'absolute', left: 64, top: 270, alignItems: 'flex-end', whiteSpace: 'nowrap' }, [
      h({ fontWeight: 800, fontSize: 132, letterSpacing: -5, color: C.text, lineHeight: 1 }, [m.perUse]),
      h({ fontWeight: 800, fontSize: 30, color: C.accent, marginLeft: 20, marginBottom: 16, letterSpacing: 2 }, ['PER USE']),
    ]),
    h({ position: 'absolute', left: 64, top: 440, fontWeight: 500, fontSize: 22, color: C.dim }, [`${m.uses} in all`]),
    h({ position: 'absolute', left: 740, top: 190, width: 420, flexDirection: 'column', alignItems: 'center' }, [
      h({
        flexDirection: 'column', alignItems: 'center', padding: '14px 30px 18px', border: `5px solid ${color}`, color,
        transform: 'rotate(-4deg)',
      }, [
        h({ fontWeight: 800, fontSize: 20, letterSpacing: 6 }, ['VERDICT']),
        h({ fontWeight: 800, fontSize: 48, letterSpacing: 2, marginTop: 6, whiteSpace: 'nowrap' }, [m.verdict]),
      ]),
      h({ marginTop: 34, fontWeight: 500, fontSize: 20, color: C.text }, [m.line]),
    ]),
    footLine('A rule of thumb for things you buy, not investments.'),
    siteMark(),
  ]);
}

export async function affordPng(c, { cacheDir = CACHE_DIR } = {}) {
  const model = affordModel(c);
  if (!model) return defaultPng();
  const file = path.join(cacheDir, `afford-${hash(model.command)}.png`);
  const hit = await readFresh(file);
  if (hit) return hit;
  return once(`png:${file}`, () => limited(async () => {
    const png = await renderPng(affordTree(model));
    await writeAtomic(file, png).catch((e) => console.error('[og]', e.message));
    return png;
  }));
}

export function affordMeta(m) {
  const q = new URLSearchParams({ c: m.command }).toString();
  return {
    title: `${m.label ? `${m.label}, ` : ''}${m.price}: ${m.perUse} per use. ${m.verdict}.`,
    description: `${m.label || 'It'}, ${m.how}, is ${m.uses}. AFFORD on Bloombroke, a free market terminal.`,
    image: `${SITE}/og/afford.png?${q}`,
    url: `${SITE}/?${q}`,
    alt: `Can I afford it? ${m.perUse} per use. Verdict: ${m.verdict}.`,
  };
}

// ---- Page meta ---------------------------------------------------------------------

export function escAttr(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// The page's <link rel="canonical">, replacing any there.
export function withCanonical(html, url) {
  const clean = String(html).replace(/[ \t]*<link\s+rel="canonical"[^>]*>\n?/g, '');
  return clean.replace('</head>', `  <link rel="canonical" href="${escAttr(url)}">\n</head>`);
}

// Replace the page's share meta (og:*, twitter:*) with these values. A page with its own
// url (a shared result, a command screen) also gets its own <title>, description and
// canonical link; the site card (no url) leaves the page's own ones alone.
export function withMeta(html, meta) {
  const out = shareMeta(html, meta);
  if (!meta.url) return out;
  return withCanonical(out, meta.url)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escAttr(meta.title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/, () => `<meta name="description" content="${escAttr(meta.description)}">`);
}

function shareMeta(html, { title, description, image, url, alt }) {
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
  title: 'Bloombroke: a free market terminal. Pro $420 a year.',
  description: 'A free market terminal for normal people: quotes, charts, news, FX and money tools. Type a command, get the answer.',
  image: `${SITE}/og/default.png`,
  alt: 'Bloombroke: a free market terminal for normal people.',
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


// ---- WEIRD share cards (lib/og-weird.js) reuse these ------------------------------------
export { C as COLORS, h as el, topLine, rule, limited, once };
