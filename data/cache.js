// Tiny in-memory TTL cache with stale-if-error and in-flight de-duplication.
//
// cached(key, ttlMs, loader) returns { value, stale, fetchedAt }.
// - Fresh entry: returned as is.
// - Expired entry: loader runs; on failure the old value is served with stale: true
//   and the next retry waits `retryMs` so a dead source is not hammered.
// - No entry and loader fails: the error is thrown.

export function createCache({ retryMs = 30_000, now = () => Date.now() } = {}) {
  const entries = new Map();
  const inflight = new Map();

  async function cached(key, ttlMs, loader) {
    const entry = entries.get(key);
    const t = now();
    if (entry && t < entry.expiresAt) {
      return { value: entry.value, stale: entry.stale, fetchedAt: entry.fetchedAt };
    }
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
      try {
        const value = await loader();
        const fetchedAt = now();
        entries.set(key, { value, fetchedAt, expiresAt: fetchedAt + ttlMs, stale: false });
        return { value, stale: false, fetchedAt };
      } catch (err) {
        if (entry) {
          entry.stale = true;
          entry.expiresAt = now() + Math.min(retryMs, ttlMs);
          return { value: entry.value, stale: true, fetchedAt: entry.fetchedAt };
        }
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return { cached, clear: () => entries.clear(), size: () => entries.size };
}
