// HISTORY: daily open, high, low, close and volume, newest first, with a CSV download.
// Range pills and FROM/TO dates in the toolbar; the table is capped and a close chart
// with the range's numbers sits beside it.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING } from './markets.js';
import { errorHtml } from './profile.js';
import { priceDecimals } from './quote.js';
import { mountLines } from './lines.js';
import { fmtDay } from './company-kit.js';
import { toolbar, rangePills, panelTools, moreButton, dataTable, sortRows, nextSort, fmtDate } from '../kit.js';
import { nyToday, FIRST_DAY } from '../ranges.js';

const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const RATE = /^(US(2|10|30)Y)$/;

// Daily rows: no 1D (one row) and no MAX (the source keeps 10 years).
export const HISTORY_RANGES = ['5D', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y'];
export const PAGE = 60;

function isDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

// "2024" -> start or end of that year; "2024-03-01" as is.
function dayTok(tok, end) {
  if (/^\d{4}$/.test(tok)) return end ? `${tok}-12-31` : `${tok}-01-01`;
  return isDay(tok) ? tok : null;
}

// The first day a preset range covers, counted back from today (New York).
export function presetFrom(range, today = nyToday()) {
  const [y, m, d] = today.split('-').map(Number);
  const back = (years, months, days) => {
    const t = new Date(Date.UTC(y - years, m - 1 - months, d - days));
    // Feb 29 minus a year, or Mar 31 minus a month: step back to the month's last day.
    if (!days && t.getUTCDate() !== d) t.setUTCDate(0);
    return t.toISOString().slice(0, 10);
  };
  switch (range) {
    case '5D': return back(0, 0, 7);
    case '1M': return back(0, 1, 0);
    case '3M': return back(0, 3, 0);
    case '6M': return back(0, 6, 0);
    case 'YTD': return `${y}-01-01`;
    case '1Y': return back(1, 0, 0);
    case '2Y': return back(2, 0, 0);
    case '5Y': return back(5, 0, 0);
    case '10Y': return back(10, 0, 0);
    default: return null;
  }
}

// HISTORY <ticker> [<range> | <from> [<to>]]
export function parse(args, today = nyToday()) {
  const toks = args.filter((t) => t !== 'FROM' && t !== 'TO');
  if (!toks.length || toks.length > 3 || !(TICKER.test(toks[0]) || RATE.test(toks[0]))) return { error: 'usage' };
  const out = { ticker: toks[0] };
  if (toks.length === 2 && HISTORY_RANGES.includes(toks[1])) {
    if (toks[1] === '1Y') return out;
    return { ...out, range: toks[1], from: presetFrom(toks[1], today) };
  }
  if (toks[1]) { out.from = dayTok(toks[1], false); if (!out.from) return { error: 'usage' }; }
  if (toks[2]) { out.to = dayTok(toks[2], true); if (!out.to) return { error: 'usage' }; }
  if (out.from && !toks[2] && /^\d{4}$/.test(toks[1])) out.to = `${toks[1]}-12-31`;
  if (out.from && out.to && out.from > out.to) return { error: 'usage' };
  return out;
}

// The command for a range pill, or for two picked dates (TO today is left out).
export function historyCmd(ticker, { range = null, from = null, to = null } = {}, today = nyToday()) {
  if (range) return range === '1Y' ? `HISTORY ${ticker}` : `HISTORY ${ticker} ${range}`;
  if (!from) return `HISTORY ${ticker}`;
  return to && to < today ? `HISTORY ${ticker} ${from} ${to}` : `HISTORY ${ticker} ${from}`;
}

// Rows (newest first) -> CSV text, oldest first like most spreadsheets expect.
export function toCsv(ticker, rows) {
  const cell = (v) => (v === null || v === undefined ? '' : String(v));
  const lines = ['Date,Open,High,Low,Close,Volume,Change %'];
  for (const r of [...rows].reverse()) {
    lines.push([r.d, cell(r.o), cell(r.h), cell(r.l), cell(r.c), cell(r.v), r.chg === null ? '' : r.chg.toFixed(4)].join(','));
  }
  return lines.join('\n') + '\n';
}

// The numbers beside the chart, all from the rows shown (newest first).
export function rangeStats(rows) {
  const ok = rows.filter((r) => Number.isFinite(r.c));
  if (!ok.length) return null;
  const first = ok[ok.length - 1];
  const last = ok[0];
  let hi = ok[0];
  let lo = ok[0];
  for (const r of ok) {
    if (r.c > hi.c) hi = r;
    if (r.c < lo.c) lo = r;
  }
  const vols = rows.map((r) => r.v).filter((v) => Number.isFinite(v));
  return {
    first, last, hi, lo,
    changePct: first.c > 0 ? ((last.c - first.c) / first.c) * 100 : null,
    avgVolume: vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null,
  };
}

function usage() {
  const ex = ['HISTORY AAPL', 'HISTORY TSLA 2024', 'HISTORY AAPL 5Y', 'HISTORY MSFT 2025-01-01 2025-06-30'];
  return `<p class="notice">HISTORY needs a ticker. A range or dates are optional.</p>
    <p class="muted">Format: <span class="code">HISTORY &lt;ticker&gt; [range | from [to]]</span>, a range like 5Y, dates like 2025-01-31 or a year like 2024.</p>
    <p class="muted examples">Try ${ex.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`;
}

const fmtVol = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '--');

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'History', usage(), { cls: 'panel-solo' });
    ctx.status('HISTORY: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker, from, to } = cmd.args;
  const today = nyToday();
  const active = cmd.args.range || (from ? '' : '1Y');
  const dates = (f, t) => `<div class="ch-dates${active ? '' : ' is-active'}">
      <label><span>FROM</span><input type="date" name="from" min="${FIRST_DAY}" max="${today}" value="${esc(f)}"></label>
      <label><span>TO</span><input type="date" name="to" min="${FIRST_DAY}" max="${today}" value="${esc(t)}"></label>
    </div>`;
  const bar = toolbar({
    left: rangePills(active, (r) => historyCmd(ticker, { range: r }), HISTORY_RANGES),
    right: dates(from || '', to || today),
    label: 'Range',
  });
  el.innerHTML = panel('1', `${ticker} daily history`, `${bar}<div class="hist-main">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'hist-meta', bodyCls: 'flush' });
  const main = el.querySelector('.hist-main');
  const meta = el.querySelector('#hist-meta');
  let csvUrl = null;
  let stopChart = null;
  ctx.onCleanup(() => { if (csvUrl) URL.revokeObjectURL(csvUrl); stopChart?.(); });

  // Dates run on Enter or when focus leaves both fields.
  const box = el.querySelector('.toolbar .ch-dates');
  function applyDates() {
    const f = box.querySelector('input[name="from"]').value;
    const t = box.querySelector('input[name="to"]').value;
    if (!f) return;
    if (f === (from || '') && t === (to || today)) return;
    if (t && f >= t) { ctx.status('FROM HAS TO BE BEFORE TO', 'warn'); return; }
    if (f > today) { ctx.status('FROM IS IN THE FUTURE', 'warn'); return; }
    ctx.run(historyCmd(ticker, { from: f, to: t }, today));
  }
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyDates(); } });
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) applyDates(); });

  const params = new URLSearchParams({ s: ticker });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  ctx.fetchJSON(`/api/history?${params}`, { signal: ctx.signal }).then((d) => {
    const dec = priceDecimals(d.rows[0].c);
    const name = `${d.ticker}-${d.from}-${d.to}.csv`;
    csvUrl = URL.createObjectURL(new Blob([toCsv(d.ticker, d.rows)], { type: 'text/csv' }));
    if (!from) box.querySelector('input[name="from"]').value = d.from;
    let sort = { key: 'd', dir: 'desc' };
    let shown = PAGE;
    const px = (v) => fmtNum(v, dec);
    const columns = [
      { key: 'd', label: 'Date', fmt: (v) => esc(fmtDay(v)) },
      { key: 'o', label: 'Open', num: true, cls: 'hide-m', fmt: px },
      { key: 'h', label: 'High', num: true, cls: 'hide-m', fmt: px },
      { key: 'l', label: 'Low', num: true, cls: 'hide-m', fmt: px },
      { key: 'c', label: 'Close', num: true, cls: 'last', fmt: px },
      { key: 'chg', label: '%Chg', num: true, fmt: (v) => (Number.isFinite(v) ? `<span class="${dirOf(v)}">${fmtPct(v)}</span>` : '--') },
      { key: 'v', label: 'Volume', num: true, cls: 'hide-m dim', fmt: (v) => esc(fmtVol(v)) },
    ];
    const st = rangeStats(d.rows);
    const statRow = (k, v) => `<div class="stat"><dt>${esc(k)}</dt><dd class="num">${v}</dd></div>`;
    main.innerHTML = `<div class="with-side side-hug hist-layout co-wide">
        <div class="hist-table"></div>
        <aside class="hist-side" aria-label="${esc(ticker)} closes">
          <p class="side-title tag">Close, ${esc(fmtDay(d.from))} to ${esc(fmtDay(d.to))}</p>
          <div class="side-chart" id="hist-chart"></div>
          <p class="side-hover dim" id="hist-hover" aria-live="polite"></p>
          ${st ? `<dl class="stats side-stats">
            ${statRow('Change', `<span class="${dirOf(st.changePct)}">${Number.isFinite(st.changePct) ? fmtPct(st.changePct) : '--'}</span>`)}
            ${statRow('High close', `${px(st.hi.c)} <span class="dim">${esc(fmtDay(st.hi.d))}</span>`)}
            ${statRow('Low close', `${px(st.lo.c)} <span class="dim">${esc(fmtDay(st.lo.d))}</span>`)}
            ${statRow('Avg volume', esc(fmtVol(st.avgVolume)))}
          </dl>` : ''}
        </aside>
      </div>`;
    const tableEl = main.querySelector('.hist-table');
    function drawTable() {
      const list = sortRows(d.rows, sort.key, sort.dir);
      tableEl.innerHTML = dataTable({ columns, rows: list.slice(0, shown), sort, caption: `${ticker} daily prices` })
        + (shown < list.length ? moreButton(`MORE (${list.length - shown} LEFT)`, 'data-more') : '');
      meta.innerHTML = panelTools({ shown: Math.min(shown, list.length), total: list.length, csv: { href: csvUrl, name } });
    }
    tableEl.addEventListener('click', (e) => {
      const th = e.target.closest('.th-sort');
      if (th) {
        const col = columns.find((c) => c.key === th.dataset.sort);
        sort = nextSort(sort, col.key, Boolean(col.num));
        drawTable();
        tableEl.querySelector(`.th-sort[data-sort="${col.key}"]`)?.focus();
        return;
      }
      if (e.target.closest('[data-more]')) { shown += PAGE; drawTable(); }
    });
    meta.addEventListener('click', (e) => { if (e.target.closest('.tools-csv')) ctx.status(`SAVED ${name}`); });
    drawTable();

    const pts = [...d.rows].reverse().filter((r) => Number.isFinite(r.c)).map((r) => ({ x: Date.parse(`${r.d}T12:00:00Z`), y: r.c, d: r.d }));
    const long = pts.length > 1 && pts[pts.length - 1].x - pts[0].x > 200 * 86_400_000;
    const hover = main.querySelector('#hist-hover');
    const series = [{ id: 'c', cls: 'ln-0', label: 'Close', points: pts }];
    stopChart = mountLines(main.querySelector('#hist-chart'), series, {
      height: 200, label: `${ticker} daily close`, fmtY: px,
      fmtX: (x) => fmtDate(new Date(x), long ? 'axis' : 'table'),
      onHover: (h) => {
        if (!h) { hover.textContent = ''; return; }
        hover.textContent = `${fmtDay(new Date(h.x).toISOString().slice(0, 10))}  ${px(h.values[0].y)}`;
      },
    });
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    main.innerHTML = `<div class="pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO HISTORY FOR ${ticker}` : 'HISTORY: NO DATA', 'warn');
  });
}
