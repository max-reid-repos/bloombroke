// MCP limits, per visitor bucket (pro/ratelimit.js clientIp: IPv4, or an IPv6 /64):
//   tool calls  30 per 10 minutes and 300 per 24 hours (fixed windows from the first call)
//   requests    120 a minute of any kind (tools/list, initialize, ...), so the endpoint
//               itself cannot be flooded
//   everyone    at most 50,000 tool calls per 24 hours in all (globalDayMax): the cap
//               that holds when someone spreads calls over many addresses
// All in memory: an address is held for its window plus at most a minute (the sweep),
// never written anywhere. A refused call does not count against the other windows.
//
// Unlike pro/ratelimit.js, a full table never refuses everyone: the entry that started
// longest ago is dropped to make room (a flood of addresses can at worst reset some
// counts early), and the global cap bounds the total.
//
// Stats: counts per tool (and refused calls), no addresses, no arguments. Logged as one
// line an hour when there was anything to count.

export const MCP_LIMITS = {
  shortMax: 30, shortWindowMs: 10 * 60_000,
  dayMax: 300, dayWindowMs: 24 * 60 * 60_000,
  requestMax: 120, requestWindowMs: 60_000,
  globalDayMax: 50_000,
  maxKeys: 50_000,
};

// Fixed windows per key. Entries sit in the Map in the order their windows started, so
// the first one is always the oldest: that is the one dropped when the table is full.
export function windowLimiter({ max, windowMs, now = () => Date.now(), maxKeys = MCP_LIMITS.maxKeys, sweepEvery = Math.min(windowMs, 60_000) }) {
  const hits = new Map();
  const sweep = (t) => { for (const [k, v] of hits) if (v.reset <= t) hits.delete(k); };
  if (sweepEvery > 0) setInterval(() => sweep(now()), sweepEvery).unref?.();
  const retry = (ms) => Math.max(1, Math.ceil(ms / 1000));
  return {
    // Count one hit -> { ok, retryAfter (s) }.
    hit(key) {
      const t = now();
      let e = hits.get(key);
      if (!e || e.reset <= t) {
        hits.delete(key);
        if (hits.size >= maxKeys) sweep(t);
        while (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        e = { count: 0, reset: t + windowMs };
        hits.set(key, e);
      }
      e.count += 1;
      return { ok: e.count <= max, retryAfter: retry(e.reset - t) };
    },
    // Would the next hit be refused? Does not count. A key with no entry never is.
    blocked(key) {
      const e = hits.get(key);
      return Boolean(e && e.reset > now() && e.count >= max);
    },
    size() { return hits.size; },
    reset() { hits.clear(); },
  };
}

export function makeMcpLimits({ now = () => Date.now(), ...opts } = {}) {
  const o = { ...MCP_LIMITS, ...opts };
  const short = windowLimiter({ max: o.shortMax, windowMs: o.shortWindowMs, now, maxKeys: o.maxKeys });
  const day = windowLimiter({ max: o.dayMax, windowMs: o.dayWindowMs, now, maxKeys: o.maxKeys });
  const requests = windowLimiter({ max: o.requestMax, windowMs: o.requestWindowMs, now, maxKeys: o.maxKeys });
  // Everyone together: one key, the same fixed 24 hour window.
  const all = windowLimiter({ max: o.globalDayMax, windowMs: o.dayWindowMs, now, maxKeys: 1 });
  const ALL = 'all';
  const refused = (r, scope) => ({ ok: false, scope, retryAfter: r.retryAfter, resetAt: new Date(now() + r.retryAfter * 1000).toISOString() });
  return {
    limits: o,
    // One tool call. -> { ok } or { ok: false, scope: '10m' | '24h' | 'all', retryAfter (s), resetAt (ISO) }
    call(key) {
      if (all.blocked(ALL)) return refused(all.hit(ALL), 'all');
      if (day.blocked(key)) return refused(day.hit(key), '24h');
      if (short.blocked(key)) return refused(short.hit(key), '10m');
      const s = short.hit(key);
      if (!s.ok) return refused(s, '10m');
      const d = day.hit(key);
      if (!d.ok) return refused(d, '24h');
      const g = all.hit(ALL);
      if (!g.ok) return refused(g, 'all');
      return { ok: true };
    },
    // Any request to the endpoint.
    request(key) {
      const r = requests.hit(key);
      return r.ok ? { ok: true } : refused(r, '1m');
    },
    reset() { short.reset(); day.reset(); requests.reset(); all.reset(); },
    size: () => ({ short: short.size(), day: day.size(), requests: requests.size() }),
  };
}

export function makeStats({ log = (m) => console.log(m), every = 60 * 60_000 } = {}) {
  let counts = {};
  const add = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const flush = () => {
    if (!Object.keys(counts).length) return null;
    const line = `[mcp] calls in the last hour ${JSON.stringify(counts)}`;
    counts = {};
    log(line);
    return line;
  };
  if (every > 0) setInterval(flush, every).unref?.();
  return { add, flush, snapshot: () => ({ ...counts }) };
}
