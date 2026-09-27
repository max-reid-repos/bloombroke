// The WHY share card: GET /og/why.png?c=WHY+AAPL
//
// The symbol and its top 3 daily moves of the last year: date, % move, close and the
// first thing that came out that day (or --). The numbers come from the same getWhy the
// screen uses (data/why.js). Layout, fonts and the two-at-a-time render limit are
// lib/og.js's; the page title and description are lib/seo.js's (whyMeta).
//
// Only WHY <ticker> for a company stock makes a card; anything else gets the site card.
// Rendered PNGs sit in a small in-memory LRU keyed by a hash of every word and number
// drawn, so a card is drawn again only when its data changes.

import { createHash } from 'node:crypto';
import { COLORS as C, el as h, topLine, rule, limited, once, renderPng, defaultPng, W, H } from './og.js';
import { whyMeta } from './seo.js';

export const CARD_ROWS = 3;
const CARD_MAX_AGE = 3600;
const MINUS = '−';

const hash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t;
};
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dayText = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  return m ? `${MON[Number(m[2]) - 1]} ${m[3]}, ${m[1]}` : '--';
};
const pctText = (n) => (Number.isFinite(n) ? `${n > 0 ? '+' : n < 0 ? MINUS : ''}${Math.abs(n).toFixed(2)}%` : '--');
const closeText = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--');

// ?c=... -> the ticker when c is WHY <ticker> (either word order), else null.
// parse: the router's parseCommand (injected).
export function whyTicker(c, parse) {
  const text = String(c || '').trim();
  if (!text || text.length > 40) return null;
  const cmd = parse(text);
  return cmd?.name === 'WHY' && !cmd.error && cmd.args?.ticker ? cmd.args.ticker : null;
}

// getWhy's answer -> the card's words and numbers, or null (not a company, no moves).
export function whyCardModel(d) {
  if (!d?.company || !d.rows?.length) return null;
  return {
    ticker: d.ticker,
    name: clip(d.name || '', 40),
    rows: d.rows.slice(0, CARD_ROWS).map((r) => ({
      date: dayText(r.date),
      pct: pctText(r.pct),
      dir: r.pct > 0 ? 'up' : r.pct < 0 ? 'down' : 'flat',
      close: closeText(r.close),
      what: r.items?.length ? clip(r.items[0].text, 40) : '--',
      more: Math.max(0, (r.items?.length || 0) - 1),
    })),
  };
}

const tone = (dir) => (dir === 'up' ? C.up : dir === 'down' ? C.down : C.text);

export function whyTree(m) {
  const rowH = 118;
  const top = 186;
  const rows = m.rows.map((r, i) => h({
    position: 'absolute', left: 64, right: 64, top: top + i * rowH, height: rowH - 14,
    alignItems: 'center', borderBottom: `1px solid ${C.rule}`, fontFamily: 'Mono', whiteSpace: 'nowrap',
  }, [
    h({ width: 190, flexDirection: 'column' }, [
      h({ fontWeight: 500, fontSize: 22, color: C.dim }, [r.date]),
      h({ fontWeight: 500, fontSize: 18, color: C.dim, marginTop: 6 }, [`CLOSE ${r.close}`]),
    ]),
    h({ width: 250, justifyContent: 'flex-end', fontWeight: 800, fontSize: 54, letterSpacing: -2, color: tone(r.dir) }, [r.pct]),
    h({ flex: 1, marginLeft: 44, flexDirection: 'column', overflow: 'hidden' }, [
      h({ fontWeight: 500, fontSize: 24, color: r.what === '--' ? C.dim : C.text }, [r.what]),
      ...(r.more ? [h({ fontWeight: 500, fontSize: 17, color: C.dim, marginTop: 6 }, [`+${r.more} MORE`])] : []),
    ]),
  ]));
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, [
    topLine(`WHY ${m.ticker}`),
    rule(),
    h({ position: 'absolute', left: 64, top: 70, right: 64, alignItems: 'flex-end', whiteSpace: 'nowrap' }, [
      h({ fontWeight: 800, fontSize: 44, color: C.accent, marginRight: 24 }, [m.ticker]),
      h({ fontWeight: 500, fontSize: 28, color: C.text, marginBottom: 4 }, [m.name]),
    ]),
    h({ position: 'absolute', left: 64, top: 134, fontWeight: 800, fontSize: 20, letterSpacing: 3, color: C.dim, whiteSpace: 'nowrap' }, ['BIGGEST DAILY MOVES, 1Y   ·   WHAT CAME OUT THAT DAY']),
    ...rows,
    h({ position: 'absolute', left: 64, bottom: 16, right: 260, fontFamily: 'Mono', fontWeight: 500, fontSize: 16, color: C.dim, whiteSpace: 'nowrap' }, [
      'Not a cause. Sources: CNBC daily closes, SEC EDGAR, logged headlines.',
    ]),
    h({ position: 'absolute', right: 28, bottom: 16, fontFamily: 'Mono', fontWeight: 500, fontSize: 17, color: C.dim }, ['bloombroke.com']),
  ]);
}

const within = (p, ms) => Promise.race([p, new Promise((r) => { setTimeout(r, ms, null).unref?.(); })]);

// getWhy: data/why.js (injected). parse: the router's parseCommand.
export function makeWhyCards({ getWhy, parse, render = (tree) => renderPng(tree), fallback = () => defaultPng(), maxEntries = 64 } = {}) {
  const lru = new Map();
  const remember = (k, png) => {
    lru.delete(k);
    lru.set(k, png);
    while (lru.size > maxEntries) lru.delete(lru.keys().next().value);
  };

  async function model(ticker, wait) {
    const d = await within(getWhy(ticker).catch(() => null), wait);
    return whyCardModel(d);
  }

  // { png, maxAge } for ?c=WHY+<ticker>: the card, or the site card.
  async function png(c, { wait = 8000 } = {}) {
    const ticker = whyTicker(c, parse);
    const m = ticker ? await model(ticker, wait) : null;
    if (!m) return { png: await fallback(), maxAge: 300 };
    const key = hash(JSON.stringify(m));
    if (lru.has(key)) return { png: lru.get(key), maxAge: CARD_MAX_AGE };
    const out = await once(`why:${key}`, () => limited(async () => render(whyTree(m))));
    remember(key, out);
    return { png: out, maxAge: CARD_MAX_AGE };
  }

  // The page meta for ?c=WHY+<ticker>, or null when c is not WHY <ticker>. A slow or
  // failed answer still gets WHY's own title and card link, without the numbers.
  async function meta(c, { wait = 2500 } = {}) {
    const ticker = whyTicker(c, parse);
    if (!ticker) return null;
    const d = await within(getWhy(ticker).catch(() => null), wait);
    if (d && !d.company) return whyMeta(ticker, { company: false });
    const m = whyCardModel(d);
    return whyMeta(ticker, m ? { name: m.name, top: m.rows[0] } : {});
  }

  return { png, meta };
}

// GET /og/why.png?c=WHY+AAPL on an express app. Returns the cards, for the share page meta.
export function mountWhyCards(app, deps) {
  const cards = makeWhyCards(deps);
  const send = (res, png, maxAge) => res.set({ 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${maxAge}` }).send(png);
  app.get('/og/why.png', async (req, res) => {
    try {
      const card = await cards.png(typeof req.query.c === 'string' ? req.query.c : '');
      send(res, card.png, card.maxAge);
    } catch (err) {
      console.error('[og]', err.message);
      try { send(res, await (deps.fallback || defaultPng)(), 300); } catch { res.status(503).end(); }
    }
  });
  return cards;
}
