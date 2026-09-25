// CURVE: the US Treasury yield curve, 1 month to 30 years. Today vs 1 month and 1 year ago.

import { esc, fmtNum, dirOf, fmtAsOf, panel, LOADING } from './markets.js';
import { fmtBp } from './rates.js';
import { mountLines, legend } from './lines.js';
import { freshTag } from '../freshness.js';

const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase() : '--');

// Tenors -> chart series. Points are skipped where a value is missing.
export function curveSeries(tenors) {
  const pick = (key) => tenors.map((t, i) => ({ x: i, y: t[key] })).filter((p) => Number.isFinite(p.y));
  return [
    { id: 'now', cls: 'ln-0', label: 'Today', points: pick('now') },
    { id: 'm1', cls: 'ln-1', label: '1 month ago', points: pick('m1') },
    { id: 'y1', cls: 'ln-2', label: '1 year ago', points: pick('y1') },
  ];
}

// X labels: every term when there is room, else every other one, always ending at the
// longest (so 20Y and 30Y never print on top of each other).
export function curveTicks(count, width) {
  const all = Array.from({ length: count }, (_, i) => i);
  if (width >= count * 44) return all;
  return all.filter((i) => (count - 1 - i) % 2 === 0);
}

const bpCell = (a, b) => {
  const d = Number.isFinite(a) && Number.isFinite(b) ? a - b : NaN;
  return `<td class="num bp ${Number.isFinite(d) ? dirOf(Math.round(d * 1000)) : 'flat'}">${esc(Number.isFinite(d) ? fmtBp(d) : '--')}</td>`;
};

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="stack">
    ${panel('1', 'US Treasury yield curve', `<div class="chart-host" id="cv-chart">${LOADING}</div><div id="cv-legend"></div>`, { metaId: 'cv-meta', bodyCls: 'flush' })}
    ${panel('2', 'Yields', LOADING, { metaId: 'cv-t-meta', meta: 'PERCENT A YEAR' })}
  </div>
  <p class="footnote">Today: CNBC, the same live quotes as RATES, real time (RT) or delayed (DLY) as tagged on each row. 1 month and 1 year ago: US Treasury daily par yield curve (DAILY). 1 bp = 0.01%. Not financial advice.</p>`;
  const host = el.querySelector('#cv-chart');
  const leg = el.querySelector('#cv-legend');
  const meta = el.querySelector('#cv-meta');
  const tBody = el.querySelectorAll('.panel-body')[1];
  let cleanup = null;
  let drawn = '';
  ctx.onCleanup(() => cleanup?.());

  function drawChart(key, ids, series, base) {
    drawn = key;
    meta.innerHTML = base;
    cleanup?.();
    host.textContent = '';
    cleanup = mountLines(host, series, {
      fmtY: (v) => `${fmtNum(v, 2)}%`, fmtX: (i) => ids[i] || '', xTicks: curveTicks(ids.length, host.clientWidth - 64), label: 'US Treasury yield curve',
      onHover(h) {
        meta.innerHTML = h ? `<span class="num">${esc(ids[h.x])} ${h.values.map((v) => `<span class="lg-v ${series.find((s) => s.id === v.id).cls}">${esc(fmtNum(v.y, 2))}%</span>`).join(' ')}</span>` : base;
      },
    });
  }

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/curve', { signal: ctx.signal });
      const ids = d.tenors.map((t) => t.id);
      const series = curveSeries(d.tenors);
      series[1].label = `1 month ago (${fmtDay(d.m1Date)})`;
      series[2].label = `1 year ago (${fmtDay(d.y1Date)})`;
      leg.innerHTML = legend(series.filter((s) => s.points.length));
      const s10 = d.tenors.find((t) => t.id === '10Y');
      const s2 = d.tenors.find((t) => t.id === '2Y');
      const spread = s10 && s2 && Number.isFinite(s10.now) && Number.isFinite(s2.now) ? s10.now - s2.now : NaN;
      const base = Number.isFinite(spread) ? `<span class="dim"><span class="m-hide">10Y MINUS 2Y</span><span class="m-only">10Y−2Y</span></span> <span class="num ${dirOf(Math.round(spread * 1000))}">${esc(fmtBp(spread).replace(/^\+/, ''))}</span>` : '';
      // Redraw the chart only when a number moved (the table refreshes every 15 s).
      const key = JSON.stringify(series.map((x) => [x.label, x.points]));
      if (key !== drawn) drawChart(key, ids, series, base);
      tBody.innerHTML = `<table class="grid-table curve-table">
        <thead><tr><th scope="col">Term</th><th scope="col" class="tag"><span class="offscreen">Real time or delayed</span></th><th scope="col" class="num">Today</th><th scope="col" class="num chg">Chg</th><th scope="col" class="num">1M ago</th><th scope="col" class="num">vs 1M</th><th scope="col" class="num time">1Y ago</th><th scope="col" class="num">vs 1Y</th></tr></thead>
        <tbody>${d.tenors.map((t) => `<tr>
          <th scope="row" class="name">${esc(t.id)}</th>
          <td class="tag">${freshTag(t)}</td>
          <td class="num last">${Number.isFinite(t.now) ? `${fmtNum(t.now, 3)}%` : '--'}</td>
          <td class="num chg ${Number.isFinite(t.change) ? dirOf(Math.round(t.change * 1000)) : 'flat'}">${esc(Number.isFinite(t.change) ? fmtBp(t.change) : '--')}</td>
          <td class="num">${Number.isFinite(t.m1) ? `${fmtNum(t.m1, 2)}%` : '--'}</td>
          ${bpCell(t.now, t.m1)}
          <td class="num time">${Number.isFinite(t.y1) ? `${fmtNum(t.y1, 2)}%` : '--'}</td>
          ${bpCell(t.now, t.y1)}
        </tr>`).join('')}</tbody>
      </table>`;
      // The newest trade time on the curve, as on RATES (not the first row's: the
      // 1-month bill can last trade hours before the notes).
      const asOf = d.asOf || d.tenors.map((t) => t.asOf).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).pop();
      el.querySelector('#cv-t-meta').textContent = `TODAY ${asOf ? fmtAsOf(asOf) : '--'}, TREASURY ${fmtDay(d.officialDate)}`;
      ctx.updated(d.updated, d.stale, d.tenors.filter((t) => typeof t.realTime === 'boolean'));
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!host.querySelector('svg')) host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH CURVE', 'warn');
    }
  }

  load();
  // The same refresh as RATES: today's yields come from the same 15 s quote batch.
  ctx.live(load, 15_000);
}
