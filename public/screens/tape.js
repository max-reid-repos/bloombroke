// TAPE: the ticker tape as a screen (and a DESK panel). TAPE ON and TAPE OFF also show
// or hide the tape above the status line on every screen.

import { esc, q, panel } from './markets.js';
import { mountTape } from '../tape.js';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Ticker tape', `
      <p class="notice">TAPE takes ON or OFF.</p>
      <p class="muted examples">Try ${['TAPE ON', 'TAPE OFF', 'TAPE'].map((c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`).join(' ')}</p>`, { cls: 'panel-solo' });
    ctx.status('TAPE: CHECK THE WORD AFTER IT', 'warn');
    return undefined;
  }
  if (cmd.args?.set && !ctx.embed) ctx.setTape(cmd.args.set === 'ON');
  const on = ctx.tapeOn();

  if (ctx.embed) {
    el.innerHTML = '<div class="tape tape-panel"><div class="tape-track"></div></div>';
  } else {
    const tab = (label, active) => `<a class="tab${active ? ' is-active' : ''}" href="${esc(q(`TAPE ${label}`))}" data-cmd="TAPE ${label}"${active ? ' aria-current="true"' : ''}>${label}</a>`;
    el.innerHTML = panel('1', 'Ticker tape', `
      <div class="tape tape-panel"><div class="tape-track"></div></div>
      <div class="tape-set">
        <p class="tape-state">The tape is ${on ? 'on' : 'off'} on every screen.</p>
        <nav class="tabs tape-toggle" aria-label="Tape">${tab('ON', on)}${tab('OFF', !on)}</nav>
        <p class="muted">When it is on, it sits above the status line. To keep it in one place instead, add a DESK panel with the command <span class="code">TAPE</span>.</p>
      </div>`, { cls: 'panel-solo', bodyCls: 'flush' });
  }
  const stop = mountTape(el.querySelector('.tape-track'), { fetchJSON: ctx.fetchJSON, live: ctx.liveTimer, toQuery: ctx.toQuery, escape: esc });
  ctx.status(cmd.args?.set ? `TAPE ${on ? 'ON' : 'OFF'}` : 'TICKER TAPE');
  return stop;
}
