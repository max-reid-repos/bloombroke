// COMPARE: % performance of 2 to 5 tickers over one range, all starting at 0%.

import { esc, q, fmtPct, dirOf, panel, LOADING } from './markets.js';
import { fmtXForSpan, fmtHoverForBar } from './chart.js';
import { mountLines } from './lines.js';
import { toolbar, rangePills } from '../kit.js';
import { stockIdOf } from '../known-tickers.js';
import { COMPARE_RANGES as RANGES, MAX_TICKERS, parseCompare as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { RANGES, MAX_TICKERS, parse };

const TICKER = /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

export const compareCmd = (tickers, range) => `COMPARE ${tickers.join(' ')} ${range}`;

// The command after adding a ticker, or null when it cannot be added.
export function addTicker(tickers, range, raw) {
  const typed = String(raw || '').trim().toUpperCase();
  const t = stockIdOf(typed) || typed; // $GOLD: the stock
  if (!TICKER.test(t) || tickers.includes(t) || tickers.length >= MAX_TICKERS) return null;
  return compareCmd([...tickers, t], range);
}

// One chip per ticker; each removes its ticker while at least 2 stay. Then an add field.
export function tickerChips(tickers, range) {
  const chips = tickers.map((t, i) => {
    const label = `<span class="sw ln-${i}" aria-hidden="true"></span>${esc(t)}`;
    if (tickers.length <= 2) return `<span class="chip cp-chip is-fixed">${label}</span>`;
    const c = compareCmd(tickers.filter((x) => x !== t), range);
    return `<a class="chip cp-chip" href="${esc(q(c))}" data-cmd="${esc(c)}" title="Remove ${esc(t)}" aria-label="Remove ${esc(t)}">${label}<span class="cp-x" aria-hidden="true">×</span></a>`;
  }).join('');
  const add = tickers.length < MAX_TICKERS
    ? `<form class="cp-add" autocomplete="off"><input class="field-input" name="t" type="text" maxlength="8" spellcheck="false" autocapitalize="characters" autocorrect="off" placeholder="ADD TICKER" aria-label="Add a ticker"><button type="submit" class="chip">ADD</button></form>`
    : '<span class="dim cp-full">5 IS THE MOST</span>';
  return `<div class="cp-chips">${chips}${add}</div>`;
}

function legendHtml(series, values) {
  return `<ul class="legend">${series.map((s, i) => {
    const v = values ? values[i] : s.changePct;
    return `<li><span class="sw ln-${i}" aria-hidden="true"></span><a class="lg-tk" href="${esc(q(s.ticker))}" data-cmd="${esc(s.ticker)}">${esc(s.ticker)}</a> <span class="dim lg-name">${esc(s.name)}</span> <span class="num ${dirOf(v)}">${fmtPct(v)}</span></li>`;
  }).join('')}</ul>`;
}

export function usageHtml() {
  const ex = ['COMPARE AAPL MSFT NVDA', 'COMPARE SPY QQQ 5Y', 'COMPARE KO PEP 6M'];
  return `<p class="notice">COMPARE needs 2 to 5 tickers.</p>
    <p class="muted">Format: <span class="code">COMPARE &lt;ticker&gt; &lt;ticker&gt; [&lt;range&gt;]</span></p>
    <p class="muted examples">Try ${ex.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`;
}

// How to read the lines: price change only, no dividends.
const PRICE_ONLY = 'PRICE CHANGE ONLY, NO DIVIDENDS';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Compare', usageHtml(), { cls: 'panel-solo' });
    ctx.status('COMPARE: CHECK THE FORMAT', 'warn');
    return;
  }
  const { tickers, range } = cmd.args;
  const body = toolbar({ left: tickerChips(tickers, range), label: 'Tickers' })
    + `<div class="ch-bar cp-bar">${rangePills(range, (r) => compareCmd(tickers, r), RANGES)}</div>`
    + `<div class="chart-host chart-host-lg" id="cp-chart">${LOADING}</div><div id="cp-legend"></div>`;
  el.innerHTML = panel('1', `Compare ${range}`, body, { cls: 'panel-solo', metaId: 'cp-meta', meta: PRICE_ONLY, bodyCls: 'flush' });
  const host = el.querySelector('#cp-chart');
  const leg = el.querySelector('#cp-legend');
  const meta = el.querySelector('#cp-meta');
  let cleanup = null;
  ctx.onCleanup(() => cleanup?.());

  el.querySelector('.cp-add')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.currentTarget.elements.t;
    const next = addTicker(tickers, range, input.value);
    if (next) ctx.run(next);
    else { input.select(); ctx.status(tickers.length >= MAX_TICKERS ? 'COMPARE: 5 TICKERS IS THE MOST' : 'COMPARE: TYPE A NEW TICKER, LIKE AMZN', 'warn'); }
  });

  async function load() {
    try {
      const d = await ctx.fetchJSON(`/api/compare?s=${encodeURIComponent(tickers.join(','))}&r=${range}`, { signal: ctx.signal });
      const series = d.series.map((s, i) => ({ id: s.ticker, cls: `ln-${i}`, label: s.ticker, points: s.points.map((p) => ({ x: p.t, y: p.p })) }));
      const all = d.series.flatMap((x) => x.points.map((p) => p.t));
      const span = all.length ? Math.max(...all) - Math.min(...all) : 0;
      const hover = fmtHoverForBar('1D');
      const base = PRICE_ONLY;
      meta.innerHTML = base;
      leg.innerHTML = legendHtml(d.series);
      cleanup?.();
      host.textContent = '';
      cleanup = mountLines(host, series, {
        fmtY: (v) => fmtPct(v), fmtTick: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`, fmtX: fmtXForSpan(span), zero: true, label: `${tickers.join(', ')} % change, ${range}`,
        onHover(h) {
          if (!h) { meta.innerHTML = base; leg.innerHTML = legendHtml(d.series); return; }
          meta.innerHTML = `<span class="num">${esc(hover(h.x))}</span>`;
          leg.innerHTML = legendHtml(d.series, h.values.map((v) => v.y));
        },
      });
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status(err.status === 404 ? 'COMPARE: UNKNOWN TICKER' : 'COULD NOT LOAD COMPARE', 'warn');
    }
  }

  load();
  ctx.every(load, 15 * 60_000);
}
