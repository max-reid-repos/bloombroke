// The WEIRD gauges on screen: one entry per gauge, in tile order (tile 1 is the first).
// The data comes from /api/weird/<id> (data/weird/<id>.js on the server).
//
// Entry fields:
//   id       the API name
//   command  what you type (registered in registry.js, category "Weird data")
//   title    the panel title
//   period   'day' (default), 'month' or 'time': how the as-of date is written
//   method   paragraphs for the "How is this measured?" toggle
//   detail(d) -> { html, mount?(el, ctx) }: the detail screen body for one response
//
// To add a gauge: add an entry here, a data module on the server, a registry entry.

import { esc, fmtNum, nyTime } from './markets.js';
import { sparkSvg } from './economy.js';
import { legend } from './lines.js';
import { fmtDate } from '../kit.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// +12% / −12%, a true minus sign; '--' for no number.
export function signed(v, decimals = 1, unit = '%') {
  if (!Number.isFinite(v)) return '--';
  const s = Math.abs(v).toFixed(decimals);
  if (Number(s) === 0) return `${s}${unit}`;
  return `${v > 0 ? '+' : '−'}${s}${unit}`;
}
const dirCls = (v) => (!Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');

// 'YYYY-MM' or 'YYYY-MM-DD' -> 'AUG 2026'.
export function monthLabel(s) {
  const m = /^(\d{4})-(\d{2})/.exec(String(s || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '--';
}

// The as-of date in the gauge's own style.
export function asOfLabel(asOf, period = 'day') {
  if (!asOf) return '--';
  if (period === 'month') return monthLabel(asOf);
  return fmtDate(asOf, 'table');
}

// The tiny grey source line: "IMF PortWatch · SEP 20". A credit that already names the
// source replaces it ("The Economist, CC BY 4.0").
// A stale value (the source is not answering, so this is the last good reading) says
// so, with its real time: "pizzint.watch · last reading 18:00 ET SEP 25".
export function sourceLine(d, period) {
  const src = d.credit && d.credit.includes(d.source) ? d.credit : [d.source, d.credit].filter(Boolean).join(', ');
  if (d.ok === false) return src;
  if (!d.stale) return `${src} · ${asOfLabel(d.asOf, period)}`;
  const timed = period === 'time' && d.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(d.asOf);
  return `${src} · last reading ${timed ? `${nyTime(d.asOf)} ET ${asOfLabel(d.asOf)}` : asOfLabel(d.asOf, period)}`;
}

const stats = (rows) => `<dl class="stats wd-stats">${rows.map(([k, v]) => `<div class="stat"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const table = (head, rows) => `<table class="grid-table wd-table"><thead><tr>${head.map(([h, cls]) => `<th scope="col"${cls ? ` class="${cls}"` : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
const n0 = (v) => fmtNum(v, 0);
const chartHost = (id) => `<div class="chart-host wd-chart" id="${id}"></div>`;
const dayMs = (s) => Date.parse(`${s}T00:00:00Z`);

// ---- CANAL -------------------------------------------------------------------------
function canalDetail(d) {
  const num = (v, dp = 0) => (Number.isFinite(v) ? fmtNum(v, dp) : '--');
  const rows = d.rows.map((r) => `<tr><th scope="row" class="name">${esc(r.name)}</th>
    <td class="num">${num(r.total)}</td>
    <td class="num last">${num(r.week)}</td>
    <td class="num dim wd-hide-sm">${num(r.avgTotal)}</td>
    <td class="num ${dirCls(r.vsAvg)}">${signed(r.vsAvg, 0)}</td>
    <td class="num wd-hide-sm">${num(r.tanker)}</td>
    <td class="num dim wd-hide-sm">${num(r.avgTanker)}</td>
    <td class="wd-spark-cell wd-hide-sm">${sparkSvg(r.spark)}</td></tr>`);
  return { html: table([['Chokepoint'], [asOfLabel(d.asOf), 'num'], ['7-day avg', 'num'], ['1Y avg', 'num wd-hide-sm'], ['vs avg', 'num'], ['Tankers', 'num wd-hide-sm'], ['1Y avg', 'num wd-hide-sm'], ['90 days', 'wd-hide-sm']], rows) };
}

// ---- PIZZA -------------------------------------------------------------------------
function pizzaDetail(d) {
  const places = (d.places || []).map((p) => `<tr><th scope="row" class="name">${esc(p.name)}</th>
    <td class="num">${Number.isFinite(p.busy) ? n0(p.busy) : '--'}</td>
    <td class="num">${Number.isFinite(p.vsUsual) ? `${n0(p.vsUsual)}%` : '--'}</td>
    <td>${p.spike ? 'SPIKE' : ''}</td></tr>`);
  return {
    html: stats([
      ['Index', Number.isFinite(d.index) ? esc(fmtNum(d.index, 0)) : '--'],
      ['Level', Number.isFinite(d.defcon) ? `DEFCON ${esc(d.defcon)}` : '--'],
      ['Places spiking', Number.isFinite(d.spikes) ? esc(d.spikes) : '--'],
    ]) + (places.length ? table([['Place'], ['Busy now', 'num'], ['vs usual', 'num'], ['']], places) : ''),
  };
}

// ---- DEGEN -------------------------------------------------------------------------
function degenDetail(d) {
  const rows = d.apps.map((a) => `<tr><th scope="row" class="name">${esc(a.name)}</th>
    <td class="num last">${a.rank ? `#${a.rank}` : `<span class="dim">not in top ${esc(d.size)}</span>`}</td></tr>`);
  return { html: table([['App'], ['Rank', 'num']], rows) };
}

// ---- WAFFLE ------------------------------------------------------------------------
function waffleDetail(d) {
  const radius = (s) => ({
    far: '<span class="dim">too far</span>',
    none: '<span class="dim">no 34 kt</span>',
    error: '--',
  }[s.radiusFrom] || `${n0(s.radius)} mi`);
  const rows = d.storms.map((s) => `<tr><th scope="row" class="name">${esc(s.name)}</th>
    <td class="dim wd-hide-sm">${esc(s.kind)}</td>
    <td class="num wd-hide-sm">${Number.isFinite(s.windKt) ? `${n0(s.windKt)} kt` : '--'}</td>
    <td class="num">${n0(s.nearest)} mi</td>
    <td class="num">${radius(s)}</td>
    <td class="num last">${Number.isFinite(s.stores) ? n0(s.stores) : '--'}</td></tr>`);
  return {
    html: d.storms.length
      ? table([['Storm'], ['Type', 'wd-hide-sm'], ['Wind', 'num wd-hide-sm'], ['Nearest store', 'num'], ['Radius', 'num'], ['Inside', 'num']], rows)
      : '<p class="panel-msg">No active tropical storms.</p>',
  };
}

// ---- PANIC -------------------------------------------------------------------------
function panicDetail(d) {
  const rows = d.articles.map((a) => `<tr><th scope="row" class="name">${esc(a.label)}</th>
    <td class="num last">${n0(a.last)}</td><td class="num dim">${n0(a.avg30)}</td>
    <td class="num ${dirCls(a.pct)}">${signed(a.pct, 0)}</td></tr>`);
  const total = `<tr><th scope="row" class="name">All four</th><td class="num last">${n0(d.total)}</td><td class="num dim">${n0(d.avg30)}</td><td class="num ${dirCls(d.pct)}">${signed(d.pct, 0)}</td></tr>`;
  const series = d.articles.map((a, i) => ({ id: a.page, cls: `ln-${i}`, label: a.label, points: a.points.map((p) => ({ x: dayMs(p.date), y: p.views })) }));
  return {
    html: table([['Article'], [asOfLabel(d.asOf), 'num'], ['30d avg', 'num'], ['vs avg', 'num']], [...rows, total])
      + `<div class="wd-chart-head">${legend(series)}</div>${chartHost('wd-chart')}`,
    chart: { series, fmtY: (v) => n0(v), fmtX: (x) => fmtDate(x, 'axis'), label: 'Daily views, 90 days' },
  };
}

// ---- HIRING ------------------------------------------------------------------------
function hiringDetail(d) {
  const rows = d.months.map((m) => `<tr><th scope="row" class="name">${esc(monthLabel(m.month))}</th>
    <td class="num">${n0(m.hiring)}</td><td class="num">${n0(m.seeking)}</td><td class="num last">${fmtNum(m.ratio, 2)}</td></tr>`);
  const pts = d.months.slice().reverse().map((m) => ({ x: dayMs(`${m.month}-01`), y: m.ratio }));
  return {
    html: `${chartHost('wd-chart')}${table([['Month'], ['Hiring posts', 'num'], ['Seekers', 'num'], ['Per job', 'num']], rows)}`,
    chart: { series: [{ id: 'r', cls: 'ln-0', label: 'Seekers per job post', points: pts }], fmtY: (v) => fmtNum(v, 2), fmtX: (x) => fmtDate(x, 'axis'), label: 'Seekers per job post' },
  };
}

// ---- HOTDOG ------------------------------------------------------------------------
function hotdogDetail(d) {
  const pick = d.series.filter((s, i) => i === 0 || i === d.series.length - 1 || Number(s.date) % 10 === 5);
  const rows = pick.reverse().map((s) => `<tr><th scope="row" class="name">${esc(s.date.length > 4 ? monthLabel(s.date) : s.date)}</th><td class="num last">$${fmtNum(s.price, 2)}</td></tr>`);
  const pts = d.series.map((s) => ({ x: s.date.length > 4 ? dayMs(`${s.date}-01`) : Date.UTC(Number(s.date), 6, 1), y: s.price }));
  return {
    html: stats([
      ['Costco price', `$${fmtNum(d.price1985, 2)} <span class="dim">since 1985</span>`],
      ['Adjusted for CPI', `$${fmtNum(d.price, 2)}`],
      ['CPI 1985 average', fmtNum(d.cpiBase, 1)],
      [`CPI ${monthLabel(d.cpiDate)}`, fmtNum(d.cpiNow, 1)],
    ]) + chartHost('wd-chart') + table([['Year'], ['$1.50 of 1985 money', 'num']], rows),
    chart: { series: [{ id: 'p', cls: 'ln-0', label: 'Adjusted price', points: pts }], fmtY: (v) => `$${fmtNum(v, 2)}`, fmtX: (x) => String(new Date(x).getUTCFullYear()), label: 'Hot dog price adjusted for CPI' },
  };
}

// ---- OMENS -------------------------------------------------------------------------
function omensDetail(d) {
  const m = d.moon;
  const sky = d.sky
    ? `${esc(d.sky.text || '--')}${Number.isFinite(d.sky.tempC) ? ` <span class="dim">${fmtNum(d.sky.tempC, 0)}°C / ${fmtNum(d.sky.tempC * 1.8 + 32, 0)}°F</span>` : ''}`
    : '<span class="dim">NO DATA · NWS</span>';
  const sun = d.sunspots
    ? `${fmtNum(d.sunspots.ssn, 1)} <span class="dim">${esc(monthLabel(d.sunspots.month))}</span>`
    : '<span class="dim">NO DATA · NOAA SWPC</span>';
  const pts = (d.sunspots?.series || []).map((r) => ({ x: dayMs(`${r.month}-01`), y: r.ssn }));
  return {
    html: stats([
      ['Moon', esc(m.name)],
      ['Lit', `${fmtNum(m.lit * 100, 0)}%`],
      ['Next full moon', esc(fmtDate(m.nextFull, 'prose'))],
      ['Next new moon', esc(fmtDate(m.nextNew, 'prose'))],
      ['Sky, Central Park', sky],
      ['Sunspot number', sun],
    ]) + (pts.length > 1 ? `<p class="wd-sub">Sunspot number, monthly, 10 years</p>${chartHost('wd-chart')}` : ''),
    chart: pts.length > 1 ? { series: [{ id: 's', cls: 'ln-0', label: 'Sunspots', points: pts }], fmtY: (v) => fmtNum(v, 0), fmtX: (x) => String(new Date(x).getUTCFullYear()), label: 'Sunspot number' } : null,
  };
}

// ---- UNDIES ------------------------------------------------------------------------
function undiesDetail(d) {
  const rows = d.rows.map((r) => `<tr><th scope="row" class="name">${esc(monthLabel(r.month))}</th>
    <td class="num last">${fmtNum(r.value, 1)}</td><td class="num ${dirCls(r.yoy)}">${signed(r.yoy, 1)}</td></tr>`);
  return {
    html: stats([
      ['Change on a year', `<span class="${dirCls(d.yoy)}">${signed(d.yoy, 1)}</span>`],
      ['Change on a month', `<span class="${dirCls(d.mom)}">${signed(d.mom, 1)}</span>`],
      [`Index ${monthLabel(d.month)}`, fmtNum(d.index, 1)],
    ]) + table([['Month'], ['Index', 'num'], ['vs year before', 'num']], rows),
  };
}

// ---- BIGMAC ------------------------------------------------------------------------
// Economist country names that differ from the browser's region names.
const BIGMAC_NAMES = { GB: 'Britain', CZ: 'Czech Republic', HK: 'Hong Kong', TR: 'Turkey', AE: 'United Arab Emirates', US: 'United States' };
const EURO = ['AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'];

// The viewer's country from the browser language (en-TH -> Thailand), or null.
export function localBigMac(rows, lang = globalThis.navigator?.language) {
  try {
    const region = new Intl.Locale(lang).maximize().region;
    if (!region) return null;
    const name = EURO.includes(region) ? 'Euro area' : BIGMAC_NAMES[region] || new Intl.DisplayNames(['en'], { type: 'region' }).of(region);
    return rows.find((r) => r.name === name) || null;
  } catch {
    return null;
  }
}

function bigmacDetail(d) {
  const row = (r) => `<tr><th scope="row" class="name">${esc(r.name)}</th><td class="num">$${fmtNum(r.dollarPrice, 2)}</td><td class="num last ${dirCls(r.usdRaw)}">${signed(r.usdRaw, 0)}</td></tr>`;
  const head = [['Country'], ['Price in $', 'num'], ['vs US', 'num']];
  const mine = localBigMac(d.rows);
  return {
    html: stats([
      ['US price', `$${fmtNum(d.usPrice, 2)}`],
      ...(mine ? [[`You: ${mine.name}`, `$${fmtNum(mine.dollarPrice, 2)} <span class="${dirCls(mine.usdRaw)}">${signed(mine.usdRaw, 0)}</span>`]] : []),
    ]) + `<div class="wd-two">
      <div><p class="wd-sub">Priciest vs USD</p>${table(head, d.over.map(row))}</div>
      <div><p class="wd-sub">Cheapest vs USD</p>${table(head, d.under.map(row))}</div>
    </div>`,
  };
}

export const WEIRD_GAUGES = [
  {
    id: 'canal', command: 'CANAL', title: 'Canal', detail: canalDetail,
    method: [
      'Ships that crossed each chokepoint in one day, from IMF PortWatch, which counts them from ship position (AIS) signals. Tankers are one ship type inside the total.',
      'The headline is the mean daily count for Hormuz over the last 7 days on file. The 1-year average is the mean over the 365 days to the latest day, and "vs avg" compares the two. PortWatch runs about 6 days behind.',
    ],
  },
  {
    id: 'pizza', command: 'PIZZA', title: 'Pizza', period: 'time', detail: pizzaDetail,
    method: [
      'pizzint.watch, an unofficial site, reads how busy pizza places near the Pentagon are against their usual level, and turns that into a level from 5 (quiet) to 1 that it calls DEFCON.',
      'The idea is old folklore: late-night orders jump when something big is going on. It is shown for fun, with no claim either way.',
      'The feed is often empty overnight. Then this screen shows NO DATA.',
    ],
  },
  {
    id: 'degen', command: 'DEGEN', title: 'Degen', period: 'time', detail: degenDetail,
    method: [
      "Where each app sits in Apple's US top 100 free iPhone apps, from Apple's public chart feed, updated about daily.",
      'Not in the top 100 means it ranks lower than 100. Apps are matched by App Store id, then by name.',
    ],
  },
  {
    id: 'waffle', command: 'WAFFLE', title: 'Waffle', period: 'time', detail: waffleDetail,
    method: [
      'Active storms come from the National Hurricane Center. For each storm, a store counts when it is inside the tropical-storm-force wind radius (34 knots) in the latest forecast advisory. The advisory gives one radius per quadrant: NE, SE, SW, NW.',
      'A storm whose advisory has no 34-knot radius (a depression) counts zero. A storm more than 800 miles from every store counts zero. If a nearby storm\'s advisory will not load, its row shows -- and the count is marked partial; if no nearby storm could be counted, the gauge shows its last reading or NO DATA.',
      'Store locations: a one-time OpenStreetMap snapshot of Waffle House locations in the contiguous US (brand Q1701206), © OpenStreetMap contributors, ODbL.',
      'A former FEMA head, Craig Fugate, used whether Waffle Houses stayed open as a quick read on storm damage. People call it the Waffle House Index.',
    ],
  },
  {
    id: 'panic', command: 'PANIC', title: 'Panic', detail: panicDetail,
    method: [
      'Daily views by people (bots left out) of four English Wikipedia articles: Recession, Stock market crash, Stagflation and Bank run. Source: the Wikimedia pageviews API.',
      "The headline is the latest full day's total for all four, against the average of the 30 days before it.",
    ],
  },
  {
    id: 'hiring', command: 'HIRING', title: 'Hiring', period: 'month', detail: hiringDetail,
    method: [
      'Each month Hacker News posts two threads: "Who is hiring?" (one comment per job ad) and "Who wants to be hired?" (one per person). This divides the comments on the second by the comments on the first.',
      'Counts include replies, so they are rough. Threads keep growing for a few weeks, so the headline uses the newest month whose threads are at least 7 days old. Source: the HN Algolia search API.',
    ],
  },
  {
    id: 'hotdog', command: 'HOTDOG', title: 'Hot dog', period: 'month', detail: hotdogDetail,
    method: [
      'Costco has charged $1.50 for its hot dog and soda since 1985. That $1.50 is the one fixed number on this screen.',
      'Adjusted price = $1.50 x (latest monthly CPI / 1985 average CPI). CPI is for all urban consumers, seasonally adjusted, FRED series CPIAUCSL.',
    ],
  },
  {
    id: 'omens', command: 'OMENS', title: 'Omens', period: 'time', detail: omensDetail,
    method: [
      'Moon: worked out on our server with the method in Jean Meeus, Astronomical Algorithms, chapter 49. New and full moon times are good to a few minutes.',
      'Sky: the latest National Weather Service observation from Central Park, New York (station KNYC). Sunspots: the monthly sunspot number from the NOAA Space Weather Prediction Center.',
      'People have studied all three. William Stanley Jevons linked trade cycles to the sunspot cycle in 1875. Hirshleifer and Shumway (2003, "Good Day Sunshine") looked at morning sunshine and stock returns in 26 cities. Yuan, Zheng and Zhu (2006, "Are investors moonstruck?") looked at lunar phases and returns. Shown for fun, with no claim either way.',
    ],
  },
  {
    id: 'undies', command: 'UNDIES', title: 'Undies', period: 'month', detail: undiesDetail,
    method: [
      "The BLS consumer price index for men's underwear, nightwear, swimwear and accessories (series CUUR0000SEAA02), US city average, not seasonally adjusted. So the month-on-month change includes seasonal swings.",
      'Alan Greenspan is said to have watched men\'s underwear sales, on the idea that men put off new pairs when money is tight. That is folklore, not a tested rule.',
    ],
  },
  {
    id: 'bigmac', command: 'BIGMAC', title: 'Big Mac', period: 'month', detail: bigmacDetail,
    method: [
      "The Economist's Big Mac index: the price of a Big Mac in each country, turned into dollars at the market exchange rate, against the US price.",
      '+45% means a Big Mac costs 45% more in dollars there than in the US, a rough hint that the currency is dear against the dollar. This is the raw index, not the GDP-adjusted one. Updated twice a year.',
      'Data: The Economist, CC BY 4.0, github.com/TheEconomist/big-mac-data.',
    ],
  },
];

export const gaugeByCommand = (cmd) => WEIRD_GAUGES.find((g) => g.command === cmd) || null;
