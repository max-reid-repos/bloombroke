// The resolver: what to run when the words are not a command or a known ticker.
//   "nvidia"            -> NVDA
//   "tesla news"        -> TSLA NEWS
//   "apple financials"  -> AAPL FINANCIALS
//   "AAPL MSFT NVDA"    -> COMPARE AAPL MSFT NVDA
//   "short interest"    -> HELP SHORTS (SHORTS needs a ticker); "yield curve" -> CURVE
// A single strong match runs ({ confident: true, command }); anything else gets a
// "Did you mean" list of commands and symbols. Pure: the symbol search and the ticker
// check are passed in, so tests run without the network.

import { PHRASES, LISTED, findCommand, searchCommands } from './registry.js';
import { matchInstrument, resolveInstrument, stockSymbol } from './instruments.js';
import { PRESETS, PERIOD_WORDS } from './ranges.js';
import { tickerForName, LISTED_TICKERS, nameKey } from './known-tickers.js';

export const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
// A word with a leading $ is a stock and only a stock ($gold, $M, $brk.b).
const STOCK_WORD = /^\$[A-Za-z]{1,5}(\.[A-Za-z]{1,2})?$/;
// The stock's id when no router is passed in (tests): $ kept for an instrument's name.
const defaultStockId = (t) => (resolveInstrument(t) ? `$${t}` : t);
const MAX_SPAN = 4;
const MAX_COMPARE = 5;

// Words that carry no meaning here: "show me the price of tesla" is TESLA.
export const FILLER = new Set([
  'show', 'me', 'the', 'for', 'of', 'a', 'an', 'please', 'what', 'whats', 'is', 'are', 'on', 'in', 'to', 'and', 'with',
  'stock', 'stocks', 'share', 'shares', 'price', 'prices', 'quote', 'quotes', 'get', 'give', 'how', 'about', 'much',
  'today', 'now', 'current', 'latest', 'live', 'ticker', 'symbol', 'company', 'corp', 'inc', 'data', 'look', 'up', 'find', 'check', 'see',
]);

// phrase -> [{ name, extra }]. Command names and aliases count as phrases too.
const PHRASE_INDEX = new Map();
function addPhrase(phrase, name, extra = '') {
  const key = nameKey(phrase) || String(phrase).toLowerCase();
  const list = PHRASE_INDEX.get(key) || [];
  if (!list.some((p) => p.name === name)) list.push({ name, extra });
  PHRASE_INDEX.set(key, list);
}
for (const [name, phrases] of Object.entries(PHRASES)) {
  for (const p of phrases) Array.isArray(p) ? addPhrase(p[0], name, p[1]) : addPhrase(p, name);
}
for (const c of LISTED) {
  if (c.pattern || c.soon || FILLER.has(c.name.toLowerCase())) continue; // ME: "show me AAPL" keeps me as filler
  if (!PHRASE_INDEX.has(c.name.toLowerCase())) addPhrase(c.name, c.name);
}

// A typed word, cleaned: "Apple's" -> "apple", "$TSLA" -> "tsla", "news?" -> "news".
export function cleanWord(w) {
  return String(w).toLowerCase().replace(/^\$(?=[a-z])/, '').replace(/['’]s$/, '').replace(/[?!,;:]+$/, '').replace(/\.$/, '');
}

const isRangeWord = (w) => PRESETS.includes(w.toUpperCase()) || Boolean(PERIOD_WORDS[w.toUpperCase()]) || /^\d{4}(-\d{2}-\d{2})?$/.test(w);
const tickerShaped = (w) => TICKER_RE.test(w.toUpperCase());

// Does this command need a ticker to run? NEWS [<ticker>] does not; SHORTS <ticker> does.
export function needsTicker(entry) {
  return Boolean(entry && /(^|\s)<(ticker|tickers|symbol)>/.test(entry.syntax || ''));
}

// Edit distance, for typos in command names.
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Commands one or two typos away from a word: "FINANCALS" -> FINANCIALS.
export function fuzzyCommands(word) {
  const w = String(word || '').toUpperCase();
  if (w.length < 4) return [];
  const limit = w.length >= 7 ? 2 : 1;
  const out = [];
  for (const c of LISTED) {
    if (c.pattern || c.soon) continue;
    const d = Math.min(...[c.name, ...(c.aliases || [])].map((n) => editDistance(w, n)));
    if (d <= limit) out.push([d, c]);
  }
  return out.sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

// The one command a word (or phrase) surely means, or null. For HELP <word>:
// exact name or alias, a plain phrase (short interest), plural or singular (SHORT,
// DIVIDEND), or a single command one typo away.
export function commandForWord(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const exact = findCommand(t);
  if (exact && !exact.hidden && !exact.pattern) return exact;
  const phrased = PHRASE_INDEX.get(nameKey(t));
  if (phrased) {
    const listed = phrased.map((p) => findCommand(p.name)).filter((c) => c && !c.hidden);
    if (listed.length) return listed[0];
  }
  const up = t.toUpperCase();
  for (const alt of [`${up}S`, up.replace(/S$/, ''), up.replace(/ES$/, '')]) {
    const c = alt !== up && findCommand(alt);
    if (c && !c.hidden && !c.pattern) return c;
  }
  const fuzzy = fuzzyCommands(up.replace(/\s+/g, ''));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

// Split typed words into parts: { kind: 'name'|'phrase'|'range'|'filler'|'other', ... }.
// At each place the longest match wins; a company name beats a phrase of the same length
// ("booking holdings" is BKNG, not PORTFOLIO).
export function splitWords(raw) {
  const words = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  const clean = words.map(cleanWord);
  // Names keep a trailing 's (McDonald's); other words drop it (apple's revenue).
  const kept = words.map((w) => String(w).toLowerCase().replace(/[?!,;:]+$/, ''));
  const parts = [];
  let i = 0;
  while (i < words.length) {
    if (STOCK_WORD.test(words[i])) {
      parts.push({ kind: 'stock', len: 1, words: [words[i]], text: clean[i] });
      i += 1;
      continue;
    }
    let best = null;
    let span = 1;
    while (span < MAX_SPAN && i + span < words.length && !STOCK_WORD.test(words[i + span])) span += 1;
    for (let len = span; len >= 1; len -= 1) {
      const span = clean.slice(i, i + len).join(' ');
      if (!best || len > best.len) {
        const named = tickerForName(span) || tickerForName(kept.slice(i, i + len).join(' '));
        if (named) best = { kind: 'name', len, id: named.id, label: named.name };
      }
      if (!best || len > best.len) {
        const ph = PHRASE_INDEX.get(nameKey(span) || span);
        if (ph) best = { kind: 'phrase', len, fns: ph };
      }
    }
    if (!best) {
      const w = clean[i];
      if (isRangeWord(w)) best = { kind: 'range', len: 1 };
      else if (FILLER.has(w)) best = { kind: 'filler', len: 1 };
      else best = { kind: 'other', len: 1 };
    }
    parts.push({ ...best, words: words.slice(i, i + best.len), text: clean.slice(i, i + best.len).join(' ') });
    i += best.len;
  }
  return parts;
}

const MAJOR = (r) => r && !/^[A-Z]{4}[FY]$/.test(r.id); // 5-letter F or Y: foreign shares traded over the counter
const SUFFIX = new Set(['inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'holdings', 'group', 'sa', 'ag', 'nv', 'se', 'the', 'class', 'a', 'b', 'c', 'cl', 'common', 'stock', 'shares']);

// Search rows -> the one strong match for a name, or null. Strong: the company name
// starts with the typed words. Confident: only one strong row, or the first row is the
// typed name plus a company suffix ("Tesla Inc" for "tesla").
export function strongMatch(query, results) {
  const q = nameKey(query);
  if (!q) return null;
  const rows = (results || []).filter(MAJOR);
  const strong = rows.filter((r) => {
    const n = nameKey(r.name);
    return n === q || n.startsWith(`${q} `) || r.id === query.toUpperCase();
  });
  if (!strong.length) return null;
  if (strong.length === 1) return strong[0];
  const first = rows[0];
  if (strong[0] !== first) return null;
  const rest = nameKey(first.name).slice(q.length).trim().split(' ').filter(Boolean);
  return first.id === query.toUpperCase() || rest.every((w) => SUFFIX.has(w)) ? first : null;
}

// One symbol from words: { id, name, sure } or { candidates } when unsure.
async function resolveSymbol(words, text, { search, checkTicker }) {
  const upper = words.map((w) => cleanWord(w).toUpperCase());
  const inst = matchInstrument(upper);
  if (inst && inst.used === upper.length) return { id: inst.inst.id, name: inst.inst.name, sure: true };
  const named = tickerForName(text);
  if (named) return { id: named.id, name: named.name, sure: true };
  if (upper.length === 1 && tickerShaped(upper[0])) {
    const t = upper[0];
    if (LISTED_TICKERS.has(t)) return { id: t, name: null, sure: true };
    const ok = checkTicker ? await checkTicker(t) : null;
    if (ok === true) return { id: t, name: null, sure: true };
  }
  let results = [];
  try { results = search ? (await search(text)) || [] : []; } catch { results = []; }
  const hit = strongMatch(text, results);
  // byLookup: the symbol list has the very ticker typed, so it is real even when the
  // quote check said no (a gap in the quote source, not a bad ticker).
  const byLookup = upper.length === 1 && hit?.id === upper[0];
  if (hit) return { id: hit.id, name: hit.name, sure: true, byLookup, candidates: results };
  return { candidates: results.filter(MAJOR).slice(0, 5) };
}

// A $ word: the stock, never a name, command or instrument. { id, name, sure } or
// { candidates } (other stocks, for did-you-mean).
async function resolveStock(word, { search, checkTicker, stockId = defaultStockId }) {
  const t = cleanWord(word).toUpperCase();
  if (!TICKER_RE.test(t)) return { candidates: [] };
  const id = stockId(t) || t;
  if (id === t && LISTED_TICKERS.has(t)) return { id, name: null, sure: true };
  const ok = checkTicker ? await checkTicker(id) : null;
  if (ok === true) return { id, name: null, sure: true };
  let results = [];
  try { results = search ? (await search(t)) || [] : []; } catch { results = []; }
  const stocks = results.filter((r) => r?.id && (r.kind === 'stock' || r.kind === 'etf')).map((r) => ({ ...r, id: stockId(stockSymbol(r.id)) || r.id }));
  const hit = stocks.find((r) => stockSymbol(r.id) === t);
  if (hit) return { id, name: hit.name, sure: true, byLookup: true };
  return { candidates: stocks.filter(MAJOR).slice(0, 5) };
}

const cmdEntry = (c, cmd) => ({ name: c.name, summary: c.summary, cmd: cmd || c.examples?.[0] || c.name });

// words -> { confident, command } or { confident: false, commands, symbols }.
// deps: { search(text) -> Promise<[{ id, name, kind }]>, checkTicker(T) -> Promise<true|false|null> }.
export async function resolveInput(raw, deps = {}) {
  const from = String(raw ?? '').trim().replace(/\s+/g, ' ');
  const parts = splitWords(from);
  const phrases = parts.filter((p) => p.kind === 'phrase');
  const ranges = parts.filter((p) => p.kind === 'range').map((p) => p.text.toUpperCase());
  // Symbols: company names found locally, then runs of other words (with any filler
  // words inside, as in "royal bank of canada"): one name, or several tickers.
  const symbols = [];
  const unsure = [];
  const groups = [];
  let run = [];
  const endRun = () => {
    while (run.length && run[run.length - 1].kind === 'filler') run.pop();
    if (run.length) groups.push(run);
    run = [];
  };
  const stockParts = [];
  for (const p of parts) {
    if (p.kind === 'name') symbols.push({ at: parts.indexOf(p), id: p.id, name: p.label, sure: true });
    if (p.kind === 'stock') stockParts.push(p);
    if (p.kind === 'other' || (p.kind === 'filler' && run.length)) run.push(p);
    else endRun();
  }
  endRun();
  for (const g of groups) {
    const own = g.filter((p) => p.kind === 'other');
    const words = own.flatMap((p) => p.words);
    const allTickers = words.length > 1 && words.every((w) => tickerShaped(cleanWord(w)));
    if (!allTickers) {
      const whole = await resolveSymbol(g.flatMap((p) => p.words), g.map((p) => p.text).join(' '), deps);
      if (whole.sure) { symbols.push({ at: parts.indexOf(g[0]), ...whole }); continue; }
      if (own.length === 1) { unsure.push({ text: own[0].text, candidates: whole.candidates || [] }); continue; }
    }
    const each = await Promise.all(own.map((p) => resolveSymbol(p.words, p.text, deps)));
    each.forEach((r, k) => {
      if (r.sure) symbols.push({ at: parts.indexOf(own[k]), ...r });
      else unsure.push({ text: own[k].text, candidates: r.candidates || [] });
    });
  }
  for (const p of stockParts) {
    const r = await resolveStock(p.words[0], deps);
    if (r.sure) symbols.push({ at: parts.indexOf(p), ...r });
    else unsure.push({ text: p.words[0].toUpperCase(), candidates: r.candidates || [] });
  }
  symbols.sort((a, b) => a.at - b.at);

  // The command the phrases name: with a ticker, one that takes a ticker.
  const fnNames = [...new Set(phrases.flatMap((p) => p.fns.map((f) => f.name)))];
  const pickFn = (p) => {
    const withEntry = p.fns.map((f) => ({ ...f, entry: findCommand(f.name) })).filter((f) => f.entry);
    const want = symbols.length ? withEntry.filter((f) => f.entry.takesTicker) : withEntry.filter((f) => !needsTicker(f.entry));
    return want[0] || withEntry[0] || null;
  };
  const picked = phrases.map(pickFn).filter(Boolean);
  const distinct = [...new Map(picked.map((f) => [f.name, f])).values()];

  const suggestions = () => didYouMean({ from, parts, phrases, symbols, unsure, fnNames, stockId: deps.stockId });

  if (unsure.length || distinct.length > 1 || (!symbols.length && !distinct.length)) return { confident: false, from, ...suggestions() };

  const fn = distinct[0] || null;
  const tail = ranges.length ? ` ${ranges.join(' ')}` : '';
  const ids = symbols.map((s) => s.id);
  let command = null;
  if (!ids.length) {
    command = needsTicker(fn.entry) ? `HELP ${fn.name}` : [fn.name, fn.extra].filter(Boolean).join(' ');
  } else if (ids.length === 1) {
    if (!fn || fn.name === 'CHART') command = `${ids[0]}${tail}`;
    else if (fn.entry.takesTicker) command = [ids[0], fn.name, fn.extra].filter(Boolean).join(' ');
  } else if ((!fn || fn.name === 'COMPARE') && ids.length <= MAX_COMPARE) {
    const tickers = [...new Set(ids)];
    command = tickers.length > 1 ? `COMPARE ${tickers.join(' ')}${tail}` : `${tickers[0]}${tail}`;
  }
  if (!command) return { confident: false, from, ...suggestions() };
  // Nothing changed: the words were already this command (a bad ticker, say). Unless the
  // symbol list has each typed ticker: then it runs, and the screen asks for the quote again.
  if (sameWords(command, from, deps.stockId) && !(symbols.length && symbols.every((s) => s.byLookup))) return { confident: false, from, ...suggestions() };
  return { confident: true, from, command };
}

// Words as one command, each $ stock in its id form: "$aapl 5y" and "AAPL 5Y" match.
function canonWords(text, stockId = defaultStockId) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean)
    .map((w) => (STOCK_WORD.test(w) ? stockId(w.slice(1).toUpperCase()) || w.toUpperCase() : w.toUpperCase())).join(' ');
}
const sameWords = (a, b, stockId) => canonWords(a, stockId) === canonWords(b, stockId);

// The "Did you mean" rows: commands, then symbols, five of each at most. Never the words
// typed: "No such ticker XLY. Did you mean XLY?" helps nobody.
function didYouMean({ from = '', parts, phrases, symbols, unsure, fnNames, stockId }) {
  const typed = canonWords(from, stockId);
  const seen = new Set();
  const commands = [];
  const addCmd = (c, cmd) => {
    if (!c || c.hidden || c.pattern || c.soon || seen.has(c.name) || commands.length >= 5) return;
    if (canonWords(cmd || c.examples?.[0] || c.name, stockId) === typed) return;
    seen.add(c.name);
    commands.push(cmdEntry(c, cmd));
  };
  const firstId = symbols[0]?.id || unsure[0]?.candidates?.[0]?.id || null;
  for (const name of fnNames) {
    const c = findCommand(name);
    addCmd(c, firstId && c?.takesTicker ? `${firstId} ${c.name}` : needsTicker(c) ? `HELP ${c?.name}` : c?.name);
  }
  const words = parts.filter((p) => p.kind === 'other' || p.kind === 'phrase').map((p) => p.text);
  for (const w of words) {
    for (const c of fuzzyCommands(w.replace(/\s+/g, ''))) addCmd(c);
    for (const c of searchCommands(w).slice(0, 3)) addCmd(c);
  }
  const fn = fnNames.map(findCommand).find((c) => c?.takesTicker) || null;
  const symRows = [];
  const seenSym = new Set();
  const addSym = (s) => {
    if (!s?.id || seenSym.has(s.id) || symRows.length >= 5) return;
    seenSym.add(s.id);
    const cmd = fn ? `${s.id} ${fn.name}` : s.id;
    if (canonWords(cmd, stockId) !== typed) symRows.push({ id: s.id, name: s.name || '', cmd });
  };
  symbols.forEach(addSym);
  unsure.forEach((u) => u.candidates.forEach(addSym));
  return { commands, symbols: symRows };
}
