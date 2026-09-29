// QUOTE: the instrument screen, for every kind: stocks, indexes, FX pairs, futures,
// crypto and Treasury yields. Name, last price, change, the fields that make sense
// for the kind, the last trade time (real time or delayed) and a range chart.

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, fmtAsOf, panel, LOADING, tick, settleTicks } from './markets.js';
import { rangeChart, priceDecimals } from './chart.js';
import { freshTag, lastTradeLine } from '../freshness.js';
import { rangeLabel } from '../ranges.js';
import { instrumentById } from '../instruments.js';
import { usageCard } from '../kit.js';

// The line chart moved to chart.js; these re-exports keep old imports working.
export { niceTicks, chartSvg, mountChart, fmtXFor, fmtHoverFor, priceDecimals } from './chart.js';

// ---- Screen --------------------------------------------------------------------

export function rangeBar(lo, hi, last) {
  if (![lo, hi, last].every(Number.isFinite) || hi <= lo) return '';
  const pos = Math.max(0, Math.min(1, (last - lo) / (hi - lo))) * 100;
  return `<svg class="rangebar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="rb-track" x="0" y="2" width="100" height="2"/><rect class="rb-mark" x="${Math.max(0, pos - 1).toFixed(1)}" y="0" width="2" height="6"/></svg>`;
}

export function decimalsOf(d) {
  return Number.isFinite(d.decimals) ? d.decimals : priceDecimals(d.last);
}

const isYield = (d) => d.kind === 'yield';
const isStock = (d) => d.kind === 'stock' || d.kind === 'etf';

// Rows for the key numbers panel, by kind. No P/E for an index, no market cap for gold.
export function statRows(d) {
  const dec = decimalsOf(d);
  const f = (v) => (Number.isFinite(v) ? (isYield(d) ? `${fmtNum(v, dec)}%` : fmtNum(v, dec)) : '--');
  const range = (lo, hi) => (Number.isFinite(lo) && Number.isFinite(hi) ? `${f(lo)} - ${f(hi)}` : '--');
  // The 52-week range: from daily closes when the source rounds it, else the source's
  // own values at the decimals it gave (never padded with zeros it did not send).
  const r52dec = d.range52Basis !== 'daily closes' && Number.isInteger(d.range52Dp) && d.range52Dp < dec ? d.range52Dp : dec;
  const f52 = (v) => (Number.isFinite(v) ? (isYield(d) ? `${fmtNum(v, r52dec)}%` : fmtNum(v, r52dec)) : '--');
  const range52 = Number.isFinite(d.low52) && Number.isFinite(d.high52) ? `${f52(d.low52)} - ${f52(d.high52)}` : '--';
  const label52 = d.range52Basis === 'daily closes' ? '52W range (closes)' : r52dec < dec ? '52W range (rounded)' : '52W range';
  const rows = [];
  if (isStock(d)) {
    rows.push(['Mkt cap', d.marketCap || '--']);
    rows.push([label52, range52, rangeBar(d.low52, d.high52, d.last)]);
    rows.push(['P/E', Number.isFinite(d.pe) ? fmtNum(d.pe, 2) : '--']);
    if (Number.isFinite(d.eps)) rows.push(['EPS', fmtNum(d.eps, 2)]);
    if (d.divYield) rows.push(['Div yield', d.divYield]);
    if (d.volume) rows.push(['Volume', d.volume]);
  } else {
    if (Number.isFinite(d.open)) rows.push(['Open', f(d.open)]);
    if (Number.isFinite(d.low) && Number.isFinite(d.high)) rows.push(['Day range', range(d.low, d.high), rangeBar(d.low, d.high, d.last)]);
    rows.push([label52, range52, rangeBar(d.low52, d.high52, d.last)]);
    if (d.kind === 'future' && d.volume) rows.push(['Volume', d.volume]);
  }
  if (Number.isFinite(d.prevClose)) rows.push(['Prev close', f(d.prevClose)]);
  return rows;
}

// The key ranges as one line for a panel (a DESK panel, embed mode), where the stats
// grid's narrow Day range and 52W cells stacked "15.73 -" over "16.19": "day 15.73 to
// 16.19 · 52w 13.38 to 35.30". It stands in for those two cells only (the rest of the
// grid stays). Each part stays whole; a very narrow panel wraps between the parts only.
export function rangeLine(d) {
  const dec = decimalsOf(d);
  const r52dec = d.range52Basis !== 'daily closes' && Number.isInteger(d.range52Dp) && d.range52Dp < dec ? d.range52Dp : dec;
  const f = (v, k) => (isYield(d) ? `${fmtNum(v, k)}%` : fmtNum(v, k));
  const parts = [];
  if (Number.isFinite(d.low) && Number.isFinite(d.high)) parts.push(['day', `${f(d.low, dec)} to ${f(d.high, dec)}`]);
  // The same qualifier as the grid's 52W label: from daily closes, or the source's rounding.
  const k52 = d.range52Basis === 'daily closes' ? '52w (closes)' : r52dec < dec ? '52w (rounded)' : '52w';
  if (Number.isFinite(d.low52) && Number.isFinite(d.high52)) parts.push([k52, `${f(d.low52, r52dec)} to ${f(d.high52, r52dec)}`]);
  if (!parts.length) return '';
  return `<p class="q-ranges num">${parts.map(([k, v]) => `<span class="q-rg"><span class="dim">${k}</span> ${esc(v)}</span>`).join('<span class="q-rg-sep dim" aria-hidden="true"> · </span>')}</p>`;
}

// A stats label that has a WHATIS card links to it (the definitions load only then).
export const STAT_TERMS = { 'Mkt cap': 'MKT CAP', 'P/E': 'P/E', EPS: 'EPS', 'Div yield': 'DIV YIELD', Volume: 'VOLUME', 'Prev close': 'PREV CLOSE' };
export function statLabel(k) {
  const term = STAT_TERMS[k] || (k.startsWith('52W') ? '52W RANGE' : '');
  if (!term) return esc(k);
  const cmd = `WHATIS ${term}`;
  return `<a class="stat-what" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" title="${esc(`${cmd}: what it means`)}">${esc(k)}</a>`;
}

function statsHtml(d) {
  // stat-range: the Day range and 52W cells, which a panel shows as rangeLine instead.
  const isRange = (k) => k === 'Day range' || k.startsWith('52W');
  return `<dl class="stats">${statRows(d).map(([k, v, extra]) => `<div class="stat${isRange(k) ? ' stat-range' : ''}"><dt>${statLabel(k)}</dt><dd class="num">${esc(v)}${extra || ''}</dd></div>`).join('')}</dl>`;
}

// "+1.9 bp" for yields, "+1.23 +0.37%" for everything else.
export function changeText(d) {
  if (isYield(d)) return Number.isFinite(d.change) ? `${fmtSigned(d.change * 100, 1)} bp` : '--';
  return `${fmtSigned(d.change, decimalsOf(d))} ${fmtPct(d.changePct)}`;
}

// What the change is over (rule A, kit.css): "today" when the last trade is from today
// on the instrument's own exchange (Tokyo for the Nikkei, London for the FTSE, New York
// for US stocks, FX and the rest), else the day it is from ("on Fri", "on Sep 12" when
// older than a week). Crypto's change is a rolling 24 hours: "24h".
const NY = 'America/New_York';
const SESSION_TZ = {
  FTSE: 'Europe/London', DAX: 'Europe/Berlin', STOXX50: 'Europe/Berlin', CAC40: 'Europe/Paris',
  N225: 'Asia/Tokyo', HSI: 'Asia/Hong_Kong', SHANGHAI: 'Asia/Shanghai', KOSPI: 'Asia/Seoul',
  NIFTY50: 'Asia/Kolkata', ASX200: 'Australia/Sydney', SET: 'Asia/Bangkok',
};
// A stock listed abroad, by its suffix (7203.T, 0700.HK, VOD.L).
const SUFFIX_TZ = {
  T: 'Asia/Tokyo', HK: 'Asia/Hong_Kong', SS: 'Asia/Shanghai', SZ: 'Asia/Shanghai', KS: 'Asia/Seoul', KQ: 'Asia/Seoul',
  NS: 'Asia/Kolkata', BO: 'Asia/Kolkata', AX: 'Australia/Sydney', BK: 'Asia/Bangkok', SI: 'Asia/Singapore', TW: 'Asia/Taipei',
  L: 'Europe/London', DE: 'Europe/Berlin', F: 'Europe/Berlin', PA: 'Europe/Paris', AS: 'Europe/Amsterdam', MI: 'Europe/Rome',
  MC: 'Europe/Madrid', SW: 'Europe/Zurich', ST: 'Europe/Stockholm', CO: 'Europe/Copenhagen', OL: 'Europe/Oslo', HE: 'Europe/Helsinki',
};
export function sessionTz(d) {
  const id = String(d?.ticker || '').toUpperCase();
  const suffix = /\.([A-Z]{1,2})$/.exec(id)?.[1];
  return SESSION_TZ[id] || (suffix && SUFFIX_TZ[suffix]) || NY;
}
export function changeWhen(d, now = new Date()) {
  if (d?.kind === 'crypto') return '24h';
  const tz = sessionTz(d);
  const dayIn = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
  const raw = String(d?.asOf || '');
  let day = raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return '';
    day = dayIn(t);
  }
  const today = dayIn(now);
  if (day === today) return 'today';
  const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000;
  const opts = days > 0 && days < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' };
  return `on ${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })}`;
}

// The name, once: "Gold COMEX (Dec'26)", not "Gold Gold COMEX (Dec'26)". A short label
// that the full name does not already start with stays in front of it.
export function titleHtml(d) {
  const name = String(d.name || '');
  const label = String(d.label || '');
  if (!label || label === name) return esc(name || label);
  if (!name || name.toLowerCase().startsWith(label.toLowerCase())) return esc(name || label);
  return `${esc(label)} <span class="dim">${esc(name)}</span>`;
}

// Pre-market or after-hours prices only while that session is the news: not during the
// regular session, and not once a newer regular trade has printed.
export function showExtended(d) {
  const x = d?.extended;
  if (!x || !Number.isFinite(x.last) || x.last === d.last) return false;
  if (d.marketState === 'REG_MKT') return false;
  const tx = Date.parse(x.asOf);
  const tl = Date.parse(d.asOf);
  if (Number.isFinite(tx) && Number.isFinite(tl) && tx <= tl) return false;
  return true;
}

export function quoteHtml(d) {
  const dec = decimalsOf(d);
  const dir = dirOf(isYield(d) ? Math.round(d.change * 1000) : d.change);
  const ext = showExtended(d)
    ? `<p class="q-ext"><span class="dim">${esc(d.extended.session)}</span> <span class="num">${fmtNum(d.extended.last, dec)}</span> <span class="num ${dirOf(d.extended.change)}">${fmtSigned(d.extended.change, dec)} ${fmtPct(d.extended.changePct)}</span> <span class="dim">${esc(fmtAsOf(d.extended.asOf))}</span></p>`
    : '';
  const title = titleHtml(d);
  const unit = isYield(d) ? '%' : d.kind === 'fx' || d.kind === 'index' ? '' : (d.currency || '');
  return `<div class="q-top">
    <div class="q-main">
      <p class="q-name">${title}</p>
      <p class="q-hero num"><span class="q-last${tick(`q:${d.ticker}:last`, d.last)}">${fmtNum(d.last, dec)}</span><span class="q-ccy">${esc(unit)}</span>${freshTag(d)}</p>
      <p class="q-chg num ${dir}">${esc(changeText(d))}${changeWhen(d) ? `<span class="q-chg-when dim">${esc(changeWhen(d))}</span>` : ''}</p>
      ${ext}
      <p class="q-asof dim">${lastTradeLine(d)}${d.stale ? ' (LAST KNOWN)' : ''}</p>
      ${rangeLine(d)}
    </div>
    ${statsHtml(d)}
  </div>`;
}

const KIND_META = { index: 'INDEX', future: 'FUTURES', spot: 'SPOT', fx: 'CURRENCY PAIR', crypto: 'CRYPTO', yield: 'YIELD' };

// "NASDAQ  USD  STOCK", "COMEX  USD  FUTURES". CNBC's "CEC:Commodities Exchange Centre"
// and its placeholder exchange "Exchange" are trimmed.
export function metaLine(d) {
  let ex = String(d.exchange || '').replace(/^[A-Z]+:/, '');
  if (/^Commodities Exchange Centre$/i.test(ex)) ex = 'COMEX';
  if (/^New York Mercantile Exchange$/i.test(ex)) ex = 'NYMEX';
  if (ex === 'Exchange' || ex.toUpperCase() === KIND_META[d.kind]) ex = '';
  return [ex, d.currency, KIND_META[d.kind] || d.type].filter(Boolean).join('  ');
}

// A range or dates typed wrong: the kit's usage card.
export function rangeUsage(ticker, error) {
  const [problem, ...rest] = String(RANGE_ERRORS[error] || RANGE_ERRORS.usage).split(/(?<=[.?]) /);
  return usageCard({ problem, format: `${ticker} [range | from to | FROM day]`, example: `${ticker} 5Y`, more: [`${ticker} 2020-01-01 2024-12-31`, `${ticker} FROM 2020-01-01`], notes: [rest.join(' ')] });
}
const RANGE_ERRORS = {
  date: 'That date does not exist. Dates look like 2020-01-31.',
  order: 'FROM has to be before TO.',
  future: 'FROM is in the future.',
  usage: 'Add a range like 5Y, or two dates.',
};

export function render(el, cmd, ctx) {
  const { ticker } = cmd.args;
  if (cmd.args.error) {
    el.innerHTML = panel('1', ticker, rangeUsage(ticker, cmd.args.error), { cls: 'panel-solo' });
    ctx.status(`${ticker}: CHECK THE DATES`, 'warn');
    return;
  }
  // A bar period from the command (AAPL 1Y WEEKLY) rides along to the chart.
  const bar = cmd.args.bar ? { bar: cmd.args.bar } : {};
  const range = cmd.args.from ? { from: cmd.args.from, to: cmd.args.to || null, ...bar } : { range: cmd.args.range || '1Y', ...bar };
  el.innerHTML = `<div class="stack">
    ${panel('1', ticker, LOADING, { metaId: 'q-meta' })}
    ${panel('2', `Chart ${rangeLabel(range)}`, '<div class="rc" id="q-rc"></div>', { metaId: 'q-ch-meta', bodyCls: 'flush' })}
  </div>`;
  const [qBody, cBody] = el.querySelectorAll('.panel-body');
  const qMeta = el.querySelector('#q-meta');
  // The watch star is the frame's, by the screen title, for stocks and named
  // instruments alike (app.js starTickerFor).
  let found = true;
  let last = null;

  const inst = instrumentById(ticker);
  const yieldChart = inst?.kind === 'yield';
  const chart = rangeChart(el.querySelector('#q-rc'), ctx, {
    symbol: ticker, range, compare: cmd.args.compare || [], meta: el.querySelector('#q-ch-meta'), hostCls: 'chart-host-lg', quote: 'external',
    navigate: (c) => ctx.run(c),
    label: `${inst?.name || ticker}${yieldChart ? '' : ' price'}`,
    ...(yieldChart ? { bp: true, decimals: 3, fmtY: (v) => `${fmtNum(v, 2)}%` } : inst ? { decimals: inst.decimals } : {}),
    onLoad: () => { if (last) { chart.setQuote(last); chart.setLive(liveOf(last)); } },
  });

  function liveOf(d) {
    const t = Date.parse(d.asOf);
    return Number.isFinite(t) && /T/.test(d.asOf || '') ? { t, v: d.last } : null;
  }

  async function loadQuote() {
    try {
      const d = await ctx.fetchJSON(`/api/quote?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal });
      last = d;
      qBody.innerHTML = quoteHtml(d);
      settleTicks(qBody);
      qMeta.textContent = metaLine(d);
      ctx.updated(d.updated, d.stale, [d]);
      chart.setQuote(d);
      chart.setLive(liveOf(d));
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.status === 404 || err.status === 400) {
        found = false;
        qBody.innerHTML = `<p class="notice">No ticker called ${esc(ticker)}.</p>
          <p class="muted">Check the spelling, or try <a class="code" href="${esc(q('AAPL'))}" data-cmd="AAPL">AAPL</a> <a class="code" href="${esc(q('GOLD'))}" data-cmd="GOLD">GOLD</a> <a class="code" href="${esc(q('EURUSD'))}" data-cmd="EURUSD">EURUSD</a>. Type <a class="code" href="${esc(q('HELP'))}" data-cmd="HELP">HELP</a> for every command.</p>`;
        cBody.closest('.panel').hidden = true;
        ctx.hideTickerStrip?.();
        ctx.status(`UNKNOWN TICKER ${ticker}`, 'warn');
        return;
      }
      if (!qBody.querySelector('.q-top')) qBody.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH QUOTE', 'warn');
    }
  }

  loadQuote();
  ctx.live(() => { if (found) loadQuote(); }, 15_000);
}
