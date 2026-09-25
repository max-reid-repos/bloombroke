// TAPE: your own ticker tape (Pro). TAPE ADD AAPL, TAPE REMOVE AAPL, TAPE RESET.
// Free users see one line saying it is a Pro feature, with the price.

import { esc, q, panel } from './markets.js';
import * as pro from '../pro.js';
import { instrumentById } from '../instruments.js';

export function parse(args) {
  return pro.parseTape(args);
}

const link = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

function usage(cmd) {
  const title = cmd.error === 'symbol' ? `${cmd.args.bad} is not a ticker.` : 'TAPE needs ADD, REMOVE or RESET.';
  return `<p class="notice">${esc(title)}</p>
    <p class="muted">Format: <span class="code">TAPE ADD &lt;tickers&gt;</span>, <span class="code">TAPE REMOVE &lt;tickers&gt;</span> or <span class="code">TAPE RESET</span>.</p>
    <p class="muted examples">Try ${['TAPE ADD AAPL', 'TAPE ADD NVDA TSLA', 'TAPE RESET'].map(link).join(' ')}</p>`;
}

function listHtml(list, custom) {
  const items = list.map((s) => `<li class="pro-row"><a class="pro-feat code" href="${esc(q(s))}" data-cmd="${esc(s)}">${esc(s)}</a><span class="pro-text">${esc(instrumentById(s)?.name || '')}</span></li>`).join('');
  return `<p class="fx-from">${custom ? 'Your tape' : 'The standard tape'}: ${list.length} of ${pro.MAX_TAPE}.</p><ul class="pro-list">${items}</ul>`;
}

function show(el, ctx, note, kind = '') {
  const custom = pro.getTape();
  const list = custom || pro.DEFAULT_TAPE;
  el.innerHTML = panel('1', 'Ticker tape', `${note ? `<p class="notice${kind === 'warn' ? ' warn' : ''}">${esc(note)}</p>` : ''}${listHtml(list, Boolean(custom))}
    <p class="muted">Add with ${link('TAPE ADD AAPL')}, take off with <span class="code">TAPE REMOVE &lt;ticker&gt;</span>, back to the standard tape with ${link('TAPE RESET')}.</p>`, { cls: 'panel-solo', meta: 'PRO' });
}

// Plain tickers must exist before they go on the tape; named instruments always do.
async function unknownTickers(symbols, ctx) {
  const out = [];
  await Promise.all(symbols.filter((s) => !instrumentById(s)).map(async (s) => {
    try { await ctx.fetchJSON(`/api/quote?s=${encodeURIComponent(s)}`, { signal: ctx.signal }); } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (err.status === 404 || err.status === 400) out.push(s);
    }
  }));
  return out;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Ticker tape', usage(cmd), { cls: 'panel-solo' });
    ctx.status('TAPE: CHECK THE FORMAT', 'warn');
    return;
  }
  const a = cmd.args;
  if (!pro.isPro()) {
    el.innerHTML = panel('1', 'Ticker tape', `<p class="notice">${esc(pro.PRO_ONLY)} Type ${link('PRO')}.</p>`, { cls: 'panel-solo' });
    ctx.status('TAPE: PRO FEATURE');
    return;
  }
  if (a.action === 'show') {
    show(el, ctx);
    ctx.status('TAPE');
    return;
  }
  if (a.action === 'reset') {
    pro.setTape(null);
    show(el, ctx, 'Back to the standard tape.');
    ctx.status('TAPE: RESET');
    return;
  }
  if (a.action === 'remove') {
    const next = pro.applyTape(pro.getTape(), a);
    pro.setTape(next.length ? next : null);
    show(el, ctx, next.length ? `Removed ${a.symbols.join(', ')}.` : 'The tape was empty, so it is back to the standard tape.');
    ctx.status(`TAPE: REMOVED ${a.symbols.join(' ')}`);
    return;
  }
  ctx.status('TAPE: CHECKING...');
  unknownTickers(a.symbols, ctx).then((bad) => {
    const good = a.symbols.filter((s) => !bad.includes(s));
    const current = pro.getTape() || pro.DEFAULT_TAPE;
    const room = pro.MAX_TAPE - current.length;
    const fresh = good.filter((s) => !current.includes(s));
    const next = pro.applyTape(pro.getTape(), { action: 'add', symbols: fresh.slice(0, Math.max(0, room)) });
    if (fresh.length && room > 0) pro.setTape(next);
    const notes = [];
    if (fresh.length && room > 0) notes.push(`Added ${fresh.slice(0, room).join(', ')}.`);
    if (fresh.length > room) notes.push(`The tape holds ${pro.MAX_TAPE}. TAPE REMOVE one first.`);
    if (good.length > fresh.length) notes.push(`${good.filter((s) => current.includes(s)).join(', ')} already on the tape.`);
    if (bad.length) notes.push(`No ticker called ${bad.join(', ')}.`);
    show(el, ctx, notes.join(' '), bad.length || fresh.length > room ? 'warn' : '');
    ctx.status(fresh.length && room > 0 ? `TAPE: ADDED ${fresh.slice(0, room).join(' ')}` : 'TAPE: NOTHING ADDED', fresh.length && room > 0 ? '' : 'warn');
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    show(el, ctx, err.message, 'warn');
    ctx.status('TAPE: TRY AGAIN', 'warn');
  });
}
