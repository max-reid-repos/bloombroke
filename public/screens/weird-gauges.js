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

import { esc, q, fmtNum, nyTime } from './markets.js';
import { sparkSvg } from './economy.js';
import { legend } from './lines.js';
import { fmtDate } from '../kit.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---- Periods (the row of 3M 1Y 5Y 10Y MAX on every WEIRD screen) ---------------------
// Shared by the browser (the row, the command words) and the server (data/weird/history.js
// slices each gauge's history to one of these). AUTO is the grid's own start: each tile
// as the gauge draws it by default.
export const WEIRD_PERIODS = ['3M', '1Y', '5Y', '10Y', 'MAX'];
export const PERIOD_DAYS = { '3M': 91, '1Y': 365, '5Y': 1826, '10Y': 3652, MAX: Infinity };
export const AUTO = 'AUTO';

// One typed word -> '5Y' (any case), or null when it is not a period.
export function periodWord(tok) {
  const t = String(tok ?? '').trim().toUpperCase();
  return WEIRD_PERIODS.includes(t) ? t : null;
}

// '2026-09-27' -> '27 SEP 2026'.
export function dayLabel(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '--';
}

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

// The source line as HTML. A gauge whose source asks for a linked credit (RIDES:
// "Powered by Queue-Times.com") gets that name as a link, like the CoinGecko credit.
export function sourceHtml(g, d) {
  const text = esc(sourceLine(d, g.period));
  const c = g.creditLink;
  if (!c) return text;
  return text.replace(esc(c.text), `<a href="${esc(c.href)}" target="_blank" rel="noopener noreferrer" title="${esc(c.title || c.text)}">${esc(c.text)}</a>`);
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

// ---- BILLIONS ----------------------------------------------------------------------
const bn = (v) => (Number.isFinite(v) ? `$${fmtNum(v, 1)}B` : '--');
function signedBn(v) {
  if (!Number.isFinite(v)) return '--';
  const s = fmtNum(Math.abs(v), 1);
  if (Number(s) === 0) return '$0.0B';
  return `${v > 0 ? '+' : '−'}$${s}B`;
}
function billionsDetail(d) {
  const row = (r) => `<tr><th scope="row" class="name">${esc(r.name)}</th>
    <td class="num dim wd-hide-sm">${r.rank ? `#${esc(r.rank)}` : '--'}</td>
    <td class="num">${bn(r.worth)}</td>
    <td class="num last ${dirCls(r.change)}">${signedBn(r.change)}</td>
    <td class="num ${dirCls(r.pct)}">${signed(r.pct, 1)}</td></tr>`;
  const head = [['Person'], ['Rank', 'num wd-hide-sm'], ['Net worth', 'num'], ['Today', 'num'], ['%', 'num']];
  return {
    html: `<p class="wd-sub">Biggest moves today</p>${table(head, d.moves.map(row))}
      <p class="wd-sub">The five richest</p>${table(head, d.richest.map(row))}`,
  };
}

// ---- WSB ---------------------------------------------------------------------------
function wsbDetail(d) {
  const moved = (r) => {
    if (!Number.isFinite(r.rankAgo)) return '<span class="dim">new</span>';
    if (r.moved === 0) return '<span class="flat">0</span>';
    return `<span class="${r.moved > 0 ? 'up' : 'down'}">${r.moved > 0 ? '+' : '−'}${esc(Math.abs(r.moved))}</span>`;
  };
  const rows = d.rows.map((r) => `<tr><td class="num dim">${esc(r.rank)}</td>
    <th scope="row" class="name"><a class="code" href="${esc(q(r.ticker))}" data-cmd="${esc(r.ticker)}">${esc(r.ticker)}</a> <span class="dim wd-hide-sm">${esc(r.name)}</span></th>
    <td class="num last">${n0(r.mentions)}</td>
    <td class="num dim wd-hide-sm">${Number.isFinite(r.mentionsAgo) ? n0(r.mentionsAgo) : '--'}</td>
    <td class="num dim">${Number.isFinite(r.rankAgo) ? `#${esc(r.rankAgo)}` : '--'}</td>
    <td class="num">${moved(r)}</td></tr>`);
  return { html: table([['#', 'num'], ['Ticker'], ['Mentions', 'num'], ['24h before', 'num wd-hide-sm'], ['Rank then', 'num'], ['Places', 'num']], rows) };
}

// ---- CHANCES -----------------------------------------------------------------------
const pctText = (p) => (!Number.isFinite(p) ? '--' : p > 0 && p < 1 ? '<1%' : p > 99 && p < 100 ? '>99%' : `${Math.round(p)}%`);
function oddsDetail(d) {
  const rec = d.recession
    ? table([['Market'], ['Chance', 'num']], [`<tr><th scope="row" class="name wd-wrap">${esc(d.recession.question)}</th><td class="num last">${esc(pctText(d.recession.pct))}</td></tr>`])
    : '<p class="panel-msg">NO DATA: no active US recession market found.</p>';
  const fed = d.fed
    ? `<p class="wd-sub">${esc(d.fed.title)}</p>${table([['Market'], ['Chance', 'num']], d.fed.outcomes.map((o) => `<tr><th scope="row" class="name wd-wrap">${esc(o.question)}</th><td class="num last">${esc(pctText(o.pct))}</td></tr>`))}`
    : '<p class="panel-msg">NO DATA: no active Fed decision market found.</p>';
  return { html: `<p class="wd-sub">US recession</p>${rec}${fed}` };
}

// ---- BOXRATE -----------------------------------------------------------------------
function boxrateDetail(d) {
  return {
    html: stats([
      ['40ft container', `$${esc(fmtNum(d.usd, 0))}`],
      ['Index date', esc(fmtDate(d.date, 'prose'))],
    ]),
  };
}

// ---- EGGPRICE ----------------------------------------------------------------------
function eggsDetail(d) {
  const rows = d.rows.map((r) => `<tr><th scope="row" class="name">${esc(monthLabel(r.month))}</th>
    <td class="num last">$${fmtNum(r.value, 2)}</td><td class="num ${dirCls(r.yoy)}">${signed(r.yoy, 0)}</td></tr>`);
  const pts = d.points.map((p) => ({ x: dayMs(`${p.month}-01`), y: p.price }));
  return {
    html: stats([
      [`Price ${monthLabel(d.month)}`, `$${fmtNum(d.price, 2)}`],
      ['Change on a year', `<span class="${dirCls(d.yoy)}">${signed(d.yoy, 0)}</span>`],
      [`Peak ${monthLabel(d.peak.month)}`, `$${fmtNum(d.peak.price, 2)}`],
      ['From peak', `<span class="${dirCls(d.fromPeak)}">${signed(d.fromPeak, 0)}</span>`],
    ]) + chartHost('wd-chart') + table([['Month'], ['Dozen', 'num'], ['vs year before', 'num']], rows),
    chart: { series: [{ id: 'e', cls: 'ln-0', label: 'Price of a dozen eggs', points: pts }], fmtY: (v) => `$${fmtNum(v, 2)}`, fmtX: (x) => String(new Date(x).getUTCFullYear()), label: 'Price of a dozen eggs, monthly' },
  };
}

// ---- RIDES -------------------------------------------------------------------------
function ridesDetail(d) {
  const rows = d.parks.map((p) => {
    if (p.status === 'error') return `<tr><th scope="row" class="name">${esc(p.name)}</th><td colspan="3" class="dim">NO DATA</td></tr>`;
    if (p.status === 'closed') return `<tr><th scope="row" class="name">${esc(p.name)}</th><td class="num dim">closed</td><td class="num dim">--</td><td class="dim wd-hide-sm"></td></tr>`;
    return `<tr><th scope="row" class="name">${esc(p.name)}</th>
      <td class="num">${n0(p.openRides)}</td>
      <td class="num last">${Number.isFinite(p.avg) ? `${n0(p.avg)} min` : '<span class="dim">no waits</span>'}</td>
      <td class="wd-hide-sm">${p.longest ? `${esc(p.longest.name)} <span class="dim">${n0(p.longest.wait)} min</span>` : ''}</td></tr>`;
  });
  return { html: table([['Park'], ['Rides open', 'num'], ['Average wait', 'num'], ['Longest', 'wd-hide-sm']], rows) };
}

// ---- BUZZWORD ----------------------------------------------------------------------
const BUZZ_WORDS = [['ai', 'AI'], ['tariff', 'Tariff'], ['recession', 'Recession']];
function buzzDetail(d) {
  const cell = (r, k) => `${n0(r[k])}${(r.capped || []).includes(k) ? '+' : ''}`;
  const rows = d.rows.map((r) => `<tr><th scope="row" class="name">${esc(r.label)}${r.partial ? ' <span class="dim">so far</span>' : ''}</th>
    ${BUZZ_WORDS.map(([k], i) => `<td class="num${i === 0 ? ' last' : ''}">${cell(r, k)}</td>`).join('')}</tr>`);
  const ordered = d.rows.slice().reverse();
  const series = BUZZ_WORDS.map(([k, label], i) => ({ id: k, cls: `ln-${i}`, label, points: ordered.map((r) => ({ x: dayMs(r.start), y: r[k] })) }));
  return {
    html: `<div class="wd-chart-head">${legend(series)}</div>${chartHost('wd-chart')}`
      + table([['Filed in'], ['AI', 'num'], ['Tariff', 'num'], ['Recession', 'num']], rows),
    chart: { series, fmtY: (v) => n0(v), fmtX: (x) => { const t = new Date(x); return `Q${Math.floor(t.getUTCMonth() / 3) + 1} '${String(t.getUTCFullYear()).slice(-2)}`; }, label: '10-Q filings using each phrase, by quarter' },
  };
}

// ---- BEIGE -------------------------------------------------------------------------
function beigeDetail(d) {
  const rows = d.editions.map((e) => `<tr><th scope="row" class="name">${esc(fmtDate(e.released, 'prose'))}</th>
    ${d.words.map((w) => `<td class="num${w.key === d.top ? ' last' : ''}">${n0(e[w.key])}</td>`).join('')}</tr>`);
  const ordered = d.editions.slice().reverse();
  const series = d.words.map((w, i) => ({ id: w.key, cls: `ln-${i}`, label: w.label, points: ordered.map((e) => ({ x: dayMs(e.released), y: e[w.key] })) }));
  return {
    html: `<div class="wd-chart-head">${legend(series)}</div>${chartHost('wd-chart')}`
      + table([['Released'], ...d.words.map((w) => [w.label, 'num'])], rows),
    chart: { series, fmtY: (v) => n0(v), fmtX: (x) => fmtDate(x, 'axis'), label: 'Word counts per Beige Book edition' },
  };
}

// ---- TRUCKS ------------------------------------------------------------------------
function trucksDetail(d) {
  const rows = d.rows.map((r) => `<tr><th scope="row" class="name">${esc(r.label)}</th>
    <td class="dim">${esc(monthLabel(r.month))}</td>
    <td class="num">${Number.isFinite(r.value) ? fmtNum(r.value, r.dp) : '--'}</td>
    <td class="num last ${dirCls(r.yoy)}">${signed(r.yoy, 1)}</td>
    <td class="wd-spark-cell wd-hide-sm">${sparkSvg(r.spark)}</td></tr>`);
  return { html: table([['Series'], ['Latest'], ['Value', 'num'], ['vs year before', 'num'], ['3 years', 'wd-hide-sm']], rows) };
}

// ---- BOXES -------------------------------------------------------------------------
function boxesDetail(d) {
  const summary = d.series.map((s) => `<tr><th scope="row" class="name">${esc(s.full)}</th>
    <td class="dim">${esc(monthLabel(s.month))}</td>
    <td class="num">${Number.isFinite(s.value) ? fmtNum(s.value, 1) : '--'}</td>
    <td class="num last ${dirCls(s.yoy)}">${signed(s.yoy, 1)}</td></tr>`);
  const monthly = (s) => table([['Month'], ['Index', 'num'], ['vs year before', 'num']], s.rows.map((r) => `<tr><th scope="row" class="name">${esc(monthLabel(r.month))}</th>
    <td class="num">${fmtNum(r.value, 1)}</td><td class="num ${dirCls(r.yoy)}">${signed(r.yoy, 1)}</td></tr>`));
  return {
    html: table([['Series'], ['Latest'], ['Index', 'num'], ['vs year before', 'num']], summary)
      + `<div class="wd-two">${d.series.map((s) => `<div><p class="wd-sub">${esc(s.label)}</p>${monthly(s)}</div>`).join('')}</div>`,
  };
}

// ---- LIPSTICK ----------------------------------------------------------------------
function lipstickDetail(d) {
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

// ---- SICK --------------------------------------------------------------------------
function sickDetail(d) {
  const lvl = (v) => (Number.isFinite(v) ? fmtNum(v, 1) : '--');
  const rows = d.rows.map((r) => `<tr><th scope="row" class="name">${esc(r.label)}</th>
    <td class="num last">${lvl(r.level)}</td>
    <td class="num dim">${lvl(r.level4w)}</td>
    <td class="num ${dirCls(r.change4w)}">${signed(r.change4w, 1, '')}</td>
    <td class="num dim wd-hide-sm">${Number.isFinite(r.sites) ? n0(r.sites) : '--'}</td></tr>`);
  const series = d.rows.map((r, i) => ({ id: r.key, cls: `ln-${i}`, label: r.label, points: r.points.map((p) => ({ x: dayMs(p.week), y: p.level })) }));
  return {
    html: table([['Virus'], [`Week to ${fmtDate(d.asOf, 'table')}`, 'num'], ['4 weeks before', 'num'], ['Change', 'num'], ['Sites', 'num wd-hide-sm']], rows)
      + `<div class="wd-chart-head">${legend(series)}</div>${chartHost('wd-chart')}`,
    chart: { series, fmtY: (v) => fmtNum(v, 1), fmtX: (x) => fmtDate(x, 'axis'), label: 'Wastewater viral activity level, national median, weekly' },
  };
}

// ---- MACAU -------------------------------------------------------------------------
const mop = (v) => (Number.isFinite(v) ? `MOP ${fmtNum(v / 1000, 1)}B` : '--');
function macauDetail(d) {
  const rows = d.rows.map((r) => `<tr><th scope="row" class="name">${esc(monthLabel(r.month))}</th>
    <td class="num last">${mop(r.value)}</td><td class="num dim wd-hide-sm">${mop(r.prev)}</td><td class="num ${dirCls(r.yoy)}">${signed(r.yoy, 1)}</td></tr>`);
  return {
    html: stats([
      [`Revenue ${monthLabel(d.month)}`, mop(d.value)],
      ['A year before', mop(d.prev)],
      ['Change on a year', `<span class="${dirCls(d.yoy)}">${signed(d.yoy, 1)}</span>`],
      ['Year to date vs last year', `<span class="${dirCls(d.ytdYoy)}">${signed(d.ytdYoy, 1)}</span>`],
    ]) + table([['Month'], ['Revenue', 'num'], ['Year before', 'num wd-hide-sm'], ['Change', 'num']], rows),
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
  {
    id: 'billions', command: 'BILLIONS', title: 'Billions', period: 'time', detail: billionsDetail,
    method: [
      "The Forbes real-time billionaires list. Forbes estimates each person's net worth through the day from share prices, and keeps the estimate from the previous close. Today's change is the live estimate minus that previous estimate.",
      'The headline is the person with the biggest change in dollars, up or down, of everyone on the list. The feed is unofficial and can lag or pause; weekends show the last trading day.',
    ],
  },
  {
    id: 'wsb', command: 'WSB', title: 'WallStreetBets', period: 'time', detail: wsbDetail,
    method: [
      "ApeWisdom counts how often each ticker is named in posts and comments on Reddit's WallStreetBets over the last 24 hours, and where it ranked 24 hours before.",
      'A ticker here is talked about, which says nothing about whether it is a good or bad idea. Click a ticker to open its quote screen here.',
    ],
  },
  {
    id: 'odds', command: 'CHANCES', title: 'Chances', period: 'time', detail: oddsDetail,
    method: [
      'Prices on Polymarket, a prediction market, read from its public Gamma API. A "Yes" price of 10 cents on the dollar is shown as a 10% chance. These are traders\' prices, not forecasts by us.',
      'Recession: the US recession market for this year, or the soonest one if there is none for this year. Fed: every outcome of the market on the next Fed meeting. Questions are shown in the market\'s own words.',
      'If no matching market is open, this shows NO DATA.',
    ],
  },
  {
    id: 'boxrate', command: 'BOXRATE', title: 'Box rate', detail: boxrateDetail,
    method: [
      "The Drewry World Container Index: the average spot price to ship one 40-foot container on eight main routes between Asia, Europe and the US. Drewry publishes it every Thursday.",
      "Only the headline figure and its date are read from Drewry's page. If they cannot be read, this shows NO DATA.",
    ],
  },
  {
    id: 'eggs', command: 'EGGPRICE', title: 'Egg price', period: 'month', detail: eggsDetail,
    method: [
      'The average price of a dozen grade A large eggs in US cities, from the BLS average price survey (FRED series APU0000708111), monthly.',
      'The peak is the highest monthly price in the series, which starts in 1980. "From peak" compares the latest month with it.',
    ],
  },
  {
    id: 'rides', command: 'RIDES', title: 'Rides', period: 'time', detail: ridesDetail,
    creditLink: { text: 'Queue-Times.com', href: 'https://queue-times.com/', title: 'Powered by Queue-Times.com' },
    method: [
      "Posted wait times from Queue-Times.com for Walt Disney World's four parks (Magic Kingdom, Epcot, Hollywood Studios, Animal Kingdom) and Disneyland.",
      'The average counts rides that are open and post a wait above zero, across all five parks. Shows and walk-on rides post zero, so they are left out. When no park has an open ride, this says the parks are closed.',
      'Powered by Queue-Times.com.',
    ],
  },
  {
    id: 'buzz', command: 'BUZZWORD', title: 'Buzzword', detail: buzzDetail,
    method: [
      'SEC EDGAR full-text search: the number of 10-Q quarterly reports that use the exact phrase "artificial intelligence", "tariff" or "recession", by the calendar quarter they were filed in. One filing counts once, however often it uses the phrase.',
      'Few 10-Qs are filed from January to March, when most companies file their annual 10-K instead, so those quarters are always low. The newest quarter is counted so far; the headline uses it in its last week, and the quarter before it until then.',
    ],
  },
  {
    id: 'beige', command: 'BEIGE', title: 'Beige Book', detail: beigeDetail,
    method: [
      "The Fed's Beige Book gathers what businesses tell the 12 Federal Reserve Banks, eight times a year. Each edition here is its national summary plus the 12 District reports, from federalreserve.gov.",
      'Words are counted as whole words in any case, with their plain forms: uncertain counts uncertainty; tariff counts tariffs; slow counts slowed, slowing, slower, slowly and slowdown; recession counts recessions. AI counts only in capitals, plus "artificial intelligence".',
      'The headline is whichever of the five words the latest edition uses most. Each edition is dated by the day it came out: the one the Fed calls August 2026 came out on September 2.',
    ],
  },
  {
    id: 'trucks', command: 'TRUCKS', title: 'Trucks', period: 'month', detail: trucksDetail,
    method: [
      'Three monthly freight series from FRED, each against the same month a year before: the Cass Freight Index for shipments (FRGSHPUSM649NCIS), the ATA truck tonnage index (TRUCKD11) and rail freight carloads (RAILFRTCARLOADSD11).',
      'They come out at different times, so each row has its own latest month.',
    ],
  },
  {
    id: 'boxes', command: 'BOXES', title: 'Boxes', period: 'month', detail: boxesDetail,
    method: [
      'Cardboard boxes carry most goods, so box demand is watched as an early read on shipping. Output: the Fed industrial production index for paperboard containers (FRED IPN32221S). Prices: the producer price index for corrugated and solid fiber boxes (FRED PCU322211322211).',
      'Each is compared with the same month a year before, and each has its own latest month.',
    ],
  },
  {
    id: 'lipstick', command: 'LIPSTICK', title: 'Lipstick', period: 'month', detail: lipstickDetail,
    method: [
      'The BLS consumer price index for cosmetics, perfume, bath and nail products (FRED series CUUR0000SEGB02), US city average, not seasonally adjusted. It measures prices, not sales.',
      'The "lipstick index" is folklore: Leonard Lauder said lipstick sells better when money is tight. Shown for fun, with no claim either way.',
    ],
  },
  {
    id: 'sick', command: 'SICK', title: 'Sick', detail: sickDetail,
    method: [
      "CDC wastewater data (National Wastewater Surveillance System, dataset atcp-73re). Each sewage site gets a weekly viral activity level that compares it with that site's own baseline; 1 is the lowest the scale goes.",
      'CDC publishes this per site. The national figure here is our summary: the median level of all sites reporting that week, for COVID (SARS-CoV-2), flu A and RSV. Sites report late, so the newest week or two have fewer sites and move a lot. This shows the newest week with at least 90% as many sites as a full week (the most sites any of the last 8 weeks had).',
    ],
  },
  {
    id: 'macau', command: 'MACAU', title: 'Macau', period: 'month', detail: macauDetail,
    method: [
      "Macau casinos' gross gaming revenue per month, from DICJ, Macau's gaming regulator, in millions of patacas (MOP).",
      'The change compares each month with the same month a year before.',
    ],
  },
];

export const gaugeByCommand = (cmd) => WEIRD_GAUGES.find((g) => g.command === cmd) || null;
