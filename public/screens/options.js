// OPTIONS: the option chain for one stock, ETF or index. Calls on the left, puts on the
// right, strikes near the price in the middle. Cboe delayed quotes, 15 minutes.
//   OPTIONS AAPL              nearest expiry
//   OPTIONS AAPL 2026-10-16   one expiry (the tabs list them all)

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, fmtAsOf, panel, metaNote, LOADING } from './markets.js';
import { edgeFade } from '../kit.js';
import { OPTION_TICKER_RE, OPTION_INDEXES, parseOptions as parse, optionsToInput as toInput } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { OPTION_TICKER_RE, OPTION_INDEXES, parse, toInput };

// Strikes shown either side of the price before ALL STRIKES.
export const NEAR = 12;

// "DELAYED 15 MIN · FILE 12:49 ET": when the underlying price is from.
export function underlyingAsOf(asOf) {
  return `DELAYED 15 MIN${asOf ? ` · FILE ${fmtAsOf(asOf)} ET` : ''}`;
}

// In the money: a call below the price, a put above it.
export function inTheMoney(type, strike, price) {
  if (!Number.isFinite(price) || !Number.isFinite(strike)) return false;
  return type === 'call' ? strike < price : strike > price;
}

// The strikes to show: `near` either side of the price (all of them when near is 0).
// Returns { rows, priceAt } where priceAt is the index the price line goes before.
export function chainWindow(rows, price, near = NEAR) {
  let at = Number.isFinite(price) ? rows.findIndex((r) => r.strike >= price) : -1;
  if (at < 0) at = Number.isFinite(price) ? rows.length : Math.floor(rows.length / 2);
  if (!near) return { rows, priceAt: at };
  const start = Math.max(0, at - near);
  const end = Math.min(rows.length, at + near);
  return { rows: rows.slice(start, end), priceAt: at - start };
}

// Cboe implied vol is a fraction (0.23 = 23%).
export function fmtIv(iv) {
  return Number.isFinite(iv) && iv > 0 ? `${fmtNum(iv * 100, 1)}%` : '--';
}

const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '--');
const fmtDelta = (n) => (Number.isFinite(n) ? fmtSigned(n, 2) : '--');
const fmtPx = (n) => (Number.isFinite(n) ? fmtNum(n, 2) : '--');
const fmtStrike = (n) => fmtNum(n, Number.isInteger(n) ? 0 : n * 10 === Math.round(n * 10) ? 1 : 2);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// "2026-10-16" -> "OCT 16", or "JAN 15 '27" in another year.
export function expiryLabel(e, thisYear = new Date().getUTCFullYear()) {
  const [y, m, d] = e.date.split('-').map(Number);
  const base = `${MONTHS[m - 1]} ${d}${y !== thisYear ? ` '${String(y).slice(2)}` : ''}`;
  return e.id !== e.date ? `${base} ${e.root}` : base;
}

// Mirror image: the columns next to the strike are the bids and asks, and both sides read
// BID then ASK from left to right.
const PUT_COLS = [
  ['bid', 'Bid', fmtPx, ''], ['ask', 'Ask', fmtPx, ''], ['last', 'Last', fmtPx, 'oc-x'], ['volume', 'Vol', fmtInt, 'oc-x'],
  ['oi', 'Open int', fmtInt, 'oc-x'], ['iv', 'IV', fmtIv, 'oc-x'], ['delta', 'Delta', fmtDelta, 'oc-x'],
];
export const CALL_COLS = [...PUT_COLS.slice(2).reverse(), PUT_COLS[0], PUT_COLS[1]];
export { PUT_COLS };

function sideCells(s, cols, itm) {
  return cols.map(([k, , f, cls]) => `<td class="num ${cls}${itm ? ' itm' : ''}">${esc(s ? f(s[k]) : '--')}</td>`).join('');
}

export function chainTable(rows, price, ticker, near = NEAR) {
  const w = chainWindow(rows, price, near);
  const n = PUT_COLS.length * 2 + 1;
  const priceRow = Number.isFinite(price) ? `<tr class="oc-price"><td colspan="${n}"><span>${esc(ticker)} ${esc(fmtNum(price, 2))}</span></td></tr>` : '';
  const body = w.rows.map((r, i) => `${i === w.priceAt ? priceRow : ''}<tr>
    ${sideCells(r.call, CALL_COLS, inTheMoney('call', r.strike, price))}
    <th scope="row" class="num oc-strike">${esc(fmtStrike(r.strike))}</th>
    ${sideCells(r.put, PUT_COLS, inTheMoney('put', r.strike, price))}
  </tr>`).join('') + (w.priceAt >= w.rows.length ? priceRow : '');
  const head = (cols) => cols.map(([, l, , cls]) => `<th scope="col" class="num ${cls}">${esc(l)}</th>`).join('');
  return `<div class="oc-wrap"><table class="grid-table oc">
    <thead>
      <tr class="oc-sides"><td colspan="${CALL_COLS.length - 2}" class="oc-x"></td><th scope="colgroup" colspan="2" class="oc-side">Calls</th><th scope="col" class="num oc-strike">Strike</th><th scope="colgroup" colspan="2" class="oc-side oc-side-put">Puts</th><td colspan="${PUT_COLS.length - 2}" class="oc-x"></td></tr>
      <tr>${head(CALL_COLS)}<th scope="col" class="num oc-strike"><span class="offscreen">Strike</span></th>${head(PUT_COLS)}</tr>
    </thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

const EXAMPLES = ['OPTIONS AAPL', 'OPTIONS SPY', 'OPTIONS TSLA'];
const links = (list) => list.map((c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`).join(' ');
const ERRORS = {
  usage: 'OPTIONS needs a ticker.',
  kind: 'Options here cover US stocks and ETFs, and the SPX, NDX, RUT and VIX indexes.',
  expiry: 'That expiry does not look right. Dates look like 2026-10-16, or pick one from the tabs.',
};

export function render(el, cmd, ctx) {
  const args = cmd.args;
  if (args.error) {
    el.innerHTML = panel('1', 'Options', `
      <p class="notice">${esc(ERRORS[args.error] || ERRORS.usage)}</p>
      <p class="muted">Format: <span class="code">OPTIONS &lt;ticker&gt; [expiry]</span></p>
      <p class="muted examples">Try ${links(args.ticker && args.error === 'expiry' ? [`OPTIONS ${args.ticker}`] : EXAMPLES)}</p>`, { cls: 'panel-solo' });
    ctx.status('OPTIONS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `${ticker} options`, `<div class="oc-top" id="oc-top">${LOADING}</div><div id="oc-tabs"></div><div id="oc-chain"></div>`, { metaId: 'oc-meta', bodyCls: 'flush', meta: `${metaNote('SHADED = IN THE MONEY', 'IV = implied volatility')} · <span class="fresh is-dly" title="Delayed: about 15 min">DLY</span> 15 MIN` })}
  </div>`;
  const top = el.querySelector('#oc-top');
  const tabs = el.querySelector('#oc-tabs');
  const chain = el.querySelector('#oc-chain');
  let all = false;
  let data = null;
  let stopFade = null;
  ctx.onCleanup(() => stopFade?.());

  function paint() {
    const d = data;
    const u = d.underlying;
    const dir = dirOf(u.change);
    // Cboe's underlying price is delayed 15 minutes like the chain; its file time is
    // when Cboe wrote the file, so the price is from about 15 minutes before it.
    top.innerHTML = `<span class="oc-px num">${esc(fmtNum(u.price, 2))}</span>
      <span class="num ${dir}">${esc(fmtSigned(u.change, 2))} ${esc(fmtPct(u.changePct))}</span>
      <span class="oc-kv dim">${esc(underlyingAsOf(d.asOf))}</span>
      <span class="oc-kv"><span class="dim">IV30</span> <span class="num">${esc(Number.isFinite(u.iv30) ? `${fmtNum(u.iv30, 2)}%` : '--')}</span></span>
      <span class="oc-kv"><span class="dim">EXPIRES</span> <span class="num">${esc(d.expiry.date)}</span> <span class="dim">${esc(Number.isFinite(d.expiry.days) ? `${d.expiry.days} ${d.expiry.days === 1 ? 'DAY' : 'DAYS'}` : '')}</span></span>
      <button type="button" class="btn oc-all" aria-pressed="${all}">${all ? 'NEAR THE PRICE' : `ALL ${d.rows.length} STRIKES`}</button>`;
    const thisYear = Number((d.asOf || d.updated || '').slice(0, 4)) || new Date().getUTCFullYear();
    tabs.innerHTML = `<div class="ch-bar"><nav class="tabs ch-tabs oc-exp" aria-label="Expiry">${d.expiries.map((e) => {
      const on = e.id === d.expiry.id;
      const c = `OPTIONS ${ticker} ${e.id}`;
      return `<a class="tab${on ? ' is-active' : ''}" href="${esc(q(c))}" data-cmd="${esc(c)}"${on ? ' aria-current="page"' : ''}>${esc(expiryLabel(e, thisYear))}</a>`;
    }).join('')}</nav></div>`;
    const active = tabs.querySelector('.tab.is-active');
    const nav = tabs.querySelector('nav');
    if (active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    // The expiry strip scrolls sideways; its edges fade where there is more.
    stopFade?.();
    stopFade = edgeFade(nav);
    chain.innerHTML = d.rows.length ? chainTable(d.rows, u.price, ticker, all ? 0 : NEAR) : '<p class="panel-msg">No strikes for this expiry.</p>';
  }

  top.addEventListener('click', (e) => {
    if (!e.target.closest('.oc-all') || !data) return;
    all = !all;
    paint();
  });

  async function load() {
    try {
      const url = `/api/options?s=${encodeURIComponent(ticker)}${args.expiry ? `&e=${encodeURIComponent(args.expiry)}` : ''}`;
      data = await ctx.fetchJSON(url, { signal: ctx.signal });
      paint();
      ctx.updated(data.asOf || data.updated, data.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!data) {
        top.innerHTML = `<p class="panel-msg">${esc(err.message)}</p><p class="muted examples">Try ${links(err.code === 'no_expiry' ? [`OPTIONS ${ticker}`] : EXAMPLES)}</p>`;
        ctx.status(err.status === 404 ? `OPTIONS ${ticker}: NOT FOUND` : 'OPTIONS: NO DATA', 'warn');
      } else {
        ctx.status('COULD NOT REFRESH OPTIONS', 'warn');
      }
    }
  }

  load();
  ctx.live(load, 60_000);
}
