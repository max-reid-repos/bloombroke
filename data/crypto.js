// CRYPTO: top 20 coins by market cap from the CoinGecko public API (no key).

import { createCache } from './cache.js';
import { UA } from './quotes.js';
import { iso } from './lists.js';
import { instrumentBySrc } from '../public/instruments.js';

const URL_TOP = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&price_change_percentage=24h,7d';
const TTL = 5 * 60_000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseCoins(body) {
  if (!Array.isArray(body)) throw new Error('crypto source: unexpected shape');
  return body
    .map((c) => ({
      rank: num(c.market_cap_rank),
      id: String(c.id || ''),
      symbol: String(c.symbol || '').toUpperCase(),
      cmd: instrumentBySrc(`${String(c.symbol || '').toUpperCase()}.CM=`)?.id || null,
      name: String(c.name || ''),
      price: num(c.current_price),
      change24h: num(c.price_change_percentage_24h_in_currency) ?? num(c.price_change_percentage_24h),
      change7d: num(c.price_change_percentage_7d_in_currency),
      marketCap: num(c.market_cap),
      volume: num(c.total_volume),
      asOf: typeof c.last_updated === 'string' ? c.last_updated : null,
    }))
    .filter((c) => c.symbol && c.name && c.price !== null)
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
}

export function makeCrypto({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  async function getCrypto() {
    const { value, stale, fetchedAt } = await cache.cached('crypto', TTL, async () => {
      const res = await fetchImpl(URL_TOP, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`crypto source HTTP ${res.status}`);
      const coins = parseCoins(await res.json());
      if (coins.length < 10) throw new Error('crypto source: too few coins');
      return coins;
    });
    return { coins: value, stale, updated: iso(fetchedAt) };
  }
  return { getCrypto };
}

export const { getCrypto } = makeCrypto();
