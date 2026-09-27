// NO SUCH TICKER. YET.: the pure parts, shared by the browser and the server.
//
//  - GRAVEYARD: famous tickers that are gone (data/graveyard.json, every fact with its
//    source in src). GRAVEYARD lists them; GRAVEYARD LEH (or LEH typed, when no live
//    ticker answers) shows one tombstone.
//  - IPO IT <WORD>: a joke listing certificate for a made-up ticker. The shape check is
//    here (A-Z only, 1 to 5 letters, never a known live ticker); the word list check is
//    on the server only (lib/og-nosuch.js), and the screen asks it before drawing.
//
// The screen is screens/nosuch.js; the share cards are lib/og-nosuch.js.

import { LISTED_TICKERS } from './known-tickers.js';

export const IPO_RE = /^[A-Z]{1,5}$/;
export const MAX_ROWS = 3; // "Did you mean" rows on the screen
export const SITE = 'https://bloombroke.com';
// GRAVEYARD's views: GRAVEYARD alone is the cemetery (the table on a phone).
export const GRAVEYARD_VIEWS = ['TABLE', 'MOURNED', 'ZOMBIES', 'TODAY'];

// The word, upper case, when it has the shape a joke listing may take; else null.
// The server adds its word list on top (ipoAllowed in lib/og-nosuch.js).
export function ipoShape(raw) {
  const w = String(raw ?? '').trim().toUpperCase();
  if (!IPO_RE.test(w)) return null;
  if (LISTED_TICKERS.has(w)) return null;
  return w;
}

// IPO IT <WORD> and GRAVEYARD [<TICKER>] for the router: { name, args, input, url } or null.
// IPO alone is not a command here (the resolver sends it to IPOS); only IPO IT is.
export function matchNoSuch(head, rest = []) {
  if (head === 'GRAVEYARD') {
    const word = rest.length === 1 && /^[A-Z]{1,12}$/.test(rest[0]) ? rest[0] : null;
    const view = GRAVEYARD_VIEWS.includes(word) ? word : null;
    const t = view ? null : word;
    const input = word ? `GRAVEYARD ${word}` : 'GRAVEYARD';
    return { name: 'GRAVEYARD', args: view ? { view } : t ? { ticker: t } : {}, input, url: input };
  }
  if (head === 'IPO' && rest[0] === 'IT') {
    const word = rest.length === 2 ? ipoShape(rest[1]) : null;
    const input = word ? `IPO IT ${word}` : 'IPO IT';
    return { name: 'IPOIT', args: { word }, input, url: input };
  }
  return null;
}

// ---- Graveyard ------------------------------------------------------------------------

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2008-09-15' -> '15 Sep 2008'.
export function dayText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : '';
}

// The entry for a typed word: its old ticker, or one of its other words (ENRON, WAMU).
export function findGrave(list, word) {
  const w = String(word ?? '').trim().toUpperCase();
  if (!w || !Array.isArray(list)) return null;
  return list.find((e) => e.ticker === w) || list.find((e) => (e.also || []).includes(w)) || null;
}

// The years on a stone: '1994 - 2008', or '2008' when the listing year is not sourced; a
// zombie: the year it died and the year it came back.
export function stoneYears(e) {
  const died = String(e.date || '').slice(0, 4);
  if (e.zombie && e.back?.date) return `${died} - ${e.back.date.slice(0, 4)}`;
  return Number.isInteger(e.listed) ? `${e.listed} - ${died}` : died;
}

// Flowers at a stone's foot for n respects: one more each time the count doubles, 10 at most.
export const MAX_FLOWERS = 10;
export function flowersFor(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(MAX_FLOWERS, Math.floor(Math.log2(v)) + 1) : 0;
}

// 1234 -> '1,234 respects'.
export function respectsText(n) {
  const v = Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;
  return `${v.toLocaleString('en-US')} ${v === 1 ? 'respect' : 'respects'}`;
}

// ON THIS DAY on HOME: '15 Sep 2008: Lehman Brothers filed for bankruptcy. F to pay respects'.
// When the anniversary is another day than the event on the stone, just the name.
export function onThisDayLine(e) {
  const day = e.anniversary || e.date;
  const what = day === e.date ? ` ${e.what.charAt(0).toLowerCase()}${e.what.slice(1)}` : '';
  return `${dayText(day)}: ${e.name}${what}. F to pay respects`;
}

// A YouTube id, or null. The screen shows a still from i.ytimg.com and loads the player
// from youtube-nocookie.com only on a click.
export const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export const ytThumb = (id) => (YT_ID.test(id || '') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null);
export const ytEmbed = (id) => (YT_ID.test(id || '') ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : null);

// "LEH. Lehman Brothers. Listed 1994. Filed for bankruptcy 15 Sep 2008."
export function tombstoneLine(e) {
  const listed = Number.isInteger(e.listed) ? ` Listed ${e.listed}.` : '';
  return `${e.ticker}. ${e.name}.${listed} ${e.what} ${dayText(e.date)}.`;
}

// A graveyard ticker whose only quote is a non-US listing (LEH is Lampetia AG on
// Frankfurt today) or a delisted leftover shows its tombstone; a US listing still wins.
export function graveBeatsQuote(q) {
  if (!q) return true;
  if (/\(delisted\)/i.test(String(q.name || q.label || ''))) return true;
  return String(q.currency || '').toUpperCase() !== 'USD';
}

// n entries at random (a fresh pick each visit), for THE GRAVEYARD row.
export function pickGraves(list, n = 4, rand = Math.random) {
  const pool = [...(list || [])];
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

// 'https://www.sec.gov/Archives/...' -> 'sec.gov'.
export function srcHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function graveLinks(e, origin = SITE) {
  const c = `GRAVEYARD ${e.ticker}`;
  const url = `${origin}/?${new URLSearchParams({ c })}`;
  const text = `${tombstoneLine(e)} From the Bloombroke graveyard.`;
  return { url, x: `https://x.com/intent/post?${new URLSearchParams({ text, url })}`, image: `/og/tombstone.png?${new URLSearchParams({ t: e.ticker })}` };
}

// ---- IPO IT ------------------------------------------------------------------------------

export const IPO_LINES = ['Shares outstanding: 1', 'Price: $0.00', 'Exchange: your imagination'];
export const IPO_STAMP = 'NOT A REAL SECURITY';

export function ipoLinks(word, origin = SITE) {
  const url = `${origin}/?${new URLSearchParams({ c: `IPO IT ${word}` })}`;
  const text = `I listed $${word}. Shares outstanding: 1. Price: $0.00. Exchange: my imagination.`;
  return { url, x: `https://x.com/intent/post?${new URLSearchParams({ text, url })}`, image: `/og/ipo.png?${new URLSearchParams({ t: word })}` };
}

// ---- Did you mean -----------------------------------------------------------------------

// The resolver's rows ({ commands, symbols }) as [cmd, what], at most MAX_ROWS, never the
// words typed. On NO SUCH TICKER the symbols come first (APPL: AAPL before any command).
export function dymRows(found = {}, typed = '', ticker = null) {
  const same = new Set([typed, ticker].filter(Boolean).map((s) => String(s).trim().toUpperCase().replace(/\s+/g, ' ')));
  const cmds = (found.commands || []).map((c) => [c.cmd, c.summary]);
  const syms = (found.symbols || []).map((s) => [s.cmd, s.name]);
  const rows = ticker ? [...syms, ...cmds] : [...cmds, ...syms];
  const seen = new Set();
  const out = [];
  for (const [cmd, what] of rows) {
    const k = String(cmd || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!k || same.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push([cmd, what]);
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

export const FEEDBACK_PREFILL = (word) => `Please add: ${word}`;
