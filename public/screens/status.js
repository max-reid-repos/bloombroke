// STATUS: is each upstream source up right now. OK, SLOW (the last load took over 5 s),
// FAILING (the last try failed; the screens show the last good data), or -- (not asked
// since the server started). From the server's own caches; no personal data.

import { esc, panel, LOADING } from './markets.js';
import { dash } from './company-kit.js';
import { ageWords } from '../provenance.js';

const STATE_CLS = { OK: 'st-ok', SLOW: 'dim', FAILING: 'down', '--': 'dim' };

export function statusTable(rows) {
  if (!rows?.length) return '<p class="panel-msg">Nothing to report yet.</p>';
  return `<table class="grid-table co-table status-table">
    <thead><tr><th scope="col">Source</th><th scope="col">State</th><th scope="col" class="num">Last success</th><th scope="col" class="num hide-m">Last load</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <th scope="row" class="name">${esc(r.name)}</th>
      <td class="${STATE_CLS[r.state] || 'dim'}">${esc(r.state)}</td>
      <td class="num">${esc(Number.isFinite(r.last_ok_seconds) ? `${ageWords(r.last_ok_seconds)} ago` : dash)}</td>
      <td class="num hide-m dim">${esc(Number.isFinite(r.ms) ? `${(r.ms / 1000).toFixed(1)}s` : dash)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Status', LOADING, { cls: 'panel-solo', metaId: 'st-meta', bodyCls: 'flush' });
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#st-meta');
  const load = () => ctx.fetchJSON('/api/status', { signal: ctx.signal }).then((d) => {
    body.innerHTML = statusTable(d.rows);
    const bad = d.rows.filter((r) => r.state === 'FAILING').length;
    meta.textContent = bad ? `${bad} FAILING` : 'ALL OK';
    ctx.updated(d.updated, false);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('STATUS: NO DATA', 'warn');
  });
  load();
  ctx.live(load, 30_000);
}
