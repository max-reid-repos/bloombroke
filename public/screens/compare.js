// COMPARE: % performance of 2 to 5 tickers over one range, all starting at 0%.

import { esc, q, fmtPct, dirOf, panel, LOADING } from './markets.js';
import { fmtXFor, fmtHoverFor } from './quote.js';
import { mountLines } from './lines.js';

export const RANGES = ['1M', '6M', '1Y', '5Y'];
const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// COMPARE AAPL MSFT NVDA [1Y]
export function parse(args) {
  const toks = args.flatMap((t) => t.split(',')).filter((t) => t && t !== 'VS' && t !== 'AND');
  let range = '1Y';
  if (toks.length && RANGES.includes(toks[toks.length - 1])) range = toks.pop();
  const tickers = [...new Set(toks)];
  if (tickers.length < 2 || tickers.length > 5 || !tickers.every((t) => TICKER.test(t))) return { error: 'usage' };
  return { tickers, range };
}

function tabs(tickers, active) {
  return `<nav class="tabs" aria-label="Range">${RANGES.map((r) => {
    const c = `COMPARE ${tickers.join(' ')} ${r}`;
    return `<a class="tab${r === active ? ' is-active' : ''}" href="${esc(q(c))}" data-cmd="${esc(c)}"${r === active ? ' aria-current="true"' : ''}>${r}</a>`;
  }).join('')}</nav>`;
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
    <p class="muted">Format: <span class="code">COMPARE &lt;ticker&gt; &lt;ticker&gt; [1M|6M|1Y|5Y]</span></p>
    <p class="muted examples">Try ${ex.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Compare', usageHtml(), { cls: 'panel-solo' });
    ctx.status('COMPARE: CHECK THE FORMAT', 'warn');
    return;
  }
  const { tickers, range } = cmd.args;
  el.innerHTML = panel('1', `Compare ${range}`, `<div class="chart-host chart-host-lg" id="cp-chart">${LOADING}</div><div id="cp-legend"></div>`, { cls: 'panel-solo', meta: tabs(tickers, range), bodyCls: 'flush' })
    + '<p class="footnote">Price change from the first day of the range, dividends left out. Prices from CNBC, may be delayed. Not financial advice.</p>';
  const host = el.querySelector('#cp-chart');
  const leg = el.querySelector('#cp-legend');
  const meta = el.querySelector('.panel-meta');
  let cleanup = null;
  ctx.onCleanup(() => cleanup?.());

  async function load() {
    try {
      const d = await ctx.fetchJSON(`/api/compare?s=${encodeURIComponent(tickers.join(','))}&r=${range}`, { signal: ctx.signal });
      const series = d.series.map((s, i) => ({ id: s.ticker, cls: `ln-${i}`, label: s.ticker, points: s.points.map((p) => ({ x: p.t, y: p.p })) }));
      const hover = fmtHoverFor(range);
      const base = tabs(tickers, range);
      leg.innerHTML = legendHtml(d.series);
      cleanup?.();
      host.textContent = '';
      cleanup = mountLines(host, series, {
        fmtY: (v) => fmtPct(v), fmtTick: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`, fmtX: fmtXFor(range), zero: true, label: `${tickers.join(', ')} % change, ${range}`,
        onHover(h) {
          if (!h) { meta.innerHTML = base; leg.innerHTML = legendHtml(d.series); return; }
          meta.innerHTML = `<span class="num">${esc(hover(h.x))}</span>${base}`;
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
