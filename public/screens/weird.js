// WEIRD: odd live gauges on one screen, and one screen per gauge.
//   WEIRD [3M|1Y|5Y|10Y|MAX]  a grid of numbered tiles. Click a tile, or type its number
//                             and Enter. The period row redraws every spark (AUTO: each
//                             gauge's own default look).
//   CANAL [3M|...|MAX]        one gauge: its number, the period row, a big chart with the
//                             gauge's table beside it (below it on a phone), how it is
//                             measured, and SHARE ON X.
// Gauges are listed in weird-gauges.js; the data comes from /api/weird (?p= a period).

import { esc, q, panel, metaNote, LOADING } from './markets.js';
import { sparkSvg } from './economy.js';
import { mountLines, legend } from './lines.js';
import { fmtDate } from '../kit.js';
import {
  WEIRD_GAUGES, WEIRD_PERIODS, AUTO, gaugeByCommand, sourceHtml, whenLine, dayLabel, monthLabel, emptyGauge,
  heroOf, tileCreditHtml, meaningOf,
} from './weird-gauges.js';
import { markGaugeSponsor } from './sponsor.js'; // Sponsor hook
import { goal } from '../goal.js'; // GOALS

export { WEIRD_GAUGES };

// How soon a screen asks again while a gauge is still pending (no value yet).
export const PENDING_POLL_MS = 5000;

// The command for a typed tile number ("3" -> DEGEN), or null.
export function commandForNumber(text) {
  const m = /^\s*(\d{1,2})\s*$/.exec(String(text ?? ''));
  const g = m ? WEIRD_GAUGES[Number(m[1]) - 1] : null;
  return g ? g.command : null;
}

// One tile's inside, from a summary row (or a full gauge response): the hero (a noun and
// its number, weird-gauges.js heroOf), one short meaning line, a small line when there is
// one, and the credit the source's licence asks for, if any. Nothing else: who and when
// are on the gauge's own screen (and in the tile's title). rec: the record tag ("HIGH SINCE
// JUN 2022"), which the WEIRD grid shows in the tile's kicker row, always in that place; a
// DESK card keeps to the hero, the line, the spark and the credit.
export function heroHtml(g, d) {
  const x = heroOf(g, d);
  if (!x) return '';
  const part = (cls, t) => (t ? `<span class="${cls}">${esc(t)}</span>` : '');
  return [part('wd-noun', x.noun), part('wd-val', x.num), part('wd-unit', x.unit)].filter(Boolean).join(' ');
}
export function recordTag(d) {
  return d && d.ok !== false && d.record?.short ? `<span class="wd-rec" title="${esc(d.record.text)}">${esc(d.record.short)}</span>` : '';
}
export function tileBody(g, d) {
  if (!d) return `<p class="wd-big is-none">LOADING...</p><p class="wd-line"></p><div class="wd-spark"></div>`;
  const bad = d.ok === false;
  // A stale value is a real past reading: shown dimmed, its time in the tile's title.
  const cls = bad ? ' is-none' : d.stale ? ' is-stale' : '';
  const big = bad ? esc(d.pending ? 'LOADING...' : 'NO DATA') : heroHtml(g, d);
  const spark = !bad && Array.isArray(d.spark) && d.spark.filter(Number.isFinite).length > 1 ? sparkSvg(d.spark, 120, 18) : '';
  const credit = bad ? '' : tileCreditHtml(g, d);
  return `<p class="wd-big${cls}">${big}</p>
    <p class="wd-line">${esc(bad ? '' : meaningOf(g, d))}</p>
    <div class="wd-spark"${d.sparkFrom ? ` title="Since ${esc(monthLabel(d.sparkFrom))}, all there is"` : ''}>${spark}</div>${credit ? `<p class="wd-src">${credit}</p>` : ''}`;
}

// The tile's title (a tooltip): the gauge and when its reading is from.
export const tileTitle = (g, d) => (d && d.ok !== false && d.asOf ? `${g.title} · ${whenLine(d, g.period)}` : g.title);

// Show or leave out a tile: the tile CSS sets display, so hidden alone would not hide it.
export function showTile(node, on) {
  node.hidden = !on;
  node.style.display = on ? '' : 'none';
}

// The status line's NO DATA count: tiles that show NO DATA. A gauge left out of the grid
// (emptyGauge) is not counted, nor is one still loading. With today's emptyGauge every
// NO DATA row is left out, so this is 0; it stays right if that rule narrows.
export const noDataCount = (rows) => (rows || []).filter((x) => x && x.ok === false && !x.pending && !emptyGauge(x)).length;

// data-num: a number and Enter in the command bar opens this tile's own screen (not the
// tile maximised). A bare digit stays typing, so 12 can be typed. period: the grid's
// period, carried into the gauge's own screen. One template for every gauge: the kicker
// (its number and name, small; the record tag at its right end), then tileBody.
export function tile(g, i, period = null) {
  const cmd = period ? `${g.command} ${period}` : g.command;
  return `<div class="wd-tile" data-cmd="${esc(cmd)}" data-num="${i + 1}" tabindex="0" id="wd-t-${esc(g.id)}" title="${esc(g.title)}">
    <p class="wd-kick"><span class="wd-no">${i + 1}</span><span class="wd-name">${esc(g.command)}</span><span class="wd-tag"></span></p>
    <div class="wd-body-t">${tileBody(g, null)}</div>
  </div>`;
}

// ---- Rows that fill ----------------------------------------------------------------------
// The grid is 60 narrow columns; each tile spans 60 / (the tiles in its row), so every row
// is full: 22 tiles in 5 columns are rows of 5, 5, 4, 4 and 4, never a row with holes.
// cols: how many 260 px tiles fit (at most 6), rows: as few as that needs, and the tiles
// shared out so no two rows differ by more than one (the longer rows first).
export const WD_MIN_W = 260;
export const WD_MAX_COLS = 6;
export function rowSizes(n, width, { min = WD_MIN_W, max = WD_MAX_COLS } = {}) {
  if (!(n > 0)) return [];
  const cols = Math.max(1, Math.min(max, Math.floor((width + 1) / (min + 1)) || 1));
  const rows = Math.ceil(n / cols);
  const base = Math.floor(n / rows);
  const extra = n - base * rows;
  return Array.from({ length: rows }, (_, r) => base + (r < extra ? 1 : 0));
}
// Each visible tile gets its span class (wd-s60, wd-s30, wd-s20, wd-s15, wd-s12, wd-s10).
export function spanClasses(n, width, opts) {
  return rowSizes(n, width, opts).flatMap((k) => Array.from({ length: k }, () => `wd-s${60 / k}`));
}
export function packGrid(gridEl) {
  if (!gridEl?.querySelectorAll) return;
  const tiles = [...gridEl.querySelectorAll(':scope > .wd-tile')].filter((t) => !t.hidden);
  const spans = spanClasses(tiles.length, gridEl.clientWidth);
  tiles.forEach((t, k) => {
    for (const c of [...t.classList]) if (/^wd-s\d+$/.test(c)) t.classList.remove(c);
    t.classList.add(spans[k] || 'wd-s60');
  });
}

// ---- The period row ----------------------------------------------------------------
// The chart toolbar's range look (.tabs .ch-tabs). A period the source does not cover is
// greyed, not a link, and its title says why. periods: { '3M': { ok, title } } from the
// API (none yet: all shown as links); cmdFor(p) -> the command for that period.
export function periodRow(periods, active, cmdFor, { auto = false } = {}) {
  const items = [...(auto ? [AUTO] : []), ...WEIRD_PERIODS];
  const tabs = items.map((p) => {
    const info = p === AUTO || !periods ? { ok: true } : periods[p] || { ok: false, title: 'Not covered' };
    if (!info.ok) return `<span class="tab is-off" aria-disabled="true" title="${esc(info.title || 'Not covered')}">${p}</span>`;
    const on = p === active;
    const cmd = cmdFor(p);
    return `<a class="tab${on ? ' is-active' : ''}" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}"${on ? ' aria-current="true"' : ''}>${p}</a>`;
  }).join('');
  return `<nav class="tabs ch-tabs wd-periods" aria-label="Period">${tabs}</nav>`;
}

// ---- The gauge title strip ------------------------------------------------------------
// Everything a gauge screen says in its panel title strip, in one place: the record line
// and, for a gauge we record ourselves, since when.
export function titleStrip(g, d) {
  if (!d || d.ok === false) return '';
  const parts = [];
  const r = d.record;
  if (r?.text) parts.push(metaNote(r.text, r.record ? `${r.kind === 'low' ? 'Lower' : 'Higher'} than every reading since ${monthLabel(r.since)}` : `The last reading as ${r.kind} as this was in ${monthLabel(r.since)}`));
  if (d.recording?.since) parts.push(metaNote(`RECORDING SINCE ${dayLabel(d.recording.since)}`, `${d.source} keeps no past readings, so one reading a day is kept here from this date`));
  return parts.join('');
}

// ---- WEIRD share cards (weird-share): SHARE ON X on a gauge screen ----------------------
// The link opens this gauge (with its period, when one was asked for); its card
// (/og/weird.png) shows the same number.
export function gaugeShareLinks(g, d, origin, period = null) {
  const url = `${origin}/?${new URLSearchParams({ c: period ? `${g.command} ${period}` : g.command })}`;
  const line = String(d.line || '').replace(/\s+/g, ' ').trim();
  const short = line.length > 100 ? `${line.slice(0, 97).trimEnd()}...` : line;
  const text = [`${g.command}: ${d.headline}${d.stale ? ' (last good reading)' : ''}.`, short].join(' ').trim();
  return { url, x: `https://x.com/intent/post?${new URLSearchParams({ text, url })}` };
}
const shareRow = (links) => `<div class="wi-share"><a class="wi-btn" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer">SHARE ON X</a></div>`;
// ---- end WEIRD share cards ----------------------------------------------------------------

// ---- The grid ------------------------------------------------------------------------

function grid(el, ctx, period) {
  const cmdFor = (p) => (p === AUTO ? 'WEIRD' : `WEIRD ${p}`);
  const active = period || AUTO;
  el.innerHTML = `<div class="wd-bar">${periodRow(null, active, cmdFor, { auto: true })}</div>
    <div class="wd-scroll"><div class="wd-grid">${WEIRD_GAUGES.map((g, i) => tile(g, i, period)).join('')}</div></div>`;
  // A credit link inside a tile opens its site; it does not open the tile.
  el.querySelector('.wd-grid').addEventListener('click', (e) => {
    if (e.target.closest('a[href^="https://"]')) e.stopPropagation();
  });
  // A gauge with nothing to show (emptyGauge) is left out until it reports again. The
  // other tiles keep their numbers, so a typed number still opens the same gauge.
  const gridEl = el.querySelector('.wd-grid');
  const fill = (d) => {
    const g = WEIRD_GAUGES.find((x) => x.id === d.id);
    const t = g && el.querySelector(`#wd-t-${g.id}`);
    const body = t && t.querySelector('.wd-body-t');
    if (body) body.innerHTML = tileBody(g, d);
    const tag = t && t.querySelector('.wd-tag');
    if (tag) tag.innerHTML = recordTag(d);
    if (t) { t.title = tileTitle(g, d); showTile(t, !emptyGauge(d)); }
  };
  // Every row full (packGrid): again when the grid changes width.
  packGrid(gridEl);
  let raf = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => packGrid(gridEl)); }) : null;
  ro?.observe(gridEl);
  ctx.onCleanup(() => { ro?.disconnect(); cancelAnimationFrame(raf); });
  // Type a tile's number and press Enter to open it. The command bar finds the tile by
  // data-num; this hook covers a DESK panel, where that lookup is off.
  ctx.setCommandHook((c) => {
    const cmd = commandForNumber(c);
    if (!cmd) return false;
    setTimeout(() => ctx.run(cmd), 0);
    return true;
  });

  // A gauge with no value yet came back pending: the whole summary is asked for again
  // every PENDING_POLL_MS until none is, then at the normal pace.
  let again = null;
  ctx.onCleanup(() => clearTimeout(again));
  async function load() {
    clearTimeout(again);
    again = null;
    try {
      const d = await ctx.fetchJSON(`/api/weird${period ? `?p=${period}` : ''}`, { signal: ctx.signal });
      d.gauges.forEach(fill);
      packGrid(gridEl);
      const bar = el.querySelector('.wd-bar');
      if (bar && d.periods) bar.innerHTML = periodRow(d.periods, active, cmdFor, { auto: true });
      if (d.gauges.some((x) => x.pending) && !ctx.signal?.aborted) again = setTimeout(load, PENDING_POLL_MS);
      // The dot by the clock says when; the status line only carries a warning.
      ctx.updated(d.updated, d.stale);
      const bad = noDataCount(d.gauges);
      ctx.status(bad ? `${bad} NO DATA` : '', bad ? 'warn' : '');
    } catch (err) {
      if (err.name === 'AbortError') return;
      ctx.status('WEIRD: NO DATA', 'warn');
    }
  }
  load();
  ctx.live(load, 10 * 60_000);
}

// ---- One gauge -------------------------------------------------------------------------

const dayMs = (s) => Date.parse(`${s}T00:00:00Z`);
const STEP_DAYS = { day: 1, week: 7, month: 31, quarter: 92, half: 183, edition: 60 };

// The API's hist -> mountLines series for `keys` (a line breaks across a stretch with no
// readings). One series is drawn in the first colour; several each get their own.
export function chartSeries(hist, keys) {
  if (!hist?.d?.length) return [];
  const gapX = (STEP_DAYS[hist.step] || 1) * (hist.bucket || 1) * 3 * 86_400_000;
  return keys.map((key, i) => {
    const s = hist.series.find((x) => x.key === key);
    if (!s) return null;
    const points = [];
    hist.d.forEach((d, k) => { if (Number.isFinite(s.v[k])) points.push({ x: dayMs(d), y: s.v[k] }); });
    return { id: key, cls: `ln-${i % 5}`, label: s.label, points, gapX };
  }).filter((s) => s && s.points.length >= 2);
}

// The date under the chart: a year for a long window, the month for a year or so, the day
// for a few months.
export function axisFormat(series) {
  const xs = series.flatMap((s) => [s.points[0]?.x, s.points[s.points.length - 1]?.x]).filter(Number.isFinite);
  const span = xs.length ? (Math.max(...xs) - Math.min(...xs)) / 86_400_000 : 0;
  if (span > 3 * 365) return (x) => String(new Date(x).getUTCFullYear());
  if (span > 150) return (x) => fmtDate(new Date(x).toISOString().slice(0, 10), 'axis');
  return (x) => fmtDate(new Date(x).toISOString().slice(0, 10), 'table');
}

// Which series a gauge draws first: its chart.keys(hist), or the lead alone when rows pick
// one, or every series that is not hidden.
export function firstKeys(g, hist) {
  if (!hist?.series) return [];
  if (g.chart?.keys) return g.chart.keys(hist);
  if (g.chart?.pick) return [hist.lead];
  return hist.series.filter((s) => !s.hidden).map((s) => s.key);
}

function detail(el, g, ctx, asked) {
  const n = WEIRD_GAUGES.indexOf(g) + 1;
  el.innerHTML = `<div class="stack">${panel(String(n), g.title, LOADING, { metaId: 'wd-meta', cls: 'wd-solo' })}</div>`;
  markGaugeSponsor(el.querySelector('#wd-meta'), g.id); // Sponsor hook: SPONSORED BY in the title strip
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#wd-meta');
  let cleanup = null;
  ctx.onCleanup(() => cleanup?.());
  const how = `<details class="how wd-how"><summary>How is this measured?</summary><div class="how-list">${g.method.map((p) => `<p>${esc(p)}</p>`).join('')}</div></details>`;
  const cmdFor = (p) => `${g.command} ${p}`;

  function drawChart(d, keys) {
    cleanup?.();
    cleanup = null;
    const host = body.querySelector('#wd-chart');
    const head = body.querySelector('.wd-chart-head');
    if (!host) return;
    const c = g.chart || {};
    const series = chartSeries(d.hist, keys);
    // One line picked from several (a chokepoint, a country): the label names it.
    const several = d.hist.series.filter((x) => !x.hidden).length > 1 || c.pick;
    const name = series.length === 1 && keys.length === 1 && several ? `, ${series[0].label}` : '';
    const label = `${c.label || g.title}${name}`;
    head.innerHTML = `${series.length > 1 ? legend(series) : `<span class="wd-chart-label">${esc(label)}</span>`}<span class="wd-read" aria-live="polite"></span>`;
    const read = head.querySelector('.wd-read');
    const fmtY = c.fmtY || ((v) => String(v));
    const fmtX = axisFormat(series);
    const when = (x) => { const s = new Date(x).toISOString().slice(0, 10); return d.hist.step === 'day' || d.hist.step === 'week' || d.hist.step === 'edition' ? fmtDate(s, 'prose') : monthLabel(s); };
    cleanup = mountLines(host, series, {
      fmtY, fmtTick: fmtY, fmtX, label, zero: Boolean(c.zero),
      onHover: (h) => {
        if (!h) { read.textContent = ''; return; }
        read.textContent = `${when(h.x)}: ${h.values.map((v) => `${series.length > 1 ? `${series.find((s) => s.id === v.id)?.label} ` : ''}${fmtY(v.y)}`).join(', ')}`;
      },
    });
    body.querySelectorAll('tr[data-key]').forEach((tr) => tr.classList.toggle('is-picked', keys.length === 1 && tr.dataset.key === keys[0]));
  }

  let again = null;
  ctx.onCleanup(() => clearTimeout(again));
  const load = () => ctx.fetchJSON(`/api/weird/${g.id}${asked ? `?p=${asked}` : ''}`, { signal: ctx.signal }).then((d) => {
    // No value yet: say so and ask again shortly.
    if (d.pending) {
      body.innerHTML = `${LOADING}${how}`;
      if (!ctx.signal?.aborted) again = setTimeout(load, PENDING_POLL_MS);
      return;
    }
    if (d.ok === false) {
      body.innerHTML = `<p class="wd-big is-none">NO DATA</p><p class="wd-src">${esc(d.source)}</p>${how}`;
      ctx.status(`${g.command}: NO DATA · ${String(d.source).toUpperCase()}`, 'warn');
      return;
    }
    meta.innerHTML = titleStrip(g, d);
    const part = g.detail(d);
    const keys = firstKeys(g, d.hist);
    const chart = chartSeries(d.hist, keys).length > 0;
    body.innerHTML = `<div class="wd-top">
        <div class="wd-head"><p class="wd-big${d.stale ? ' is-stale' : ''}">${heroHtml(g, d) || esc(d.headline)}</p><p class="wd-line">${esc(d.line || '')}</p></div>
        ${periodRow(d.periods, d.period, cmdFor)}
      </div>
      <div class="wd-main${chart ? '' : ' is-nochart'}">
        ${chart ? '<div class="wd-chartbox"><div class="wd-chart-head"></div><div class="chart-host wd-chart" id="wd-chart"></div></div>' : ''}
        <div class="wd-side"><div class="wd-body">${part.html}</div>
          <div class="wd-foot">${how}<p class="wd-src">${sourceHtml(g, d)}</p>${shareRow(gaugeShareLinks(g, d, location.origin, asked))}</div>
        </div>
      </div>`;
    // Desktop: the method sits open under the table, in the room beside the chart.
    if (globalThis.matchMedia?.('(min-width: 1100px)').matches) body.querySelector('.wd-how')?.setAttribute('open', '');
    if (chart) {
      drawChart(d, keys);
      // A row that names a series (a chokepoint, a country, a virus) draws that one; a
      // second click goes back to the first view.
      body.querySelector('.wd-side').addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-key]');
        if (!tr || e.target.closest('a')) return;
        const k = tr.dataset.key;
        const picked = tr.classList.contains('is-picked') && !(keys.length === 1 && keys[0] === k);
        drawChart(d, picked ? keys : [k]);
      });
    }
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="wd-big is-none">NO DATA</p><p class="panel-msg">${esc(err.message)}</p>${how}`;
    ctx.status(`${g.command}: NO DATA`, 'warn');
  });
  load();
}

export function render(el, cmd, ctx) {
  const g = gaugeByCommand(cmd.name);
  const period = cmd.args?.period || null;
  if (g) goal('weird_gauge_opened', { gauge: g.command });
  if (g) detail(el, g, ctx, period);
  else grid(el, ctx, period);
}
