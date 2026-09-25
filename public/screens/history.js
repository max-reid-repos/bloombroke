// HISTORY: daily open, high, low, close and volume, newest first, with a CSV download.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING } from './markets.js';
import { companyLinks, errorHtml } from './profile.js';
import { priceDecimals } from './quote.js';

const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const RATE = /^(US(2|10|30)Y)$/;

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

// HISTORY <ticker> [FROM] [TO]
export function parse(args) {
  const toks = args.filter((t) => t !== 'FROM' && t !== 'TO');
  if (!toks.length || toks.length > 3 || !(TICKER.test(toks[0]) || RATE.test(toks[0]))) return { error: 'usage' };
  const out = { ticker: toks[0] };
  if (toks[1]) { out.from = dayTok(toks[1], false); if (!out.from) return { error: 'usage' }; }
  if (toks[2]) { out.to = dayTok(toks[2], true); if (!out.to) return { error: 'usage' }; }
  if (out.from && !toks[2] && /^\d{4}$/.test(toks[1])) out.to = `${toks[1]}-12-31`;
  if (out.from && out.to && out.from > out.to) return { error: 'usage' };
  return out;
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

function usage() {
  const ex = ['HISTORY AAPL', 'HISTORY TSLA 2024', 'HISTORY MSFT 2025-01-01 2025-06-30'];
  return `<p class="notice">HISTORY needs a ticker. Dates are optional.</p>
    <p class="muted">Format: <span class="code">HISTORY &lt;ticker&gt; [from] [to]</span>, dates like 2025-01-31 or a year like 2024.</p>
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
  el.innerHTML = panel('1', `${ticker} daily history`, LOADING, { cls: 'panel-solo', meta: companyLinks(ticker, 'HISTORY'), bodyCls: 'flush' })
    + '<p class="footnote">Daily prices from CNBC, adjusted for splits. Today shows once the day closes. Change is close to close. Not financial advice.</p>';
  const body = el.querySelector('.panel-body');
  let csvUrl = null;
  ctx.onCleanup(() => { if (csvUrl) URL.revokeObjectURL(csvUrl); });

  const params = new URLSearchParams({ s: ticker });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  ctx.fetchJSON(`/api/history?${params}`, { signal: ctx.signal }).then((d) => {
    const dec = priceDecimals(d.rows[0].c);
    const name = `${d.ticker}-${d.from}-${d.to}.csv`;
    body.innerHTML = `<div class="hist-bar">
        <span class="dim">${esc(d.from)} TO ${esc(d.to)}, ${d.rows.length} TRADING DAYS</span>
        <button type="button" class="btn" id="hist-csv">DOWNLOAD CSV</button>
      </div>
      <div class="hist-scroll"><table class="grid-table history-table">
        <thead><tr><th scope="col">Date</th><th scope="col" class="num chg">Open</th><th scope="col" class="num chg">High</th><th scope="col" class="num chg">Low</th><th scope="col" class="num">Close</th><th scope="col" class="num">%Chg</th><th scope="col" class="num time">Volume</th></tr></thead>
        <tbody>${d.rows.map((r) => `<tr>
          <th scope="row" class="name">${esc(r.d)}</th>
          <td class="num chg">${fmtNum(r.o, dec)}</td>
          <td class="num chg">${fmtNum(r.h, dec)}</td>
          <td class="num chg">${fmtNum(r.l, dec)}</td>
          <td class="num last">${fmtNum(r.c, dec)}</td>
          <td class="num ${dirOf(r.chg)}">${r.chg === null ? '--' : fmtPct(r.chg)}</td>
          <td class="num time dim">${esc(fmtVol(r.v))}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    body.querySelector('#hist-csv').addEventListener('click', () => {
      if (csvUrl) URL.revokeObjectURL(csvUrl);
      csvUrl = URL.createObjectURL(new Blob([toCsv(d.ticker, d.rows)], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = csvUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      ctx.status(`SAVED ${name}`);
    });
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<div class="pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO HISTORY FOR ${ticker}` : 'HISTORY: NO DATA', 'warn');
  });
}
