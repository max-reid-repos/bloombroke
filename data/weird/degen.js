// DEGEN: where the betting and trading apps sit in the US App Store's top 100 free
// iPhone apps. Source: Apple's marketing tools RSS feed, updated about daily.

export const id = 'degen';
export const source = 'Apple App Store';
export const ttl = 60 * 60_000;

const URL_CHART = 'https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/100/apps.json';

// Matched by App Store id first, then by name (names change more often than ids).
export const APPS = [
  { name: 'Kalshi', appId: '1632713844', re: /^kalshi\b/i },
  { name: 'Polymarket', appId: '6648798962', re: /^polymarket\b/i },
  { name: 'Robinhood', appId: '938003185', re: /^robinhood\b(?!.*wallet)/i },
  { name: 'Coinbase', appId: '886427730', re: /^coinbase\b(?!.*wallet)/i },
  { name: 'Webull', appId: '1179213067', re: /^webull\b/i },
];

export function parse(body) {
  const results = body?.feed?.results;
  if (!Array.isArray(results) || !results.length) throw new Error('App Store: empty chart');
  const apps = APPS.map((a) => {
    let i = results.findIndex((r) => String(r.id) === a.appId);
    if (i < 0) i = results.findIndex((r) => a.re.test(String(r.name || '')));
    return { name: a.name, rank: i >= 0 ? i + 1 : null };
  });
  const updated = Date.parse(body.feed.updated);
  return { apps, size: results.length, asOf: Number.isFinite(updated) ? new Date(updated).toISOString() : null };
}

export function build(p) {
  const ranked = p.apps.filter((a) => a.rank).sort((a, b) => a.rank - b.rank);
  const best = ranked[0];
  return {
    headline: best ? `${best.name.toUpperCase()} #${best.rank}` : `NONE IN TOP ${p.size}`,
    line: 'Best App Store rank, trading apps',
    spark: null,
    asOf: p.asOf,
    source,
    ...p,
  };
}

export async function load(get) {
  return build(parse(await get.json(URL_CHART)));
}
