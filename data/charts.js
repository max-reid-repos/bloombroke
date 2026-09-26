// Price history for charts, from the public CNBC bars service (no key).
//
// Weekly and monthly bars are stamped with the day their period starts (a Sunday for
// weeks, the 1st for months), which is not a trading day. Each such bar gets `e`, the
// real trading day its close is from: the last daily bar inside its period, from a
// second (daily) call over the same window. The bar still running (this week or
// month) is marked `p` (partial): its close is the latest price, not a period close.
// Without the daily call the bars carry no `e`, and the screen says "week of".

import { createCache } from './cache.js';
import { normalizeTicker, tickerSource, UA, dayOfWeek, weekendPlaceholder } from './quotes.js';
import { instrumentById } from '../public/instruments.js';
import { PRESETS, parseDate, isoDay, nyToday } from '../public/ranges.js';
import { barValid, isIntradayBar, presetSpanDays, parseBar, BARS } from '../public/bars.js';

const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
const DAY = 86_400_000;
const MIN = 60_000;
// Bars the source serves: 1M 5M 1H 1D 1W 1MO. Intraday history only goes back about
// three months, so older custom ranges use daily bars.
const INTRADAY_DAYS = 80;
// A response never carries more bars than this (longer series are merged, see mergeBars).
export const MAX_POINTS = 6000;
// The source serves about 90 days of intraday bars per call: longer windows go in pieces.
const CHUNK_DAYS = 85;
// Upstream bodies over this size are dropped, not parsed.
export const MAX_BODY = 8 * 1024 * 1024;

// Preset -> bar size, how far back, and how long a chart stays cached.
const PRESET_SPEC = {
  '1D': { bar: '5M', days: 6, sessions: 1, ttl: MIN },
  '5D': { bar: '5M', days: 10, sessions: 5, ttl: MIN },
  '1M': { bar: '1D', days: 31, ttl: 15 * MIN },
  '3M': { bar: '1D', days: 92, ttl: 15 * MIN },
  '6M': { bar: '1D', days: 183, ttl: 15 * MIN },
  YTD: { bar: '1D', ytd: true, ttl: 15 * MIN },
  '1Y': { bar: '1D', days: 366, ttl: 15 * MIN },
  '2Y': { bar: '1D', days: 731, ttl: 15 * MIN },
  '5Y': { bar: '1W', days: 5 * 366, ttl: 60 * MIN },
  '10Y': { bar: '1W', days: 10 * 366, ttl: 60 * MIN },
  MAX: { bar: '1MO', from: '1900-01-01', ttl: 6 * 60 * MIN },
};
export const RANGES = PRESET_SPEC;

// Bar size for a custom FROM/TO range: intraday for a few recent days, daily up to
// about two years, weekly up to twenty, monthly beyond.
export function barFor(fromMs, toMs, nowMs) {
  const days = (toMs - fromMs) / DAY;
  if (days <= 7 && nowMs - fromMs <= INTRADAY_DAYS * DAY) return days <= 3 ? '5M' : '1H';
  if (days <= 800) return '1D';
  if (days <= 20 * 366) return '1W';
  return '1MO';
}

// Symbols on the New York session: their intraday charts show 9:30 to 16:00 ET only.
function usSession(ticker) {
  const inst = instrumentById(ticker);
  return inst ? Boolean(inst.us) && inst.kind === 'index' && !inst.allDay : true;
}

// Plain stock and ETF tickers (not in the registry) trade before and after the session.
const hasExtendedHours = (ticker) => !instrumentById(ticker);
// Volume is shares or contracts only for stocks, ETFs and futures; for FX, indexes,
// yields and crypto the source's number is a tick count or zero.
const hasVolume = (ticker) => { const inst = instrumentById(ticker); return !inst || inst.kind === 'future'; };
// Crypto trades around the clock: its 1D and 5D are the last 24 hours and 5 days.
const aroundTheClock = (ticker) => instrumentById(ticker)?.kind === 'crypto';
// FX, spot metals, futures and the round-the-clock US indexes (the dollar index) trade
// from Sunday evening to Friday 17:00 New York time. Their trading day runs 17:00 to
// 17:00, as the market dates it (see sessionDay).
const rollsAt17 = (ticker) => {
  const inst = instrumentById(ticker);
  return Boolean(inst) && (inst.kind === 'fx' || inst.kind === 'spot' || inst.kind === 'future' || (inst.kind === 'index' && Boolean(inst.allDay)));
};

export class ChartError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function stamp(date) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 8);
}

// CNBC priceBars -> [{ t, d, v, o, h, l, x }], oldest first. d is "YYYYMMDDHHMMSS" in
// New York time, v the close, o h l the open, high and low (when the source sends them
// and they make sense), x the volume (when above zero, and only with volume: true; the
// source's FX and index "volume" is a tick count, not shares or contracts).
export function shapeBars(bars, { volume = true } = {}) {
  return (Array.isArray(bars) ? bars : [])
    .map((b) => {
      const p = { t: Number(b?.tradeTimeinMills), d: String(b?.tradeTime || ''), v: Number(b?.close) };
      const o = Number(b?.open);
      const h = Number(b?.high);
      const l = Number(b?.low);
      if ([o, h, l].every((n) => Number.isFinite(n) && n > 0) && h >= l && h >= Math.max(o, p.v) - 1e-9 && l <= Math.min(o, p.v) + 1e-9) {
        p.o = o; p.h = h; p.l = l;
      }
      const x = Number(b?.volume);
      if (volume && Number.isFinite(x) && x > 0) p.x = x;
      return p;
    })
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0 && /^\d{14}$/.test(p.d))
    .sort((a, b) => a.t - b.t);
}

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const startMin = (d) => { const hm = Number(d.slice(8, 12)); return Math.floor(hm / 100) * 60 + (hm % 100); };

// A bar of `mins` minutes starting at New York time d: inside the 09:30 to 16:00
// session? Any bar that overlaps it (a 1h bar from 09:00 holds the open). A bar from
// 16:00 on holds only after-hours prints (the 16:00 bar closes on trades after the bell),
// so it is not in the session: the session's close comes from the daily bar instead
// (officialCloses).
export function inRegular(d, mins = 5) {
  const start = startMin(d);
  return start + mins > OPEN_MIN && start < CLOSE_MIN;
}

// The official close of each finished session on its last bar. The source's last
// session bar closes on its last trade, not on the closing auction, so its close is set
// to that day's daily close (and its high and low widened to hold it). Only a session
// whose last bar reaches 16:00 is finished.
export function officialCloses(points, daily, mins) {
  const closes = new Map((daily || []).map((p) => [p.d.slice(0, 8), p.v]));
  const lastOfDay = new Map();
  points.forEach((p, i) => { if (inRegular(p.d, mins)) lastOfDay.set(p.d.slice(0, 8), i); });
  const out = points.slice();
  for (const [day, i] of lastOfDay) {
    const c = closes.get(day);
    const p = out[i];
    if (!Number.isFinite(c) || startMin(p.d) + mins < CLOSE_MIN) continue;
    out[i] = { ...p, v: c, ...(p.o !== undefined ? { h: Math.max(p.h, c), l: Math.min(p.l, c) } : {}) };
  }
  return out;
}

// Intraday volume only inside the session: the source repeats and inflates prints
// outside it. Daily and longer bars keep theirs.
export function sessionVolume(points, mins) {
  return points.map((p) => {
    if (!p.x || inRegular(p.d, mins)) return p;
    const { x, ...rest } = p;
    return rest;
  });
}

// A bar from 04:00 to 20:00 New York time: pre-market, the session and after hours.
const inExtended = (d) => { const hm = Number(d.slice(8, 12)); return hm >= 400 && hm < 2000; };

const nextDay = (day, n = 1) => {
  const t = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + n));
  return t.toISOString().slice(0, 10).replace(/-/g, '');
};

// The trading day (YYYYMMDD) a bar starting at New York time d belongs to. By default its
// calendar day. With roll (FX, spot metals, futures) the day runs 17:00 to 17:00: a bar
// from 17:00 on belongs to the next day, and Sunday's bars to Monday. A Saturday bar, or
// one from Friday 17:00 on, lands on a Saturday: no such market trades then.
export function sessionDay(d, roll = false) {
  const day = d.slice(0, 8);
  if (!roll) return day;
  const dow = dayOfWeek(day);
  if (dow === 6) return day;
  if (dow === 0) return nextDay(day);
  return startMin(d) >= 17 * 60 ? nextDay(day) : day;
}

// Fewer intraday bars than this in a trading day is a stray print, not a session.
export const MIN_SESSION_BARS = 3;

// Intraday bars without the stray ones, for everything but crypto. The source now and
// then sends a lone print on a day the market is shut (AAPL at 12:20 on a Saturday, the
// S&P 500 at 12:10 on a Sunday), which would otherwise be "the last session". Dropped:
// every bar on a Saturday trading day (see sessionDay), and every day with fewer than
// MIN_SESSION_BARS bars, except a weekday session still running (today, or with roll
// a Monday that opened on Sunday evening), which may have just begun.
// today: the New York day, YYYYMMDD.
export function dropStrays(points, { roll = false, today = '' } = {}) {
  const count = new Map();
  for (const p of points) {
    const day = sessionDay(p.d, roll);
    count.set(day, (count.get(day) || 0) + 1);
  }
  const keep = (day) => {
    const dow = dayOfWeek(day);
    if (dow === 6) return false;
    if (count.get(day) >= MIN_SESSION_BARS) return true;
    return dow !== 0 && Boolean(today) && day >= today;
  };
  return points.filter((p) => keep(sessionDay(p.d, roll)));
}

// Daily bars without the placeholders the source dates on a weekend (weekendPlaceholder
// in quotes.js: a Saturday bar, or a Sunday bar that never moved), for everything but
// crypto: the market was shut, and the price is Friday's again.
export const dropWeekendDaily = (points) => points.filter((p) => !weekendPlaceholder(p));

// Keep the most recent trading day(s). For US symbols keep the regular session only,
// or with ext (a stock's 1D) pre-market and after hours too. roll: days run 17:00 to
// 17:00 (sessionDay). Stray days are dropped before this (dropStrays).
export function lastSession(points, { usSession = true, sessions = 1, ext = false, mins = 5, roll = false } = {}) {
  const inSession = (p) => {
    if (!usSession) return true;
    return ext ? inExtended(p.d) : inRegular(p.d, mins);
  };
  const kept = points.filter(inSession);
  if (!kept.length) return [];
  const dayOf = (p) => sessionDay(p.d, roll);
  const days = [...new Set(kept.map(dayOf))].slice(-sessions);
  return kept.filter((p) => days.includes(dayOf(p)));
}

// The last `days` x 24 hours before the last bar (crypto).
export function lastHours(points, days = 1) {
  if (!points.length) return [];
  const from = points[points.length - 1].t - days * DAY;
  return points.filter((p) => p.t > from);
}

// Weekly/monthly points + daily points -> the same points with e (ms of the last
// daily bar inside each period) where one exists. Periods are compared as New York
// days (the d field), [this bar's day, the next bar's day).
// The daily close there must equal the bar's close (within 0.05%), or the day is not
// claimed: the bar then says only its period.
export function barEnds(points, daily) {
  const days = (daily || []).map((p) => ({ day: p.d.slice(0, 8), t: p.t, v: p.v })).sort((a, b) => a.t - b.t);
  let j = 0;
  return points.map((p, i) => {
    const start = p.d.slice(0, 8);
    const next = points[i + 1]?.d.slice(0, 8) || '99999999';
    while (j < days.length && days[j].day < start) j += 1;
    let k = j;
    let hit = null;
    while (k < days.length && days[k].day < next) { hit = days[k]; k += 1; }
    return hit && Math.abs(hit.v - p.v) <= p.v * 0.0005 ? { ...p, e: hit.t } : p;
  });
}

// Is a weekly or monthly bar starting on New York day d (YYYYMMDD) still running today?
export function isPartial(d, bar, today) {
  const start = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (bar === '1MO') return start.slice(0, 7) === today.slice(0, 7);
  if (bar === '1W') return (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY < 7;
  return false;
}

// Thin a long series to at most `max` points, always keeping the first and the last.
export function thin(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

// A series over `max` bars becomes `max` merged bars: each keeps the first bar's time,
// the open of its first bar, the highest high, the lowest low, the close of its last bar
// and the summed volume, so no high or low is lost. te is the last bar's time, so the
// chart can say the span ("SEP 1 - SEP 2"). mergeFactor says how many bars each holds.
export const mergeFactor = (n, max = MAX_POINTS) => (n <= max ? 1 : Math.ceil(n / max));
export function mergeBars(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  const k = mergeFactor(points.length, max);
  const out = [];
  for (let i = 0; i < points.length; i += k) {
    const g = points.slice(i, i + k);
    const first = g[0];
    const last = g[g.length - 1];
    const m = { ...last, t: first.t, d: first.d, te: last.t };
    const hs = g.map((p) => p.h ?? p.v);
    const ls = g.map((p) => p.l ?? p.v);
    m.o = first.o ?? first.v;
    m.h = Math.max(...hs);
    m.l = Math.min(...ls);
    const x = g.reduce((s, p) => s + (p.x || 0), 0);
    if (x > 0) m.x = x; else delete m.x;
    out.push(m);
  }
  return out;
}

// Resolve what to fetch: a preset, or a custom FROM (and optional TO) in YYYY-MM-DD.
// bar: an explicit bar size from the whitelist (public/bars.js), checked against the
// window; without one the window picks its own. An explicit intraday bar on a stock's 1D
// keeps pre-market and after hours (ext).
export function chartWindow({ range, from, to, bar: wantBar = null }, now = new Date()) {
  const nowMs = now.getTime();
  const badBar = () => new ChartError('bad_bar', 'That bar size does not fit this range.');
  if (from) {
    const f = parseDate(from);
    const t = to ? parseDate(to) : null;
    if (!f || (to && !t)) throw new ChartError('bad_date', 'Dates look like 2020-01-31.');
    const toMs = t ? t.getTime() + DAY : nowMs + DAY;
    if (f.getTime() > nowMs) throw new ChartError('bad_date', 'FROM is in the future.');
    if (t && f.getTime() >= t.getTime()) throw new ChartError('bad_date', 'FROM has to be before TO.');
    const spanDays = (Math.min(toMs, nowMs) - f.getTime()) / DAY;
    if (wantBar && !barValid(wantBar, { spanDays: Math.max(spanDays, 1), ageDays: (nowMs - f.getTime()) / DAY })) throw badBar();
    const bar = wantBar || barFor(f.getTime(), Math.min(toMs, nowMs), nowMs);
    // Long daily-or-longer windows are fetched and cached by whole months, so windows
    // that differ by a few days (a zoom, a typed date) share one entry; the answer is cut
    // back to the dates asked for (clip).
    let start = f;
    let end = new Date(toMs);
    let snapped = false;
    if (!isIntradayBar(bar) && spanDays > 120) {
      start = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1));
      const e = new Date(toMs - 1);
      const monthEnd = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1);
      end = t && monthEnd < nowMs ? new Date(monthEnd) : new Date(nowMs + DAY);
      snapped = true;
    }
    const open = end.getTime() > nowMs;
    const ttl = !open ? 6 * 60 * MIN : isIntradayBar(bar) ? MIN : 15 * MIN;
    const keyEnd = snapped ? (open ? 'now' : isoDay(end)) : t ? isoDay(t) : 'now';
    return {
      key: `${isoDay(start)}:${keyEnd}${wantBar ? `:${wantBar}` : ''}`, start, end, bar, ttl,
      from: isoDay(f), to: t ? isoDay(t) : null, regular: Boolean(wantBar) && isIntradayBar(bar),
      clip: snapped ? [f.getTime(), toMs] : null,
    };
  }
  const r = String(range || '1Y').toUpperCase();
  const spec = PRESET_SPEC[r];
  if (!spec) throw new ChartError('bad_range', `Pick a range: ${PRESETS.join(' ')}.`);
  let start;
  if (spec.ytd) start = new Date(Date.UTC(Number(nyToday(now).slice(0, 4)), 0, 1));
  else if (spec.from) start = parseDate(spec.from);
  else start = new Date(nowMs - spec.days * DAY);
  if (wantBar) {
    const spanDays = presetSpanDays(r, now);
    if (!barValid(wantBar, { spanDays, ageDays: spanDays + (r === '5D' ? 3 : 0) })) throw badBar();
  }
  const bar = wantBar || spec.bar;
  const intraday = isIntradayBar(bar);
  return {
    key: wantBar ? `${r}:${wantBar}` : r, range: r, start, end: new Date(nowMs + DAY), bar,
    ttl: intraday ? MIN : spec.ttl, sessions: spec.sessions,
    ext: Boolean(wantBar) && r === '1D' && intraday,
    regular: Boolean(wantBar) && intraday && !spec.sessions,
  };
}

// /api/chart query -> what getChart takes: a preset name, { from, to }, or either with
// an explicit bar. A bar off the whitelist (public/bars.js) is a bad_bar error.
export function chartSpecFromQuery({ r, from, to, bar } = {}) {
  const b = bar ? parseBar(bar) : null;
  if (bar && !b) throw new ChartError('bad_bar', `Pick a bar size: ${BARS.join(' ')}.`);
  const base = from ? { from, to: to || null } : { range: r };
  if (b) return { ...base, bar: b };
  return from ? base : r;
}

// [start, end) cut into pieces the source serves in one call (intraday bars only).
export function chunks(start, end, bar) {
  const ms = end.getTime() - start.getTime();
  if (!isIntradayBar(bar) || ms <= CHUNK_DAYS * DAY) return [{ start, end }];
  const out = [];
  for (let a = start.getTime(); a < end.getTime(); a += CHUNK_DAYS * DAY) {
    out.push({ start: new Date(a), end: new Date(Math.min(end.getTime(), a + CHUNK_DAYS * DAY)) });
  }
  return out;
}

// A JSON body read with a size cap: a Content-Length over the cap, or a stream that
// grows past it, is an error. Test doubles without a stream use their json().
export async function readJson(res, cap = MAX_BODY) {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > cap) throw new Error('chart source: body too large');
  const reader = res.body?.getReader?.();
  if (!reader) return res.json();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { reader.cancel().catch(() => {}); throw new Error('chart source: body too large'); }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts.map((p) => Buffer.from(p))).toString('utf8'));
}

// Clip cached bars back to [fromMs, toMs): weekly and monthly bars whose period started
// a little before FROM stay.
export function clipBars(points, [fromMs, toMs], bar) {
  const lead = bar === '1W' ? 7 * DAY : bar === '1MO' ? 31 * DAY : 0;
  return points.filter((p) => p.t < toMs && (lead ? p.t > fromMs - lead : p.t >= fromMs));
}

// Charts are the biggest cache values (up to MAX_POINTS bars each): at most 200 of them
// and 250,000 bars in all (tens of MB), least recently used dropped first.
export const CHART_CACHE = { maxEntries: 200, maxWeight: 250_000 };
export function makeCharts({ fetchImpl = globalThis.fetch, cache = createCache({ ...CHART_CACHE, lru: true, weigh: (v) => v?.points?.length || 0 }), now = () => new Date() } = {}) {
  async function bars(src, bar, win) {
    const url = `${BARS_URL}/${encodeURIComponent(src)}/${bar}/${stamp(win.start)}000000/${stamp(win.end)}000000/adjusted/EST5EDT.json`;
    // 1-minute bars are the biggest answers: a little longer to arrive.
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(bar === '1M' ? 12_000 : 8000) });
    if (!res.ok) throw new Error(`chart source HTTP ${res.status}`);
    return readJson(res);
  }

  // One call, or several for a long intraday window, joined oldest first.
  async function barsJoined(src, bar, win) {
    const parts = chunks(win.start, win.end, bar);
    if (parts.length === 1) return bars(src, bar, win);
    const bodies = await Promise.all(parts.map((p) => bars(src, bar, p)));
    const ok = bodies.filter((b) => b?.barData);
    if (!ok.length) return bodies[0];
    const seen = new Set();
    const priceBars = ok.flatMap((b) => b.barData.priceBars || []).filter((b) => {
      const k = b?.tradeTimeinMills;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { barData: { ...ok[0].barData, priceBars } };
  }

  async function load(ticker, win) {
    const src = tickerSource(ticker);
    const long = win.bar === '1W' || win.bar === '1MO';
    const intraday = isIntradayBar(win.bar);
    const session = usSession(ticker);
    // Daily bars alongside: the end days of weekly and monthly bars, and the official
    // close of each session on intraday bars.
    const wantDaily = long || (intraday && session);
    const [main, daily] = await Promise.allSettled([barsJoined(src, win.bar, win), wantDaily ? bars(src, '1D', win) : Promise.resolve(null)]);
    if (main.status === 'rejected') throw main.reason;
    const body = main.value;
    if (body?.status === 'ERROR' || !body?.barData) return { points: [], notFound: true };
    let points = shapeBars(body.barData.priceBars, { volume: hasVolume(ticker) });
    const mins = ({ '1M': 1, '5M': 5, '30M': 30, '1H': 60 }[win.bar]) || 5;
    const allWeek = aroundTheClock(ticker);
    const roll = rollsAt17(ticker);
    // Stray weekend prints out first, so the last session is a real one (Friday's, on a
    // weekend) and the chart ends on its close.
    if (!allWeek && intraday) points = dropStrays(points, { roll, today: nyToday(now()).replace(/-/g, '') });
    if (!allWeek && win.bar === '1D') points = dropWeekendDaily(points);
    const dailyBars = () => {
      const d = daily.status === 'fulfilled' ? shapeBars(daily.value?.barData?.priceBars) : [];
      return allWeek ? d : dropWeekendDaily(d);
    };
    // 1D and 5D: intraday bars keep the last trading day(s); daily bars (5D with D) are
    // the last five, with no session filter (a daily bar is stamped at midnight).
    if (win.sessions && !intraday) points = points.slice(-win.sessions);
    else if (win.sessions && allWeek) points = lastHours(points, win.sessions);
    else if (win.sessions) points = lastSession(points, { usSession: session, sessions: win.sessions, ext: win.ext && hasExtendedHours(ticker), mins, roll });
    else if (win.regular && session) points = points.filter((p) => inRegular(p.d, mins));
    if (intraday && session) points = officialCloses(points, dailyBars(), mins);
    if (intraday) points = sessionVolume(points, mins);
    if (long) {
      const d = dailyBars();
      if (d.length) points = barEnds(points, d);
      const today = nyToday(now());
      points = points.map((p) => (isPartial(p.d, win.bar, today) ? { ...p, p: true } : p));
    }
    // The New York day string (d) was only needed above: the cache keeps bars without it.
    const merged = mergeBars(points).map(({ d, ...rest }) => rest);
    return { points: merged, merged: mergeFactor(points.length), notFound: false };
  }

  // getChart('AAPL', '5Y') or getChart('AAPL', { from: '2020-01-01', to: '2024-12-31' }),
  // either with an explicit bar: getChart('AAPL', { range: '1D', bar: '1M' }).
  async function getChart(rawTicker, rawRange = '1Y') {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) throw new ChartError('bad_symbol', 'That does not look like a ticker.');
    const spec = typeof rawRange === 'object' && rawRange ? rawRange : { range: rawRange };
    const win = chartWindow(spec, now());
    let got;
    try {
      got = await cache.cached(`chart:${ticker}:${win.key}`, win.ttl, () => load(ticker, win));
    } catch {
      throw new ChartError('unavailable', 'Chart data is taking a break. Try again in a minute.');
    }
    const { value, stale, fetchedAt } = got;
    const label = win.range || `${win.from} to ${win.to || 'today'}`;
    if (value.notFound) throw new ChartError('not_found', `No chart for ${ticker}.`);
    const pts = win.clip ? clipBars(value.points, win.clip, win.bar) : value.points;
    if (pts.length < 2) throw new ChartError('no_data', `No ${label} chart for ${ticker} yet.`);
    return {
      ticker, range: win.range || null, from: win.from || null, to: win.to || null, bar: win.bar,
      ext: Boolean(win.ext && hasExtendedHours(ticker)),
      ...(value.merged > 1 ? { merged: value.merged } : {}),
      points: pts.map(({ t, v, o, h, l, x, e, p, te }) => ({
        t, v, ...(o !== undefined ? { o, h, l } : {}), ...(x ? { x } : {}), ...(e ? { e } : {}), ...(p ? { p: true } : {}), ...(te ? { te } : {}),
      })),
      stale, updated: new Date(fetchedAt).toISOString(),
    };
  }

  return { getChart };
}

export const { getChart } = makeCharts();
