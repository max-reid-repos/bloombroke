// CHANGES: what changed on Bloombroke, newest first, one plain line each. The list is
// kept by hand in data/changes.json (served by /api/changes).

import { esc, panel, LOADING } from './markets.js';
import { fmtDay } from './company-kit.js';

export function changesTable(items) {
  if (!items?.length) return '<p class="panel-msg">Nothing listed yet.</p>';
  const sorted = [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return `<table class="grid-table co-table changes-table">
    <thead><tr><th scope="col" class="co-date">Date</th><th scope="col">Change</th></tr></thead>
    <tbody>${sorted.map((x) => `<tr><td class="co-date dim">${esc(fmtDay(x.date))}</td><td>${esc(x.text)}</td></tr>`).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Changes', LOADING, { cls: 'panel-solo', metaId: 'ch-meta', bodyCls: 'flush' });
  const body = el.querySelector('.panel-body');
  ctx.fetchJSON('/api/changes', { signal: ctx.signal }).then((d) => {
    body.innerHTML = changesTable(d.items);
    el.querySelector('#ch-meta').textContent = `${d.items.length} CHANGES`;
    ctx.status('');
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('CHANGES: NO DATA', 'warn');
  });
}
