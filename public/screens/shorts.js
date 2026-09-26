// SHORTS <ticker>: short interest by settlement date (twice a month), average daily
// volume and days to cover, newest first, with the short interest trend beside it.

import { esc, fmtNum, fmtSigned, dirOf, panel, LOADING } from './markets.js';
import { metaNote, errorHtml, tickerUsage, fmtInt, fmtBig, fmtDay, dash } from './company-kit.js';
import { dataTable, sortRows, nextSort, fmtDate } from '../kit.js';
import { mountLines } from './lines.js';

export { parseTicker as parse } from './company-kit.js';

const signedPct = (n) => (Number.isFinite(n) ? `${fmtSigned(n, 2)}%` : dash);

// Dates are the plain label; the short interest itself is the number that stands out.
const COLUMNS = [
  { key: 'date', label: 'Settlement', cls: 'date', fmt: (v) => esc(fmtDay(v)) },
  { key: 'shortInterest', label: 'Short interest', num: true, cls: 'last', fmt: (v) => `<span class="d-only">${fmtInt(v)}</span><span class="m-only">${fmtBig(v)}</span>` },
  { key: 'changePct', label: 'Change', num: true, fmt: (v) => `<span class="${dirOf(v)}">${signedPct(v)}</span>` },
  { key: 'avgVolume', label: 'Avg daily volume', num: true, cls: 'hide-m dim', fmt: (v) => fmtBig(v) },
  { key: 'daysToCover', label: 'Days to cover', num: true, fmt: (v) => (Number.isFinite(v) ? fmtNum(v, 2) : dash) },
];

export function shortsTable(rows, sort = { key: 'date', dir: 'desc' }) {
  return dataTable({ columns: COLUMNS, rows: sortRows(rows, sort.key, sort.dir), sort, caption: 'Short interest by settlement date' });
}

// Oldest first, for the chart: [{ x: ms, y: shares, d }].
export function trendPoints(rows) {
  return rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && Number.isFinite(r.shortInterest))
    .map((r) => ({ x: Date.parse(`${r.date}T12:00:00Z`), y: r.shortInterest, d: r.date }))
    .sort((a, b) => a.x - b.x);
}

const NOTE = 'NASDAQ-LISTED STOCKS ONLY';
const NOTE_LONG = 'Short interest = shares sold short and not yet bought back, on the settlement date. Days to cover = short interest / average daily volume, as published. Change is against the settlement before it.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Shorts', tickerUsage('SHORTS', ['SHORTS AAPL', 'SHORTS TSLA', 'SHORTS NVDA']), { cls: 'panel-solo' });
    ctx.status('SHORTS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = panel('1', `${ticker} short interest`, LOADING, { cls: 'panel-solo', metaId: 'si-meta', bodyCls: 'flush' });
  const body = el.querySelector('.panel-body');
  let stopChart = null;
  ctx.onCleanup(() => stopChart?.());

  ctx.fetchJSON(`/api/shorts?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    const pts = trendPoints(d.rows);
    const newest = d.rows.find((r) => Number.isFinite(r.shortInterest));
    body.innerHTML = `<div class="with-side side-hug co-wide">
        <div class="si-table"></div>
        <aside class="side-panel" aria-label="Short interest trend">
          <p class="side-title tag">Short interest, shares</p>
          ${pts.length >= 2 ? '<div class="side-chart" id="si-chart"></div><p class="side-hover dim" id="si-hover" aria-live="polite"></p>' : '<p class="side-empty">Not enough settlements for a trend.</p>'}
          ${newest ? `<dl class="stats side-stats">
            <div class="stat"><dt>Latest</dt><dd class="num">${fmtBig(newest.shortInterest)} <span class="dim">${esc(fmtDay(newest.date))}</span></dd></div>
            <div class="stat"><dt>Days to cover</dt><dd class="num">${Number.isFinite(newest.daysToCover) ? fmtNum(newest.daysToCover, 2) : dash}</dd></div>
          </dl>` : ''}
        </aside>
      </div>`;
    const tableEl = body.querySelector('.si-table');
    let sort = { key: 'date', dir: 'desc' };
    const draw = () => { tableEl.innerHTML = shortsTable(d.rows, sort); };
    tableEl.addEventListener('click', (e) => {
      const th = e.target.closest('.th-sort');
      if (!th) return;
      const col = COLUMNS.find((c) => c.key === th.dataset.sort);
      sort = nextSort(sort, col.key, Boolean(col.num));
      draw();
      tableEl.querySelector(`.th-sort[data-sort="${col.key}"]`)?.focus();
    });
    draw();
    if (pts.length >= 2) {
      const hover = body.querySelector('#si-hover');
      stopChart = mountLines(body.querySelector('#si-chart'), [{ id: 'si', cls: 'ln-0', label: 'Short interest', points: pts }], {
        label: `${ticker} short interest by settlement date`, fmtY: (v) => fmtBig(v),
        fmtX: (x) => fmtDate(new Date(x), 'axis'),
        onHover: (h) => { hover.textContent = h ? `${fmtDay(new Date(h.x).toISOString().slice(0, 10))}  ${fmtInt(h.values[0].y)}` : ''; },
      });
    }
    el.querySelector('#si-meta').innerHTML = `<span class="panel-tools"><span class="tools-count">${d.rows.length} SETTLEMENTS</span></span> · ${metaNote(NOTE, NOTE_LONG)}`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO SHORT INTEREST FOR ${ticker}` : 'SHORTS: NO DATA', 'warn');
  });
}
