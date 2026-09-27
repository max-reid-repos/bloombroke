// BBRK: Bloombroke's own site numbers, shown as a joke quote screen (public/screens/bbrk.js).
// Totals per day only, in the Pro database (migration 011_daily_counts.sql): a day, a
// counter name and a count. No IP address, no licence, no browser id is ever stored.
//
//   Server counts  whatif_run (a WHATIF result computed), guess_played (a GUESS game
//                  solved at /api/guess/check), feedback_sent (a note saved), mcp_call
//                  (an MCP tool call that ran; -- until the MCP server enables it).
//                  whatif_run and a solved GUESS pass a count gate (makeCountGate): a few
//                  counts per IP a minute, and the same thing again within the minute is
//                  not counted twice. The answer itself is never affected.
//   Client counts  whatif_video, whatif_embed, whatif_share, guess_shared, and a GUESS
//                  game lost (guess_played, sent once from the game's finish): actions
//                  the server never sees, sent by public/goal.js to
//                  POST /api/count { name }  same origin only, allow-listed names only,
//                  5 a minute per IP (IPv6 by /64) in memory (the address is never stored).
//   Sponsor inventory  strip_shown (sponsor strip lines shown, sent in batches of 1 to 20
//                  as { name, n }), strip_click (a click on any strip line, paid or our
//                  own), embed_load (an /embed/* page served, once per IP per embed a
//                  minute; server side), mcp_call.
//   GET /api/bbrk  today, yesterday, the last 7 days and all time for each counter, the
//                  Pro seats issued in the current Stripe mode, the MRR line, the
//                  audience from DataFast (lib/datafast.js) and the sponsor inventory.

import express from 'express';
import { createLimiter, clientIp } from '../pro/ratelimit.js';
import { sameOrigin } from '../pro/feedback.js';
import { emptyAudience } from './datafast.js';

export const SERVER_COUNTS = ['whatif_run', 'guess_played', 'feedback_sent', 'mcp_call', 'embed_load'];
export const CLIENT_COUNTS = ['whatif_video', 'whatif_embed', 'whatif_share', 'guess_shared'];
// The sponsor strip: counted by the status bar (public/sponsor-strip.js), not goals.
export const STRIP_COUNTS = ['strip_shown', 'strip_click'];
export const COUNTS = [...SERVER_COUNTS, ...CLIENT_COUNTS, ...STRIP_COUNTS];
// Counters for a part of the site that may not exist yet: null (shown as --) until enabled.
export const OPTIONAL_COUNTS = ['mcp_call'];
// What a browser may POST: the client counts, and guess_played for a game lost (a solved
// game is counted by /api/guess/check instead; public/goal.js sends only the lost ones).
export const POST_COUNTS = [...CLIENT_COUNTS, 'guess_played', ...STRIP_COUNTS];
// Only strip_shown comes in batches: n is 1 to BATCH_MAX. Every other count is one.
export const BATCH_MAX = 20;
export const COUNT_LIMIT = { max: 5, windowMs: 60_000 };
// The server-side count gate: counts per IP a minute, and one count per IP per thing.
export const GATE_LIMIT = { max: 5, windowMs: 60_000 };

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

// The New York date of a time, 'YYYY-MM-DD'.
export function nyDay(ms) {
  return DAY_FMT.format(new Date(ms));
}

// The New York date n days before a 'YYYY-MM-DD' date.
export function dayBefore(day, n = 1) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

// { today, yesterday, d7, all } from a Map of day -> n and an all-time total.
function windowed(byDay, all, today) {
  const yesterday = dayBefore(today, 1);
  const from7 = dayBefore(today, 6);
  let d7 = 0;
  for (const [day, n] of byDay) if (day >= from7 && day <= today) d7 += n;
  return { today: byDay.get(today) || 0, yesterday: byDay.get(yesterday) || 0, d7, all };
}

// The MRR line comes from the config only, never from a guess: $0 while Stripe is in
// test mode (no real money moves), and nothing (--) otherwise.
export function mrrLine(mode) {
  return mode === 'test' ? 'MRR $0 (test mode)' : null;
}

export function createCounters({ now = () => Date.now() } = {}) {
  let q = null;
  const enabled = new Set(COUNTS.filter((n) => !OPTIONAL_COUNTS.includes(n)));
  return {
    // Use this database (it must have run the migrations). Until then every call is a no-op.
    attach(db) {
      q = {
        bump: db.prepare('INSERT INTO daily_counts (day, name, n) VALUES (?, ?, ?) ON CONFLICT(day, name) DO UPDATE SET n = n + excluded.n'),
        recent: db.prepare('SELECT day, name, n FROM daily_counts WHERE day >= ?'),
        totals: db.prepare('SELECT name, SUM(n) AS n FROM daily_counts GROUP BY name'),
        seats: db.prepare('SELECT created_at FROM licences WHERE livemode = ?'),
      };
      return this;
    },
    attached() { return Boolean(q); },
    enable(name) { if (COUNTS.includes(name)) enabled.add(name); },
    isEnabled(name) { return enabled.has(name); },
    // n more for today (1 by default). Never throws: a count must not break the action it counts.
    bump(name, n = 1) {
      if (!q || !enabled.has(name) || !Number.isInteger(n) || n < 1 || n > BATCH_MAX) return false;
      try {
        q.bump.run(nyDay(now()), name, n);
        return true;
      } catch {
        return false;
      }
    },
    // { day, counts: { name: { today, yesterday, d7, all } | null }, seats } where seats
    // counts the licences made in the given Stripe mode ('test' or 'live'), or is null.
    stats({ mode = null } = {}) {
      const today = nyDay(now());
      const counts = Object.fromEntries(COUNTS.map((n) => [n, null]));
      if (!q) return { day: today, counts, seats: null };
      const byName = new Map();
      for (const r of q.recent.all(dayBefore(today, 7))) {
        if (!byName.has(r.name)) byName.set(r.name, new Map());
        byName.get(r.name).set(r.day, r.n);
      }
      const totals = new Map(q.totals.all().map((r) => [r.name, r.n]));
      for (const n of COUNTS) {
        if (enabled.has(n)) counts[n] = windowed(byName.get(n) || new Map(), totals.get(n) || 0, today);
      }
      let seats = null;
      if (mode === 'test' || mode === 'live') {
        try {
          const days = new Map();
          const rows = q.seats.all(mode === 'live' ? 1 : 0);
          for (const r of rows) {
            const d = nyDay(r.created_at);
            days.set(d, (days.get(d) || 0) + 1);
          }
          seats = windowed(days, rows.length, today);
        } catch {
          seats = null;
        }
      }
      return { day: today, counts, seats };
    },
  };
}

// The one the server uses: attached to the Pro database by startPro (pro/index.js).
export const siteCounters = createCounters();

// A gate in front of a server count, so a loop of requests cannot inflate the numbers:
// allow(req, key) is true at most GATE_LIMIT.max times a minute per IP bucket, and only
// once a minute for the same key from the same IP. The address is held in memory for
// the minute (plus at most one minute), never stored. Full table: nothing is counted.
export function makeCountGate({ now = () => Date.now(), max = GATE_LIMIT.max, windowMs = GATE_LIMIT.windowMs, maxKeys = 20_000 } = {}) {
  const limiter = createLimiter({ max, windowMs, now, maxKeys });
  const seen = new Map(); // ip + key -> time the entry expires
  const sweep = (t) => { for (const [k, until] of seen) if (until <= t) seen.delete(k); };
  const timer = typeof setInterval === 'function' ? setInterval(() => sweep(now()), windowMs) : null;
  timer?.unref?.();
  return {
    allow(req, key = '') {
      try {
        const t = now();
        const ip = clientIp(req);
        const k = `${ip}\u0000${String(key).slice(0, 200)}`;
        const until = seen.get(k);
        if (until && until > t) return false;
        if (!until && seen.size >= maxKeys) { sweep(t); if (seen.size >= maxKeys) return false; }
        if (!limiter.hit(ip).ok) return false;
        seen.set(k, t + windowMs);
        return true;
      } catch {
        return false;
      }
    },
    size() { return seen.size; },
  };
}

// The sponsor inventory: { today, d7 } for each, null numbers when a counter is missing.
export function inventoryOf(counts) {
  const two = (c) => ({ today: c ? c.today : null, d7: c ? c.d7 : null });
  return {
    stripShown: two(counts?.strip_shown),
    stripClicks: two(counts?.strip_click),
    embedLoads: two(counts?.embed_load),
    mcpCalls: two(counts?.mcp_call),
  };
}

// audience: { get({ wait }) } (lib/datafast.js makeDataFast), or null: all --.
export function mountCounters(app, {
  counters = siteCounters, mode = null, publicUrl = 'https://bloombroke.com', now = () => Date.now(), audience = null,
  limiter = createLimiter({ ...COUNT_LIMIT, now, maxKeys: 20_000 }),
}) {
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  app.post('/api/count', express.json({ limit: '1kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Counts come from bloombroke.com only.');
    const name = req.body && typeof req.body === 'object' ? req.body.name : undefined;
    if (typeof name !== 'string' || !POST_COUNTS.includes(name)) return fail(res, 400, 'unknown', 'No such counter.');
    const n = req.body.n === undefined ? 1 : req.body.n;
    const okN = name === 'strip_shown' ? Number.isInteger(n) && n >= 1 && n <= BATCH_MAX : n === 1;
    if (!okN) return fail(res, 400, 'bad_n', `n is 1 to ${BATCH_MAX}, for strip_shown only.`);
    const r = limiter.hit(clientIp(req));
    if (!r.ok) {
      res.set('Retry-After', String(r.retryAfter));
      return fail(res, 429, 'rate_limited', 'That is a lot of counting. Try again in a minute.');
    }
    counters.bump(name, n);
    res.status(204).end();
  });
  app.use('/api/count', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large' || err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_request', 'Send { name }.');
    return next(err);
  });
  app.get('/api/bbrk', async (req, res) => {
    let aud = emptyAudience();
    try { if (audience) aud = await audience.get(); } catch { /* -- everywhere */ }
    let s;
    try {
      s = counters.stats({ mode });
    } catch (err) {
      console.error('[bbrk]', err.message);
      s = { day: nyDay(now()), counts: Object.fromEntries(COUNTS.map((n) => [n, null])), seats: null };
    }
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ updated: new Date(now()).toISOString(), day: s.day, mode, counts: s.counts, seats: s.seats, mrr: mrrLine(mode), audience: aud, inventory: inventoryOf(s.counts) });
  });
}
