// Bloombroke front end: command bar, router, URL state, status line and function keys.
// Pure helpers are exported so node:test can import this file; the DOM wiring
// only runs in a browser.

// Only HOME and MARKETS come with the page; every other screen loads on first use
// (lazy.js), and the key bar's screens are fetched ahead once the page is idle.
import * as homeScreen from './screens/home.js';
import * as marketsScreen from './screens/markets.js';
import { lazyScreen as lazy, screenNow, loadScreen, loadModule, cssReady, prefetch, setStyleOrder, stylesOf, onReload } from './lazy.js';
import { parseHelp, parseFinancialsCommand, parseFinancialsArgs, parseRedeem } from './command-args.js';
import { parseScreenCommand, parseScreenArgs } from './screener.js';
import { parseWatchArgs, watchInput, WATCH_SUBCOMMANDS, loadWatchlist, saveWatchlist, toggleId } from './watchlist.js';
import { parsePfArgs, pfInput } from './portfolio.js';
import { panel, LOADING as LOADING_LINE } from './screens/markets.js';
import { matchInstrument, searchInstruments, instrumentById, resolveInstrument, STOCK_RE, stockSymbol } from './instruments.js';
import { edgeFade } from './kit.js';
import { PRESETS, parseRangeArgs, rangeWords } from './ranges.js';
import { updatedTitle } from './freshness.js';
import { dotTitle, popoverHtml } from './provenance.js'; // Provenance: the dot's tooltip and list
import { EXTRA_SCREENS, EXTRA_TAKES_ARGS, matchExtra, urlCommand, isSecret } from './commands.js';
import { getTape, loadTapeRows, bareKey, looksLikeKey, bareGift, getSeat, isPro, getMe, getStatus, getPrefs, startCommand, clockFace, chatBeep } from './pro.js';
import { avatarSvg, nameHtml } from './pixel-avatar.js'; // ME: your avatar and username by the name
// --- Pro structure: GIFT, REDEEM, CHAT, SPONSOR, FEEDBACK ---
import { stripItems, mountStrip, loadSponsors } from './sponsor-strip.js';
import { countOnly, stripShownBatch } from './goal.js'; // BBRK: sponsor strip shown and clicked
import { mountHereNow } from './here-now.js'; // N HERE NOW by the clock (GET /api/live)
// --- end Pro structure ---
import { ensureConsent, consentNeeded, loadWelcome } from './consent.js';
import { startHints, hintsDone, triedCount, countTried, HINT_STOP } from './hints.js'; // rolling hints in the command bar
import { parseDeskArgs, isEmbedSearch, tickerOf, TICKER_SCREENS } from './desk-layout.js';
import { COMPANY_SCREENS, COMPANY_TAKES_ARGS, matchCompany } from './company.js';
import { MARKETS_SCREENS, MARKETS_TAKES_ARGS, matchMarkets } from './commands-markets.js';
import { WEIRD_SCREENS, matchWeird } from './commands-weird.js';
import { matchNoSuch, dymRows } from './nosuch.js'; // NO SUCH TICKER. YET.: GRAVEYARD, IPO IT
import { LISTED, ALIASES, FUNCTION_BAR, TICKER_FUNCTIONS, findCommand } from './registry.js';
import { tapeOn, setTapeOn, mountTape, tapeItems } from './tape.js';
import { createMenu } from './menu.js';
import { compactEmbed } from './embed.js';
import { parseAffordArgs } from './afford.js';
import { resolveInput } from './resolve.js';
import { tickerForName, LISTED_TICKERS, SHADOWED_TICKERS } from './known-tickers.js';
import { sendSeen, countsAsOpen } from './trending.js'; // TRENDING
import { startAlerts } from './alerts.js'; // ALERTS: the watcher
import { mountChatBadge } from './chat-badge.js'; // CHAT 2 by the seat: unread chats (Pro)
import './goal.js'; // GOALS: loads DataFast unless Global Privacy Control is on

export { FUNCTION_BAR, TICKER_FUNCTIONS };

// The command bar's list: every listed, runnable command from registry.js, in the
// registry's order, with the HELP and MENU entries last. Shape: { name, aliases, hint,
// usage, example, usageExample, keywords }.
const toSuggestEntry = (c) => ({
  name: c.name, aliases: c.aliases, group: c.category, hint: c.summary, usage: c.syntax,
  example: c.examples[0], examples: c.examples, usageExample: c.usageExample, keywords: c.keywords || [],
});
const runnable = LISTED.filter((c) => !c.pattern && !c.soon);
export const COMMANDS = [
  ...runnable.filter((c) => c.category !== 'Start here'),
  ...runnable.filter((c) => c.category === 'Start here'),
].map(toSuggestEntry);

// Listed but not built yet: they answer "coming soon".
export const SOON = LISTED.filter((c) => c.soon).map((c) => ({ name: c.name, hint: c.summary }));

export const RENAMED_NOTE = 'Renamed to AFFORD. It is about things you buy, not investments.';

// The key bar: real function keys (never F5, F11 or F12, which stay with the browser).
// mobile: one of the five kept on a phone, next to MENU. short: its label on a phone, so
// the five and SHARE and MENU fit whole (no word cut off at the edge).
export const FKEYS = [
  { key: 'F1', label: 'HELP', cmd: 'HELP' },
  { key: 'F2', label: 'HOME', cmd: 'HOME', mobile: true },
  { key: 'F3', label: 'DESK', cmd: 'DESK' },
  { key: 'F4', label: 'MARKETS', short: 'MKTS', cmd: 'MARKETS', mobile: true },
  { key: 'F6', label: 'NEWS', cmd: 'NEWS', mobile: true },
  { key: 'F7', label: 'WATCH', cmd: 'WATCH', mobile: true },
  { key: 'F8', label: 'PORTFOLIO', short: 'PF', cmd: 'PF', mobile: true },
  { key: 'F9', label: 'SCREEN', cmd: 'SCREEN' },
  { key: 'F10', label: 'WHATIF', cmd: 'WHATIF' },
];
export const MENU_KEY = { key: 'K', ctrl: true, label: 'MENU' };

// The function key for a keydown, or null. Modifier keys never match.
export function fkeyFor(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  return FKEYS.find((k) => k.key === e.key) || null;
}

// Ctrl+K or Cmd+K opens the menu.
export function isMenuKey(e) {
  return Boolean((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toUpperCase() === 'K');
}

// Esc goes back when nothing else wants it: the command bar is empty, no suggestion
// list or menu is open, and there is a screen to go back to.
export function escGoesBack({ inputValue = '', suggestOpen = false, menuOpen = false, depth = 0 } = {}) {
  return !inputValue && !suggestOpen && !menuOpen && depth > 0;
}

export const CHART_RANGES = PRESETS;
const SIMPLE = new Set(['HOME', 'MARKETS', 'RATES', 'NEWS']);
const FUNDAMENTALS = { FINANCIALS: parseFinancialsCommand, SCREEN: parseScreenCommand, SCREENER: parseScreenCommand };
export const DEFAULT_COMMAND = 'HOME';
export const MAX_AMOUNT = 1e12;
export const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

export function tokenize(raw) {
  return String(raw ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);
}

// Amounts: digits, commas and one dot. Returns a number, or NaN for anything else.
export function parseAmountToken(tok) {
  const s = String(tok).replace(/^\$/, '');
  if (!/^[\d,]*\.?\d*$/.test(s) || !/\d/.test(s)) return NaN;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n <= MAX_AMOUNT ? n : NaN;
}

const looksNumeric = (tok) => /^\$?[\d.,]+$/.test(tok);

// Parse FX arguments: [amount] <from> [TO] <to>. Amount may use commas.
export function parseFxArgs(args) {
  const toks = args.filter((t) => t !== 'TO' && t !== 'IN' && t !== '=');
  let amount = 1;
  let amountGiven = false;
  if (toks.length && looksNumeric(toks[0])) {
    const n = parseAmountToken(toks[0]);
    if (!Number.isFinite(n)) return { error: 'amount' };
    amount = n;
    amountGiven = true;
    toks.shift();
  }
  if (toks.length !== 2) return { error: 'usage' };
  const [from, to] = toks;
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return { error: 'code', from, to };
  return { amount, amountGiven, from, to };
}

// AFFORD's words live in afford.js (the share card reads them too).
export { BUY_UNITS, BUY_DEFAULTS, INVESTMENT_WORDS, isInvestmentWord, parseAffordArgs, parseBuyArgs } from './afford.js';

// WAGE <per hour>. WAGE alone shows it, WAGE OFF clears it.
export function parseWageArgs(args) {
  const toks = args.filter((t) => t !== 'PER' && t !== 'HOUR' && t !== 'HR' && t !== '/HR' && t !== 'AN' && t !== 'USD');
  if (!toks.length) return { wage: null, show: true };
  if (toks.length === 1 && (toks[0] === 'OFF' || toks[0] === 'CLEAR' || toks[0] === '0')) return { wage: null, clear: true };
  if (toks.length !== 1 || !looksNumeric(toks[0])) return { error: 'usage' };
  const wage = parseAmountToken(toks[0]);
  if (!Number.isFinite(wage) || wage <= 0 || wage > 100000) return { error: 'amount' };
  return { wage };
}

// Parse CPI arguments: [amount] [year]. Defaults: 100 dollars, year 2000.
export function parseCpiArgs(args) {
  const toks = args.filter((t) => t !== 'IN' && t !== 'FROM' && t !== 'USD');
  const isYear = (t) => /^\d{4}$/.test(t) && Number(t) >= 1900 && Number(t) <= 2100;
  let amount = 100;
  let year = 2000;
  if (toks.length > 2) return { error: 'usage' };
  if (toks.length === 1) {
    if (isYear(toks[0])) year = Number(toks[0]);
    else if (looksNumeric(toks[0])) amount = parseAmountToken(toks[0]);
    else return { error: 'usage' };
  } else if (toks.length === 2) {
    if (!looksNumeric(toks[0]) || !/^\d{4}$/.test(toks[1])) return { error: 'usage' };
    amount = parseAmountToken(toks[0]);
    year = Number(toks[1]);
  }
  if (!Number.isFinite(amount)) return { error: 'amount' };
  return { amount, year };
}

export function isTicker(tok) {
  return TICKER_RE.test(tok);
}

// A ticker or a stock id ($GOLD, $M): what a ticker screen takes.
export const TICKER_ID_RE = /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// "$" + ticker always means the stock. The stock's id: the plain ticker when the plain
// word already opens that stock (AAPL, BRK.B), else the ticker with its $ kept (GOLD is
// spot gold, M is MARKETS, HELP is HELP: $GOLD, $M, $HELP are the stocks).
export function stockId(sym) {
  const t = String(sym ?? '').toUpperCase().replace(/^\$/, '');
  if (!TICKER_RE.test(t)) return null;
  if (resolveInstrument(t)) return `$${t}`;
  const plain = parseCommand(t, 1);
  return plain.name === 'QUOTE' && plain.args?.ticker === t ? t : `$${t}`;
}

// Every $TICKER word in its id form: $AAPL -> AAPL, $gold -> $GOLD. Amounts ($1200) stay.
function stockWords(toks) {
  return toks.map((w) => (STOCK_RE.test(w) ? stockId(w) : w));
}

// The dim "Stock: $GOLD" hint for a plain word that is also a listed stock (GOLD opens
// spot gold, M opens MARKETS): the $ command that opens the stock, or null.
// raw: the words as typed; cmd: what they parsed to.
export function stockHintFor(raw, cmd) {
  const toks = tokenize(raw);
  const head = toks[0];
  if (!head || !SHADOWED_TICKERS.has(head) || !cmd || cmd.name === 'UNKNOWN') return null;
  // The word alone, or a named instrument's chart with its period (GOLD 5Y).
  if (toks.length > 1 && !(cmd.name === 'QUOTE' && !cmd.error)) return null;
  return [`$${head}`, ...toks.slice(1)].join(' ');
}

// <symbol> [range]: a named instrument (GOLD, EUR/USD, S&P 500) or a ticker, then a
// preset (5Y), two dates, or FROM <date> [TO <date>]. Bad dates still open the screen,
// which explains; words that are not a range make the whole input UNKNOWN.
export function parseSymbolCommand(toks) {
  const stock = STOCK_RE.test(toks[0]) ? stockId(toks[0]) : null; // $GOLD: never spot gold
  const m = stock ? null : matchInstrument(toks);
  if (!stock && !m && !isTicker(toks[0])) return null;
  const ticker = stock || (m ? m.inst.id : toks[0]);
  const range = parseRangeArgs(toks.slice(m ? m.used : 1));
  if (range.error === 'usage') return null;
  if (range.error) return { name: 'QUOTE', args: { ticker, error: range.error }, error: range.error, input: toks.join(' ') };
  return { name: 'QUOTE', args: { ticker, ...range }, input: [ticker, rangeWords(range)].filter(Boolean).join(' ') };
}

// The symbol at the start of the words: { id, used }, or null.
function leadingSymbol(toks) {
  if (STOCK_RE.test(toks[0])) return { id: stockId(toks[0]), used: 1 };
  const m = matchInstrument(toks);
  if (m) return { id: m.inst.id, used: m.used };
  return isTicker(toks[0]) ? { id: toks[0], used: 1 } : null;
}

// AAPL CHART 5Y -> the same as CHART AAPL 5Y. Returns null when the second word is not
// a ticker function. A function that exists but does not take this ticker yet (or is
// not built yet) returns SOON.
export function parseTickerFunction(toks) {
  const sym = leadingSymbol(toks);
  if (!sym) return null;
  const fn = toks[sym.used];
  if (!TICKER_FUNCTIONS.includes(fn)) return null;
  const rest = toks.slice(sym.used + 1);
  const inner = parseCommand([fn, sym.id, ...rest].join(' '), 1);
  // A usage error means the function exists but does not take a ticker (EARNINGS today).
  if (inner.name !== 'UNKNOWN' && inner.name !== 'SOON' && inner.error !== 'usage' && tokenize(inner.input).includes(sym.id)) return inner;
  return { name: 'SOON', args: { soon: { name: `${sym.id} ${fn}`, hint: `${fn} for one ticker is on the way`, ticker: sym.id } }, input: [sym.id, fn, ...rest].join(' ') };
}

// The function bar for a ticker: [{ fn, cmd, ready, current }].
export function tickerFunctions(ticker, current = 'CHART') {
  return FUNCTION_BAR.map((fn) => {
    const cmd = fn === 'CHART' ? ticker : `${ticker} ${fn}`;
    return { fn, cmd, ready: parseCommand(cmd).name !== 'SOON', current: fn === current };
  });
}

// CHAT, CHAT 42 (open that chat or ask them), CHAT 42 88 (a group): 1 to 7 seat numbers,
// leading zeros fine. CHAT @tom: the same by username (ME). With seats or a name it
// changes something (a request, a group), so it shows plain CHAT in the address bar and a
// link to it asks first.
export const MAX_CHAT_SEATS = 7;
export const AT_NAME_RE = /^@([A-Z][A-Z0-9_]{2,14})$/i;
export function parseChat(rest) {
  if (!rest.length) return { name: 'CHAT', input: 'CHAT' };
  const at = rest.length === 1 ? AT_NAME_RE.exec(rest[0]) : null;
  if (at) return { name: 'CHAT', args: { name: at[1] }, input: `CHAT @${at[1]}`, mutates: true, view: 'CHAT' };
  const seats = [...new Set(rest.map((w) => (/^\d{1,9}$/.test(w) ? Number(w) : NaN)))];
  if (seats.some((n) => !(n >= 1)) || seats.length > MAX_CHAT_SEATS) return { name: 'CHAT', args: { error: 'usage' }, error: 'usage', input: ['CHAT', ...rest].join(' ') };
  return { name: 'CHAT', args: { seats }, input: `CHAT ${seats.join(' ')}`, mutates: true, view: 'CHAT' };
}

// Turn raw input into { name, args?, error?, input }. Unknown commands get name 'UNKNOWN'.
// Commands that change saved lists (WATCH ADD, PF SELL) carry mutates: true and the
// screen to show in the URL instead (view), so a reload never runs them twice.
export function parseCommand(raw, depth = 0) {
  const toks = stockWords(tokenize(raw));
  if (!toks.length) return { name: DEFAULT_COMMAND, input: DEFAULT_COMMAND };
  const rest = toks.slice(1);
  // $GOLD 1Y, $M, $CHAT FINANCIALS: the stock, past every command, alias and instrument.
  if (STOCK_RE.test(toks[0])) {
    const fn = depth === 0 ? parseTickerFunction(toks) : null;
    return fn || parseSymbolCommand(toks) || { name: 'UNKNOWN', input: toks.join(' ') };
  }
  // W is also a ticker (Wayfair): it means WATCH only alone or before a WATCH word.
  const head = toks[0] === 'W' && (!rest.length || WATCH_SUBCOMMANDS.includes(rest[0])) ? 'WATCH' : (ALIASES[toks[0]] || toks[0]);
  // A pasted Pro key on its own is LOGIN <key>: the key never reaches the URL or history.
  const key = !isCommandHead(head) && bareKey(toks);
  if (key) return { name: 'LOGIN', args: { key }, input: 'LOGIN', secret: true, url: 'PRO' };
  // --- Pro structure: a gift code (pasted alone, after GIFT or after REDEEM) is REDEEM,
  // and like a key it never reaches the URL or history. ---
  if (head === 'REDEEM') return { name: 'REDEEM', args: parseRedeem(rest), input: 'REDEEM', secret: true, url: 'REDEEM' };
  const giftCode = (!isCommandHead(head) || head === 'GIFT') && bareGift(toks);
  if (giftCode) return { name: 'REDEEM', args: { code: giftCode }, input: 'REDEEM', secret: true, url: 'REDEEM' };
  if (head === 'GIFT' || head === 'SPONSOR' || head === 'FEEDBACK' || head === 'ME') return { name: head, input: head };
  if (head === 'CHAT') return parseChat(rest);
  // --- end Pro structure ---
  const extra = matchExtra(head, rest);
  if (extra) return extra;
  if (SIMPLE.has(head)) return { name: head, input: head };
  if (head === 'HELP') return { name: 'HELP', args: parseHelp(rest), input: ['HELP', ...rest].join(' ') };
  if (head === 'MENU') return { name: 'MENU', input: 'MENU' };
  if (head === 'FX') {
    const args = parseFxArgs(rest);
    return { name: 'FX', args, error: args.error, input: ['FX', ...rest].join(' ') };
  }
  if (head === 'CPI') {
    const args = parseCpiArgs(rest);
    return { name: 'CPI', args, error: args.error, input: ['CPI', ...rest].join(' ') };
  }
  if (head === 'AFFORD' && rest.length) {
    const args = parseAffordArgs(rest);
    return { name: 'AFFORD', args, error: args.error, input: ['AFFORD', ...rest].join(' ') };
  }
  // BUY was renamed AFFORD: typed, it says so; an old link (?c=BUY+...) opens AFFORD.
  if (head === 'BUY') {
    return { name: 'RENAMED', args: { from: 'BUY', to: ['AFFORD', ...rest].join(' ') }, input: ['BUY', ...rest].join(' ') };
  }
  if (head === 'WAGE') {
    const args = parseWageArgs(rest);
    return { name: 'WAGE', args, error: args.error, input: ['WAGE', ...rest].join(' ') };
  }
  if (head === 'WHATIF') {
    return { name: 'WHATIF', args: { tokens: rest }, input: ['WHATIF', ...rest].join(' ') };
  }
  if (head === '420' && !rest.length) return { name: 'FUNDING', input: '420' };
  if (head === 'AFFORD') return { name: 'AFFORD', args: { error: 'usage' }, error: 'usage', input: 'AFFORD' };
  const soon = SOON.find((s) => s.name === head);
  if (soon && !rest.length) return { name: 'SOON', args: { soon }, input: head };
  if (head === 'WATCH') {
    const args = parseWatchArgs(rest);
    return { name: 'WATCH', args, error: args.error, input: watchInput(args) || ['WATCH', ...rest].join(' '), mutates: Boolean(args.mutates), view: 'WATCH' };
  }
  if (head === 'DESK') {
    const args = parseDeskArgs(rest);
    const view = args.n ? `DESK ${args.n}` : 'DESK';
    // DESK cards: a preset (DESK WEIRD) changes the saved desk like RESET does.
    return { name: 'DESK', args, error: args.error, input: ['DESK', ...rest].join(' '), mutates: Boolean(args.reset || args.preset), view };
  }
  if (head === 'PORTFOLIO') {
    const args = parsePfArgs(rest);
    return { name: 'PORTFOLIO', args, error: args.error, input: pfInput(args) || ['PF', ...rest].join(' '), mutates: Boolean(args.mutates), view: 'PF' };
  }
  if (head === 'CHART' && rest.length) {
    const chart = parseSymbolCommand(rest);
    if (chart) return chart;
  }
  if (FUNDAMENTALS[head]) return FUNDAMENTALS[head](rest);
  if (depth === 0) {
    const fn = parseTickerFunction(toks);
    if (fn) return fn;
  }
  const company = matchCompany(head, rest); if (company) return company;
  const markets = matchMarkets(head, rest); if (markets) return markets;
  const weird = matchWeird(head, rest); if (weird) return weird;
  const nosuch = matchNoSuch(head, rest); if (nosuch) return nosuch;
  // Add new commands above this line: commands win over symbols of the same name.
  const quote = parseSymbolCommand(toks);
  if (quote) return quote;
  return { name: 'UNKNOWN', input: toks.join(' ') };
}

function isCommandHead(head) {
  return SIMPLE.has(head) || head === '420' || head === 'PORTFOLIO' || head === 'CHART' || head === 'DESK' || Boolean(FUNDAMENTALS[head])
    || COMMANDS.some((c) => c.name === head) || SOON.some((s) => s.name === head);
}

// What a command puts in the URL and the command history. LOGIN (typed or a pasted key)
// keeps its key out of both; commands that change something show their screen instead.
export function urlFor(clean) {
  const parsed = parseCommand(clean);
  const url = parsed.mutates ? parsed.view : parsed.url || urlCommand(clean);
  const kept = parsed.secret || isSecret(clean) ? parsed.input : clean;
  return { url, kept };
}

// URL state: ?c=FX+500+USD+THB
export function toQuery(input) {
  const c = tokenize(input).join(' ');
  // $ is fine in a query: ?c=$M, not ?c=%24M.
  return '?' + new URLSearchParams({ c }).toString().replace(/%24/g, '$');
}

export function fromQuery(search) {
  const c = new URLSearchParams(search || '').get('c');
  const cleaned = tokenize(c).join(' ');
  return cleaned || DEFAULT_COMMAND;
}

// Commands that take arguments: Tab adds a space, and a bad argument shows the usage line.
const chartArgs = (args) => (args.length && parseSymbolCommand(args) ? {} : { error: 'usage' });
const TAKES_ARGS = { FX: parseFxArgs, CPI: parseCpiArgs, AFFORD: parseAffordArgs, WAGE: parseWageArgs, CHART: chartArgs, ...EXTRA_TAKES_ARGS, ...COMPANY_TAKES_ARGS, ...MARKETS_TAKES_ARGS, FINANCIALS: parseFinancialsArgs, SCREEN: parseScreenArgs };
// Commands that run on their own but still show the usage line for bad words after them.
const CHECKS_ARGS = { WATCH: parseWatchArgs, PORTFOLIO: parsePfArgs, DESK: parseDeskArgs };
const commandFor = (word) => COMMANDS.find((c) => c.name === word || c.aliases?.includes(word));

// Commands found by a synonym ("YIELD" finds CURVE, BONDS, RATES), after the name matches.
function keywordSuggestions(head, have) {
  if (head.length < 3) return [];
  const w = head.toLowerCase();
  const names = new Set(have.map((s) => s.name));
  return COMMANDS
    .filter((c) => !names.has(c.name) && c.keywords.some((k) => k.startsWith(w) || k.split(/\s+/).some((p) => p.startsWith(w))))
    .slice(0, 4)
    .map((c) => ({ name: c.name, hint: c.hint, value: TAKES_ARGS[c.name] ? c.name + ' ' : c.name }));
}

// Suggestions for the dropdown: [{ name, hint, value }].
export function suggest(raw) {
  const text = String(raw ?? '').replace(/^\s+/, '').toUpperCase();
  const toks = tokenize(text);
  if (!toks.length) return COMMANDS.map((c) => ({ name: c.name, hint: c.hint, value: c.example }));
  const head = toks[0];
  const typingHead = toks.length === 1 && !/\s$/.test(text);
  // $ + ticker is a stock: no commands, aliases or instruments (the server's symbols come in app.js).
  if (head.startsWith('$')) return [];
  if (typingHead) {
    const cmds = COMMANDS
      .filter((c) => c.name.startsWith(head) || (head.length >= 2 && c.aliases?.some((a) => a.startsWith(head))))
      .map((c) => ({ name: c.name, hint: c.hint, value: TAKES_ARGS[c.name] ? c.name + ' ' : c.name }));
    if (head.length < 2) return cmds;
    const symbols = symbolSuggestions(searchInstruments(head, 6), cmds);
    return [...cmds, ...symbols, ...keywordSuggestions(head, cmds)];
  }
  const cmd = commandFor(head);
  const check = cmd && (TAKES_ARGS[cmd.name] || CHECKS_ARGS[cmd.name]);
  if (check) {
    const args = check(toks.slice(1));
    if (args.error) return [{ name: cmd.usage, hint: 'e.g. ' + (cmd.usageExample || cmd.example), value: cmd.usageExample || cmd.example, usage: true }];
  }
  return [];
}

// Arrow keys in the open suggestion list. -1 means nothing is picked (Enter runs what
// was typed). Down from the last item, or Up from the first, goes back to -1.
export function stepActive(active, count, dir) {
  if (!count) return -1;
  if (active < 0) return dir > 0 ? 0 : count - 1;
  const next = active + dir;
  return next < 0 || next >= count ? -1 : next;
}

const KIND_LABEL = { index: 'index', future: 'futures', crypto: 'crypto', fx: 'currency pair', yield: 'yield', stock: 'stock', etf: 'ETF' };

// Search rows (/api/search) with each stock under the id that opens it: M (Macy's) is $M,
// since M alone is MARKETS. dollar: the words started with $, so stocks only, each as
// $ + ticker ($GO + Tab -> $GOLD, never spot gold).
export function stockRows(results, dollar = false) {
  const isStock = (r) => r?.kind === 'stock' || r?.kind === 'etf';
  return (results || [])
    .filter((r) => r?.id && (!dollar || isStock(r)))
    .map((r) => (isStock(r) ? { ...r, id: dollar ? `$${stockSymbol(r.id)}` : stockId(stockSymbol(r.id)) || r.id } : r));
}

// Symbol rows for the suggestion list, skipping any value already listed.
export function symbolSuggestions(results, existing = []) {
  const have = new Set(existing.map((e) => e.value));
  return results
    .filter((r) => !have.has(r.id))
    .map((r) => ({ name: r.id, hint: `${r.name}${KIND_LABEL[r.kind] ? ` · ${KIND_LABEL[r.kind]}` : ''}`, value: r.id, symbol: true }));
}

// Tab completion over a suggestion list (the one the dropdown shows): the n-th entry,
// counting from the top. An entry that is already exactly what was typed is skipped, so
// AAP + Tab goes to AAPL, not back to AAP. No entries: the text stays.
export function completeFrom(list, raw, index = 0) {
  const typed = String(raw ?? '').replace(/^\s+/, '').toUpperCase();
  const opts = (list || []).filter((s) => s.value !== typed);
  if (!opts.length) return raw;
  return opts[((index % opts.length) + opts.length) % opts.length].value;
}

// Tab completion from the local suggestions alone.
export function complete(raw, index = 0) {
  return completeFrom(suggest(raw), raw, index);
}

// New York market hours: 9:30 to 16:00 ET, Monday to Friday, NYSE holidays closed,
// early closes at 13:00.
export const NYSE_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
export const NYSE_EARLY_CLOSES = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

export function nyParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    weekday: get('weekday'),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24, minute: Number(get('minute')), second: Number(get('second')),
  };
}

export function marketStatus(date = new Date()) {
  const { weekday, date: day, hour, minute } = nyParts(date);
  if (['Sat', 'Sun'].includes(weekday) || NYSE_HOLIDAYS.has(day)) return 'CLOSED';
  const mins = hour * 60 + minute;
  const close = NYSE_EARLY_CLOSES.has(day) ? 13 * 60 : 16 * 60;
  return mins >= 9 * 60 + 30 && mins < close ? 'OPEN' : 'CLOSED';
}

// The top bar's seat: your avatar, your username in its colour (SEAT 00042 without one)
// and #00042 small. It opens ME.
export function seatHtml(me, seat) {
  const n = Number.isInteger(seat) ? seat : (Number.isInteger(me?.seat) ? me.seat : null);
  const pad = n ? String(n).padStart(5, '0') : '-----';
  const p = { seat: n, name: me?.username || null, color: me?.color ?? null, avatar: me?.avatar || null };
  const av = avatarSvg(p, { size: 16, cls: 'seat-av' });
  if (!p.name) return `${av} SEAT ${pad}`;
  return `${av} ${nameHtml(p)} <span class="seat-n dim">#${pad}</span>`;
}
// 'CHAT 3' -> 3, 'CHAT 99+' -> 99, '' -> 0.
export const badgeCount = (t) => Number((/\d+/.exec(String(t ?? '')) || ['0'])[0]);

export function nyClock(date = new Date()) {
  const { hour, minute, second } = nyParts(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(hour)}:${p(minute)}:${p(second)}`;
}

// The freshness dot by the New York clock: ice blue when the screen's data is fresh,
// grey when it is stale. The time is in its tooltip; every price carries its own RT or
// DLY tag.
export function freshDot(iso, stale) {
  return { state: stale ? 'stale' : 'fresh', title: updatedTitle(iso, stale) };
}

// Overdue: no update for twice the screen's own refresh gap (at least a minute). A
// sleeping tab or failing fetches turn the dot stale. every: ms between the last two
// updates, 0 when the screen loads once.
export function freshOverdue({ at = 0, every = 0 } = {}, now = Date.now()) {
  return Boolean(at && every) && now - at > Math.max(60_000, 2 * every);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Browser wiring
// ---------------------------------------------------------------------------

async function fetchJSON(url, { signal } = {}) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw Object.assign(new Error('You look offline. Check your connection and try again.'), { code: 'network' });
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    throw Object.assign(new Error(body?.message || 'Something went wrong. Try again in a minute.'), { code: body?.error, status: res.status, body });
  }
  return body;
}

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

// The screens by name. HOME and MARKETS are here already; the rest are lazy (lazy.js):
// a module name, loaded on first use.
const help = lazy('screens/help.js');
const buy = lazy('screens/buy.js');
const SCREENS = {
  HOME: homeScreen, HELP: help, MARKETS: marketsScreen, FX: lazy('screens/fx.js'),
  QUOTE: lazy('screens/quote.js'), CPI: lazy('screens/cpi.js'), RATES: lazy('screens/rates.js'), NEWS: lazy('screens/news.js'),
  AFFORD: buy, WAGE: buy, WHATIF: lazy('screens/whatif.js'), FUNDING: lazy('screens/funding.js'),
  WATCH: lazy('screens/watch.js'), PORTFOLIO: lazy('screens/portfolio.js'),
  FINANCIALS: lazy('screens/financials.js'), SCREEN: lazy('screens/screen.js'), DESK: lazy('screens/desk.js'),
  MENU: help,
  // Pro structure
  GIFT: lazy('screens/pro.js', 'giftCommand'), REDEEM: lazy('screens/pro.js', 'redeemCommand'), CHAT: lazy('screens/chat.js'), SPONSOR: lazy('screens/sponsor.js'), FEEDBACK: lazy('screens/feedback.js'),
  ME: lazy('screens/me.js'), // ME: profile, plan, this device, key and data (SETTINGS, ACCOUNT)
};
// NO SUCH TICKER. YET.: GRAVEYARD and IPO IT draw from screens/nosuch.js's own table.
const NOSUCH = 'screens/nosuch.js';
const NOSUCH_SCREENS = Object.fromEntries(['GRAVEYARD', 'IPOIT'].map((n) => [n, lazy(NOSUCH, (m) => m.NOSUCH_SCREENS[n])]));

// The screen entry for a command name, or null.
export function screenFor(name) {
  return SCREENS[name] || EXTRA_SCREENS[name] || COMPANY_SCREENS[name] || MARKETS_SCREENS[name] || WEIRD_SCREENS[name] || NOSUCH_SCREENS[name] || null;
}

// A screen's own stylesheets load with its module, before it first draws: the sheet
// beside the module (screens/whatif.css), and beside each module it imports (the page's
// manifest lists them, lazy.js). SHEET_ORDER is the order their rules had when they were
// part of the page's stylesheets, so they stack the same way whatever opens first; a
// sheet not listed goes last.
export const SHEET_ORDER = [
  'screens/financials.css', 'screens/quote.css', 'screens/whatif.css', 'screens/guess.css',
  'screens/screen.css', 'screens/watch.css', 'screens/portfolio.css', 'screens/desk.css',
  'screens/desk-cards.css', 'screens/weird.css', 'screens/sponsor.css', 'screens/fishtank.css',
  'screens/alerts.css', 'screens/pro.css', 'screens/why.css', 'screens/sectors.css', 'screens/heatmap.css',
  'screens/fxmatrix.css', 'screens/calendar.css', 'screens/bbrk.css', 'screens/options.css',
  'screens/worldmap.css', 'screens/help.css', 'screens/nosuch.css', 'screens/graveyard.css', 'screens/data.css',
  'screens/welcome.css', 'screens/grid.css', 'screens/chat.css', 'screens/me.css',
];
export const stylesFor = (entry) => (entry?.js ? stylesOf(entry.js) : []);

// The modules a command's screen loads (for the page to fetch them early): { modules }.
export function screenFiles(raw) {
  const entry = screenFor(parseCommand(raw).name);
  return { modules: entry?.js ? [entry.js] : [] };
}

// Screens about one stock share one tab strip under the title: the same functions, in
// the same order, with the same names, on every one of them. null for other screens
// (and for named instruments like GOLD or SPX, which have no company functions).
const FN_OF_SCREEN = { QUOTE: 'CHART', TICKERNEWS: 'NEWS' };
export function tickerStripFor(cmd) {
  const ticker = cmd?.args?.ticker;
  if (!ticker || !TICKER_ID_RE.test(ticker) || instrumentById(ticker)) return null;
  if (cmd.error && cmd.name !== 'QUOTE') return null;
  const current = FN_OF_SCREEN[cmd.name] || cmd.name;
  return FUNCTION_BAR.includes(current) ? { ticker, current } : null;
}

// The ticker the watch star by the screen name is for: the stock of a strip, or a
// named instrument's chart (GOLD, BTC, EURUSD, SPX). One star, one place, every time.
export function starTickerFor(cmd) {
  const strip = tickerStripFor(cmd);
  if (strip) return strip.ticker;
  return cmd?.name === 'QUOTE' && !cmd.error && instrumentById(cmd.args?.ticker) ? cmd.args.ticker : null;
}

// The strip: keys 1 to 9 for the first nine.
export function tickerStripHtml(ticker, current) {
  return tickerFunctions(ticker, current).map((f, i) => {
    const key = i < 9 ? ` data-key="${i + 1}"` : '';
    const n = i < 9 ? `<span class="fn-n" aria-hidden="true">${i + 1}</span>` : '';
    return `<a class="fn${f.current ? ' is-active' : ''}" href="${toQuery(f.cmd)}" data-cmd="${escapeHtml(f.cmd)}"${key}${f.current ? ' aria-current="page"' : ''}>${n}${f.fn}</a>`;
  }).join('');
}

// The key bar: the function keys, then SHARE and MENU on the right.
export function keybarHtml() {
  return `<div class="fkeys">${FKEYS.map((k) => `<a class="fkey${k.mobile ? ' is-mobile' : ''}" href="${toQuery(k.cmd)}" data-cmd="${escapeHtml(k.cmd)}" data-name="${parseCommand(k.cmd).name}"${k.short ? ` aria-label="${k.label}"` : ''}><span class="fkey-n">${k.key}</span><span class="fkey-l">${k.label}</span>${k.short ? `<span class="fkey-short">${k.short}</span>` : ''}</a>`).join('')}</div>
    <button type="button" class="fkey fkey-share" id="share" aria-label="Copy a link to this screen"><span class="fkey-l">SHARE</span></button>
    <button type="button" class="fkey fkey-menu" id="menu-btn" aria-haspopup="dialog"><span class="fkey-l">MENU</span><span class="fkey-n">Ctrl K</span></button>`;
}

// A command that is only a panel number: "3" -> 3, "12" -> 12. Anything else (3988.HK,
// CPI 100 2000) -> null, and runs as a command.
export function panelNumberInput(clean) {
  const t = String(clean ?? '').trim();
  return /^[1-9]\d?$/.test(t) ? Number(t) : null;
}

// The item a number and Enter opens on a screen, or null: a did-you-mean row
// (data-key, which keys 1 to 9 also open at once where digits are keys), or a numbered
// item that opens only on number and Enter, never on a bare digit (data-num: WEIRD tile
// 12 opens its gauge's own screen, WSB).
export function numberedItem(root, n) {
  return root.querySelector(`[data-key="${n}"]`) || root.querySelector(`[data-num="${n}"]`);
}

// The panel labelled "<n>) ..." on a screen (HOME: 1 MARKETS, 2 S&P 500...), or null.
export function panelByNumber(root, n) {
  const prefix = `${n})`;
  for (const p of root.querySelectorAll('.panel')) {
    const label = p.querySelector('.panel-head > .panel-label');
    if (label && String(label.textContent).trim().startsWith(prefix)) return p;
  }
  return null;
}

// A command with its full name first: PF ADD AAPL -> PORTFOLIO ADD AAPL, M -> MARKETS.
export function fullName(input) {
  const toks = tokenize(input);
  const entry = toks.length ? findCommand(toks[0]) : null;
  if (entry && !entry.hidden && !entry.pattern) toks[0] = entry.name;
  return toks.join(' ');
}

// The screen's name for the label in the command bar (sub: its one line from the
// registry, which HELP and MENU show). Internal screen names map back to the registry
// (TICKERNEWS is NEWS <ticker>).
export function screenTitle(cmd) {
  const strip = tickerStripFor(cmd);
  if (strip) {
    const entry = findCommand(strip.current);
    return { title: strip.ticker, sub: strip.current === 'CHART' ? '' : entry.summary };
  }
  if (!cmd || cmd.name === 'UNKNOWN') return { title: 'Unknown command', sub: '' };
  if (cmd.name === 'SOON') return { title: cmd.args.soon.name, sub: 'Coming soon' };
  if (cmd.name === 'QUOTE') return { title: cmd.input, sub: '' };
  if (cmd.name === 'FUNDING') return { title: cmd.input, sub: '' };
  if (cmd.name === 'MENU') return { title: 'HELP', sub: findCommand('HELP').summary };
  if (cmd.name === 'HELP' && cmd.args?.topic) return { title: fullName(cmd.input), sub: `How to use ${cmd.args.topic}` };
  const entry = findCommand(tokenize(cmd.input)[0]) || findCommand(cmd.name);
  return { title: fullName(cmd.input), sub: entry && !entry.hidden ? entry.summary : '' };
}
// What a saved-list command changes, for the "this link wants to change" question.
const SAVED_LIST = { PORTFOLIO: ['Portfolio', 'portfolio'], WATCH: ['Watchlist', 'watchlist'], DESK: ['Desk', 'desk layout'], CHAT: ['CHAT', 'chats'] };
const LINK_CHANGES = { PORTFOLIO: 'portfolio', WATCH: 'watchlist', DESK: 'desk layout', ALERTS: 'alerts', TAPE: 'ticker tape', WAGE: 'saved wage', CHAT: 'chats' };
// The plain screen each one shows (DESK: its own view, DESK or DESK 2).
const LINK_SCREEN = { PORTFOLIO: 'PF', WATCH: 'WATCH', ALERTS: 'ALERTS', TAPE: 'TAPE', WAGE: 'WAGE', CHAT: 'CHAT' };

// Does this command change something saved in this browser (anything but a pure show)?
export function linkChanges(cmd) {
  if (!cmd || !LINK_CHANGES[cmd.name] || cmd.error) return false;
  const a = cmd.args || {};
  if (cmd.name === 'WAGE') return !a.show;
  if (cmd.name === 'ALERTS' || cmd.name === 'TAPE') return a.action !== 'show';
  return Boolean(cmd.mutates);
}

// The one-line question for a link that would change something saved in this browser.
export function linkQuestion(cmd) {
  const a = cmd.args || {};
  if (cmd.name === 'ALERTS' && a.alert) return { question: `Add alert ${a.alert.sym} ${a.alert.op} ${a.alert.level}?`, verb: 'ADD' };
  if (cmd.name === 'ALERTS' && a.action === 'clear') return { question: 'Clear all your alerts?', verb: 'CLEAR' };
  if (cmd.name === 'WAGE' && a.clear) return { question: 'Forget your saved wage?', verb: 'FORGET' };
  if (cmd.name === 'WAGE' && Number.isFinite(a.wage)) return { question: `Save your wage as $${a.wage} an hour?`, verb: 'SAVE' };
  if (cmd.name === 'WATCH' && a.action === 'add' && a.ids?.length) return { question: `Add ${a.ids.join(', ')} to your watchlist?`, verb: 'ADD' };
  if (cmd.name === 'WATCH' && a.action === 'remove' && a.ids?.length) return { question: `Remove ${a.ids.join(', ')} from your watchlist?`, verb: 'REMOVE' };
  if (cmd.name === 'CHAT' && a.seats?.length) return { question: `Chat with ${a.seats.map((n) => `SEAT ${n}`).join(', ')}?`, verb: 'CHAT' };
  if (cmd.name === 'CHAT' && a.name) return { question: `Chat with @${a.name}?`, verb: 'CHAT' };
  return { question: `Run ${cmd.input}? It changes your ${LINK_CHANGES[cmd.name] || 'saved settings'}.`, verb: 'RUN' };
}

// What a link (?c=...) does when the page opens: { url, show, ask }. url: what stays in
// the address bar; show: the command to render; ask: null, or { run, question, verb } for
// a one-line confirm over the screen. A link never changes anything saved by itself:
// WATCH ADD, PF BUY, ALERTS AAPL > 350, TAPE ADD and DESK RESET open their screen and
// ask, whatever the words (ALERT AAPL > 350 too), and the address bar keeps only the
// plain screen. A DESK preset (DESK WEIRD) loads like typed: DESK asks first over panels
// of your own. LOGIN and LOGOUT only ever show PRO.
export function linkPlan(raw) {
  const clean = tokenize(raw).join(' ') || DEFAULT_COMMAND;
  const cmd = parseCommand(clean);
  const { url } = urlFor(clean);
  if (cmd.name === 'DESK' && cmd.args?.preset && !cmd.error) return { url, show: clean, ask: null };
  if (cmd.secret || cmd.name === 'LOGIN' || cmd.name === 'LOGOUT' || !linkChanges(cmd)) return { url, show: url, ask: null };
  const plain = cmd.view || LINK_SCREEN[cmd.name];
  return { url: plain, show: plain, ask: { run: clean, url: plain, ...linkQuestion(cmd) } };
}
export const DEFAULT_TITLE = 'Bloombroke: a free market terminal. Pro $420 a year.';
// DRIVE (drive.js): a screen from the driver opens like a link, so it never changes anything.
export const driveTarget = (raw) => { const p = linkPlan(raw); return p.ask ? p.url : p.show; };

// A ticker screen whose ticker is not known yet: check it has a quote before showing
// the screen (TESLA is not a ticker; the resolver makes it TSLA). null when no check.
export function tickerToCheck(cmd) {
  if (!cmd || cmd.mutates || cmd.error) return null;
  const t = cmd.args?.ticker;
  // A $ stock ($GOLD, $XXXXX) is always checked: it may be no ticker at all.
  const stock = STOCK_RE.test(t);
  if (!t || (!stock && (!TICKER_RE.test(t) || instrumentById(t) || LISTED_TICKERS.has(t)))) return null;
  return cmd.name === 'QUOTE' || tickerStripFor(cmd) ? t : null;
}

// The status line note after the resolver ran a command for the words typed.
export function resolvedNote(command, from) {
  return `Showing ${command} (from '${String(from).toLowerCase()}')`;
}

// The last line of the "Did you mean" screen (the same as screens/nosuch.js HELP_LINE;
// test/speed.test.js checks), here so the page can draw it before that module loads.
export const HELP_LINE = '<p class="muted ns-help">Type <a class="code" href="?c=HELP" data-cmd="HELP">HELP</a> for every command.</p>';

// The "Did you mean" screen: one clickable row per command or symbol (at most 3, never
// the words typed), keys 1 to 3. extra: what goes under the rows (screens/nosuch.js:
// a tombstone, IPO IT, "Tell us."); HELP is always the last line.
export function didYouMeanHtml(typed, found = {}, ticker = null, { extra = '' } = {}) {
  const rows = dymRows(found, typed, ticker);
  const lead = ticker
    ? `No ticker called <span class="code">${escapeHtml(ticker)}</span>.`
    : `Nothing called <span class="code">${escapeHtml(typed)}</span>.`;
  const list = rows.length
    ? `<h3 class="hs-h">Did you mean</h3><ol class="hc-list dym-list">${rows.map(([cmd, what], i) => `<li class="hc-row hc-row-fn"><a class="hc-name code" href="${toQuery(cmd)}" data-cmd="${escapeHtml(cmd)}" data-key="${i + 1}">${escapeHtml(cmd)}</a><span class="hc-sum">${escapeHtml(what || '')}</span></li>`).join('')}</ol>`
    : '';
  return `<p class="notice">${lead}</p>${list}${extra}${HELP_LINE}`;
}

function boot() {
  // One terminal per page, even if a second copy of this module were ever loaded.
  if (window.__bbBooted) return;
  window.__bbBooted = true;
  setStyleOrder(SHEET_ORDER); // before the first screen asks for its stylesheets
  const $ = (id) => document.getElementById(id);
  const form = $('cmd-form');
  const input = $('cmd');
  const cursor = $('cursor');
  const measure = $('measure');
  const list = $('suggest');
  const screen = $('screen');
  const tapeBar = $('tape-bar');
  const statusMsg = $('status-msg');
  const keybar = $('keybar');
  const titleEl = $('screen-title');
  const freshEl = $('fresh-dot');
  const tickerBar = $('tickerbar');
  const headStar = $('head-star');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (window.matchMedia('(max-width: 639px)').matches) input.placeholder = 'Try AAPL or FX 500 USD THB';

  // Embed mode: this page is a DESK panel. No header, tape, key bar or boot log; clicks
  // open in the same panel, and the desk (the parent page) hears about every command.
  const embed = isEmbedSearch(location.search) || document.documentElement.classList.contains('is-embed');
  if (embed) document.documentElement.classList.add('is-embed');
  const toParent = (msg) => { if (embed && window.parent !== window) window.parent.postMessage(msg, location.origin); };
  let embedVisible = true;
  let embedLinked = false;
  let currentCmd = '';
  // A screen (DESK) can take typed commands before they run here.
  let commandHook = null;

  let cmdHistory = store.get('bb.history', []);
  let histIndex = cmdHistory.length;

  // --- rolling hints: "Try GRAVEYARD"... in the empty bar, until 3 commands have run --
  // Paused while typing, and on a phone while the bar has focus (hints.js).
  let hints = null;
  let tried = triedCount();
  if (!embed && !hintsDone({ historyLength: cmdHistory.length })) {
    hints = startHints({ input, paused: () => input.value !== '' || (coarse && document.activeElement === input), reduced: () => reduceMotion.matches });
  }
  function noteTried() {
    if (!hints) return;
    tried = countTried(undefined, tried);
    if (tried >= HINT_STOP) { hints.stop(); hints = null; }
  }
  // --- the first HOME after the welcome card: the command bar glows once (welcome.css) --
  let glowNext = false;
  function glowOnce() {
    glowNext = false;
    const bar = form.closest('.commandbar') || form;
    bar.classList.remove('cmd-glow');
    void bar.offsetWidth; // restart the animation
    bar.classList.add('cmd-glow');
    setTimeout(() => bar.classList.remove('cmd-glow'), 1100);
  }
  let draft = '';
  // Tab cycling: the text Tab started from, the list it showed then, and the press count.
  let linkAsk = null; // a link waiting for Enter or Esc: { run, bar } (offerLink below)
  let tabbing = false;
  let tabIndex = 0;
  let tabBase = '';
  let tabList = [];
  let active = -1;
  let cleanups = [];
  let screenAbort = null;

  // --- status line ------------------------------------------------------------
  // A note that stays at the front of the status line for this screen (the resolver's
  // "Showing NVDA (from 'nvidia')"); render() clears it.
  let statusNote = '';
  function setStatus(text, kind = '') {
    const t = String(text).toUpperCase();
    statusMsg.textContent = statusNote && t ? `${statusNote} · ${t}` : (statusNote || t);
    statusMsg.dataset.kind = kind;
  }
  // The data on screen was updated: the dot by the clock says fresh or stale, the time
  // goes in its tooltip, and a LOADING... left in the status line clears.
  function setFresh(state, title = '') {
    freshEl.dataset.state = state;
    freshEl.title = title;
    freshEl.setAttribute('aria-label', title || 'No data on this screen');
  }
  let fresh = null; // { iso, stale, at, every } for the screen on show
  // --- Provenance: the envelopes of this screen's answers (lib/provenance.js), one per
  // URL, newest kept. The dot's tooltip names the worst; a click lists them all.
  const provs = new Map();
  let provGen = 0;
  function noteProv(url, body) {
    if (!body?.provenance) return;
    provs.set(String(url).split('&_=')[0], { ...body.provenance, receivedAt: Date.now(), stale: Boolean(body.stale) });
    if (provs.size > 40) provs.delete(provs.keys().next().value);
    paintFresh();
  }
  function paintFresh(now = Date.now()) {
    const list = [...provs.values()];
    if (!fresh && !list.length) return;
    const stale = fresh ? fresh.stale || freshOverdue(fresh, now) : list.some((p) => p.stale);
    const dot = freshDot(fresh?.iso, stale);
    setFresh(dot.state, list.length ? dotTitle(list, { stale, now }) : dot.title);
    if (!provPop.hidden) provPop.innerHTML = popoverHtml(list, { now, toQuery });
  }
  // The dot is a button: a click (or Enter) opens the list of sources, Esc or a click
  // elsewhere closes it.
  const provPop = document.createElement('div');
  provPop.id = 'prov-pop';
  provPop.className = 'prov-pop';
  provPop.hidden = true;
  provPop.setAttribute('role', 'dialog');
  provPop.setAttribute('aria-label', 'Where this screen\'s data comes from');
  document.body.appendChild(provPop);
  freshEl.setAttribute('role', 'button');
  freshEl.tabIndex = 0;
  freshEl.setAttribute('aria-haspopup', 'dialog');
  function closeProv() { provPop.hidden = true; freshEl.setAttribute('aria-expanded', 'false'); }
  function toggleProv() {
    if (!provPop.hidden) { closeProv(); return; }
    const list = [...provs.values()];
    provPop.innerHTML = list.length ? popoverHtml(list, { toQuery }) : `<a class="pv-all" href="${toQuery('DATA')}" data-cmd="DATA">All sources: DATA</a>`;
    const r = freshEl.getBoundingClientRect();
    provPop.style.top = `${Math.round(r.bottom + 6)}px`;
    provPop.hidden = false;
    // Right edge by the dot, but always whole on screen (a phone is narrow).
    const w = provPop.offsetWidth;
    provPop.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right + 8 - w)))}px`;
    freshEl.setAttribute('aria-expanded', 'true');
  }
  freshEl.addEventListener('click', (e) => { e.stopPropagation(); toggleProv(); });
  freshEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleProv(); } });
  document.addEventListener('click', (e) => { if (!provPop.hidden && !provPop.contains(e.target) && !freshEl.contains(e.target)) closeProv(); }, true);
  provPop.addEventListener('click', () => setTimeout(closeProv, 0));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !provPop.hidden) { closeProv(); freshEl.focus(); } });
  // --- end Provenance ---
  function setUpdated(iso, stale) {
    const now = Date.now();
    const gap = fresh?.at ? now - fresh.at : 0;
    fresh = { iso, stale: Boolean(stale), at: now, every: gap > 1000 ? gap : fresh?.every || 0 };
    paintFresh(now);
    if (statusMsg.textContent === 'LOADING...' || statusMsg.textContent === `${statusNote} · LOADING...`) setStatus('');
    toParent({ type: 'bb:updated', iso: String(iso || ''), stale: Boolean(stale) });
  }

  // --- function keys ----------------------------------------------------------
  keybar.innerHTML = keybarHtml();
  const fkeysEl = keybar.querySelector('.fkeys');
  edgeFade(fkeysEl);
  edgeFade(tickerBar);

  function setKeys(name) {
    keybar.querySelectorAll('.fkeys .fkey').forEach((k) => {
      const on = k.dataset.name === name;
      k.classList.toggle('is-active', on);
      if (on) {
        k.setAttribute('aria-current', 'page');
        if (fkeysEl.scrollWidth > fkeysEl.clientWidth) fkeysEl.scrollLeft = k.offsetLeft - (fkeysEl.clientWidth - k.offsetWidth) / 2;
      } else {
        k.removeAttribute('aria-current');
      }
    });
  }

  // --- menu (Ctrl+K) -----------------------------------------------------------
  const menu = embed ? null : createMenu({ onClose: () => { if (!coarse) input.focus(); } });
  $('menu-btn').addEventListener('click', (e) => { e.stopPropagation(); menu?.open(); });
  window.addEventListener('bb:run', (e) => run(String(e.detail || ''), { typed: true }));

  // --- the screen's name, at the left of the command bar -------------------------------
  function setLabel(title) {
    titleEl.textContent = title;
    titleEl.title = title;
    requestAnimationFrame(() => form.style.setProperty('--label-w', `${titleEl.parentElement.offsetWidth}px`));
  }

  // --- back: history entries carry their depth, so Esc only goes back with somewhere to go
  const depth = () => Number(window.history.state?.d) || 0;
  function goBack() { if (depth() > 0) window.history.back(); }

  // --- panel numbers: on a screen without a stock function bar, a number and Enter open
  // that numbered panel over the whole screen area; Esc or the same number again returns.
  let maxPanel = null;
  function unmaximize() {
    if (!maxPanel) return false;
    maxPanel.classList.remove('is-max');
    maxPanel.style.removeProperty('--max-top');
    document.body.classList.remove('has-max-panel');
    maxPanel = null;
    window.dispatchEvent(new Event('resize'));
    return true;
  }
  function maximize(n) {
    const target = panelByNumber(screen, n);
    if (!target) return false;
    const same = target === maxPanel;
    unmaximize();
    if (same) return true;
    maxPanel = target;
    target.style.setProperty('--max-top', `${Math.round(screen.getBoundingClientRect().top + (window.innerWidth >= 1100 ? 0 : window.scrollY))}px`);
    target.classList.add('is-max');
    document.body.classList.add('has-max-panel');
    window.dispatchEvent(new Event('resize'));
    return true;
  }

  // --- one watch star, by the title of a stock screen ----------------------------
  let starTicker = null;
  function paintStar() {
    const on = Boolean(starTicker) && loadWatchlist(store).includes(starTicker);
    headStar.classList.toggle('is-on', on);
    headStar.setAttribute('aria-pressed', String(on));
    headStar.querySelector('.star-icon').textContent = on ? '\u2605' : '\u2606';
    const text = on ? `Remove ${starTicker} from the watchlist` : `Add ${starTicker} to the watchlist`;
    headStar.title = text;
    headStar.querySelector('.offscreen').textContent = text;
  }
  headStar.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!starTicker) return;
    const next = toggleId(loadWatchlist(store), starTicker);
    saveWatchlist(store, next);
    paintStar();
    const on = next.includes(starTicker);
    setStatus(on ? `${starTicker} ADDED TO THE WATCHLIST` : `${starTicker} REMOVED FROM THE WATCHLIST`);
    if (!coarse) input.focus();
  });

  // --- ticker tape: off by default, TAPE ON puts it above the status line ------------
  let stopTape = null;
  // The standard tape, or a Pro user's own list.
  const loadTapeList = async () => {
    const own = getTape();
    return own ? loadTapeRows(own, fetchJSON) : tapeItems(await fetchJSON('/api/markets'));
  };
  function applyTape(on) {
    if (embed) return;
    tapeBar.hidden = !on;
    document.body.classList.toggle('has-tape', on);
    if (on && !stopTape) stopTape = mountTape(tapeBar.querySelector('.tape-track'), { load: loadTapeList, live: liveTimer, toQuery, escape: escapeHtml });
    if (!on && stopTape) { stopTape(); stopTape = null; }
    window.dispatchEvent(new Event('resize')); // DESK refits to the new dock height
  }

  // --- Pro structure: SEAT 00042 by the name, and the sponsor line (never for Pro) ------
  // The seat comes from the server with the licence status; it is only ever shown.
  const seatEl = $('seat');
  const sponsorEl = $('status-sponsor');
  let sponsorCfg = null;
  let strip = null; // the rotating sponsor strip (sponsor-strip.js)
  let shown = null; // BBRK: lines shown, sent in batches
  let stripKey = '';
  function paintPro() {
    const seat = embed ? null : getSeat();
    if (seatEl) {
      seatEl.innerHTML = seat ? seatHtml(getMe(), getStatus()?.seat) : '';
      seatEl.hidden = !seat;
      if (seat) seatEl.setAttribute('aria-label', `${getMe()?.username || seat}: ME`);
    }
    if (!sponsorEl) return;
    const items = embed ? [] : stripItems(sponsorCfg, { pro: isPro() });
    const key = JSON.stringify(items);
    if (key === stripKey) return;
    stripKey = key;
    strip?.stop();
    if (items.length) shown ||= stripShownBatch();
    strip = items.length ? mountStrip(sponsorEl, items, { reduceMotion: reduceMotion.matches, isHidden: () => document.hidden, onShow: () => shown.add(), onAnyClick: () => countOnly('strip_click') }) : null;
    if (!items.length) sponsorEl.innerHTML = '';
    sponsorEl.hidden = !items.length;
  }
  window.addEventListener('bb:pro', paintPro);
  paintPro();
  if (!embed) loadSponsors().then((cfg) => { sponsorCfg = cfg; paintPro(); });
  // --- end Pro structure ---

  // --- blinking block cursor that follows the caret -------------------------
  function placeCursor() {
    const ch = measure.getBoundingClientRect().width || 9;
    const pos = input.selectionStart ?? input.value.length;
    const x = pos * ch - input.scrollLeft;
    cursor.style.width = `${ch}px`;
    cursor.style.transform = `translateX(${Math.max(0, x)}px)`;
    cursor.classList.toggle('is-empty', input.value.length === 0);
    cursor.classList.remove('blink');
    void cursor.offsetWidth; // restart the blink so the cursor stays solid while typing
    cursor.classList.add('blink');
  }

  // --- suggestions (instant, no animation) ------------------------------------
  let items = [];
  // Symbols from the server (US stocks and ETFs), merged under the local suggestions.
  const remote = new Map();
  let remoteTimer = 0;
  let remoteAbort = null;
  function remoteQuery(text) {
    const t = text.replace(/^\s+/, '').toUpperCase().replace(/^\$/, ''); // $GO searches GO
    if (looksLikeKey(t)) return null; // a Pro key being typed never goes to search
    return /^[A-Z0-9.&/-]{2,12}$/.test(t) ? t : null;
  }
  function fetchRemote(qText) {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(async () => {
      remoteAbort?.abort();
      remoteAbort = new AbortController();
      try {
        const d = await fetchJSON(`/api/search?q=${encodeURIComponent(qText)}`, { signal: remoteAbort.signal });
        remote.set(qText, d.results || []);
        if (remote.size > 200) remote.delete(remote.keys().next().value);
        if (remoteQuery(input.value) === qText && document.activeElement === input) renderSuggest({ keepActive: true });
      } catch { /* the local suggestions stand */ }
    }, 120);
  }
  // The suggestion list for a text: the local rows, then the server's symbols once known.
  function listFor(text) {
    let out = suggest(text);
    const qText = remoteQuery(text);
    if (qText && out.every((it) => !it.usage)) {
      const dollar = /^\s*\$/.test(text);
      if (remote.has(qText)) out = [...out, ...symbolSuggestions(stockRows(remote.get(qText), dollar), out)].slice(0, 10);
      else fetchRemote(qText);
    }
    return out;
  }
  function renderSuggest({ keepActive = false } = {}) {
    items = document.activeElement === input ? listFor(input.value) : [];
    if (!keepActive) active = -1;
    if (active >= items.length) active = -1;
    const exact = items.length === 1 && !items[0].usage && items[0].value.trim() === input.value.trim().toUpperCase();
    if (!items.length || exact || !input.value.trim()) {
      closeSuggest();
      return;
    }
    list.innerHTML = items.map((s, i) => `
      <li role="option" id="sug-${i}" data-i="${i}" class="${i === active ? 'is-active' : ''}${s.usage ? ' is-usage' : ''}" aria-selected="${i === active}">
        <span class="sug-name">${escapeHtml(s.name)}</span><span class="sug-hint">${escapeHtml(s.hint)}</span>
      </li>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeSuggest() {
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    list.hidden = true;
  }

  function markActive() {
    list.querySelectorAll('li[data-i]').forEach((li) => {
      const on = Number(li.dataset.i) === active;
      li.classList.toggle('is-active', on);
      li.setAttribute('aria-selected', String(on));
    });
    if (active >= 0) input.setAttribute('aria-activedescendant', `sug-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  // A picked suggestion: commands that take words fill the bar, the rest run.
  function pick(s) {
    if (s.value.endsWith(' ')) {
      input.value = s.value;
      active = -1;
      renderSuggest();
      placeCursor();
      return;
    }
    run(s.value, { typed: true });
    if (coarse) input.blur();
  }

  // --- live refresh: pause while the tab is hidden, or the DESK panel is off screen --
  function liveTimer(fn, ms) {
    let lastRun = Date.now();
    const paused = () => document.hidden || !embedVisible;
    const go = () => { lastRun = Date.now(); fn(); };
    const id = setInterval(() => { if (!paused()) go(); }, ms);
    const onVis = () => { if (!paused() && Date.now() - lastRun >= ms) go(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('bb:resume', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('bb:resume', onVis); };
  }

  // --- running commands -----------------------------------------------------
  function runCleanups() {
    for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
    cleanups = [];
  }

  // fromUrl: the command came from the address bar (a load, Back, a shared link).
  // checked: the words were already looked up (lookUp below); note: the status line note.
  function render(raw, { fromUrl = false, checked = false, note = '' } = {}) {
    const cmd = parseCommand(raw);
    if (glowNext && cmd.name === 'HOME') glowOnce();
    // FEEDBACK says which screen you came from, in its address bar form (no keys, no codes).
    const previous = currentCmd && currentCmd !== raw ? urlFor(currentCmd).url : '';
    currentCmd = raw;
    runCleanups();
    maxPanel = null;
    document.body.classList.remove('has-max-panel');
    fresh = null;
    provs.clear(); provGen += 1; closeProv(); // Provenance: a new screen starts a new list
    setFresh('none');
    if (screenAbort) screenAbort.abort();
    screenAbort = new AbortController();
    const signal = screenAbort.signal;
    statusNote = note;

    const view = document.createElement('section');
    view.className = 'view';
    screen.replaceChildren(view);
    linkAsk = null; // any new screen drops a link's question with the line
    // DESK panels: no repeated title or "1)" numbering (embed.js).
    if (embed) cleanups.push(compactEmbed(view));
    // Words that are not a command, or a ticker nobody has checked: look them up first.
    if (!checked && !(cmd.mutates && fromUrl)) {
      const ticker = cmd.name === 'UNKNOWN' ? null : tickerToCheck(cmd);
      if (cmd.name === 'UNKNOWN' || ticker) {
        lookUp(view, raw, ticker, { fromUrl, signal });
        return;
      }
    }
    if (!embed) window.dispatchEvent(new CustomEvent('bb:screen', { detail: raw })); // DRIVE: the driver sends it
    setKeys(cmd.name === 'TICKERNEWS' ? '' : cmd.name);
    document.title = cmd.name === 'HOME' || cmd.name === 'UNKNOWN' ? DEFAULT_TITLE : `${cmd.name === 'QUOTE' ? cmd.input : fullName(cmd.input)} | Bloombroke`;
    setLabel(screenTitle(cmd).title);
    const strip = embed ? null : tickerStripFor(cmd);
    document.body.classList.toggle('has-tickerbar', Boolean(strip));
    tickerBar.hidden = !strip;
    tickerBar.innerHTML = strip ? tickerStripHtml(strip.ticker, strip.current) : '';
    if (strip) tickerBar.setAttribute('aria-label', `${strip.ticker} functions`);
    tickerBar.dispatchEvent(new Event('scroll'));
    starTicker = embed ? null : starTickerFor(cmd);
    headStar.hidden = !starTicker;
    if (starTicker) paintStar();
    if (cmd.name === 'MENU' && fromUrl) setTimeout(() => menu?.open(), 0);

    const gen = provGen;
    const ctx = {
      run, signal,
      // Provenance: every answer's envelope goes on this screen's list for the dot.
      fetchJSON: (url, opts) => fetchJSON(url, opts).then((body) => { if (gen === provGen) noteProv(url, body); return body; }), escapeHtml, toQuery, store, copy: copyText, previous,
      tickerFunctions: (t) => tickerFunctions(t),
      commands: COMMANDS, soon: SOON, fkeys: FKEYS,
      status: setStatus, updated: setUpdated,
      // No such ticker: drop the stock tab strip and the star.
      hideTickerStrip() { tickerBar.hidden = true; headStar.hidden = true; starTicker = null; document.body.classList.remove('has-tickerbar'); },
      tapeOn: () => tapeOn(store),
      loadTape: loadTapeList,
      setTape(on) { setTapeOn(store, on); applyTape(on); },
      liveTimer: (fn, ms) => { const stop = liveTimer(fn, ms); cleanups.push(stop); return stop; },
      every(fn, ms) { const id = setInterval(fn, ms); cleanups.push(() => clearInterval(id)); },
      // Like every(), but it skips while the tab is hidden and catches up when it is shown.
      live(fn, ms) { cleanups.push(liveTimer(fn, ms)); },
      onCleanup(fn) { cleanups.push(fn); },
      // DESK: embed mode, the suggestion list, the parser, typed commands, typing.
      embed, suggest, parseCommand,
      setCommandHook(fn) { commandHook = fn; cleanups.push(() => { if (commandHook === fn) commandHook = null; }); },
      typeCommand(text) {
        input.focus();
        input.value += text;
        input.setSelectionRange(input.value.length, input.value.length);
        renderSuggest();
        placeCursor();
      },
    };
    const entry = screenFor(cmd.name);
    if (cmd.mutates && fromUrl && !(cmd.name === 'DESK' && cmd.args?.preset)) {
      // A link that changes saved lists never runs by itself: ask first. (A DESK preset
      // asks on the desk itself, and only over panels of your own.)
      const [title, what] = SAVED_LIST[cmd.name] || SAVED_LIST.WATCH;
      view.innerHTML = panel('1', title, `
        <p class="notice">This link wants to change your ${what}.</p>
        <p class="muted">It runs <span class="code">${escapeHtml(cmd.input)}</span> on the list saved in this browser.</p>
        <p class="examples"><button type="button" class="pf-btn" data-cmd="${escapeHtml(cmd.input)}">RUN IT</button> <a class="code" href="${toQuery(cmd.view)}" data-cmd="${escapeHtml(cmd.view)}">No, just show ${escapeHtml(cmd.view)}</a></p>`, { cls: 'panel-solo' });
      setStatus('CONFIRM TO CHANGE YOUR SAVED LIST', 'warn');
    } else if (entry) {
      setStatus('LOADING...');
      const draw = (mod) => {
        const fn = mod.render(view, cmd, ctx);
        if (typeof fn === 'function') cleanups.push(fn);
        // A plain word that is also a stock (GOLD, M, HELP): "Stock: $GOLD" in the title strip.
        const hint = embed ? null : stockHintFor(raw, cmd);
        if (hint) cleanups.push(showStockHint(view, hint));
        // --- TRENDING: count this ticker screen (public/trending.js); not in DESK panels, not before the notice ---
        if (countsAsOpen(cmd, { embed, consentPending: consentNeeded() })) sendSeen(cmd.args.ticker);
        // --- end TRENDING ---
      };
      const styles = stylesFor(entry);
      const now = screenNow(entry);
      if (now && styles.every(cssReady)) draw(now); // seen before: draws at once
      else {
        // First use: the module and its stylesheet come in. After a moment the panel frame
        // says LOADING, so the screen is never blank for long.
        const waiting = setTimeout(() => {
          if (signal.aborted || view.childElementCount) return;
          view.classList.add('is-loading');
          view.innerHTML = panel('1', screenTitle(cmd).title, LOADING_LINE, { cls: 'panel-solo' });
        }, 80);
        loadScreen(entry, styles).then((mod) => {
          clearTimeout(waiting);
          if (signal.aborted) return;
          view.classList.remove('is-loading');
          view.replaceChildren();
          draw(mod);
        }, () => {
          clearTimeout(waiting);
          if (signal.aborted) return;
          view.classList.remove('is-loading');
          view.innerHTML = panel('1', screenTitle(cmd).title, '<p class="notice">This screen did not load. Reload the page to get the latest version.</p>', { cls: 'panel-solo' });
          setStatus('THE SCREEN DID NOT LOAD. TRY AGAIN', 'warn');
        });
      }
    } else if (cmd.name === 'RENAMED') {
      const to = cmd.args.to;
      if (fromUrl) {
        // An old shared link: open AFFORD and put it in the address bar.
        window.history.replaceState({ c: to }, '', toQuery(to));
        render(to, { fromUrl: true });
        return;
      }
      const example = to === 'AFFORD' ? 'AFFORD 1200' : to;
      view.innerHTML = panel('1', 'Renamed', `
        <p class="notice">${escapeHtml(RENAMED_NOTE)}</p>
        <p class="muted">Try <a class="code" href="${toQuery(example)}" data-cmd="${escapeHtml(example)}">${escapeHtml(example)}</a>.</p>`, { cls: 'panel-solo' });
      setStatus('BUY IS NOW AFFORD');
    } else if (cmd.name === 'SOON') {
      const s = cmd.args.soon;
      const alt = s.ticker ? `<a class="code" href="${toQuery(s.ticker)}" data-cmd="${escapeHtml(s.ticker)}">${escapeHtml(s.ticker)}</a> or ` : '';
      view.innerHTML = panel('1', s.name, `
        <p class="notice">${escapeHtml(s.name)} is coming soon.</p>
        <p class="muted">${escapeHtml(s.hint)}. For now, try ${alt}<a class="code" href="${toQuery('HELP')}" data-cmd="HELP">HELP</a>.</p>`, { cls: 'panel-solo' });
      setStatus(`${s.name}: COMING SOON`);
    } else {
      view.innerHTML = panel('1', 'Unknown command', `
        <p class="notice">Unknown command. Type <a href="${toQuery('HELP')}" data-cmd="HELP">HELP</a>.</p>
        <p class="muted">You typed <span class="code">${escapeHtml(cmd.input)}</span>. A ticker is one word, like <a class="code" href="${toQuery('AAPL')}" data-cmd="AAPL">AAPL</a> or <a class="code" href="${toQuery('BRK.B')}" data-cmd="BRK.B">BRK.B</a>.</p>`, { cls: 'panel-solo' });
      setStatus('UNKNOWN COMMAND. TYPE HELP', 'warn');
    }
  }

  // The dim "Stock: $GOLD" link in the first panel's title strip, nothing more. Screens
  // redraw their panels, so it goes back in whenever it is gone.
  function showStockHint(view, command) {
    const place = () => {
      // The first title strip: a panel's, or HELP's search bar, or the DESK bar.
      const head = view.querySelector('.panel-head, .help-search, .desk-bar');
      if (!head || head.querySelector('.stock-hint')) return;
      const a = document.createElement('a');
      a.className = 'stock-hint';
      a.href = toQuery(command);
      a.dataset.cmd = command;
      a.textContent = `Stock: ${command.split(' ')[0]}`;
      const label = head.querySelector('.panel-label');
      if (label) label.after(a); else head.append(a);
    };
    place();
    const watch = new MutationObserver(place);
    watch.observe(view, { childList: true, subtree: true });
    return () => watch.disconnect();
  }

  // --- the resolver: company names, plain words, several tickers --------------------
  const tickerOk = new Map(); // ticker -> true or false, for this page load
  async function checkTicker(t, signal) {
    if (LISTED_TICKERS.has(t)) return true;
    if (tickerOk.has(t)) return tickerOk.get(t);
    try {
      await fetchJSON(`/api/quote?s=${encodeURIComponent(t)}`, { signal });
      tickerOk.set(t, true);
      return true;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (err.status === 404 || err.status === 400) { tickerOk.set(t, false); return false; }
      return null; // offline or a data break: the screen itself says so
    }
  }
  async function searchSymbols(text, signal) {
    const q = String(text).toUpperCase().replace(/[^A-Z0-9 .&/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!q) return [];
    if (!remote.has(q)) {
      const d = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}`, { signal });
      remote.set(q, d.results || []);
    }
    return stockRows(remote.get(q));
  }
  function neutralHead(title) {
    setKeys('');
    document.title = DEFAULT_TITLE;
    setLabel(title);
    tickerBar.hidden = true;
    tickerBar.innerHTML = '';
    document.body.classList.remove('has-tickerbar');
    headStar.hidden = true;
    starTicker = null;
  }
  // Put the resolved command in the address bar in place of the typed words.
  function replaceUrl(command) {
    const { url, kept } = urlFor(command);
    if (embed) {
      window.history.replaceState({ c: kept, d: 0 }, '', `${toQuery(url)}&embed=1`);
      toParent({ type: 'bb:cmd', c: kept });
    } else {
      window.history.replaceState({ c: kept, d: depth() }, '', toQuery(url));
    }
  }
  async function lookUp(view, raw, ticker, { fromUrl, signal }) {
    const typed = tokenize(raw).join(' ');
    neutralHead(typed);
    setStatus(ticker ? 'LOADING...' : 'LOOKING IT UP...');
    // While the words are looked up (and the NO SUCH screen loads), the panel frame says
    // LOADING after a moment, so the screen is never blank for long.
    setTimeout(() => {
      if (signal.aborted || !view.isConnected || view.childElementCount) return;
      view.classList.add('is-loading');
      view.innerHTML = panel('1', typed, LOADING_LINE, { cls: 'panel-solo' });
    }, 80);
    try {
      // A ticker with a quote shows as it is (APPLE is Apple's name, not a ticker to ask about).
      if (ticker && !tickerForName(ticker)) {
        // A famous dead ticker beats a non-US quote of the same letters (LEH on Frankfurt).
        const [ok, info] = await Promise.all([checkTicker(ticker, signal), embed ? null : loadModule(NOSUCH).then((ns) => ns.noSuchInfo(ticker, { signal }), () => null)]);
        if (signal.aborted) return;
        if (ok !== false && info?.grave && info.wins) { await showDidYouMean(view, typed, {}, ticker, signal, { quote: true }); return; }
        if (ok !== false) { render(raw, { fromUrl, checked: true }); return; }
      }
      const found = await resolveInput(raw, {
        search: (text) => searchSymbols(text, signal),
        checkTicker: (t) => checkTicker(t, signal),
        stockId,
      });
      if (signal.aborted) return;
      if (found.confident) {
        replaceUrl(found.command);
        // The typed ticker itself (the symbol list vouched for it): no "Showing XLY (from 'xly')".
        const same = found.command === typed;
        render(found.command, { fromUrl, checked: true, note: same ? '' : resolvedNote(found.command, found.from) });
        return;
      }
      await showDidYouMean(view, typed, found, ticker, signal);
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted) return;
      await showDidYouMean(view, typed, {}, ticker, signal);
    }
  }
  // NO SUCH TICKER. YET.: the rows, then a tombstone for a famous dead ticker, or IPO IT
  // and "Tell us." for any other word (screens/nosuch.js).
  async function showDidYouMean(view, typed, found, ticker, signal, { quote = false } = {}) {
    const toks = tokenize(typed);
    const word = ticker || (toks.length === 1 ? toks[0] : null);
    // NO SUCH TICKER. YET. (screens/nosuch.js) loads with its stylesheet the first time.
    const ns = await loadScreen(lazy(NOSUCH), stylesFor(lazy(NOSUCH))).catch(() => null);
    if (signal?.aborted) return;
    const [info, yard] = word && !embed && ns
      ? await Promise.all([ns.noSuchInfo(word, { signal }), ns.yardPick(signal)])
      : [{ grave: null, ipo: false }, []];
    if (signal?.aborted) return;
    neutralHead(ticker || info.grave ? typed : 'Unknown command');
    const rows = dymRows(found, typed, ticker).length;
    const title = info.grave ? ns.TITLE_GONE : ticker ? (ns?.TITLE_YET || 'No such ticker') : 'Unknown command';
    const extra = embed || !ns ? '' : ns.noSuchExtra(word, info, { ticker, next: rows + 1, quote, yard: info.grave ? [] : yard });
    view.classList.remove('is-loading');
    view.innerHTML = panel('1', title, didYouMeanHtml(typed, found, ticker, { extra }), { cls: 'panel-solo', bodyCls: 'ns-page' });
    if (!embed && ns) cleanups.push(ns.wireNoSuch(view, word, info, { status: setStatus }));
    if (info.grave) setStatus(`${info.grave.ticker}: ${info.grave.what.toUpperCase()}`, 'warn');
    else setStatus(rows ? 'NOT FOUND. PICK ONE BELOW, OR TYPE HELP' : ticker ? 'NO SUCH TICKER. TYPE HELP' : 'UNKNOWN COMMAND. TYPE HELP', 'warn');
  }

  function remember(clean) {
    if (cmdHistory[cmdHistory.length - 1] !== clean) {
      cmdHistory.push(clean);
      cmdHistory = cmdHistory.slice(-50);
      store.set('bb.history', cmdHistory);
    }
  }

  // typed: the command came from the command bar (Enter or a picked suggestion), so a
  // screen that takes typed commands (DESK sends them to its focused panel) gets it first.
  function run(raw, { push = true, fromUrl = false, typed = false, drive = false } = {}) {
    const clean = tokenize(raw).join(' ') || DEFAULT_COMMAND;
    if (!drive) window.dispatchEvent(new Event('bb:own')); // DRIVE: your own command ends following
    if (!fromUrl && !drive) noteTried();
    // MENU opens the launcher over the current screen; it is not a screen of its own.
    if (menu && !fromUrl && !drive && clean === 'MENU') {
      if (push) remember(clean);
      histIndex = cmdHistory.length;
      input.value = '';
      draft = '';
      closeSuggest();
      placeCursor();
      menu.open();
      return;
    }
    // A plain number off a stock screen: the row or panel with that number (did-you-mean
    // row 2, HOME panel 3). The same number again closes the panel. Otherwise it runs.
    const n = typed && !embed && tickerBar.hidden ? panelNumberInput(clean) : null;
    if (n) {
      const item = numberedItem(screen, n);
      if (item || maximize(String(n))) {
        input.value = '';
        draft = '';
        histIndex = cmdHistory.length;
        closeSuggest();
        placeCursor();
        if (item) item.click();
        return;
      }
    }
    // LOGIN (typed or a pasted key) never goes to a DESK panel or into history with its key.
    const parsedNow = parseCommand(clean);
    const secret = parsedNow.name === 'LOGIN' || Boolean(parsedNow.secret);
    if (typed && commandHook && !secret && commandHook(clean)) {
      remember(clean);
      histIndex = cmdHistory.length;
      input.value = '';
      draft = '';
      closeSuggest();
      placeCursor();
      return;
    }
    if (embed) {
      // A panel keeps one history entry, and tells the desk what it shows now.
      const { url, kept } = urlFor(clean);
      window.history.replaceState({ c: kept, d: 0 }, '', `${toQuery(url)}&embed=1`);
      render(clean, { fromUrl });
      toParent({ type: 'bb:cmd', c: kept });
      return;
    }
    if (push) {
      // A command that changes a saved list puts its screen in the URL, not itself.
      // LOGIN, LOGOUT and TAPE put their screen there too, and LOGIN's key goes nowhere.
      const { url, kept } = urlFor(clean);
      const q = toQuery(url);
      // DRIVE: a followed screen replaces the entry and stays out of your history and bar.
      if (drive) window.history.replaceState({ c: kept, d: depth() }, '', q);
      else {
        if (location.search !== q) window.history.pushState({ c: kept, d: depth() + 1 }, '', q);
        remember(kept);
      }
    }
    if (!drive) {
      histIndex = cmdHistory.length;
      input.value = '';
      draft = '';
      closeSuggest();
      placeCursor();
    }
    render(clean, { fromUrl });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && items[active] && !items[active].usage && !list.hidden) { pick(items[active]); return; }
    const value = input.value;
    if (!value.trim()) { run(fromQuery(location.search), { push: false, fromUrl: true }); return; }
    run(value, { typed: true });
    if (coarse) input.blur();
  });

  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // an IME is composing: its keys are its own
    if (e.key === 'Tab') {
      if (!input.value.trim() && !items.length) return;
      e.preventDefault();
      // The first Tab takes the top of the list on screen (server symbols included);
      // more presses cycle through that same list, Shift+Tab backwards.
      if (!tabbing) {
        tabbing = true;
        tabBase = input.value;
        tabList = items.length ? items.slice() : listFor(tabBase);
        tabIndex = e.shiftKey ? 0 : -1;
      }
      tabIndex = e.shiftKey ? tabIndex - 1 : tabIndex + 1;
      input.value = completeFrom(tabList, tabBase, tabIndex);
      input.setSelectionRange(input.value.length, input.value.length);
      active = -1;
      renderSuggest();
      placeCursor();
      return;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) tabbing = false; // Shift+Tab keeps cycling
    // With the suggestion list open, the arrows move through it; otherwise they walk history.
    const pickable = !list.hidden && items.length && !items.every((it) => it.usage);
    if (pickable && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      active = stepActive(active, items.length, e.key === 'ArrowDown' ? 1 : -1);
      if (items[active]?.usage) active = stepActive(active, items.length, e.key === 'ArrowDown' ? 1 : -1);
      markActive();
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!cmdHistory.length) return;
      e.preventDefault();
      if (histIndex === cmdHistory.length) draft = input.value;
      histIndex = Math.max(0, histIndex - 1);
      input.value = cmdHistory[histIndex];
      closeSuggest();
      requestAnimationFrame(() => { input.setSelectionRange(input.value.length, input.value.length); placeCursor(); });
    } else if (e.key === 'ArrowDown') {
      if (histIndex >= cmdHistory.length) return;
      e.preventDefault();
      histIndex += 1;
      input.value = histIndex === cmdHistory.length ? draft : cmdHistory[histIndex];
      closeSuggest();
      requestAnimationFrame(() => { input.setSelectionRange(input.value.length, input.value.length); placeCursor(); });
    } else if (e.key === 'Escape') {
      // Esc: close the list, then clear the bar, then go back a screen.
      if (e.defaultPrevented) return;
      if (!input.value && list.hidden && unmaximize()) { e.preventDefault(); return; }
      if (escGoesBack({ inputValue: input.value, suggestOpen: !list.hidden, depth: embed ? 0 : depth() })) { e.preventDefault(); goBack(); return; }
      if (!list.hidden) closeSuggest(); else { input.value = ''; placeCursor(); }
    }
  });

  // Typed, pasted or picked text starts a new Tab cycle.
  input.addEventListener('input', () => { tabbing = false; renderSuggest(); placeCursor(); });
  ['keyup', 'click', 'select', 'scroll'].forEach((ev) => input.addEventListener(ev, placeCursor));
  input.addEventListener('focus', () => { document.body.classList.add('cmd-focused'); placeCursor(); });
  input.addEventListener('blur', () => { document.body.classList.remove('cmd-focused'); setTimeout(closeSuggest, 120); });

  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    const s = items[Number(li.dataset.i)];
    if (!s) return;
    pick(s);
  });

  // Links and buttons that carry a command run it in place.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-cmd]');
    if (el) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      // A linked panel that lists tickers (WATCH, HEATMAP) stays put: the ticker goes to
      // the other panels in its link group instead.
      if (embed && embedLinked && !TICKER_SCREENS.includes(parseCommand(currentCmd).name) && tickerOf(el.dataset.cmd, parseCommand)) {
        toParent({ type: 'bb:pick', c: tokenize(el.dataset.cmd).join(' ') });
        return;
      }
      run(el.dataset.cmd);
      if (!coarse) input.focus();
      return;
    }
    if (e.target.closest('a[href]')) return;
    // Controls on a screen (pickers, inputs, toggles) keep their own focus.
    if (e.target.closest('input, select, textarea, button, summary, [data-own-focus]')) return;
    // Keep the command bar focused, unless the user is selecting text.
    if (!coarse && !String(window.getSelection?.() || '')) input.focus();
  });

  document.addEventListener('keydown', (e) => {
    // In a DESK panel, function keys and the desk keys belong to the desk, and typing
    // goes to the desk's command bar (which sends it to this panel).
    if (embed) {
      const inField = e.target.closest?.('input, select, textarea');
      const deskKey = (e.altKey && e.key.startsWith('Arrow')) || (e.ctrlKey && (e.key === '[' || e.key === ']')) || e.key === 'Escape';
      const fkey = FKEYS.some((k) => k.key === e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (deskKey || fkey) {
        e.preventDefault();
        toParent({ type: 'bb:key', key: e.key, alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey });
        return;
      }
      if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && !/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        toParent({ type: 'bb:type', key: e.key });
        return;
      }
    }
    // A focused row (or any non-link element carrying a command) opens on Enter.
    if (e.key === 'Enter' && e.target !== input && e.target.matches?.('[data-cmd]:not(a):not(button)')) {
      e.preventDefault();
      run(e.target.dataset.cmd);
      return;
    }
    // Ctrl+K (Cmd+K on a Mac) opens the menu.
    if (isMenuKey(e) && menu) {
      e.preventDefault();
      menu.toggle();
      return;
    }
    // Function keys work everywhere. F5, F11 and F12 stay with the browser.
    const fk = fkeyFor(e);
    if (fk) {
      e.preventDefault();
      run(fk.cmd);
      if (!coarse) input.focus();
      return;
    }
    // Esc away from any text field closes a maximised panel, then goes back a screen.
    if (e.key === 'Escape' && !e.defaultPrevented && e.target !== input && !e.target.closest?.('input, select, textarea')
      && !menu?.isOpen() && unmaximize()) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && !e.defaultPrevented && e.target !== input && !e.target.closest?.('input, select, textarea')
      && escGoesBack({ menuOpen: Boolean(menu?.isOpen()), depth: embed ? 0 : depth() })) {
      e.preventDefault();
      goBack();
      return;
    }
    // A stock screen's function bar: keys 1 to 9 while the command bar is empty. On other
    // screens a digit is just typing (3988.HK); a number and Enter opens a panel (run()).
    if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && (embed || !tickerBar.hidden)
      && (e.target === input ? input.value === '' : !e.target.closest?.('input, select, textarea'))) {
      const item = (tickerBar.hidden ? screen : tickerBar).querySelector(`[data-key="${e.key}"]`);
      if (item) {
        e.preventDefault();
        item.click();
        return;
      }
    }
    // Typing anywhere goes to the command bar.
    if (document.activeElement === input || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key.length === 1 || e.key === 'Backspace') input.focus();
  });

  window.addEventListener('popstate', () => { window.dispatchEvent(new Event('bb:own')); render(urlFor(fromQuery(location.search)).url, { fromUrl: true }); });
  window.addEventListener('bb:drive-run', (e) => run(driveTarget(String(e.detail || '')), { drive: true }));

  // --- DESK panel: messages from the desk, and a click here focuses this panel --------
  if (embed) {
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const m = e.data || {};
      if (m.type === 'bb:run' && typeof m.c === 'string') run(m.c);
      else if (m.type === 'bb:link') embedLinked = Boolean(m.on);
      else if (m.type === 'bb:visible') {
        const was = embedVisible;
        embedVisible = Boolean(m.on);
        if (!was && embedVisible) window.dispatchEvent(new Event('bb:resume'));
      }
    });
    window.addEventListener('pointerdown', () => toParent({ type: 'bb:focus' }), true);
    window.addEventListener('focusin', () => toParent({ type: 'bb:focus' }));
  }

  // --- clock ----------------------------------------------------------------
  const clockEl = $('clock');
  const clockLabel = document.querySelector('.clock .label');
  const statusEl = $('market-status');
  // ME's CLOCK: the top bar clock in New York or local time. The market status and
  // every data time on screen stay New York.
  let clockPrefs = getPrefs();
  window.addEventListener('bb:prefs', () => { clockPrefs = getPrefs(); tick(); });
  function tick() {
    const now = new Date();
    const face = clockFace(now, clockPrefs, nyClock);
    clockEl.textContent = face.time;
    if (clockLabel && clockLabel.textContent !== face.label) clockLabel.textContent = face.label;
    const open = marketStatus(now) === 'OPEN';
    statusEl.dataset.open = String(open);
    statusEl.querySelector('.status-text').textContent = open ? 'MARKET OPEN' : 'MARKET CLOSED';
    paintFresh(now.getTime());
  }
  if (!embed) {
    tick();
    setInterval(tick, 1000);
    mountHereNow($('here-now'), { timer: liveTimer });
    mountChatBadge($('chat-badge'), { timer: liveTimer });
    // CHAT SOUND (ME): a soft beep when the unread count by the seat goes up.
    const badge = $('chat-badge');
    let unread = badgeCount(badge?.textContent);
    if (badge && typeof MutationObserver === 'function') {
      new MutationObserver(() => {
        const n = badgeCount(badge.textContent);
        if (n > unread) chatBeep();
        unread = n;
      }).observe(badge, { childList: true, characterData: true, subtree: true });
    }
  }
  applyTape(tapeOn(store));

  // --- share: copy the current link, confirm in the status line ---------------
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'offscreen';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }
  $('share').addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = location.origin + location.pathname + toQuery(fromQuery(location.search));
    if (await copyText(url)) setStatus('LINK COPIED');
    else setStatus('COPY THE LINK FROM THE ADDRESS BAR', 'warn');
    if (!coarse) input.focus();
  });

  // --- ALERTS: the alert watcher (public/alerts.js), once per page, never in a DESK panel
  if (!embed) {
    try {
      startAlerts({
        store, fetchJSON, status: (text) => setStatus(text), run: (c) => { run(c); if (!coarse) input.focus(); },
        statusline: statusMsg.parentElement,
      });
    } catch { /* alerts are extra: the terminal runs without them */ }
  }
  // --- end ALERTS ------------------------------------------------------------

  // One line over the screen, no buttons (it goes with the next screen).
  function showLine(text) {
    const bar = document.createElement('div');
    bar.className = 'desk-confirm link-confirm';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span class="desk-confirm-text">${escapeHtml(text)}</span>`;
    screen.prepend(bar);
  }

  // --- a link that would change something: one line over the screen, Enter or Esc ---
  function closeLinkAsk() {
    linkAsk?.bar.remove();
    linkAsk = null;
  }
  function offerLink(ask) {
    closeLinkAsk();
    const bar = document.createElement('div');
    bar.className = 'desk-confirm link-confirm';
    bar.setAttribute('role', 'alertdialog');
    bar.setAttribute('aria-label', 'This link wants to change something');
    bar.tabIndex = -1;
    bar.innerHTML = `<span class="desk-confirm-text">${escapeHtml(ask.question)}</span>
      <button type="button" class="desk-btn" data-act="yes">ENTER: ${escapeHtml(ask.verb)}</button>
      <button type="button" class="desk-btn" data-act="no">ESC: SKIP</button>`;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b) { e.preventDefault(); e.stopPropagation(); answerLink(b.dataset.act === 'yes'); }
    });
    screen.prepend(bar);
    linkAsk = { run: ask.run, url: ask.url, bar };
  }
  function answerLink(yes) {
    const r = linkAsk?.run;
    const url = linkAsk?.url;
    closeLinkAsk();
    // Not pushed: the address bar keeps the plain screen, so a reload never runs it again.
    if (yes && r) run(r, { push: false });
    else setStatus('LINK SKIPPED: NOTHING CHANGED');
    if (url) window.history.replaceState({ ...(window.history.state || {}), c: url }, '', toQuery(url));
    if (!coarse) input.focus();
  }
  // Enter on the page, the empty command bar or the line runs it; Enter on another
  // button or link does what it does. Esc skips, unless you are typing.
  document.addEventListener('keydown', (e) => {
    if (!linkAsk || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'Enter' && e.key !== 'Escape')) return;
    const t = e.target;
    if (t === input && input.value.trim()) return;
    // A held key repeating is not an answer (and must not submit the bar either).
    if (e.repeat) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Enter' && t !== input && t.closest?.('button, a, input, select, textarea, [data-cmd], [tabindex="0"]')) return;
    e.preventDefault();
    e.stopPropagation();
    answerLink(e.key === 'Enter');
  }, true);

  // --- first render ---------------------------------------------------------
  // ME's START SCREEN: a visit with no ?c= opens on it (a link's own screen always wins).
  const start = embed ? null : startCommand(location.search, getPrefs());
  const plan = embed ? { url: urlFor(fromQuery(location.search)).url, ask: null } : linkPlan(start || fromQuery(location.search));
  if (!plan.show) plan.show = plan.url;
  const initial = plan.url; // a link never runs LOGIN or TAPE ADD
  const openLink = () => {
    render(plan.show, { fromUrl: true });
    if (plan.ask) offerLink(plan.ask);
  };
  window.history.replaceState({ c: initial, d: embed ? 0 : depth() }, '', embed ? `${toQuery(initial)}&embed=1` : location.search ? toQuery(initial) : location.pathname);
  const firstVisit = !embed && !store.get('bb.booted', false);
  // First visit: the notice. Never inside a DESK panel: the desk page around it shows
  // it, and the answer is shared (same site, same storage). Words typed before or while
  // it shows run right after ACCEPT; a deep link (?c=...) waits for ACCEPT too.
  const needsNotice = !embed && consentNeeded();
  const holdLink = needsNotice && Boolean(location.search);
  if (needsNotice) loadWelcome(); // the card's chips, fetched now so they are here in time
  function notice() {
    ensureConsent().then((accepted) => {
      const typedNow = input.value.trim();
      if (accepted) glowNext = true; // the next HOME glows the bar once
      if (accepted && typedNow) run(typedNow, { typed: true });
      else if (holdLink) openLink();
      else if (accepted && parseCommand(currentCmd || DEFAULT_COMMAND).name === 'HOME') glowOnce();
      placeCursor();
    });
  }
  if (firstVisit && !location.search && !reduceMotion.matches) {
    store.set('bb.booted', true);
    setStatus('STARTING');
    bootSequence(screen, (key) => {
      if (key) input.value += key; // the key that skipped the boot log is the first letter typed
      openLink();
      if (needsNotice) notice();
    });
  } else if (holdLink) {
    neutralHead(fromQuery(location.search));
    setStatus('PRESS START TO CONTINUE');
    notice();
  } else {
    openLink();
    if (needsNotice) notice();
  }
  if (!coarse) input.focus();
  placeCursor();

  // --- after a reload for a newer build (lazy.js): the command that was cut off --------
  // Replayed once. A secret one (a key or a gift code) is never stored: a line asks for it
  // to be typed again.
  onReload(() => {
    try {
      const p = currentCmd ? parseCommand(currentCmd) : null;
      const secret = Boolean(p && (p.secret || p.name === 'LOGIN' || isSecret(currentCmd)));
      if (p) sessionStorage.setItem(REPLAY_KEY, JSON.stringify(secret ? { secret: true, at: Date.now() } : { cmd: currentCmd, at: Date.now() }));
    } catch { /* no storage: nothing to replay */ }
  });
  const replay = takeReplay();
  if (replay?.secret) showLine('Please type your command again');
  else if (replay?.cmd && replay.cmd !== plan.show && !holdLink) run(replay.cmd, { push: false });

  // --- lazy screens: fetch ahead, never run -------------------------------------------
  // Once the page is idle, the key bar's screens; on hover or focus of a key, its screen.
  const prefetchScreen = (name) => {
    const entry = screenFor(name);
    if (!entry?.js) return;
    prefetch(entry.js);
    stylesFor(entry).forEach(prefetch);
  };
  const whenIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  // The not-found screen too: a typo is the most common next screen after the keys.
  if (!embed) {
    whenIdle(() => {
      FKEYS.forEach((k) => prefetchScreen(parseCommand(k.cmd).name));
      prefetch(NOSUCH);
      stylesOf(NOSUCH).forEach(prefetch);
    }, { timeout: 5000 });
  }
  const keyAhead = (e) => { const k = e.target.closest?.('.fkey[data-name]'); if (k) prefetchScreen(k.dataset.name); };
  keybar.addEventListener('pointerover', keyAhead);
  keybar.addEventListener('focusin', keyAhead);
}

// The command a reload for a newer build cut off (see boot), taken once: { cmd } or
// { secret: true }, or null. Only from the last minute.
const REPLAY_KEY = 'bb.replay';
function takeReplay() {
  try {
    const raw = sessionStorage.getItem(REPLAY_KEY);
    sessionStorage.removeItem(REPLAY_KEY);
    const r = raw ? JSON.parse(raw) : null;
    return r && Date.now() - Number(r.at) < 60_000 ? r : null;
  } catch {
    return null;
  }
}

// First visit only: a short, fast boot log. Any key or tap skips it.
export const BOOT_LINES = [
  ['BLOOMBROKE OS v4.20', ''],
  ['connecting to markets ....... ', 'ok'],
  ['loading ticker tape ......... ', 'ok'],
  ['syncing New York clock ...... ', 'ok'],
  ['cost: free. Pro $420 a year', ''],
  ['ready.', ''],
];

function bootSequence(screen, done) {
  const view = document.createElement('section');
  view.className = 'view boot';
  view.setAttribute('aria-label', 'Starting up');
  screen.replaceChildren(view);
  const total = BOOT_LINES.reduce((n, [a, b]) => n + a.length + b.length, 0);
  const DURATION = 1150;
  const start = performance.now();
  let finished = false;
  let raf = 0;

  function paint(count) {
    let left = count;
    const html = [];
    for (const [text, ok] of BOOT_LINES) {
      if (left <= 0) break;
      const t = text.slice(0, left);
      left -= t.length;
      const o = left > 0 ? ok.slice(0, left) : '';
      left -= o.length;
      html.push(`<p class="boot-line">${escapeHtml(t)}${o ? `<span class="boot-ok">${escapeHtml(o)}</span>` : ''}</p>`);
    }
    view.innerHTML = html.join('') + '<span class="boot-cursor" aria-hidden="true"></span><p class="boot-skip">Press any key to skip</p>';
  }

  let key = '';
  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', finish, true);
    if (view.isConnected) done(key);
  }
  // A letter that skips the log is kept: it is the start of a command.
  function onKey(e) {
    if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); key = e.key; }
    finish();
  }

  function frame(now) {
    if (!view.isConnected) { finish(); return; }
    const p = Math.min(1, (now - start) / DURATION);
    paint(Math.ceil(p * total));
    if (p < 1) raf = requestAnimationFrame(frame);
    else setTimeout(finish, 180);
  }

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', finish, true);
  raf = requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
