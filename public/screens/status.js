// STATUS (Pro): is each data feed up right now. Grouped like the HOME markets grid: a
// header row per group (PRICES, CHARTS, COMPANY DATA, SEC, MACRO, NEWS, WEIRD, OUR
// COUNTERS), then one row per item with its own name, a small dot and a word (OK green,
// SLOW grey, FAILING a hollow red ring; -- not asked since the server started) and the
// age of its last good load. From the server's own caches; no personal data, no source
// names. Free users get one line and the PRO link.

import { esc, panel, LOADING, q } from './markets.js';
import { dash } from './company-kit.js';
import { ageWords } from '../provenance.js';
import { getKey, isPro, HEADER } from '../pro.js';

export const PRO_ONLY_LINE = 'STATUS is part of Pro.';
const STATE_KEY = { OK: 'ok', SLOW: 'slow', FAILING: 'failing' };

export function stateHtml(state) {
  const k = STATE_KEY[state] || 'none';
  return `<span class="sx-dot" data-state="${k}" aria-hidden="true"></span><span class="sx-word sx-${k}">${esc(STATE_KEY[state] ? state : dash)}</span>`;
}

// groups: [{ group, rows: [{ name, state, last_ok_seconds }] }]
export function statusGrid(groups) {
  const list = (groups || []).filter((g) => g.rows?.length);
  if (!list.length) return '<p class="panel-msg">Nothing to report yet.</p>';
  const cols = '<colgroup><col><col class="c-st"><col class="c-age"></colgroup>';
  return `<div class="mk-cols st-cols">${list.map((g) => `<table class="grid-table mk-group st-group">
    ${cols}<tbody><tr class="group-row"><th colspan="3" scope="rowgroup">${esc(g.group)}</th></tr>${g.rows.map((r) => `<tr>
      <th scope="row" class="name">${esc(r.name)}</th>
      <td class="st-state">${stateHtml(r.state)}</td>
      <td class="num dim">${esc(Number.isFinite(r.last_ok_seconds) ? ageWords(r.last_ok_seconds) : dash)}</td>
    </tr>`).join('')}</tbody>
  </table>`).join('')}</div>`;
}

export function proOnlyHtml() {
  return `<p class="notice">${esc(PRO_ONLY_LINE)} <a class="code" href="${esc(q('PRO'))}" data-cmd="PRO">PRO</a></p>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Status', LOADING, { cls: 'panel-solo', metaId: 'st-meta', bodyCls: 'flush' });
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#st-meta');
  const locked = () => { body.innerHTML = `<div class="co-pad">${proOnlyHtml()}</div>`; meta.textContent = ''; ctx.status('STATUS: PRO ONLY'); };
  if (!isPro()) { locked(); return; }
  const load = async () => {
    let res;
    try {
      res = await fetch('/api/status', { headers: { Accept: 'application/json', [HEADER]: getKey() }, signal: ctx.signal, cache: 'no-store' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      body.innerHTML = '<p class="panel-msg">You look offline. Check your connection and try again.</p>';
      return;
    }
    if (res.status === 403 || res.status === 401) { locked(); return; }
    let d = null;
    try { d = await res.json(); } catch { d = null; }
    if (!res.ok || !d) { body.innerHTML = '<p class="panel-msg">Status is taking a break. Try again in a minute.</p>'; return; }
    body.innerHTML = statusGrid(d.groups);
    const bad = d.groups.flatMap((g) => g.rows).filter((r) => r.state === 'FAILING').length;
    meta.textContent = bad ? `${bad} FAILING` : 'ALL OK';
    ctx.updated(d.updated, false);
  };
  load();
  ctx.live(load, 30_000);
}
