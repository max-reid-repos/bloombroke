// Bloombroke front end: command bar, router, URL state, status line and function keys.
// Pure helpers are exported so node:test can import this file; the DOM wiring
// only runs in a browser.

import * as helpScreen from './screens/help.js';
import * as homeScreen from './screens/home.js';
import * as marketsScreen from './screens/markets.js';
import * as fxScreen from './screens/fx.js';
import * as quoteScreen from './screens/quote.js';
import * as cpiScreen from './screens/cpi.js';
import * as ratesScreen from './screens/rates.js';
import * as newsScreen from './screens/news.js';
import * as buyScreen from './screens/buy.js';
import * as whatifScreen from './screens/whatif.js';
import * as fundingScreen from './screens/funding.js';
import { fmtNum, fmtPct, dirOf, cmdForInstrument, panel } from './screens/markets.js';
import { matchInstrument, searchInstruments } from './instruments.js';
import { PRESETS, parseRangeArgs, rangeWords } from './ranges.js';
import { statusLine, freshTag } from './freshness.js';
import { EXTRA_HELP, EXTRA_SCREENS, EXTRA_TAKES_ARGS, matchExtra, urlCommand } from './commands.js';
import { getTape, loadTapeRows } from './pro.js';

export const COMMANDS = [
  { name: 'HOME', group: 'Markets', hint: 'Markets, S&P 500, currencies and news on one screen', usage: 'HOME', example: 'HOME' },
  { name: 'MARKETS', group: 'Markets', hint: 'World markets at a glance', usage: 'MARKETS', example: 'MARKETS' },
  { name: 'RATES', group: 'Markets', hint: 'The interest rates that touch your money', usage: 'RATES', example: 'RATES' },
  { name: 'NEWS', group: 'Markets', hint: 'Headlines that move markets', usage: 'NEWS', example: 'NEWS' },
  { name: 'FX', group: 'Money tools', hint: 'Convert money between currencies', usage: 'FX <amount> <from> <to>', example: 'FX 500 USD THB', examples: ['FX 500 USD THB', 'FX USD CAD'] },
  { name: 'CPI', group: 'Money tools', hint: 'What money from a past year is worth today', usage: 'CPI <amount> <year>', example: 'CPI 100 2015', examples: ['CPI 100 2015', 'CPI 1000 1990'] },
  { name: 'WHATIF', group: 'Money tools', hint: 'The stock you should have bought', usage: 'WHATIF [<item> ...]', example: 'WHATIF', examples: ['WHATIF', 'WHATIF IPHONE6 LATTE:3Y'] },
  { name: 'BUY', group: 'Money tools', hint: 'Should I buy it? Cost per use and a verdict', usage: 'BUY <price> [<n> PER WEEK] [FOR <n>Y]', example: 'BUY 1200', examples: ['BUY 1200', 'BUY 90 3 PER WEEK FOR 2Y'] },
  { name: 'WAGE', group: 'Money tools', hint: 'Save your hourly pay, BUY then shows hours of work', usage: 'WAGE <per hour>', example: 'WAGE 35', examples: ['WAGE 35'] },
  ...EXTRA_HELP,
  { name: 'HELP', group: 'Help', hint: 'Every command, with examples', usage: 'HELP', example: 'HELP' },
];

export const TICKER_HELP = {
  name: 'AAPL', group: 'Markets', hint: 'Any ticker, index, currency pair, commodity or coin: price, chart and key numbers', usage: '<symbol> [1D|5D|1M|3M|6M|YTD|1Y|2Y|5Y|10Y|MAX] or <symbol> <from> <to>', examples: ['AAPL', 'TSLA 5Y', 'GOLD', 'EURUSD', 'SPX YTD', 'AAPL 2020-01-01 2024-12-31', 'NVDA FROM 2023-01-01'],
};

export const SOON = [
  { name: 'ALERTS', hint: 'Price alerts, coming next to Pro' },
];

export const FKEYS = [
  { key: 'F1', label: 'HELP', cmd: 'HELP' },
  { key: 'F2', label: 'HOME', cmd: 'HOME' },
  { key: 'F3', label: 'MARKETS', cmd: 'MARKETS' },
  { key: 'F4', label: 'FX', cmd: 'FX 100 USD EUR' },
  { key: 'F6', label: 'NEWS', cmd: 'NEWS' },
  { key: 'F7', label: 'RATES', cmd: 'RATES' },
  { key: 'F8', label: 'CPI', cmd: 'CPI 100 2000' },
];

export const CHART_RANGES = PRESETS;
const SIMPLE = new Set(['HOME', 'MARKETS', 'RATES', 'NEWS', 'HELP']);
const ALIASES = { '?': 'HELP', H: 'HELP', M: 'MARKETS', MARKET: 'MARKETS', RATE: 'RATES', INFLATION: 'CPI' };
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

// BUY <price> [<n> PER DAY|WEEK|MONTH|YEAR] [FOR <n>Y]. Defaults: 1 per week, 3 years.
export const BUY_UNITS = { DAY: 365, WEEK: 52, MONTH: 12, YEAR: 1 };
const UNIT_WORDS = {
  DAY: 'DAY', DAYS: 'DAY', WEEK: 'WEEK', WEEKS: 'WEEK', WK: 'WEEK', MONTH: 'MONTH', MONTHS: 'MONTH', MO: 'MONTH', YEAR: 'YEAR', YEARS: 'YEAR', YR: 'YEAR',
};
const ADVERBS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', YEARLY: 'YEAR' };
export const BUY_DEFAULTS = { times: 1, unit: 'WEEK', years: 3 };

// "3Y", "3", "18M", "2.5YRS" -> years, or NaN.
function parseYears(tok, next) {
  const m = /^(\d+(?:\.\d+)?)(Y|YR|YRS|YEAR|YEARS|M|MO|MONTHS?)?$/.exec(tok || '');
  if (!m) return { years: NaN, used: 1 };
  let unit = m[2];
  let used = 1;
  if (!unit && next && /^(Y|YR|YRS|YEARS?|MO|MONTHS?)$/.test(next)) { unit = next; used = 2; }
  const n = Number(m[1]);
  return { years: unit && unit.startsWith('M') ? n / 12 : n, used };
}

export function parseBuyArgs(args) {
  const toks = args.filter((t) => t !== 'AT' && t !== 'X' && t !== 'TIMES' && t !== 'TIME');
  if (!toks.length || !looksNumeric(toks[0])) return { error: 'usage' };
  const price = parseAmountToken(toks[0]);
  if (!Number.isFinite(price) || price <= 0) return { error: 'amount' };
  let { times, unit, years } = BUY_DEFAULTS;
  let i = 1;
  if (ADVERBS[toks[i]]) { times = 1; unit = ADVERBS[toks[i]]; i += 1; }
  else if (/^\d+(\.\d+)?$/.test(toks[i] || '') && (toks[i + 1] === 'PER' || toks[i + 1] === 'A' || toks[i + 1] === 'EVERY')) {
    times = Number(toks[i]);
    unit = UNIT_WORDS[toks[i + 2]];
    if (!unit) return { error: 'usage' };
    i += 3;
  } else if ((toks[i] === 'PER' || toks[i] === 'EVERY') && UNIT_WORDS[toks[i + 1]]) {
    unit = UNIT_WORDS[toks[i + 1]];
    i += 2;
  }
  if (toks[i] === 'FOR') {
    const y = parseYears(toks[i + 1], toks[i + 2]);
    years = y.years;
    i += 1 + y.used;
  }
  if (i !== toks.length) return { error: 'usage' };
  if (!(times > 0 && times <= 1000)) return { error: 'times' };
  if (!(years > 0 && years <= 100)) return { error: 'years' };
  return { price, times, unit, years };
}

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

// <symbol> [range]: a named instrument (GOLD, EUR/USD, S&P 500) or a ticker, then a
// preset (5Y), two dates, or FROM <date> [TO <date>]. Bad dates still open the screen,
// which explains; words that are not a range make the whole input UNKNOWN.
export function parseSymbolCommand(toks) {
  const m = matchInstrument(toks);
  if (!m && !isTicker(toks[0])) return null;
  const ticker = m ? m.inst.id : toks[0];
  const range = parseRangeArgs(toks.slice(m ? m.used : 1));
  if (range.error === 'usage') return null;
  if (range.error) return { name: 'QUOTE', args: { ticker, error: range.error }, error: range.error, input: toks.join(' ') };
  return { name: 'QUOTE', args: { ticker, ...range }, input: [ticker, rangeWords(range)].filter(Boolean).join(' ') };
}

// Turn raw input into { name, args?, error?, input }. Unknown commands get name 'UNKNOWN'.
export function parseCommand(raw) {
  const toks = tokenize(raw);
  if (!toks.length) return { name: DEFAULT_COMMAND, input: DEFAULT_COMMAND };
  const head = ALIASES[toks[0]] || toks[0];
  const rest = toks.slice(1);
  const extra = matchExtra(head, rest);
  if (extra) return extra;
  if (SIMPLE.has(head)) return { name: head, input: head };
  if (head === 'FX') {
    const args = parseFxArgs(rest);
    return { name: 'FX', args, error: args.error, input: ['FX', ...rest].join(' ') };
  }
  if (head === 'CPI') {
    const args = parseCpiArgs(rest);
    return { name: 'CPI', args, error: args.error, input: ['CPI', ...rest].join(' ') };
  }
  if (head === 'BUY' && rest.length) {
    const args = parseBuyArgs(rest);
    return { name: 'BUY', args, error: args.error, input: ['BUY', ...rest].join(' ') };
  }
  if (head === 'WAGE') {
    const args = parseWageArgs(rest);
    return { name: 'WAGE', args, error: args.error, input: ['WAGE', ...rest].join(' ') };
  }
  if (head === 'WHATIF') {
    return { name: 'WHATIF', args: { tokens: rest }, input: ['WHATIF', ...rest].join(' ') };
  }
  if (head === '420' && !rest.length) return { name: 'FUNDING', input: '420' };
  if (head === 'BUY') return { name: 'BUY', args: { error: 'usage' }, error: 'usage', input: 'BUY' };
  const soon = SOON.find((s) => s.name === head);
  if (soon && !rest.length) return { name: 'SOON', args: { soon }, input: head };
  // Add new commands above this line: commands win over symbols of the same name.
  const quote = parseSymbolCommand(toks);
  if (quote) return quote;
  return { name: 'UNKNOWN', input: toks.join(' ') };
}

// URL state: ?c=FX+500+USD+THB
export function toQuery(input) {
  const c = tokenize(input).join(' ');
  return '?' + new URLSearchParams({ c }).toString();
}

export function fromQuery(search) {
  const c = new URLSearchParams(search || '').get('c');
  const cleaned = tokenize(c).join(' ');
  return cleaned || DEFAULT_COMMAND;
}

// Commands that take arguments: Tab adds a space, and a bad argument shows the usage line.
const TAKES_ARGS = { FX: parseFxArgs, CPI: parseCpiArgs, BUY: parseBuyArgs, WAGE: parseWageArgs, ...EXTRA_TAKES_ARGS };

// Suggestions for the dropdown: [{ name, hint, value }].
export function suggest(raw) {
  const text = String(raw ?? '').replace(/^\s+/, '').toUpperCase();
  const toks = tokenize(text);
  if (!toks.length) return COMMANDS.map((c) => ({ name: c.name, hint: c.hint, value: c.example }));
  const head = toks[0];
  const typingHead = toks.length === 1 && !/\s$/.test(text);
  if (typingHead) {
    const cmds = COMMANDS
      .filter((c) => c.name.startsWith(head))
      .map((c) => ({ name: c.name, hint: c.hint, value: TAKES_ARGS[c.name] ? c.name + ' ' : c.name }));
    return head.length >= 2 ? [...cmds, ...symbolSuggestions(searchInstruments(head, 6), cmds)] : cmds;
  }
  const cmd = COMMANDS.find((c) => c.name === head);
  if (cmd && TAKES_ARGS[cmd.name]) {
    const args = TAKES_ARGS[cmd.name](toks.slice(1));
    if (args.error) return [{ name: cmd.usage, hint: 'e.g. ' + cmd.example, value: cmd.example, usage: true }];
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

// Symbol rows for the suggestion list, skipping any value already listed.
export function symbolSuggestions(results, existing = []) {
  const have = new Set(existing.map((e) => e.value));
  return results
    .filter((r) => !have.has(r.id))
    .map((r) => ({ name: r.id, hint: `${r.name}${KIND_LABEL[r.kind] ? ` · ${KIND_LABEL[r.kind]}` : ''}`, value: r.id, symbol: true }));
}

// Tab completion: complete to the n-th suggestion.
export function complete(raw, index = 0) {
  const list = suggest(raw);
  if (!list.length) return raw;
  return list[((index % list.length) + list.length) % list.length].value;
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

export function nyClock(date = new Date()) {
  const { hour, minute, second } = nyParts(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(hour)}:${p(minute)}:${p(second)}`;
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

const SCREENS = {
  HOME: homeScreen, HELP: helpScreen, MARKETS: marketsScreen, FX: fxScreen,
  QUOTE: quoteScreen, CPI: cpiScreen, RATES: ratesScreen, NEWS: newsScreen,
  BUY: buyScreen, WAGE: buyScreen, WHATIF: whatifScreen, FUNDING: fundingScreen,
};
const DEFAULT_TITLE = 'Bloombroke: the $32,000 terminal. Now $4.20 a month.';

function boot() {
  const $ = (id) => document.getElementById(id);
  const form = $('cmd-form');
  const input = $('cmd');
  const cursor = $('cursor');
  const measure = $('measure');
  const list = $('suggest');
  const screen = $('screen');
  const tape = $('tape');
  const statusMsg = $('status-msg');
  const keybar = $('keybar');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (window.matchMedia('(max-width: 639px)').matches) input.placeholder = 'Try AAPL or FX 500 USD THB';

  let cmdHistory = store.get('bb.history', []);
  let histIndex = cmdHistory.length;
  let draft = '';
  let tabIndex = -1;
  let tabBase = '';
  let active = -1;
  let cleanups = [];
  let screenAbort = null;

  // --- status line ------------------------------------------------------------
  function setStatus(text, kind = '') {
    statusMsg.textContent = String(text).toUpperCase();
    statusMsg.dataset.kind = kind;
  }
  // items: the instruments on screen, so the line can say what is real time and what is delayed.
  function setUpdated(iso, stale, items) {
    setStatus(statusLine(iso, stale, items), stale ? 'warn' : '');
  }

  // --- function keys ----------------------------------------------------------
  keybar.innerHTML = FKEYS.map((k) => `<a class="fkey" href="${toQuery(k.cmd)}" data-cmd="${escapeHtml(k.cmd)}" data-name="${tokenize(k.cmd)[0]}"><span class="fkey-n">${k.key}</span><span class="fkey-l">${k.label}</span></a>`).join('');

  function setKeys(name) {
    keybar.querySelectorAll('.fkey').forEach((k) => {
      const on = k.dataset.name === name;
      k.classList.toggle('is-active', on);
      if (on) {
        k.setAttribute('aria-current', 'page');
        if (keybar.scrollWidth > keybar.clientWidth) keybar.scrollLeft = k.offsetLeft - (keybar.clientWidth - k.offsetWidth) / 2;
      } else {
        k.removeAttribute('aria-current');
      }
    });
  }

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
    const t = text.replace(/^\s+/, '').toUpperCase();
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
  function renderSuggest({ keepActive = false } = {}) {
    items = document.activeElement === input ? suggest(input.value) : [];
    const qText = remoteQuery(input.value);
    if (qText && items.every((it) => !it.usage)) {
      if (remote.has(qText)) items = [...items, ...symbolSuggestions(remote.get(qText), items)].slice(0, 10);
      else fetchRemote(qText);
    }
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
    run(s.value);
    if (coarse) input.blur();
  }

  // --- live refresh: pause while the tab is hidden ----------------------------
  function liveTimer(fn, ms) {
    let lastRun = Date.now();
    const go = () => { lastRun = Date.now(); fn(); };
    const id = setInterval(() => { if (!document.hidden) go(); }, ms);
    const onVis = () => { if (!document.hidden && Date.now() - lastRun >= ms) go(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }

  // --- running commands -----------------------------------------------------
  function runCleanups() {
    for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
    cleanups = [];
  }

  function render(raw) {
    const cmd = parseCommand(raw);
    runCleanups();
    if (screenAbort) screenAbort.abort();
    screenAbort = new AbortController();
    const signal = screenAbort.signal;

    const view = document.createElement('section');
    view.className = 'view';
    screen.replaceChildren(view);
    setKeys(cmd.name);
    document.title = cmd.name === 'HOME' || cmd.name === 'UNKNOWN' ? DEFAULT_TITLE : `${cmd.input} | Bloombroke`;

    const ctx = {
      run, fetchJSON, signal, escapeHtml, toQuery, store,
      commands: COMMANDS, ticker: TICKER_HELP, soon: SOON, fkeys: FKEYS,
      status: setStatus, updated: setUpdated,
      every(fn, ms) { const id = setInterval(fn, ms); cleanups.push(() => clearInterval(id)); },
      // Like every(), but it skips while the tab is hidden and catches up when it is shown.
      live(fn, ms) { cleanups.push(liveTimer(fn, ms)); },
      onCleanup(fn) { cleanups.push(fn); },
    };
    const mod = SCREENS[cmd.name] || EXTRA_SCREENS[cmd.name];
    if (mod) {
      setStatus('LOADING...');
      const fn = mod.render(view, cmd, ctx);
      if (typeof fn === 'function') cleanups.push(fn);
    } else if (cmd.name === 'SOON') {
      const s = cmd.args.soon;
      view.innerHTML = panel('1', s.name, `
        <p class="notice">${escapeHtml(s.name)} is coming soon.</p>
        <p class="muted">${escapeHtml(s.hint)}. For now, try <a class="code" href="${toQuery('HELP')}" data-cmd="HELP">HELP</a>.</p>`, { cls: 'panel-solo' });
      setStatus(`${s.name}: COMING SOON`);
    } else {
      view.innerHTML = panel('1', 'Unknown command', `
        <p class="notice">Unknown command. Type <a href="${toQuery('HELP')}" data-cmd="HELP">HELP</a>.</p>
        <p class="muted">You typed <span class="code">${escapeHtml(cmd.input)}</span>. A ticker is one word, like <a class="code" href="${toQuery('AAPL')}" data-cmd="AAPL">AAPL</a> or <a class="code" href="${toQuery('BRK.B')}" data-cmd="BRK.B">BRK.B</a>.</p>`, { cls: 'panel-solo' });
      setStatus('UNKNOWN COMMAND. TYPE HELP', 'warn');
    }
  }

  function run(raw, { push = true } = {}) {
    const clean = tokenize(raw).join(' ') || DEFAULT_COMMAND;
    if (push) {
      const shown = urlCommand(clean); // LOGIN keeps its key out of the URL and history
      const q = toQuery(shown);
      if (location.search !== q) window.history.pushState({ c: shown }, '', q);
      if (cmdHistory[cmdHistory.length - 1] !== shown) {
        cmdHistory.push(shown);
        cmdHistory = cmdHistory.slice(-50);
        store.set('bb.history', cmdHistory);
      }
    }
    histIndex = cmdHistory.length;
    input.value = '';
    draft = '';
    closeSuggest();
    placeCursor();
    render(clean);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && items[active] && !items[active].usage && !list.hidden) { pick(items[active]); return; }
    const value = input.value;
    if (!value.trim()) { run(fromQuery(location.search), { push: false }); return; }
    run(value);
    if (coarse) input.blur();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (!input.value.trim() && !items.length) return;
      e.preventDefault();
      if (tabIndex === -1) tabBase = input.value;
      tabIndex = e.shiftKey ? tabIndex - 1 : tabIndex + 1;
      input.value = complete(tabBase, tabIndex);
      input.setSelectionRange(input.value.length, input.value.length);
      active = -1;
      renderSuggest();
      placeCursor();
      return;
    }
    tabIndex = -1;
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
      if (!list.hidden) closeSuggest(); else { input.value = ''; placeCursor(); }
    }
  });

  input.addEventListener('input', () => { renderSuggest(); placeCursor(); });
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
    // A focused row (or any non-link element carrying a command) opens on Enter.
    if (e.key === 'Enter' && e.target !== input && e.target.matches?.('[data-cmd]:not(a):not(button)')) {
      e.preventDefault();
      run(e.target.dataset.cmd);
      return;
    }
    // Function keys work everywhere. F5, F11 and F12 stay with the browser.
    const fk = FKEYS.find((k) => k.key === e.key);
    if (fk && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      run(fk.cmd);
      if (!coarse) input.focus();
      return;
    }
    // Typing anywhere goes to the command bar.
    if (document.activeElement === input || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key.length === 1 || e.key === 'Backspace') input.focus();
  });

  window.addEventListener('popstate', () => render(urlCommand(fromQuery(location.search))));

  // --- clock ----------------------------------------------------------------
  const clockEl = $('clock');
  const statusEl = $('market-status');
  function tick() {
    const now = new Date();
    clockEl.textContent = nyClock(now);
    const open = marketStatus(now) === 'OPEN';
    statusEl.dataset.open = String(open);
    statusEl.querySelector('.status-text').textContent = open ? 'MARKET OPEN' : 'MARKET CLOSED';
  }
  tick();
  setInterval(tick, 1000);

  // --- ticker tape ----------------------------------------------------------
  // Prices update in place, so the scroll does not jump back to the start every 15 s.
  let tapeIds = '';
  async function loadTape() {
    try {
      const own = getTape(); // Pro: your own tape
      const list = own ? await loadTapeRows(own, fetchJSON) : (await fetchJSON('/api/markets')).instruments.filter((q) => q.tape);
      if (!list.length) throw new Error('empty tape');
      const ids = list.map((q) => q.id).join(',');
      if (ids === tapeIds) {
        for (const q of list) {
          tape.querySelectorAll(`.tape-item[data-id="${q.id}"]`).forEach((a) => {
            a.querySelector('.tape-last').textContent = fmtNum(q.last, q.decimals);
            const chg = a.querySelector('.tape-chg');
            chg.textContent = fmtPct(q.changePct);
            chg.className = `tape-chg num ${dirOf(q.change)}`;
          });
        }
        return;
      }
      const html = list.map((q) => {
        const d = dirOf(q.change);
        const c = cmdForInstrument(q.id) || 'MARKETS';
        return `<a class="tape-item" href="${toQuery(c)}" data-cmd="${escapeHtml(c)}" data-id="${escapeHtml(q.id)}">
          <span class="tape-name">${escapeHtml(q.name)}</span>
          <span class="tape-last num">${fmtNum(q.last, q.decimals)}</span>
          <span class="tape-chg num ${d}">${fmtPct(q.changePct)}</span>${freshTag(q)}</a>`;
      }).join('');
      tapeIds = ids;
      const group = `<div class="tape-group">${html}</div>`;
      tape.innerHTML = group + group.replace('class="tape-group"', 'class="tape-group" aria-hidden="true"');
      tape.querySelectorAll('.tape-group[aria-hidden] a').forEach((a) => a.setAttribute('tabindex', '-1'));
      const w = tape.firstElementChild.getBoundingClientRect().width;
      tape.style.setProperty('--tape-duration', `${Math.max(30, Math.round(w / 40))}s`);
      tape.classList.add('is-running');
    } catch {
      if (!tapeIds) tape.innerHTML = '<span class="tape-empty">MARKET DATA IS TAKING A BREAK.</span>';
    }
  }
  loadTape();
  liveTimer(loadTape, 15_000);
  window.addEventListener('bb:tape', () => { tapeIds = ''; loadTape(); });

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

  // --- first render ---------------------------------------------------------
  const initial = urlCommand(fromQuery(location.search)); // a link never runs LOGIN or TAPE ADD
  window.history.replaceState({ c: initial }, '', location.search ? toQuery(initial) : location.pathname);
  const firstVisit = !store.get('bb.booted', false);
  if (firstVisit && !location.search && !reduceMotion.matches) {
    store.set('bb.booted', true);
    setStatus('STARTING');
    bootSequence(screen, () => render(initial));
  } else {
    render(initial);
  }
  if (!coarse) input.focus();
  placeCursor();
}

// First visit only: a short, fast boot log. Any key or tap skips it.
export const BOOT_LINES = [
  ['BLOOMBROKE OS v4.20', ''],
  ['connecting to markets ....... ', 'ok'],
  ['loading ticker tape ......... ', 'ok'],
  ['syncing New York clock ...... ', 'ok'],
  ['cost: $4.20/mo (they charge $32,000/yr)', ''],
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

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', finish, true);
    window.removeEventListener('pointerdown', finish, true);
    if (view.isConnected) done();
  }

  function frame(now) {
    if (!view.isConnected) { finish(); return; }
    const p = Math.min(1, (now - start) / DURATION);
    paint(Math.ceil(p * total));
    if (p < 1) raf = requestAnimationFrame(frame);
    else setTimeout(finish, 180);
  }

  window.addEventListener('keydown', finish, true);
  window.addEventListener('pointerdown', finish, true);
  raf = requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
