// FILINGS <ticker> [10-K|10-Q|8-K|4|ALL]: the company's latest SEC filings, newest first,
// each linking to the document on sec.gov.

import { esc, q, panel, LOADING } from './markets.js';
import { mountFnBar, sourceLine, errorHtml, fmtInt, dash } from './company-kit.js';

const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
export const FORMS = ['ALL', '10-K', '10-Q', '8-K', '4'];
const FORM_ALIASES = { '10K': '10-K', '10Q': '10-Q', '8K': '8-K', FORM4: '4', ANNUAL: '10-K', QUARTERLY: '10-Q', INSIDER: '4' };

// FILINGS <ticker> [form]
export function parse(args) {
  if (!args.length || args.length > 2 || !TICKER.test(args[0])) return { error: 'usage' };
  const form = args[1] ? (FORM_ALIASES[args[1]] || args[1]) : 'ALL';
  if (!FORMS.includes(form)) return { error: 'usage' };
  return { ticker: args[0], form };
}

export function inputOf(args) {
  return ['FILINGS', args.ticker, ...(args.form && args.form !== 'ALL' ? [args.form] : [])].join(' ');
}

export function chips(ticker, current, counts = null) {
  return `<nav class="co-chips" aria-label="Filing type">${FORMS.map((f) => {
    const c = inputOf({ ticker, form: f });
    const on = f === current;
    const n = counts && Number.isFinite(counts[f]) ? `<span class="co-count">${counts[f]}</span>` : '';
    return `<a class="co-chip${on ? ' is-active' : ''}" href="${esc(q(c))}" data-cmd="${esc(c)}"${on ? ' aria-current="true"' : ''}>${f === '4' ? 'FORM 4' : f}${n}</a>`;
  }).join('')}</nav>`;
}

export function filingsTable(rows) {
  if (!rows.length) return '<p class="panel-msg">No filings of this type in the recent list.</p>';
  return `<table class="grid-table co-table fil-table">
    <thead><tr><th scope="col" class="num co-n">#</th><th scope="col" class="co-date">Filed</th><th scope="col" class="co-form">Form</th><th scope="col">Description</th><th scope="col" class="num time">Period</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td class="num co-n dim">${i + 1}</td>
      <td class="co-date num">${esc(r.filed)}</td>
      <td class="co-form last">${esc(r.form)}</td>
      <th scope="row" class="name">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.description || r.form)}</a>` : esc(r.description || r.form)}</th>
      <td class="num time dim">${esc(r.period || dash)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

const USAGE_EX = ['FILINGS AAPL', 'FILINGS MSFT 10-K', 'FILINGS TSLA 8-K', 'FILINGS NVDA 4'];

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Filings', `<p class="notice">FILINGS needs one ticker, then a form if you want one.</p>
      <p class="muted">Format: <span class="code">FILINGS &lt;ticker&gt; [10-K|10-Q|8-K|4]</span></p>
      <p class="muted examples">Try ${USAGE_EX.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`, { cls: 'panel-solo' });
    ctx.status('FILINGS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker, form } = cmd.args;
  el.innerHTML = `${panel('1', `${ticker} SEC filings`, `${chips(ticker, form)}<div class="fil-body">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'fil-meta', bodyCls: 'flush' })}
  <div id="fil-foot">${sourceLine('SEC EDGAR filing index')}</div>`;
  mountFnBar(el, ctx, ticker, 'FILINGS');
  const body = el.querySelector('.fil-body');

  const params = new URLSearchParams({ s: ticker, f: form });
  ctx.fetchJSON(`/api/filings?${params}`, { signal: ctx.signal }).then((d) => {
    el.querySelector('.co-chips').outerHTML = chips(ticker, form, d.counts);
    el.querySelector('#fil-meta').textContent = `${fmtInt(d.matched)} FILINGS`;
    const more = d.matched > d.rows.length ? `<p class="more muted co-pad">Showing the newest ${d.rows.length} of ${fmtInt(d.matched)}. Every filing: <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=${esc(String(d.cik))}" target="_blank" rel="noopener noreferrer">sec.gov</a></p>` : '';
    body.innerHTML = filingsTable(d.rows) + more;
    el.querySelector('#fil-foot').innerHTML = sourceLine(d.source, `${d.name || ticker}, CIK ${d.cik}. Links open the document on sec.gov. Descriptions are the form's plain-English name.`);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO SEC FILINGS FOR ${ticker}` : 'FILINGS: NO DATA', 'warn');
  });
}
