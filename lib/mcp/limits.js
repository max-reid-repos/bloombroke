// MCP limits, per visitor bucket (pro/ratelimit.js clientIp: IPv4, or an IPv6 /64):
//   tool calls  30 per 10 minutes and 300 per 24 hours (fixed windows from the first call)
//   requests    120 a minute of any kind (tools/list, initialize, ...), so the endpoint
//               itself cannot be flooded
// All in memory: an address is held for its window plus at most a minute (the limiter's
// sweep), never written anywhere. A refused call does not count against the other window.
//
// Stats: counts per tool (and refused calls), no addresses, no arguments. Logged as one
// line an hour when there was anything to count.

import { createLimiter } from '../../pro/ratelimit.js';

export const MCP_LIMITS = {
  shortMax: 30, shortWindowMs: 10 * 60_000,
  dayMax: 300, dayWindowMs: 24 * 60 * 60_000,
  requestMax: 120, requestWindowMs: 60_000,
};

export function makeMcpLimits({ now = () => Date.now(), ...opts } = {}) {
  const o = { ...MCP_LIMITS, ...opts };
  const short = createLimiter({ max: o.shortMax, windowMs: o.shortWindowMs, now });
  const day = createLimiter({ max: o.dayMax, windowMs: o.dayWindowMs, now });
  const requests = createLimiter({ max: o.requestMax, windowMs: o.requestWindowMs, now });
  const refused = (r, scope) => ({ ok: false, scope, retryAfter: r.retryAfter, resetAt: new Date(now() + r.retryAfter * 1000).toISOString() });
  return {
    limits: o,
    // One tool call. -> { ok } or { ok: false, scope: '10m' | '24h', retryAfter (s), resetAt (ISO) }
    call(key) {
      if (day.blocked(key)) return refused(day.hit(key), '24h');
      if (short.blocked(key)) return refused(short.hit(key), '10m');
      const s = short.hit(key);
      if (!s.ok) return refused(s, '10m');
      const d = day.hit(key);
      if (!d.ok) return refused(d, '24h');
      return { ok: true };
    },
    // Any request to the endpoint.
    request(key) {
      const r = requests.hit(key);
      return r.ok ? { ok: true } : refused(r, '1m');
    },
    reset() { short.reset(); day.reset(); requests.reset(); },
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
