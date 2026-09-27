// WHATIF with your own purchase (free for everyone): the words, shared by the screen and the server.
//
//   MY 1200 AAPL 2015                      $1,200 of AAPL on the first trading day of 2015
//   MY 1200 AAPL 2015-03                   ... of March 2015
//   MY 1200 AAPL 2015-03-02                ... at that day's close (or the last trading day before)
//   MY 5 A DAY SBUX SINCE 2018             $5 a day, bought once a month like the habits
//   MY 20 A WEEK KO SINCE 2016-06 TO 2022  A WEEK / A MONTH, optionally TO a year or month
//
// No free text: every word is a number, a ticker, a date or one of these keywords, and
// the label on the result, the certificate and the share image is made from them.
// Amounts are whole dollars. Dates are New York dates; nothing may be in the future.

export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 10_000_000;
export const MAX_YEARS = 50;
export const MAX_TICKERS = 3; // different stocks of your own in one run
export const PERS = { DAY: 'day', WEEK: 'week', MONTH: 'month' };
export const MINE_EXAMPLES = ['WHATIF MY 1200 AAPL 2015', 'WHATIF MY 5 A DAY SBUX SINCE 2018'];
export const MINE_DOODLE = 'box';

const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
// Today in New York (the market's date), as YYYY-MM-DD.
export const nyDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export class MineError extends Error {
  constructor(message) {
    super(message);
    this.code = 'bad_mine';
  }
}

const USAGE = 'Your own purchase looks like WHATIF MY 1200 AAPL 2015, or WHATIF MY 5 A DAY SBUX SINCE 2018.';

// "1200", "$1,200" -> whole dollars, or NaN (cents are not taken).
export function parseAmount(tok) {
  const s = String(tok || '').replace(/^\$/, '').replace(/,/g, '');
  return /^\d{1,9}$/.test(s) ? Number(s) : NaN;
}

// 1200 -> "1200": the amount as the command writes it.
export const amountWord = (n) => String(n);

// "$1,200".
export const fmtAmount = (n) => `$${n.toLocaleString('en-US')}`;

const isDay = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

// "2015" | "2015-03" | "2015-03-02" -> { word, day: first day it covers, month, level }.
export function parseDateWord(tok, { days = true } = {}) {
  const s = String(tok || '');
  let m;
  if ((m = /^(\d{4})$/.exec(s))) return { word: s, day: `${m[1]}-01-01`, month: `${m[1]}-01`, last: `${m[1]}-12`, level: 'year' };
  if ((m = /^(\d{4})-(\d{2})$/.exec(s)) && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { word: s, day: `${s}-01`, month: s, last: s, level: 'month' };
  if (days && (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)) && isDay(Number(m[1]), Number(m[2]), Number(m[3]))) {
    return { word: s, day: s, month: s.slice(0, 7), last: s.slice(0, 7), level: 'day' };
  }
  return null;
}

// "2015" -> "2015", "2015-03" -> "MAR 2015", "2015-03-02" -> "2 MAR 2015".
export function dateLabel(d) {
  const [y, mo, da] = d.word.split('-');
  if (d.level === 'year') return y;
  if (d.level === 'month') return `${MONTHS[Number(mo) - 1]} ${y}`;
  return `${Number(da)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

const monthIndex = (key) => { const [y, m] = key.split('-').map(Number); return y * 12 + m - 1; };

// Reads one item starting at tokens[i] (the word MY). Returns { item, next }.
function readItem(tokens, i, now) {
  const today = nyDate(now);
  const current = today.slice(0, 7);
  const t = tokens.slice(i + 1, i + 9);
  if (t.length < 3) throw new MineError(USAGE);
  const amount = parseAmount(t[0]);
  if (!Number.isFinite(amount)) throw new MineError(/^\$?[\d,]+\.\d*$/.test(t[0]) ? 'Use whole dollars, like 1200.' : `${t[0]} is not an amount. ${USAGE}`);
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) throw new MineError('Pick an amount from $1 to $10,000,000.');
  const recurring = t[1] === 'A' && PERS[t[2]];
  if (!recurring) {
    const ticker = t[1];
    if (!TICKER_RE.test(ticker)) throw new MineError(`${ticker} does not look like a ticker. ${USAGE}`);
    const date = parseDateWord(t[2]);
    if (!date) throw new MineError(`${t[2]} is not a date. Dates look like 2015, 2015-03 or 2015-03-02.`);
    if (date.day > today) throw new MineError(`${t[2]} is in the future.`);
    if (date.level === 'day' && date.day === today) throw new MineError(`${t[2]} is today: pick a day with a close.`);
    const words = ['MY', amountWord(amount), ticker, date.word];
    return {
      next: i + 4,
      item: { kind: 'once', amount, ticker, date, words, id: `my:${words.slice(1).join(':')}`.toLowerCase() },
    };
  }
  const per = PERS[t[2]];
  const ticker = t[3];
  if (!ticker || !TICKER_RE.test(ticker)) throw new MineError(`${ticker || 'A ticker'} does not look like a ticker. ${USAGE}`);
  if (t[4] !== 'SINCE') throw new MineError(`A habit takes SINCE and a year or a month, like WHATIF MY 5 A ${t[2]} ${ticker} SINCE 2018.`);
  const since = parseDateWord(t[5], { days: false });
  if (!since) throw new MineError(`${t[5] || 'SINCE'} needs a year or a month, like 2018 or 2018-06.`);
  if (since.month > current) throw new MineError(`${t[5]} is in the future.`);
  let to = null;
  let next = i + 7;
  if (t[6] === 'TO') {
    to = parseDateWord(t[7], { days: false });
    if (!to) throw new MineError(`${t[7] || 'TO'} needs a year or a month, like 2022 or 2022-12.`);
    if (to.month > current) throw new MineError(`TO ${t[7]} is in the future.`);
    next = i + 9;
  }
  const start = since.month;
  const end = to ? (to.last < current ? to.last : current) : current;
  if (end < start) throw new MineError('TO has to be after SINCE.');
  if (monthIndex(end) - monthIndex(start) + 1 > MAX_YEARS * 12) throw new MineError(`Pick ${MAX_YEARS} years or fewer.`);
  const words = ['MY', amountWord(amount), 'A', t[2], ticker, 'SINCE', since.word, ...(to ? ['TO', to.word] : [])];
  return {
    next,
    item: { kind: 'monthly', amount, per, ticker, since, to, start, end, words, id: `my:${words.slice(1).join(':')}`.toLowerCase() },
  };
}

// Tokens -> { mine: [items], rest: [the other tokens] }. Throws MineError.
export function parseMine(tokens, now = new Date()) {
  const mine = [];
  const rest = [];
  for (let i = 0; i < tokens.length;) {
    const tok = String(tokens[i]).toUpperCase();
    if (tok !== 'MY') { rest.push(tokens[i]); i += 1; continue; }
    const up = tokens.map((x) => String(x).toUpperCase());
    const { item, next } = readItem(up, i, now);
    if (!mine.some((m) => m.id === item.id)) mine.push(item);
    i = next;
  }
  checkTickers(mine);
  return { mine, rest };
}

export const hasMine = (tokens) => tokens.some((t) => String(t).toUpperCase() === 'MY');

// The words of an item, all generated: "$1,200 in AAPL, MAR 2015", "$5 a day in SBUX since 2018".
export function mineLabel(item) {
  if (item.kind === 'once') return `${fmtAmount(item.amount)} in ${item.ticker}, ${dateLabel(item.date)}`;
  return `${fmtAmount(item.amount)} a ${item.per} in ${item.ticker} since ${dateLabel(item.since)}${item.to ? ` to ${dateLabel(item.to)}` : ''}`;
}
export function mineShort(item) {
  return item.kind === 'once' ? `${fmtAmount(item.amount)} in ${item.ticker}` : `${fmtAmount(item.amount)} a ${item.per} in ${item.ticker}`;
}

// The inline form's fields -> the command words, or throws MineError.
// how: 'ONCE' | 'DAY' | 'WEEK' | 'MONTH'.
// An empty or odd field gets a plain line about that field, not the command syntax.
export function formWords({ amount, ticker, date, how = 'ONCE', to = '' }, now = new Date()) {
  const a = String(amount || '').trim();
  const t = String(ticker || '').trim().toUpperCase();
  const d = String(date || '').trim();
  if (!a) throw new MineError('Type an amount, like 15.');
  if (!Number.isFinite(parseAmount(a))) throw new MineError('Type the amount in whole dollars, like 15.');
  if (!t) throw new MineError('Type a stock ticker, like AAPL.');
  if (!TICKER_RE.test(t)) throw new MineError(`${t} is not a ticker. Try one like AAPL.`);
  if (!d) throw new MineError(how === 'ONCE' ? 'Type a date, like 2015 or 2015-03.' : 'Type a year, like 2015.');
  const words = how === 'ONCE' ? ['MY', a, t, d] : ['MY', a, 'A', how, t, 'SINCE', d, ...(String(to || '').trim() ? ['TO', String(to).trim()] : [])];
  const { mine } = parseMine(words, now);
  return mine[0].words;
}

// At most MAX_TICKERS different stocks of your own in one run.
export function checkTickers(items) {
  const n = new Set(items.map((i) => i.ticker)).size;
  if (n > MAX_TICKERS) throw new MineError(`Up to ${MAX_TICKERS} stocks of your own in one WHATIF.`);
}
