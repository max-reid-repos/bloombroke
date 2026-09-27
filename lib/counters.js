// BBRK: Bloombroke's own site numbers, shown as a joke quote screen (public/screens/bbrk.js).
// Totals per day only, in the Pro database (migration 011_daily_counts.sql): a day, a
// counter name and a count. No IP address, no licence, no browser id is ever stored.
//
//   Server counts  whatif_run (a WHATIF result computed), guess_played (a GUESS game
//                  finished: solved at /api/guess/check, or the answer shown at
//                  /api/guess/reveal), feedback_sent (a note saved), mcp_call (an MCP
//                  tool call; shown as -- until the MCP server calls enable('mcp_call')).
//   Client counts  whatif_video, whatif_embed, whatif_share, guess_shared: actions that
//                  never reach the server, sent by public/goal.js to
//                  POST /api/count { name }  same origin only, allow-listed names only,
//                  rate limited per IP in memory (the address is never stored).
//   GET /api/bbrk  today, yesterday, the last 7 days and all time for each counter, the
//                  Pro seats issued in the current Stripe mode, and the MRR line.

import express from 'express';
import { createLimiter, clientIp } from '../pro/ratelimit.js';
import { sameOrigin } from '../pro/feedback.js';

export const SERVER_COUNTS = ['whatif_run', 'guess_played', 'feedback_sent', 'mcp_call'];
export const CLIENT_COUNTS = ['whatif_video', 'whatif_embed', 'whatif_share', 'guess_shared'];
export const COUNTS = [...SERVER_COUNTS, ...CLIENT_COUNTS];
// Counters for a part of the site that may not exist yet: null (shown as --) until enabled.
export const OPTIONAL_COUNTS = ['mcp_call'];
export const COUNT_LIMIT = { max: 20, windowMs: 60_000 };

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
        bump: db.prepare('INSERT INTO daily_counts (day, name, n) VALUES (?, ?, 1) ON CONFLICT(day, name) DO UPDATE SET n = n + 1'),
        recent: db.prepare('SELECT day, name, n FROM daily_counts WHERE day >= ?'),
        totals: db.prepare('SELECT name, SUM(n) AS n FROM daily_counts GROUP BY name'),
        seats: db.prepare('SELECT created_at FROM licences WHERE livemode = ?'),
      };
      return this;
    },
    attached() { return Boolean(q); },
    enable(name) { if (COUNTS.includes(name)) enabled.add(name); },
    isEnabled(name) { return enabled.has(name); },
    // One more for today. Never throws: a count must not break the action it counts.
    bump(name) {
      if (!q || !enabled.has(name)) return false;
      try {
        q.bump.run(nyDay(now()), name);
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

export function mountCounters(app, {
  counters = siteCounters, mode = null, publicUrl = 'https://bloombroke.com', now = () => Date.now(),
  limiter = createLimiter({ ...COUNT_LIMIT, now, maxKeys: 20_000 }),
}) {
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  app.post('/api/count', express.json({ limit: '1kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Counts come from bloombroke.com only.');
    const name = req.body && typeof req.body === 'object' ? req.body.name : undefined;
    if (typeof name !== 'string' || !CLIENT_COUNTS.includes(name)) return fail(res, 400, 'unknown', 'No such counter.');
    const r = limiter.hit(clientIp(req));
    if (!r.ok) {
      res.set('Retry-After', String(r.retryAfter));
      return fail(res, 429, 'rate_limited', 'That is a lot of counting. Try again in a minute.');
    }
    counters.bump(name);
    res.status(204).end();
  });
  app.use('/api/count', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large' || err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_request', 'Send { name }.');
    return next(err);
  });
  app.get('/api/bbrk', (req, res) => {
    let s;
    try {
      s = counters.stats({ mode });
    } catch (err) {
      console.error('[bbrk]', err.message);
      s = { day: nyDay(now()), counts: Object.fromEntries(COUNTS.map((n) => [n, null])), seats: null };
    }
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ updated: new Date(now()).toISOString(), day: s.day, mode, counts: s.counts, seats: s.seats, mrr: mrrLine(mode) });
  });
}
