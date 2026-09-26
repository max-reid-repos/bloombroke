// WATCH: the user's own list of symbols, live every 15 seconds. Sortable columns,
// rows open their screen, reorder by drag or Alt+Up / Alt+Down. Stored in this browser.

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, panel, tick, settleTicks, rerender } from './markets.js';
import { freshTag } from '../freshness.js';
import { rangeBar, decimalsOf } from './quote.js';
import {
  loadWatchlist, saveWatchlist, isDefaultList, addIds, removeIds, moveItem, exportText,
  sortRows, parseSymbols, DEFAULT_WATCHLIST, MAX_WATCH,
} from '../watchlist.js';
import { toolbar } from '../kit.js';

const SORT_KEY = 'bb.watch.sort';
const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

// Quotes for a list of symbols, in the order asked. Missing ones come back as null.
export async function fetchQuotes(ctx, ids) {
  if (!ids.length) return { byId: {}, data: null };
  const d = await ctx.fetchJSON(`/api/quotes?s=${ids.map(encodeURIComponent).join(',')}`, { signal: ctx.signal });
  const byId = {};
  for (const qt of d.quotes || []) byId[qt.ticker] = qt;
  return { byId, data: d };
}

const nameOf = (id, qt, missing) => (qt ? (qt.label || qt.name || id) : missing ? 'No quote for this symbol' : '');
const fmtIn = (qt, v) => (qt?.kind === 'yield' ? `${fmtNum(v, decimalsOf(qt))}%` : fmtNum(v, decimalsOf(qt)));

function dayRange(qt) {
  if (!qt || !Number.isFinite(qt.low) || !Number.isFinite(qt.high)) return '--';
  return `${fmtIn(qt, qt.low)} - ${fmtIn(qt, qt.high)}`;
}

function range52(qt) {
  if (!qt || !Number.isFinite(qt.low52) || !Number.isFinite(qt.high52)) return '--';
  return `<span class="wl-lo">${fmtIn(qt, qt.low52)}</span>${rangeBar(qt.low52, qt.high52, qt.last)}<span class="wl-hi">${fmtIn(qt, qt.high52)}</span>`;
}

const COLS = [
  { key: 'symbol', label: 'Symbol', cls: 'wl-sym' },
  { key: 'name', label: 'Name', cls: 'name-h' },
  { key: null, label: '<span class="offscreen">Real time or delayed</span>', cls: 'tag', raw: true },
  { key: 'last', label: 'Last', cls: 'num' },
  { key: 'chg', label: 'Chg', cls: 'num chg' },
  { key: 'pct', label: '%Chg', cls: 'num' },
  { key: 'day', label: 'Day range', cls: 'num wl-wide' },
  { key: 'range', label: '52W range', cls: 'num wl-wide' },
  { key: 'vol', label: 'Volume', cls: 'num wl-wide' },
  { key: null, label: '<span class="offscreen">Move or remove</span>', cls: 'wl-act', raw: true },
];

function headHtml(sort) {
  return `<thead><tr>${COLS.map((c) => {
    if (!c.key) return `<th scope="col" class="${c.cls}">${c.raw ? c.label : esc(c.label)}</th>`;
    const on = sort.key === c.key && sort.dir;
    const aria = on ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
    const arrow = on ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th scope="col" class="${c.cls}"${aria}><button type="button" class="th-sort${on ? ' is-on' : ''}" data-sort="${c.key}">${esc(c.label)}<span aria-hidden="true">${arrow}</span></button></th>`;
  }).join('')}</tr></thead>`;
}

// The row actions at the right edge of a row, the same on WATCH and PF: small buttons,
// remove (×) always last. acts: [{ act, label, aria, disabled?, text? }].
export function rowActions(acts) {
  return `<td class="wl-act row-acts">${acts.map((a) => `<button type="button" class="wl-btn${a.text ? ' is-text' : ''}" data-act="${esc(a.act)}" aria-label="${esc(a.aria)}" title="${esc(a.aria)}"${a.disabled ? ' disabled' : ''}>${esc(a.label)}</button>`).join('')}</td>`;
}

// The quiet list tools at the right of a WATCH or PF toolbar (EXPORT, IMPORT, CLEAR).
// confirming: CLEAR asks first, in place, with the number it would remove.
export function listTools(tools, { confirming = false, count = 0, what = 'symbols' } = {}) {
  if (confirming) {
    return `<span class="clear-ask" role="alert">Clear all ${count} ${esc(what)}?</span><button type="button" class="quiet is-danger" data-tool="clear-yes">YES, CLEAR</button><button type="button" class="quiet" data-tool="clear-no">KEEP</button>`;
  }
  return tools.map((t) => `<button type="button" class="quiet" data-tool="${esc(t.tool)}">${esc(t.label)}</button>`).join('');
}

// The WATCH add form: symbols separated by spaces or commas.
export function watchForm() {
  return `<form class="add-form" data-own-focus autocomplete="off">
    <input class="add-in add-sym" name="symbols" type="text" maxlength="200" spellcheck="false" autocapitalize="characters" autocorrect="off" placeholder="Symbols to add" aria-label="Symbols to add, separated by spaces">
    <button type="submit" class="chip add-btn">ADD</button>
  </form>`;
}

// Symbols typed in the add form -> { ids, bad }.
export function readSymbols(text) {
  return parseSymbols(String(text || '').trim().split(/[\s,;]+/).filter(Boolean));
}

export function watchTable(rows, { sort = {}, missing = new Set() } = {}) {
  const canMove = !sort.dir;
  const body = rows.map(({ id, quote: qt }, i) => {
    const d = dirOf(qt?.kind === 'yield' ? Math.round((qt?.change ?? 0) * 1000) : qt?.change);
    const dec = qt ? decimalsOf(qt) : 2;
    return `<tr class="row-link" data-cmd="${esc(id)}" data-id="${esc(id)}" tabindex="0"${canMove ? ' draggable="true"' : ''}>
      <th scope="row" class="wl-sym"><a href="${esc(q(id))}" data-cmd="${esc(id)}" tabindex="-1">${esc(id)}</a></th>
      <td class="name">${esc(nameOf(id, qt, missing.has(id)))}</td>
      <td class="tag">${freshTag(qt)}</td>
      <td class="num last${qt ? tick(`wl:${id}:last`, qt.last) : ''}">${qt ? fmtIn(qt, qt.last) : '--'}</td>
      <td class="num chg ${d}">${qt ? fmtSigned(qt.change, dec) : '--'}</td>
      <td class="num pct ${d}">${qt ? fmtPct(qt.changePct) : '--'}</td>
      <td class="num wl-wide dim">${dayRange(qt)}</td>
      <td class="num wl-wide wl-52">${range52(qt)}</td>
      <td class="num wl-wide dim">${esc(qt?.volume || '--')}</td>
      ${rowActions([
        ...(canMove ? [
          { act: 'up', label: '↑', aria: `Move ${id} up`, disabled: i === 0 },
          { act: 'down', label: '↓', aria: `Move ${id} down`, disabled: i === rows.length - 1 },
        ] : []),
        { act: 'remove', label: '×', aria: `Remove ${id} from the watchlist` },
      ])}
    </tr>`;
  }).join('');
  return `<table class="grid-table wl-table">${headHtml(sort)}<tbody>${body}</tbody></table>`;
}

// HOME: a compact version (name, tag, last, change, % change).
export function watchCompact(list, byId) {
  const rows = list.map((id) => {
    const qt = byId[id];
    const d = dirOf(qt?.change);
    const dec = qt ? decimalsOf(qt) : 2;
    return `<tr class="row-link" data-cmd="${esc(id)}" tabindex="0">
      <th scope="row" class="name"><a href="${esc(q(id))}" data-cmd="${esc(id)}" tabindex="-1">${esc(id)}</a> <span class="dim wl-cname">${esc(qt ? (qt.label || qt.name) : '')}</span></th>
      <td class="tag">${freshTag(qt)}</td>
      <td class="num last${qt ? tick(`hw:${id}:last`, qt.last) : ''}">${qt ? fmtIn(qt, qt.last) : '--'}</td>
      <td class="num chg ${d}">${qt ? fmtSigned(qt.change, dec) : '--'}</td>
      <td class="num pct ${d}">${qt ? fmtPct(qt.changePct) : '--'}</td>
    </tr>`;
  }).join('');
  return `<table class="grid-table">
    <thead><tr><th scope="col">Symbol</th><th scope="col" class="tag"><span class="offscreen">Real time or delayed</span></th><th scope="col" class="num">Last</th><th scope="col" class="num chg">Chg</th><th scope="col" class="num">%Chg</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const list3 = (ids) => ids.join(', ');

// Run the command's change against the stored list. Returns { list, msg, warn, extra }.
export function applyWatch(list, a) {
  switch (a.action) {
    case 'add': {
      const r = addIds(list, a.ids);
      const full = r.skipped.filter((id) => !list.includes(id));
      const parts = [];
      if (r.added.length) parts.push(`Added ${list3(r.added)}.`);
      const already = r.skipped.filter((id) => list.includes(id));
      if (already.length) parts.push(`${list3(already)} ${already.length === 1 ? 'is' : 'are'} already on the list.`);
      if (full.length) parts.push(`The list holds ${MAX_WATCH} symbols. ${list3(full)} did not fit.`);
      return { list: r.list, msg: parts.join(' '), warn: !r.added.length };
    }
    case 'remove': {
      const r = removeIds(list, a.ids);
      const parts = [];
      if (r.removed.length) parts.push(`Removed ${list3(r.removed)}.`);
      if (r.missing.length) parts.push(`${list3(r.missing)} ${r.missing.length === 1 ? 'is' : 'are'} not on the list.`);
      return { list: r.list, msg: parts.join(' '), warn: !r.removed.length };
    }
    case 'clear': return { list: [], msg: 'Cleared the watchlist.' };
    case 'reset': return { list: [...DEFAULT_WATCHLIST], msg: 'Back to the starter list.' };
    case 'import': {
      const ids = a.ids.slice(0, MAX_WATCH);
      return { list: ids, msg: `Imported ${ids.length} symbol${ids.length === 1 ? '' : 's'}. The old list is replaced.` };
    }
    default: return { list, msg: '' };
  }
}

const ERRORS = {
  usage: 'Add a symbol after the word.',
  symbol: 'Some of those do not look like symbols',
};
const EXAMPLES = ['WATCH ADD AAPL TSLA EURUSD', 'WATCH REMOVE TSLA', 'WATCH EXPORT', 'WATCH IMPORT AAPL,MSFT,GOLD'];

function readSort(store) {
  const s = store.get(SORT_KEY, null);
  return s && typeof s.key === 'string' && (s.dir === 'asc' || s.dir === 'desc') ? s : { key: null, dir: null };
}

export function render(el, cmd, ctx) {
  const a = cmd.args || { action: 'show' };
  let list = loadWatchlist(ctx.store);
  let msg = '';
  let warn = false;
  let exportBox = '';

  if (a.error) {
    msg = a.error === 'symbol' ? `${ERRORS.symbol}: ${a.bad.join(', ')}.` : ERRORS.usage;
    warn = true;
  } else if (a.mutates) {
    const r = applyWatch(list, a);
    list = r.list;
    msg = r.msg;
    warn = Boolean(r.warn);
    saveWatchlist(ctx.store, list);
  } else if (a.action === 'export') {
    const text = exportText(list);
    exportBox = `<label class="wl-export"><span class="dim">YOUR LIST</span><input type="text" readonly value="${esc(text)}" aria-label="Your watchlist as text" data-own-focus></label>`;
    msg = list.length ? 'Copying your list...' : 'The list is empty. Nothing to export.';
    if (list.length) {
      ctx.copy(text).then((ok) => {
        const m = el.querySelector('.wl-msg');
        if (m) m.textContent = ok ? `Copied ${list.length} symbols. Paste them into WATCH IMPORT on any device.` : 'Copy the list from the box below.';
      });
    }
  }

  let sort = readSort(ctx.store);
  let byId = {};
  let missing = new Set();
  let dragging = null;

  const head = `${list.length} OF ${MAX_WATCH} SYMBOLS`;
  el.innerHTML = `${panel('1', 'Watchlist', `${toolbar({ left: watchForm(), right: '<span class="list-tools"></span>', label: 'Watchlist' })}<div class="wl-top"></div><div class="wl-body"></div>`, { cls: 'panel-solo', metaId: 'wl-meta', meta: head, bodyCls: 'flush' })}`;
  const top = el.querySelector('.wl-top');
  const body = el.querySelector('.wl-body');
  const meta = el.querySelector('#wl-meta');
  const tools = el.querySelector('.list-tools');
  const form = el.querySelector('.add-form');
  let confirming = false;

  function drawTools() {
    tools.innerHTML = listTools([{ tool: 'export', label: 'EXPORT' }, ...(list.length ? [{ tool: 'clear', label: 'CLEAR' }] : [])], { confirming, count: list.length, what: list.length === 1 ? 'symbol' : 'symbols' });
  }

  function drawTop() {
    const note = isDefaultList(list)
      ? '<p class="wl-note">This is the starter list. Add your own symbols above, and remove any row with ×.</p>'
      : '';
    drawTools();
    top.innerHTML = `${msg ? `<p class="wl-msg${warn ? ' is-warn' : ''}" role="status">${esc(msg)}</p>` : ''}${exportBox}${note}`;
    if (a.error) top.insertAdjacentHTML('beforeend', `<p class="muted examples">Try ${EXAMPLES.map(code).join(' ')}</p>`);
    meta.textContent = `${list.length} OF ${MAX_WATCH} SYMBOLS`;
  }

  function draw() {
    if (!list.length) {
      body.innerHTML = `<p class="panel-msg wl-empty">The watchlist is empty. Add symbols above, like AAPL MSFT GOLD, or go back to the starter list: ${code('WATCH RESET')}</p>`;
      return;
    }
    const rows = sortRows(list.map((id) => ({ id, quote: byId[id] || null })), sort.key, sort.dir);
    rerender(body, watchTable(rows, { sort, missing }));
    settleTicks(body);
  }

  async function load() {
    if (!list.length || dragging) return;
    try {
      const r = await fetchQuotes(ctx, list);
      byId = r.byId;
      missing = new Set(r.data.missing || []);
      draw();
      ctx.updated(r.data.updated, r.data.stale, r.data.quotes);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH THE WATCHLIST', 'warn');
    }
  }

  function commit(next, focusId) {
    list = next;
    saveWatchlist(ctx.store, list);
    msg = '';
    exportBox = '';
    drawTop();
    draw();
    if (focusId) body.querySelector(`tr[data-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: false });
  }

  function move(id, delta) {
    const i = list.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    commit(moveItem(list, i, j), id);
    ctx.status(`MOVED ${id} ${delta < 0 ? 'UP' : 'DOWN'}`);
  }

  function remove(id) {
    const i = list.indexOf(id);
    const next = list.filter((x) => x !== id);
    const focusId = next[Math.min(i, next.length - 1)];
    commit(next, focusId);
    msg = `Removed ${id}.`;
    drawTop();
    ctx.status(`REMOVED ${id}`);
  }

  // The add form: symbols in, saved, prices fetched.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = form.querySelector('.add-sym');
    const { ids, bad } = readSymbols(input.value);
    if (bad.length || !ids.length) {
      msg = bad.length ? `${ERRORS.symbol}: ${bad.join(', ')}.` : 'Type a symbol, like AAPL or EURUSD.';
      warn = true;
      drawTop();
      ctx.status('WATCH: CHECK THE SYMBOLS', 'warn');
      return;
    }
    const r = applyWatch(list, { action: 'add', ids });
    confirming = false;
    commit(r.list);
    msg = r.msg;
    warn = Boolean(r.warn);
    drawTop();
    if (!warn) input.value = '';
    ctx.status(warn ? 'WATCH: NOTHING ADDED' : `ADDED ${ids.join(' ')}`, warn ? 'warn' : '');
    load();
  });

  // Quiet tools: EXPORT opens the export view; CLEAR asks first, in place.
  tools.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]')?.dataset.tool;
    if (!t) return;
    e.stopPropagation();
    if (t === 'export') { ctx.run('WATCH EXPORT'); return; }
    if (t === 'clear') { confirming = true; drawTools(); tools.querySelector('[data-tool="clear-no"]')?.focus(); return; }
    if (t === 'clear-no') { confirming = false; drawTools(); return; }
    if (t === 'clear-yes') {
      confirming = false;
      commit([]);
      msg = 'Cleared the watchlist.';
      warn = false;
      drawTop();
      ctx.status('WATCHLIST CLEARED');
    }
  });

  // Buttons inside a row act on the list; they must not open the row.
  body.addEventListener('click', (e) => {
    const sortBtn = e.target.closest('.th-sort');
    if (sortBtn) {
      e.stopPropagation();
      const key = sortBtn.dataset.sort;
      const numeric = key !== 'symbol' && key !== 'name';
      const first = numeric ? 'desc' : 'asc';
      const second = numeric ? 'asc' : 'desc';
      if (sort.key !== key) sort = { key, dir: first };
      else if (sort.dir === first) sort = { key, dir: second };
      else sort = { key: null, dir: null };
      ctx.store.set(SORT_KEY, sort.dir ? sort : null);
      draw();
      body.querySelector(`.th-sort[data-sort="${key}"]`)?.focus();
      ctx.status(sort.dir ? `SORTED BY ${key.toUpperCase()} ${sort.dir === 'asc' ? 'LOW TO HIGH' : 'HIGH TO LOW'}` : 'YOUR ORDER');
      return;
    }
    const btn = e.target.closest('.wl-btn');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const id = btn.closest('tr')?.dataset.id;
    if (!id) return;
    if (btn.dataset.act === 'remove') remove(id);
    else move(id, btn.dataset.act === 'up' ? -1 : 1);
    // Keep the keyboard on the same kind of button after a redraw.
    body.querySelector(`tr[data-id="${CSS.escape(id)}"] .wl-btn[data-act="${btn.dataset.act}"]:not([disabled])`)?.focus();
  });

  body.addEventListener('keydown', (e) => {
    const tr = e.target.closest?.('tr[data-id]');
    if (!tr || e.target !== tr) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (sort.dir) { ctx.status('CLEAR THE SORT TO REORDER', 'warn'); return; }
      move(tr.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
    } else if (!e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const next = e.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
      next?.focus();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      remove(tr.dataset.id);
    }
  });

  // Drag and drop (mouse). Touch uses the arrow buttons.
  body.addEventListener('dragstart', (e) => {
    const tr = e.target.closest?.('tr[data-id]');
    if (!tr || sort.dir) return;
    dragging = tr.dataset.id;
    tr.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragging); } catch { /* some browsers refuse */ }
  });
  const clearMarks = () => body.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
  body.addEventListener('dragover', (e) => {
    if (!dragging) return;
    const tr = e.target.closest?.('tr[data-id]');
    if (!tr) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const box = tr.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    clearMarks();
    tr.classList.add(after ? 'drop-after' : 'drop-before');
  });
  body.addEventListener('drop', (e) => {
    if (!dragging) return;
    const tr = e.target.closest?.('tr[data-id]');
    e.preventDefault();
    const id = dragging;
    dragging = null;
    clearMarks();
    if (!tr || tr.dataset.id === id) { draw(); return; }
    const box = tr.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    const without = list.filter((x) => x !== id);
    let to = without.indexOf(tr.dataset.id) + (after ? 1 : 0);
    to = Math.max(0, Math.min(without.length, to));
    commit([...without.slice(0, to), id, ...without.slice(to)], id);
    ctx.status(`MOVED ${id}`);
  });
  body.addEventListener('dragend', () => {
    dragging = null;
    clearMarks();
    body.querySelectorAll('.is-dragging').forEach((r) => r.classList.remove('is-dragging'));
  });

  drawTop();
  draw();
  if (!list.length) ctx.status(warn ? 'WATCH: CHECK THE SYMBOLS' : 'WATCHLIST EMPTY', warn ? 'warn' : '');
  else ctx.status(warn ? 'WATCH: CHECK THE SYMBOLS' : 'LOADING...', warn ? 'warn' : '');
  load();
  ctx.live(load, 15_000);
}
