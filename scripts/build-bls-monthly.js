// One-time build: bake the monthly BLS series WHATIF needs into data/bls-monthly.json.
//
//   CUUR0000SA0     CPI-U, all items (the CASH IN A JAR line in REPLAY)
//   APU0000720111   average price of beer (malt beverages), per 16 oz    (VICES: beer)
//   APU0000FN1102   average price of a 12 oz soft drink can, in 12-packs (VICES: soda)
//   APU0000718311   average price of potato chips, per 16 oz             (VICES: chips)
//
// Primary source: the public BLS API v1 (no key: 25 queries a day, 10 years a query, so
// the whole build is 2 queries). Every value is cross-checked against the same series on
// FRED (St. Louis Fed; CPI-U is CPIAUCNS there). A gap over 0.1%, or a month one source
// has and the other does not, stops the build (exit 1) and lists the rows.
//
// Run: node scripts/build-bls-monthly.js
// To spare the BLS quota, BLS_RAW=<dir> reads saved v1 responses (bls-2007.json and
// bls-2017.json) from <dir> instead of calling the API; FRED is always fetched.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'data/bls-monthly.json');
const BLS_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const FRED_URL = (id) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
const FIRST_YEAR = 2007;
const TOLERANCE = 0.001;

export const SERIES = {
  CUUR0000SA0: { fred: 'CPIAUCNS', unit: 'index', name: 'CPI-U, U.S. city average, all items, not seasonally adjusted, 1982-84=100' },
  APU0000720111: { fred: 'APU0000720111', unit: 'USD', name: 'Average price: malt beverages, all types, all sizes, any origin, per 16 oz, U.S. city average' },
  APU0000FN1102: { fred: 'APU0000FN1102', unit: 'USD', name: 'Average price: all soft drinks, 12 pack, 12 oz cans, per 12 oz, U.S. city average' },
  APU0000718311: { fred: 'APU0000718311', unit: 'USD', name: 'Average price: potato chips, per 16 oz, U.S. city average' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BLS v1 body -> { seriesId: { 'YYYY-MM': value } }. M13 (annual average) is skipped.
export function blsMonths(body) {
  if (body?.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS: ${body?.status} ${JSON.stringify(body?.message || '')}`);
  const out = {};
  for (const s of body.Results?.series || []) {
    const m = (out[s.seriesID] ||= {});
    for (const d of s.data || []) {
      if (!/^M(0[1-9]|1[0-2])$/.test(d.period)) continue;
      const v = Number(d.value);
      if (Number.isFinite(v) && v > 0) m[`${d.year}-${d.period.slice(1)}`] = v;
    }
  }
  return out;
}

// FRED CSV ("observation_date,ID\n2007-01-01,202.416") -> { 'YYYY-MM': value }. "." is a gap.
export function fredMonths(csv) {
  const out = {};
  for (const line of String(csv).trim().split(/\r?\n/).slice(1)) {
    const [d, raw] = line.split(',');
    const v = Number(raw);
    if (/^\d{4}-\d{2}-01$/.test(d) && raw !== '.' && Number.isFinite(v) && v > 0) out[d.slice(0, 7)] = v;
  }
  return out;
}

// Both sources, month by month, from FIRST_YEAR on. Returns the list of problems.
export function crossCheck(id, bls, fred, firstYear = FIRST_YEAR) {
  const problems = [];
  const keys = new Set([...Object.keys(bls), ...Object.keys(fred)].filter((k) => Number(k.slice(0, 4)) >= firstYear));
  for (const k of [...keys].sort()) {
    const a = bls[k];
    const b = fred[k];
    if (a === undefined || b === undefined) { problems.push(`${id} ${k}: BLS ${a ?? 'missing'} FRED ${b ?? 'missing'}`); continue; }
    if (Math.abs(a - b) / b > TOLERANCE) problems.push(`${id} ${k}: BLS ${a} FRED ${b}`);
  }
  return problems;
}

async function blsQuery(ids, startYear, endYear) {
  if (process.env.BLS_RAW) return JSON.parse(readFileSync(path.join(process.env.BLS_RAW, `bls-${startYear}.json`), 'utf8'));
  const res = await fetch(BLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seriesid: ids, startyear: String(startYear), endyear: String(endYear) }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);
  return res.json();
}

async function fred(id) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(FRED_URL(id), { headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(170000) });
      if (res.ok) {
        const text = await res.text();
        if (/^observation_date,/i.test(text)) return fredMonths(text);
      }
    } catch { /* retry */ }
    await sleep(5000);
  }
  throw new Error(`FRED ${id}: no data`);
}

async function main() {
  const ids = Object.keys(SERIES);
  const year = new Date().getUTCFullYear();
  const bls = {};
  for (let start = FIRST_YEAR; start <= year; start += 10) {
    const part = blsMonths(await blsQuery(ids, start, Math.min(start + 9, year)));
    for (const [id, m] of Object.entries(part)) Object.assign((bls[id] ||= {}), m);
  }
  const fredData = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await fred(SERIES[id].fred)])));

  const problems = ids.flatMap((id) => crossCheck(id, bls[id] || {}, fredData[id]));
  for (const id of ids) if (!Object.keys(bls[id] || {}).length) problems.push(`${id}: no BLS data`);
  if (problems.length) {
    console.error(`${problems.length} BLS value(s) do not match FRED:\n${problems.join('\n')}`);
    process.exit(1);
  }

  const series = {};
  for (const id of ids) {
    const keys = Object.keys(bls[id]).sort();
    series[id] = { ...SERIES[id], first: keys[0], last: keys[keys.length - 1], values: Object.fromEntries(keys.map((k) => [k, bls[id][k]])) };
    console.log(`${id.padEnd(14)} ${keys.length} months ${keys[0]} to ${keys[keys.length - 1]}, all matched FRED ${SERIES[id].fred}`);
  }
  const out = {
    built: new Date().toISOString().slice(0, 10),
    source: 'U.S. Bureau of Labor Statistics, public API v1 (CPI and Average Price Data); every month cross-checked against FRED, Federal Reserve Bank of St. Louis (0.1% tolerance)',
    series,
  };
  writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`wrote ${path.relative(root, OUT)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
