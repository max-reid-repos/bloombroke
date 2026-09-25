// HELP: every command with a hint and an example, grouped, plus the keys.

import { esc, q, panel } from './markets.js';

function row(name, hint, examples) {
  const ex = examples.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ');
  return `<li class="cmd-row"><span class="cmd-name">${esc(name)}</span><span class="cmd-hint">${esc(hint)}</span><span class="cmd-example">${ex}</span></li>`;
}

export const HELP_GROUPS = ['Markets', 'Company', 'Rates and FX', 'Calendars', 'Money tools', 'Pro'];

export function render(el, cmd, ctx) {
  const by = (g) => ctx.commands.filter((c) => c.group === g);
  const t = ctx.ticker;
  const groups = HELP_GROUPS.map((g) => {
    const rows = by(g).map((c) => row(c.usage, c.hint, c.examples || [c.example]));
    if (g === 'Company') rows.unshift(row('<TICKER>', t.hint, t.examples));
    return [g, rows.join('')];
  });
  const soon = ctx.soon.map((c) => `<li class="cmd-row is-soon"><span class="cmd-name">${esc(c.name)}</span><span class="cmd-hint">${esc(c.hint)}</span><span class="cmd-example">SOON</span></li>`).join('');
  const fkeys = ctx.fkeys.map((k) => `<div><dt><kbd>${esc(k.key)}</kbd></dt><dd>${esc(k.label)}</dd></div>`).join('');

  const n = groups.length;
  el.innerHTML = `<div class="grid">
    ${groups.map(([g, rows], i) => panel(String(i + 1), g, `<ul class="cmd-list">${rows}</ul>`)).join('')}
    ${panel(String(n + 1), 'Coming soon', `<ul class="cmd-list">${soon}</ul>`)}
    ${panel(String(n + 2), 'Keys', `<dl class="keys">
      <div><dt><kbd>Enter</kbd></dt><dd>Run the command</dd></div>
      <div><dt><kbd>Tab</kbd></dt><dd>Complete the suggestion</dd></div>
      <div><dt><kbd>Up</kbd> <kbd>Down</kbd></dt><dd>Past commands</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>Clear the command bar</dd></div>
      ${fkeys}
    </dl>`, { cls: 'panel-wide' })}
  </div>
  <p class="footnote">Type a command and press Enter. Any case. Every screen is a link: SHARE copies it.</p>`;
  ctx.status('HELP: TYPE A COMMAND AND PRESS ENTER');
}
