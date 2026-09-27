// The WEIRD gauges the MCP server may serve: only gauges whose data comes from public
// domain or open sources (US government agencies, the Federal Reserve Board, Wikimedia
// pageviews). Every other gauge (FRED, CNBC, Polymarket, HN, Forbes, ApeWisdom,
// Queue-Times, IMF, Drewry, Apple, pizzint, DICJ, The Economist, OpenStreetMap store
// data) is not reachable here at all: not listed, not served by name.
//
// Each entry: the gauge id (data/weird/), its command, where the data can be checked,
// and detail(value): the gauge's own numbers, cut to a small plain shape.

import { round } from './envelope.js';

const r1 = (v) => round(v, 1);
const r3 = (v) => round(v, 3);

export const MCP_GAUGES = [
  {
    id: 'panic', command: 'PANIC', aliases: [],
    source: 'Wikimedia Foundation pageviews API (English Wikipedia, people only)',
    sourceUrl: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/',
    detail: (v) => ({
      views_last_day: v.total ?? null,
      avg_30_days: r1(v.avg30),
      change_pct: r1(v.pct),
      articles: (v.articles || []).slice(0, 8).map((a) => ({ article: a.label, views_last_day: a.last ?? null, avg_30_days: r1(a.avg30), change_pct: r1(a.pct) })),
    }),
  },
  {
    id: 'omens', command: 'OMENS', aliases: ['MOON'],
    source: 'National Weather Service; NOAA Space Weather Prediction Center; moon phase computed',
    sourceUrl: 'https://www.weather.gov/',
    // Three parts, three origins: each part carries its own envelope.
    parts: [
      { key: 'moon', source: 'Computed by Bloombroke from the date (astronomical formula)', sourceUrl: 'https://bloombroke.com/?c=OMENS' },
      { key: 'sky', source: 'National Weather Service, station KNYC (Central Park, New York)', sourceUrl: 'https://api.weather.gov/stations/KNYC/observations/latest', asOf: (v) => v.sky?.at },
      { key: 'sunspots', source: 'NOAA Space Weather Prediction Center, observed solar cycle indices', sourceUrl: 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json', asOf: (v) => v.sunspots?.month },
    ],
    detail: (v) => ({
      moon: v.moon ? { phase: v.moon.name, lit_share: r3(v.moon.lit), age_days: r1(v.moon.age), next_full: v.moon.nextFull || null, next_new: v.moon.nextNew || null } : null,
      sky: v.sky ? { text: v.sky.text ?? null, temp_c: r1(v.sky.tempC), observed_at: v.sky.at || null } : null,
      sunspots: v.sunspots ? { month: v.sunspots.month, number: v.sunspots.ssn } : null,
    }),
  },
  {
    id: 'undies', command: 'UNDIES', aliases: ['UNDERWEAR'],
    source: "US Bureau of Labor Statistics, CPI series CUUR0000SEAA02 (men's underwear, nightwear, swimwear and accessories)",
    sourceUrl: 'https://data.bls.gov/timeseries/CUUR0000SEAA02',
    detail: (v) => ({
      month: v.month || null,
      index: round(v.index, 3),
      change_vs_year_before_pct: r1(v.yoy),
      change_vs_month_before_pct: r1(v.mom),
      recent: (v.rows || []).slice(0, 12).map((x) => ({ month: x.month, index: round(x.value, 3), change_vs_year_before_pct: r1(x.yoy) })),
    }),
  },
  {
    id: 'buzz', command: 'BUZZWORD', aliases: ['BUZZWORDS'],
    source: 'SEC EDGAR full-text search (10-Q filings)',
    sourceUrl: 'https://www.sec.gov/edgar/search/',
    detail: (v) => ({
      quarter: v.quarter || null,
      quarters: (v.rows || []).slice(0, 8).map((x) => ({ quarter: x.label, start: x.start, end: x.end, partial: Boolean(x.partial), ai: x.ai ?? null, tariff: x.tariff ?? null, recession: x.recession ?? null })),
    }),
  },
  {
    id: 'beige', command: 'BEIGE', aliases: ['BEIGEBOOK'],
    source: 'Federal Reserve Board, Beige Book',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/publications/beige-book-default.htm',
    detail: (v) => ({
      top_word: v.top || null,
      editions: (v.editions || []).slice(0, 8).map((e) => ({ edition: e.edition, released: e.released, uncertain: e.uncertain ?? null, tariff: e.tariff ?? null, slow: e.slow ?? null, recession: e.recession ?? null, ai: e.ai ?? null })),
    }),
  },
  {
    id: 'sick', command: 'SICK', aliases: ['WASTEWATER'],
    source: 'CDC National Wastewater Surveillance System (dataset atcp-73re)',
    sourceUrl: 'https://data.cdc.gov/d/atcp-73re',
    detail: (v) => ({
      note: 'National figure: the median of all reporting sites each week, worked out by Bloombroke from CDC site data. Not a CDC national number.',
      pathogens: (v.rows || []).slice(0, 5).map((x) => ({ pathogen: x.label, week: x.week, level: round(x.level, 3), sites: x.sites ?? null, level_4_weeks_before: round(x.level4w, 3), change_4_weeks: round(x.change4w, 3) })),
    }),
  },
];

export const MCP_GAUGE_IDS = MCP_GAUGES.map((g) => g.id);

// 'panic', 'PANIC', 'moon', 'BeigeBook' -> the entry; anything else (every other gauge
// included) -> null.
export function mcpGauge(name) {
  const k = String(name ?? '').trim().toUpperCase();
  if (!k) return null;
  return MCP_GAUGES.find((g) => g.id.toUpperCase() === k || g.command === k || g.aliases.includes(k)) || null;
}
