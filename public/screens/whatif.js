// WHATIF: in hindsight, the maker's stock instead of the thing. A picker of things people bought, and a
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
// Hindsight only: the lines describe what happened, never what anyone should do.
export const QUIPS = {
  big: [
    'In hindsight, the company did better than the product.',
    'The gadget is in a drawer somewhere. The stock is not.',
    'Somewhere, a shareholder thanks you for your purchase.',
    'The receipt says you spent it. Hindsight says it grew.',
  ],
  gain: [
    'Not bad. In hindsight, the stock did better than the gadget.',
    'This time, the stock beat the stuff.',
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
export const WHATIF_TITLE = 'WHATIF: what if you had bought the stock?';
export const HINDSIGHT_NOTE = 'Hindsight only. Past returns do not predict future returns. Not a recommendation.';

// "−43%". Drops are shown with a real minus sign.
export function fmtDrop(pct) {
  if (!Number.isFinite(pct)) return '--';
  const r = Math.round(Math.abs(pct));
  return r === 0 ? '0%' : `−${r}%`;
}
const dropWhen = (month) => (month === 'now' ? 'today' : /^\d{4}-\d{2}$/.test(month || '') ? fmtMonth(month) : '');

// The risk line under every result: the worst fall of a holding between its purchase and
// today, at month-end prices. Several holdings: the worst one, named.
export function riskLine(d) {
  const w = d.risk?.worst;
  if (!w) return 'Worst drop along the way: not available right now. Prices can fall a long way before they recover.';
  if (w.pct > -0.5) return 'Worst drop along the way: none at month-end prices, so far. That can change.';
  const when = dropWhen(w.month);
  const who = d.rows.length > 1 ? `, in ${w.ticker} (${w.name})` : '';
  return `Worst drop along the way: ${fmtDrop(w.pct)}${when ? ` (${when})` : ''}${who}, based on month-end prices.`;
}

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
  el.innerHTML = panel('1', WHATIF_TITLE, `
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

// ---- Certificate ----------------------------------------------------------------
// The server sends the words and numbers (d.cert, from data/whatif-cert.js); the same
// ones are drawn on the share image at /og/whatif.png.

const art = (file) => new URL(`../img/whatif/${file}`, import.meta.url).href;

export function shareLinks(m, origin) {
  const url = `${origin}/${q(m.command)}`;
  return {
    url,
    x: `https://x.com/intent/post?${new URLSearchParams({ text: m.share, url })}`,
    image: `/og/whatif.png?${new URLSearchParams({ c: m.command })}`,
  };
}

// Type sizes arrive as % of the certificate width; the CSP allows no inline styles, so
// they are set through the DOM after render (see sizeCert).
export function certHtml(m, links) {
  const alt = `A certificate: ${m.ribbon}, worth ${m.big} today. ${m.spent}. ${m.holding}. ${m.multiple}.`;
  return `<figure class="wi-cert${m.loss ? ' is-loss' : ''}">
      <img class="wc-paper" src="${esc(art('certificate.webp'))}" width="1536" height="1024" alt="${esc(alt)}">
      <div class="wc wc-receipt" aria-hidden="true">${m.receipt.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
      <div class="wc wc-ribbon" data-fs="${esc(m.fit.ribbon)}" aria-hidden="true">${esc(m.ribbon)}</div>
      <div class="wc wc-big" data-fs="${esc(m.fit.big)}" aria-hidden="true">${esc(m.big)}</div>
      <div class="wc wc-today" aria-hidden="true">worth today</div>
      <div class="wc wc-l1" data-fs="${esc(m.fit.lines)}" aria-hidden="true">${esc(m.spent)}</div>
      <div class="wc wc-l2" data-fs="${esc(m.fit.lines)}" aria-hidden="true">${esc(m.holding)}</div>
      <div class="wc wc-mult" data-fs="${esc(m.fit.mult)}" aria-hidden="true">${esc(m.multiple)}</div>
      ${m.loss ? '<div class="wc wc-strike" aria-hidden="true"></div><div class="wc wc-dodged" aria-hidden="true">dodged</div>' : ''}
      <img class="wc-sticker" src="${esc(art(`doodle-${m.doodle}.webp`))}" width="384" height="384" alt="">
    </figure>
    <div class="wi-share">
      <a class="wi-btn" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer">SHARE ON X</a>
      <a class="wi-btn" href="${esc(links.image)}" download="bloombroke-whatif.png">DOWNLOAD IMAGE</a>
      <button type="button" class="wi-btn" data-copy="${esc(links.url)}">COPY LINK</button>
    </div>`;
}

function sizeCert(el) {
  for (const n of el.querySelectorAll('.wi-cert [data-fs]')) {
    const v = Number(n.dataset.fs);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (n.matches('.wc-l1, .wc-l2')) n.style.setProperty('--fs', String(v));
    else n.style.fontSize = `${v}cqw`;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---- Result ---------------------------------------------------------------------

function resultHtml(d, key, links) {
  const t = d.total;
  const dir = t.multiple >= 1 ? 'up' : 'down';
  const pct = `${t.pct >= 0 ? '+' : '−'}${fmtNum(Math.abs(t.pct), 0)}%`;
  const rows = d.rows.map((r) => {
    const loss = r.multiple < 1;
    const bought = r.kind === 'once'
      ? fmtDay(r.bought)
      : `${fmtMonth(r.from)} TO ${fmtMonth(r.to)}<span class="dim"> (${r.buys})</span>`;
    // The row opens the stock's chart from the day it was bought.
    const start = r.kind === 'once' ? r.bought : /^\d{4}-\d{2}$/.test(r.from || '') ? `${r.from}-01` : r.from;
    const cmd = /^\d{4}-\d{2}-\d{2}$/.test(start || '') ? `${r.ticker} FROM ${start}` : `${r.ticker} 5Y`;
    return `<tr class="row-link${loss ? ' is-loss' : ''}" data-cmd="${esc(cmd)}" tabindex="0">
      <th scope="row" class="name"><a href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" tabindex="-1">${esc(r.name)}</a> <a class="dim wi-tk" href="${esc(q(r.ticker))}" data-cmd="${esc(r.ticker)}" tabindex="-1">${esc(r.ticker)}</a><span class="wi-when-m dim">${bought}</span></th>
      <td class="num wi-when">${bought}</td>
      <td class="num">${esc(fmtUsd(r.paid))}</td>
      <td class="num wi-sh">${esc(fmtShares(r.shares))}</td>
      <td class="num last ${loss ? 'down' : ''}">${esc(fmtUsd(r.value))}</td>
      <td class="num ${loss ? 'down' : 'up'}">${esc(fmtX(r.multiple))}</td>
      <td class="num wi-dd${r.worstDrop && r.worstDrop.pct <= -0.5 ? ' down' : ' dim'}"${r.worstDrop?.month ? ` title="${esc(dropWhen(r.worstDrop.month))}"` : ''}>${r.worstDrop ? esc(fmtDrop(r.worstDrop.pct)) : '--'}</td>
    </tr>`;
  }).join('');
  const asOf = d.asOf ? (/^\d{4}-\d{2}-\d{2}$/.test(d.asOf) ? `the ${fmtDay(d.asOf)} close` : `${nyTime(d.asOf)} ET`) : 'now';
  const notes = d.rows.map((r) => `<li><span class="wi-note-name">${esc(r.name)}</span> ${esc(r.note || '')}${r.clamped ? ' Starts when the shares began trading.' : ''} <a href="${esc(r.src)}" target="_blank" rel="noopener noreferrer">source</a></li>`).join('');
  const editCmd = `WHATIF EDIT ${key.replace(/^WHATIF\s*/, '')}`;
  return `
    <div class="wi-layout${d.cert ? '' : ' no-cert'}">
    <div class="wi-head">
    <p class="wi-sentence">You spent <span class="num">${esc(fmtUsd(t.paid))}</span>. In the stock, that is <span class="num ${dir}">${esc(fmtUsd(t.value))}</span>.</p>
    <p class="hero num"><span class="hero-value ${dir}">${esc(fmtUsd(t.value))}</span><span class="hero-unit">TODAY</span></p>
    <p class="wi-mult num"><span class="${dir}">${esc(fmtX(t.multiple))}</span> <span class="${dir}">${esc(pct)}</span></p>
    <p class="wi-quip">${esc(quipFor(t.multiple, key))}</p>
    <p class="wi-risk">${esc(riskLine(d))}</p>
    </div>
    ${d.cert ? `<div class="wi-certcol">${certHtml(d.cert, links)}</div>` : ''}
    <div class="wi-body">
    <div class="wi-receipt">
      <table class="grid-table wi-table">
        <thead><tr><th scope="col">Item</th><th scope="col" class="num wi-when">Bought</th><th scope="col" class="num">Paid</th><th scope="col" class="num wi-sh">Shares</th><th scope="col" class="num">Worth now</th><th scope="col" class="num">x</th><th scope="col" class="num wi-dd" title="Worst drop along the way, month-end prices">Worst drop</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row" class="name">Total</th><td class="wi-when"></td><td class="num">${esc(fmtUsd(t.paid))}</td><td class="wi-sh"></td><td class="num last ${dir}">${esc(fmtUsd(t.value))}</td><td class="num ${dir}">${esc(fmtX(t.multiple))}</td><td class="wi-dd"></td></tr></tfoot>
      </table>
    </div>
    <p class="wi-source">Prices: close on purchase date, split-adjusted, price return only. Live price as of ${esc(asOf)}${d.stale ? ' (last known)' : ''}. Source: ${esc(d.source)}.</p>
    <div class="wi-actions">
      <a class="code" href="${esc(q(editCmd))}" data-cmd="${esc(editCmd)}">CHANGE PICKS</a>
      <a class="code" href="${esc(q('WHATIF'))}" data-cmd="WHATIF">START OVER</a>
    </div>
    </div>
    </div>
    <details class="how">
      <summary>How is this calculated?</summary>
      <ul class="how-list">
        <li>Shares: the price you paid, divided by the stock's split-adjusted close on the day you bought it (or the last trading day before).</li>
        <li>Worth now: those shares times today's price.</li>
        <li>Habits: one buy a month, on the first trading day, of what that month cost you.</li>
        <li>Price return only. Dividends and spin-offs are left out, so long holds come out a little low.</li>
        <li>Worst drop: the biggest fall from a high to a later low, using the price on the day of the first buy, each month-end close after it and today's price. Falls within a month can be deeper.</li>
        <li>Hindsight: the list is picked after the fact. Nobody knew these results when the money was spent. Costs, taxes and currency moves are left out.</li>
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
      const links = d.cert ? shareLinks(d.cert, location.origin) : null;
      el.innerHTML = panel('1', WHATIF_TITLE, resultHtml(d, key, links), {
        cls: 'panel-solo', meta: `${d.rows.length} ${d.rows.length === 1 ? 'ITEM' : 'ITEMS'}`,
      }) + `<p class="footnote">${esc(HINDSIGHT_NOTE)}</p>`;
      sizeCert(el);
      el.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
        const ok = await copyText(e.currentTarget.dataset.copy);
        ctx.status(ok ? 'LINK COPIED' : 'COPY THE LINK FROM THE ADDRESS BAR', ok ? '' : 'warn');
      });
      ctx.status(`WHATIF: ${fmtX(d.total.multiple)}${d.stale ? ' (LAST KNOWN PRICES)' : ''}`, d.stale ? 'warn' : '');
    });
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    errorView(el, err.message);
    ctx.status('WHATIF: CHECK THE LIST', 'warn');
  });
}
