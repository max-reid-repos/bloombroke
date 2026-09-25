// Shared bits for the company-data screens (INSIDERS, OWNERS, FILINGS, SHORTS, BEATS,
// VALUE, IPOS, SPLITS, EXDIV): the stock function bar, the source line, number formats.

import { esc, q, fmtNum } from './markets.js';
import { fmtCompact } from './movers.js';
import { fnBarHtml, syncStars } from './quote.js';
import { instrumentById } from '../instruments.js';
import { loadWatchlist, saveWatchlist, toggleId } from '../watchlist.js';

export { errorHtml, tickerUsage, parseTicker } from './profile.js';

// The stock function bar under the first panel head, with `current` lit, and the star.
export function mountFnBar(el, ctx, ticker, current) {
  if (instrumentById(ticker) || !ctx.tickerFunctions) return;
  const fns = ctx.tickerFunctions(ticker).map((f) => ({ ...f, current: f.fn === current }));
  const on = loadWatchlist(ctx.store).includes(ticker);
  el.querySelector('.panel-head')?.insertAdjacentHTML('afterend', fnBarHtml(ticker, fns, on));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-watch-toggle]');
    if (!b) return;
    e.stopPropagation();
    e.preventDefault();
    const list = toggleId(loadWatchlist(ctx.store), ticker);
    saveWatchlist(ctx.store, list);
    const now = list.includes(ticker);
    syncStars(el, ticker, now);
    ctx.status(now ? `${ticker} ADDED TO THE WATCHLIST` : `${ticker} REMOVED FROM THE WATCHLIST`);
  });
}

// Every screen says where its numbers come from.
export function sourceLine(source, extra = '') {
  return `<p class="footnote co-source">Source: ${esc(source)}.${extra ? ` ${esc(extra)}` : ''} Not financial advice.</p>`;
}

export const dash = '--';
export const fmtInt = (n) => (Number.isFinite(n) ? fmtNum(n, 0) : dash);
export const fmtBig = (n) => (Number.isFinite(n) ? fmtCompact(n) : dash);
export const fmtMoney = (n, d = 2) => (Number.isFinite(n) ? `$${fmtNum(n, d)}` : dash);
export const fmtBigMoney = (n) => (Number.isFinite(n) ? `$${fmtCompact(n)}` : dash);
export const fmtPlainPct = (n, d = 2) => (Number.isFinite(n) ? `${fmtNum(n, d)}%` : dash);

// "2026-09-15" -> "SEP 15, 2026"
export function fmtDay(d) {
  if (!d) return dash;
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
}

// "2026-09-15" -> "MON SEP 15"
export function fmtWeekday(d) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
}

// The first cell of a row with a ticker: the ticker and the company, linking to ?c=<TICKER>.
export function symbolCell(symbol, name) {
  // No ticker (yet): a -- where the ticker goes, so the name stays in the name spot.
  if (!symbol) return `<th scope="row" class="name" title="No ticker yet"><span class="tk dim">${dash}</span> <span class="tk-name co-noname">${esc(name || dash)}</span></th>`;
  return `<th scope="row" class="name"><a href="${esc(q(symbol))}" data-cmd="${esc(symbol)}" tabindex="-1"><span class="tk">${esc(symbol)}</span> <span class="tk-name">${esc(name || '')}</span></a></th>`;
}

// A row that opens a ticker (click, or focus and Enter).
export function symbolRow(symbol) {
  return symbol ? ` class="row-link" data-cmd="${esc(symbol)}" tabindex="0"` : '';
}
