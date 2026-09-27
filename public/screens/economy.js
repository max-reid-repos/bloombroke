// ECONOMY: the US macro dashboard. Ten numbers from FRED, each with its latest value,
// the one before and a two-year sparkline. A row opens its full chart.
//   ECONOMY                 the dashboard
//   ECONOMY UNRATE [10Y]    one series, 5Y, 10Y or MAX

import { esc, q, fmtNum, fmtSigned, panel, LOADING, rowAttrs, nameCell } from './markets.js';
import { mountLines } from './lines.js';
import { fmtDate, rangePills } from '../kit.js';
import { ECONOMY_RANGES, parseEconomy as parse, economyToInput as toInput } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { ECONOMY_RANGES, parse, toInput };

// The value in the series' own unit: 4.1%, +162K, 197K, 51.7, +31 bp.
export function fmtValue(v, unit) {
  if (!Number.isFinite(v)) return '--';
  switch (unit) {
    case 'pct': return `${fmtNum(v, 1)}%`;
    case 'k': return `${fmtSigned(v, 0)}K`;
    case 'count': return `${fmtNum(v / 1000, 0)}K`;
    case 'bp': return `${fmtSigned(v * 100, 0)} bp`;
    default: return fmtNum(v, 1);
  }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// The period an observation covers, in one style: Q2 2026, AUG 2026, and for weekly
// and daily series the day, SEP 19 2026 (never an ISO date next to the others).
export function periodLabel(date, freq) {
  if (!date) return '--';
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  if (freq === 'Q') return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  if (freq === 'M') return `${MONTHS[m - 1]} ${y}`;
  const day = fmtDate(date, 'table');
  return day === '--' ? '--' : `${day} ${y}`;
}

// A tiny line: values -> an SVG polyline, scaled to its own min and max.
export function sparkSvg(values, w = 96, h = 18) {
  const v = (values || []).filter(Number.isFinite);
  if (v.length < 2) return '<span class="dim">--</span>';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 1 - ((y - lo) / span) * (h - 2)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

const FREQ = { Q: 'Quarterly', M: 'Monthly', W: 'Weekly', D: 'Daily' };

function dashboard(el, ctx) {
  el.innerHTML = panel('1', 'US economy', LOADING, { cls: 'panel-solo', metaId: 'ec-meta', meta: 'US DATA' });
  const body = el.querySelector('.panel-body');
  ctx.fetchJSON('/api/economy', { signal: ctx.signal }).then((d) => {
    body.innerHTML = `<table class="grid-table ec-table">
      <thead><tr><th scope="col">Indicator</th><th scope="col" class="num">Latest</th><th scope="col" class="ec-per">Period</th><th scope="col" class="num ec-prev">Previous</th><th scope="col" class="ec-spark">2 years</th></tr></thead>
      <tbody>${d.series.map((s) => {
        const cmd = `ECONOMY ${s.id}`;
        // The FRED id is a tooltip on the row, not a column.
        return `<tr${rowAttrs(cmd)} title="Series ${esc(s.fred)}">
          ${nameCell(s.name, cmd)}
          <td class="num last">${esc(fmtValue(s.value, s.unit))}</td>
          <td class="ec-per dim">${esc(periodLabel(s.date, s.freq))}</td>
          <td class="num ec-prev">${esc(fmtValue(s.prev, s.unit))}</td>
          <td class="ec-spark">${sparkSvg(s.spark)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('ECONOMY: NO DATA', 'warn');
  });
}

const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function series(el, args, ctx) {
  const range = args.range || '10Y';
  const tabs = rangePills(range, (r) => `ECONOMY ${args.id} ${r}`, ECONOMY_RANGES);
  el.innerHTML = `<div class="stack">
    ${panel('1', args.id, `<div class="ec-head" id="ec-head">${LOADING}</div><div class="ch-bar ec-bar">${tabs}<a class="ec-back code" href="${esc(q('ECONOMY'))}" data-cmd="ECONOMY">ALL INDICATORS</a></div><div class="chart-host" id="ec-chart"></div>`, { metaId: 'ec-meta', bodyCls: 'flush', meta: 'US DATA' })}
    ${panel('2', 'Recent readings', LOADING, { metaId: 'ec-t-meta' })}
  </div>`;
  const head = el.querySelector('#ec-head');
  const host = el.querySelector('#ec-chart');
  const meta = el.querySelector('#ec-meta');
  const tBody = el.querySelectorAll('.panel-body')[1];
  let cleanup = null;
  ctx.onCleanup(() => cleanup?.());

  ctx.fetchJSON(`/api/economy?id=${encodeURIComponent(args.id)}&r=${range}`, { signal: ctx.signal }).then((d) => {
    el.querySelector('.panel-label').textContent = `1) ${d.name}`.toUpperCase();
    head.innerHTML = `<span class="oc-px num">${esc(fmtValue(d.value, d.unit))}</span>
      <span class="oc-kv"><span class="dim">${esc(periodLabel(d.date, d.freq))}</span></span>
      <span class="oc-kv"><span class="dim">PREVIOUS</span> <span class="num">${esc(fmtValue(d.prev, d.unit))}</span> <span class="dim">${esc(periodLabel(d.prevDate, d.freq))}</span></span>
      <span class="oc-kv dim">${esc(d.note)}</span>`;
    const base = `SERIES ${esc(d.fred)} · ${esc((FREQ[d.freq] || '').toUpperCase())}`;
    meta.innerHTML = base;
    const pts = d.points.map((p) => ({ x: Date.parse(`${p.date}T00:00:00Z`), y: d.unit === 'bp' ? p.value * 100 : p.value }));
    const fmtY = (v) => fmtValue(d.unit === 'bp' ? v / 100 : v, d.unit);
    const tick = (v) => (d.unit === 'count' ? `${fmtNum(v / 1000, 0)}K` : d.unit === 'bp' ? fmtNum(v, 0) : fmtNum(v, Math.abs(v) >= 100 ? 0 : 1));
    cleanup?.();
    host.textContent = '';
    if (pts.length < 2) host.innerHTML = '<p class="panel-msg">Not enough readings in this range.</p>';
    else {
      cleanup = mountLines(host, [{ id: 'v', cls: 'ln-0', label: d.name, points: pts }], {
        fmtY, fmtTick: tick, fmtX: (x) => fmtDay(x).slice(0, 4), zero: d.calc !== 'level' || d.unit === 'bp' || d.id === 'GDP', label: `${d.name}, ${range}`,
        onHover(h) { meta.innerHTML = h ? `<span class="num">${esc(fmtDay(h.x))} ${esc(fmtY(h.values[0].y))}</span>` : base; },
      });
    }
    const recent = d.points.slice(-12).reverse();
    tBody.innerHTML = `<table class="grid-table">
      <thead><tr><th scope="col">Period</th><th scope="col" class="num">Value</th></tr></thead>
      <tbody>${recent.map((p) => `<tr><th scope="row" class="name">${esc(periodLabel(p.date, d.freq))}</th><td class="num last">${esc(fmtValue(p.value, d.unit))}</td></tr>`).join('')}</tbody>
    </table>`;
    el.querySelector('#ec-t-meta').textContent = `FIRST READING ${d.first ? periodLabel(d.first, d.freq) : '--'}`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    head.innerHTML = `<p class="panel-msg">${esc(err.message)}</p><p class="muted examples">Try <a class="code" href="${esc(q('ECONOMY'))}" data-cmd="ECONOMY">ECONOMY</a></p>`;
    tBody.innerHTML = '';
    ctx.status(err.status === 404 ? `ECONOMY ${args.id}: NOT FOUND` : 'ECONOMY: NO DATA', 'warn');
  });
}

export function render(el, cmd, ctx) {
  const args = cmd.args;
  if (args.error) {
    el.innerHTML = panel('1', 'Economy', `
      <p class="notice">${args.error === 'range' ? 'Pick a range: 5Y, 10Y or MAX.' : 'ECONOMY takes one indicator, like UNRATE.'}</p>
      <p class="muted">Format: <span class="code">ECONOMY [indicator] [5Y|10Y|MAX]</span></p>
      <p class="muted examples">Try ${['ECONOMY', 'ECONOMY UNRATE', 'ECONOMY CPI MAX'].map((c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`).join(' ')}</p>`, { cls: 'panel-solo' });
    ctx.status('ECONOMY: CHECK THE FORMAT', 'warn');
    return;
  }
  if (args.id) series(el, args, ctx);
  else dashboard(el, ctx);
}
