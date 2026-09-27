// FILINGS <ticker> [KEY|10-K|10-Q|8-K|4|ALL]: the company's latest SEC filings, newest
// first, each linking to the document on sec.gov. KEY (reports, proxies, registrations,
// no ownership paperwork) is the default.

import { esc, q, panel, LOADING } from './markets.js';
import { metaNote, errorHtml, fmtInt, fmtDay, dash } from './company-kit.js';
import { toolbar, panelTools, dataTable, sortRows, nextSort, edgeFade } from '../kit.js';
import { sessionHtml } from '../provenance.js';

// EDGAR's acceptance time in New York, for the PRE/MKT/AH/WKD tag's tooltip.
export function acceptedEt(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? `${new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })} ET` : '';
}

const TICKER = /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
// KEY (the default) leaves out ownership paperwork: insider Forms 3, 4, 5 and 144 and 5%
// holder schedules, which are most of a big company's list.
export const FORMS = ['KEY', '10-K', '10-Q', '8-K', '4', 'ALL'];
const FORM_ALIASES = { '10K': '10-K', '10Q': '10-Q', '8K': '8-K', FORM4: '4', ANNUAL: '10-K', QUARTERLY: '10-Q', INSIDER: '4', MAIN: 'KEY' };
const FORM_LABEL = { KEY: 'KEY FILINGS', 4: 'FORM 4' };

// FILINGS <ticker> [form]
export function parse(args) {
  if (!args.length || args.length > 2 || !TICKER.test(args[0])) return { error: 'usage' };
  const form = args[1] ? (FORM_ALIASES[args[1]] || args[1]) : 'KEY';
  if (!FORMS.includes(form)) return { error: 'usage' };
  return { ticker: args[0], form };
}

export function inputOf(args) {
  return ['FILINGS', args.ticker, ...(args.form && args.form !== 'KEY' ? [args.form] : [])].join(' ');
}

// The filter row: one segmented set, each with its count once the list is in.
export function chips(ticker, current, counts = null) {
  return `<nav class="seg fil-seg" aria-label="Filing type">${FORMS.map((f) => {
    const c = inputOf({ ticker, form: f });
    const on = f === current;
    const n = counts && Number.isFinite(counts[f]) ? ` <span class="seg-n">${fmtInt(counts[f])}</span>` : '';
    return `<a class="seg-item${on ? ' is-active' : ''}" href="${esc(q(c))}" data-cmd="${esc(c)}"${on ? ' aria-current="true"' : ''}>${esc(FORM_LABEL[f] || f)}${n}</a>`;
  }).join('')}</nav>`;
}

const COLUMNS = [
  { key: 'filed', label: 'Filed', cls: 'date', fmt: (v, r) => `${esc(fmtDay(v))}${sessionHtml(r.session, acceptedEt(r.accepted))}` },
  { key: 'form', label: 'Form', cls: 'co-form' },
  {
    key: 'description', label: 'Description', name: true, cls: 'wide-name',
    fmt: (v, r) => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" title="${esc(v || r.form)}">${esc(v || r.form)}</a>` : esc(v || r.form)),
  },
  { key: 'period', label: 'Period', cls: 'dim hide-m', fmt: (v) => esc(v ? fmtDay(v) : dash) },
];

export function filingsTable(rows, sort = { key: 'filed', dir: 'desc' }) {
  if (!rows.length) return '<p class="panel-msg">No filings of this type in the recent list.</p>';
  return dataTable({ columns: COLUMNS, rows: sortRows(rows, sort.key, sort.dir), sort, caption: 'SEC filings' });
}

const USAGE_EX = ['FILINGS AAPL', 'FILINGS MSFT 10-K', 'FILINGS TSLA 8-K', 'FILINGS NVDA 4'];

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Filings', `<p class="notice">FILINGS needs one ticker, then a form if you want one.</p>
      <p class="muted">Format: <span class="code">FILINGS &lt;ticker&gt; [10-K|10-Q|8-K|4|ALL]</span></p>
      <p class="muted examples">Try ${USAGE_EX.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`, { cls: 'panel-solo' });
    ctx.status('FILINGS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker, form } = cmd.args;
  el.innerHTML = `${panel('1', `${ticker} SEC filings`, `${toolbar({ left: chips(ticker, form), label: 'Filing type' })}<div class="fil-body co-wide">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'fil-meta', bodyCls: 'flush' })}`;
  const body = el.querySelector('.fil-body');

  const params = new URLSearchParams({ s: ticker, f: form });
  ctx.fetchJSON(`/api/filings?${params}`, { signal: ctx.signal }).then((d) => {
    el.querySelector('.fil-seg').outerHTML = chips(ticker, form, d.counts);
    ctx.onCleanup(edgeFade(el.querySelector('.fil-seg')));
    el.querySelector('#fil-meta').innerHTML = `${panelTools({ shown: d.rows.length, total: d.matched })}${d.cik ? ` · ${metaNote(`CIK ${d.cik}`, d.name || ticker)}` : ''}`;
    const more = d.matched > d.rows.length ? `<p class="more muted co-pad">The newest ${d.rows.length} of ${fmtInt(d.matched)}. Every filing: <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=${esc(String(d.cik))}" target="_blank" rel="noopener noreferrer">sec.gov</a></p>` : '';
    let sort = { key: 'filed', dir: 'desc' };
    const draw = () => { body.innerHTML = filingsTable(d.rows, sort) + more; };
    body.addEventListener('click', (e) => {
      const th = e.target.closest('.th-sort');
      if (!th) return;
      const col = COLUMNS.find((c) => c.key === th.dataset.sort);
      sort = nextSort(sort, col.key, false);
      draw();
      body.querySelector(`.th-sort[data-sort="${col.key}"]`)?.focus();
    });
    draw();
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO SEC FILINGS FOR ${ticker}` : 'FILINGS: NO DATA', 'warn');
  });
}
