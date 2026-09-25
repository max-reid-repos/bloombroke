// AFFORD's words: AFFORD <price> [<label>] [<how often>] [FOR <how long>]. Shared by the
// router (app.js) and the share card (lib/og.js). Pure.
//
//   AFFORD 1200                              once a week for 3 years (the defaults)
//   AFFORD 1200 BIKE 2 PER WEEK              label "Bike", twice a week
//   AFFORD $1,200 TWICE A WEEK
//   AFFORD 1200 2X WEEK
//   AFFORD 1200 3 TIMES A MONTH FOR 2 YEARS
//   AFFORD 90 DAILY FOR 18M
//
// AFFORD is for things people buy. Only a word that really names an investment (a
// cashtag, a word like SHARES or ETF, a big ticker, a market like GOLD or BITCOIN) gets
// { error: 'investment' }; any other word is the thing being bought, and the first one
// is kept as a label.

import { matchInstrument } from './instruments.js';
import { KNOWN_TICKERS } from './known-tickers.js';

export const BUY_UNITS = { DAY: 365, WEEK: 52, MONTH: 12, YEAR: 1 };
export const BUY_DEFAULTS = { times: 1, unit: 'WEEK', years: 3 };
export const AFFORD_EXAMPLE = 'AFFORD 1200 2 PER WEEK FOR 3Y';
const MAX_AMOUNT = 1e12;

const UNIT_WORDS = {
  DAY: 'DAY', DAYS: 'DAY', WEEK: 'WEEK', WEEKS: 'WEEK', WK: 'WEEK', WKS: 'WEEK', MONTH: 'MONTH', MONTHS: 'MONTH', MO: 'MONTH', MOS: 'MONTH',
  YEAR: 'YEAR', YEARS: 'YEAR', YR: 'YEAR', YRS: 'YEAR',
};
const ADVERBS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', YEARLY: 'YEAR', ANNUALLY: 'YEAR' };
const COUNT_WORDS = { ONCE: 1, TWICE: 2, THRICE: 3 };
const LINKS = new Set(['PER', 'A', 'AN', 'EVERY', 'EACH', 'EVERYDAY']);
const MULTIPLY = new Set(['X', 'TIMES', 'TIME']);
const SKIP = new Set(['AT', 'USD', 'DOLLARS', 'DOLLAR', 'BUCKS', '$', 'I', 'IT', 'USE', 'USED', 'USING', 'ABOUT', 'AROUND']);
const DURATION = new Set(['FOR', 'OVER', 'LASTS', 'LASTING']);

export const INVESTMENT_WORDS = new Set([
  'SHARE', 'SHARES', 'STOCK', 'STOCKS', 'EQUITY', 'EQUITIES', 'ETF', 'ETFS', 'FUND', 'FUNDS', 'BOND', 'BONDS', 'TREASURY', 'TREASURIES',
  'COIN', 'COINS', 'TOKEN', 'TOKENS', 'CRYPTO', 'OPTION', 'OPTIONS', 'CALL', 'CALLS', 'PUT', 'PUTS', 'FUTURE', 'FUTURES', 'CFD', 'CFDS',
  'FOREX', 'FX', 'INDEX', 'REIT', 'REITS', 'PORTFOLIO', 'INVEST', 'INVESTMENT', 'TICKER', 'NFT', 'NFTS',
]);

// Market names that are also everyday things (a coffee, a turkey, gas for the car).
const EVERYDAY = new Set([
  'COFFEE', 'SUGAR', 'CORN', 'WHEAT', 'COCOA', 'SOY', 'SOYBEAN', 'SOYBEANS', 'GASOLINE', 'PETROL', 'GAS', 'CATTLE', 'LIVECATTLE',
  'TURKEY', 'VIETNAM', 'ARGENTINA', 'THAILAND', 'SET', 'BALTIC', 'TRANSPORTS', 'SEMIS', 'VOLATILITY', 'EURO', 'POUND', 'YEN', 'BAHT', 'FRANC',
  'AVALANCHE', 'TRON', 'STELLAR', 'TETHER',
]);

const GRAMMAR = new Set([...Object.keys(UNIT_WORDS), ...Object.keys(ADVERBS), ...Object.keys(COUNT_WORDS), ...LINKS, ...MULTIPLY, ...SKIP, ...DURATION]);
const YEARS_RE = /^(\d+(?:\.\d+)?)(Y|YR|YRS|YEARS?|M|MO|MOS|MONTHS?)$/;
const looksNumeric = (tok) => /^\$?[\d.,]+$/.test(tok);

// Amounts: digits, commas and one dot. A number, or NaN.
function amount(tok) {
  const s = String(tok).replace(/^\$/, '');
  if (!/^[\d,]*\.?\d*$/.test(s) || !/\d/.test(s)) return NaN;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n <= MAX_AMOUNT ? n : NaN;
}

// A word that names an investment: an investment word, a cashtag ($AAPL), a big ticker
// (AAPL, SPY) or a market (GOLD, BITCOIN, EURUSD). BIKE or LAPTOP is a thing you buy.
export function isInvestmentWord(tok) {
  const raw = String(tok).toUpperCase();
  if (/^\$[A-Z]/.test(raw)) return true;
  const t = raw.replace(/^\$/, '');
  if (!/[A-Z]/.test(t) || GRAMMAR.has(t) || EVERYDAY.has(t)) return false;
  if (YEARS_RE.test(t) || /^\d+(\.\d+)?X$/.test(t)) return false;
  return INVESTMENT_WORDS.has(t) || INVESTMENT_WORDS.has(t.replace(/S$/, '')) || KNOWN_TICKERS.has(t) || Boolean(matchInstrument([t]));
}

// "2X" -> 2 X, "2/WEEK" -> 2 PER WEEK, "$1,200" stays one word.
function splitTokens(args) {
  const out = [];
  for (const a of args) {
    const t = String(a).toUpperCase();
    let m;
    if ((m = /^(\d+(?:\.\d+)?)X(?:\/(\w+))?$/.exec(t))) out.push(m[1], 'X', ...(m[2] ? ['PER', m[2]] : []));
    else if ((m = /^(\d+(?:\.\d+)?)?\/(\w+)$/.exec(t))) out.push(...(m[1] ? [m[1]] : []), 'PER', m[2]);
    else out.push(t);
  }
  return out;
}

// "3Y", "3", "18M", "2.5YRS" (with the next word as a unit) -> { years, used }.
function parseYears(tok, next) {
  const m = /^(\d+(?:\.\d+)?)(Y|YR|YRS|YEARS?|M|MO|MOS|MONTHS?)?$/.exec(tok || '');
  if (!m) return { years: NaN, used: 1 };
  let unit = m[2];
  let used = 1;
  if (!unit && next && /^(Y|YR|YRS|YEARS?|MO|MOS|MONTHS?)$/.test(next)) { unit = next; used = 2; }
  const n = Number(m[1]);
  return { years: unit && unit.startsWith('M') ? n / 12 : n, used, unit: unit || null };
}

const titleCase = (w) => w.charAt(0) + w.slice(1).toLowerCase();

// Words after AFFORD -> { price, times, unit, years, label? } or { error }.
// Errors: investment, usage (with no price: nothing to go on), amount, times, years.
export function parseAffordArgs(args) {
  if (args.some(isInvestmentWord)) return { error: 'investment' };
  const all = splitTokens(args);
  const labels = all.filter((t) => /[A-Z]/.test(t) && !GRAMMAR.has(t) && !YEARS_RE.test(t));
  const toks = all.filter((t) => !labels.includes(t) && !SKIP.has(t));
  if (!toks.length || !looksNumeric(toks[0])) return { error: 'usage' };
  const price = amount(toks[0]);
  if (!Number.isFinite(price) || price <= 0) return { error: 'amount' };
  let { times, unit, years } = BUY_DEFAULTS;
  let haveOften = false;
  let haveYears = false;
  let i = 1;
  // After a count: [X|TIMES] [PER|A|EVERY] <unit>, or an adverb (2 TIMES WEEKLY).
  const unitAfter = (j) => {
    while (MULTIPLY.has(toks[j])) j += 1;
    if (ADVERBS[toks[j]]) return { unit: ADVERBS[toks[j]], next: j + 1 };
    while (LINKS.has(toks[j])) j += 1;
    return UNIT_WORDS[toks[j]] ? { unit: UNIT_WORDS[toks[j]], next: j + 1 } : null;
  };
  while (i < toks.length) {
    const t = toks[i];
    if (DURATION.has(t)) {
      if (haveYears) return { error: 'usage' };
      const y = parseYears(toks[i + 1], toks[i + 2]);
      if (!Number.isFinite(y.years)) return { error: 'usage' };
      years = y.years;
      haveYears = true;
      i += 1 + y.used;
    } else if (COUNT_WORDS[t] || /^\d+(\.\d+)?$/.test(t)) {
      const n = COUNT_WORDS[t] || Number(t);
      // "2 YEARS" (a unit right after the number, no X or PER) is how long; "2 PER WEEK" how often.
      const y = COUNT_WORDS[t] ? null : parseYears(t, toks[i + 1]);
      const u = y?.unit ? null : unitAfter(i + 1);
      if (u && !haveOften) {
        times = n;
        unit = u.unit;
        haveOften = true;
        i = u.next;
      } else if (y && y.unit && !haveYears) {
        years = y.years;
        haveYears = true;
        i += y.used;
      } else {
        return { error: 'usage' };
      }
    } else if (ADVERBS[t] && !haveOften) {
      unit = ADVERBS[t];
      haveOften = true;
      i += 1;
    } else if (LINKS.has(t) && !haveOften) {
      const u = unitAfter(i);
      if (!u) return { error: 'usage' };
      unit = u.unit;
      haveOften = true;
      i = u.next;
    } else if (YEARS_RE.test(t) && !haveYears) {
      years = parseYears(t).years;
      haveYears = true;
      i += 1;
    } else {
      return { error: 'usage' };
    }
  }
  if (!(times > 0 && times <= 1000)) return { error: 'times' };
  if (!(years > 0 && years <= 100)) return { error: 'years' };
  const out = { price, times, unit, years };
  if (labels.length) out.label = titleCase(labels[0]).slice(0, 24);
  return out;
}
export const parseBuyArgs = parseAffordArgs; // the old name, for older imports

// The words back, in one standard order: AFFORD 1200 BIKE 2 PER WEEK FOR 3Y.
export function affordCommand(a) {
  const n = (x) => String(Number(x.toFixed(4)));
  const years = Number.isInteger(a.years) ? `${a.years}Y` : Number.isInteger(a.years * 12) ? `${Math.round(a.years * 12)}M` : `${n(a.years)}Y`;
  return ['AFFORD', n(a.price), a.label ? a.label.toUpperCase() : '', `${n(a.times)} PER ${a.unit}`, `FOR ${years}`].filter(Boolean).join(' ');
}
