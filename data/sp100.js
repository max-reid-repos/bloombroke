// S&P 100 quotes in one CNBC batch (no key). Feeds MOVERS and HEATMAP.
// Members and GICS sectors: the S&P 100 list as of 21 Sep 2026 (iShares OEF holdings,
// via Wikipedia). Update the list when the index changes.

import { createCache } from './cache.js';
import { fetchCnbcRows, parseNum } from './quotes.js';
import { capNum, iso } from './lists.js';

export const SP100_AS_OF = '2026-09-21';

export const SECTORS = {
  TECH: 'Information Technology',
  COMM: 'Communication Services',
  DISC: 'Consumer Discretionary',
  STAPLES: 'Consumer Staples',
  HEALTH: 'Health Care',
  FIN: 'Financials',
  IND: 'Industrials',
  ENERGY: 'Energy',
  UTIL: 'Utilities',
  RE: 'Real Estate',
  MAT: 'Materials',
};

export const SP100 = [
  ['AAPL', 'Apple', 'TECH'], ['ABBV', 'AbbVie', 'HEALTH'], ['ABT', 'Abbott Laboratories', 'HEALTH'],
  ['ACN', 'Accenture', 'TECH'], ['ADBE', 'Adobe', 'TECH'], ['AMAT', 'Applied Materials', 'TECH'],
  ['AMD', 'Advanced Micro Devices', 'TECH'], ['AMGN', 'Amgen', 'HEALTH'], ['AMT', 'American Tower', 'RE'],
  ['AMZN', 'Amazon', 'DISC'], ['ANET', 'Arista Networks', 'TECH'], ['AVGO', 'Broadcom', 'TECH'],
  ['AXP', 'American Express', 'FIN'], ['BA', 'Boeing', 'IND'], ['BAC', 'Bank of America', 'FIN'],
  ['BKNG', 'Booking Holdings', 'DISC'], ['BLK', 'BlackRock', 'FIN'], ['BMY', 'Bristol Myers Squibb', 'HEALTH'],
  ['BNY', 'BNY Mellon', 'FIN'], ['BRK.B', 'Berkshire Hathaway B', 'FIN'], ['C', 'Citigroup', 'FIN'],
  ['CAT', 'Caterpillar', 'IND'], ['CMCSA', 'Comcast', 'COMM'], ['COF', 'Capital One', 'FIN'],
  ['COP', 'ConocoPhillips', 'ENERGY'], ['COST', 'Costco', 'STAPLES'], ['CRM', 'Salesforce', 'TECH'],
  ['CSCO', 'Cisco', 'TECH'], ['CVS', 'CVS Health', 'HEALTH'], ['CVX', 'Chevron', 'ENERGY'],
  ['DE', 'Deere', 'IND'], ['DELL', 'Dell Technologies', 'TECH'], ['DHR', 'Danaher', 'HEALTH'],
  ['DIS', 'Walt Disney', 'COMM'], ['DUK', 'Duke Energy', 'UTIL'], ['EMR', 'Emerson Electric', 'IND'],
  ['FDX', 'FedEx', 'IND'], ['GD', 'General Dynamics', 'IND'], ['GE', 'GE Aerospace', 'IND'],
  ['GEV', 'GE Vernova', 'IND'], ['GILD', 'Gilead Sciences', 'HEALTH'], ['GM', 'General Motors', 'DISC'],
  ['GOOG', 'Alphabet C', 'COMM'], ['GOOGL', 'Alphabet A', 'COMM'], ['GS', 'Goldman Sachs', 'FIN'],
  ['HD', 'Home Depot', 'DISC'], ['IBM', 'IBM', 'TECH'], ['INTC', 'Intel', 'TECH'],
  ['INTU', 'Intuit', 'TECH'], ['ISRG', 'Intuitive Surgical', 'HEALTH'], ['JNJ', 'Johnson & Johnson', 'HEALTH'],
  ['JPM', 'JPMorgan Chase', 'FIN'], ['KO', 'Coca-Cola', 'STAPLES'], ['LIN', 'Linde', 'MAT'],
  ['LLY', 'Eli Lilly', 'HEALTH'], ['LMT', 'Lockheed Martin', 'IND'], ['LOW', "Lowe's", 'DISC'],
  ['LRCX', 'Lam Research', 'TECH'], ['MA', 'Mastercard', 'FIN'], ['MCD', "McDonald's", 'DISC'],
  ['MDLZ', 'Mondelez', 'STAPLES'], ['MDT', 'Medtronic', 'HEALTH'], ['META', 'Meta Platforms', 'COMM'],
  ['MMM', '3M', 'IND'], ['MO', 'Altria', 'STAPLES'], ['MRK', 'Merck', 'HEALTH'],
  ['MS', 'Morgan Stanley', 'FIN'], ['MSFT', 'Microsoft', 'TECH'], ['MU', 'Micron Technology', 'TECH'],
  ['NEE', 'NextEra Energy', 'UTIL'], ['NFLX', 'Netflix', 'COMM'], ['NOW', 'ServiceNow', 'TECH'],
  ['NVDA', 'Nvidia', 'TECH'], ['ORCL', 'Oracle', 'TECH'], ['PANW', 'Palo Alto Networks', 'TECH'],
  ['PEP', 'PepsiCo', 'STAPLES'], ['PFE', 'Pfizer', 'HEALTH'], ['PG', 'Procter & Gamble', 'STAPLES'],
  ['PLTR', 'Palantir', 'TECH'], ['PM', 'Philip Morris', 'STAPLES'], ['QCOM', 'Qualcomm', 'TECH'],
  ['RTX', 'RTX', 'IND'], ['SBUX', 'Starbucks', 'DISC'], ['SCHW', 'Charles Schwab', 'FIN'],
  ['SNDK', 'Sandisk', 'TECH'], ['SO', 'Southern Company', 'UTIL'], ['T', 'AT&T', 'COMM'],
  ['TMO', 'Thermo Fisher', 'HEALTH'], ['TMUS', 'T-Mobile US', 'COMM'], ['TSLA', 'Tesla', 'DISC'],
  ['TXN', 'Texas Instruments', 'TECH'], ['UBER', 'Uber', 'IND'], ['UNH', 'UnitedHealth', 'HEALTH'],
  ['UNP', 'Union Pacific', 'IND'], ['UPS', 'UPS', 'IND'], ['USB', 'U.S. Bancorp', 'FIN'],
  ['V', 'Visa', 'FIN'], ['VZ', 'Verizon', 'COMM'], ['WFC', 'Wells Fargo', 'FIN'],
  ['WMT', 'Walmart', 'STAPLES'], ['XOM', 'ExxonMobil', 'ENERGY'],
].map(([ticker, name, sector]) => ({ ticker, name, sector }));

const TTL = 2 * 60_000;

// CNBC rows -> one entry per member that has a price.
export function parseSp100(rows, members = SP100) {
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const out = [];
  for (const m of members) {
    const r = bySym.get(m.ticker);
    if (!r || Number(r.code) !== 0) continue;
    const last = parseNum(r.last);
    if (!Number.isFinite(last)) continue;
    const change = parseNum(r.change);
    const changePct = parseNum(r.change_pct);
    const volume = parseNum(r.volume);
    out.push({
      ...m,
      last,
      change: Number.isFinite(change) ? change : 0,
      changePct: Number.isFinite(changePct) ? changePct : 0,
      volume: Number.isFinite(volume) ? volume : null,
      marketCap: capNum(r.mktcapView),
      asOf: r.last_time || null,
    });
  }
  return out;
}

// Top n gainers, losers and most traded (by shares).
export function pickMovers(stocks, n = 10) {
  const byPct = [...stocks].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: byPct.filter((s) => s.changePct > 0).slice(0, n),
    losers: byPct.filter((s) => s.changePct < 0).reverse().slice(0, n),
    active: stocks.filter((s) => Number.isFinite(s.volume)).sort((a, b) => b.volume - a.volume).slice(0, n),
  };
}

// HEATMAP boxes need a market cap: members without one are left out.
export function heatmapStocks(stocks) {
  return stocks.filter((s) => s.marketCap > 0).map(({ ticker, name, sector, last, changePct, marketCap }) => ({ ticker, name, sector, last, changePct, marketCap }));
}

// FISHTANK keeps every member; a missing cap is null (that fish gets the plain size).
export function fishtankStocks(stocks) {
  return stocks.map(({ ticker, name, changePct, marketCap }) => ({ ticker, name, changePct, marketCap: marketCap > 0 ? marketCap : null }));
}

export function makeSp100({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  async function load() {
    const { value, stale, fetchedAt } = await cache.cached('sp100', TTL, async () => {
      const rows = await fetchCnbcRows(fetchImpl, SP100.map((m) => m.ticker));
      const stocks = parseSp100(rows);
      if (stocks.length < 80) throw new Error('quotes source: too few S&P 100 rows');
      return stocks;
    });
    return { stocks: value, stale, updated: iso(fetchedAt) };
  }

  return {
    async getMovers() {
      const { stocks, stale, updated } = await load();
      return { ...pickMovers(stocks), count: stocks.length, stale, updated };
    },
    async getHeatmap() {
      const { stocks, stale, updated } = await load();
      return {
        stocks: heatmapStocks(stocks),
        sectors: SECTORS,
        asOfList: SP100_AS_OF,
        stale,
        updated,
      };
    },
    async getFishtank() {
      const { stocks, stale, updated } = await load();
      return { stocks: fishtankStocks(stocks), stale, updated };
    },
  };
}

export const { getMovers, getHeatmap, getFishtank } = makeSp100();
