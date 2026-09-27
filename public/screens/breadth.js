// BREADTH: how many stocks rose and fell. By exchange for the last full session
// (Nasdaq screener), and the S&P 100 by sector right now (the HEATMAP list).

import { esc, fmtNum, fmtPct, dirOf, panel, LOADING, rerender } from './markets.js';
import { sectorModel, treeKey, focusTreeRow, fmtPt } from './sectors.js';

// Both tables put the split bar right after a fixed-width name column, so the bars in
// the two panels start at the same x.
// A bar split into rising, unchanged and falling shares of the total.
export function splitBar(up, unch, down) {
  const total = up + unch + down;
  if (!(total > 0)) return '';
  const w = (n) => (n / total) * 100;
  const a = w(up);
  const b = w(unch);
  return `<svg class="bb-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="bb-up" x="0" y="1" width="${a.toFixed(2)}" height="6"/><rect class="bb-unch" x="${a.toFixed(2)}" y="1" width="${b.toFixed(2)}" height="6"/><rect class="bb-down" x="${(a + b).toFixed(2)}" y="1" width="${w(down).toFixed(2)}" height="6"/></svg>`;
}

// Rising stocks per falling one: 1.52, or -- when nothing fell.
export function adRatio(up, down) {
  return down > 0 ? up / down : null;
}

const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '--');
const fmtPctPlain = (n) => (Number.isFinite(n) ? `${fmtNum(n, 0)}%` : '--');
// Shares: 1.9B, 340M.
export function fmtShares(n) {
  if (!Number.isFinite(n)) return '--';
  if (n >= 1e9) return `${fmtNum(n / 1e9, 2)}B`;
  if (n >= 1e6) return `${fmtNum(n / 1e6, 0)}M`;
  return fmtInt(n);
}

function exchangeTable(exs) {
  return `<table class="grid-table bb-table">
    <thead><tr><th scope="col">Exchange</th><th scope="col" class="bar-cell">Split</th><th scope="col" class="num">Up</th><th scope="col" class="num">Down</th><th scope="col" class="num bb-x">Unch</th><th scope="col" class="num">% up</th><th scope="col" class="num bb-x">Up/down</th><th scope="col" class="num bb-x">Up volume</th><th scope="col" class="num bb-x">Down volume</th></tr></thead>
    <tbody>${exs.map((e) => (e.missing
      ? `<tr><th scope="row" class="name">${esc(e.name)}</th><td class="bar-cell"></td><td class="num">--</td><td class="num">--</td><td class="num bb-x">--</td><td class="num">--</td><td class="num bb-x">--</td><td class="num bb-x">--</td><td class="num bb-x">--</td></tr>`
      : `<tr>
        <th scope="row" class="name">${esc(e.name)}</th>
        <td class="bar-cell">${splitBar(e.up, e.unchanged, e.down)}</td>
        <td class="num up">${fmtInt(e.up)}</td>
        <td class="num down">${fmtInt(e.down)}</td>
        <td class="num bb-x flat">${fmtInt(e.unchanged)}</td>
        <td class="num last">${fmtPctPlain(e.upPct)}</td>
        <td class="num bb-x">${esc(Number.isFinite(adRatio(e.up, e.down)) ? fmtNum(adRatio(e.up, e.down), 2) : '--')}</td>
        <td class="num bb-x">${esc(fmtShares(e.upVolume))}</td>
        <td class="num bb-x">${esc(fmtShares(e.downVolume))}</td>
      </tr>`)).join('')}</tbody>
  </table>`;
}

// A sector row opens to its S&P 100 members, the same keys as SECTORS: each member's day
// move sits in the Up, Down or Unch column by its sign, its pt (SECTORS) in the last one.
// open: a Set of sector keys; members: Map(sector key -> SECTORS member rows), or null
// while they load.
function memberRows(key, members) {
  const list = members?.get(key);
  if (!list) return `<tr class="sc-who" data-k="w:${esc(key)}" data-parent="${esc(key)}" tabindex="-1"><td colspan="6">${members ? '--' : 'LOADING...'}</td></tr>`;
  return list.map((m) => {
    const d = dirOf(m.move);
    const cell = (want, cls) => `<td class="${['num', cls, d === want ? d : ''].filter(Boolean).join(' ')}">${d === want ? fmtPct(m.move) : ''}</td>`;
    return `<tr class="sc-mem row-link" data-k="m:${esc(key)}:${esc(m.ticker)}" data-parent="${esc(key)}" data-cmd="${esc(m.ticker)}" tabindex="-1">
      <th scope="row" class="name bb-in"><a href="?c=${esc(m.ticker)}" data-cmd="${esc(m.ticker)}" tabindex="-1">${esc(m.ticker)}</a> <span class="tk-name">${esc(m.name)}</span></th>
      <td class="bar-cell"></td>${cell('up', '')}${cell('down', '')}${cell('flat', 'bb-x')}
      <td class="num sc-x">${esc(fmtPt(m.pt))}</td>
    </tr>`;
  }).join('');
}

export function sectorTable(sectors, all, { open = new Set(), members = null } = {}) {
  const row = (s, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}>
    <th scope="row" class="name">${esc(s.name)}</th>
    <td class="bar-cell">${splitBar(s.up, s.unchanged, s.down)}</td>
    <td class="num up">${fmtInt(s.up)}</td>
    <td class="num down">${fmtInt(s.down)}</td>
    <td class="num bb-x flat">${fmtInt(s.unchanged)}</td>
    <td class="num last">${fmtPctPlain(s.upPct)}</td>
  </tr>`;
  const secRow = (s) => {
    const on = open.has(s.sector);
    return row(s).replace('<tr>', `<tr class="sc-row${on ? ' is-open' : ''}" data-k="s:${esc(s.sector)}" data-sec="${esc(s.sector)}" tabindex="-1" aria-expanded="${on}">`)
      .replace('<th scope="row" class="name">', `<th scope="row" class="name"><span class="sc-caret" aria-hidden="true">${on ? '▾' : '▸'}</span>`)
      + (on ? memberRows(s.sector, members) : '');
  };
  return `<table class="grid-table bb-table sc-tree">
    <thead><tr><th scope="col">Sector</th><th scope="col" class="bar-cell">Split</th><th scope="col" class="num">Up</th><th scope="col" class="num">Down</th><th scope="col" class="num bb-x">Unch</th><th scope="col" class="num">% up</th></tr></thead>
    <tbody>${all ? row({ ...all, name: `All S&P 100 (${all.total})` }, 'bb-all') : ''}${sectors.map(secRow).join('')}</tbody>
  </table>`;
}

// Open sectors and the cursor row, kept across visits in this page.
const tree = { open: new Set(), cur: null };

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="stack">
    ${panel('1', 'Breadth by exchange', LOADING, { metaId: 'bb-meta' })}
    ${panel('2', 'S&P 100 by sector', LOADING, { metaId: 'bb-s-meta', cmd: 'HEATMAP' })}
  </div>`;
  const [xBody, sBody] = el.querySelectorAll('.panel-body');
  let sectors = null;
  let sp100 = null;
  let members = null; // Map(sector key -> member rows), loaded when a sector first opens

  // The sector table again, the cursor row kept (and focused if the focus was in it).
  function drawSectors() {
    if (!sectors?.length) return;
    const had = sBody.contains(document.activeElement);
    sBody.innerHTML = sectorTable(sectors, sp100, { open: tree.open, members });
    const tr = (tree.cur && sBody.querySelector(`tr[data-k="${CSS.escape(tree.cur)}"]`)) || sBody.querySelector('tr.sc-row');
    if (tr) tree.cur = tr.dataset.k;
    focusTreeRow(sBody, tr, { focus: had });
  }
  async function loadMembers() {
    if (!tree.open.size) return;
    try {
      const d = await ctx.fetchJSON('/api/sectors', { signal: ctx.signal });
      members = new Map(sectorModel(d).map((s) => [s.key, s.members]));
    } catch (err) {
      if (err.name === 'AbortError') return;
      members = members || new Map();
    }
    drawSectors();
  }
  function setOpen(key, on) {
    tree.cur = `s:${key}`;
    if (on) tree.open.add(key); else tree.open.delete(key);
    drawSectors();
    if (on && !members) loadMembers();
  }
  sBody.addEventListener('keydown', (e) => treeKey(e, sBody, {
    isOpen: (k) => tree.open.has(k),
    cursor: (tr) => { if (tr) { tree.cur = tr.dataset.k; focusTreeRow(sBody, tr); } },
    open: setOpen,
    all: (on, key) => {
      if (on) for (const s of sectors) tree.open.add(s.sector);
      else { tree.open.clear(); tree.cur = `s:${key}`; }
      drawSectors();
      if (on && !members) loadMembers();
    },
    enter: (tr) => { if (tr.dataset.cmd) ctx.run(tr.dataset.cmd); },
  }));
  sBody.addEventListener('click', (e) => {
    const tr = e.target.closest?.('tr.sc-row');
    if (!tr || e.target.closest('a[data-cmd]')) return;
    setOpen(tr.dataset.sec, !tree.open.has(tr.dataset.sec));
  });

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/breadth', { signal: ctx.signal });
      rerender(xBody, exchangeTable(d.exchanges));
      el.querySelector('#bb-meta').innerHTML = `SESSION ${esc(d.sessionDate || '--')}`;
      sectors = d.sectors;
      sp100 = d.sp100;
      if (d.sectors.length) drawSectors(); else sBody.innerHTML = '<p class="panel-msg">S&P 100 prices are taking a break.</p>';
      if (members) loadMembers();
      el.querySelector('#bb-s-meta').textContent = d.sp100 ? `${d.sp100.up} OF ${d.sp100.total} UP` : '--';
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      for (const b of [xBody, sBody]) if (!b.querySelector('table')) b.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH BREADTH', 'warn');
    }
  }

  load();
  ctx.live(load, 60_000);
}
