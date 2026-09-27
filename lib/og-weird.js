// Share cards for the WEIRD gauges.
//
// GET /og/weird.png?c=CANAL   one gauge: its name, the headline, the line under it, a
//                             sparkline when it has one, the source and the as-of date,
//                             and its record line ("LOWEST SINCE MAR 2021") when it has one
// GET /og/weird.png?c=WEIRD   the grid: up to six live gauges on one card
//
// The values come from the same getGauge / getWeird the screens use, so a card shows
// what the page shows: the live value, or the last good one with its real date (marked
// stale), or, when there is no value at all, a card with the gauge's name and no number.
//
// Only the 23 gauge commands (and their aliases) and WEIRD make a card; anything else is
// null and gets the site card. The layout, fonts and the two-at-a-time render limit are
// lib/og.js's. Rendered PNGs sit in a small in-memory LRU keyed by the command plus a
// hash of every word and number drawn, so a gauge is drawn again only when its data
// changes, and a render budget caps the work if the data churns anyway.

import { createHash } from 'node:crypto';
import {
  COLORS as C, el as h, topLine, rule, limited, once, sparkPath, renderPng, defaultPng, SITE, W, H,
} from './og.js';
import { WEIRD_GAUGES, gaugeByCommand, monthLabel } from '../public/screens/weird-gauges.js';
import { findCommand } from '../public/registry.js';
import { fmtDate } from '../public/kit.js';
import { nyTime } from '../public/screens/markets.js';

export const COLLAGE_SIZE = 6;
// The grid card's pick order: the most striking first. A gauge not named here comes
// after these, in tile order.
const PREFERRED = ['canal', 'billions', 'eggs', 'odds', 'pizza', 'hotdog', 'bigmac', 'degen', 'waffle', 'omens', 'wsb', 'rides', 'panic', 'boxrate', 'buzz'];
export const COLLAGE_ORDER = [...PREFERRED, ...WEIRD_GAUGES.map((g) => g.id).filter((id) => !PREFERRED.includes(id))];

const hash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t;
};

// ?c=... -> 'CANAL' (any gauge command, from its name or an alias), 'WEIRD', or null.
// parse: the router's parseCommand (injected).
export function weirdCommand(c, parse) {
  const text = String(c || '').trim();
  if (!text || text.length > 40) return null;
  const name = parse(text)?.name;
  if (name === 'WEIRD') return 'WEIRD';
  return gaugeByCommand(name) ? name : null;
}

// The source as the screen names it: "IMF PortWatch", "The Economist, CC BY 4.0".
export function sourceText(d) {
  if (!d?.source) return '';
  return d.credit && d.credit.includes(d.source) ? d.credit : [d.source, d.credit].filter(Boolean).join(', ');
}

// The as-of date with its year: "SEP 20 2026", "AUG 2026", "SEP 26 2026 02:39 ET".
export function cardDate(asOf, period = 'day') {
  if (!asOf) return '';
  if (period === 'month') {
    const m = monthLabel(asOf);
    return m === '--' ? '' : m;
  }
  const prose = fmtDate(asOf, 'prose');
  if (prose === '--') return '';
  const day = `${fmtDate(asOf, 'table')} ${prose.slice(-4)}`;
  return period === 'time' && !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? `${day} ${nyTime(asOf)} ET` : day;
}

// Numbers only, at most 90 of them; [] when there is no line to draw.
export function sparkPoints(spark) {
  let pts = Array.isArray(spark) ? spark.filter(Number.isFinite) : [];
  if (pts.length > 90) {
    const step = Math.ceil(pts.length / 90);
    pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  }
  return pts.length >= 2 ? pts : [];
}

// One gauge's card: g from WEIRD_GAUGES, d the /api/weird/<id> answer (or null when it
// did not come in time). ok: false draws the name only, never a number.
export function gaugeModel(g, d) {
  const reg = findCommand(g.command);
  const base = {
    kind: 'gauge', id: g.id, command: g.command, title: g.title,
    summary: clip(reg?.summary || g.title, 80),
    source: clip(sourceText(d) || reg?.source || '', 70),
  };
  if (!d || d.ok === false || !d.headline) return { ...base, ok: false };
  return {
    ...base,
    ok: true,
    headline: clip(d.headline, 40),
    line: clip(d.line || '', 110),
    spark: sparkPoints(d.spark),
    asOf: cardDate(d.asOf, g.period),
    stale: Boolean(d.stale),
    ...(d.record?.text ? { record: clip(d.record.text, 40) } : {}),
  };
}

// The grid card from getWeird().gauges: live gauges first in COLLAGE_ORDER, then stale
// ones (marked) if there are too few live ones. Pending and NO DATA gauges never show.
export function collageModel(rows = []) {
  const byId = new Map(rows.filter((r) => r && r.ok !== false && r.headline).map((r) => [r.id, r]));
  const pick = (stale) => COLLAGE_ORDER.map((id) => byId.get(id)).filter((r) => r && Boolean(r.stale) === stale);
  const tiles = [...pick(false), ...pick(true)].slice(0, COLLAGE_SIZE).map((r) => {
    const m = gaugeModel(WEIRD_GAUGES.find((g) => g.id === r.id), r);
    return { command: m.command, headline: m.headline, line: clip(m.line, 32), spark: m.spark, asOf: m.asOf, source: clip(m.source, 24), stale: m.stale };
  });
  return { kind: 'weird', command: 'WEIRD', total: WEIRD_GAUGES.length, tiles };
}

// ---- Drawing -------------------------------------------------------------------------

// The biggest size (px) at which text fits width in the mono face (0.6 em a character).
export function fitSize(text, width, max, spacing = 0) {
  const n = Math.max(1, [...String(text)].length);
  return Math.max(12, Math.min(max, Math.floor((width / n + spacing) / 0.62)));
}

const linkText = (command) => `bloombroke.com/?c=${command}`;

function footer(left, command) {
  return h({ position: 'absolute', left: 64, right: 28, bottom: 16, justifyContent: 'space-between', fontFamily: 'Mono', fontWeight: 500, color: C.dim, whiteSpace: 'nowrap' }, [
    h({ fontSize: 16, overflow: 'hidden', flexShrink: 1, marginRight: 24 }, [left]),
    h({ fontSize: 17, flexShrink: 0 }, [linkText(command)]),
  ]);
}

function spark(points, left, top, w, height, stroke = 4) {
  const d = sparkPath(points, w, height);
  if (!d) return null;
  return {
    type: 'svg',
    props: {
      width: w, height, viewBox: `0 0 ${w} ${height}`, style: { position: 'absolute', left, top },
      children: [
        { type: 'path', props: { d: `${d} L${w} ${height} L0 ${height} Z`, fill: C.accent, fillOpacity: 0.08, stroke: 'none' } },
        { type: 'path', props: { d, fill: 'none', stroke: C.accent, strokeWidth: stroke, strokeLinejoin: 'round', strokeLinecap: 'round' } },
      ],
    },
  };
}

// strip: the gauge card's own notes on the right of the header row (the record line),
// as the gauge screen shows them in its title strip. One list, so a new note is one entry.
function header(command, label, strip = []) {
  const notes = strip.filter(Boolean);
  return h({ position: 'absolute', left: 64, top: 62, right: 64, alignItems: 'flex-end', whiteSpace: 'nowrap' }, [
    h({ fontWeight: 800, fontSize: 40, color: C.accent, marginRight: 22, lineHeight: 1 }, [command]),
    h({ fontWeight: 800, fontSize: 18, letterSpacing: 3, color: C.dim, marginBottom: 3 }, [label]),
    ...(notes.length ? [h({ marginLeft: 'auto', marginBottom: 3, fontWeight: 800, fontSize: 20, letterSpacing: 2, color: C.accent }, [notes.join(' · ')])] : []),
  ]);
}

// The notes a gauge card carries in its header strip.
export function cardStrip(m) {
  return [m.ok ? m.record : null];
}

// A typed command with the block cursor: the card for no number.
const prompt = (command, top) => h({ position: 'absolute', left: 64, top, alignItems: 'center', fontWeight: 800, fontSize: 88, letterSpacing: -2, color: C.text, whiteSpace: 'nowrap' }, [
  h({ color: C.accent, marginRight: 30 }, ['>']),
  command,
  h({ width: 44, height: 82, marginLeft: 20, backgroundColor: C.accent }),
]);

export function gaugeTree(m) {
  const kids = [
    topLine(m.command),
    rule(),
    header(m.command, 'WEIRD DATA', cardStrip(m)),
    h({ position: 'absolute', left: 64, top: 118, right: 64, fontWeight: 500, fontSize: 22, color: C.dim, whiteSpace: 'nowrap' }, [m.summary]),
  ];
  if (m.ok) {
    const size = fitSize(m.headline, 1072, 116, 3);
    kids.push(
      h({ position: 'absolute', left: 64, top: 170 + (116 - size) / 2, height: size, alignItems: 'center', fontWeight: 800, fontSize: size, letterSpacing: -3, lineHeight: 1, color: m.stale ? C.dim : C.text, whiteSpace: 'nowrap' }, [m.headline]),
      h({ position: 'absolute', left: 64, top: 310, width: 1072, flexWrap: 'wrap', fontWeight: 500, fontSize: 30, lineHeight: 1.25, color: C.text }, [m.line]),
    );
    const line = spark(m.spark, 64, 412, 1072, 150);
    if (line) kids.push(line);
    const when = m.asOf ? (m.stale ? `LAST GOOD READING ${m.asOf} · STALE` : `AS OF ${m.asOf}`) : (m.stale ? 'STALE' : '');
    kids.push(footer([`SOURCE: ${m.source}`, when].filter(Boolean).join(' · '), m.command));
  } else {
    kids.push(
      prompt(m.command, 210),
      h({ position: 'absolute', left: 64, top: 350, width: 1072, fontWeight: 500, fontSize: 30, color: C.text }, ['Odd live data in a free market terminal.']),
      footer(m.source ? `SOURCE: ${m.source}` : '', m.command),
    );
  }
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, kids);
}

const TILE_W = 344;
const TILE_H = 212;
const GAP = 20;

function tile(t, i) {
  const left = 64 + (i % 3) * (TILE_W + GAP);
  const top = 128 + Math.floor(i / 3) * (TILE_H + 16);
  const inner = TILE_W - 36;
  const size = fitSize(t.headline, inner, 40, 0);
  const when = t.stale ? `STALE · ${t.asOf}` : t.asOf;
  const kids = [
    h({ position: 'absolute', left: 18, top: 16, fontWeight: 800, fontSize: 18, letterSpacing: 1, color: C.accent }, [t.command]),
    h({ position: 'absolute', left: 18, top: 50, width: inner, height: 42, alignItems: 'center', fontWeight: 800, fontSize: size, lineHeight: 1, color: t.stale ? C.dim : C.text, whiteSpace: 'nowrap' }, [t.headline]),
    h({ position: 'absolute', left: 18, top: 104, width: inner, fontWeight: 500, fontSize: 16, color: C.dim, whiteSpace: 'nowrap' }, [t.line]),
    h({ position: 'absolute', left: 18, bottom: 14, width: inner, fontWeight: 500, fontSize: 13, color: C.dim, whiteSpace: 'nowrap' }, [[t.source, when].filter(Boolean).join(' · ')]),
  ];
  const line = spark(t.spark, 18, 134, inner, 40, 2.5);
  if (line) kids.push(line);
  return h({ position: 'absolute', left, top, width: TILE_W, height: TILE_H, border: `1px solid ${C.rule}`, backgroundColor: '#08101A' }, kids);
}

export function collageTree(m) {
  const kids = [topLine('WEIRD'), rule(), header('WEIRD', `${m.total} ODD LIVE GAUGES`)];
  if (m.tiles.length) kids.push(...m.tiles.map(tile));
  else {
    kids.push(
      prompt('WEIRD', 210),
      h({ position: 'absolute', left: 64, top: 350, width: 1072, fontWeight: 500, fontSize: 30, color: C.text }, ['Ships, pizza, waffles, eggs, omens: odd live data.']),
    );
  }
  kids.push(footer('Each gauge names its source and date on its own screen.', 'WEIRD'));
  return h({ width: W, height: H, backgroundColor: C.bg, position: 'relative', fontFamily: 'Mono' }, kids);
}

export const treeFor = (m) => (m.kind === 'weird' ? collageTree(m) : gaugeTree(m));

// ---- Page meta -----------------------------------------------------------------------

export const cardKey = (m) => `${m.command}:${hash(JSON.stringify(m))}`;
const sentence = (s) => (!s ? '' : /[.?!]$/.test(s) ? s : `${s}.`);
// 'LOWEST SINCE MAR 2021' -> 'Lowest since Mar 2021.'
export function recordSentence(text) {
  const t = String(text || '').toLowerCase().replace(/\b([a-z]{3}) (\d{4})\b/g, (_, m, y) => `${m[0].toUpperCase()}${m.slice(1)} ${y}`);
  return t ? sentence(`${t[0].toUpperCase()}${t.slice(1)}`) : '';
}

export function weirdMeta(m) {
  const q = new URLSearchParams({ c: m.command }).toString();
  const image = `${SITE}/og/weird.png?${new URLSearchParams({ c: m.command, v: cardKey(m).split(':')[1].slice(0, 10) })}`;
  const url = `${SITE}/?${q}`;
  if (m.kind === 'weird') {
    const lines = m.tiles.slice(0, 3).map((t) => `${t.command}: ${t.headline}.`);
    return {
      title: 'WEIRD: odd live gauges on Bloombroke',
      description: [...lines, `${m.total} odd live gauges: ships, pizza, waffles, eggs, omens. Bloombroke is a free market terminal.`].join(' '),
      image, url,
      alt: m.tiles.length ? `WEIRD gauges: ${m.tiles.map((t) => `${t.command} ${t.headline}`).join(', ')}.` : 'WEIRD: odd live gauges on Bloombroke.',
    };
  }
  if (!m.ok) {
    return {
      title: `${m.summary} (${m.command})`,
      description: `${sentence(m.summary)}${m.source ? ` Source: ${m.source}.` : ''} Odd live data on Bloombroke, a free market terminal.`,
      image, url,
      alt: `${m.command} on Bloombroke: ${m.summary}.`,
    };
  }
  const when = m.asOf ? (m.stale ? `, last good reading ${m.asOf} (the source is not answering right now)` : `, as of ${m.asOf}`) : '';
  return {
    title: `${m.command}: ${m.headline}`,
    description: `${sentence(m.line)}${m.record ? ` ${recordSentence(m.record)}` : ''} Source: ${m.source}${when}. ${m.summary}. Bloombroke is a free market terminal.`.replace(/^ /, ''),
    image, url,
    alt: `${m.command}: ${m.headline}. ${m.line}`.trim(),
  };
}

// ---- Cards: data, cache, render ------------------------------------------------------

function within(promise, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, ms, null); timer.unref?.(); });
  return Promise.race([Promise.resolve(promise).catch(() => null), late]).finally(() => clearTimeout(timer));
}

// deps: getGauge(id), getWeird({ wait }) from data/weird/index.js (injected for tests).
// maxEntries / maxBytes bound the PNG cache; at most `budget` renders per `budgetMs`
// (past it a command gets its newest cached card, or the site card, briefly cached,
// until the window moves on).
export function makeWeirdCards({
  getGauge, getWeird, render = (tree) => renderPng(tree), fallback = () => defaultPng(),
  maxEntries = 48, maxBytes = 24 * 1024 * 1024, budget = 60, budgetMs = 10 * 60_000, now = Date.now,
} = {}) {
  const lru = new Map();
  let bytes = 0;
  let spent = [];
  // command -> { meta, at }: the page meta from the last full answer, served at once
  // while a fresh one loads. At most one entry per whitelisted command.
  const metas = new Map();
  const REFRESH_MS = 30_000;

  function remember(key, png) {
    if (lru.has(key)) { bytes -= lru.get(key).length; lru.delete(key); }
    lru.set(key, png);
    bytes += png.length;
    while (lru.size > maxEntries || (bytes > maxBytes && lru.size > 1)) {
      const [oldest, buf] = lru.entries().next().value;
      lru.delete(oldest);
      bytes -= buf.length;
    }
  }
  function recall(key) {
    const png = lru.get(key);
    if (png) { lru.delete(key); lru.set(key, png); }
    return png || null;
  }
  // The newest cached card for a command, whatever its data, or null.
  function newestFor(command) {
    const key = [...lru.keys()].reverse().find((k) => k.startsWith(`${command}:`));
    return key ? recall(key) : null;
  }
  function allow() {
    const t = now();
    spent = spent.filter((x) => t - x < budgetMs);
    if (spent.length >= budget) return false;
    spent.push(t);
    return true;
  }

  // The card's model for a whitelisted command, or null. wait: ms for the data.
  async function model(command, { wait = 8000 } = {}) {
    if (command === 'WEIRD') {
      // A slow gauge is left off the grid rather than holding up the crawler.
      const w = Math.min(wait, 4000);
      const s = await within(getWeird({ wait: w }), w + 500);
      return collageModel(s?.gauges || []);
    }
    const g = gaugeByCommand(command);
    if (!g) return null;
    return gaugeModel(g, await within(getGauge(g.id), wait));
  }

  // { png, model, maxAge } for a whitelisted command, or null.
  async function png(command, opts) {
    const m = await model(command, opts);
    if (!m) return null;
    metas.set(command, { meta: weirdMeta(m), at: now() });
    const key = cardKey(m);
    const live = m.kind === 'weird' ? m.tiles.length > 0 && !m.tiles.some((t) => t.stale) : m.ok && !m.stale;
    const hit = recall(key);
    if (hit) return { png: hit, model: m, maxAge: live ? 600 : 120 };
    const drawn = await once(`weird:${key}`, async () => {
      if (!allow()) return null;
      const buf = await limited(() => render(treeFor(m)));
      remember(key, buf);
      return buf;
    });
    if (!drawn) return { png: newestFor(command) || await fallback(), model: m, maxAge: 60 };
    return { png: drawn, model: m, maxAge: live ? 600 : 120 };
  }

  // A full answer for the command's meta, remembered; one in flight per command.
  function refresh(command) {
    return once(`weird-meta:${command}`, async () => {
      const m = await model(command);
      if (m) metas.set(command, { meta: weirdMeta(m), at: now() });
      return m;
    });
  }

  // The page meta for a whitelisted command, or null. Never waits more than `wait` ms:
  // a remembered meta comes back at once (and is refreshed in the background when it is
  // older than REFRESH_MS); with none, a slow answer gives the no-number meta while the
  // full one goes on loading for the next visit.
  async function meta(command, { wait = 800 } = {}) {
    if (command !== 'WEIRD' && !gaugeByCommand(command)) return null;
    const known = metas.get(command);
    if (known) {
      if (now() - known.at > REFRESH_MS) refresh(command).catch(() => {});
      return known.meta;
    }
    const full = refresh(command);
    full.catch(() => {});
    const m = await within(full, wait);
    if (m) return weirdMeta(m);
    return weirdMeta(command === 'WEIRD' ? collageModel([]) : gaugeModel(gaugeByCommand(command), null));
  }

  return {
    model, png, meta,
    cache: { get size() { return lru.size; }, get bytes() { return bytes; }, has: (k) => lru.has(k) },
  };
}
