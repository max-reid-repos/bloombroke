// Market quotes. Every source lives behind a small function so it can be swapped later.
// Current source: the public CNBC quote service (no key). Keep it server side only.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { INSTRUMENTS as ALL, FX_MAJOR_IDS, YIELD_IDS, instrumentById, resolveInstrument, STOCK_RE, stockSymbol } from '../public/instruments.js';

export { stockSymbol };

// The MARKETS list (with CNBC symbols), the FX majors and the Treasury yields all come
// from the shared registry in public/instruments.js.
export const INSTRUMENTS = ALL.filter((i) => i.markets);
export const FX_MAJORS = FX_MAJOR_IDS.map(instrumentById).map((i) => ({ ...i, pair: i.name }));
export const YIELDS = YIELD_IDS.map(instrumentById).map((i) => ({ ...i, name: i.longName }));

export const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// Quotes are shared by every visitor: one upstream call per 15 seconds per key,
// however many people are watching (the cache de-duplicates calls in flight).
export const QUOTES_TTL = 15_000;
export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CNBC_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

// "1.21" -> 2, "345.34" -> 2, "7,040" -> 0, anything else -> null: how many decimals
// the source wrote.
export function decimalsIn(s) {
  if (typeof s !== 'string') return null;
  const m = /^-?\d+(?:\.(\d+))?$/.exec(s.replace(/[,\s+]/g, ''));
  return m ? (m[1] || '').length : null;
}

export function parseNum(s) {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return NaN;
  const n = Number(s.replace(/[,%+\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

// A number the source really sent: a blank or a word (UNCH) is NaN, never 0 (parseNum
// reads '' as 0).
export function parseChange(s) {
  return /\d/.test(String(s ?? '')) ? parseNum(s) : NaN;
}

function numOrNull(s) {
  const n = parseChange(s);
  return Number.isFinite(n) ? n : null;
}

function positiveOrNull(s) {
  const n = parseNum(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "aapl" -> "AAPL"; "gold" -> "GOLD" (a registry id); anything else -> null.
// "$GOLD" -> "$GOLD": the stock GOLD, an id no instrument has (the browser sends a $ only
// when the plain word means something else: $M, $GOLD).
export function normalizeTicker(raw) {
  const t0 = String(raw ?? '').trim().toUpperCase();
  if (STOCK_RE.test(t0)) return t0;
  const inst = resolveInstrument(raw);
  if (inst) return inst.id;
  const t = String(raw ?? '').trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

// Our id -> the CNBC symbol. Plain stock tickers are the same in both; "$GOLD" is GOLD.
export function tickerSource(ticker) {
  return instrumentById(ticker)?.src || stockSymbol(ticker);
}

// The exchange symbol for company data (Nasdaq, SEC): "$DOW" -> "DOW". Plain words stay
// as today ("DOW" is still the Dow index id DJI).
export function companyTicker(raw) {
  const t = normalizeTicker(raw);
  return t ? stockSymbol(t) : null;
}

// CNBC says realTime for US stocks (Nasdaq Last Sale), US indexes, FX, crypto and
// yields; futures and most non-US indexes are delayed.
export function freshness(r) {
  return {
    realTime: r?.realTime === true || r?.realTime === 'true',
    marketState: r?.curmktstatus || null,
  };
}

// extra: more query fields (events: '1' adds EventData: next earnings date, ex-dividend).
export async function fetchCnbcRows(fetchImpl, symbols, extra = {}) {
  const qs = new URLSearchParams({
    symbols: symbols.join('|'),
    requestMethod: 'itv', noform: '1', partnerId: '2', fund: '1', exthrs: '1', output: 'json', ...extra,
  });
  const res = await fetchImpl(`${CNBC_URL}?${qs}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`quotes source HTTP ${res.status}`);
  const body = await res.json();
  let rows = body?.FormattedQuoteResult?.FormattedQuote;
  if (rows && !Array.isArray(rows)) rows = [rows];
  if (!Array.isArray(rows)) throw new Error('quotes source: unexpected shape');
  return rows;
}

// A row with no day's move: on weekends and holidays the source sends UNCH and rolls its
// previous close onto the last price, so the real move is gone from the row (and a
// previous close that differs is a rounded one, not a move either).
export function noDayMove(r) {
  return Boolean(r) && !Number.isFinite(parseChange(r.change)) && Number.isFinite(parseNum(r.last));
}

// The day's move for one row: the source's change, or for a row with none the move
// between the last two daily closes (fill: { close, change, changePct }, see dailyMove),
// used only when that last close is the row's price within 0.5%. Otherwise null: unknown
// shows as --, never as 0.00%.
export function dayMove(r, fill = null) {
  const change = parseChange(r?.change);
  const pct = parseChange(r?.change_pct);
  if (Number.isFinite(change)) {
    // No percent from the source: from the change and the price before it, or unknown.
    const before = parseNum(r?.last) - change;
    const derived = Number.isFinite(before) && before !== 0 ? Math.round((change / Math.abs(before)) * 1e6) / 1e4 : null;
    return { change, changePct: Number.isFinite(pct) ? pct : derived };
  }
  const last = parseNum(r?.last);
  if (fill && Number.isFinite(fill.close) && Math.abs(fill.close - last) <= Math.abs(last) * 0.005) {
    // From the close before the fill's last session to this price (the same thing when
    // the price is that session's close).
    if (fill.prevClose > 0) {
      const c = Math.round((last - fill.prevClose) * 1e6) / 1e6;
      return { change: c, changePct: Math.round((c / fill.prevClose) * 1e6) / 1e4 };
    }
    return { change: fill.change, changePct: fill.changePct };
  }
  return { change: null, changePct: null };
}

const NY = 'America/New_York';
const nyDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' });
// ms -> the New York day, YYYYMMDD.
export const nyDayOf = (ms) => nyDayFmt.format(new Date(ms)).replace(/-/g, '');

// Day of the week of a New York day (YYYYMMDD...): 0 Sunday to 6 Saturday.
export const dayOfWeek = (d) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)))).getUTCDay();

// A daily bar the source dates on a weekend while the market was shut: any Saturday bar,
// or a Sunday bar that never moved (open, high and low all the close, or no open at all:
// spot gold gets one), which only repeats Friday's price. d: YYYYMMDD..., v the close,
// o h l the open, high and low. Never used for crypto, which trades on weekends.
export function weekendPlaceholder({ d, o, h, l, v }) {
  const dow = dayOfWeek(d);
  if (dow === 6) return true;
  if (dow !== 0) return false;
  return !Number.isFinite(o) || (o === v && h === v && l === v);
}

// Daily bars (oldest first) -> the move between the last two closes, or null, with the
// close before it (prevClose), the New York day of the last bar (day, YYYYMMDD) and that
// day's open, high and low when the source sent them. Weekend placeholder bars are left
// out (allWeek: crypto keeps them), so on a Saturday the move is Friday's.
export function dailyMove(bars, { allWeek = false } = {}) {
  const pos = (n) => (Number.isFinite(n) && n > 0 ? n : undefined);
  const closes = (Array.isArray(bars) ? bars : [])
    .map((b) => {
      const t = Number(b?.tradeTimeinMills);
      const raw = String(b?.tradeTime || '');
      const d = /^\d{8}/.test(raw) ? raw.slice(0, 8) : Number.isFinite(t) ? nyDayOf(t) : '';
      return { t, d, v: Number(b?.close), o: pos(Number(b?.open)), h: pos(Number(b?.high)), l: pos(Number(b?.low)) };
    })
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.v) && b.d)
    .filter((b) => allWeek || !weekendPlaceholder(b))
    .sort((a, b) => a.t - b.t);
  if (closes.length < 2) return null;
  const [a, b] = closes.slice(-2);
  if (a.v === 0) return null;
  const change = Math.round((b.v - a.v) * 1e6) / 1e6;
  const ohl = b.o !== undefined && b.h !== undefined && b.l !== undefined && b.h >= b.l ? { open: b.o, high: b.h, low: b.l } : {};
  return { close: b.v, change, changePct: Math.round((change / Math.abs(a.v)) * 1e6) / 1e4, prevClose: a.v, day: b.d, ...ohl };
}

// A row whose previous close was rolled onto the last price while it still carries a
// move: weekend spot silver says +0.3755 with a previous close equal to its last price.
export function rolledPrev(r) {
  const prev = parseChange(r?.previous_day_closing);
  const last = parseNum(r?.last);
  const chg = parseChange(r?.change);
  return Number.isFinite(prev) && Number.isFinite(last) && Number.isFinite(chg) && chg !== 0
    && Math.abs(prev - last) <= Math.abs(last) * 1e-6;
}

// Rows that take their move from the daily bars when those are ready: no move (UNCH on a
// weekend or holiday), or a rolled previous close.
export const needsFill = (r) => noDayMove(r) || rolledPrev(r);

// A row that needs a fill (needsFill) and has one that fits: the row's own last price
// (spot gold's weekend 4,286.25 stays), the previous close from the daily bars (the close
// before the session the price belongs to: Thursday's on a Saturday), and the move
// between them, so price, change and previous close agree on every screen. The fill fits
// when its last daily close is the row's price within 0.5%. open, high and low are that
// session's from the daily bar when the row has only placeholders (0.00, or the last
// price rolled onto all three). null when the row needs no fill or none fits.
export function filledRow(r, fill) {
  if (!r || !fill || !needsFill(r)) return null;
  const last = parseNum(r.last);
  if (!Number.isFinite(last) || !Number.isFinite(fill.close) || !(fill.prevClose > 0)) return null;
  if (Math.abs(fill.close - last) > Math.abs(last) * 0.005) return null;
  const change = Math.round((last - fill.prevClose) * 1e6) / 1e6;
  const o = numOrNull(r.open);
  const h = numOrNull(r.high);
  const l = numOrNull(r.low);
  const placeholder = ![o, h, l].every((n) => Number.isFinite(n) && n > 0) || (o === h && h === l);
  const ohl = placeholder
    ? { open: fill.open ?? null, high: fill.high ?? null, low: fill.low ?? null }
    : { open: o, high: h, low: l };
  return {
    last,
    asOf: r.last_time || null,
    change,
    changePct: Math.round((change / fill.prevClose) * 1e6) / 1e4,
    prevClose: fill.prevClose,
    ...ohl,
  };
}

// Rows for a fixed list ({ id, src, ... }) -> [{ ...item, last, change, changePct, asOf }].
// fillFor(src): the daily-close fill for a row with no day's move, if one is ready.
export function parseListRows(list, rows, fillFor = () => null) {
  const bySrc = new Map(rows.map((r) => [r.symbol, r]));
  const out = [];
  for (const item of list) {
    const r = bySrc.get(item.src);
    const last = parseNum(r?.last);
    if (!r || !Number.isFinite(last)) continue;
    const fill = fillFor(r.symbol);
    const filled = filledRow(r, fill);
    const { change, changePct } = filled || dayMove(r, fill);
    const { src, aliases, markets, ...rest } = item;
    out.push({
      ...rest,
      last,
      change,
      changePct,
      asOf: r.last_time || null,
      ...freshness(r),
    });
  }
  return out;
}

// Yields move in basis points: 1bp is 0.01 of a percentage point. A change in points
// (the source's +0.035) -> +3.5bp, kept to 0.1bp so float noise never shows.
export function toBp(points) {
  return Number.isFinite(points) ? Math.round(points * 1000) / 10 : null;
}

// Every yield row gets changeBp, its change in bp (last and change stay in percentage
// points, as the source sends them). The 2s10s spread (the 10Y yield less the 2Y) is
// added after the last yield, from the live 2Y and 10Y rows only: last and change in
// points like the other yields, lastBp and changeBp in bp (a 10Y change of +0.003 and a
// 2Y change of -0.035 is +3.8bp). Left out when either yield is missing; its change is
// null (shown as --) when either leg's change is unknown.
export const SPREAD_ID = 'US2S10S';
const pts = (n) => Math.round(n * 1e6) / 1e6;
export function withBp(rows) {
  const out = rows.map((r) => (r.kind === 'yield' ? { ...r, changeBp: toBp(r.change) } : r));
  const y2 = out.find((r) => r.id === 'US2Y');
  const y10 = out.find((r) => r.id === 'US10Y');
  if (!y2 || !y10 || !Number.isFinite(y2.last) || !Number.isFinite(y10.last)) return out;
  const known = Number.isFinite(y2.change) && Number.isFinite(y10.change);
  const times = [y2.asOf, y10.asOf].filter((t) => t && !Number.isNaN(Date.parse(t)));
  const spread = {
    id: SPREAD_ID, name: '2s10s spread', group: y10.group, kind: 'yield', unit: 'bp', cmd: 'CURVE', decimals: 3,
    tape: false, us: true,
    last: pts(y10.last - y2.last),
    lastBp: toBp(y10.last - y2.last),
    change: known ? pts(y10.change - y2.change) : null,
    changePct: null,
    changeBp: known ? toBp(y10.change - y2.change) : null,
    // The older of the two times, and real time only when both are.
    asOf: times.sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null,
    realTime: y2.realTime && y10.realTime,
    marketState: y10.marketState,
  };
  const at = out.map((r) => r.kind === 'yield').lastIndexOf(true);
  out.splice(at + 1, 0, spread);
  return out;
}

// The row's previous close. On weekends the source can send a real move (spot silver
// +0.3755) and still roll its previous close onto the last price: that previous close
// is the price before the move (last minus change), so the screen agrees with itself.
function prevCloseOf(r, last, change) {
  const prev = numOrNull(r.previous_day_closing);
  if (!Number.isFinite(prev) || !Number.isFinite(change) || change === 0) return prev;
  if (Math.abs(prev - last) > Math.abs(last) * 1e-6) return prev;
  return Math.round((last - change) * 1e6) / 1e6;
}

// One CNBC row -> a single quote for the ticker screen, or null if the symbol is unknown.
export function parseQuoteRow(r, ticker = r?.symbol, fill = null) {
  if (!r || Number(r.code) !== 0) return null;
  const last = parseNum(r.last);
  if (!Number.isFinite(last)) return null;
  const x = r.ExtendedMktQuote;
  const extLast = parseNum(x?.last);
  const inst = instrumentById(ticker);
  // A weekend row takes its move, previous close, open and range from the daily bars
  // when that is ready (filledRow); otherwise an unknown move stays null (shown as --).
  const filled = filledRow(r, fill);
  const move = filled || dayMove(r);
  return {
    ticker,
    symbol: r.symbol,
    name: r.name || r.shortName || ticker,
    label: inst?.name || null,
    kind: inst?.kind || 'stock',
    us: inst ? Boolean(inst.us) : true,
    decimals: inst?.decimals ?? null,
    ...freshness(r),
    type: r.type || null,
    exchange: r.exchange || null,
    currency: r.currencyCode || null,
    last,
    change: move.change,
    changePct: move.changePct,
    asOf: r.last_time || null,
    marketCap: r.mktcapView || null,
    // A price's 52-week low or high of 0 is a placeholder (spot gold sends "0.00"), not
    // a number: missing, so the range comes from daily closes (data/range52.js).
    // Yields can really be zero or below.
    high52: inst?.kind === 'yield' ? numOrNull(r.yrhiprice) : positiveOrNull(r.yrhiprice),
    low52: inst?.kind === 'yield' ? numOrNull(r.yrloprice) : positiveOrNull(r.yrloprice),
    // Decimals the source gave the 52-week range (it rounds some, see data/range52.js).
    range52Dp: Math.max(decimalsIn(r.yrhiprice) ?? -1, decimalsIn(r.yrloprice) ?? -1) >= 0 ? Math.max(decimalsIn(r.yrhiprice) ?? 0, decimalsIn(r.yrloprice) ?? 0) : null,
    pe: numOrNull(r.pe),
    eps: numOrNull(r.eps),
    divYield: r.dividendyield || null,
    volume: r.volume_alt || null,
    open: filled ? filled.open : numOrNull(r.open) || null,
    high: filled ? filled.high : numOrNull(r.high) || null,
    low: filled ? filled.low : numOrNull(r.low) || null,
    prevClose: filled ? filled.prevClose : prevCloseOf(r, last, move.change),
    extended: x && Number.isFinite(extLast) ? {
      session: x.type === 'POST_MKT' ? 'AFTER HOURS' : x.type === 'PRE_MKT' ? 'PRE-MARKET' : 'EXTENDED',
      last: extLast,
      change: numOrNull(x.change),
      changePct: numOrNull(x.change_pct),
      asOf: x.last_time || null,
    } : null,
  };
}

// Stock rows for these symbols. The source now and then answers code 1 ("no such
// symbol") for a real one (XLY, seen live), and its cache in front keeps that answer for
// about 10 seconds. So a symbol that comes back unknown is asked once more, in one call,
// past that cache (an extra query field), before it counts as unknown.
export async function fetchStockRows(fetchImpl, symbols, now = Date.now) {
  const rows = await fetchCnbcRows(fetchImpl, symbols);
  const symOf = (r) => String(r?.symbol || '').toUpperCase();
  const again = [...new Set(rows.filter((r) => r && Number(r.code) !== 0).map(symOf))].filter((sym) => symbols.includes(sym));
  if (!again.length) return rows;
  let retry = [];
  try { retry = await fetchCnbcRows(fetchImpl, again, { recheck: String(now()) }); } catch { return rows; }
  const known = new Map(retry.filter((r) => r && Number(r.code) === 0).map((r) => [symOf(r), r]));
  return rows.map((r) => (r && Number(r.code) !== 0 && known.get(symOf(r))) || r);
}

// A stock row -> its quote, null when the source knows no such symbol (it answers
// code 1 or 3 for one, twice), or a throw when the row is missing from the answer or has no
// price: that is a gap in the data, not an unknown ticker, so it must never be cached
// as one (a 404 would say "No ticker called XLY" about a real ETF).
export function stockQuoteOrGap(r, ticker) {
  if (r && Number(r.code) !== 0) return null;
  const quote = parseQuoteRow(r, ticker);
  if (!quote) throw Object.assign(new Error(`quotes source: ${r ? 'no price' : 'no row'} for ${ticker}`), { gap: true });
  return quote;
}

// Rows with no day's move (weekends, holidays) or a rolled previous close (needsFill) get
// it from the daily closes of the CNBC bars service: one call per symbol, kept 10 minutes
// (a failure too, so a dead source is not asked again, and it keeps the last good fill), at most 4 at a time. A batch refresh waits for them at
// most FILL_WAIT_MS; one still running lands on a later read, and until then the row
// shows --.
const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
export const DAILY_FILL_TTL = 10 * 60_000;
export const FILL_WAIT_MS = 1500;
const FILL_CONCURRENCY = 4;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
// Crypto trades every day: its weekend daily bars are real ones.
const allWeekSrc = (src) => ALL.some((i) => i.src === src && i.kind === 'crypto');
export async function fetchDailyMove(fetchImpl, src, nowMs = Date.now()) {
  const url = `${BARS_URL}/${encodeURIComponent(src)}/1D/${ymd(nowMs - 14 * 86_400_000)}000000/${ymd(nowMs + 86_400_000)}000000/adjusted/EST5EDT.json`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`bars source HTTP ${res.status}`);
  const body = await res.json();
  return dailyMove(body?.barData?.priceBars, { allWeek: allWeekSrc(src) });
}

export function makeQuotes({ fetchImpl = cappedFetch, cache = createCache(), now = () => Date.now(), fillWaitMs = FILL_WAIT_MS } = {}) {
  // src -> { at, value } (value null: no history), and the fills queued or running.
  const fills = new Map();
  const pending = new Map();
  const queue = [];
  let running = 0;
  const fillFor = (src) => fills.get(src)?.value || null;
  function pump() {
    while (running < FILL_CONCURRENCY && queue.length) {
      const { src, done } = queue.shift();
      running += 1;
      fetchDailyMove(fetchImpl, src, now())
        .catch(() => null)
        .then((value) => {
          // A failed or empty refill keeps the last good fill (tried again after the TTL).
          fills.set(src, { at: now(), value: value ?? fills.get(src)?.value ?? null });
          pending.delete(src);
          running -= 1;
          done();
          pump();
        });
    }
  }
  function warm(src) {
    const f = fills.get(src);
    if (f && now() - f.at < DAILY_FILL_TTL) return Promise.resolve();
    if (!pending.has(src)) pending.set(src, new Promise((done) => { queue.push({ src, done }); pump(); }));
    return pending.get(src);
  }

  // Every registry instrument in one upstream call: MARKETS, HOME, the tape, the FX
  // majors, the yields and each instrument screen all read from it.
  // The source now and then leaves a row out of a batch. The last good row for that
  // symbol fills the gap, so a table row does not blink out for 15 seconds.
  const lastGood = new Map();
  const valid = (r) => r && Number(r.code) === 0 && Number.isFinite(parseNum(r.last));
  async function batch() {
    return cache.cached('quotes:all', QUOTES_TTL, async () => {
      const rows = await fetchCnbcRows(fetchImpl, ALL.map((i) => i.src));
      const ok = rows.filter(valid);
      if (ok.length < ALL.length / 2) throw new Error('quotes source: too few rows');
      for (const r of ok) lastGood.set(r.symbol, r);
      const have = new Set(ok.map((r) => r.symbol));
      const all = [...ok, ...ALL.filter((i) => !have.has(i.src) && lastGood.has(i.src)).map((i) => lastGood.get(i.src))];
      const noMove = all.filter(needsFill);
      if (noMove.length) {
        let timer;
        const wait = new Promise((r) => { timer = setTimeout(r, fillWaitMs); timer.unref?.(); });
        await Promise.race([Promise.all(noMove.map((r) => warm(r.symbol))), wait]);
        clearTimeout(timer);
      }
      return all;
    });
  }

  async function list(items) {
    const { value, stale, fetchedAt } = await batch();
    return { value: parseListRows(items, value, fillFor), stale, updated: new Date(fetchedAt).toISOString() };
  }

  const api = {
    async getQuotes() {
      const { value, stale, updated } = await list(INSTRUMENTS);
      return { instruments: withBp(value), stale, updated };
    },
    async getFxMajors() {
      const { value, stale, updated } = await list(FX_MAJORS);
      return { pairs: value, stale, updated };
    },
    // RATES asks for its three; CURVE for the whole curve (CURVE_IDS). Both read the one
    // shared batch, so the same yield has the same value, time and tag on both screens.
    async getYields(ids = null) {
      const items = ids ? ids.map(instrumentById).filter(Boolean).map((i) => ({ ...i, name: i.longName || i.name })) : YIELDS;
      const { value, stale, updated } = await list(items);
      return { yields: value, stale, updated };
    },
    // Resolves to null for an unknown ticker.
    async getQuote(rawTicker) {
      const ticker = normalizeTicker(rawTicker);
      if (!ticker) return null;
      const inst = instrumentById(ticker);
      if (inst) {
        const { value, stale, fetchedAt } = await batch();
        const quote = parseQuoteRow(value.find((r) => r.symbol === inst.src), ticker, fillFor(inst.src));
        return quote ? { ...quote, stale, updated: new Date(fetchedAt).toISOString() } : null;
      }
      const { value, stale, fetchedAt } = await cache.cached(`quote:${ticker}`, QUOTES_TTL, async () => {
        const rows = await fetchStockRows(fetchImpl, [stockSymbol(ticker)]);
        return { quote: stockQuoteOrGap(rows[0], ticker) };
      });
      if (!value.quote) return null;
      return { ...value.quote, stale, updated: new Date(fetchedAt).toISOString() };
    },
    // Many symbols at once (WATCH, PORTFOLIO, HOME): named instruments come from the
    // shared batch, stocks from the per-ticker cache. The stocks that are not cached
    // share one upstream call. Unknown or failed symbols are listed in `missing`.
    async getQuoteList(rawTickers) {
      const tickers = [...new Set(rawTickers.map(normalizeTicker).filter(Boolean))].slice(0, MAX_LIST);
      const stocks = tickers.filter((t) => !instrumentById(t));
      let shared = null;
      let failed = null;
      const fetchStocks = () => {
        shared ||= fetchStockRows(fetchImpl, stocks.map(stockSymbol)).then((rows) => {
          const bySym = new Map(rows.map((r) => [String(r.symbol || '').toUpperCase(), r]));
          // One symbol asked, one row back: the same rule as getQuote. Otherwise match by
          // symbol only, so a row can never land on the wrong ticker.
          return (t) => bySym.get(stockSymbol(t)) || (stocks.length === 1 && rows.length === 1 ? rows[0] : undefined);
        });
        return shared;
      };
      const one = async (t) => {
        try {
          if (instrumentById(t)) return await api.getQuote(t);
          const { value, stale, fetchedAt } = await cache.cached(`quote:${t}`, QUOTES_TTL, async () => {
            const pick = await fetchStocks();
            return { quote: stockQuoteOrGap(pick(t), t) };
          });
          return value.quote ? { ...value.quote, stale, updated: new Date(fetchedAt).toISOString() } : null;
        } catch (err) {
          // A gap in one row lists that symbol as missing; only a failed call is an outage.
          if (!err.gap) failed = err;
          return null;
        }
      };
      const got = await Promise.all(tickers.map(one));
      const quotes = got.filter(Boolean);
      const missing = tickers.filter((t, i) => !got[i]);
      // Nothing came back and the source failed: an outage, not a list of bad symbols.
      if (!quotes.length && failed) throw failed;
      const updated = quotes.map((q) => q.updated).sort()[0] || new Date().toISOString();
      return { quotes, missing, stale: quotes.some((q) => q.stale), updated };
    },
  };
  return api;
}

// The most symbols one /api/quotes call takes.
export const MAX_LIST = 60;

// The one live instance: every screen that shows a registry quote reads this batch.
export const sharedQuotes = makeQuotes({ cache: createCache({ maxEntries: 2000 }) });
export const { getQuotes, getFxMajors, getYields, getQuote, getQuoteList } = sharedQuotes;
