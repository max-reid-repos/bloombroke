// WHY <ticker> (and <ticker> WHY): the 10 biggest daily moves of the last year, close
// to close, from the chart's own daily bars. Beside each: what came out that day, from
// the prior close to that close: the company's 8-K filings (SEC EDGAR), the earnings
// date and headlines from the news log. It lists, it never names a cause; nothing found
// is --. Index, FX, coin and future symbols get one line: WHY is for company stocks.

import { esc, fmtNum, fmtPct, dirOf, panel, LOADING, metaNote, nyTime } from './markets.js';
import { errorHtml, tickerUsage, fmtDay, dash } from './company-kit.js';
import { dataTable, usageCard } from '../kit.js';
import { safeHref, shortSource } from './news.js';
import { sessionHtml } from '../provenance.js';
import { goal } from '../goal.js'; // GOALS

export { parseTicker as parse } from './company-kit.js';

export const WHY_NOTE = 'Biggest daily moves, 1Y. What came out that day, not a cause.';
const WHY_NOTE_LONG = 'The 10 biggest close to close moves of the last year, from daily closes. Beside each: SEC 8-K filings, the earnings date and logged headlines that came out after the prior close and before that close. A list of what came out, not what caused the move.';
export const SHOWN_ITEMS = 3;

const KIND_TAG = { FILING: 'SEC', EARNINGS: 'EARN' };

// One line of the WHAT CAME OUT column: a short source tag, then the text (a link when
// it has one). The tooltip carries the time and the full text.
export function itemHtml(it) {
  const tag = KIND_TAG[it.kind] || shortSource(it.source);
  const when = it.time ? `${fmtDay(it.date)} ${nyTime(it.time)} ET` : fmtDay(it.date);
  const tip = `${when} · ${it.source || tag} · ${it.text}`;
  const href = safeHref(it.url);
  const text = href
    ? `<a class="why-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(it.text)}</a>`
    : `<span class="why-link">${esc(it.text)}</span>`;
  // A filing's PRE, MKT, AH or WKD (EDGAR acceptance time) follows its tag.
  return `<span class="why-it why-${esc(String(it.kind || '').toLowerCase())}" title="${esc(tip)}"><span class="why-tag">${esc(tag)}</span>${sessionHtml(it.session)}${text}</span>`;
}

// The column for one move: up to SHOWN_ITEMS lines and "+N MORE", or -- when nothing
// came out.
export function whatCell(items) {
  if (!items?.length) return `<span class="dim">${dash}</span>`;
  const shown = items.slice(0, SHOWN_ITEMS).map(itemHtml).join('');
  const rest = items.slice(SHOWN_ITEMS);
  const more = rest.length ? `<span class="why-more dim" title="${esc(rest.map((x) => x.text).join(' | '))}">+${rest.length} MORE</span>` : '';
  return `${shown}${more}`;
}

export function whyTable(rows) {
  return dataTable({
    caption: 'Biggest daily moves of the last year',
    columns: [
      { key: 'rank', label: '#', num: true, cls: 'hide-m why-rank' },
      { key: 'date', label: 'Date', cls: 'date why-date', fmt: (v) => esc(fmtDay(v)) },
      { key: 'pct', label: 'Move', num: true, fmt: (v) => `<span class="${dirOf(v)}">${esc(fmtPct(v))}</span>` },
      { key: 'close', label: 'Close', num: true, cls: 'hide-m', fmt: (v) => esc(fmtNum(v, 2)) },
      { key: 'items', label: 'What came out that day', cls: 'why-what', fmt: (v) => whatCell(v) },
    ],
    rows,
  }).replace('class="dt"', 'class="dt why-dt"');
}

// The title strip: the note, plus how far back the headline log goes and whether the
// filings loaded.
export function whyMeta(d) {
  const bits = [metaNote(WHY_NOTE, WHY_NOTE_LONG)];
  if (d.secOk === false) bits.push(metaNote('SEC filings did not load'));
  if (d.logSince) bits.push(metaNote(`Headlines since ${fmtDay(String(d.logSince).slice(0, 10))}`));
  return bits.join(' · ');
}

export function notCompanyHtml(ticker) {
  return usageCard({ problem: 'WHY works for company stocks.', format: 'WHY ticker', grammar: 'WHY <ticker>', example: 'WHY AAPL', more: ['WHY TSLA'], notes: [`${ticker} has no company filings to match.`] });
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Why', tickerUsage('WHY', ['WHY AAPL', 'TSLA WHY', 'WHY NVDA']), { cls: 'panel-solo' });
    ctx.status('WHY: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  goal('news_why_opened');
  el.innerHTML = panel('1', `${ticker} biggest daily moves`, LOADING, { cls: 'panel-solo', metaId: 'why-meta', bodyCls: 'flush' });
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#why-meta');

  ctx.fetchJSON(`/api/why?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    if (!d.company) {
      body.innerHTML = `<div class="co-pad">${notCompanyHtml(ticker)}</div>`;
      meta.innerHTML = '';
      ctx.status('WHY: COMPANY STOCKS ONLY');
      return;
    }
    body.innerHTML = d.rows.length ? whyTable(d.rows) : `<p class="panel-msg">No daily moves for ${esc(ticker)} yet.</p>`;
    meta.innerHTML = whyMeta(d);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO DAILY PRICES FOR ${ticker}` : 'WHY: NO DATA', 'warn');
  });
}
