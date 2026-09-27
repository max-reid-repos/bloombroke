// CRYPTO: top 20 coins by market cap from the CoinGecko public API (no key),
// excluding stablecoins and tokenised non-crypto assets (a home loan pool, gold,
// Treasury bill funds), which are not what people mean by "crypto".
// - Stablecoins: CoinGecko's own "stablecoins" category (its top 250, refreshed daily),
//   plus the list below in case that call fails.
// - Tokenised assets: the list below. CoinGecko's "real-world assets" category also
//   holds real networks (Chainlink, Stellar), so it cannot be used whole.
// The markets call asks for 100 coins so 20 remain after the exclusions.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { UA } from './quotes.js';
import { iso } from './lists.js';
import { instrumentBySrc } from '../public/instruments.js';

const URL_TOP = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h,7d';
const URL_STABLE = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=250&page=1';
const TTL = 5 * 60_000;
const DAY = 24 * 60 * 60_000;
export const TOP_N = 20;

// CoinGecko ids. Kept by hand: add to it when an odd token climbs into the top 20.
export const STABLECOINS = [
  'tether', 'usd-coin', 'usds', 'ethena-usde', 'dai', 'usd1-wlfi', 'global-dollar', 'paypal-usd', 'ripple-usd', 'usdd',
  'first-digital-usd', 'true-usd', 'euro-coin', 'usdtb', 'falcon-finance', 'bfusd', 'gho', 'usual-usd', 'frax', 'binance-usd',
];
export const TOKENISED = [
  'figure-heloc', 'tether-gold', 'pax-gold', 'kinesis-gold', 'kinesis-silver', 'hashnote-usyc',
  'blackrock-usd-institutional-digital-liquidity-fund', 'ondo-us-dollar-yield', 'ousg', 'ylds', 'eutbl',
  'superstate-short-duration-us-government-securities-fund-ustb', 'spiko-amundi-overnight-swap-fund-eur',
  'janus-henderson-anemoy-aaa-clo-fund', 'janus-henderson-anemoy-treasury-fund',
];
export const EXCLUDE_NOTE = 'Top 20 excluding stablecoins and tokenised assets (gold, loans, fund shares)';

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

// coins (ranked) -> { coins: the first n that are neither, excluded: [{ id, symbol, why }] }
export function excludeCoins(coins, stableIds, n = TOP_N) {
  const stable = new Set([...STABLECOINS, ...(stableIds || [])]);
  const tokenised = new Set(TOKENISED);
  const out = [];
  const excluded = [];
  for (const c of coins) {
    if (out.length >= n) break;
    const why = stable.has(c.id) ? 'stablecoin' : tokenised.has(c.id) ? 'tokenised asset' : null;
    if (why) excluded.push({ id: c.id, symbol: c.symbol, name: c.name, why });
    else out.push(c);
  }
  return { coins: out, excluded };
}

export function makeCrypto({ fetchImpl = cappedFetch, cache = createCache() } = {}) {
  const get = async (url) => {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`crypto source HTTP ${res.status}`);
    return res.json();
  };
  // CoinGecko's stablecoin ids, a day at a time; the hand list alone if it fails.
  async function stableIds() {
    try {
      const got = await cache.cached('crypto:stable', DAY, async () => {
        const body = await get(URL_STABLE);
        if (!Array.isArray(body) || body.length < 10) throw new Error('crypto stablecoins: unexpected shape');
        return body.map((c) => String(c?.id || '')).filter(Boolean);
      });
      return got.value;
    } catch {
      return null;
    }
  }
  async function getCrypto() {
    const { value, stale, fetchedAt } = await cache.cached('crypto', TTL, async () => {
      const coins = parseCoins(await get(URL_TOP));
      if (coins.length < 10) throw new Error('crypto source: too few coins');
      return coins;
    });
    const ids = await stableIds();
    const { coins, excluded } = excludeCoins(value, ids);
    return { coins, excluded, note: EXCLUDE_NOTE, stableSource: ids ? 'provider stablecoins category' : 'hand list', stale, updated: iso(fetchedAt) };
  }
  return { getCrypto };
}

export const { getCrypto } = makeCrypto();
