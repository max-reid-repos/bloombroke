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
//   and symbol searches make many keys).

export function createCache({ retryMs = 30_000, now = () => Date.now(), maxEntries = Infinity } = {}) {
  const entries = new Map();
  const failures = new Map();
  const inflight = new Map();

  async function cached(key, ttlMs, loader) {
    const entry = entries.get(key);
    const t = now();
    if (entry && t < entry.expiresAt) {
      return { value: entry.value, stale: entry.stale, fetchedAt: entry.fetchedAt };
    }
    if (!entry) {
      const fail = failures.get(key);
      if (fail && t < fail.until) throw fail.error;
    }
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
      try {
        const value = await loader();
        const fetchedAt = now();
        entries.delete(key);
        entries.set(key, { value, fetchedAt, expiresAt: fetchedAt + ttlMs, stale: false });
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
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
        const value = await loader();
        const fetchedAt = now();
        entries.delete(key);
        entries.set(key, { value, fetchedAt, expiresAt: fetchedAt + ttlMs, stale: false });
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
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
    clear: () => { entries.clear(); failures.clear(); },
    size: () => entries.size,
  };
}
