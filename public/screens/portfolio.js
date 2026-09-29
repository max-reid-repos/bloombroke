// PORTFOLIO (PF): holdings with live value, day gain, total gain and weights, a totals
// row and an allocation bar. USD only. Saved in this browser only.

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, panel, rerender, tick, settleTicks } from './markets.js';
import { freshTag } from '../freshness.js';
import { decimalsOf } from './quote.js';
import { fetchQuotes, rowActions, listTools } from './watch.js';
import {
  addLot, sellShares, removeHolding, setHolding, readPfForm, valuePortfolio, toCsv, parseCsv, plain,
  loadPortfolio, savePortfolio, MAX_HOLDINGS,
} from '../portfolio.js';
import { toolbar, emptyState } from '../kit.js';

const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}" data-example>${esc(c)}</a>`; // an example: saving ones prefill (app.js examplePlan)
const EXAMPLES = ['PF ADD AAPL 10 @ 150', 'PF SELL AAPL 3', 'PF REMOVE AAPL', 'PF EXPORT', 'PF IMPORT'];

// $1,234.56 and −$12.30. Money always shows cents.
export function usd(n, signed = false) {
  if (!Number.isFinite(n)) return '--';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Number(s.replace(/,/g, '')) === 0) return `$${s}`;
  if (n < 0) return `−$${s}`;
  return `${signed ? '+' : ''}$${s}`;
}

export function fmtShares(n) {
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '--';
}

// Allocation colours: blues, teals, greens and violets. Never amber.
export const ALLOC_COLORS = [
  'hsl(201, 100%, 71%)', 'hsl(174, 62%, 52%)', 'hsl(147, 55%, 55%)', 'hsl(262, 70%, 74%)',
  'hsl(222, 80%, 68%)', 'hsl(188, 70%, 44%)', 'hsl(315, 45%, 68%)', 'hsl(206, 45%, 76%)',
];

// The CSP allows no inline style attributes, so sizes and colours are set through the DOM.
export function paintAllocation(root) {
  root.querySelectorAll('[data-c]').forEach((n) => { n.style.background = ALLOC_COLORS[Number(n.dataset.c)] || ALLOC_COLORS[0]; });
  root.querySelectorAll('.alloc-seg[data-w]').forEach((n) => { n.style.flexGrow = n.dataset.w; });
}

export function pfTable(v) {
  const rows = v.rows.map((r) => {
    const qt = r.quote;
    const dec = qt ? decimalsOf(qt) : 2;
    const note = r.reason === 'currency' ? ` <span class="pf-flag" title="Quoted in ${esc(qt.currency)}, left out of the totals">${esc(qt.currency)}</span>` : '';
    const dd = dirOf(r.dayGain);
    const td = dirOf(r.totalGain);
    return `<tr class="row-link" data-cmd="${esc(r.ticker)}" data-id="${esc(r.ticker)}" tabindex="0">
      <th scope="row" class="pf-sym"><a href="${esc(q(r.ticker))}" data-cmd="${esc(r.ticker)}" tabindex="-1">${esc(r.ticker)}</a>${note}</th>
      <td class="name">${esc(qt ? (qt.label || qt.name || '') : r.reason === 'noquote' ? 'No quote right now' : '')}</td>
      <td class="num pf-nm">${fmtShares(r.shares)}</td>
      <td class="num pf-nm">${usd(r.cost)}</td>
      <td class="tag pf-nm">${freshTag(qt)}</td>
      <td class="num pf-nm last${qt ? tick(`pf:${r.ticker}:last`, qt.last) : ''}">${qt ? fmtNum(qt.last, dec) : '--'}</td>
      <td class="num pf-val">${r.ok ? usd(r.value) : '--'}</td>
      <td class="num pf-nm ${dd}">${r.ok ? usd(r.dayGain, true) : '--'}</td>
      <td class="num ${dd}">${r.ok ? fmtPct(r.dayPct) : '--'}</td>
      <td class="num pf-nm ${td}">${r.ok ? usd(r.totalGain, true) : '--'}</td>
      <td class="num ${td}">${r.ok ? fmtPct(r.totalPct) : '--'}</td>
      <td class="num pf-nm">${Number.isFinite(r.weight) ? `${fmtNum(r.weight, 1)}%` : '--'}</td>
      ${rowActions([
        { act: 'edit', label: 'EDIT', aria: `Edit ${r.ticker}: shares and average cost`, text: true },
        { act: 'remove', label: '×', aria: `Remove ${r.ticker} from the portfolio` },
      ])}
    </tr>`;
  }).join('');
  const t = v.totals;
  const dd = dirOf(t.dayGain);
  const td = dirOf(t.totalGain);
  return `<table class="grid-table pf-table">
    <thead><tr>
      <th scope="col" class="pf-sym">Ticker</th><th scope="col" class="name-h">Name</th><th scope="col" class="num pf-nm">Shares</th>
      <th scope="col" class="num pf-nm">Avg cost</th><th scope="col" class="tag pf-nm"><span class="offscreen">Real time or delayed</span></th>
      <th scope="col" class="num pf-nm">Last</th><th scope="col" class="num">Mkt value</th>
      <th scope="col" class="num pf-nm">Day $</th><th scope="col" class="num">Day %</th>
      <th scope="col" class="num pf-nm">Total $</th><th scope="col" class="num">Total %</th><th scope="col" class="num pf-nm">Weight</th>
      <th scope="col" class="wl-act"><span class="offscreen">Edit or remove</span></th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <th scope="row" class="pf-sym">Total</th><td class="name dim">${t.counted} of ${v.rows.length} holdings, USD</td><td class="pf-nm"></td>
      <td class="num pf-nm dim">${usd(t.basis)}</td><td class="tag pf-nm"></td><td class="pf-nm"></td>
      <td class="num pf-val">${usd(t.value)}</td>
      <td class="num pf-nm ${dd}">${usd(t.dayGain, true)}</td><td class="num ${dd}">${fmtPct(t.dayPct)}</td>
      <td class="num pf-nm ${td}">${usd(t.totalGain, true)}</td><td class="num ${td}"><span class="pf-ph">${usd(t.totalGain, true)}</span>${fmtPct(t.totalPct)}</td>
      <td class="num pf-nm">${t.counted ? '100.0%' : '--'}</td><td class="wl-act"></td>
    </tr></tfoot>
  </table>`;
}

// One bar, a segment per holding sized by weight, and a legend.
export function allocationHtml(v) {
  const rows = v.rows.filter((r) => Number.isFinite(r.weight) && r.weight > 0).sort((a, b) => b.weight - a.weight);
  if (!rows.length) return '<p class="panel-msg">Waiting for prices.</p>';
  const segs = rows.map((r, i) => `<span class="alloc-seg" data-w="${r.weight.toFixed(4)}" data-c="${i % ALLOC_COLORS.length}" title="${esc(r.ticker)} ${fmtNum(r.weight, 1)}%"></span>`).join('');
  const legend = rows.map((r, i) => `<li><span class="alloc-dot" data-c="${i % ALLOC_COLORS.length}" aria-hidden="true"></span><a href="${esc(q(r.ticker))}" data-cmd="${esc(r.ticker)}">${esc(r.ticker)}</a><span class="num">${fmtNum(r.weight, 1)}%</span><span class="num dim">${usd(r.value)}</span></li>`).join('');
  return `<div class="alloc-bar" role="img" aria-label="Allocation: ${esc(rows.map((r) => `${r.ticker} ${fmtNum(r.weight, 1)}%`).join(', '))}">${segs}</div><ul class="alloc-legend">${legend}</ul>`;
}

// Run the command's change. Returns { holdings, msg, warn }.
export function applyPf(holdings, a) {
  switch (a.action) {
    case 'add': {
      const had = holdings.find((h) => h.ticker === a.ticker);
      if (!had && holdings.length >= MAX_HOLDINGS) return { holdings, msg: `The portfolio holds ${MAX_HOLDINGS} tickers. Remove one first.`, warn: true };
      const next = addLot(holdings, a);
      const h = next.find((x) => x.ticker === a.ticker);
      const msg = had
        ? `Added ${fmtShares(a.shares)} ${a.ticker} at ${usd(a.cost)}. You now hold ${fmtShares(h.shares)} at an average ${usd(h.cost)}.`
        : `Added ${fmtShares(a.shares)} ${a.ticker} at ${usd(a.cost)}.`;
      return { holdings: next, msg };
    }
    case 'sell': {
      const r = sellShares(holdings, a.ticker, a.shares);
      if (r.error === 'none') return { holdings, msg: `You do not hold ${a.ticker}.`, warn: true };
      if (r.error === 'too_many') return { holdings, msg: `You hold ${fmtShares(r.held)} ${a.ticker}. You cannot sell more than that.`, warn: true };
      return { holdings: r.holdings, msg: r.left > 0 ? `Sold ${fmtShares(r.sold)} ${a.ticker}. ${fmtShares(r.left)} left, average cost unchanged.` : `Sold all ${fmtShares(r.sold)} ${a.ticker}.` };
    }
    case 'remove': {
      if (!holdings.some((h) => h.ticker === a.ticker)) return { holdings, msg: `You do not hold ${a.ticker}.`, warn: true };
      return { holdings: removeHolding(holdings, a.ticker), msg: `Removed ${a.ticker}.` };
    }
    case 'clear': return { holdings: [], msg: 'Cleared the portfolio.' };
    case 'import': return { holdings: a.holdings, msg: `Imported ${a.holdings.length} holding${a.holdings.length === 1 ? '' : 's'}. The old holdings are replaced.` };
    default: return { holdings, msg: '' };
  }
}

const ERRORS = {
  usage: 'Check the format.',
  shares: 'Shares must be a number above zero.',
  cost: 'The cost per share must be a number above zero.',
  csv: 'Some lines do not read as ticker,shares,cost',
};

function importBox() {
  return `<form class="pf-import" data-own-focus>
    <label for="pf-csv" class="dim">PASTE CSV: TICKER,SHARES,COST (ONE HOLDING PER LINE)</label>
    <textarea id="pf-csv" rows="6" spellcheck="false" placeholder="ticker,shares,cost&#10;AAPL,10,150&#10;MSFT,5,300"></textarea>
    <div class="pf-import-row">
      <label class="pf-file">Or pick a .csv file <input type="file" accept=".csv,text/csv,text/plain"></label>
      <button type="submit" class="pf-btn btn-solid">REPLACE HOLDINGS</button>
    </div>
  </form>`;
}

const FORM_ERRORS = {
  usage: 'Fill in a ticker, the shares and the price you paid.',
  shares: 'Shares must be a number above zero.',
  cost: 'The price must be a number above zero.',
};

// The PF add form. Placeholders are words, not sample numbers, so they never read as values.
export function pfForm() {
  return `<form class="add-form pf-form" data-own-focus autocomplete="off">
    <input class="add-in add-tk" name="ticker" type="text" maxlength="12" spellcheck="false" autocapitalize="characters" autocorrect="off" placeholder="Ticker" aria-label="Ticker">
    <input class="add-in add-num" name="shares" type="text" inputmode="decimal" maxlength="16" placeholder="Shares" aria-label="Shares">
    <input class="add-in add-num" name="price" type="text" inputmode="decimal" maxlength="16" placeholder="Price" aria-label="Price paid per share, USD">
    <button type="submit" class="chip add-btn">ADD</button>
    <button type="button" class="quiet add-cancel" hidden>CANCEL</button>
  </form>`;
}

// No holdings: the kit's empty state (the form above is the action).
export const emptyPfHtml = () => emptyState({ title: 'No holdings yet.', hint: 'Add one above: the ticker, how many shares, the price paid.' });

export function render(el, cmd, ctx) {
  const a = cmd.args || { action: 'show' };
  let holdings = loadPortfolio(ctx.store);
  let msg = '';
  let warn = false;
  let extra = '';

  if (a.error) {
    warn = true;
    if (a.error === 'kind') msg = `${a.ticker} is ${a.kind}. You cannot hold it directly. Try a fund that tracks it, like SPY for the S&P 500.`;
    else if (a.error === 'csv') msg = `${ERRORS.csv}: ${a.errors.map((x) => x.text).join(' ')}`;
    else msg = ERRORS[a.error] || ERRORS.usage;
  } else if (a.mutates) {
    const r = applyPf(holdings, a);
    holdings = r.holdings;
    msg = r.msg;
    warn = Boolean(r.warn);
    if (!warn) savePortfolio(ctx.store, holdings);
  } else if (a.action === 'export') {
    const csv = toCsv(holdings);
    extra = `<div class="pf-export"><textarea readonly rows="${Math.min(8, holdings.length + 1)}" aria-label="Your holdings as CSV" data-own-focus>${esc(csv)}</textarea><a class="pf-btn" download="bloombroke-portfolio.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}">DOWNLOAD CSV</a></div>`;
    msg = holdings.length ? 'Copying your holdings as CSV...' : 'No holdings to export.';
    if (holdings.length) {
      ctx.copy(csv).then((ok) => {
        const m = el.querySelector('.wl-msg');
        if (m) m.textContent = ok ? `Copied ${holdings.length} holdings as CSV. Paste them into PF IMPORT on any device.` : 'Copy the CSV from the box below.';
      });
    }
  } else if (a.action === 'import' && a.paste) {
    extra = importBox();
  }

  el.innerHTML = `<div class="stack">
    ${panel('1', 'Portfolio', `${toolbar({ left: pfForm(), right: '<span class="list-tools"></span>', label: 'Portfolio' })}<div class="pf-top"></div><div class="pf-body"></div>`, { metaId: 'pf-meta', meta: 'USD ONLY', bodyCls: 'flush' })}
    ${panel('2', 'Allocation', '<div class="pf-alloc"></div>', { metaId: 'pf-alloc-meta', meta: 'BY MARKET VALUE' })}
  </div>`;
  const top = el.querySelector('.pf-top');
  const body = el.querySelector('.pf-body');
  const alloc = el.querySelector('.pf-alloc');
  const allocPanel = alloc.closest('.panel');
  const tools = el.querySelector('.list-tools');
  const form = el.querySelector('.add-form');
  let byId = {};
  let confirming = false;
  let editing = null;

  function drawTools() {
    tools.innerHTML = listTools([
      { tool: 'import', label: 'IMPORT' },
      ...(holdings.length ? [{ tool: 'export', label: 'EXPORT' }, { tool: 'clear', label: 'CLEAR' }] : []),
    ], { confirming, count: holdings.length, what: holdings.length === 1 ? 'holding' : 'holdings' });
  }

  // The form adds a lot (merged into the average), or in edit mode sets a holding exactly.
  function setEditing(ticker) {
    editing = ticker;
    const h = holdings.find((x) => x.ticker === ticker);
    const f = form.elements;
    form.classList.toggle('is-editing', Boolean(h));
    f.ticker.readOnly = Boolean(h);
    f.ticker.value = h ? h.ticker : '';
    f.shares.value = h ? plain(h.shares) : '';
    f.price.value = h ? plain(h.cost, 4) : '';
    form.querySelector('.add-btn').textContent = h ? 'SAVE' : 'ADD';
    form.querySelector('.add-cancel').hidden = !h;
    if (h) f.shares.focus();
  }

  function commit(next, text) {
    holdings = next;
    savePortfolio(ctx.store, holdings);
    msg = text;
    warn = false;
    extra = '';
    confirming = false;
    drawTop();
    draw();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const a = readPfForm({ ticker: f.ticker.value, shares: f.shares.value, price: f.price.value });
    if (a.error) {
      msg = a.error === 'kind' ? `${a.ticker} is ${a.kind}. You cannot hold it directly. Try a fund that tracks it, like SPY for the S&P 500.` : FORM_ERRORS[a.error] || FORM_ERRORS.usage;
      warn = true;
      drawTop();
      ctx.status('PF: CHECK THE FORM', 'warn');
      return;
    }
    if (editing) {
      commit(setHolding(holdings, { ticker: editing, shares: a.shares, cost: a.cost }), `Saved ${editing}: ${fmtShares(a.shares)} shares at an average ${usd(a.cost)}.`);
      ctx.status(`SAVED ${editing}`);
      setEditing(null);
    } else {
      const r = applyPf(holdings, a);
      if (r.warn) { msg = r.msg; warn = true; drawTop(); ctx.status('PF: CHECK THE FORM', 'warn'); return; }
      commit(r.holdings, r.msg);
      ctx.status(`ADDED ${a.ticker}`);
      setEditing(null);
    }
    load();
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('.add-cancel')) { e.preventDefault(); setEditing(null); }
  });

  tools.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]')?.dataset.tool;
    if (!t) return;
    e.stopPropagation();
    if (t === 'import') { ctx.run('PF IMPORT'); return; }
    if (t === 'export') { ctx.run('PF EXPORT'); return; }
    if (t === 'clear') { confirming = true; drawTools(); tools.querySelector('[data-tool="clear-no"]')?.focus(); return; }
    if (t === 'clear-no') { confirming = false; drawTools(); return; }
    if (t === 'clear-yes') { setEditing(null); commit([], 'Cleared the portfolio.'); ctx.status('PORTFOLIO CLEARED'); }
  });

  // Row actions: edit fills the form, × removes. They must not open the row.
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.wl-btn');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const id = btn.closest('tr')?.dataset.id;
    if (!id) return;
    if (btn.dataset.act === 'edit') { setEditing(id); ctx.status(`EDITING ${id}`); return; }
    if (btn.dataset.act === 'remove') {
      if (editing === id) setEditing(null);
      commit(removeHolding(holdings, id), `Removed ${id}.`);
      ctx.status(`REMOVED ${id}`);
    }
  });

  function drawTop() {
    drawTools();
    top.innerHTML = `${msg ? `<p class="wl-msg${warn ? ' is-warn' : ''}" role="status">${esc(msg)}</p>` : ''}${extra}${a.error ? `<p class="muted examples">Try ${EXAMPLES.map(code).join(' ')}</p>` : ''}`;
  }

  function draw() {
    if (!holdings.length) {
      body.innerHTML = emptyPfHtml();
      allocPanel.hidden = true;
      return;
    }
    const v = valuePortfolio(holdings, byId);
    rerender(body, pfTable(v));
    settleTicks(body);
    allocPanel.hidden = false;
    alloc.innerHTML = allocationHtml(v);
    paintAllocation(alloc);
  }

  async function load() {
    if (!holdings.length) return;
    try {
      const r = await fetchQuotes(ctx, holdings.map((h) => h.ticker));
      byId = r.byId;
      draw();
      ctx.updated(r.data.updated, r.data.stale, r.data.quotes);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH THE PORTFOLIO', 'warn');
    }
  }

  // The paste box: text or a file, then replace.
  top.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200_000) { ctx.status('THAT FILE IS TOO BIG FOR A HOLDINGS LIST', 'warn'); return; }
    try { top.querySelector('#pf-csv').value = await file.text(); } catch { ctx.status('COULD NOT READ THE FILE', 'warn'); }
  });
  top.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = top.querySelector('#pf-csv')?.value || '';
    const r = parseCsv(text);
    if (r.errors.length || !r.holdings.length) {
      msg = r.holdings.length || r.errors.length ? `${ERRORS.csv}: line ${r.errors.map((x) => x.line).join(', ')}.` : 'Paste at least one line: AAPL,10,150';
      warn = true;
      const keep = text;
      drawTop();
      top.querySelector('#pf-csv').value = keep;
      return;
    }
    holdings = r.holdings;
    savePortfolio(ctx.store, holdings);
    msg = `Imported ${holdings.length} holding${holdings.length === 1 ? '' : 's'}. The old holdings are replaced.`;
    warn = false;
    extra = '';
    drawTop();
    draw();
    load();
  });

  drawTop();
  draw();
  if (warn) ctx.status('PF: CHECK THE COMMAND', 'warn');
  else if (!holdings.length) ctx.status('PORTFOLIO EMPTY');
  else ctx.status('LOADING...');
  load();
  ctx.live(load, 15_000);
}
