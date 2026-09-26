// PROFILE: what a company does. Description, sector, industry, headquarters, website.
// Also exports the ticker helpers the other company screens use.

import { esc, q, panel, LOADING } from './markets.js';
import { fmtCompact } from './movers.js';

const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// <COMMAND> <ticker>
export function parseTicker(args) {
  return args.length === 1 && TICKER.test(args[0]) ? { ticker: args[0] } : { error: 'usage' };
}
export const parse = parseTicker;

export function tickerUsage(name, examples) {
  return `<p class="notice">${esc(name)} needs one ticker.</p>
    <p class="muted examples">Try ${examples.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`;
}

export function errorHtml(err, ticker) {
  if (err.status === 404 || err.status === 400) {
    return `<p class="notice">${esc(err.message)}</p>
      <p class="muted">Check the spelling, or try <a class="code" href="${esc(q('AAPL'))}" data-cmd="AAPL">AAPL</a>. Type <a class="code" href="${esc(q('HELP'))}" data-cmd="HELP">HELP</a> for every command.</p>`;
  }
  return `<p class="panel-msg">${esc(err.message)}</p>`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Profile', tickerUsage('PROFILE', ['PROFILE AAPL', 'PROFILE KO', 'PROFILE NVDA']), { cls: 'panel-solo' });
    ctx.status('PROFILE: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = panel('1', `${ticker} profile`, LOADING, { cls: 'panel-solo' });
  const body = el.querySelector('.panel-body');

  ctx.fetchJSON(`/api/profile?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    const host = d.website ? new URL(d.website).host.replace(/^www\./, '') : null;
    const stats = [
      ['Sector', d.sector],
      ['Industry', d.industry],
      ['Exchange', d.exchange],
      ['Market cap', Number.isFinite(d.marketCap) ? `$${fmtCompact(d.marketCap)}` : null],
      ['Headquarters', d.hq],
      ['Fiscal year ends', d.fiscalYearEnd],
    ].filter(([, v]) => v);
    body.innerHTML = `<div class="profile">
      <div class="profile-main">
        <p class="q-name">${esc(d.ticker)}</p>
        <h2 class="profile-name">${esc(d.name)}</h2>
        ${d.description ? `<p class="profile-desc">${esc(d.description)}</p>` : '<p class="muted">No description on file.</p>'}
        ${host ? `<p class="profile-web"><a href="${esc(d.website)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a></p>` : ''}
      </div>
      <dl class="stats">${stats.map(([k, v]) => `<div class="stat"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    </div>`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = errorHtml(err, ticker);
    ctx.status(err.status === 404 ? `NO PROFILE FOR ${ticker}` : 'PROFILE: NO DATA', 'warn');
  });
}
