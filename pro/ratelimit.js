// Fixed-window rate limits in memory, per key (usually the client IP).

export function createLimiter({ max, windowMs, now = () => Date.now(), maxKeys = 50_000 }) {
  const hits = new Map();
  function sweep(t) {
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }
  return {
    // Count one hit. Returns { ok, retryAfter } (retryAfter in seconds).
    hit(key) {
      const t = now();
      let e = hits.get(key);
      if (!e || e.reset <= t) {
        if (hits.size >= maxKeys) sweep(t);
        e = { count: 0, reset: t + windowMs };
        hits.set(key, e);
      }
      e.count += 1;
      return { ok: e.count <= max, retryAfter: Math.max(1, Math.ceil((e.reset - t) / 1000)) };
    },
    // Would the next hit be refused? Does not count.
    blocked(key) {
      const e = hits.get(key);
      return Boolean(e && e.reset > now() && e.count >= max);
    },
    reset() { hits.clear(); },
  };
}

// The visitor's IP. Behind the local proxy (Cloudflare tunnel) the socket is loopback and
// the real address is in CF-Connecting-IP; anything else uses Express's req.ip.
export function clientIp(req) {
  const peer = req.socket?.remoteAddress || '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const cf = req.get?.('cf-connecting-ip');
  if (loopback && cf && cf.length <= 64) return cf.trim();
  return req.ip || peer || 'unknown';
}
