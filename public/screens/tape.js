// TAPE: the ticker tape as a screen (and a DESK panel).
//   TAPE              the tape, and whether it shows on every screen
//   TAPE ON | OFF     show or hide it above the status line on every screen (free)
//   TAPE ADD AAPL, TAPE REMOVE AAPL, TAPE RESET   your own tape (Pro)

import { esc, q, panel } from './markets.js';
import * as pro from '../pro.js';
import { instrumentById } from '../instruments.js';
import { mountTape, parseTapeSwitch } from '../tape.js';
import { parseTapeArgs as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { parse };

const link = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

function usage(cmd) {
  const title = cmd.error === 'symbol' ? `${cmd.args.bad} is not a ticker.` : 'TAPE takes ON, OFF, ADD, REMOVE or RESET.';
  return `<p class="notice">${esc(title)}</p>
    <p class="muted">Format: <span class="code">TAPE ON</span>, <span class="code">TAPE OFF</span>, <span class="code">TAPE ADD &lt;tickers&gt;</span>, <span class="code">TAPE REMOVE &lt;tickers&gt;</span> or <span class="code">TAPE RESET</span>.</p>
    <p class="muted examples">Try ${['TAPE ON', 'TAPE ADD AAPL', 'TAPE RESET'].map(link).join(' ')}</p>`;
}

function listHtml(list, custom) {
  const items = list.map((s) => `<li class="pro-row"><a class="pro-feat code" href="${esc(q(s))}" data-cmd="${esc(s)}">${esc(s)}</a><span class="pro-text">${esc(instrumentById(s)?.name || '')}</span></li>`).join('');
  return `<p class="fx-from">${custom ? 'Your tape' : 'The standard tape'}: ${list.length} of ${pro.MAX_TAPE}.</p><ul class="pro-list">${items}</ul>`;
}

// On every screen, or not: the free switch.
function switchHtml(on) {
  const tab = (label, active) => `<a class="seg-item${active ? ' is-active' : ''}" href="${esc(q(`TAPE ${label}`))}" data-cmd="TAPE ${label}"${active ? ' aria-current="true"' : ''}>${label}</a>`;
  return `<div class="tape-set">
      <p class="tape-state">The tape is ${on ? 'on' : 'off'} on every screen.</p>
      <nav class="seg" aria-label="Tape on every screen">${tab('ON', on)}${tab('OFF', !on)}</nav>
      <p class="muted">When it is on, it sits above the status line. To keep it in one place instead, add a DESK panel with the command <span class="code">TAPE</span>.</p>
    </div>`;
}

// What is on it: the Pro list, or one line on Pro for everyone else.
function contentsHtml(note, kind) {
  const noteHtml = note ? `<p class="notice${kind === 'warn' ? ' warn' : ''}">${esc(note)}</p>` : '';
  if (!pro.isPro()) return `${noteHtml}<p class="muted">${esc(pro.PRO_ONLY)} Type ${link('PRO')}.</p>`;
  const custom = pro.getTape();
  return `${noteHtml}${listHtml(custom || pro.DEFAULT_TAPE, Boolean(custom))}
    <p class="muted">Add with ${link('TAPE ADD AAPL')}, take off with <span class="code">TAPE REMOVE &lt;ticker&gt;</span>, back to the standard tape with ${link('TAPE RESET')}.</p>`;
}

function show(el, ctx, note = '', kind = '') {
  el.innerHTML = panel('1', 'Ticker tape', `<div class="tape tape-panel"><div class="tape-track"></div></div>${switchHtml(ctx.tapeOn())}`, { cls: 'panel-solo', bodyCls: 'flush' })
    + panel('2', 'What is on it', contentsHtml(note, kind), { cls: 'panel-solo tape-contents', meta: 'PRO' });
  return mountTape(el.querySelector('.tape-track'), { load: ctx.loadTape, live: ctx.liveTimer, toQuery: ctx.toQuery, escape: esc });
}

// Plain tickers must exist before they go on the tape; named instruments always do.
// One /api/quotes call; its `missing` list names the ones it does not know.
async function unknownTickers(symbols, ctx) {
  const plain = symbols.filter((s) => !instrumentById(s));
  if (!plain.length) return [];
  const d = await ctx.fetchJSON(`/api/quotes?s=${encodeURIComponent(plain.join(','))}`, { signal: ctx.signal });
  return plain.filter((s) => (d.missing || []).includes(s));
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Ticker tape', usage(cmd), { cls: 'panel-solo' });
    ctx.status('TAPE: CHECK THE FORMAT', 'warn');
    return undefined;
  }
  const a = cmd.args;
  // In a DESK panel: just the tape.
  if (ctx.embed && (a.action === 'show' || a.action === 'on' || a.action === 'off')) {
    el.innerHTML = '<div class="tape tape-panel"><div class="tape-track"></div></div>';
    ctx.status('TICKER TAPE');
    return mountTape(el.querySelector('.tape-track'), { load: ctx.loadTape, live: ctx.liveTimer, toQuery: ctx.toQuery, escape: esc });
  }
  let stop = null;
  const cleanup = () => stop?.();
  if (a.action === 'show' || a.action === 'on' || a.action === 'off') {
    if (a.action !== 'show') ctx.setTape(a.action === 'on');
    stop = show(el, ctx);
    ctx.status(a.action === 'show' ? 'TICKER TAPE' : `TAPE ${a.action.toUpperCase()}`);
    return cleanup;
  }
  if (!pro.isPro()) {
    stop = show(el, ctx);
    ctx.status('TAPE: YOUR OWN TAPE IS A PRO FEATURE');
    return cleanup;
  }
  const again = (note, kind) => { stop?.(); stop = show(el, ctx, note, kind); };
  if (a.action === 'reset') {
    pro.setTape(null);
    again('Back to the standard tape.');
    ctx.status('TAPE: RESET');
    return cleanup;
  }
  if (a.action === 'remove') {
    const next = pro.applyTape(pro.getTape(), a);
    pro.setTape(next.length ? next : null);
    again(next.length ? `Removed ${a.symbols.join(', ')}.` : 'The tape was empty, so it is back to the standard tape.');
    ctx.status(`TAPE: REMOVED ${a.symbols.join(' ')}`);
    return cleanup;
  }
  stop = show(el, ctx);
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
    again(notes.join(' '), bad.length || fresh.length > room ? 'warn' : '');
    ctx.status(fresh.length && room > 0 ? `TAPE: ADDED ${fresh.slice(0, room).join(' ')}` : 'TAPE: NOTHING ADDED', fresh.length && room > 0 ? '' : 'warn');
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    again(err.message, 'warn');
    ctx.status('TAPE: TRY AGAIN', 'warn');
  });
  return cleanup;
}
