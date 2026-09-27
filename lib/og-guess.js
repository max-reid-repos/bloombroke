// The GUESS share card: GET /og/guess.png, 1200x630.
//
// Today's puzzle for a linked image (newsletters strip iframes, so they link a picture):
// "GUESS #N", the mystery stock's 1-year line as % change with a % axis, and the ask.
// Nothing that gives the answer away: the model holds the puzzle number, the date and
// the % values only (no ticker, no name, no sector, no price level), and the card draws
// nothing else. The numbers come from the game itself (data/guess.js todayPuzzle), the
// same series the screen draws.
//
// Layout, fonts and the two-at-a-time render limit are lib/og.js's. One rendered card is
// kept in memory, keyed by a hash of its model, so it is drawn once a day.

import { createHash } from 'node:crypto';
import { COLORS as C, el as h, topLine, rule, limited, once, renderPng, defaultPng, W, H } from './og.js';
import { msToNextPuzzle } from '../public/screens/guess.js';

export const GUESS_CARD_POINTS = 260;
export const GUESS_ASK = 'Can you name this stock?';
export const GUESS_LINK = 'bloombroke.com/?c=GUESS';
const MINUS = '−';

const hash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const pct = (v, dp = 0) => `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(dp)}%`;

// A tick step that gives about `want` lines over the span (as the screen's chart).
function niceStep(span, want = 4) {
  const raw = span / Math.max(1, want);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw * 0.7) return m * mag;
  return 10 * mag;
}

// todayPuzzle's answer -> { n, date, points, end }, or null. Only these four keys, so
// nothing about the answer can reach the card.
export function guessCardModel(p) {
  if (!p || !Number.isInteger(p.n) || !Array.isArray(p.series)) return null;
  const vals = p.series.map((x) => Number(Array.isArray(x) ? x[1] : NaN)).filter(Number.isFinite);
  if (vals.length < 20) return null;
  const step = Math.max(1, Math.ceil(vals.length / GUESS_CARD_POINTS));
  const points = vals.filter((_, i) => i % step === 0);
  if ((vals.length - 1) % step) points.push(vals[vals.length - 1]);
  return {
    n: p.n,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) ? p.date : '',
    points: points.map((v) => Math.round(v * 100) / 100),
    end: vals[vals.length - 1],
  };
}

export function guessTree(m) {
  const cx = 64;
  const cy = 132;
  const cw = 960;
  const ch = 300;
  let lo = Math.min(0, ...m.points);
  let hi = Math.max(0, ...m.points);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;
  const x = (i) => (i / (m.points.length - 1)) * cw;
  const y = (v) => (1 - (v - lo) / (hi - lo)) * ch;
  const f = (n) => n.toFixed(1);
  const line = m.points.map((v, i) => `${i ? 'L' : 'M'}${f(x(i))} ${f(y(v))}`).join(' ');
  const zero = f(y(0));
  const step = niceStep(hi - lo, 4);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Math.abs(v) < step / 1000 ? 0 : v);
  const endY = y(m.end);
  const grid = ticks.map((v) => ({ type: 'path', props: { d: `M0 ${f(y(v))} L${cw} ${f(y(v))}`, stroke: v === 0 ? '#2B3847' : C.rule, strokeWidth: v === 0 ? 2 : 1.5, fill: 'none' } }));
  const labels = ticks
    .filter((v) => Math.abs(y(v) - endY) >= 26)
    .map((v) => h({ position: 'absolute', left: cx + cw + 14, top: cy + y(v) - 12, height: 24, alignItems: 'center', fontFamily: 'Mono', fontWeight: 500, fontSize: 20, color: C.dim }, [pct(v)]));
  const chart = {
    type: 'svg',
    props: {
      width: cw, height: ch, viewBox: `0 0 ${cw} ${ch}`, style: { position: 'absolute', left: cx, top: cy },
      children: [
        ...grid,
        { type: 'path', props: { d: `${line} L${cw} ${zero} L0 ${zero} Z`, fill: C.accent, fillOpacity: 0.1, stroke: 'none' } },
        { type: 'path', props: { d: line, fill: 'none', stroke: C.accent, strokeWidth: 3.5, strokeLinejoin: 'round', strokeLinecap: 'round' } },
      ],
    },
  };
  const tag = h({
    position: 'absolute', left: cx + cw + 8, top: cy + endY - 17, width: 112, height: 34,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent,
    fontFamily: 'Mono', fontWeight: 800, fontSize: 22, color: C.bg,
  }, [pct(m.end, 1)]);
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, [
    topLine('GUESS'),
    rule(),
    h({ position: 'absolute', left: cx, top: 62, right: 64, alignItems: 'flex-end', whiteSpace: 'nowrap' }, [
      h({ fontWeight: 800, fontSize: 44, color: C.accent, marginRight: 26 }, [`GUESS #${m.n}`]),
      h({ fontWeight: 500, fontSize: 20, letterSpacing: 2, color: C.dim, marginBottom: 7 }, ['MYSTERY STOCK · 1 YEAR · % CHANGE']),
    ]),
    chart,
    ...labels,
    tag,
    h({ position: 'absolute', left: cx, top: 470, fontWeight: 800, fontSize: 52, letterSpacing: -1, color: C.text, whiteSpace: 'nowrap' }, [GUESS_ASK]),
    h({ position: 'absolute', left: cx, top: 544, fontWeight: 800, fontSize: 30, color: C.accent, whiteSpace: 'nowrap' }, [GUESS_LINK]),
    h({ position: 'absolute', right: 28, bottom: 16, fontFamily: 'Mono', fontWeight: 500, fontSize: 16, color: C.dim, whiteSpace: 'nowrap' }, ['Past closes (CNBC) as % change. Not advice.']),
  ]);
}

// todayPuzzle: data/guess.js game.todayPuzzle (injected). now: for the cache header.
export function makeGuessCard({ todayPuzzle, render = (tree) => renderPng(tree), fallback = () => defaultPng(), now = () => Date.now() } = {}) {
  let kept = null; // { key, png }
  // { png, maxAge }: today's card until the next puzzle (at most an hour), or the site card.
  async function png() {
    const m = guessCardModel(await Promise.resolve().then(todayPuzzle).catch(() => null));
    if (!m) return { png: await fallback(), maxAge: 300 };
    const key = hash(JSON.stringify(m));
    if (kept?.key !== key) {
      const out = await once(`guess:${key}`, () => limited(async () => render(guessTree(m))));
      kept = { key, png: out };
    }
    return { png: kept.png, maxAge: Math.max(60, Math.min(3600, Math.floor(msToNextPuzzle(now()) / 1000))) };
  }
  return { png };
}

export function mountGuessCard(app, deps) {
  const card = makeGuessCard(deps);
  const send = (res, png, maxAge) => res.set({ 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${maxAge}` }).send(png);
  app.get('/og/guess.png', async (req, res) => {
    try {
      const out = await card.png();
      send(res, out.png, out.maxAge);
    } catch (err) {
      console.error('[og]', err.message);
      try { send(res, await (deps.fallback || defaultPng)(), 300); } catch { res.status(503).end(); }
    }
  });
  return card;
}
