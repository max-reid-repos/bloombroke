// WSB: the tickers talked about most on Reddit's WallStreetBets in the last 24 hours,
// and where each one ranked 24 hours before. Source: ApeWisdom (apewisdom.io), which
// counts ticker mentions in posts and comments.

import { NoData, decodeEntities } from './source.js';

export const id = 'wsb';
export const source = 'ApeWisdom';
export const ttl = 15 * 60_000;

const URL_WSB = 'https://apewisdom.io/api/v1.0/filter/wallstreetbets/page/1';
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

// ApeWisdom body -> [{ rank, ticker, name, mentions, upvotes, rankAgo, mentionsAgo }].
export function parse(body) {
  const results = body?.results;
  if (!Array.isArray(results)) throw new Error('ApeWisdom: unexpected shape');
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return results
    .map((r) => ({
      rank: num(r.rank),
      ticker: String(r.ticker ?? '').trim().toUpperCase(),
      name: decodeEntities(r.name).trim(),
      mentions: num(r.mentions),
      upvotes: num(r.upvotes),
      rankAgo: num(r.rank_24h_ago),
      mentionsAgo: num(r.mentions_24h_ago),
    }))
    .filter((r) => r.rank && TICKER.test(r.ticker) && Number.isFinite(r.mentions))
    .sort((a, b) => a.rank - b.rank);
}

export function build(rows, now = Date.now(), n = 10) {
  if (!rows.length) throw new NoData('ApeWisdom: no tickers');
  const top = rows.slice(0, n).map((r) => ({ ...r, moved: Number.isFinite(r.rankAgo) ? r.rankAgo - r.rank : null }));
  const lead = top[0];
  return {
    headline: `${lead.ticker} ${lead.mentions.toLocaleString('en-US')} MENTIONS`,
    line: 'Top ticker on WallStreetBets, 24h',
    spark: null,
    asOf: new Date(now).toISOString(),
    source,
    rows: top,
  };
}

export async function load(get, { now = Date.now } = {}) {
  return build(parse(await get.json(URL_WSB, { timeout: 15_000 })), now());
}
