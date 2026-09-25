// HELP: every command with a hint and an example, grouped, plus the keys.

import { esc, q, panel } from './markets.js';

function row(name, hint, examples) {
  const ex = examples.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ');
  return `<li class="cmd-row"><span class="cmd-name">${esc(name)}</span><span class="cmd-hint">${esc(hint)}</span><span class="cmd-example">${ex}</span></li>`;
}

export function render(el, cmd, ctx) {
  const by = (g) => ctx.commands.filter((c) => c.group === g);
  const t = ctx.ticker;
  const markets = [
    ...by('Markets').map((c) => row(c.name, c.hint, [c.example])),
    row('<TICKER>', t.hint, t.examples),
    ...(ctx.grammar ? [row(ctx.grammar.name, ctx.grammar.hint, ctx.grammar.examples)] : []),
  ].join('');
  const lists = by('Your lists').map((c) => row(c.aliases?.length ? `${c.name} (${c.aliases.join(', ')})` : c.name, c.hint, c.examples || [c.example])).join('');
  const money = [
    ...by('Money tools').map((c) => row(c.usage, c.hint, c.examples || [c.example])),
  ].join('');
  const soon = ctx.soon.map((c) => `<li class="cmd-row is-soon"><span class="cmd-name">${esc(c.name)}</span><span class="cmd-hint">${esc(c.hint)}</span><span class="cmd-example">SOON</span></li>`).join('');
  const fkeys = ctx.fkeys.map((k) => `<div><dt><kbd>${esc(k.key)}</kbd></dt><dd>${esc(k.label)}</dd></div>`).join('');

  el.innerHTML = `<div class="grid">
    ${panel('1', 'Markets', `<ul class="cmd-list">${markets}</ul>`)}
    ${panel('2', 'Money tools', `<ul class="cmd-list">${money}</ul>`)}
    ${lists ? panel('3', 'Your lists', `<ul class="cmd-list">${lists}</ul>`) : ''}
    ${panel(lists ? '4' : '3', 'Coming soon', `<ul class="cmd-list">${soon}</ul>`)}
    ${panel(lists ? '5' : '4', 'Keys', `<dl class="keys">
      <div><dt><kbd>Enter</kbd></dt><dd>Run the command</dd></div>
      <div><dt><kbd>Tab</kbd></dt><dd>Complete the suggestion</dd></div>
      <div><dt><kbd>Up</kbd> <kbd>Down</kbd></dt><dd>Past commands</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>Clear the command bar</dd></div>
      <div><dt><kbd>1</kbd>-<kbd>7</kbd></dt><dd>Stock functions, on a stock screen</dd></div>
      ${fkeys}
    </dl>`, { cls: lists ? 'panel-span' : '' })}
  </div>
  <p class="footnote">Type a command and press Enter. Any case. Every screen is a link: SHARE copies it.</p>`;
  ctx.status('HELP: TYPE A COMMAND AND PRESS ENTER');
}
