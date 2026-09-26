// DIVIDENDS: yield, the annual dividend, the next dates, and every payment on record.

import { esc, fmtNum, panel, LOADING } from './markets.js';
import { niceTicks } from './chart.js';
import { errorHtml, tickerUsage } from './profile.js';

export { parseTicker as parse } from './profile.js';

const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase() : '--');
const cash = (n) => (Number.isFinite(n) ? `$${fmtNum(n, n < 0.01 ? 6 : n < 1 ? 4 : 2).replace(/(\.\d\d\d*?)0+$/, '$1')}` : '--');

// Per-share basis words for the panel and the footnote.
export function basisNote(d) {
  const list = d?.split?.splits || [];
  if (!d?.split) return 'Amounts as paid: the split history is unavailable right now, so a payment before a stock split is on the old share basis.';
  if (!list.length) return 'No stock splits since the first payment shown: amounts as paid.';
  return `Amounts split-adjusted to today's share basis for the ${list.map((x) => `${x.ratio} split on ${x.date}`).join(', ')} (${d.split.source}); hover an amount for what was paid.`;
}

const mismatchTitle = (y) => `Not shown: Nasdaq lists ${y.nasdaq.count} payments (${cash(y.nasdaq.total)}), Yahoo Finance ${y.other.count} (${cash(y.other.total)})`;

// The footnote words on the yearly cross-check.
export function checkNote(d) {
  if (!d?.checkSource) return 'Yearly totals are not cross-checked right now.';
  const bad = (d.years || []).filter((y) => y.check === 'mismatch').map((y) => y.year);
  return `Each full year's total is cross-checked against ${d.checkSource}${bad.length ? `; * ${bad.join(', ')}: the two sources disagree (a payment missing or a different amount), so no total is shown` : ''}.`;
}

const rowTitle = (r) => (r.splitFactor ? `Paid ${cash(r.asPaid)} a share before later splits (x${fmtNum(r.splitFactor, r.splitFactor % 1 ? 2 : 0)} shares)` : (r.asPaid !== undefined && !Number.isFinite(r.amount) ? `Paid ${cash(r.asPaid)}; the split history does not reach this date` : ''));

// Yearly totals as bars, oldest to newest. The current year is drawn dimmer: it is
// the total so far. years: [{ year, total }] newest first (as the API sends them).
// Only the unbroken run of calendar years ending at the newest is drawn, so a gap in
// the history never looks like a year next to another. A year without a checked
// total shows "--" instead of a bar.
export function yearsChartSvg(years, { width = 420, height = 150, max = 15, currentYear = String(new Date().getUTCFullYear()) } = {}) {
  const run = [];
  for (const y of years) {
    if (run.length >= max) break;
    if (run.length && Number(run[run.length - 1].year) - 1 !== Number(y.year)) break;
    run.push(y);
  }
  const ys = run.reverse();
  const vals = ys.map((y) => y.total).filter(Number.isFinite);
  if (!ys.length || !vals.length) return '';
  const padR = 44;
  const padT = 8;
  const padB = 18;
  const W = Math.max(40, width - padR);
  const H = Math.max(40, height - padT - padB);
  const ticks = niceTicks(0, Math.max(...vals), 3);
  const hi = Math.max(ticks[ticks.length - 1] || 0, ...vals) || 1;
  const y = (v) => padT + (1 - v / hi) * H;
  const slot = W / ys.length;
  const bw = Math.max(2, Math.min(22, slot - 4));
  const every = Math.ceil(ys.length / Math.max(1, Math.floor(W / 40)));
  const grid = ticks.map((t) => `<line class="ch-grid" x1="0" x2="${W}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ch-ylab" x="${W + 6}" y="${(y(t) + 4).toFixed(1)}">${esc(`$${fmtNum(t, 2)}`)}</text>`).join('');
  const bars = ys.map((yr, i) => {
    const cx = slot * i + slot / 2;
    const lab = i % every === (ys.length - 1) % every ? `<text class="ch-xlab" x="${cx.toFixed(1)}" y="${height - 4}" text-anchor="middle">${esc(yr.year.slice(2))}</text>` : '';
    if (!Number.isFinite(yr.total)) return `<text class="ch-xlab" x="${cx.toFixed(1)}" y="${(y(0) - 4).toFixed(1)}" text-anchor="middle">--</text>${lab}`;
    const top = y(yr.total);
    return `<rect class="dv-bar${yr.year === currentYear ? ' is-part' : ''}" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y(0) - top).toFixed(1)}"><title>${esc(`${yr.year}${yr.year === currentYear ? ' so far' : ''}: ${cash(yr.total)}`)}</title></rect>${lab}`;
  }).join('');
  return `<svg class="chart dv-chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Dividends paid per share, per year">${grid}<line class="ch-axis" x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>${bars}</svg>`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Dividends', tickerUsage('DIVIDENDS', ['DIVIDENDS AAPL', 'DIVIDENDS KO', 'DIVIDENDS JNJ']), { cls: 'panel-solo' });
    ctx.status('DIVIDENDS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `${ticker} dividends`, LOADING, { meta: 'YIELD = YEARLY DIVIDEND / PRICE, BEFORE TAX' })}
    ${panel('2', 'Every payment', LOADING, { metaId: 'dv-meta', bodyCls: 'flush' })}
  </div>
  <p class="footnote"></p>`;
  const [top, list] = el.querySelectorAll('.panel-body');
  const foot = el.querySelector('.footnote');
  let ro = null;
  ctx.onCleanup?.(() => ro?.disconnect());

  ctx.fetchJSON(`/api/dividends?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    if (!d.rows.length && (d.annual > 0 || d.yield > 0)) {
      top.innerHTML = `<div>
        <p class="q-name">Dividend yield</p>
        <p class="q-hero num">${Number.isFinite(d.yield) ? `${fmtNum(d.yield, 2)}<span class="q-ccy">%</span>` : '--'}</p>
        <dl class="stats dv-stats"><div class="stat"><dt>Per year</dt><dd class="num">${esc(cash(d.annual))}</dd></div></dl>
        <p class="muted dv-note">Payment history is only available here for Nasdaq-listed stocks. Yield and yearly dividend from CNBC.</p>
      </div>`;
      list.closest('.panel').hidden = true;
      ctx.updated(d.updated, d.stale);
      return;
    }
    if (!d.rows.length) {
      top.innerHTML = `<p class="notice">${esc(ticker)} has no dividends on record.</p><p class="muted">Some companies return cash by buying back shares instead.</p>`;
      list.closest('.panel').hidden = true;
      ctx.updated(d.updated, d.stale);
      return;
    }
    const yearsRows = d.years.slice(0, 12);
    const adjusted = Boolean(d.split?.splits?.length);
    const basis = adjusted ? 'split-adjusted' : 'as paid';
    top.innerHTML = `<div class="dv-top">
      <div class="dv-left">
        <p class="q-name">Dividend yield</p>
        <p class="q-hero num">${Number.isFinite(d.yield) ? `${fmtNum(d.yield, 2)}<span class="q-ccy">%</span>` : '--'}</p>
        <dl class="stats dv-stats">
          <div class="stat"><dt>Per year</dt><dd class="num">${esc(cash(d.annual))}</dd></div>
          <div class="stat"><dt>Last ex-date</dt><dd class="num">${esc(fmtDay(d.exDate))}</dd></div>
          <div class="stat"><dt>Last paid</dt><dd class="num">${esc(fmtDay(d.payDate))}</dd></div>
        </dl>
        <p class="dv-chart-head">Paid per share per year, ${esc(basis)}${d.years.some((y) => y.year === String(new Date().getUTCFullYear())) ? `; ${esc(String(new Date().getUTCFullYear()))} so far (dimmer)` : ''}</p>
        <div class="dv-chart-host"></div>
      </div>
      <table class="grid-table dv-years">
        <thead><tr><th scope="col">Year</th><th scope="col" class="num">Paid (${esc(basis)})</th><th scope="col" class="num">Payments</th></tr></thead>
        <tbody>${yearsRows.map((y) => `<tr><th scope="row" class="name">${esc(y.year)}</th><td class="num last"${y.check === 'mismatch' ? ` title="${esc(mismatchTitle(y))}"` : ''}>${esc(cash(y.total))}${y.check === 'mismatch' ? '*' : ''}</td><td class="num dim">${y.count}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
    const host = top.querySelector('.dv-chart-host');
    let lastW = 0;
    const draw = () => {
      const w = Math.floor(host.clientWidth);
      if (!w || w === lastW) return;
      lastW = w;
      host.innerHTML = yearsChartSvg(d.years, { width: w, height: host.clientHeight || 150 });
    };
    draw();
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(draw); ro.observe(host); }
    el.querySelector('#dv-meta').textContent = `${d.rows.length} PAYMENTS${adjusted ? ' · SPLIT-ADJUSTED' : ''}`;
    foot.textContent = `${basisNote(d)} ${checkNote(d)}`.trim();
    list.innerHTML = `<table class="grid-table dv-table">
      <thead><tr><th scope="col">Ex-date</th><th scope="col" class="num">Amount${adjusted ? ' (split-adj.)' : ''}</th><th scope="col" class="chg">Type</th><th scope="col" class="num time">Declared</th><th scope="col" class="num">Paid</th></tr></thead>
      <tbody>${d.rows.map((r) => `<tr>
        <th scope="row" class="name">${esc(r.exDate)}</th>
        <td class="num last"${rowTitle(r) ? ` title="${esc(rowTitle(r))}"` : ''}>${esc(cash(r.amount))}</td>
        <td class="chg dim">${esc(r.type || '--')}</td>
        <td class="num time dim">${esc(r.declared || '--')}</td>
        <td class="num">${esc(r.paid || '--')}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    top.innerHTML = errorHtml(err, ticker);
    list.closest('.panel').hidden = true;
    ctx.status(err.status === 404 ? `NO DIVIDEND DATA FOR ${ticker}` : 'DIVIDENDS: NO DATA', 'warn');
  });
}
