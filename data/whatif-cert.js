// WHATIF certificate: the words and numbers printed on the certificate, the share text
// and the page meta for one result. Pure functions, no I/O. Every number comes from the
// WHATIF engine result (data/whatif.js); this file only picks and formats.

import { createHash } from 'node:crypto';
import { resolveTokens, whatifCommand } from './whatif.js';

export const DOODLES = [
  'actioncam', 'bike', 'box', 'burger', 'burrito', 'car', 'coffee', 'console', 'earbuds', 'gpu', 'handheld',
  'headphones', 'laptop', 'phones', 'qwertyphone', 'smartwatch', 'tablet', 'tv', 'vr',
];

// Bump when the certificate layout changes, so cached share images are redrawn.
export const CERT_VERSION = 1;

// ---- The command in ?c= --------------------------------------------------------

// "WHATIF iphone6, latte:3y" -> ['IPHONE6', 'LATTE:3Y'], or null when it does not look
// like a WHATIF list. The same guard as /api/whatif.
export function whatifTokens(c) {
  const s = typeof c === 'string' ? c : '';
  if (s.length > 600) return null;
  const tokens = s.toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (tokens[0] === 'WHATIF') tokens.shift();
  if (tokens.length > 40 || tokens.some((t) => !/^[A-Z0-9.:-]{1,24}$/.test(t))) return null;
  return tokens;
}

// One canonical command for a result, whatever the order or case it was typed in:
// items in catalog order, no repeats. Null when it is not a result (empty, unknown
// words, a family word that opens the picker).
export function normalizeWhatif(c, catalog) {
  const tokens = whatifTokens(c);
  if (!tokens || !tokens.length) return null;
  const { picks, families, unknown } = resolveTokens(tokens, catalog);
  if (unknown.length || families.length || !picks.length || picks.length > 30) return null;
  const order = new Map([...catalog.products, ...catalog.recurring].map((p, i) => [p.id, i]));
  const sorted = [...picks].sort((a, b) => order.get(a.id) - order.get(b.id));
  return { command: whatifCommand(sorted), tokens: whatifCommand(sorted).split(' ').slice(1) };
}

export function certKey(command) {
  return createHash('sha256').update(`cert-v${CERT_VERSION}\0${command}`).digest('hex').slice(0, 24);
}

// ---- Formatting ------------------------------------------------------------------

const num = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export function usd(n) {
  if (!Number.isFinite(n)) return '--';
  return '$' + num(Math.abs(n), Math.abs(n) >= 1000 ? 0 : 2);
}

export function multiple(m) {
  if (!Number.isFinite(m)) return '--';
  if (m >= 100) return `${num(m, 0)}x`;
  if (m >= 0.1) return `${num(m, 1)}x`;
  return `${num(m, 2)}x`;
}

export function shares(n) {
  if (n >= 10) return num(n, 1);
  if (n >= 1) return num(n, 2);
  return num(n, 3);
}

// 60 monthly buys -> "5 years"; 18 -> "18 months".
export function span(buys) {
  if (buys % 12 === 0) return buys === 12 ? '1 year' : `${buys / 12} years`;
  return buys === 1 ? '1 month' : `${buys} months`;
}
const spanShort = (buys) => (buys % 12 === 0 ? `${buys / 12}y` : `${buys}mo`);

// Font size (in % of the certificate width) that keeps text inside maxPct, given an
// average glyph width in em (JetBrains Mono is exactly 0.6).
export function fit(text, maxPct, basePct, em) {
  const n = Math.max(1, [...String(text)].length);
  return Math.round(Math.min(basePct, maxPct / (n * em)) * 100) / 100;
}

// Receipt lines are tiny: 12 characters at most.
const clip = (s) => ([...s].length > 12 ? `${[...s].slice(0, 11).join('')}…` : s);

// ---- The certificate ---------------------------------------------------------------

// result: what getWhatif returns ({ rows, total }). command: the canonical command.
export function certModel(result, catalog, command) {
  const items = new Map([...catalog.products, ...catalog.recurring].map((p) => [p.id, p]));
  const rows = result.rows;
  const t = result.total;
  const item = (r) => items.get(r.id) || {};
  const shortOf = (r) => item(r).short || r.name;
  const once = rows.every((r) => r.kind === 'once');
  const sameFamily = rows.every((r) => item(r).family && item(r).family === item(rows[0]).family);
  const tickers = [...new Set(rows.map((r) => r.ticker))];
  const oneCompany = tickers.length === 1;

  let ribbon;
  let subject;
  if (rows.length === 1 && once) {
    ribbon = shortOf(rows[0]);
    subject = `My ${ribbon}`;
  } else if (rows.length === 1) {
    ribbon = `${span(rows[0].buys)} of ${item(rows[0]).plural || shortOf(rows[0])}`;
    subject = `My ${ribbon}`;
  } else if (once && sameFamily && item(rows[0]).plural) {
    ribbon = `${rows.length} ${item(rows[0]).plural}`;
    subject = `My ${ribbon}`;
  } else {
    ribbon = `${rows.length} things you bought`;
    subject = `The ${rows.length} things I bought`;
  }

  const totalShares = rows.reduce((n, r) => n + r.shares, 0);
  const holding = oneCompany ? `${shares(totalShares)} shares of ${rows[0].company}` : `in ${tickers.length} companies`;
  const where = oneCompany ? `${rows[0].company} stock` : "the makers' stock";

  const bySpend = [...rows].sort((a, b) => b.paid - a.paid);
  const shown = bySpend.slice(0, 4);
  const receipt = shown.map((r) => (r.kind === 'once' ? shortOf(r) : `${shortOf(r)} ${spanShort(r.buys)}`));
  const more = bySpend.length - shown.length;
  if (more) receipt.push(`+${more} more`);

  const top = item(bySpend[0]).doodle;
  const doodle = DOODLES.includes(top) ? top : 'box';

  const big = usd(t.value);
  const loss = t.value < t.paid;
  const spent = `You spent ${usd(t.paid)}`;
  const mult = multiple(t.multiple);
  const share = `${subject} would be ${big} in ${where} today.`;
  const lines = fit(spent.length > holding.length ? spent : holding, 34, 2.4, 0.6);
  return {
    command,
    ribbon,
    big,
    spent,
    holding,
    multiple: mult,
    loss,
    receipt: receipt.map(clip),
    doodle,
    // Type sizes in % of the certificate's width, so long text never leaves the paper.
    fit: { ribbon: fit(ribbon, 33, 3.8, 0.46), big: fit(big, 58, 11, 0.6), lines, mult: fit(mult, 7.4, 3, 0.6) },
    share,
    title: share,
    description: `Spent ${usd(t.paid)}. In the stock today: ${big}, ${multiple(t.multiple)}. WHATIF: the stock you should have bought.`,
  };
}
