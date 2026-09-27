// DATA (alias SOURCES): every dataset on Bloombroke in one dense table. Source, licence,
// coverage, history, how often it updates, its age right now (from the server's caches),
// its delay class and known gaps. This is the one place the detail lives: screens keep
// only the freshness dot, whose list links here. DATA <dataset> opens with that row lit.

import { esc, panel, LOADING, metaNote } from './markets.js';
import { dash } from './company-kit.js';
import { ageWords, delayWord } from '../provenance.js';

export function parse(args) {
  if (args.length > 1) return { error: 'usage' };
  return args.length ? { id: String(args[0]).toLowerCase() } : {};
}

// "SEC filings: seen within ~42s of acceptance", or the same with -- before any.
export function secLine(sec) {
  const n = sec?.seen_within_seconds;
  return `SEC filings: seen within ${Number.isFinite(n) ? `~${n}s` : dash} of acceptance`;
}

const COLS = [
  ['Dataset', 'dt-name'], ['Source', 'dt-src'], ['Licence', 'dt-lic'], ['Coverage', 'dt-cov hide-m'], ['History', 'dt-hist hide-m'],
  ['Updates', 'dt-upd hide-m'], ['Age now', 'num dt-age'], ['Delay', 'dt-delay'], ['Known gaps', 'dt-gaps hide-m'],
];

export function dataTable(rows, { lit = '' } = {}) {
  if (!rows?.length) return '<p class="panel-msg">No datasets listed.</p>';
  let group = '';
  const body = rows.map((r) => {
    const head = r.group !== group ? `<tr class="group-row"><th scope="rowgroup" colspan="${COLS.length}">${esc(r.group)}</th></tr>` : '';
    group = r.group;
    const url = /^https:\/\//.test(r.url || '') ? r.url : null;
    const src = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.source)}</a>` : esc(r.source);
    const on = lit && (r.id === lit || r.id.startsWith(`${lit}-`));
    return `${head}<tr id="data-${esc(r.id)}" class="${on ? 'is-lit' : ''}">
      <th scope="row" class="name dt-name">${esc(r.name)}</th>
      <td class="dt-src">${src}</td>
      <td class="dt-lic dim">${esc(r.licence)}</td>
      <td class="dt-cov hide-m dim">${esc(r.coverage || dash)}</td>
      <td class="dt-hist hide-m dim">${esc(r.history || dash)}</td>
      <td class="dt-upd hide-m dim">${esc(r.cadence || dash)}</td>
      <td class="num dt-age">${esc(Number.isFinite(r.age_seconds) ? ageWords(r.age_seconds) : dash)}</td>
      <td class="dt-delay">${esc(delayWord(r.delay))}</td>
      <td class="dt-gaps hide-m dim">${esc(r.gaps || dash)}</td>
    </tr>`;
  }).join('');
  return `<div class="dt-scroll"><table class="grid-table co-table data-table">
    <thead><tr>${COLS.map(([l, c]) => `<th scope="col" class="${c}">${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Data sources', `<p class="notice">DATA takes one dataset name at most, like <span class="code">DATA CPI</span>.</p>`, { cls: 'panel-solo' });
    ctx.status('DATA: CHECK THE FORMAT', 'warn');
    return;
  }
  const lit = cmd.args?.id || '';
  el.innerHTML = panel('1', 'Data sources', LOADING, { cls: 'panel-solo', metaId: 'data-meta', bodyCls: 'flush' });
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#data-meta');
  const load = () => ctx.fetchJSON('/api/data', { signal: ctx.signal }).then((d) => {
    const top = body.querySelector('.dt-scroll')?.scrollTop || 0;
    body.innerHTML = dataTable(d.rows, { lit });
    const sc = body.querySelector('.dt-scroll');
    if (sc) sc.scrollTop = top;
    meta.innerHTML = `${d.rows.length} DATASETS · ${metaNote(secLine(d.sec).toUpperCase(), 'Measured: the time from EDGAR accepting a filing to this server seeing it, median of the last 200 filings. FINANCIALS, FILINGS and the E flags refetch that company on the next view.')}`;
    if (lit && !top) body.querySelector('tr.is-lit')?.scrollIntoView({ block: 'center' });
    ctx.updated(d.updated, false);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('DATA: NO DATA', 'warn');
  });
  load();
  ctx.live(load, 30_000);
}
