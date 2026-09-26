// TRENDING: the tickers people open most on Bloombroke. A popularity count only.
//
// Privacy: nothing here is written to disk or logged. The browser sends a random id made
// for its session (POST /api/seen { s, v }); the server keeps a short keyed hash of it
// (the key is random per process and never stored), so the id cannot be matched to
// anything after a restart. No IP address or cookie is kept: the rate limit keys on a
// keyed hash of the address bucket, held in memory for one minute.
//
// Counting: each session id counts once per symbol per hour, in one-minute buckets over a
// sliding 60 minutes, plus hourly buckets for a 24 hour rollup. Memory is capped: at most
// MAX_SYMBOLS symbols and MAX_IDS session hashes per symbol.

import express from 'express';
import { createHmac, randomBytes } from 'node:crypto';
import { resolveInstrument } from '../public/instruments.js';
import { LISTED_TICKERS, nameForTicker } from '../public/known-tickers.js';
import { createLimiter, clientIp } from '../pro/ratelimit.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

export const TRENDING_LIMITS = {
  maxSymbols: 500, // symbols tracked at once
  maxIds: 1000, // session hashes kept per symbol (the last hour's)
  maxSessions: 20_000, // session hashes kept for the "sessions in the last hour" total
  top: 10,
  minHourSessions: 3, // fewer distinct sessions than this in the last hour: show 24 hours
  perMinute: 30, // /api/seen calls per client per minute
  bodyBytes: 256,
};

// Browsers only. Anything that says it is a bot, a script or a headless browser is not counted.
const BOT_UA = /bot|crawl|spider|slurp|headless|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|undici|libwww|httpclient|http-client|scrapy|phantom|puppeteer|playwright|selenium|lighthouse|facebookexternalhit|preview|monitor|uptime|^node/i;
export function isBot(ua) {
  const s = typeof ua === 'string' ? ua : '';
  return !s || s.length > 512 || !/^Mozilla\//.test(s) || BOT_UA.test(s);
}

// A session id from the browser: 16 to 64 letters, digits, - or _.
export function validSessionId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);
}

const sumSince = (buckets, from) => {
  let n = 0;
  for (const [k, c] of buckets) if (k >= from) n += c;
  return n;
};

// The in-memory counter. now() is injectable for tests.
export function createTracker({ now = () => Date.now(), secret = randomBytes(32), limits = {} } = {}) {
  const L = { ...TRENDING_LIMITS, ...limits };
  const symbols = new Map(); // symbol -> { seen: Map<hash, t>, mins: Map<minute, n>, hours: Map<hour, n> }
  const sessions = new Map(); // hash -> last time it counted anything
  let lastSweep = -Infinity;

  const hash = (v) => createHmac('sha256', secret).update(v).digest('hex').slice(0, 12);

  function prune(entry, t) {
    for (const [h, at] of entry.seen) { if (t - at >= HOUR) entry.seen.delete(h); else break; }
    const m = Math.floor(t / MIN) - 59;
    for (const k of entry.mins.keys()) if (k < m) entry.mins.delete(k);
    const hr = Math.floor(t / HOUR) - 23;
    for (const k of entry.hours.keys()) if (k < hr) entry.hours.delete(k);
  }

  function sweep(t) {
    lastSweep = t;
    for (const [s, e] of symbols) {
      prune(e, t);
      if (!e.hours.size) symbols.delete(s);
    }
    for (const [h, at] of sessions) { if (t - at >= HOUR) sessions.delete(h); else break; }
  }

  function dayTotal(e, t) { return sumSince(e.hours, Math.floor(t / HOUR) - 23); }

  // Room for a new symbol: drop expired ones, then the one with the fewest views today.
  function makeRoom(t) {
    if (symbols.size < L.maxSymbols) return;
    sweep(t);
    if (symbols.size < L.maxSymbols) return;
    let low = null;
    let lowN = Infinity;
    for (const [s, e] of symbols) {
      const n = dayTotal(e, t);
      if (n < lowN) { low = s; lowN = n; }
    }
    if (low) symbols.delete(low);
  }

  return {
    // One view of a (valid) symbol by a session id. True when it counted.
    hit(symbol, sessionId) {
      if (!validSessionId(sessionId)) return false;
      const t = now();
      if (t - lastSweep >= MIN) sweep(t);
      const h = hash(sessionId);
      let e = symbols.get(symbol);
      if (e) {
        const at = e.seen.get(h);
        if (at !== undefined && t - at < HOUR) return false; // once per symbol per hour
        if (at === undefined && e.seen.size >= L.maxIds) {
          prune(e, t);
          if (e.seen.size >= L.maxIds) return false; // full: stop counting, never double count
        }
      } else {
        makeRoom(t);
        e = { seen: new Map(), mins: new Map(), hours: new Map() };
        symbols.set(symbol, e);
      }
      e.seen.delete(h);
      e.seen.set(h, t); // oldest first, so prune can stop early
      const m = Math.floor(t / MIN);
      const hr = Math.floor(t / HOUR);
      e.mins.set(m, (e.mins.get(m) || 0) + 1);
      e.hours.set(hr, (e.hours.get(hr) || 0) + 1);
      if (sessions.has(h) || sessions.size < L.maxSessions) {
        sessions.delete(h);
        sessions.set(h, t);
      }
      return true;
    },

    // The top symbols: the last hour when at least minHourSessions distinct sessions opened
    // something in it, otherwise the last 24 hours. { window: 'hour' | 'day', rows: [{ s, n }] }
    top() {
      const t = now();
      sweep(t);
      const fromMin = Math.floor(t / MIN) - 59;
      const fromHour = Math.floor(t / HOUR) - 23;
      const hourSessions = sessions.size; // sweep left only the last hour's
      const window = hourSessions >= L.minHourSessions ? 'hour' : 'day';
      const rows = [];
      for (const [s, e] of symbols) {
        const n = window === 'hour' ? sumSince(e.mins, fromMin) : sumSince(e.hours, fromHour);
        if (n > 0) rows.push({ s, n });
      }
      rows.sort((a, b) => b.n - a.n || (a.s < b.s ? -1 : 1));
      return { window, rows: rows.slice(0, L.top) };
    },

    // For tests: how much is held.
    size() {
      let ids = 0;
      for (const e of symbols.values()) ids += e.seen.size;
      return { symbols: symbols.size, ids, sessions: sessions.size };
    },
  };
}

// A symbol from the browser -> the id to count, or null. Registry instruments (indexes,
// FX, crypto, commodities, yields) and the listed tickers pass at once; any other
// ticker-shaped word must have a quote (the shared 15 s quote cache). Answers are kept,
// bounded, and new lookups are capped per minute so junk words cannot drive upstream calls.
export function createValidator({ getQuote, now = () => Date.now(), maxEntries = 5000, lookupsPerMinute = 30 } = {}) {
  const known = new Map(); // ticker -> { ok, until }
  const pending = new Map();
  let windowStart = 0;
  let lookups = 0;

  function remember(t, ok) {
    if (known.size >= maxEntries) known.delete(known.keys().next().value);
    known.set(t, { ok, until: now() + (ok ? DAY : HOUR) });
  }

  return async function validate(raw) {
    if (typeof raw !== 'string' || !raw || raw.length > 16) return null;
    const inst = resolveInstrument(raw);
    if (inst) return inst.id;
    const t = raw.trim().toUpperCase();
    if (LISTED_TICKERS.has(t)) return t;
    if (!TICKER_RE.test(t)) return null;
    const k = known.get(t);
    if (k && k.until > now()) return k.ok ? t : null;
    if (pending.has(t)) return pending.get(t);
    const at = now();
    if (at - windowStart >= MIN) { windowStart = at; lookups = 0; }
    if (lookups >= lookupsPerMinute) return null;
    lookups += 1;
    const p = (async () => {
      try {
        const q = await getQuote(t);
        remember(t, Boolean(q));
        return q ? t : null;
      } catch {
        return null; // a data break: not counted, not remembered
      } finally {
        pending.delete(t);
      }
    })();
    pending.set(t, p);
    return p;
  };
}

// The display name for a row: the quote's label or name, else what the browser knows.
function nameFor(s, q) {
  return q?.label || resolveInstrument(s)?.name || nameForTicker(s) || q?.name || s;
}

// POST /api/seen and GET /api/trending.
export function mountTrending(app, { getQuote, getQuoteList, tracker = createTracker(), validate = createValidator({ getQuote }), limiter, now = () => Date.now() } = {}) {
  const lim = limiter || createLimiter({ max: TRENDING_LIMITS.perMinute, windowMs: MIN, now, maxKeys: 20_000 });
  const key = randomBytes(32);
  const clientKey = (req) => createHmac('sha256', key).update(clientIp(req)).digest('hex').slice(0, 16);

  app.post('/api/seen',
    (req, res, next) => {
      if (isBot(req.get('user-agent'))) return res.status(204).end();
      if (!lim.hit(clientKey(req)).ok) return res.status(429).end();
      next();
    },
    express.text({ type: () => true, limit: TRENDING_LIMITS.bodyBytes }),
    async (req, res) => {
      let body = null;
      try { body = JSON.parse(typeof req.body === 'string' ? req.body : ''); } catch { /* ignored */ }
      if (body && typeof body === 'object' && validSessionId(body.v)) {
        const s = await validate(body.s);
        if (s) tracker.hit(s, body.v);
      }
      res.status(204).end();
    },
    // A body that is too big or unreadable: ignored, same answer.
    // eslint-disable-next-line no-unused-vars
    (err, req, res, next) => { res.status(204).end(); },
  );

  app.get('/api/trending', async (req, res) => {
    const { window, rows } = tracker.top();
    let quotes = [];
    if (rows.length) {
      try { quotes = (await getQuoteList(rows.map((r) => r.s))).quotes || []; } catch { /* prices show as -- */ }
    }
    const byId = new Map(quotes.map((q) => [q.ticker, q]));
    res.set('Cache-Control', 'public, max-age=15');
    res.json({
      window,
      updated: new Date(now()).toISOString(),
      rows: rows.map(({ s, n }) => {
        const q = byId.get(s);
        return {
          s, n, name: nameFor(s, q),
          last: Number.isFinite(q?.last) ? q.last : null,
          changePct: Number.isFinite(q?.changePct) ? q.changePct : null,
          decimals: q?.decimals ?? null,
          kind: q?.kind || resolveInstrument(s)?.kind || 'stock',
        };
      }),
    });
  });
}
