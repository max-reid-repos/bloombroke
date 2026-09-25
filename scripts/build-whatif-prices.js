// One-time build: bake the historical closes WHATIF and 420 need into data/whatif-prices.json.
//
// Primary source: the public CNBC daily bars service (split-adjusted closes, no dividends),
// the same one the charts use. Every price is cross-checked against Yahoo Finance's
// split-adjusted close for the same day. A gap over 1% stops the build (exit 1) and lists
// the rows. A ticker Yahoo cannot serve is baked with verified: false.
//
// Run: node scripts/build-whatif-prices.js

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapeBars } from '../data/charts.js';
import { UA } from '../data/quotes.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(path.join(root, 'data/whatif-products.json'), 'utf8'));
const OUT = path.join(root, 'data/whatif-prices.json');
const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
const YAHOO_URL = 'https://query2.finance.yahoo.com/v8/finance/chart';
const FUNDING_DAY = '2018-08-07';
const TOLERANCE = 0.01;
const FIRST_DAY = '2007-01-01';

const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const today = new Date();
const endStamp = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
const round = (v) => Number(v.toPrecision(8));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cnbc(ticker) {
  const url = `${BARS_URL}/${encodeURIComponent(ticker)}/1D/${FIRST_DAY.replace(/-/g, '')}000000/${endStamp}000000/adjusted/EST5EDT.json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`CNBC ${ticker}: HTTP ${res.status}`);
  const body = await res.json();
  const pts = shapeBars(body?.barData?.priceBars).map((p) => ({ d: iso(p.d), v: p.v }));
  if (pts.length < 20) throw new Error(`CNBC ${ticker}: only ${pts.length} bars`);
  return pts;
}

// Yahoo: { closes: Map(date -> split-adjusted close), splits: [{ date, ratio }] }, or null.
async function yahoo(ticker) {
  const p1 = Math.floor(Date.parse(`${FIRST_DAY}T00:00:00Z`) / 1000);
  const p2 = Math.floor(today.getTime() / 1000) + 86_400;
  const url = `${YAHOO_URL}/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d&events=split`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      const r = (await res.json())?.chart?.result?.[0];
      const ts = r?.timestamp || [];
      const close = r?.indicators?.quote?.[0]?.close || [];
      const off = r?.meta?.gmtoffset ?? -14400;
      const closes = new Map();
      ts.forEach((t, i) => { if (Number.isFinite(close[i])) closes.set(new Date((t + off) * 1000).toISOString().slice(0, 10), close[i]); });
      const splits = Object.values(r?.events?.splits || {})
        .map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.splitRatio || `${s.numerator}:${s.denominator}` }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return closes.size ? { closes, splits } : null;
    } catch {
      await sleep(2000);
    }
  }
  return null;
}

// Last trading day on or before a date (the close you could have bought at).
const onOrBefore = (pts, date) => {
  let hit = null;
  for (const p of pts) { if (p.d <= date) hit = p; else break; }
  return hit;
};

const tickers = [...new Set([...catalog.products, ...catalog.recurring].map((p) => p.ticker).concat('TSLA'))];
const history = {};
const check = {};
for (const t of tickers) {
  history[t] = await cnbc(t);
  check[t] = await yahoo(t);
  console.log(`${t.padEnd(6)} CNBC ${history[t].length} bars from ${history[t][0].d}; Yahoo ${check[t] ? `${check[t].closes.size} bars, splits ${check[t].splits.map((s) => `${s.ratio} ${s.date}`).join(', ') || 'none'}` : 'UNAVAILABLE'}`);
  await sleep(600);
}

// Known non-split adjustments. CNBC also scales closes before a spin-off; Yahoo does not.
// Price return leaves out distributions (dividends and spin-offs alike), so for these rows the
// split-only close is used, and the CNBC close must match it once the known factor is removed.
const SPINOFFS = {
  SONY: { before: '2025-09-29', factor: 0.96735, reason: 'Sony Financial Group spin-off, 29 Sep 2025' },
};

const mismatches = [];
const unverified = [];
function priced(ticker, p, label) {
  const y = check[ticker]?.closes.get(p.d);
  const row = { date: p.d, close: round(p.v), src: 'cnbc' };
  if (!Number.isFinite(y)) {
    row.verified = false;
    unverified.push(`${label} ${ticker} ${p.d}`);
    return row;
  }
  const spin = SPINOFFS[ticker];
  if (spin && p.d < spin.before) {
    const gap = Math.abs(p.v / spin.factor - y) / y;
    Object.assign(row, { close: round(y), src: 'yahoo', check: round(p.v), verified: gap <= 0.002, note: `split-only close; CNBC also adjusts for the ${spin.reason}` });
    if (!row.verified) mismatches.push(`${label.padEnd(14)} ${ticker.padEnd(6)} ${p.d} CNBC ${p.v} / ${spin.factor} vs Yahoo ${y} (${(gap * 100).toFixed(2)}%)`);
    return row;
  }
  const gap = Math.abs(p.v - y) / y;
  row.check = round(y);
  row.verified = gap <= TOLERANCE;
  if (!row.verified) mismatches.push(`${label.padEnd(14)} ${ticker.padEnd(6)} ${p.d} CNBC ${p.v} Yahoo ${y} (${(gap * 100).toFixed(2)}%)`);
  return row;
}

const buys = {};
for (const p of catalog.products) {
  const hit = onOrBefore(history[p.ticker], p.date);
  if (!hit) throw new Error(`${p.id}: no close on or before ${p.date}`);
  buys[p.id] = priced(p.ticker, hit, p.id);
}

// Recurring: the first trading day of each month, from the earliest start.
const monthly = {};
for (const r of catalog.recurring) {
  const m = (monthly[r.ticker] ||= {});
  for (const p of history[r.ticker]) {
    const key = p.d.slice(0, 7);
    if (r.listed && p.d < r.listed) continue; // bars before the first real trade
    if (key >= r.start && !(key in m)) m[key] = priced(r.ticker, p, `${r.id} ${key}`);
  }
}

// 420: the close on the day, plus the last close of every week since, for the chart.
const tsla = history.TSLA;
const day = onOrBefore(tsla, FUNDING_DAY);
const week = (d) => Math.floor((Date.parse(d) / 86_400_000 + 3) / 7);
const weekly = [];
for (let i = tsla.indexOf(day); i < tsla.length; i += 1) {
  const p = tsla[i];
  const next = tsla[i + 1];
  if (p === day || !next || week(next.d) !== week(p.d)) weekly.push([p.d, round(p.v)]);
}

const last = Object.fromEntries(tickers.map((t) => [t, priced(t, history[t][history[t].length - 1], 'last')]));
const splits = Object.fromEntries(tickers.map((t) => [t, check[t]?.splits ?? null]));

if (mismatches.length) {
  console.error(`\n${mismatches.length} price(s) differ by more than ${TOLERANCE * 100}% between CNBC and Yahoo:\n${mismatches.join('\n')}`);
  process.exit(1);
}

const out = {
  built: today.toISOString().slice(0, 10),
  source: 'CNBC daily bars, split-adjusted closes, price only (no dividends); each close cross-checked against Yahoo Finance (1% tolerance)',
  buys,
  monthly,
  funding: { ...priced('TSLA', day, 'funding'), weekly },
  last,
  splits,
};
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`\nwrote ${path.relative(root, OUT)}: ${Object.keys(buys).length} buys, ${Object.keys(monthly).length} monthly series, ${weekly.length} weekly TSLA points`);
console.log(unverified.length ? `UNVERIFIED (one source only): ${unverified.length}\n${unverified.join('\n')}` : 'All prices verified against two sources.');
