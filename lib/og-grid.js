// GRID share cards and page meta.
//
// GET /og/grid.png?s=NVDA,AMD,INTC&r=1Y   the board: each tile's symbol, value, change,
//                                          line and labelled high and low; the range
// GET /og/grid.png                         the STARTER board
//
// Drawn from cached tiles only (lib/grid.js grid.cached: the tiles /api/grid last served,
// and the ones made from local data). A card never fetches: a tile with nothing cached
// shows its symbol alone. Cards sit in a small memory LRU (never on disk) keyed by a hash
// of what they draw; a per-address limit and a render budget cap the work, and past
// either (or on any failure) the site card goes out instead.

import { createHash } from 'node:crypto';
import { COLORS as C, el as h, topLine, rule, limited, once, renderPng, defaultPng, makeRateLimit, MINE_MEMORY, SITE, W, H } from './og.js';
import { parseGrid, gridCmd, isGridStarter, GRID_RANGE, GRID_STARTER_WORD } from '../public/command-args.js';
import { layoutFor, tileFace, marksFor, sparkGeometry, placeLabel, NOTE_LINE } from '../public/screens/grid.js';
import { byteLru } from './og-nosuch.js';

export const GRID_CARD_RATE = { renders: 20, windowMs: 10 * 60_000, addresses: 5000 };
export const GRID_CARD_BUDGET = { renders: 60, windowMs: 10 * 60_000 };
export const GRID_CARD_MEMORY = { entries: MINE_MEMORY.pngs, bytes: 16 * 1024 * 1024 };
export const GRID_CARD_MAX_AGE = 600;
export const BUSY_MAX_AGE = 60;

const hash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

// ?s= and ?r= -> the parsed board (parseGrid), STARTER when there is nothing.
export function cardBoard(s = '', r = '') {
  const words = String(s || '').slice(0, 600).split(',').map((t) => t.trim()).filter(Boolean);
  const range = String(r || '').trim().toUpperCase();
  const parsed = parseGrid([...(words.length ? words : [GRID_STARTER_WORD]), ...(range ? [range] : [])]);
  return parsed.items.length ? parsed : parseGrid([GRID_STARTER_WORD]);
}

// The words for ?s= (STARTER for the starter board, else the tokens) and the card's URL.
export const cardWords = (tokens) => (isGridStarter(tokens) ? GRID_STARTER_WORD : tokens.join(','));
export function cardUrl(tokens, range = GRID_RANGE) {
  return `${SITE}/og/grid.png?${new URLSearchParams({ s: cardWords(tokens), r: range })}`;
}

// The card's model from cached tiles only. grid: lib/grid.js makeGrid (cached()).
export function gridCardModel(parsed, grid) {
  const tiles = parsed.items.map((it) => {
    const t = grid.cached(it, parsed.range);
    const sym = t?.label || String(it.token).replace(/^(W:|\$)/, '');
    if (!t || t.error) return { sym, missing: true };
    const f = tileFace(it, t);
    if (f.msg) return { sym, missing: true };
    return {
      sym, big: f.big, pill: f.pill || '', dir: f.pillDir || 'flat', text: Boolean(f.text),
      points: t.points || null, marks: marksFor(t), byTime: Boolean(t.xByTime),
      line: t.kind === 'rip' ? 'down' : (Number.isFinite(t.changePct) ? (t.changePct > 0 ? 'up' : t.changePct < 0 ? 'down' : 'flat') : 'flat'),
    };
  });
  return { command: gridCmd({ tokens: parsed.tokens, range: parsed.range }), range: parsed.range, tiles };
}

// ---- Drawing -----------------------------------------------------------------------------

const tone = (dir) => (dir === 'up' ? C.up : dir === 'down' ? C.down : C.dim);
const AREA = { left: 28, top: 52, width: W - 56, height: 534 };
const GAP = 8;

function sparkEls(t, w, hgt, fontSize) {
  const g = sparkGeometry(t.points, { w, h: hgt, marks: t.marks, byTime: t.byTime, pad: fontSize + 6 });
  if (!g) return [];
  const d = g.xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const out = [{
    type: 'svg',
    props: {
      width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, style: { position: 'absolute', left: 0, top: 0 },
      children: [{ type: 'path', props: { d, fill: 'none', stroke: tone(t.line) === C.dim ? C.accent : tone(t.line), strokeWidth: 2.5, strokeLinejoin: 'round', strokeLinecap: 'round' } }],
    },
  }];
  for (const m of g.marks) {
    const at = placeLabel(m.x, m.y, m.text, m.pos, w, hgt, fontSize);
    out.push(h({ position: 'absolute', left: m.x - 4, top: m.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: C.text }));
    out.push(h({ position: 'absolute', left: at.x, top: at.y - fontSize, height: fontSize + 2, fontSize, lineHeight: 1, color: C.text, whiteSpace: 'nowrap' }, [m.text]));
  }
  return out;
}

function tileEl(t, box) {
  const pad = Math.round(Math.min(14, box.h * 0.08));
  const symSize = Math.round(Math.max(14, Math.min(28, box.h * 0.13)));
  const kids = [h({ position: 'absolute', left: pad, top: pad, fontWeight: 800, fontSize: symSize, letterSpacing: 1, color: t.missing ? C.dim : C.accent, whiteSpace: 'nowrap' }, [t.sym])];
  if (!t.missing) {
    const bigSize = Math.round(Math.max(18, Math.min(60, box.h * (t.text ? 0.13 : 0.2))));
    const bigTop = pad + symSize + 4;
    kids.push(h({ position: 'absolute', left: pad, top: bigTop, right: pad, alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }, [
      h({ fontWeight: 800, fontSize: bigSize, lineHeight: 1.1, color: C.text, marginRight: 12 }, [t.big]),
      ...(t.pill ? [h({ fontWeight: 800, fontSize: Math.max(13, Math.round(bigSize * 0.45)), color: tone(t.dir), border: `2px solid ${tone(t.dir)}`, padding: '1px 6px' }, [t.pill])] : []),
    ]));
    const sparkTop = bigTop + Math.round(bigSize * 1.2) + 4;
    const sw = box.w - pad * 2;
    const sh = box.h - sparkTop - pad + 4;
    if (t.points && sh > 24) {
      const fontSize = Math.round(Math.max(12, Math.min(18, box.h * 0.09)));
      kids.push(h({ position: 'absolute', left: pad, top: sparkTop, width: sw, height: sh }, sparkEls(t, sw, sh, fontSize)));
    }
  }
  return h({ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, border: `1px solid ${C.rule}`, backgroundColor: '#08101A' }, kids);
}

export function gridTree(m) {
  const { cols, rows } = layoutFor(m.tiles.length);
  const tw = (AREA.width - GAP * (cols - 1)) / cols;
  const th = (AREA.height - GAP * (rows - 1)) / rows;
  const tiles = m.tiles.map((t, i) => tileEl(t, {
    x: AREA.left + (i % cols) * (tw + GAP), y: AREA.top + Math.floor(i / cols) * (th + GAP), w: Math.floor(tw), h: Math.floor(th),
  }));
  const text = m.command.replace(/^GRID ?/, '') || 'STARTER';
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, [
    topLine(`GRID ${text}${/ (1D|5D|1M|3M|6M|YTD|1Y|2Y|5Y|10Y|MAX)$/.test(m.command) ? '' : ` ${m.range}`}`),
    rule(),
    ...tiles,
    h({ position: 'absolute', left: 28, bottom: 14, fontWeight: 500, fontSize: 16, color: C.dim, whiteSpace: 'nowrap' }, [NOTE_LINE]),
    h({ position: 'absolute', right: 28, bottom: 14, fontWeight: 500, fontSize: 17, color: C.dim }, ['bloombroke.com']),
  ]);
}

// ---- Page meta ------------------------------------------------------------------------------

// /?c=GRID NVDA AMD INTC -> its title, description and card; null for anything else (bare
// GRID gets lib/seo.js PAGE_META.GRID). parse: the router's parseCommand.
export function gridMeta(c, parse) {
  const text = String(c || '').trim();
  if (!/^GRID\s+\S/i.test(text) || text.length > 400) return null;
  const cmd = parse(text);
  if (cmd?.name !== 'GRID' || cmd.args?.bare || !cmd.args?.items?.length) return null;
  const { tokens, range } = cmd.args;
  const starter = isGridStarter(tokens);
  const labels = tokens.map((t) => t.replace(/^(W:|\$)/, ''));
  const list = labels.length > 8 ? `${labels.slice(0, 8).join(', ')} and ${labels.length - 8} more` : labels.join(', ');
  const canon = gridCmd({ tokens, range });
  return {
    title: `${starter ? 'GRID STARTER' : 'GRID'}: ${list} (${range}) | Bloombroke`,
    description: `A board of ${tokens.length} mini ${tokens.length === 1 ? 'chart' : 'charts'} over ${range}: ${list}. Each shows its latest value, its change and its high and low. Free on Bloombroke, a market terminal for normal people.`,
    image: cardUrl(tokens, range),
    url: `${SITE}/?${new URLSearchParams({ c: canon })}`,
    alt: `A Bloombroke GRID board over ${range}: ${list}.`,
  };
}

// ---- Cards: cache, limits, render --------------------------------------------------------------

// deps: grid (lib/grid.js makeGrid), render, fallback (the site card), allow (per address),
// budget (renders across all addresses per window), memory (the LRU's bounds).
export function makeGridCards({
  grid, render = (tree) => renderPng(tree), fallback = () => defaultPng(),
  allow = makeRateLimit(GRID_CARD_RATE), budget = GRID_CARD_BUDGET, memory = GRID_CARD_MEMORY, now = () => Date.now(),
} = {}) {
  const lru = byteLru(memory);
  let spent = [];
  const budgetOk = () => {
    const t = now();
    spent = spent.filter((x) => t - x < budget.windowMs);
    if (spent.length >= budget.renders) return false;
    spent.push(t);
    return true;
  };
  const site = async (maxAge) => ({ png: await fallback(), maxAge, drawn: false });

  // { png, maxAge, drawn }.
  async function png(s, r, ip = null) {
    try {
      const m = gridCardModel(cardBoard(s, r), grid);
      const key = hash(JSON.stringify(m));
      const hit = lru.get(key);
      if (hit) return { png: hit, maxAge: GRID_CARD_MAX_AGE, drawn: true };
      if (!allow(ip) || !budgetOk()) return site(BUSY_MAX_AGE);
      const buf = await once(`grid:${key}`, () => limited(() => render(gridTree(m))));
      lru.set(key, buf);
      return { png: buf, maxAge: GRID_CARD_MAX_AGE, drawn: true };
    } catch (err) {
      console.error('[og]', err.message);
      return site(300);
    }
  }
  return { png, meta: gridMeta, cache: lru };
}

const str = (v) => (typeof v === 'string' ? v : '');

// GET /og/grid.png. Returns the cards (meta for the page).
export function mountGridCards(app, deps) {
  const cards = makeGridCards(deps);
  const fallback = deps.fallback || (() => defaultPng());
  app.get('/og/grid.png', async (req, res) => {
    let out;
    try {
      out = await cards.png(str(req.query.s), str(req.query.r), req.ip);
    } catch {
      try { out = { png: await fallback(), maxAge: 300 }; } catch { return res.status(503).end(); }
    }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${out.maxAge}` }).send(out.png);
  });
  return cards;
}
