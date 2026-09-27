// FINANCIALS: income statement, balance sheet and cash flow from SEC filings.
//   FINANCIALS AAPL                      income statement, last 10 fiscal years
//   FINANCIALS MSFT BALANCE              balance sheet
//   FINANCIALS NVDA CASHFLOW QUARTERLY   cash flow, last 8 quarters

import { esc, q, fmtNum, dirOf, panel, metaNote, LOADING } from './markets.js';
import { niceTicks } from './chart.js';

export const FIN_TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const STATEMENT_WORDS = {
  INCOME: 'income', IS: 'income', EARNINGS: 'income',
  BALANCE: 'balance', BS: 'balance', SHEET: 'balance',
  CASH: 'cashflow', CASHFLOW: 'cashflow', CF: 'cashflow', FLOW: 'cashflow',
};
const PERIOD_WORDS = { ANNUAL: 'annual', YEARLY: 'annual', YEARS: 'annual', QUARTERLY: 'quarterly', QUARTERS: 'quarterly', Q: 'quarterly' };
// Per-share basis: split-adjusted (the default) or as the filings reported it.
const BASIS_WORDS = { REPORTED: 'reported', ASREPORTED: 'reported', FILED: 'reported', ADJUSTED: 'adjusted', SPLIT: 'adjusted' };
const STATEMENT_CMD = { income: '', balance: 'BALANCE', cashflow: 'CASHFLOW' };
export const STATEMENT_LABEL = { income: 'Income', balance: 'Balance', cashflow: 'Cash flow' };

// Words after the ticker: [INCOME|BALANCE|CASHFLOW] [ANNUAL|QUARTERLY] [REPORTED], any order.
export function parseFinancialsArgs(toks) {
  const [ticker, ...rest] = toks;
  if (!ticker || !FIN_TICKER_RE.test(ticker)) return { error: 'usage' };
  let statement = 'income';
  let period = 'annual';
  let basis = 'adjusted';
  for (const t of rest) {
    if (STATEMENT_WORDS[t]) statement = STATEMENT_WORDS[t];
    else if (PERIOD_WORDS[t]) period = PERIOD_WORDS[t];
    else if (BASIS_WORDS[t]) basis = BASIS_WORDS[t];
    else if (t === 'FLOW' || t === 'SHEET' || t === 'STATEMENT' || t === 'AS') continue;
    else return { error: 'usage', ticker };
  }
  return basis === 'reported' ? { ticker, statement, period, basis } : { ticker, statement, period };
}

export function financialsInput({ ticker, statement = 'income', period = 'annual', basis = 'adjusted' }) {
  return ['FINANCIALS', ticker, STATEMENT_CMD[statement], period === 'quarterly' ? 'QUARTERLY' : '', basis === 'reported' ? 'REPORTED' : ''].filter(Boolean).join(' ');
}

export function parseFinancialsCommand(rest) {
  const args = parseFinancialsArgs(rest);
  if (args.error) return { name: 'FINANCIALS', args, error: args.error, input: ['FINANCIALS', ...rest].join(' ') };
  return { name: 'FINANCIALS', args, input: financialsInput(args) };
}

// ---- formats --------------------------------------------------------------------

// Dollars to millions, no decimals: 391035000000 -> "391,035".
export function fmtMillions(v) {
  return Number.isFinite(v) ? fmtNum(v / 1e6, 0) : '--';
}

export function fmtCell(line, c) {
  if (!c || !Number.isFinite(c.v)) return '--';
  if (line.unit === 'eps') return fmtNum(c.v, 2);
  return fmtMillions(c.v);
}

// 1.0 decimal percent, "--" when missing.
export function fmtRatio(v) {
  return Number.isFinite(v) ? `${fmtNum(v, 1)}%` : '--';
}

// ---- rows per statement --------------------------------------------------------

const ROWS = {
  income: [
    { id: 'revenue', label: 'Revenue' },
    { id: 'revenueGrowth', label: 'Revenue growth', ratio: true, growth: true },
    { id: 'grossProfit', label: 'Gross profit' },
    { id: 'operatingIncome', label: 'Operating income' },
    { id: 'netIncome', label: 'Net income' },
    { id: 'netIncomeGrowth', label: 'Net income growth', ratio: true, growth: true },
    { id: 'epsDiluted', label: 'EPS diluted ($)', unit: 'eps' },
    { id: 'sharesDiluted', label: 'Shares diluted (M)' },
    { group: 'Margins' },
    { id: 'grossMargin', label: 'Gross margin', ratio: true },
    { id: 'operatingMargin', label: 'Operating margin', ratio: true },
    { id: 'netMargin', label: 'Net margin', ratio: true },
  ],
  balance: [
    { id: 'cash', label: 'Cash' },
    { id: 'totalAssets', label: 'Total assets' },
    { id: 'totalLiabilities', label: 'Total liabilities' },
    { id: 'longTermDebt', label: 'Long-term debt' },
    { id: 'equity', label: "Shareholders' equity" },
  ],
  cashflow: [
    { id: 'operatingCashFlow', label: 'Operating cash flow' },
    { id: 'capex', label: 'Capex' },
    { id: 'freeCashFlow', label: 'Free cash flow' },
    { id: 'dividendsPaid', label: 'Dividends paid' },
  ],
};
export const STATEMENT_ROWS = ROWS;

// The filing a number came from: "From 10-Q filed 2026-07-31 (accession ...)". The
// latest filing wins, so a restated figure names the filing that restated it.
export function filedFrom(c) {
  if (!c?.form || !c.filed) return '';
  return `From ${c.form} filed ${c.filed}${c.accn ? ` (accession ${c.accn})` : ''}`;
}

// Where a number came from, for the cell's tooltip; worked-out numbers say how.
export function cellTitle(c) {
  if (!c) return 'Not in the filings';
  const from = filedFrom(c);
  const tag = c.tag ? `, us-gaap:${c.tag}` : '';
  const lower = (t) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  if (c.calc) {
    const capex = c.capex ? filedFrom(c.capex) : '';
    return `Worked out: operating cash flow minus capex${c.derived ? ' (quarters from year-to-date totals)' : ''}.${from ? ` Operating cash flow: ${lower(from)}.` : ''}${capex ? ` Capex: ${lower(capex)}.` : ''}`;
  }
  const how = c.derived
    ? (/^10-K/.test(c.form || '') ? 'Worked out: the full year minus Q1 to Q3. ' : 'Worked out: the year-to-date total minus the earlier quarters. ')
    : '';
  const split = c.splitFactor ? `Split-adjusted: filed as ${fmtNum(c.asReported, c.asReported < 1000 ? 2 : 0)} before later splits (x${fmtNum(c.splitFactor, c.splitFactor % 1 ? 2 : 0)} shares). ` : '';
  return `${split}${how}${from}${tag}`;
}

// A value on sec.gov: the filing's index page, or null.
export function cellUrl(cik, c) {
  return filingUrl(cik, c?.accn);
}

// One value cell's content: the number as it looks, a link to its filing (hover or focus
// for where it came from), and a one-character mark on numbers that were worked out.
export function valueHtml(cik, c, text) {
  const mark = c && (c.derived || c.calc) ? '<sup class="fin-d" data-prov aria-hidden="true">*</sup>' : '';
  const url = cellUrl(cik, c);
  if (!url) return mark ? `<span class="fin-nv">${esc(text)}${mark}</span>` : esc(text);
  return `<a class="fin-v" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}${mark}</a>`;
}

// The rows of one mode for a basis: split-adjusted EPS and share counts replace the
// filed ones when the server sent them.
export function basisValues(m, basis = 'adjusted') {
  if (basis === 'reported' || !m?.adjusted) return m.values;
  return { ...m.values, ...m.adjusted };
}

function shortDate(iso) {
  return iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}` : '';
}

function filingUrl(cik, accn) {
  const n = Number(cik);
  if (!Number.isInteger(n) || !/^\d{10}-\d{2}-\d{6}$/.test(accn || '')) return null;
  return `https://www.sec.gov/Archives/edgar/data/${n}/${accn.replace(/-/g, '')}/${accn}-index.htm`;
}

export function statementTable(d, mode, statement, basis = 'adjusted') {
  const m = d[mode];
  const values = basisValues(m, basis);
  const cols = m.periods;
  const head = cols.map((p) => {
    const url = filingUrl(d.cik, p.accn);
    const lab = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(`${p.form} filed ${p.filed}`)}">${esc(p.label)}</a>` : esc(p.label);
    return `<th scope="col" class="num"><span class="fin-per">${lab}</span><span class="fin-end">${esc(shortDate(p.end))}</span></th>`;
  }).join('');
  const body = ROWS[statement].map((r) => {
    // The label gets its own cell so it stays in the sticky first column on narrow screens.
    if (r.group) return `<tr class="group-row"><th scope="rowgroup">${esc(r.group)}</th><td colspan="${cols.length}"></td></tr>`;
    if (r.ratio) {
      const vals = m.ratios[r.id] || [];
      return `<tr class="fin-ratio"><th scope="row" class="name">${esc(r.label)}</th>${cols.map((_, i) => {
        const v = vals[i];
        const ok = Number.isFinite(v);
        const text = r.growth ? (ok ? `${fmtSigned1(v)}%` : '--') : fmtRatio(v);
        return `<td class="num${r.growth && ok ? ` ${dirOf(v)}` : ''}">${esc(text)}</td>`;
      }).join('')}</tr>`;
    }
    const vals = values[r.id] || [];
    return `<tr><th scope="row" class="name">${esc(r.label)}</th>${cols.map((_, i) => {
      const c = vals[i];
      return `<td class="num${c?.derived ? ' is-derived' : ''}" title="${esc(cellTitle(c))}">${valueHtml(d.cik, c, fmtCell(r, c))}</td>`;
    }).join('')}</tr>`;
  }).join('');
  return `<div class="fin-scroll"><table class="grid-table fin-table">
    <thead><tr><th scope="col" class="fin-unit">USD millions</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function fmtSigned1(v) {
  const s = fmtNum(Math.abs(v), 1);
  if (Number(s.replace(/,/g, '')) === 0) return s;
  return (v > 0 ? '+' : '−') + s;
}

// ---- bar chart: revenue and net income ----------------------------------------------

// cols (optional): [{ x, w }] per period, the table's column boxes in chart
// coordinates, so each pair of bars sits over its own table column; plotLeft is where
// the plot starts (the right edge of the table's label column), with the axis
// labels just left of it. Without cols the periods share the width evenly.
export function barChartSvg(periods, rev, net, { width = 640, height = 150, cols = null, plotLeft = 0 } = {}) {
  const n = periods.length;
  const vals = [...rev, ...net].filter(Number.isFinite);
  if (!n || !vals.length) return '';
  const aligned = Array.isArray(cols) && cols.length === n && plotLeft > 0;
  const padR = aligned ? 0 : 56;
  const padT = 8;
  const padB = 20;
  const W = Math.max(40, width - padR);
  const H = Math.max(40, height - padT - padB);
  const vMin = Math.min(0, ...vals);
  const vMax = Math.max(0, ...vals);
  const ticks = niceTicks(vMin, vMax, Math.max(2, Math.round(H / 40)));
  // Extend the ticks one step past the tallest bar, so every bar sits under a labelled line.
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 0;
  if (step > 0) {
    while (ticks[ticks.length - 1] < vMax) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
    while (ticks[0] > vMin) ticks.unshift(Number((ticks[0] - step).toPrecision(12)));
  }
  const lo = Math.min(0, ticks[0] ?? 0, ...vals);
  const hi = Math.max(ticks[ticks.length - 1] ?? 0, ...vals) || 1;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * H;
  const x0 = aligned ? plotLeft : 0;
  const box = (i) => (aligned ? cols[i] : { x: (W / n) * i, w: W / n });
  const slot = aligned ? Math.min(...cols.map((c) => c.w)) : W / n;
  const bw = Math.max(2, Math.min(28, (slot - 8) / 2 - 1));
  const ylab = (t) => (aligned
    ? `<text class="ch-ylab" x="${(plotLeft - 6).toFixed(1)}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(fmtAxis(t))}</text>`
    : `<text class="ch-ylab" x="${W + 6}" y="${(y(t) + 4).toFixed(1)}">${esc(fmtAxis(t))}</text>`);
  const grid = ticks.map((t) => `<line class="ch-grid" x1="${x0.toFixed(1)}" x2="${W}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>${ylab(t)}`).join('');
  const every = aligned ? 1 : Math.ceil(n / Math.max(1, Math.floor(W / 64)));
  const bars = periods.map((p, i) => {
    const b = box(i);
    const cx = b.x + b.w / 2;
    // A column scrolled under the sticky label column is not drawn.
    if (aligned && (cx - bw - 1 < plotLeft || cx > width)) return '';
    const bar = (v, x, cls) => {
      if (!Number.isFinite(v)) return '';
      const y0 = y(0);
      const y1 = y(v);
      return `<rect class="${cls}" x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}"/>`;
    };
    const lab = i % every === (n - 1) % every ? `<text class="ch-xlab" x="${cx.toFixed(1)}" y="${height - 5}" text-anchor="middle">${esc(shortLabel(p.label))}</text>` : '';
    return `<g class="fin-col" data-i="${i}"><rect class="fin-hit" x="${b.x.toFixed(1)}" y="${padT}" width="${b.w.toFixed(1)}" height="${H}"/>${bar(rev[i], cx - bw - 1, 'fin-bar-rev')}${bar(net[i], cx + 1, 'fin-bar-net')}${lab}</g>`;
  }).join('');
  return `<svg class="chart fin-chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Revenue and net income by period, USD millions">
    ${grid}
    <line class="ch-axis" x1="${x0.toFixed(1)}" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
    ${bars}
  </svg>`;
}

// Axis labels in billions or millions of dollars.
function fmtAxis(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${fmtNum(v / 1e9, a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${fmtNum(v / 1e6, 0)}M`;
  return fmtNum(v, 0);
}

// "Q3 FY2026" -> "Q3 26", "FY2024" -> "FY24"
export function shortLabel(label) {
  return String(label).replace(/^FY(\d{2})(\d{2})$/, 'FY$2').replace(/^(Q\d) FY\d{2}(\d{2})$/, '$1 $2');
}

// ---- screen -------------------------------------------------------------------------

const EXAMPLES = ['FINANCIALS AAPL', 'FINANCIALS MSFT BALANCE', 'FINANCIALS NVDA QUARTERLY'];
const exampleLinks = () => EXAMPLES.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ');

function tabBar(args, withBasis = false) {
  const tab = (label, a, on) => {
    const c = financialsInput(a);
    return `<a class="tab${on ? ' is-active' : ''}" href="${esc(q(c))}" data-cmd="${esc(c)}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  };
  const st = ['income', 'balance', 'cashflow'].map((s) => tab(STATEMENT_LABEL[s].toUpperCase(), { ...args, statement: s }, args.statement === s)).join('');
  const pe = [['ANNUAL', 'annual'], ['QUARTERLY', 'quarterly']].map(([l, p]) => tab(l, { ...args, period: p }, args.period === p)).join('');
  const basis = args.basis || 'adjusted';
  const ba = withBasis ? `<nav class="tabs ch-tabs fin-periods fin-basis" aria-label="Per-share basis">${[['SPLIT-ADJUSTED', 'adjusted'], ['AS REPORTED', 'reported']].map(([l, b]) => tab(l, { ...args, basis: b }, basis === b)).join('')}</nav>` : '';
  return `<div class="ch-bar fin-bar"><nav class="tabs ch-tabs" aria-label="Statement">${st}</nav>${ba}<nav class="tabs ch-tabs fin-periods" aria-label="Period">${pe}</nav></div>`;
}

// The per-share basis, in words (the tooltip on the title strip's note).
export function basisNote(d, basis = 'adjusted') {
  const list = d?.split?.splits || [];
  const names = list.map((x) => `${x.ratio} split on ${x.date}`).join(' and the ');
  if (!d?.split) return 'EPS and share counts as filed: the split history is unavailable right now, so a figure filed before a stock split is on the old share basis.';
  if (!list.length) return 'No stock splits in these years: EPS and share counts are as filed.';
  if (basis === 'reported') return `EPS and share counts as reported: each figure as its latest filing gave it, so figures filed before the ${names} are on the old share basis. SPLIT-ADJUSTED puts them on today's basis.`;
  return `EPS and share counts split-adjusted to today's share basis for the ${names} (${d.split.source}); hover a number for the filed value. AS REPORTED shows them as filed.`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Financials', `
      <p class="notice">FINANCIALS needs a ticker.</p>
      <p class="muted">Format: <span class="code">FINANCIALS &lt;ticker&gt; [BALANCE|CASHFLOW] [QUARTERLY]</span></p>
      <p class="muted examples">Try ${exampleLinks()}</p>`, { cls: 'panel-solo' });
    ctx.status('FINANCIALS: CHECK THE FORMAT', 'warn');
    return;
  }
  const args = cmd.args;
  const mode = args.period;
  const basis = args.basis || 'adjusted';
  el.innerHTML = `<div class="stack">
    ${panel('1', `${args.ticker} financials`, `${tabBar(args)}<div class="fin-body">${LOADING}</div>`, { metaId: 'fin-meta', bodyCls: 'flush' })}
  </div>`;
  const body = el.querySelector('.fin-body');
  const meta = el.querySelector('#fin-meta');
  let ro = null;
  ctx.onCleanup(() => ro?.disconnect());

  ctx.fetchJSON(`/api/financials?s=${encodeURIComponent(args.ticker)}`, { signal: ctx.signal }).then((d) => {
    const m = d[mode];
    meta.textContent = `${d.title || d.name || args.ticker}`.toUpperCase();
    if (!m?.periods?.length) {
      body.innerHTML = `<p class="panel-msg">No ${mode} figures on file for ${esc(args.ticker)}.</p>`;
      ctx.status(`FINANCIALS ${args.ticker}: NO ${mode.toUpperCase()} DATA`, 'warn');
      return;
    }
    const rev = m.values.revenue.map((c) => c?.v ?? null);
    const net = m.values.netIncome.map((c) => c?.v ?? null);
    const hasSplits = Boolean(d.split?.splits?.length);
    if (hasSplits) el.querySelector('.fin-bar').outerHTML = tabBar(args, true);
    body.innerHTML = `
      <div class="fin-chart-wrap">
        <div class="fin-chart-head"><span class="fin-key"><span class="fin-sw fin-sw-rev"></span>Revenue</span><span class="fin-key"><span class="fin-sw fin-sw-net"></span>Net income</span><span class="fin-hover num" aria-live="polite"></span></div>
        <div class="fin-chart-host"></div>
      </div>
      ${statementTable(d, mode, args.statement, basis)}`;
    const host = body.querySelector('.fin-chart-host');
    const hover = body.querySelector('.fin-hover');
    const scroller = body.querySelector('.fin-scroll');
    let lastKey = '';
    // The bars sit over the table's own columns: measured from the header cells.
    const draw = () => {
      const w = Math.floor(host.clientWidth);
      if (!w) return;
      const hb = host.getBoundingClientRect();
      const ths = [...body.querySelectorAll('.fin-table thead th')];
      const cols = ths.slice(1).map((th) => { const r = th.getBoundingClientRect(); return { x: r.left - hb.left, w: r.width }; });
      const plotLeft = ths[0] ? ths[0].getBoundingClientRect().right - hb.left : 0;
      const key = `${w}|${cols.map((c) => c.x.toFixed(0)).join(',')}|${plotLeft.toFixed(0)}`;
      if (key === lastKey) return;
      lastKey = key;
      host.innerHTML = barChartSvg(m.periods, rev, net, { width: w, height: host.clientHeight || 150, cols, plotLeft });
      const svg = host.querySelector('svg');
      if (!svg) return;
      const show = (e) => {
        const g = e.target.closest?.('.fin-col');
        svg.querySelectorAll('.fin-col.is-on').forEach((x) => x.classList.remove('is-on'));
        if (!g) { hover.textContent = ''; return; }
        g.classList.add('is-on');
        const i = Number(g.dataset.i);
        hover.textContent = `${m.periods[i].label}  REV ${fmtMillions(rev[i])}  NET ${fmtMillions(net[i])}`;
      };
      svg.addEventListener('pointermove', show);
      svg.addEventListener('pointerdown', show);
      svg.addEventListener('pointerleave', () => { hover.textContent = ''; svg.querySelectorAll('.fin-col.is-on').forEach((x) => x.classList.remove('is-on')); });
    };
    scroller.scrollLeft = scroller.scrollWidth;
    draw();
    scroller.addEventListener('scroll', draw, { passive: true });
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(draw); ro.observe(host); }
    const derived = mode === 'quarterly' || Object.values(m.values).some((arr) => arr.some((c) => c?.derived))
      || (args.statement === 'cashflow' && m.values.freeCashFlow?.some(Boolean));
    // How to read the per-share rows and the dotted cells: short in the title strip,
    // the long form as its tooltip.
    const income = args.statement === 'income';
    const short = [
      income && hasSplits ? (basis === 'reported' ? 'EPS AS REPORTED' : 'EPS SPLIT-ADJUSTED') : '',
      income && !d.split ? 'EPS AS FILED, SPLITS UNKNOWN' : '',
      derived ? '* = WORKED OUT' : '',
    ].filter(Boolean).join(' · ');
    const long = [
      income ? basisNote(d, basis) : '',
      derived ? 'A * marks a number worked out from filed ones: a quarter the filing only gives inside a year-to-date total (that total minus the earlier quarters; always the case for Q4), and free cash flow (operating cash flow minus capex). Hover a number for the filing it came from; click it to open that filing on sec.gov.' : '',
    ].filter(Boolean).join(' ');
    if (short) meta.insertAdjacentHTML('beforeend', ` · ${metaNote(short, long)}`);
    const lastP = m.periods[m.periods.length - 1];
    ctx.status(`${d.stale ? 'LAST KNOWN DATA · ' : ''}SEC FILINGS · LATEST ${lastP.label} (${lastP.form} FILED ${lastP.filed})`, d.stale ? 'warn' : '');
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    const known = err.status === 404 || err.status === 400;
    body.innerHTML = `<div class="fin-msg"><p class="notice">${esc(err.message)}</p>${known ? `<p class="muted examples">Try ${exampleLinks()}</p>` : ''}</div>`;
    ctx.status(known ? `FINANCIALS ${args.ticker}: ${err.code === 'no_data' ? 'NO 10-K OR 10-Q DATA' : 'NO SEC FILINGS'}` : 'COULD NOT LOAD FINANCIALS', 'warn');
  });
}
