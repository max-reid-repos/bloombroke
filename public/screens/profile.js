// PROFILE: what a company does. Description, sector, industry, headquarters, website.
// Also exports the ticker helpers the other company screens use.

import { esc, q, panel, LOADING } from './markets.js';
import { fmtCompact } from './movers.js';
import { usageCard, raw } from '../kit.js';
import { parseTicker, parseTicker as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { parseTicker, parse };

// A company screen without its ticker: the kit's usage card (kit.js usageCard).
export function tickerUsage(name, examples) {
  return usageCard({ problem: `${name} needs one ticker.`, format: `${name} ticker`, grammar: `${name} <ticker>`, example: examples[0], more: examples.slice(1) });
}

const HELP_NOTE = raw(`Check the spelling. Type <a class="code" href="${esc(q('HELP'))}" data-cmd="HELP">HELP</a> for every command.`);

export function errorHtml(err, ticker) {
  if (err.status === 404 || err.status === 400) return usageCard({ problem: err.message, example: 'AAPL', notes: [HELP_NOTE] });
  return `<p class="panel-msg">${esc(err.message)}</p>`;
}

// The description: about the first three lines (60ch each) up front, whole sentences;
// the rest behind + Details (the .how toggle, closed).
export const DESC_LEAD = 180;
export function splitDescription(text) {
  const parts = String(text || '').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/);
  let lead = parts.shift() || '';
  while (parts.length && lead.length + 1 + parts[0].length <= DESC_LEAD) lead += ` ${parts.shift()}`;
  return [lead, parts.join(' ')];
}
export function descHtml(text) {
  const [lead, rest] = splitDescription(text);
  return `<p class="profile-desc">${esc(lead)}</p>${rest ? `<details class="how profile-more"><summary>Details</summary><p class="profile-desc">${esc(rest)}</p></details>` : ''}`;
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
        ${d.description ? descHtml(d.description) : '<p class="muted">No description on file.</p>'}
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
