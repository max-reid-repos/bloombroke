// NO SUCH TICKER. YET.: the server side.
//
// GET /api/graveyard            every graveyard entry (data/graveyard.json)
// GET /api/nosuch?t=WORD        { grave, ipo, wins }: the graveyard entry or null; ipo: IPO IT
//                               may draw WORD; wins: WORD is that entry's own ticker and no
//                               US listing answers it (the tombstone beats the quote)
// GET /og/tombstone.png?t=LEH   a graveyard entry's share card, 1200x630
// GET /og/ipo.png?t=WORD        the IPO IT listing certificate, 1200x630
//
// IPO IT draws only a word that passes ipoAllowed: A-Z, 1 to 5 letters, not a known live
// ticker (public/nosuch.js ipoShape), not flagged by the obscenity library (MIT, its
// English dataset with the recommended transformers), and not on the owner's extra list
// in data/ipo-blocklist.txt. The browser never checks words itself: it asks /api/nosuch.
// Anything refused gets the site card, never an error and never the word.
//
// Cards are kept in small in-memory maps: 40ish tombstones at most, and a bounded LRU of
// IPO certificates, with a per-address limit on new IPO renders.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { COLORS as C, el as h, topLine, rule, limited, once, renderPng, defaultPng, makeRateLimit, POS, W, H, SITE } from './og.js';
import { ipoShape, graveBeatsQuote, findGrave, dayText, tombstoneLine, srcHost, IPO_LINES, IPO_STAMP, matchNoSuch } from '../public/nosuch.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GRAVEYARD_FILE = path.join(root, 'data', 'graveyard.json');
export const BLOCKLIST_FILE = path.join(root, 'data', 'ipo-blocklist.txt');
export const IPO_MAX_AGE = 7 * 24 * 3600;
export const TOMB_MAX_AGE = 24 * 3600;
export const IPO_MEMORY = 200;
export const IPO_RATE = { renders: 30, windowMs: 10 * 60_000, addresses: 5000 };

// ---- Data -----------------------------------------------------------------------------

export function loadGraveyard(file = GRAVEYARD_FILE) {
  const list = JSON.parse(readFileSync(file, 'utf8'));
  return list.filter((e) => e && /^[A-Z]{1,5}$/.test(e.ticker) && e.name && e.what && /^\d{4}-\d{2}-\d{2}$/.test(e.date)
    && Array.isArray(e.src) && e.src.length && e.src.every((u) => /^https:\/\//.test(u)));
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

// A pencil-grey headstone on the terminal: the ticker, the name, what happened and when.
export function tombstoneTree(e) {
  const stoneW = 540;
  const stoneH = 470;
  const sx = (W - stoneW) / 2;
  const sy = 84;
  const ink = '#1E2630';
  const line = (text, size, style = {}) => h({ fontSize: size, lineHeight: 1.15, whiteSpace: 'nowrap', color: ink, ...style }, [text]);
  const big = Math.min(120, 440 / (e.ticker.length * 0.62));
  const stone = h({
    position: 'absolute', left: sx, top: sy, width: stoneW, height: stoneH, flexDirection: 'column', alignItems: 'center',
    backgroundColor: '#B9C4CD', border: `5px solid ${ink}`, borderTopLeftRadius: stoneW / 2, borderTopRightRadius: stoneW / 2, paddingTop: 70,
  }, [
    line('R.I.P.', 44, { fontFamily: 'Hand' }),
    line(e.ticker, big, { fontFamily: 'Mono', fontWeight: 800, letterSpacing: -big * 0.04, marginTop: 6 }),
    line(e.name, 30, { fontFamily: 'Mono', fontWeight: 800, marginTop: 8 }),
    ...(Number.isInteger(e.listed) ? [line(`Listed ${e.listed}`, 36, { fontFamily: 'Hand', marginTop: 14 })] : []),
    line(e.what, 36, { fontFamily: 'Hand', marginTop: Number.isInteger(e.listed) ? 0 : 14 }),
    line(dayText(e.date), 28, { fontFamily: 'Mono', fontWeight: 800, marginTop: 6 }),
  ]);
  const ground = h({ position: 'absolute', left: 150, right: 150, top: sy + stoneH, height: 4, backgroundColor: C.dim });
  const host = srcHost(e.src[0]);
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, [
    topLine(`GRAVEYARD ${e.ticker}`),
    rule(),
    stone,
    ground,
    foot(host ? `Source: ${host}. History, not advice.` : 'History, not advice.'),
    siteMark(),
  ]);
}

// ---- Meta for a shared link -------------------------------------------------------------

// ?c=IPO IT MAXX or ?c=GRAVEYARD LEH -> the page's title, description and card; else null.
export function nosuchMeta(c, { graveyard, block }) {
  const toks = String(c || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!toks.length || toks.length > 3) return null;
  const m = matchNoSuch(toks[0], toks.slice(1));
  if (!m) return null;
  if (m.name === 'GRAVEYARD') {
    const e = m.args.ticker ? findGrave(graveyard, m.args.ticker) : null;
    if (!e) return null;
    const q = new URLSearchParams({ c: `GRAVEYARD ${e.ticker}` }).toString();
    return {
      title: `${tombstoneLine(e)} | GRAVEYARD | Bloombroke`,
      description: `${tombstoneLine(e)} Famous tickers that are gone, with sources. Bloombroke is a free market terminal.`,
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

function lru(max) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > max) m.delete(m.keys().next().value); },
    get size() { return m.size; },
  };
}

// deps: graveyard (list), block (parsed list), render, fallback, allow (per-address limit).
export function makeNoSuchCards({
  graveyard = loadGraveyard(), block = loadBlocklist(), render = (tree) => renderPng(tree),
  fallback = () => defaultPng(), allow = makeRateLimit(IPO_RATE),
} = {}) {
  const tombs = new Map();
  const ipos = lru(IPO_MEMORY);
  // { png, maxAge }: the card, or the site card for 5 minutes.
  async function tombstone(t) {
    const e = findGrave(graveyard, t);
    if (!e || e.ticker !== String(t || '').toUpperCase()) return { png: await fallback(), maxAge: 300 };
    if (!tombs.has(e.ticker)) {
      tombs.set(e.ticker, once(`tomb:${e.ticker}`, () => limited(async () => render(tombstoneTree(e))))
        .catch((err) => { tombs.delete(e.ticker); throw err; }));
    }
    return { png: await tombs.get(e.ticker), maxAge: TOMB_MAX_AGE };
  }
  async function ipo(t, ip = null) {
    const word = ipoAllowed(t, block);
    if (!word) return { png: await fallback(), maxAge: 300 };
    const hit = ipos.get(word);
    if (hit) return { png: hit, maxAge: IPO_MAX_AGE };
    if (!allow(ip)) return { png: await fallback(), maxAge: 60 };
    const png = await once(`ipo:${word}`, () => limited(async () => render(await ipoTree(word))));
    ipos.set(word, png);
    return { png, maxAge: IPO_MAX_AGE };
  }
  return { tombstone, ipo, graveyard, block };
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
  app.get('/api/graveyard', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600').json({ entries: cards.graveyard });
  });
  app.get('/api/nosuch', async (req, res) => {
    const t = str(req.query.t).toUpperCase();
    const grave = findGrave(cards.graveyard, t);
    res.set('Cache-Control', 'public, max-age=600').json({ grave, ipo: !grave && Boolean(ipoAllowed(t, cards.block)), wins: await wins(grave, t) });
  });
  return { ...cards, meta: (c) => nosuchMeta(c, cards) };
}
