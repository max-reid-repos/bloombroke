// Fixed-window rate limits in memory, per key (usually the client IP bucket).
// When the table is full of live entries, new keys are refused (fail closed), so a flood
// of addresses cannot push out the ones being limited.

export function createLimiter({ max, windowMs, now = () => Date.now(), maxKeys = 50_000 }) {
  const hits = new Map();
  let lastSweep = -Infinity;
  function sweep(t) {
    lastSweep = t;
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }
  // No room for a new key, even after dropping the expired ones.
  function full(t) {
    if (hits.size < maxKeys) return false;
    if (t - lastSweep >= 1000) sweep(t); // at most once a second, so a flood cannot spin on it
    return hits.size >= maxKeys;
  }
  const retry = (ms) => Math.max(1, Math.ceil(ms / 1000));
  return {
    // Count one hit. Returns { ok, retryAfter } (retryAfter in seconds).
    hit(key) {
      const t = now();
      let e = hits.get(key);
      if (!e || e.reset <= t) {
        if (!e && full(t)) return { ok: false, retryAfter: retry(windowMs) };
        e = { count: 0, reset: t + windowMs };
        hits.set(key, e);
      }
      e.count += 1;
      return { ok: e.count <= max, retryAfter: retry(e.reset - t) };
    },
    // Would the next hit be refused? Does not count.
    blocked(key) {
      const t = now();
      const e = hits.get(key);
      if (!e) return full(t);
      return e.reset > t && e.count >= max;
    },
    size() { return hits.size; },
    reset() { hits.clear(); },
  };
}

// Full 8-group form of an IPv6 address, or null.
function expandV6(ip) {
  if (!ip.includes(':')) return null;
  let s = ip.split('%')[0].toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const b = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = s.includes('::') ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array(Math.max(0, fill)).fill('0'), ...t];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => p.padStart(4, '0'));
}

// The rate-limit bucket for an address: IPv4 as is, IPv6 by its /64 (one user or site
// usually holds a whole /64). IPv4-mapped IPv6 counts as the IPv4 address.
export function ipBucket(ip) {
  const s = String(ip || '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped) return mapped[1];
  const g = expandV6(s);
  if (!g) return s || 'unknown';
  return `${g.slice(0, 4).join(':')}::/64`;
}

// The visitor's bucket. Behind the local proxy (Cloudflare tunnel) the socket is loopback
// and the real address is in CF-Connecting-IP; anything else uses Express's req.ip.
export function clientIp(req) {
  const peer = req.socket?.remoteAddress || '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const cf = req.get?.('cf-connecting-ip');
  if (loopback && cf && cf.length <= 64) return ipBucket(cf.trim());
  return ipBucket(req.ip || peer || 'unknown');
}
