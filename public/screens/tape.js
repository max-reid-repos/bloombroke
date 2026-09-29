// TAPE: the ticker tape as a screen (a small card page) and as a DESK panel (just the tape).
//   TAPE              the tape, and whether it shows on every screen
//   TAPE ON | OFF     show or hide it above the status line on every screen (free)
//   TAPE ADD AAPL, TAPE REMOVE AAPL, TAPE RESET   your own tape (Pro)

import { esc, q, panel } from './markets.js';
import * as pro from '../pro.js';
import { instrumentById } from '../instruments.js';
import { mountTape, parseTapeSwitch } from '../tape.js';
import { usageCard, cardPage, cardButton, cardRows, raw } from '../kit.js';
import { parseTapeArgs as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { parse };

const link = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}" data-example>${esc(c)}</a>`; // saving ones prefill (app.js examplePlan)

// A command typed wrong: the kit's usage card.
export function usage(cmd) {
  const symbol = cmd.error === 'symbol';
  const ex = ['TAPE ON', 'TAPE ADD AAPL', 'TAPE RESET'];
  return usageCard({
    problem: symbol ? `${cmd.args.bad} is not a ticker.` : 'Not a TAPE command.',
    format: 'TAPE ON|OFF|RESET, TAPE ADD ticker',
    grammar: 'TAPE ON, TAPE OFF, TAPE ADD <tickers>, TAPE REMOVE <tickers>, TAPE RESET',
    example: symbol ? ex[1] : ex[0],
    more: ex.filter((e) => e !== (symbol ? ex[1] : ex[0])),
  });
}

function listHtml(list, custom) {
  const items = list.map((s) => `<li class="pro-row"><a class="pro-feat code" href="${esc(q(s))}" data-cmd="${esc(s)}">${esc(s)}</a><span class="pro-text">${esc(instrumentById(s)?.name || '')}</span></li>`).join('');
  return `<div class="tape-list"><p class="fx-from">${custom ? 'Your tape' : 'The standard tape'}: ${list.length} of ${pro.MAX_TAPE}.</p><ul class="pro-list">${items}</ul></div>`;
}

// The screen, a small card page (kit.js cardPage): TAPE ON or OFF (hero), one line, the
// one switch (a direct button: it changes the setting, as asked), the moving tape (and a
// Pro user's list) as the media; the DESK tip, adding and removing, and the Pro note in
// + Details. note: what the last TAPE ADD/REMOVE/RESET did (kind 'warn' for a problem).
export function tapeHtml({ on = false, isPro = false, custom = null, note = '', kind = '' } = {}) {
  const yours = isPro
    ? raw(`Add with ${link('TAPE ADD AAPL')}, take off with <span class="code">TAPE REMOVE &lt;ticker&gt;</span>, back to the standard tape with ${link('TAPE RESET')}.`)
    : raw(`${esc(pro.PRO_ONLY)} Type ${link('PRO')}.`);
  return cardPage({
    cls: 'tape-card', label: 'Ticker tape',
    alert: note, alertWarn: kind === 'warn',
    hero: on ? 'TAPE ON' : 'TAPE OFF', heroSize: 60,
    sub: on ? 'It sits above the status line on every screen.' : 'Turn it on to see it on every screen.',
    act: raw(cardButton({ label: on ? 'TURN OFF' : 'TURN ON', cmd: on ? 'TAPE OFF' : 'TAPE ON', primary: true })),
    media: raw(`<div class="tape tape-panel"><div class="tape-track"></div></div>${isPro ? listHtml(custom || pro.DEFAULT_TAPE, Boolean(custom)) : ''}`),
    details: raw(cardRows([
      ['Desk', raw('To keep it in one place instead, add a DESK panel with the command <span class="code">TAPE</span>.')],
      ['Your tape', yours],
    ])),
  });
}

function show(el, ctx, note = '', kind = '') {
  el.innerHTML = tapeHtml({ on: ctx.tapeOn(), isPro: pro.isPro(), custom: pro.getTape(), note, kind });
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
