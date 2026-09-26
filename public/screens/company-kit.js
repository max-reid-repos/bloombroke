// Shared bits for the company-data screens (INSIDERS, OWNERS, FILINGS, SHORTS, BEATS,
// VALUE, IPOS, SPLITS, EXDIV): number formats. How to read a screen's numbers is a short
// note in its title strip (metaNote), not a footnote. The stock tab strip
// and the watch star come from the frame (app.js), not from the screens.

import { esc, q, fmtNum, metaNote } from './markets.js';
import { fmtCompact } from './movers.js';

export { errorHtml, tickerUsage, parseTicker } from './profile.js';

export { metaNote };

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
