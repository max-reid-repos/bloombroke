// NO SUCH TICKER. YET.: the server side.
//
// GET /api/graveyard            every graveyard entry (data/graveyard.json)
// GET /api/nosuch?t=WORD        { grave, ipo, wins }: the graveyard entry or null; ipo: IPO IT
//                               may draw WORD; wins: WORD is that entry's own ticker and no
//                               US listing answers it (the tombstone beats the quote)
// GET /og/tombstone.png?t=LEH   a graveyard entry's (or a zombie's) share card, 1200x630
// GET /og/onthisday.png         today's anniversary stone (lib/graveyard.js onThisDay)
// GET /og/ipo.png?t=WORD        the IPO IT listing certificate, 1200x630
//
// IPO IT draws only a word that passes ipoAllowed: A-Z, 1 to 5 letters, not a known live
// ticker (public/nosuch.js ipoShape), not flagged by the obscenity library (MIT, its
// English dataset with the recommended transformers), and not on the owner's extra list
// in data/ipo-blocklist.txt. The browser never checks words itself: it asks /api/nosuch.
// Anything refused gets the site card, never an error and never the word.
//
// Cards live in memory only, never on disk: the 34ish tombstones, and a bounded LRU of IPO
// certificates (entries and bytes). About 12 million words fit the IPO shape, so new IPO
// renders are limited per address, across all addresses, and in how many may wait at once.
// Over any limit: the site card, kept 60 seconds. Only a drawn card is kept long.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { COLORS as C, el as h, topLine, rule, limited, once, renderPng, defaultPng, makeRateLimit, POS, W, H, SITE } from './og.js';
import { ipoShape, graveBeatsQuote, findGrave, dayText, tombstoneLine, srcHost, stoneYears, IPO_LINES, IPO_STAMP, matchNoSuch } from '../public/nosuch.js';
import { loadGraveyardData, artOnDisk, withArt, onThisDay } from './graveyard.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GRAVEYARD_FILE = path.join(root, 'data', 'graveyard.json');
export const BLOCKLIST_FILE = path.join(root, 'data', 'ipo-blocklist.txt');
export const IPO_MAX_AGE = 7 * 24 * 3600;
export const TOMB_MAX_AGE = 24 * 3600;
export const IPO_MEMORY = { entries: 500, bytes: 64 * 1024 * 1024 };
export const IPO_RATE = { renders: 30, windowMs: 10 * 60_000, addresses: 5000 }; // per address
export const IPO_GLOBAL = { renders: 600, windowMs: 10 * 60_000, addresses: 1 }; // all addresses
export const IPO_PENDING_MAX = 8; // new renders waiting or running at once
export const REFUSED_MAX_AGE = 300;
export const BUSY_MAX_AGE = 60;

// ---- Data -----------------------------------------------------------------------------

// The stones (no zombies), well formed, optional facts cleaned (lib/graveyard.js).
export function loadGraveyard(file = GRAVEYARD_FILE) {
  return loadGraveyardData(file).stones;
}

// The word list: one per line, upper case A-Z; '*' in front blocks it anywhere inside a
// word. '#' starts a comment. { words: Set, roots: [] }.
export function parseBlocklist(text) {
  const words = new Set();
  const roots = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim().toUpperCase();
    if (!line) continue;
    if (line.startsWith('*') && /^[A-Z]{2,12}$/.test(line.slice(1))) roots.push(line.slice(1));
    else if (/^[A-Z]{1,12}$/.test(line)) words.add(line);
  }
  return { words, roots };
}
export function loadBlocklist(file = process.env.BB_IPO_BLOCKLIST || BLOCKLIST_FILE) {
  try { return parseBlocklist(readFileSync(file, 'utf8')); } catch { return parseBlocklist(''); }
}

// The obscenity library's matcher: built once, on first use.
let matcher = null;
export function profanityMatcher() {
  if (!matcher) matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
  return matcher;
}
export function flagged(word, m = profanityMatcher()) {
  try { return m.hasMatch(String(word).toLowerCase()); } catch { return true; } // broken check: refuse
}

// The word, upper case, when IPO IT may draw it; else null. block: the owner's extra list.
export function ipoAllowed(raw, block = { words: new Set(), roots: [] }) {
  const w = ipoShape(raw);
  if (!w || flagged(w)) return null;
  if (block?.words?.has(w) || block?.roots?.some((r) => w.includes(r))) return null;
  return w;
}

// ---- Cards ------------------------------------------------------------------------------

const PAPER = path.join(root, 'public', 'img', 'whatif', 'certificate.webp');
let paperUri = null;
function paper(width) {
  if (!paperUri) {
    paperUri = sharp(PAPER).resize({ width }).png().toBuffer()
      .then((b) => `data:image/png;base64,${b.toString('base64')}`)
      .catch((e) => { paperUri = null; throw e; });
  }
  return paperUri;
}
const img = (src, style, width, height) => ({ type: 'img', props: { src, width, height, style } });
const centred = (text, cx, cy, size, style = {}, boxW = 800) => h({
  position: 'absolute', left: cx - boxW / 2, top: cy - size / 2, width: boxW, height: size,
  justifyContent: 'center', alignItems: 'center', fontSize: size, lineHeight: 1, whiteSpace: 'nowrap', ...style,
}, [text]);
const foot = (text) => h({ position: 'absolute', left: 28, bottom: 16, fontFamily: 'Mono', fontWeight: 500, fontSize: 15, color: C.dim, whiteSpace: 'nowrap' }, [text]);
const siteMark = () => h({ position: 'absolute', right: 28, bottom: 16, fontFamily: 'Mono', fontWeight: 500, fontSize: 17, color: C.dim }, ['bloombroke.com']);

// The WHATIF certificate paper, with a listing on it and a red NOT A REAL SECURITY stamp.
export async function ipoTree(word) {
  const cw = 834;
  const ch = 556;
  const left = (W - cw) / 2;
  const top = 44;
  const X = (p) => (p / 100) * cw;
  const Y = (p) => (p / 100) * ch;
  const ink = { fontFamily: 'Mono', color: C.ink };
  const hand = { fontFamily: 'Hand', color: C.ink };
  const big = `$${word}`;
  const bigSize = Math.min(X(12), X(78) / (big.length * 0.62));
  const cert = h({ position: 'absolute', left, top, width: cw, height: ch }, [
    img(await paper(cw), { position: 'absolute', left: 0, top: 0 }, cw, ch),
    h({
      position: 'absolute', left: X(POS.receipt.left), top: Y(POS.receipt.top), flexDirection: 'column',
      transform: `rotate(${POS.receipt.rot}deg)`, transformOrigin: 'top left',
      fontFamily: 'Mono', fontWeight: 800, fontSize: X(0.92), lineHeight: `${X(2.18)}px`, color: C.inkSoft,
    }, ['LISTING DESK', 'TICKER', big, 'SHARES 1', 'PRICE $0.00'].map((l) => h({ whiteSpace: 'nowrap' }, [l]))),
    centred('Listing Certificate', X(POS.ribbon.x), Y(POS.ribbon.y), X(3.6), hand),
    centred(big, X(POS.big.x), Y(POS.big.y), bigSize, { ...ink, fontWeight: 800, letterSpacing: -bigSize * 0.04, transform: `rotate(${POS.big.rot}deg)` }),
    centred('Bloombroke hereby lists', X(POS.today.x), Y(POS.today.y), X(2.8), { ...hand, color: C.inkSoft }),
    centred(`${IPO_LINES[0]} · ${IPO_LINES[1]}`, X(POS.l1.x), Y(POS.l1.y) - X(1.6), X(2.1), { ...ink, fontWeight: 800 }),
    centred(IPO_LINES[2], X(POS.l2.x), Y(POS.l2.y) - X(1.6), X(2.1), { ...ink, fontWeight: 500, color: C.inkSoft }),
    centred('IPO', X(POS.rosette.x), Y(POS.rosette.y), X(4.4), { ...ink, fontWeight: 800 }, X(20)),
    h({
      position: 'absolute', left: X(4), top: Y(55), width: X(30), height: X(7), transform: 'rotate(-10deg)',
      border: `${X(0.5)}px solid ${C.red}`, borderRadius: X(1), alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Mono', fontWeight: 800, fontSize: X(2.1), letterSpacing: X(0.15), color: C.red, whiteSpace: 'nowrap', opacity: 0.88,
    }, [IPO_STAMP]),
  ]);
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative' }, [
    topLine(`IPO IT ${word}`),
    cert,
    foot('A joke. Not a real security, not a real listing.'),
    siteMark(),
  ]);
}

// Art from public/img/graveyard as data URIs for satori, kept per file and size.
const artUris = new Map();
function artUri(file, width, height) {
  const key = `${file}@${width}x${height || ''}`;
  if (!artUris.has(key)) {
    artUris.set(key, sharp(file).resize({ width, height, fit: 'cover' }).png().toBuffer()
      .then((b) => `data:image/png;base64,${b.toString('base64')}`)
      .catch((e) => { artUris.delete(key); throw e; }));
  }
  return artUris.get(key);
}

const STONE_INK = '#1E2630';
// The share card: the cemetery at dusk (when drawn), the stone with its words, the
// company's doodle at its foot, and what happened beside it. Without the art: a pencil-
// grey stone drawn in place, same layout. label: a line over the facts (ON THIS DAY).
export async function tombstoneTree(e, { art = null, label = '' } = {}) {
  const sw = 400;
  const sh = 520;
  const sx = 140;
  const sy = 70;
  const has = (u) => Boolean(u && art?.dir);
  const file = (u) => path.join(art.dir, path.basename(u));
  const [bg, stoneImg, doodle] = await Promise.all([
    has(art?.cemetery) ? artUri(file(art.cemetery), W, H) : null,
    has(art?.stone) ? artUri(file(art.stone), sw, sh) : null,
    art?.doodles?.includes(e.ticker) ? artUri(path.join(art.dir, `doodle-${e.ticker.toLowerCase()}.webp`), 200, 200) : null,
  ]);
  const line = (text, size, style = {}) => h({ fontSize: size, lineHeight: 1.15, whiteSpace: 'nowrap', color: STONE_INK, ...style }, [text]);
  const big = Math.min(96, 300 / (e.ticker.length * 0.62));
  const face = [
    line(e.zombie ? 'RETURNED' : 'R.I.P.', e.zombie ? 30 : 40, { fontFamily: e.zombie ? 'Mono' : 'Hand', fontWeight: 800, letterSpacing: e.zombie ? 4 : 0 }),
    line(e.ticker, big, { fontFamily: 'Mono', fontWeight: 800, letterSpacing: -big * 0.04, marginTop: 4 }),
    line(e.name, e.name.length > 18 ? 20 : 24, { fontFamily: 'Mono', fontWeight: 800, marginTop: 6 }),
    line(stoneYears(e), 22, { fontFamily: 'Mono', fontWeight: 500, marginTop: 6 }),
    ...(e.epitaph ? [h({ fontFamily: 'Hand', fontSize: 28, lineHeight: 1.05, color: STONE_INK, marginTop: 14, width: 280, justifyContent: 'center', textAlign: 'center' }, [e.epitaph])] : []),
  ];
  const stone = stoneImg
    ? h({ position: 'absolute', left: sx, top: sy, width: sw, height: sh }, [
      img(stoneImg, { position: 'absolute', left: 0, top: 0 }, sw, sh),
      h({ position: 'absolute', left: 40, right: 40, top: 150, flexDirection: 'column', alignItems: 'center' }, face),
    ])
    : h({
      position: 'absolute', left: sx, top: sy, width: sw, height: sh - 20, flexDirection: 'column', alignItems: 'center',
      backgroundColor: '#C9CDC6', border: `5px solid ${STONE_INK}`, borderTopLeftRadius: sw / 2, borderTopRightRadius: sw / 2, paddingTop: 80,
    }, face);
  const facts = h({ position: 'absolute', left: 640, right: 56, top: 150, flexDirection: 'column', fontFamily: 'Mono', color: C.text }, [
    ...(label ? [h({ fontWeight: 800, fontSize: 20, letterSpacing: 3, color: C.accent, marginBottom: 14 }, [label])] : []),
    h({ fontWeight: 800, fontSize: 36, lineHeight: 1.15 }, [e.what]),
    h({ fontWeight: 800, fontSize: 30, color: C.accent, marginTop: 8 }, [dayText(e.date)]),
    ...(e.zombie ? [h({ fontWeight: 500, fontSize: 24, marginTop: 18, color: C.text }, [`${e.back.what} ${dayText(e.back.date)}`])] : []),
    ...(e.cause ? [h({ fontWeight: 500, fontSize: 22, lineHeight: 1.3, marginTop: 18, color: C.dim }, [e.cause])] : []),
  ]);
  const host = srcHost(e.src[0]);
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, [
    ...(bg ? [img(bg, { position: 'absolute', left: 0, top: 0 }, W, H), h({ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: 'rgba(5,8,12,0.55)' })] : []),
    topLine(`GRAVEYARD ${e.ticker}`),
    rule(),
    stone,
    ...(stoneImg ? [] : [h({ position: 'absolute', left: sx - 60, width: sw + 120, top: sy + sh - 20, height: 4, backgroundColor: C.dim })]),
    ...(doodle ? [img(doodle, { position: 'absolute', left: sx + sw - 110, top: sy + sh - 190, transform: 'rotate(-6deg)' }, 200, 200)] : []),
    facts,
    foot(host ? `Source: ${host}. History, not advice.` : 'History, not advice.'),
    siteMark(),
  ]);
}

// ---- Meta for a shared link -------------------------------------------------------------

// A stone page's description, from its facts only.
export function stoneDescription(e) {
  const cause = e.cause ? ` ${e.cause.replace(/\.?$/, '.')}` : '';
  const back = e.zombie ? ` ${e.back.what} ${dayText(e.back.date)}.` : '';
  return `${tombstoneLine(e)}${back}${cause} From the Bloombroke graveyard: famous tickers that are gone, with sources.`;
}

// ?c=IPO IT MAXX, ?c=GRAVEYARD LEH (a stone or a zombie) or ?c=GRAVEYARD TODAY -> the
// page's title, description, canonical and card; else null.
export function nosuchMeta(c, { graveyard, zombies = [], block, today = null }) {
  const toks = String(c || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!toks.length || toks.length > 3) return null;
  const m = matchNoSuch(toks[0], toks.slice(1));
  if (!m) return null;
  if (m.name === 'GRAVEYARD') {
    if (m.args.view === 'TODAY') {
      const e = today ? onThisDay(graveyard, today())[0] : null;
      if (!e) return null;
      return {
        title: `On this day: ${tombstoneLine(e)} | GRAVEYARD | Bloombroke`,
        description: stoneDescription(e),
        image: `${SITE}/og/onthisday.png`,
        url: `${SITE}/?${new URLSearchParams({ c: `GRAVEYARD ${e.ticker}` })}`,
        alt: `A headstone: ${tombstoneLine(e)}`,
      };
    }
    const e = m.args.ticker ? findGrave(graveyard, m.args.ticker) || findGrave(zombies, m.args.ticker) : null;
    if (!e) return null;
    const q = new URLSearchParams({ c: `GRAVEYARD ${e.ticker}` }).toString();
    return {
      title: e.seoTitle ? `${e.seoTitle} | Bloombroke` : `${tombstoneLine(e)} | GRAVEYARD | Bloombroke`,
      description: stoneDescription(e),
      image: `${SITE}/og/tombstone.png?${new URLSearchParams({ t: e.ticker })}`,
      url: `${SITE}/?${q}`,
      alt: `A headstone: ${tombstoneLine(e)}`,
    };
  }
  const word = ipoAllowed(m.args.word, block);
  if (!word) return null;
  return {
    title: `$${word} is listed. Not really. | Bloombroke`,
    description: `A Bloombroke listing certificate for $${word}. Shares outstanding: 1. Price: $0.00. Exchange: your imagination. Not a real security.`,
    image: `${SITE}/og/ipo.png?${new URLSearchParams({ t: word })}`,
    url: `${SITE}/?${new URLSearchParams({ c: `IPO IT ${word}` })}`,
    alt: `A listing certificate for $${word}, stamped NOT A REAL SECURITY.`,
  };
}

// ---- Routes -------------------------------------------------------------------------------

// An LRU of Buffers, bounded by entries and by total bytes.
export function byteLru({ entries, bytes }) {
  const m = new Map();
  let total = 0;
  const drop = (k) => { total -= m.get(k).length; m.delete(k); };
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) {
      if (m.has(k)) drop(k);
      if (v.length > bytes) return;
      m.set(k, v);
      total += v.length;
      while (m.size > entries || total > bytes) drop(m.keys().next().value);
    },
    get size() { return m.size; },
    get bytes() { return total; },
  };
}

// deps: graveyard (the stones), zombies, art (lib/graveyard.js artOnDisk), today (the New
// York day, 'YYYY-MM-DD'), block (parsed list), render, fallback, allow (per-address
// limit), allowAll (the limit across all addresses), memory (the LRU's bounds).
export function makeNoSuchCards({
  graveyard = loadGraveyard(), zombies = [], art = artOnDisk(), today = null,
  block = loadBlocklist(), render = (tree) => renderPng(tree),
  fallback = () => defaultPng(), allow = makeRateLimit(IPO_RATE), allowAll = makeRateLimit(IPO_GLOBAL),
  memory = IPO_MEMORY, pendingMax = IPO_PENDING_MAX,
} = {}) {
  const tombs = new Map();
  const ipos = byteLru(memory);
  const inflight = new Map(); // word -> the render in progress
  const busy = async () => ({ png: await fallback(), maxAge: BUSY_MAX_AGE, drawn: false });
  const drawStone = (key, e, opts) => {
    if (!tombs.has(key)) {
      tombs.set(key, once(`tomb:${key}`, () => limited(async () => render(await tombstoneTree(e, { art, ...opts }))))
        .catch((err) => { tombs.delete(key); throw err; }));
    }
    return tombs.get(key);
  };
  // { png, maxAge }: the card (a stone or a zombie), or the site card for 5 minutes.
  async function tombstone(t) {
    const want = String(t || '').toUpperCase();
    const e = graveyard.find((x) => x.ticker === want) || zombies.find((x) => x.ticker === want);
    if (!e) return { png: await fallback(), maxAge: REFUSED_MAX_AGE };
    return { png: await drawStone(e.ticker, e), maxAge: TOMB_MAX_AGE };
  }
  // Today's anniversary stone with ON THIS DAY over its facts; the site card on other days.
  async function onthisday() {
    const day = today ? today() : null;
    const e = day ? onThisDay(graveyard, day)[0] : null;
    if (!e) return { png: await fallback(), maxAge: REFUSED_MAX_AGE };
    const years = Number(day.slice(0, 4)) - Number((e.anniversary || e.date).slice(0, 4));
    return { png: await drawStone(`otd:${day}:${e.ticker}`, e, { label: `ON THIS DAY, ${years} ${years === 1 ? 'YEAR' : 'YEARS'} AGO` }), maxAge: 3600 };
  }
  // { png, maxAge, drawn }: a drawn certificate (kept a week), or the site card (a refused
  // word: 5 minutes; over a limit or a failed render: 60 seconds).
  async function ipo(t, ip = null) {
    const word = ipoAllowed(t, block);
    if (!word) return { png: await fallback(), maxAge: REFUSED_MAX_AGE, drawn: false };
    const hit = ipos.get(word);
    if (hit) return { png: hit, maxAge: IPO_MAX_AGE, drawn: true };
    if (!inflight.has(word)) {
      if (inflight.size >= pendingMax || !allow(ip) || !allowAll('all')) return busy();
      const job = limited(async () => render(await ipoTree(word)))
        .then((png) => { ipos.set(word, png); return png; })
        .finally(() => inflight.delete(word));
      inflight.set(word, job);
    }
    try {
      return { png: await inflight.get(word), maxAge: IPO_MAX_AGE, drawn: true };
    } catch (err) {
      console.error('[og]', err.message);
      return busy();
    }
  }
  return { tombstone, onthisday, ipo, graveyard, zombies, art, today, block, cache: ipos, pending: () => inflight.size };
}

const str = (v) => (typeof v === 'string' ? v.slice(0, 16) : '');

// getQuote: data/quotes.js getQuote (injected). Only asked for a graveyard ticker.
export function mountNoSuch(app, deps = {}) {
  const cards = makeNoSuchCards(deps);
  const getQuote = deps.getQuote || null;
  const wins = async (e, t) => {
    if (!e || e.ticker !== t) return false;
    if (!getQuote) return true;
    const late = Symbol('late');
    const q = await Promise.race([
      Promise.resolve().then(() => getQuote(t)).catch(() => late),
      new Promise((r) => { setTimeout(r, 2000, late).unref?.(); }),
    ]);
    return q === late ? false : graveBeatsQuote(q);
  };
  const fallback = deps.fallback || (() => defaultPng());
  const send = (res, png, maxAge) => res.set({ 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${maxAge}` }).send(png);
  const route = (fn) => async (req, res) => {
    try {
      const out = await fn(req);
      send(res, out.png, out.maxAge);
    } catch (err) {
      console.error('[og]', err.message);
      try { send(res, await fallback(), 300); } catch { res.status(503).end(); }
    }
  };
  app.get('/og/tombstone.png', route((req) => cards.tombstone(str(req.query.t))));
  app.get('/og/ipo.png', route((req) => cards.ipo(str(req.query.t), req.ip)));
  app.get('/og/onthisday.png', route(() => cards.onthisday()));
  const art = (e) => withArt(e, cards.art);
  app.get('/api/graveyard', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600').json({
      entries: cards.graveyard.map(art), zombies: cards.zombies.map(art),
      art: { stone: cards.art?.stone || null, cemetery: cards.art?.cemetery || null },
    });
  });
  app.get('/api/nosuch', async (req, res) => {
    const t = str(req.query.t).toUpperCase();
    const grave = findGrave(cards.graveyard, t);
    res.set('Cache-Control', 'public, max-age=600').json({ grave: grave ? art(grave) : null, ipo: !grave && Boolean(ipoAllowed(t, cards.block)), wins: await wins(grave, t) });
  });
  return { ...cards, meta: (c) => nosuchMeta(c, cards) };
}
