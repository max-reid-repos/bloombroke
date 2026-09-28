// The words each screen takes, read at startup. The router (app.js, commands*.js) needs
// every command's parse(args) at once, to route, fill the URL and show the usage line
// while typing, but a screen's module comes in only when the screen opens (lazy.js). So
// the parsers live here, small and with no screen code, and each screen module
// re-exports its own (screens/sectors.js exports parse and toInput from here), so tests
// and callers still find them on the screen.
//
// Each section is one screen; its comments are the screen's own.

import { PRESETS, nyToday } from './ranges.js';
import { instrumentById, resolveInstrument } from './instruments.js';
import { ALIASES } from './registry.js';
import { tickerForName, LISTED_TICKERS, stockIdOf } from './known-tickers.js';
import { editDistance } from './resolve.js';
import * as pro from './pro.js';
import { parseTapeSwitch } from './tape.js';

// ---- PROFILE, and the one-ticker company screens (DIVIDENDS, INSIDERS, OWNERS, SHORTS,
// BEATS, VALUE, WHY) ------------------------------------------------------------------
const TICKER = /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

export function parseTicker(args) {
  return args.length === 1 && TICKER.test(args[0]) ? { ticker: args[0] } : { error: 'usage' };
}

// ---- HELP ----------------------------------------------------------------------------
// HELP [topic]: the words after HELP.
export function parseHelp(args) {
  return { topic: args.length ? args.join(' ') : null };
}

// ---- NEWS <ticker> (TICKERNEWS) ----------------------------------------------------------
// NEWS <ticker>. Returns null for plain NEWS so the market-wide screen handles it.
export function parseTickerNews(args) {
  if (!args.length) return null;
  return args.length === 1 && TICKER.test(args[0]) ? { ticker: args[0] } : { error: 'usage' };
}

// ---- COMPARE -------------------------------------------------------------------------
// The standard daily range set (1M to MAX); intraday ranges are not compared.
export const COMPARE_RANGES = PRESETS.filter((r) => r !== '1D' && r !== '5D');
export const MAX_TICKERS = 5;

// COMPARE AAPL MSFT NVDA [1Y]
export function parseCompare(args) {
  const toks = args.flatMap((t) => t.split(',')).filter((t) => t && t !== 'VS' && t !== 'AND');
  let range = '1Y';
  if (toks.length && COMPARE_RANGES.includes(toks[toks.length - 1])) range = toks.pop();
  const tickers = [...new Set(toks)];
  if (tickers.length < 2 || tickers.length > MAX_TICKERS || !tickers.every((t) => TICKER.test(t))) return { error: 'usage' };
  return { tickers, range };
}

// ---- HISTORY -------------------------------------------------------------------------
const RATE = /^(US(2|10|30)Y)$/;

// Daily rows: no 1D (one row) and no MAX (the source keeps 10 years).
export const HISTORY_RANGES = ['5D', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y'];

function isDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

// "2024" -> start or end of that year; "2024-03-01" as is.
function dayTok(tok, end) {
  if (/^\d{4}$/.test(tok)) return end ? `${tok}-12-31` : `${tok}-01-01`;
  return isDay(tok) ? tok : null;
}

// The first day a preset range covers, counted back from today (New York).
export function presetFrom(range, today = nyToday()) {
  const [y, m, d] = today.split('-').map(Number);
  const back = (years, months, days) => {
    const t = new Date(Date.UTC(y - years, m - 1 - months, d - days));
    // Feb 29 minus a year, or Mar 31 minus a month: step back to the month's last day.
    if (!days && t.getUTCDate() !== d) t.setUTCDate(0);
    return t.toISOString().slice(0, 10);
  };
  switch (range) {
    case '5D': return back(0, 0, 7);
    case '1M': return back(0, 1, 0);
    case '3M': return back(0, 3, 0);
    case '6M': return back(0, 6, 0);
    case 'YTD': return `${y}-01-01`;
    case '1Y': return back(1, 0, 0);
    case '2Y': return back(2, 0, 0);
    case '5Y': return back(5, 0, 0);
    case '10Y': return back(10, 0, 0);
    default: return null;
  }
}

// HISTORY <ticker> [<range> | <from> [<to>]]
export function parseHistory(args, today = nyToday()) {
  const toks = args.filter((t) => t !== 'FROM' && t !== 'TO');
  if (!toks.length || toks.length > 3 || !(TICKER.test(toks[0]) || RATE.test(toks[0]))) return { error: 'usage' };
  const out = { ticker: toks[0] };
  if (toks.length === 2 && HISTORY_RANGES.includes(toks[1])) {
    if (toks[1] === '1Y') return out;
    return { ...out, range: toks[1], from: presetFrom(toks[1], today) };
  }
  if (toks[1]) { out.from = dayTok(toks[1], false); if (!out.from) return { error: 'usage' }; }
  if (toks[2]) { out.to = dayTok(toks[2], true); if (!out.to) return { error: 'usage' }; }
  if (out.from && !toks[2] && /^\d{4}$/.test(toks[1])) out.to = `${toks[1]}-12-31`;
  if (out.from && out.to && out.from > out.to) return { error: 'usage' };
  return out;
}

// ---- BONDS ---------------------------------------------------------------------------
export const BOND_TABS = ['YIELDS', 'SPREADS', 'CURVE'];

export function parseBonds(args) {
  if (!args.length) return { tab: 'YIELDS' };
  if (args.length === 1 && BOND_TABS.includes(args[0])) return { tab: args[0] };
  return { error: 'usage', tab: 'YIELDS' };
}

// ---- FXMATRIX ------------------------------------------------------------------------
export const FXM_MODES = ['RATES', 'HEAT'];

export function parseFxMatrix(args) {
  if (!args.length) return { mode: 'RATES' };
  if (args.length === 1 && FXM_MODES.includes(args[0])) return { mode: args[0] };
  return { error: 'usage', mode: 'RATES' };
}

// ---- EARNINGS ------------------------------------------------------------------------
const WORDS = { TODAY: 0, TOMORROW: 1, YESTERDAY: -1 };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// EARNINGS [TODAY|TOMORROW|YESTERDAY|WEEK|NEXT WEEK|YYYY-MM-DD] [WEEK]
export function parseEarnings(args) {
  const toks = args.filter((t) => t !== 'ON' && t !== 'FOR' && t !== 'THIS');
  let week = false;
  let day = 'TODAY';
  if (toks[0] === 'NEXT' && toks[1] === 'WEEK' && toks.length === 2) return { day: '+7', week: true };
  const rest = toks.filter((t) => { if (t === 'WEEK') { week = true; return false; } return true; });
  if (rest.length > 1) return { error: 'usage' };
  if (rest.length === 1) {
    if (rest[0] in WORDS) day = rest[0];
    else if (ISO.test(rest[0]) && !Number.isNaN(Date.parse(`${rest[0]}T12:00:00Z`)) && new Date(`${rest[0]}T12:00:00Z`).toISOString().startsWith(rest[0])) day = rest[0];
    else return { error: 'usage' };
  }
  return { day, week };
}

// ---- CALENDAR ------------------------------------------------------------------------
export function parseCalendar(args) {
  if (!args.length) return { scope: 'MAJOR' };
  const t = args.join(' ');
  if (t === 'ALL') return { scope: 'ALL' };
  if (t === 'US' || t === 'USD') return { scope: 'US' };
  return { error: 'usage' };
}

// ---- EXDIV ---------------------------------------------------------------------------
export function parseExdiv(args) {
  if (!args.length) return { day: null };
  if (args.length === 1 && ISO.test(args[0]) && new Date(`${args[0]}T12:00:00Z`).toISOString().startsWith(args[0])) return { day: args[0] };
  return { error: 'usage' };
}

// ---- FILINGS -------------------------------------------------------------------------
export const FORMS = ['KEY', '10-K', '10-Q', '8-K', '4', 'ALL'];
const FORM_ALIASES = { '10K': '10-K', '10Q': '10-Q', '8K': '8-K', FORM4: '4', ANNUAL: '10-K', QUARTERLY: '10-Q', INSIDER: '4', MAIN: 'KEY' };

export function parseFilings(args) {
  if (!args.length || args.length > 2 || !TICKER.test(args[0])) return { error: 'usage' };
  const form = args[1] ? (FORM_ALIASES[args[1]] || args[1]) : 'KEY';
  if (!FORMS.includes(form)) return { error: 'usage' };
  return { ticker: args[0], form };
}

export function filingsInputOf(args) {
  return ['FILINGS', args.ticker, ...(args.form && args.form !== 'KEY' ? [args.form] : [])].join(' ');
}

// ---- LOAN and COMPOUND ---------------------------------------------------------------
export const MAX_LOAN = 1e10;

// "400000", "$400,000", "400K", "1.2M" -> number, or NaN.
export function parseMoney(tok) {
  const m = /^\$?([\d,]*\.?\d+)([KM])?$/.exec(String(tok));
  if (!m) return NaN;
  const n = Number(m[1].replace(/,/g, '')) * (m[2] === 'K' ? 1e3 : m[2] === 'M' ? 1e6 : 1);
  return Number.isFinite(n) ? n : NaN;
}

// "30Y", "30YR", "30 YEARS" (two tokens) -> years.
export function takeYears(toks, i) {
  const m = /^(\d+(?:\.\d+)?)(Y|YR|YRS|YEAR|YEARS)$/.exec(toks[i] || '');
  if (m) return { years: Number(m[1]), used: 1 };
  if (/^\d+(\.\d+)?$/.test(toks[i] || '') && /^(Y|YR|YRS|YEARS?)$/.test(toks[i + 1] || '')) return { years: Number(toks[i]), used: 2 };
  return null;
}

// LOAN <amount> [<years>Y] [<rate>%]
export function parseLoan(args) {
  const toks = args.filter((t) => !['AT', 'FOR', 'OVER', 'RATE', 'APR'].includes(t));
  if (!toks.length) return { error: 'usage' };
  const amount = parseMoney(toks[0]);
  if (!(amount > 0) || amount > MAX_LOAN) return { error: 'amount' };
  let years = 30;
  let rate = null;
  let i = 1;
  const y = takeYears(toks, i);
  if (y) { years = y.years; i += y.used; }
  if (i < toks.length) {
    const m = /^(\d+(?:\.\d+)?)%?$/.exec(toks[i]);
    if (!m) return { error: 'usage' };
    rate = Number(m[1]);
    i += 1;
  }
  if (i !== toks.length) return { error: 'usage' };
  if (!(years >= 1 && years <= 50)) return { error: 'years' };
  if (rate !== null && !(rate >= 0 && rate <= 30)) return { error: 'rate' };
  return { amount, years, rate };
}

export function parseCompound(args) {
  const toks = args.filter((t) => !['AT', 'FOR', 'A', 'AND', 'PLUS', 'INVEST', 'SAVE'].includes(t));
  let start = 0;
  let monthly = 0;
  let yearly = 0;
  let rate = null;
  let years = null;
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    const per = /^(\$?[\d,.]+[KM]?)\/(MO|MON|MONTH|M|YR|YEAR|Y)$/.exec(t);
    const pct = /^(\d+(?:\.\d+)?)%$/.exec(t);
    const y = takeYears(toks, i);
    if (per) {
      const n = parseMoney(per[1]);
      if (!(n > 0)) return { error: 'amount' };
      if (/^(YR|YEAR|Y)$/.test(per[2])) yearly = n; else monthly = n;
      i += 1;
    } else if (pct) {
      rate = Number(pct[1]);
      i += 1;
    } else if (y) {
      years = y.years;
      i += y.used;
    } else if (Number.isFinite(parseMoney(t))) {
      const n = parseMoney(t);
      const next = toks[i + 1];
      if (next === 'MONTHLY' || (next === 'PER' && /^(MONTH|MO)$/.test(toks[i + 2] || ''))) { monthly = n; i += next === 'PER' ? 3 : 2; }
      else if (next === 'YEARLY' || (next === 'PER' && /^(YEAR|YR)$/.test(toks[i + 2] || ''))) { yearly = n; i += next === 'PER' ? 3 : 2; }
      else { if (start) return { error: 'usage' }; start = n; i += 1; }
    } else {
      return { error: 'usage' };
    }
  }
  if (!(start > 0 || monthly > 0 || yearly > 0) || rate === null || years === null) return { error: 'usage' };
  if (!(rate >= 0 && rate <= 50)) return { error: 'rate' };
  if (!(years >= 1 && years <= 80) || years % 1) return { error: 'years' };
  if ([start, monthly, yearly].some((n) => n > 1e10)) return { error: 'amount' };
  return { start, monthly, yearly, rate, years };
}

// ---- DATA (Provenance) ---------------------------------------------------------------
export function parseData(args) {
  if (args.length > 1) return { error: 'usage' };
  return args.length ? { id: String(args[0]).toLowerCase() } : {};
}

// ---- TAPE ----------------------------------------------------------------------------
// TAPE ON|OFF, or a Pro user's own list (TAPE ADD AAPL).
export function parseTapeArgs(args) {
  return parseTapeSwitch(args) || pro.parseTape(args);
}

// ---- PRO, LOGIN, REDEEM -----------------------------------------------------------------
// PRO [YEARLY|MONTHLY]: which plan the buy buttons lead with.
export function parsePro(args) {
  const w = args[0];
  if (w === 'YEARLY' || w === 'YEAR' || w === 'ANNUAL') return { plan: 'year' };
  if (w === 'MONTHLY' || w === 'MONTH') return { plan: 'month' };
  return {};
}

// REDEEM [code]
export function parseRedeem(args) {
  if (!args.length) return { show: true };
  const code = pro.normalizeGiftCode(args.join(''));
  return code ? { code } : { error: 'format' };
}

// LOGIN [key]. The key may be typed with or without dashes. A gift code pasted here
// redeems it.
export function parseLogin(args) {
  if (!args.length) return { show: true };
  const key = pro.normalizeKey(args.join(''));
  if (key) return { key };
  const gift = pro.normalizeGiftCode(args.join(''));
  return gift ? { gift } : { error: 'format' };
}

// ---- SECTORS -------------------------------------------------------------------------
export const SECTOR_PERIODS = ['1D', '1W', '1M', 'YTD', '1Y'];
export const SECTOR_VIEWS = ['TABLE', 'MAP'];

// Words after SECTORS: a period and TABLE or MAP, in any order. Anything else is ignored.
export function parseSectors(words = []) {
  let period = '1D';
  let view = 'TABLE';
  for (const w of words) {
    const u = String(w).toUpperCase();
    if (SECTOR_PERIODS.includes(u)) period = u;
    else if (SECTOR_VIEWS.includes(u)) view = u;
  }
  return { period, view };
}

// The command (and so the URL) for a period and a view: plain SECTORS for 1D TABLE.
export function sectorsCmd({ period = '1D', view = 'TABLE' } = {}) {
  return ['SECTORS', period !== '1D' ? period : '', view === 'MAP' ? 'MAP' : ''].filter(Boolean).join(' ');
}

// ---- OPTIONS -------------------------------------------------------------------------
export const OPTION_TICKER_RE = /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
// Named instruments with listed options at Cboe.
export const OPTION_INDEXES = ['SPX', 'NDX', 'RUT', 'VIX'];
const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}(-[A-Z]{1,6})?$/;

// [ticker, expiry?] -> { ticker, expiry } or { error }.
export function parseOptions(args) {
  const toks = args.filter((t) => t !== 'FOR' && t !== 'ON');
  if (!toks.length) return { error: 'usage' };
  let used = 1;
  let ticker = toks[0];
  // "S&P 500" is three words.
  for (let n = Math.min(3, toks.length); n >= 1; n -= 1) {
    const inst = resolveInstrument(toks.slice(0, n).join(''));
    if (inst) { ticker = inst.id; used = n; break; }
  }
  const inst = instrumentById(ticker);
  if (inst && !OPTION_INDEXES.includes(inst.id)) return { error: 'kind', ticker };
  if (!inst && !OPTION_TICKER_RE.test(ticker)) return { error: 'usage' };
  const rest = toks.slice(used);
  if (rest.length > 1 || (rest.length === 1 && !EXPIRY_RE.test(rest[0]))) return { error: 'expiry', ticker };
  return { ticker, expiry: rest[0] || null };
}

export function optionsToInput(args) {
  return args.error ? null : ['OPTIONS', args.ticker, args.expiry].filter(Boolean).join(' ');
}

// ---- ECONOMY -------------------------------------------------------------------------
export const ECONOMY_RANGES = ['5Y', '10Y', 'MAX'];

// [] -> the dashboard; [id] or [id, range] -> one series.
export function parseEconomy(args) {
  if (!args.length) return { id: null };
  if (args.length > 2 || !/^[A-Z0-9]{2,20}$/.test(args[0])) return { error: 'usage' };
  if (args[1] && !ECONOMY_RANGES.includes(args[1])) return { error: 'range', id: args[0] };
  return { id: args[0], range: args[1] || null };
}

export function economyToInput(args) {
  return args.error ? null : ['ECONOMY', args.id, args.range].filter(Boolean).join(' ');
}

// ---- FINANCIALS ----------------------------------------------------------------------
export const FIN_TICKER_RE = /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const STATEMENT_WORDS = {
  INCOME: 'income', IS: 'income', EARNINGS: 'income',
  BALANCE: 'balance', BS: 'balance', SHEET: 'balance',
  CASH: 'cashflow', CASHFLOW: 'cashflow', CF: 'cashflow', FLOW: 'cashflow',
};
const PERIOD_WORDS = { ANNUAL: 'annual', YEARLY: 'annual', YEARS: 'annual', QUARTERLY: 'quarterly', QUARTERS: 'quarterly', Q: 'quarterly' };
// Per-share basis: split-adjusted (the default) or as the filings reported it.
const BASIS_WORDS = { REPORTED: 'reported', ASREPORTED: 'reported', FILED: 'reported', ADJUSTED: 'adjusted', SPLIT: 'adjusted' };
const STATEMENT_CMD = { income: '', balance: 'BALANCE', cashflow: 'CASHFLOW' };

// Words after the ticker: [INCOME|BALANCE|CASHFLOW] [ANNUAL|QUARTERLY] [REPORTED], any order.
export function parseFinancialsArgs(toks) {
  const [ticker, ...rest] = toks;
  if (!ticker || !FIN_TICKER_RE.test(ticker)) return { error: 'usage' };
  let statement = 'income';
  let period = 'annual';
  let basis = 'adjusted';
  for (const t of rest) {
    if (STATEMENT_WORDS[t]) statement = STATEMENT_WORDS[t];
    else if (PERIOD_WORDS[t]) period = PERIOD_WORDS[t];
    else if (BASIS_WORDS[t]) basis = BASIS_WORDS[t];
    else if (t === 'FLOW' || t === 'SHEET' || t === 'STATEMENT' || t === 'AS') continue;
    else return { error: 'usage', ticker };
  }
  return basis === 'reported' ? { ticker, statement, period, basis } : { ticker, statement, period };
}

export function financialsInput({ ticker, statement = 'income', period = 'annual', basis = 'adjusted' }) {
  return ['FINANCIALS', ticker, STATEMENT_CMD[statement], period === 'quarterly' ? 'QUARTERLY' : '', basis === 'reported' ? 'REPORTED' : ''].filter(Boolean).join(' ');
}

export function parseFinancialsCommand(rest) {
  const args = parseFinancialsArgs(rest);
  if (args.error) return { name: 'FINANCIALS', args, error: args.error, input: ['FINANCIALS', ...rest].join(' ') };
  return { name: 'FINANCIALS', args, input: financialsInput(args) };
}

// ---- WEIRD and its gauges ----------------------------------------------------------------
export const WEIRD_PERIODS = ['3M', '1Y', '5Y', '10Y', 'MAX'];

// One typed word -> '5Y' (any case), or null when it is not a period.
export function periodWord(tok) {
  const t = String(tok ?? '').trim().toUpperCase();
  return WEIRD_PERIODS.includes(t) ? t : null;
}

// One command per gauge, in the WEIRD grid's order (screens/weird-gauges.js has each
// gauge; test/speed.test.js checks the two lists match).
export const WEIRD_GAUGE_COMMANDS = [
  'CANAL', 'PIZZA', 'DEGEN', 'WAFFLE', 'PANIC', 'HIRING', 'HOTDOG', 'OMENS', 'UNDIES', 'BIGMAC', 'BILLIONS', 'WSB',
  'CHANCES', 'BOXRATE', 'EGGPRICE', 'RIDES', 'BUZZWORD', 'BEIGE', 'TRUCKS', 'BOXES', 'LIPSTICK', 'SICK', 'MACAU',
];

// ---- FISHTANK ------------------------------------------------------------------------
// Sector key (the same keys as HEATMAP, data/sp100.js) -> legend name and species. The
// legend lists them in this order.
export const SPECIES = {
  TECH: { short: 'TECH', kind: 'swordfish' },
  FIN: { short: 'FIN', kind: 'shark' },
  UTIL: { short: 'UTIL', kind: 'eel' },
  ENERGY: { short: 'ENERGY', kind: 'angler' },
  COMM: { short: 'COMM', kind: 'dolphin' },
  HEALTH: { short: 'HEALTH', kind: 'jelly' },
  DISC: { short: 'DISC', kind: 'clown' },
  STAPLES: { short: 'STAPLES', kind: 'goldfish' },
  IND: { short: 'INDUS', kind: 'puffer' },
  RE: { short: 'RE', kind: 'crab' },
  MAT: { short: 'MAT', kind: 'lobster' },
};

// FISHTANK TECH (or FISHTANK INDUS, its legend name): that sector lit from the start.
// SECTORS' SWIM links here. -> { args, input } or null (plain FISHTANK).
export function parseFishtank(words = []) {
  for (const w of words) {
    const u = String(w).toUpperCase();
    const key = SPECIES[u] ? u : Object.keys(SPECIES).find((k) => SPECIES[k].short === u);
    if (key) return { args: { sector: key }, input: `FISHTANK ${key}` };
  }
  return null;
}

// ---- GRID ----------------------------------------------------------------------------
// GRID [TOKENS...] [RANGE]: your own board of up to GRID_MAX mini charts. The same
// grammar on the server (lib/grid.js reads ?s= with gridItem), so a link rebuilds the
// same board.
//   NVDA, $GOLD, OIL      a market symbol (aliases resolve: OIL is WTI); $ forces the stock
//   CPI                   US consumer prices (BLS)
//   W:PIZZA, WEIRD:EGGS   a WEIRD gauge (the prefix is needed: BUZZ is also an ETF)
//   RIP:LEH               a GRAVEYARD stone
//   BBRK                  our own site numbers
//   STARTER               the starter board, when it is the only word
// A trailing preset range (1D ... MAX) sets every market tile's range; 1Y by default.
export const GRID_MAX = 16;
export const GRID_RANGE = '1Y';
// The range chips on the board; any preset can still be typed.
export const GRID_RANGE_CHIPS = ['1M', '1Y', '5Y', 'MAX'];
// What a first visit sees, and what STARTER brings back.
export const GRID_STARTER = ['SPX', 'NDX', 'NVDA', 'TSLA', 'AAPL', 'BTC', 'ETH', 'GOLD', 'WTI', 'US10Y', 'VIX', 'CPI', 'W:PIZZA', 'W:EGGPRICE', 'RIP:LEH', 'BBRK'];
export const GRID_STARTER_WORD = 'STARTER';

// A gauge's API id, where it is not its command in lower case (W:EGGS is EGGPRICE).
const GAUGE_IDS = { EGGS: 'EGGPRICE', ODDS: 'CHANCES', BUZZ: 'BUZZWORD' };
const GRID_TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const GRID_STOCK = /^\$[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// A typed gauge name -> its command (PIZZA, PIZZINT, EGGS -> EGGPRICE), or null.
export function gaugeCommand(word) {
  const w = String(word ?? '').trim().toUpperCase();
  if (WEIRD_GAUGE_COMMANDS.includes(w)) return w;
  const alias = ALIASES[w] || GAUGE_IDS[w];
  return alias && WEIRD_GAUGE_COMMANDS.includes(alias) ? alias : null;
}

// A word that is not a tile -> the tile it most likely meant, or null: a company name
// (NVIDIA -> NVDA), a gauge without its prefix (EGGPRICE -> W:EGGPRICE), or a known
// ticker one letter off (APPL -> AAPL).
export function gridSuggest(word) {
  const w = String(word ?? '').trim().toUpperCase().replace(/^\$/, '');
  if (!w) return null;
  const named = tickerForName(w);
  if (named && named.id !== w) return named.id;
  const g = gaugeCommand(w.replace(/^(W|WEIRD):/, ''));
  if (g) return `W:${g}`;
  if (w.length >= 3 && GRID_TICKER.test(w) && !LISTED_TICKERS.has(w)) {
    for (const t of LISTED_TICKERS) if (t.length === w.length && editDistance(t, w) === 1) return t;
  }
  return null;
}

// One word -> { token, kind, ... } or null (an empty word). token is the canonical form:
// the same tile always has the same token, so duplicates drop and the URL stays clean.
// kind: market | cpi | weird | rip | bbrk | unknown (with suggest, a guess or null).
export function gridItem(raw) {
  const t = String(raw ?? '').trim().toUpperCase().slice(0, 24);
  if (!t) return null;
  const unknown = () => ({ token: t, kind: 'unknown', suggest: gridSuggest(t) });
  let m = /^(?:W|WEIRD):(.*)$/.exec(t);
  if (m) {
    const g = gaugeCommand(m[1]);
    return g ? { token: `W:${g}`, kind: 'weird', gauge: g } : unknown();
  }
  m = /^RIP:(.*)$/.exec(t);
  if (m) return /^[A-Z]{1,12}$/.test(m[1]) ? { token: `RIP:${m[1]}`, kind: 'rip', ticker: m[1] } : unknown();
  if (t === 'CPI') return { token: 'CPI', kind: 'cpi' };
  if (t === 'BBRK') return { token: 'BBRK', kind: 'bbrk' };
  // $ always means the stock: $AAPL is AAPL, $GOLD stays $GOLD (GOLD is spot gold).
  if (GRID_STOCK.test(t)) {
    const id = stockIdOf(t);
    return id ? { token: id, kind: 'market' } : unknown();
  }
  const inst = resolveInstrument(t);
  if (inst) return { token: inst.id, kind: 'market' };
  return GRID_TICKER.test(t) ? { token: t, kind: 'market' } : unknown();
}

// The words after GRID -> { items, tokens, range, rangeGiven, starter, dropped, bare }.
// starter: STARTER was the only word. bare: no words at all but maybe a range (the screen
// then opens the last board, else the starter). dropped: how many past GRID_MAX were
// left out. Never an error: a word that is no tile becomes a NO SUCH TICKER tile.
export function parseGrid(args = []) {
  const toks = args.flatMap((a) => String(a).split(',')).map((a) => a.trim().toUpperCase()).filter(Boolean);
  let range = GRID_RANGE;
  let rangeGiven = false;
  if (toks.length && PRESETS.includes(toks[toks.length - 1])) { range = toks.pop(); rangeGiven = true; }
  const starter = toks.length === 1 && toks[0] === GRID_STARTER_WORD;
  const words = starter ? GRID_STARTER : toks;
  const items = [];
  const seen = new Set();
  let dropped = 0;
  for (const w of words) {
    const it = gridItem(w);
    if (!it || seen.has(it.token)) continue;
    seen.add(it.token);
    if (items.length >= GRID_MAX) { dropped += 1; continue; }
    items.push(it);
  }
  return { items, tokens: items.map((i) => i.token), range, rangeGiven, starter, dropped, bare: !toks.length };
}

// Is this board the starter board?
export const isGridStarter = (tokens = []) => tokens.join(',') === GRID_STARTER.join(',');

// The command (and URL) for a board: GRID STARTER for the starter board, the tokens
// otherwise, then the range unless it is 1Y. GRID alone for no tokens.
export function gridCmd({ tokens = [], range = GRID_RANGE } = {}) {
  const words = tokens.length && isGridStarter(tokens) ? [GRID_STARTER_WORD] : tokens;
  return ['GRID', ...words, range !== GRID_RANGE ? range : ''].filter(Boolean).join(' ');
}
