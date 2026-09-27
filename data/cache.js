// Tiny in-memory TTL cache with stale-if-error and in-flight de-duplication.
//
// cached(key, ttlMs, loader) returns { value, stale, fetchedAt }.
// - Fresh entry: returned as is.
// - Expired entry: loader runs; on failure the old value is served with stale: true
//   and the next retry waits `retryMs` so a dead source is not hammered.
// - No entry and loader fails: the error is thrown, and the failure itself is
//   remembered for `retryMs`. Calls in that window get the same error without
//   touching the source.
// refresh(key, ttlMs, loader) reloads a key now, fresh or not (background prewarm).
// - maxEntries caps memory: past it, the oldest entry is dropped (custom chart ranges
//   and symbol searches make many keys). With lru, a hit counts as new, so the entry
//   dropped is the one least recently used.
// - weigh(value) and maxWeight cap memory by size (chart bars): past it, the oldest
//   entries are dropped until the total fits (the newest is always kept).
// - forget(key) drops one entry (and a remembered failure), so the next call loads it
//   again: a new SEC filing for that company (data/edgarwatch.js).
// - Every cache counts its loads in CACHE_STATS under its module's name ('quotes',
//   'weird/canal'): last success, last failure, how long a load took. DATA and STATUS
//   read those (lib/provenance.js). name: set it, or it is the file that made the cache.

// module name -> { name, okAt, failAt, error, ms, loads, fails }. Plain numbers only.
export const CACHE_STATS = new Map();

// The data file that called createCache: "data/quotes.js" -> "quotes". A cache made by
// the shared list helper (data/lists.js makeCnbcList) is named after the file using it.
export function callerName(stack = new Error().stack) {
  for (const line of String(stack || '').split('\n').slice(1)) {
    if (/\/data\/(cache|lists)\.js/.test(line)) continue;
    const m = /\/(?:data|lib)\/((?:weird\/)?[\w.-]+?)\.js/.exec(line);
    if (m) return m[1];
  }
  return 'other';
}

function statsFor(name) {
  let s = CACHE_STATS.get(name);
  if (!s) {
    s = { name, okAt: 0, failAt: 0, error: '', ms: 0, loads: 0, fails: 0 };
    CACHE_STATS.set(name, s);
  }
  return s;
}

// A copy of every module's counts, for DATA and STATUS.
export function cacheStats() {
  return [...CACHE_STATS.values()].map((s) => ({ ...s }));
}

export function createCache({ retryMs = 30_000, now = () => Date.now(), maxEntries = Infinity, lru = false, weigh = null, maxWeight = Infinity, name = callerName() } = {}) {
  const entries = new Map();
  const stats = statsFor(name);
  // Wraps a loader: the time it took, and success or failure, go in CACHE_STATS.
  const counted = (loader) => async () => {
    const t0 = Date.now();
    try {
      const v = await loader();
      stats.okAt = Date.now();
      stats.ms = stats.okAt - t0;
      stats.loads += 1;
      return v;
    } catch (err) {
      stats.failAt = Date.now();
      stats.ms = stats.failAt - t0;
      stats.fails += 1;
      stats.error = String(err?.message || 'failed').slice(0, 80);
      throw err;
    }
  };
  let weight = 0;
  const w = (entry) => entry?.w || 0;
  function store(key, entry) {
    const old = entries.get(key);
    weight -= w(old);
    entries.delete(key);
    entry.w = weigh ? weigh(entry.value) || 0 : 0;
    weight += entry.w;
    entries.set(key, entry);
    while (entries.size > maxEntries || (weight > maxWeight && entries.size > 1)) {
      const k = entries.keys().next().value;
      weight -= w(entries.get(k));
      entries.delete(k);
    }
  }
  const failures = new Map();
  const inflight = new Map();

  async function cached(key, ttlMs, loader) {
    const entry = entries.get(key);
    const t = now();
    if (entry && t < entry.expiresAt) {
      if (lru) { entries.delete(key); entries.set(key, entry); }
      return { value: entry.value, stale: entry.stale, fetchedAt: entry.fetchedAt };
    }
    if (!entry) {
      const fail = failures.get(key);
      if (fail && t < fail.until) throw fail.error;
    }
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
      try {
        const value = await counted(loader)();
        const fetchedAt = now();
        store(key, { value, fetchedAt, expiresAt: fetchedAt + ttlMs, stale: false });
        failures.delete(key);
        return { value, stale: false, fetchedAt };
      } catch (err) {
        if (entry) {
          entry.stale = true;
          entry.expiresAt = now() + Math.min(retryMs, ttlMs);
          return { value: entry.value, stale: true, fetchedAt: entry.fetchedAt };
        }
        failures.set(key, { error: err, until: now() + retryMs });
        while (failures.size > maxEntries) failures.delete(failures.keys().next().value);
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  // Load `key` now, even when the entry is still fresh, and keep the new value. For
  // background refreshes that run before an entry expires, so no visitor waits on a
  // cold source. A failure throws and leaves the old entry as it was.
  async function refresh(key, ttlMs, loader) {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const value = await counted(loader)();
        const fetchedAt = now();
        store(key, { value, fetchedAt, expiresAt: fetchedAt + ttlMs, stale: false });
        failures.delete(key);
        return { value, stale: false, fetchedAt };
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return {
    cached,
    refresh,
    clear: () => { entries.clear(); failures.clear(); weight = 0; },
    // Drop one key: the next call loads it again. A load already running is left to finish.
    forget(key) {
      const old = entries.get(key);
      if (old) { weight -= w(old); entries.delete(key); }
      failures.delete(key);
      return Boolean(old);
    },
    has: (key) => entries.has(key),
    weight: () => weight,
    size: () => entries.size,
  };
}
