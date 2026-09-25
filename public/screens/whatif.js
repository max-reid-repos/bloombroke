// WHATIF: "the stock you should have bought". A picker of things people bought, and a
// receipt of what that money would be worth today in the maker's stock.
//
// WHATIF                      the picker
// WHATIF IPHONE               the picker, with every iPhone picked
// WHATIF EDIT IPHONE6 LATTE   the picker, with these picked
// WHATIF IPHONE6 LATTE:3Y     the result

import { esc, q, fmtNum, panel, LOADING, nyTime } from './markets.js';

let catalogCache = null;
async function loadCatalog(ctx) {
  if (!catalogCache) catalogCache = await ctx.fetchJSON('/api/whatif/catalog', { signal: ctx.signal });
  return catalogCache;
}

// ---- Pure helpers (tested) ------------------------------------------------------

const word = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const allItems = (cat) => [...cat.products, ...cat.recurring];

// Which ids a family word (IPHONE, APPLE, CAR) covers.
export function familyIds(cat, fam) {
  const f = word(fam);
  const hit = (w) => w === f || w === f.replace(/S$/, '');
  return allItems(cat).filter((p) => hit(word(p.family)) || hit(word(p.company)) || hit(word(p.category))).map((p) => p.id);
}

// Tokens -> { mode: 'picker' | 'result', picks: Map(id -> spec) }
export function planWhatif(tokens, cat) {
  const ids = new Map(allItems(cat).map((p) => [p.id.toUpperCase(), p]));
  const edit = tokens[0] === 'EDIT';
  const toks = edit ? tokens.slice(1) : tokens;
  const picks = new Map();
  let families = 0;
  for (const t of toks) {
    const [head, spec = ''] = t.split(':');
    const item = ids.get(head);
    if (item) { picks.set(item.id, spec); continue; }
    const fam = familyIds(cat, head);
    if (fam.length && !spec) { families += 1; fam.forEach((id) => { if (!picks.has(id)) picks.set(id, ''); }); continue; }
    return { mode: 'result', picks }; // unknown word: the server explains it
  }
  const mode = edit || !toks.length || families === toks.length ? 'picker' : 'result';
  return { mode, picks };
}

// Years box -> spec. "5" and "5Y" -> "5Y"; "2015" and "2015-2024" stay.
export function normalizeSpec(v, fallbackYears) {
  const s = String(v || '').trim().toUpperCase();
  if (/^\d{1,2}$/.test(s)) return `${s}Y`;
  if (/^\d{1,2}Y$/.test(s) || /^\d{4}(-\d{4})?$/.test(s)) return s;
  return `${fallbackYears}Y`;
}

export function commandFor(picks, cat) {
  const out = ['WHATIF'];
  for (const p of allItems(cat)) {
    if (!picks.has(p.id)) continue;
    const spec = p.kind === 'monthly' ? normalizeSpec(picks.get(p.id), p.defaultYears) : '';
    out.push((spec ? `${p.id}:${spec}` : p.id).toUpperCase());
  }
  return out.join(' ');
}

export function fmtUsd(n) {
  if (!Number.isFinite(n)) return '--';
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : 2;
  return (n < 0 ? '−' : '') + '$' + a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const fmtX = (m) => (Number.isFinite(m) ? `${m >= 100 ? fmtNum(m, 0) : fmtNum(m, 2)}x` : '--');
export const fmtShares = (n) => (n >= 1000 ? fmtNum(n, 0) : n >= 1 ? fmtNum(n, 3) : fmtNum(n, 4));

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function fmtDay(isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}
export function fmtMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// One dry line, picked by outcome. The same command always gets the same line.
export const QUIPS = {
  big: [
    'You bought the product. You should have bought the company.',
    'The gadget is in a drawer somewhere. The stock is not.',
    'Somewhere, a shareholder thanks you for your purchase.',
    'The receipt says you spent it. The chart says you could have kept it.',
  ],
  gain: [
    'Not bad. Still, the stock did better than the gadget.',
    'The stock beat the stuff. It usually does.',
    'The money grew. You just were not holding it.',
    'A decent return, on money you already spent.',
  ],
  loss: [
    'Good news: you dodged this one.',
    'For once, spending it was the smart move.',
    'You lost less by buying the thing.',
    'The product held up better than the stock.',
  ],
};
export function hashText(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function quipFor(multiple, key) {
  const bucket = multiple > 5 ? 'big' : multiple >= 1 ? 'gain' : 'loss';
  const list = QUIPS[bucket];
  return list[hashText(key) % list.length];
}

// ---- Picker ---------------------------------------------------------------------

const EXAMPLES = ['WHATIF IPHONE6 IPHONE8 LATTE:3Y', 'WHATIF MODEL3 RTX3080', 'WHATIF NETFLIX:2015-2024 PRIME:10Y', 'WHATIF PELOTON GOPRO BLACKBERRY'];
const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

function groupsOf(cat) {
  const groups = new Map();
  for (const p of allItems(cat)) {
    const key = p.kind === 'monthly' ? 'Habits, bought every month' : p.company;
    if (!groups.has(key)) groups.set(key, { name: key, ticker: p.kind === 'monthly' ? '' : p.ticker, items: [] });
    groups.get(key).items.push(p);
  }
  return [...groups.values()];
}

function itemRow(p, picks) {
  const on = picks.has(p.id);
  const box = `<span class="wi-box" aria-hidden="true">${on ? '[x]' : '[ ]'}</span>`;
  if (p.kind === 'monthly') {
    const spec = picks.get(p.id) || `${p.defaultYears}Y`;
    return `<li class="wi-item${on ? ' is-on' : ''}" role="option" aria-selected="${on}" tabindex="-1" data-id="${esc(p.id)}">
      ${box}<span class="wi-name">${esc(p.name)} <span class="dim">${esc(p.ticker)}</span></span>
      <label class="wi-years"><span class="offscreen">Years or dates for ${esc(p.name)}</span><input type="text" inputmode="text" maxlength="9" value="${esc(spec)}" data-spec="${esc(p.id)}" spellcheck="false" autocomplete="off"></label>
    </li>`;
  }
  return `<li class="wi-item${on ? ' is-on' : ''}" role="option" aria-selected="${on}" tabindex="-1" data-id="${esc(p.id)}">
    ${box}<span class="wi-name">${esc(p.name)}</span><span class="wi-meta num">${esc(p.date.slice(0, 4))} ${esc(fmtUsd(p.price))}</span>
  </li>`;
}

function renderPicker(el, ctx, cat, picks) {
  const groups = groupsOf(cat);
  el.innerHTML = panel('1', 'WHATIF: the stock you should have bought', `
    <p class="wi-intro">Pick the things you bought. See what that money would be worth today in the maker's stock.</p>
    <div class="wi-groups" role="listbox" aria-multiselectable="true" aria-label="Things you bought" data-own-focus>
      ${groups.map((g) => `<section class="wi-group">
        <h3 class="wi-co">${esc(g.name.toUpperCase())}${g.ticker ? ` <span class="dim">${esc(g.ticker)}</span>` : ''}</h3>
        <ul>${g.items.map((p) => itemRow(p, picks)).join('')}</ul>
      </section>`).join('')}
    </div>
    <div class="wi-bar">
      <span class="wi-count" id="wi-count"></span>
      <span class="wi-cmd code" id="wi-cmd"></span>
      <span class="wi-keys dim"><kbd>Space</kbd> pick <kbd>Enter</kbd> run</span>
      <button type="button" class="wi-run" id="wi-run">RUN</button>
    </div>`, { cls: 'panel-solo', meta: 'ARROWS MOVE, SPACE PICKS' })
    + `<p class="footnote">Or type it: ${EXAMPLES.slice(0, 2).map(code).join(' ')}. Habits take years (<span class="code">LATTE:3Y</span>) or dates (<span class="code">NETFLIX:2015-2024</span>).</p>`;

  const list = el.querySelector('.wi-groups');
  const rows = [...el.querySelectorAll('.wi-item')];
  const countEl = el.querySelector('#wi-count');
  const cmdEl = el.querySelector('#wi-cmd');
  const byId = new Map(allItems(cat).map((p) => [p.id, p]));

  function refresh() {
    const once = [...picks.keys()].map((id) => byId.get(id)).filter((p) => p.kind === 'once');
    const spent = once.reduce((n, p) => n + p.price, 0);
    countEl.textContent = picks.size ? `${picks.size} PICKED${once.length ? `, ${fmtUsd(spent)} ONE-OFF` : ''}` : 'NOTHING PICKED';
    cmdEl.textContent = picks.size ? commandFor(picks, cat) : 'WHATIF ...';
    ctx.status(picks.size ? `WHATIF: ${picks.size} PICKED` : 'WHATIF: PICK WHAT YOU BOUGHT');
  }

  function toggle(row) {
    const id = row.dataset.id;
    if (picks.has(id)) picks.delete(id);
    else picks.set(id, row.querySelector('input')?.value || '');
    const on = picks.has(id);
    row.classList.toggle('is-on', on);
    row.setAttribute('aria-selected', String(on));
    row.querySelector('.wi-box').textContent = on ? '[x]' : '[ ]';
    refresh();
  }

  function focusRow(i) {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    rows.forEach((x) => { x.tabIndex = -1; });
    r.tabIndex = 0;
    r.focus({ preventScroll: false });
    r.scrollIntoView({ block: 'nearest' });
  }

  function runPicks() {
    for (const inp of el.querySelectorAll('input[data-spec]')) {
      if (picks.has(inp.dataset.spec)) picks.set(inp.dataset.spec, inp.value);
    }
    if (!picks.size) { ctx.status('PICK AT LEAST ONE THING', 'warn'); return; }
    ctx.run(commandFor(picks, cat));
  }

  list.addEventListener('keydown', (e) => {
    const inInput = e.target.matches('input');
    const row = e.target.closest('.wi-item');
    if (!row) return;
    const i = rows.indexOf(row);
    if (inInput) {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); runPicks(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); focusRow(i); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); focusRow(i + (e.key === 'ArrowDown' ? 1 : -1)); }
      return;
    }
    const groupStart = (dir) => {
      const g = row.closest('.wi-group');
      const target = dir > 0 ? g.nextElementSibling : g.previousElementSibling;
      return target ? rows.indexOf(target.querySelector('.wi-item')) : i;
    };
    const keys = {
      ArrowDown: () => focusRow(i + 1),
      ArrowUp: () => focusRow(i - 1),
      ArrowRight: () => { const inp = row.querySelector('input'); if (inp) inp.focus(); else focusRow(groupStart(1)); },
      ArrowLeft: () => focusRow(groupStart(-1)),
      Home: () => focusRow(0),
      End: () => focusRow(rows.length - 1),
      ' ': () => toggle(row),
      Enter: () => runPicks(),
    };
    if (keys[e.key]) { e.preventDefault(); e.stopPropagation(); keys[e.key](); }
  });

  list.addEventListener('click', (e) => {
    const row = e.target.closest('.wi-item');
    if (!row || e.target.matches('input')) return;
    toggle(row);
    rows.forEach((x) => { x.tabIndex = -1; });
    row.tabIndex = 0;
    row.focus({ preventScroll: true });
  });

  list.addEventListener('input', (e) => {
    const id = e.target.dataset.spec;
    if (!id) return;
    if (!picks.has(id)) {
      const row = e.target.closest('.wi-item');
      picks.set(id, e.target.value);
      row.classList.add('is-on');
      row.setAttribute('aria-selected', 'true');
      row.querySelector('.wi-box').textContent = '[x]';
    } else {
      picks.set(id, e.target.value);
    }
    refresh();
  });

  list.addEventListener('focusin', (e) => { if (e.target.matches('input[data-spec]')) e.target.select(); });
  el.querySelector('#wi-run').addEventListener('click', runPicks);
  refresh();

  // Start on the first picked row (or the first row) so the arrows work at once.
  const first = Math.max(0, rows.findIndex((r) => picks.has(r.dataset.id)));
  rows[first].tabIndex = 0;
  if (!window.matchMedia('(pointer: coarse)').matches) setTimeout(() => { if (rows[first].isConnected) focusRow(first); }, 0);
}

// ---- Result ---------------------------------------------------------------------

function resultHtml(d, key) {
  const t = d.total;
  const dir = t.multiple >= 1 ? 'up' : 'down';
  const pct = `${t.pct >= 0 ? '+' : '−'}${fmtNum(Math.abs(t.pct), 0)}%`;
  const rows = d.rows.map((r) => {
    const loss = r.multiple < 1;
    const bought = r.kind === 'once'
      ? fmtDay(r.bought)
      : `${fmtMonth(r.from)} TO ${fmtMonth(r.to)}<span class="dim"> (${r.buys})</span>`;
    return `<tr class="${loss ? 'is-loss' : ''}">
      <th scope="row" class="name"><a href="${esc(q(`${r.ticker} 5Y`))}" data-cmd="${esc(`${r.ticker} 5Y`)}">${esc(r.name)}</a> <span class="dim">${esc(r.ticker)}</span><span class="wi-when-m dim">${bought}</span></th>
      <td class="num wi-when">${bought}</td>
      <td class="num">${esc(fmtUsd(r.paid))}</td>
      <td class="num wi-sh">${esc(fmtShares(r.shares))}</td>
      <td class="num last ${loss ? 'down' : ''}">${esc(fmtUsd(r.value))}</td>
      <td class="num ${loss ? 'down' : 'up'}">${esc(fmtX(r.multiple))}</td>
    </tr>`;
  }).join('');
  const asOf = d.asOf ? (/^\d{4}-\d{2}-\d{2}$/.test(d.asOf) ? `the ${fmtDay(d.asOf)} close` : `${nyTime(d.asOf)} ET`) : 'now';
  const notes = d.rows.map((r) => `<li><span class="wi-note-name">${esc(r.name)}</span> ${esc(r.note || '')}${r.clamped ? ' Starts when the shares began trading.' : ''} <a href="${esc(r.src)}" target="_blank" rel="noopener noreferrer">source</a></li>`).join('');
  const editCmd = `WHATIF EDIT ${key.replace(/^WHATIF\s*/, '')}`;
  return `
    <p class="wi-sentence">You spent <span class="num">${esc(fmtUsd(t.paid))}</span>. In the stock, that is <span class="num ${dir}">${esc(fmtUsd(t.value))}</span>.</p>
    <p class="hero num"><span class="hero-value ${dir}">${esc(fmtUsd(t.value))}</span><span class="hero-unit">TODAY</span></p>
    <p class="wi-mult num"><span class="${dir}">${esc(fmtX(t.multiple))}</span> <span class="${dir}">${esc(pct)}</span></p>
    <p class="wi-quip">${esc(quipFor(t.multiple, key))}</p>
    <div class="wi-receipt">
      <table class="grid-table wi-table">
        <thead><tr><th scope="col">Item</th><th scope="col" class="num wi-when">Bought</th><th scope="col" class="num">Paid</th><th scope="col" class="num wi-sh">Shares</th><th scope="col" class="num">Worth now</th><th scope="col" class="num">x</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row" class="name">Total</th><td class="wi-when"></td><td class="num">${esc(fmtUsd(t.paid))}</td><td class="wi-sh"></td><td class="num last ${dir}">${esc(fmtUsd(t.value))}</td><td class="num ${dir}">${esc(fmtX(t.multiple))}</td></tr></tfoot>
      </table>
    </div>
    <p class="wi-source">Prices: close on purchase date, split-adjusted, price return only. Live price as of ${esc(asOf)}${d.stale ? ' (last known)' : ''}. Source: ${esc(d.source)}.</p>
    <div class="wi-actions">
      <a class="code" href="${esc(q(editCmd))}" data-cmd="${esc(editCmd)}">CHANGE PICKS</a>
      <a class="code" href="${esc(q('WHATIF'))}" data-cmd="WHATIF">START OVER</a>
    </div>
    <details class="how">
      <summary>How is this calculated?</summary>
      <ul class="how-list">
        <li>Shares: the price you paid, divided by the stock's split-adjusted close on the day you bought it (or the last trading day before).</li>
        <li>Worth now: those shares times today's price.</li>
        <li>Habits: one buy a month, on the first trading day, of what that month cost you.</li>
        <li>Price return only. Dividends and spin-offs are left out, so long holds come out a little low.</li>
      </ul>
    </details>
    <details class="how">
      <summary>Notes and sources</summary>
      <ul class="how-list">${notes}</ul>
    </details>`;
}

function errorView(el, message) {
  el.innerHTML = panel('1', 'WHATIF', `
    <p class="notice">${esc(message)}</p>
    <p class="muted">Type ${code('WHATIF')} to pick from the list, or try one of these.</p>
    <p class="muted examples">${EXAMPLES.map(code).join(' ')}</p>`, { cls: 'panel-solo' });
}

export function render(el, cmd, ctx) {
  const tokens = cmd.args?.tokens || [];
  el.innerHTML = panel('1', 'WHATIF', LOADING, { cls: 'panel-solo' });
  loadCatalog(ctx).then((cat) => {
    const plan = planWhatif(tokens, cat);
    if (plan.mode === 'picker') { renderPicker(el, ctx, cat, plan.picks); return null; }
    ctx.status('WHATIF: DOING THE MATHS');
    const key = cmd.input;
    return ctx.fetchJSON(`/api/whatif?${new URLSearchParams({ c: tokens.join(' ') })}`, { signal: ctx.signal }).then((d) => {
      if (d.picker) { renderPicker(el, ctx, cat, plan.picks); return; }
      el.innerHTML = panel('1', 'WHATIF: the stock you should have bought', resultHtml(d, key), {
        cls: 'panel-solo', meta: `${d.rows.length} ${d.rows.length === 1 ? 'ITEM' : 'ITEMS'}`,
      }) + '<p class="footnote">Not financial advice. Past returns say nothing about future ones.</p>';
      ctx.status(`WHATIF: ${fmtX(d.total.multiple)}${d.stale ? ' (LAST KNOWN PRICES)' : ''}`, d.stale ? 'warn' : '');
    });
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    errorView(el, err.message);
    ctx.status('WHATIF: CHECK THE LIST', 'warn');
  });
}
