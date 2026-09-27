// Provenance: where every number comes from, how old it is and how delayed.
//
// 1. The envelope. Every JSON answer under /api gets `provenance` (provenanceJson below,
//    mounted in server.js), the same field names as the MCP results:
//      { source, source_url, as_of, fetched_at, age_seconds, delay, note?, dataset?, parts? }
//    source      who published it (short name)       source_url  where it can be checked
//    as_of       the time or day the data describes  fetched_at  when this server got it
//    age_seconds now minus fetched_at                delay       one of DELAYS
//    note        a known limit ("split-adjusted, not dividend-adjusted", a missing month)
//    dataset     the row on the DATA screen          parts       each piece of a mixed answer
//    The fields screens already read (updated, stale, asOf, source) are left as they are.
// 2. DATASETS: one row per dataset for the DATA screen (source, licence, coverage,
//    history, cadence, known gaps), with the measured age from the caches right now.
// 3. /api/data, /api/status and /api/changes (mountProvenanceRoutes).
//
// Nothing here fetches a source: ages come from data/cache.js CACHE_STATS, the WEIRD
// gauges' last good values and the EDGAR watcher's own counts.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cacheStats } from '../data/cache.js';
import { NYSE_HOLIDAYS, NYSE_EARLY_CLOSES } from '../public/app.js';
import { sessionTag } from '../public/provenance.js';
import { findCommand } from '../public/registry.js';
import { isIntradayBar } from '../public/bars.js';
import { instrumentById } from '../public/instruments.js';

export const DELAYS = ['real-time', 'delayed-10m', 'delayed-15m', 'end-of-day', 'daily', 'weekly', 'monthly', 'quarterly', 'static'];
// Licence labels, never a right we have not checked. public domain: US federal sources
// (the New York Fed is not one: its reference rates carry its own terms) and sources
// whose own terms dedicate the data (Natural Earth, Wikimedia CC0).
// credit required: the source's own terms allow reuse with attribution (ECB, The
// Economist Big Mac data, CC BY 4.0). share-alike: OpenStreetMap (ODbL). Everything
// else: third-party terms. Bloombroke's own counts have no upstream licence: --.
export const LICENCES = ['public domain', 'credit required', 'share-alike', 'third-party terms'];

// The time-of-day tag of an EDGAR acceptance time (PRE, MKT, AH, WKD), NYSE calendar.
// Limit: the repo's NYSE_HOLIDAYS (public/app.js) lists 2026 and 2027 only, so a filing
// on an earlier market holiday (Good Friday 2025) is tagged by its time of day.
export const sessionOf = (iso) => sessionTag(iso, { closed: (d) => NYSE_HOLIDAYS.has(d), early: (d) => NYSE_EARLY_CLOSES.has(d) });

// 'YYYY-MM' | 'YYYY-MM-DD' | ISO time | ms -> ISO string, or null (as the MCP envelope).
export function isoOf(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v).toISOString() : null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// The oldest time among values, as ISO, or null. Times after `notAfter` (a source's
// clock running ahead) are left out.
export function oldest(values, notAfter = null) {
  const cap = isoOf(notAfter);
  let best = null;
  for (const v of values || []) {
    const iso = isoOf(v);
    if (iso && (!cap || iso <= cap) && (!best || iso < best)) best = iso;
  }
  return best;
}

// A trading day's 16:00 close in New York, as ISO (daylight saving by the time zone).
export function nyCloseIso(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return null;
  const [y, m, d] = String(day).split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, 20);
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
  t += (16 - h) * 3600_000;
  return new Date(t).toISOString();
}
const nyDayOf = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
// The last daily bar's close (bars are stamped at New York midnight), as ISO.
const barClose = (t) => (Number.isFinite(t) ? nyCloseIso(nyDayOf(t)) : null);

// The newest time among values (ISO strings, days, ms), as ISO, or null.
export function newest(values) {
  let best = null;
  for (const v of values || []) {
    const iso = isoOf(v);
    if (iso && (!best || iso > best)) best = iso;
  }
  return best;
}

const rankOf = (d) => { const i = DELAYS.indexOf(d); return i < 0 ? DELAYS.length : i; };

export function envelope({ source, source_url, as_of, fetched_at, delay, note = null, dataset = null, now = Date.now() }) {
  const fetched = isoOf(fetched_at) || new Date(now).toISOString();
  // A source's time can run ahead of ours (CNBC dates a Sunday SILVER quote in the
  // future): the data is never newer than the moment we fetched it.
  const asOf = isoOf(as_of);
  const out = {
    source: String(source),
    // Only a named public source has a link; a source class has none.
    ...(source_url ? { source_url: String(source_url) } : {}),
    as_of: asOf && asOf < fetched ? asOf : fetched,
    fetched_at: fetched,
    age_seconds: Math.max(0, Math.round((now - Date.parse(fetched)) / 1000)),
    delay: DELAYS.includes(delay) ? delay : 'static',
  };
  if (note) out.note = String(note);
  if (dataset) out.dataset = String(dataset);
  return out;
}

// Several parts -> one envelope: the worst part (slowest delay class, then the oldest)
// on top, every part under `parts`. One part is returned as it is.
export function combine(parts) {
  const ok = (parts || []).filter(Boolean);
  if (!ok.length) return null;
  if (ok.length === 1) return ok[0];
  const worst = ok.reduce((a, b) => {
    const r = rankOf(b.delay) - rankOf(a.delay);
    if (r) return r > 0 ? b : a;
    return b.age_seconds > a.age_seconds ? b : a;
  });
  return { ...worst, parts: ok };
}

// ---- The datasets ---------------------------------------------------------------------

const OCT25 = 'Oct 2025 not published (US government shutdown)';
const R = 'third-party terms';
const PD = 'public domain';
const CR = 'credit required';
const SA = 'share-alike';

// Source classes. Only US government sources (and credits a licence requires) are named;
// every commercial or third-party source is shown as its class, so the DATA page, the
// dot and the envelope never list vendors. source_url only for named public sources.
export const MDP = 'market data provider';
export const FXR = 'reference FX rates (ECB)';
export const CAL = 'exchange calendars';
export const NEWS = 'news publishers';
export const WEB = 'public web data';
export const OWN = 'our own counters';

// One row per dataset. modules: the data/*.js caches whose last good load is the
// checked age. source: the class (or the named public source) the dot and DATA show.
// licence: kept here for the legal round, never sent.
export const DATASETS = [
  // Prices
  { id: 'quotes', group: 'Prices', name: 'Quotes: US stocks, ETFs, US indexes, FX, crypto, yields', source: MDP, licence: R, coverage: 'US-listed stocks and ETFs, US indexes, major FX, top coins, Treasury yields', history: 'Today', cadence: '15 s cache', delay: 'real-time', gaps: 'Pre and after-hours as reported', modules: ['quotes'] },
  { id: 'futures', group: 'Prices', name: 'Futures and commodities', source: MDP, licence: R, coverage: 'Front-month contracts', history: 'Today', cadence: '5 min cache', delay: 'delayed-10m', gaps: '--', modules: ['commodities', 'quotes'] },
  { id: 'intl', group: 'Prices', name: 'Non-US stock indexes', source: MDP, licence: R, coverage: 'About 30 indexes by region', history: 'Today', cadence: '5 min cache', delay: 'delayed-15m', gaps: 'Some indexes real time, marked RT', modules: ['world', 'quotes'] },
  { id: 'sp100', group: 'Prices', name: 'S&P 100 batch (MOVERS, HEATMAP, FISHTANK)', source: MDP, licence: R, coverage: '101 members as of 21 Sep 2026', history: 'Today', cadence: '2 min cache', delay: 'real-time', gaps: 'Member list fixed until updated by hand', modules: ['sp100'] },
  { id: 'sectors', group: 'Prices', name: 'Sector ETFs', source: MDP, licence: R, coverage: '11 SPDR sector ETFs', history: '1M and YTD', cadence: '5 min cache', delay: 'real-time', gaps: '--', modules: ['sectors'] },
  { id: 'bonds', group: 'Prices', name: 'Government bond yields', source: MDP, licence: R, coverage: 'About 20 countries, 2Y to 30Y', history: 'Today', cadence: '5 min cache', delay: 'delayed-15m', gaps: 'US yields real time; some tenors missing (--)', modules: ['bonds'] },
  { id: 'bars', group: 'Prices', name: 'Price history (charts, HISTORY, COMPARE, WHY)', source: MDP, licence: R, coverage: 'Stocks, ETFs, indexes, FX, crypto, futures', history: 'Daily closes back decades; intraday bars about 300 days', cadence: '1 min (intraday) to daily', delay: 'end-of-day', note: 'split-adjusted, not dividend-adjusted', gaps: 'Split-adjusted, not dividend-adjusted', modules: ['charts', 'history', 'whatif-mine'] },
  { id: 'value', group: 'Prices', name: 'Valuation numbers (VALUE, SCREEN P/E and yield)', source: MDP, licence: R, coverage: 'US stocks', history: 'Today', cadence: '15 min cache', delay: 'daily', gaps: 'No price/book; missing fields are --', modules: ['value'] },
  { id: 'screener', group: 'Prices', name: 'Stock screener and exchange breadth', source: MDP, licence: R, coverage: 'About 7,000 US-listed stocks', history: 'Last full session', cadence: '1 h cache', delay: 'end-of-day', gaps: 'No 52-week highs or lows', modules: ['screen', 'breadth'] },
  { id: 'options', group: 'Prices', name: 'Option chains', source: MDP, licence: R, coverage: 'US stocks, ETFs and indexes with listed options', history: 'Today', cadence: '1 min cache', delay: 'delayed-15m', gaps: '--', modules: ['options'] },
  { id: 'crypto', group: 'Prices', name: 'Crypto top 20', source: MDP, licence: R, coverage: 'Top 20 by market cap, stablecoins and tokenised assets left out', history: '24 h and 7 d change', cadence: '1 min cache', delay: 'real-time', gaps: '--', modules: ['crypto'] },
  { id: 'fx', group: 'Prices', name: 'FX reference rates (FX, FXMATRIX)', source: FXR, url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html', licence: CR, coverage: 'About 30 currencies', history: '1999 on', cadence: 'Once a day, about 16:00 CET', delay: 'daily', gaps: 'No rates on weekends and ECB holidays', modules: ['fx', 'fxmatrix'] },
  // Rates
  { id: 'treasury', group: 'Rates', name: 'US Treasury par yield curve', source: 'US Treasury', url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates', licence: PD, coverage: '1M to 30Y', history: '1990 on (CURVE reads 1M and 1Y ago)', cadence: 'Each business day, late afternoon ET', delay: 'daily', gaps: 'No curve on federal holidays and bond-market closures', modules: ['curve'] },
  { id: 'nyfed', group: 'Rates', name: 'Fed funds target range and effective rate', source: WEB, licence: R, coverage: 'EFFR and target range', history: 'Latest', cadence: 'Each business day', delay: 'daily', gaps: '--', modules: ['rates'] },
  { id: 'mortgage', group: 'Rates', name: 'Mortgage rates (RATES, LOAN)', source: WEB, licence: R, coverage: '30Y and 15Y fixed', history: '1971 on', cadence: 'Thursdays', delay: 'weekly', gaps: '--', modules: ['rates'] },
  { id: 'fedfutures', group: 'Rates', name: 'Fed funds futures (FEDPATH)', source: MDP, licence: R, coverage: '12 to 16 monthly contracts', history: 'Today', cadence: '1 min cache', delay: 'delayed-10m', gaps: 'Months not listed are kept and marked', modules: ['fedpath'] },
  // Economy
  { id: 'cpi', group: 'Economy', name: 'CPI-U inflation (CPI)', source: 'BLS', url: 'https://data.bls.gov/timeseries/CUUR0000SA0', licence: PD, coverage: 'US city average', history: '1913 on (annual), latest month live', cadence: 'Monthly release; 24 h cache', delay: 'monthly', note: OCT25, gaps: `${OCT25}; 2025 annual average as BLS published it`, modules: ['cpi'] },
  { id: 'economy', group: 'Economy', name: 'Economy dashboard (ECONOMY)', source: WEB, licence: R, coverage: 'GDP, jobs, inflation, rates, housing', history: 'Decades per series', cadence: 'As released; 12 h cache', delay: 'monthly', note: 'Oct 2025 CPI and unemployment rate not published', gaps: 'Oct 2025 CPI and unemployment rate not published (US government shutdown)', modules: ['economy'] },
  { id: 'calendar', group: 'Economy', name: 'Economic calendar', source: CAL, licence: R, coverage: 'This week, forecast and previous', history: 'This week', cadence: 'Hourly', delay: 'daily', gaps: 'No actual results', modules: ['calendar'] },
  // Companies
  { id: 'sec-facts', group: 'Companies', name: 'Company financials (FINANCIALS)', source: 'SEC EDGAR', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', licence: PD, coverage: 'US filers of 10-K and 10-Q', history: '10 fiscal years, 8 quarters', cadence: 'Refetched after each new filing; else 24 h', delay: 'quarterly', note: 'latest filing wins; Q4 and some cash-flow quarters worked out', gaps: 'Q4 = year minus Q1 to Q3; figures never tagged are --; foreign filers (20-F) not covered', modules: ['financials'] },
  { id: 'sec-subs', group: 'Companies', name: 'Filings list (FILINGS, E and N flags, WHY)', source: 'SEC EDGAR', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent', licence: PD, coverage: 'Every SEC filer', history: 'The newest 1,000 filings or year', cadence: 'Refetched after each new filing; else 15 min to 24 h', delay: 'real-time', gaps: '--', modules: ['filings', 'chart-events'] },
  { id: 'sec-feed', group: 'Companies', name: 'EDGAR latest filings feed (8-K, 10-Q, 10-K, 20-F, 6-K, Form 4)', source: 'SEC EDGAR', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent', licence: PD, coverage: 'All filers, newest 100 per form', history: 'Newest 100', cadence: 'Polled every 30 s, 06:00 to 22:00 ET on weekdays', delay: 'real-time', gaps: 'EDGAR accepts filings 6:00 to 22:00 ET on business days', modules: ['newsfeeds'] },
  { id: 'profile', group: 'Companies', name: 'Company profile', source: `${MDP}; SEC EDGAR`, licence: R, coverage: 'US-listed companies', history: 'Latest', cadence: '24 h cache', delay: 'daily', gaps: '--', modules: ['profile'] },
  { id: 'dividends', group: 'Companies', name: 'Dividend history', source: MDP, licence: R, coverage: 'US-listed stocks', history: 'Payment history for some stocks; others: yearly total only', cadence: '24 h cache', delay: 'daily', note: 'split-adjusted', gaps: 'No payment history for many stocks', modules: ['dividends'] },
  { id: 'splits-hist', group: 'Companies', name: 'Split history (adjusting EPS, dividends)', source: MDP, licence: R, coverage: 'US-listed stocks', history: 'Decades', cadence: '24 h cache', delay: 'daily', gaps: 'Unknown: figures shown as filed, and the screen says so', modules: ['split-history'] },
  { id: 'earnings', group: 'Companies', name: 'Earnings calendar and surprises (EARNINGS, BEATS)', source: MDP, licence: R, coverage: 'US-listed companies', history: 'Last few quarters', cadence: '30 min to 24 h cache', delay: 'daily', gaps: '--', modules: ['earnings', 'beats'] },
  { id: 'insiders', group: 'Companies', name: 'Insider trades (from SEC Forms 3, 4 and 5)', source: MDP, licence: R, coverage: 'US-listed companies', history: 'Newest 100 trades; 3 and 12 month totals', cadence: 'Refetched after each new Form 4; else 24 h', delay: 'daily', gaps: 'Can trail the SEC Form 4 by hours', modules: ['insiders'] },
  { id: 'owners', group: 'Companies', name: 'Institutional holders (from SEC Form 13F)', source: MDP, licence: R, coverage: 'US-listed companies', history: 'Newest quarter', cadence: '24 h cache', delay: 'quarterly', gaps: '13F is filed up to 45 days after the quarter', modules: ['owners'] },
  { id: 'shorts', group: 'Companies', name: 'Short interest', source: MDP, licence: R, coverage: 'Some US-listed stocks', history: 'About a year', cadence: 'Twice a month', delay: 'monthly', gaps: 'About two weeks behind the settlement date', modules: ['shorts'] },
  { id: 'ipos', group: 'Companies', name: 'IPO, split and ex-dividend calendars', source: CAL, licence: R, coverage: 'US listings', history: 'This month', cadence: 'Hourly', delay: 'daily', gaps: '--', modules: ['ipos', 'splits'] },
  // News
  { id: 'news', group: 'News', name: 'Market headlines (NEWS, HOME)', source: NEWS, licence: R, coverage: 'Headlines and links, publisher named on each', history: 'Newest 50', cadence: '30 s while someone reads; else 3 min', delay: 'real-time', gaps: '--', modules: ['news'] },
  { id: 'news-macro', group: 'News', name: 'NEWS MACRO', source: 'Federal Reserve Board, BLS', url: 'https://www.federalreserve.gov/feeds/feeds.htm', licence: PD, coverage: 'Headlines and links', history: 'Newest 50', cadence: '5 min', delay: 'real-time', gaps: '--', modules: ['newsfeeds'] },
  { id: 'news-wires', group: 'News', name: 'NEWS WIRES', source: NEWS, licence: R, coverage: 'Press release headlines and links', history: 'Newest 50', cadence: '30 s to 1 min', delay: 'real-time', gaps: '--', modules: ['newsfeeds'] },
  { id: 'news-wsb', group: 'News', name: 'NEWS WSB', source: NEWS, licence: R, coverage: 'Post titles and links', history: 'Newest 50', cadence: '5 min', delay: 'real-time', gaps: '--', modules: ['newsfeeds'] },
  { id: 'tickernews', group: 'News', name: 'Company headlines (NEWS <ticker>, N flags)', source: `${NEWS}; SEC EDGAR`, licence: R, coverage: 'Headlines and links, publisher named on each', history: 'Newest 50', cadence: '1 to 2 min', delay: 'real-time', gaps: '--', modules: ['tickernews'] },
  { id: 'newslog', group: 'News', name: 'Headline log (WHY, N flags)', source: NEWS, licence: R, coverage: 'Company stocks people opened', history: 'Since the log started, last 400 per ticker', cadence: 'As headlines are read', delay: 'real-time', gaps: 'Only tickers someone opened', modules: [] },
  // Money tools and site
  { id: 'whatif', group: 'Tools', name: 'WHATIF and 420 prices', source: `${MDP}; BLS`, licence: R, coverage: 'About 100 products and their makers, plus any stock', history: 'From each product launch', cadence: 'Baked table plus the live quote', delay: 'end-of-day', note: 'split-adjusted, price return only', gaps: `${OCT25}: CPI-U and BLS prices carry Sep 2025 forward for that month`, modules: ['whatif-mine'] },
  { id: 'guess', group: 'Tools', name: 'GUESS puzzle', source: MDP, licence: R, coverage: 'S&P 100', history: 'One year per puzzle', cadence: 'A new puzzle at midnight ET', delay: 'end-of-day', gaps: '--', modules: [] },
  { id: 'trending', group: 'Tools', name: 'TRENDING counts', source: OWN, licence: '--', coverage: 'Tickers opened here', history: 'Last hour or 24 hours', cadence: '1 min', delay: 'real-time', gaps: 'Resets when the server restarts', modules: [] },
  { id: 'bbrk', group: 'Tools', name: 'BBRK site numbers', source: OWN, licence: '--', coverage: 'This site', history: 'Daily totals', cadence: '15 s', delay: 'real-time', gaps: '--', modules: [] },
  { id: 'search', group: 'Tools', name: 'Symbol search', source: MDP, licence: R, coverage: 'US stocks and ETFs', history: '--', cadence: '1 h cache', delay: 'static', gaps: '--', modules: ['search'] },
  { id: 'geo', group: 'Tools', name: 'World map shapes (WORLDMAP)', source: 'Natural Earth', url: 'https://www.naturalearthdata.com/', licence: PD, coverage: 'Countries', history: '--', cadence: 'Built in', delay: 'static', gaps: '--', modules: [] },
];

// WEIRD gauges: one DATA row each. name: the plain name (STATUS too). source: the class,
// or the public body that publishes it; credit: what a licence requires be named.
// url: only for named public sources.
const WEIRD_INFO = {
  canal: { name: 'Hormuz ships', source: WEB, licence: R, delay: 'daily' },
  pizza: { name: 'Pentagon pizza', source: WEB, licence: R, delay: 'real-time' },
  degen: { name: 'Trading app ranks', source: WEB, licence: R, delay: 'daily' },
  waffle: { name: 'Waffle House storms', source: 'National Hurricane Center; stores © OpenStreetMap contributors (ODbL)', url: 'https://www.nhc.noaa.gov/', licence: SA, delay: 'real-time', gaps: 'Stores: OpenStreetMap snapshot' },
  panic: { name: 'Panic pageviews', source: WEB, licence: PD, delay: 'daily' },
  hiring: { name: 'Job seekers per post', source: WEB, licence: R, delay: 'monthly' },
  hotdog: { name: 'Hot dog price', source: WEB, licence: R, delay: 'monthly', gaps: OCT25 },
  omens: { name: 'Moon, sky and sunspots', source: 'National Weather Service, NOAA', url: 'https://www.swpc.noaa.gov/', licence: PD, delay: 'real-time' },
  undies: { name: 'Underwear prices', source: 'BLS', url: 'https://data.bls.gov/timeseries/CUUR0000SEAA02', licence: PD, delay: 'monthly', gaps: OCT25 },
  bigmac: { name: 'Big Mac index', source: 'The Economist (CC BY 4.0)', url: 'https://github.com/TheEconomist/big-mac-data', licence: CR, delay: 'static', gaps: 'Twice a year' },
  billions: { name: 'Billionaire moves', source: WEB, licence: R, delay: 'real-time' },
  wsb: { name: 'WSB mentions', source: WEB, licence: R, delay: 'real-time' },
  odds: { name: 'Recession and Fed odds', source: WEB, licence: R, delay: 'real-time' },
  boxrate: { name: 'Container freight rate', source: WEB, licence: R, delay: 'weekly' },
  eggs: { name: 'Egg prices', source: WEB, licence: R, delay: 'monthly', gaps: OCT25 },
  rides: { name: 'Theme park waits', source: WEB, licence: R, delay: 'real-time' },
  buzz: { name: '10-Q buzzwords', source: 'SEC EDGAR', url: 'https://efts.sec.gov/LATEST/search-index', licence: PD, delay: 'daily' },
  beige: { name: 'Beige Book words', source: 'Federal Reserve Board', url: 'https://www.federalreserve.gov/monetarypolicy/beige-book-default.htm', licence: PD, delay: 'monthly', gaps: 'Eight editions a year' },
  trucks: { name: 'Freight volumes', source: WEB, licence: R, delay: 'monthly' },
  boxes: { name: 'Cardboard boxes', source: WEB, licence: R, delay: 'monthly' },
  lipstick: { name: 'Cosmetics prices', source: WEB, licence: R, delay: 'monthly', gaps: OCT25 },
  sick: { name: 'Wastewater virus levels', source: 'CDC', url: 'https://data.cdc.gov/', licence: PD, delay: 'weekly' },
  macau: { name: 'Macau casino revenue', source: WEB, licence: R, delay: 'monthly' },
};
const weirdInfo = (id) => WEIRD_INFO[id] || { name: id, source: WEB, licence: R, delay: 'daily' };

// Gauge id -> its command, where they differ (the registry names the command).
const WEIRD_CMD = { odds: 'CHANCES', eggs: 'EGGPRICE', buzz: 'BUZZWORD' };

export function weirdDataset(g) {
  const info = weirdInfo(g.id);
  const cmd = WEIRD_CMD[g.id] || g.id.toUpperCase();
  const entry = findCommand(cmd);
  return {
    id: `weird-${g.id}`, group: 'WEIRD', name: `${cmd}: ${info.name}`, source: info.source,
    ...(info.url ? { url: info.url } : {}), licence: info.licence, coverage: '--', history: '--', cadence: entry?.delay || '--', delay: info.delay,
    gaps: info.gaps || '--', modules: [], weird: g.id,
  };
}

export const datasetById = (id, gauges = []) => DATASETS.find((d) => d.id === id)
  || (String(id).startsWith('weird-') ? (gauges.find((g) => `weird-${g.id}` === id) ? weirdDataset(gauges.find((g) => `weird-${g.id}` === id)) : null) : null);

// ---- Envelopes per route ----------------------------------------------------------------

const DS = Object.fromEntries(DATASETS.map((d) => [d.id, d]));

// One envelope from a dataset's defaults.
function fromDs(id, body, { as_of, fetched_at, delay, note, now } = {}) {
  const d = DS[id];
  return envelope({
    source: d.source, source_url: d.url, dataset: d.id,
    as_of: as_of ?? body?.asOf ?? body?.updated,
    fetched_at: fetched_at ?? body?.updated,
    delay: delay || d.delay, note: note === undefined ? d.note : note, now,
  });
}

// Quote rows -> parts by delay class: real time, futures (10 min), other delayed (15 min).
// Each part's as_of is its OLDEST row (never one dated after the fetch): on a Sunday,
// a coin quoted a minute ago must not hide that the stocks beside it are Friday's close.
function quoteParts(items, body, now, { delayedAs = 'delayed-15m', rt = 'quotes', fut = 'futures', dly = 'intl', fetched_at } = {}) {
  const groups = new Map();
  for (const it of items || []) {
    if (!it || typeof it.realTime !== 'boolean') continue;
    let cls;
    let ds;
    if (it.realTime) { cls = 'real-time'; ds = rt; } else if (it.kind === 'future') { cls = 'delayed-10m'; ds = fut; } else { cls = it.kind ? 'delayed-15m' : delayedAs; ds = cls === 'delayed-10m' ? fut : dly; }
    const g = groups.get(cls) || { ds, times: [] };
    g.times.push(it.asOf);
    groups.set(cls, g);
  }
  const at = fetched_at ?? body?.updated;
  return [...groups.entries()].map(([cls, g]) => fromDs(g.ds, body, { delay: cls, as_of: oldest(g.times, at) || at, fetched_at, now }));
}

// Intraday bars move like the symbol's quote: US stocks, US indexes, FX, crypto and
// yields real time; futures about 10 minutes; non-US indexes about 15.
export function liveDelay(symbol) {
  const inst = instrumentById(String(symbol || '').toUpperCase());
  if (!inst) return /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(String(symbol || '')) ? 'real-time' : 'delayed-15m';
  if (inst.kind === 'future') return 'delayed-10m';
  if (inst.kind === 'index' && !inst.us) return 'delayed-15m';
  return 'real-time';
}

const newestItem = (items, key = 'time') => newest((items || []).map((x) => x?.[key]));
const NEWS_TAB_DS = { MARKETS: 'news', MACRO: 'news-macro', SEC: 'sec-feed', WIRES: 'news-wires', WSB: 'news-wsb' };

// path -> (body, { now, query }) -> envelope | null
export const ROUTES = {
  '/api/markets': (b, o) => combine(quoteParts(b.instruments, b, o.now)),
  '/api/fxmajors': (b, o) => combine(quoteParts(b.pairs, b, o.now)),
  '/api/quote': (b, o) => combine(quoteParts([b], b, o.now, { fetched_at: b.updated || b.fetchedAt })) || fromDs('quotes', b, o),
  '/api/quotes': (b, o) => combine(quoteParts(b.quotes, b, o.now)),
  '/api/world': (b, o) => combine(quoteParts(b.indexes, b, o.now)),
  '/api/sectors': (b, o) => combine(quoteParts(b.sectors, b, o.now, { dly: 'sectors', rt: 'sectors' })),
  '/api/bonds': (b, o) => combine(quoteParts(b.bonds, b, o.now, { rt: 'bonds', dly: 'bonds' })),
  '/api/commodities': (b, o) => combine(quoteParts(b.commodities, b, o.now, { delayedAs: 'delayed-10m' })),
  '/api/movers': (b, o) => fromDs('sp100', b, o),
  '/api/heatmap': (b, o) => fromDs('sp100', b, o),
  '/api/fishtank': (b, o) => fromDs('sp100', b, o),
  '/api/crypto': (b, o) => fromDs('crypto', b, { ...o, as_of: newestItem(b.coins, 'asOf') }),
  '/api/fx': (b, o) => fromDs('fx', b, { ...o, as_of: b.date }),
  '/api/fxmatrix': (b, o) => combine([fromDs('fx', b, { ...o, as_of: b.date }), ...(b.live && Object.keys(b.live).length ? [fromDs('quotes', b, o)] : [])]),
  '/api/curve': (b, o) => combine([...quoteParts(b.tenors, b, o.now), fromDs('treasury', b, { ...o, as_of: b.officialDate })]),
  '/api/rates': (b, o) => combine([
    ...quoteParts(b.yields, b, o.now, { fetched_at: b.yieldsUpdated }),
    b.fed ? fromDs('nyfed', b, { ...o, as_of: b.fed.date, fetched_at: b.fedUpdated }) : null,
    b.mortgage ? fromDs('mortgage', b, { ...o, as_of: b.mortgage.date, fetched_at: b.mortgageUpdated }) : null,
  ]),
  '/api/fedpath': (b, o) => combine([fromDs('fedfutures', b, o), b.fed ? fromDs('nyfed', b, { ...o, as_of: b.fed.date }) : null]),
  '/api/chart': (b, o) => {
    const last = b.points?.length ? b.points[b.points.length - 1] : null;
    const intraday = isIntradayBar(b.bar);
    const t = last?.t;
    // Daily bars: that day's 16:00 close. Intraday: the bar's own time.
    return fromDs('bars', b, { ...o, as_of: (intraday ? t : b.bar === '1D' ? barClose(t) : t) ?? b.updated, delay: intraday ? liveDelay(b.ticker) : 'end-of-day' });
  },
  '/api/compare': (b, o) => fromDs('bars', b, { ...o, as_of: barClose(Math.max(...(b.series || []).map((s) => s.points?.[s.points.length - 1]?.t ?? -Infinity))) }),
  '/api/history': (b, o) => fromDs('bars', b, { ...o, as_of: nyCloseIso(String(newestItem(b.rows, 'date') || '').slice(0, 10)) }),
  '/api/chart-events': (b, o) => fromDs('sec-subs', b, o),
  '/api/chart-news': (b, o) => fromDs('tickernews', b, { ...o, as_of: newestItem(b.items || b.headlines) }),
  '/api/tickernews': (b, o) => fromDs('tickernews', b, { ...o, as_of: newestItem(b.items) }),
  '/api/why': (b, o) => combine([fromDs('bars', b, { ...o, as_of: nyCloseIso(b.asOf) }), b.secOk === false ? null : fromDs('sec-subs', b, o), b.logSince ? fromDs('newslog', b, o) : null]),
  // latest.source 'static': BLS did not answer, so the newest annual average is used.
  '/api/cpi': (b, o) => (b.latest?.month
    ? fromDs('cpi', b, { ...o, as_of: `${b.latest.year}-${String(b.latest.month).padStart(2, '0')}` })
    : fromDs('cpi', b, { ...o, as_of: `${b.latest?.year}-12`, delay: 'static', note: `${DS.cpi.note}; BLS did not answer, so the ${b.latest?.year} annual average is used` })),
  '/api/news': (b, o) => fromDs(NEWS_TAB_DS[b.tab || 'MARKETS'] || 'news', b, { ...o, as_of: newestItem(b.items) }),
  '/api/whatif': (b, o) => fromDs('whatif', b, { ...o, note: b.replay?.cpi?.gap ? `${DS.whatif.note}; ${b.replay.cpi.gap}` : DS.whatif.note }),
  '/api/whatif/catalog': (b, o) => fromDs('whatif', b, { ...o, as_of: b.built, fetched_at: b.built, delay: 'static' }),
  '/api/funding': (b, o) => fromDs('whatif', b, o),
  '/api/financials': (b, o) => fromDs('sec-facts', b, { ...o, as_of: newest([...(b.quarterly?.periods || []), ...(b.annual?.periods || [])].map((p) => p.filed)) }),
  '/api/screen': (b, o) => fromDs('screener', b, o),
  '/api/breadth': (b, o) => combine([fromDs('screener', b, { ...o, as_of: b.sessionDate, fetched_at: b.exchangesUpdated }), fromDs('sp100', b, { ...o, fetched_at: b.sp100Updated })]),
  '/api/earnings': (b, o) => fromDs('earnings', b, o),
  '/api/beats': (b, o) => fromDs('earnings', b, o),
  '/api/calendar': (b, o) => fromDs('calendar', b, o),
  '/api/profile': (b, o) => fromDs('profile', b, o),
  '/api/dividends': (b, o) => fromDs('dividends', b, { ...o, as_of: b.exDate }),
  '/api/insiders': (b, o) => fromDs('insiders', b, { ...o, as_of: newestItem(b.rows, 'date') }),
  '/api/owners': (b, o) => fromDs('owners', b, o),
  '/api/filings': (b, o) => fromDs('sec-subs', b, { ...o, as_of: newest((b.rows || []).map((r) => r.accepted || r.filed)) }),
  '/api/shorts': (b, o) => fromDs('shorts', b, { ...o, as_of: newestItem(b.rows, 'date') }),
  '/api/value': (b, o) => fromDs('value', b, o),
  '/api/ipos': (b, o) => fromDs('ipos', b, o),
  '/api/splits': (b, o) => fromDs('ipos', b, o),
  '/api/exdiv': (b, o) => fromDs('ipos', b, o),
  '/api/options': (b, o) => fromDs('options', b, o),
  '/api/economy': (b, o) => fromDs('economy', b, { ...o, as_of: b.series ? newest(b.series.map((s) => s.date)) : newestItem(b.points, 'date') }),
  '/api/search': (b, o) => fromDs('search', b, { ...o, fetched_at: o.now }),
  '/api/trending': (b, o) => fromDs('trending', b, o),
  '/api/bbrk': (b, o) => fromDs('bbrk', b, o),
  '/api/guess/today': (b, o) => fromDs('guess', b, { ...o, fetched_at: o.now }),
  '/api/guess/check': (b, o) => fromDs('guess', b, { ...o, fetched_at: o.now }),
  '/api/guess/reveal': (b, o) => fromDs('guess', b, { ...o, fetched_at: o.now }),
};

// One WEIRD gauge (as /api/weird/<id> or a tile of /api/weird) -> its envelope.
export function gaugeEnvelope(g, now = Date.now()) {
  if (!g?.id || !g.ok) return null;
  const info = weirdInfo(g.id);
  return envelope({ source: info.source, source_url: info.url, as_of: g.asOf || g.updated, fetched_at: g.updated, delay: info.delay, note: info.gaps === OCT25 ? OCT25 : null, dataset: `weird-${g.id}`, now });
}

// All the WEIRD tiles: one line on top (every gauge has its own source), each gauge
// under parts. as_of: the newest gauge; fetched_at: the oldest (the worst age); delay:
// the class most gauges have.
export function weirdEnvelope(gauges, now = Date.now()) {
  const parts = (gauges || []).map((g) => gaugeEnvelope(g, now)).filter(Boolean);
  if (!parts.length) return null;
  const count = new Map();
  for (const p of parts) count.set(p.delay, (count.get(p.delay) || 0) + 1);
  const delay = [...count.entries()].sort((a, b) => b[1] - a[1] || rankOf(a[0]) - rankOf(b[0]))[0][0];
  const first = parts.reduce((a, b) => (b.fetched_at < a.fetched_at ? b : a));
  // Each gauge already carries its source, asOf and updated: its part keeps only what
  // the gauge does not have, so the answer grows little.
  return {
    ...envelope({ source: 'WEIRD gauges, one source each', as_of: newest(parts.map((p) => p.as_of)), fetched_at: first.fetched_at, delay, dataset: 'weird', now }),
    parts: parts.map(({ dataset, source_url, delay: d, note }) => ({ dataset, ...(source_url ? { source_url } : {}), delay: d, ...(note ? { note } : {}) })),
  };
}

// The envelope for one answer, or null for a route with none (Pro, sponsors).
export function provenanceFor(path, body, { now = Date.now(), query = {} } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  try {
    if (path === '/api/weird') return weirdEnvelope(body.gauges, now);
    if (path.startsWith('/api/weird/')) return gaugeEnvelope(body, now);
    const f = ROUTES[path];
    return f ? f(body, { now, query }) : null;
  } catch {
    return null;
  }
}

// A weak ETag of an answer without its age_seconds fields.
export function etagOf(body) {
  const text = JSON.stringify(body, (k, v) => (k === 'age_seconds' ? undefined : v));
  return `W/"${Buffer.byteLength(text).toString(16)}-${createHash('sha1').update(text).digest('base64url').slice(0, 27)}"`;
}

// dataset -> the as_of of the last answer this server gave for it (and when), so DATA
// can say how old the data is, not only when the source was last asked.
export const SEEN_AS_OF = new Map();
export function noteSeen(p, at = Date.now()) {
  for (const x of p?.parts || [p]) {
    if (!x?.dataset || !x.as_of) continue;
    SEEN_AS_OF.set(x.dataset, { as_of: x.as_of, at });
    if (SEEN_AS_OF.size > 500) SEEN_AS_OF.delete(SEEN_AS_OF.keys().next().value);
  }
}

// Express: every JSON answer under /api (2xx, an object) gets `provenance`.
export function provenanceJson({ now = () => Date.now() } = {}) {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 300 && body && typeof body === 'object' && !Array.isArray(body) && !body.provenance) {
        const path = String(req.originalUrl || '').split('?')[0];
        const p = provenanceFor(path, body, { now: now(), query: req.query });
        if (p) {
          noteSeen(p);
          const out = { ...body, provenance: p };
          // The ETag leaves out the ages (they change every second), so an unchanged
          // answer still gets its 304. Browsers work the age out from fetched_at.
          if (req.method === 'GET' && !res.get('ETag')) res.set('ETag', etagOf(out));
          return json(out);
        }
      }
      return json(body);
    };
    next();
  };
}

// ---- DATA, STATUS, CHANGES ----------------------------------------------------------------

// The newest good load of any of a dataset's modules, ms (0: none since the restart).
export function lastOk(modules, stats) {
  let best = 0;
  for (const s of stats) if (modules.includes(s.name) && s.okAt > best) best = s.okAt;
  return best;
}

// The DATA rows: every dataset with two measured ages (null: not known since the
// server started). age_seconds: how old the data is (now minus the as_of of the last
// answer given for it); checked_seconds: when the source was last asked (the cache's
// last good load). weird: the /api/weird gauges; edgar: the EDGAR watcher's stats;
// seen: SEEN_AS_OF.
export function dataRows({ stats = cacheStats(), gauges = [], weird = [], edgar = null, seen = SEEN_AS_OF, now = Date.now() } = {}) {
  const byId = new Map(weird.map((g) => [g.id, g]));
  const secs = (t) => (Number.isFinite(t) && t > 0 ? Math.max(0, Math.round((now - t) / 1000)) : null);
  const rows = [...DATASETS, ...gauges.map(weirdDataset)].map((d) => {
    let checked = 0;
    let asOf = seen.get(d.id)?.as_of || null;
    if (d.weird) {
      const g = byId.get(d.weird);
      checked = Date.parse(g?.updated || '') || 0;
      asOf = isoOf(g?.asOf) || asOf;
    } else if (d.id === 'sec-feed') {
      checked = edgar?.okAt || 0;
      asOf = edgar?.newestAt ? new Date(edgar.newestAt).toISOString() : asOf;
    } else {
      checked = lastOk(d.modules, stats);
    }
    // The licence label stays here (the legal round has it); DATA shows the class.
    const { modules, weird: w, note, licence, ...row } = d;
    return { ...row, as_of: asOf, age_seconds: secs(Date.parse(asOf || '')), checked_seconds: secs(checked) };
  });
  return rows;
}

// STATUS (Pro only): groups like the HOME markets grid, one row per item with its own
// plain name and the cache modules behind it. No source names here either.
export const STATUS_GROUPS = [
  ['PRICES', [['Quotes', ['quotes']], ['World indexes', ['world']], ['Futures and commodities', ['commodities']], ['Bond yields', ['bonds']],
    ['Sectors', ['sectors']], ['S&P 100', ['sp100']], ['Crypto', ['crypto']], ['FX reference rates', ['fx', 'fxmatrix']], ['Options', ['options']],
    ['Valuation', ['value']], ['Stock screener', ['screen', 'breadth']], ['Symbol search', ['search']]]],
  ['CHARTS', [['Price history', ['charts', 'history']], ['WHATIF your own', ['whatif-mine']]]],
  ['COMPANY DATA', [['Profiles', ['profile']], ['Dividends', ['dividends']], ['Split history', ['split-history']], ['Earnings', ['earnings', 'beats']],
    ['Insider trades', ['insiders']], ['Institutional holders', ['owners']], ['Short interest', ['shorts']], ['IPO and split calendars', ['ipos', 'splits']]]],
  ['SEC', [['Company financials', ['financials']], ['Filings', ['filings', 'chart-events']], ['Latest filings feed', null]]],
  ['MACRO', [['Treasury curve', ['curve']], ['Fed funds and mortgages', ['rates']], ['Fed funds futures', ['fedpath']], ['Economy', ['economy']],
    ['CPI', ['cpi']], ['Economic calendar', ['calendar']]]],
  ['NEWS', [['Market headlines', ['news']], ['News tabs', ['newsfeeds']], ['Company headlines', ['tickernews']]]],
];
export const SLOW_MS = 5000;

// One upstream's state from its modules' counts: FAILING when the last try failed,
// SLOW when the last good load took over SLOW_MS, OK, or -- before any try.
export function upstreamState(modules, stats) {
  const mine = stats.filter((s) => modules.includes(s.name));
  const okAt = Math.max(0, ...mine.map((s) => s.okAt));
  const failAt = Math.max(0, ...mine.map((s) => s.failAt));
  if (!okAt && !failAt) return { state: '--', okAt: 0, failAt: 0, ms: null };
  const latest = mine.reduce((a, b) => (Math.max(b.okAt, b.failAt) > Math.max(a.okAt, a.failAt) ? b : a));
  let state = 'OK';
  if (failAt > okAt) state = 'FAILING';
  else if (latest.ms > SLOW_MS) state = 'SLOW';
  return { state, okAt, failAt, ms: latest.ms };
}

// -> [{ group, rows: [{ name, state, last_ok_seconds }] }]. state: OK, SLOW, FAILING or --.
export function statusGroups({ stats = cacheStats(), weird = [], edgar = null, now = Date.now() } = {}) {
  const age = (t) => (t ? Math.max(0, Math.round((now - t) / 1000)) : null);
  const groups = STATUS_GROUPS.map(([group, items]) => ({
    group,
    rows: items.map(([name, modules]) => {
      if (!modules) { // the EDGAR watcher
        const e = edgar || {};
        const state = !e.okAt && !e.failAt ? '--' : e.failAt > e.okAt ? 'FAILING' : 'OK';
        return { name, state, last_ok_seconds: age(e.okAt) };
      }
      const st = upstreamState(modules, stats);
      return { name, state: st.state, last_ok_seconds: age(st.okAt) };
    }),
  }));
  groups.push({
    group: 'WEIRD',
    rows: weird.map((g) => ({
      name: weirdInfo(g.id).name,
      state: g.pending ? '--' : !g.ok ? 'FAILING' : g.stale ? 'SLOW' : 'OK',
      last_ok_seconds: age(Date.parse(g.updated || '') || 0),
    })),
  });
  // Kept on this server: up whenever the site is.
  groups.push({ group: 'OUR COUNTERS', rows: [{ name: 'Trending counts', state: 'OK', last_ok_seconds: null }, { name: 'Site numbers', state: 'OK', last_ok_seconds: null }] });
  return groups;
}

export const CHANGES_FILE = new URL('../data/changes.json', import.meta.url);

// deps: { gauges: [{ id, source }], weird: () => Promise<[gauge]>, edgar: () => stats,
// isPro: (req) => true for a valid, active Pro key (X-Pro-Key) }
export function mountProvenanceRoutes(app, { gauges = [], weird = async () => [], edgar = () => null, changesFile = CHANGES_FILE, isPro = () => false } = {}) {
  const weirdNow = async () => { try { return await weird(); } catch { return []; } };
  app.get('/api/data', async (req, res) => {
    const now = Date.now();
    const e = edgar();
    const rows = dataRows({ gauges, weird: await weirdNow(), edgar: e, now });
    res.set('Cache-Control', 'no-store');
    res.json({ rows, sec: e ? { seen_within_seconds: e.medianDelay ?? null, samples: e.samples ?? 0 } : null, updated: new Date(now).toISOString() });
  });
  // STATUS is part of Pro: a valid, active key or 403.
  app.get('/api/status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let ok = false;
    try { ok = Boolean(await isPro(req)); } catch { ok = false; }
    if (!ok) return res.status(403).json({ error: 'pro_only', message: 'STATUS is part of Pro.' });
    const now = Date.now();
    res.json({ groups: statusGroups({ weird: await weirdNow(), edgar: edgar(), now }), updated: new Date(now).toISOString() });
  });
  app.get('/api/changes', (req, res) => {
    let items = [];
    try { items = JSON.parse(readFileSync(changesFile, 'utf8')).items || []; } catch { items = []; }
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ items: items.filter((x) => x && x.date && x.text).slice(0, 200), updated: new Date().toISOString() });
  });
}
