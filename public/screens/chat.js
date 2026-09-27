// CHAT: private 1-to-1 chat between Pro seats. Not built yet: typing CHAT says so.

import { esc, panel } from './markets.js';

export const CHAT_SOON = 'Coming when Pro launches.';
export const CHAT_LINE = 'Private 1-to-1 chat between Pro seats.';

export function chatHtml() {
  return panel('1', 'CHAT', `<p class="notice">${esc(CHAT_SOON)}</p><p class="muted">${esc(CHAT_LINE)}</p>`, { cls: 'panel-solo' });
}

export function render(el, cmd, ctx) {
  el.innerHTML = chatHtml();
  ctx.status('CHAT: COMING WHEN PRO LAUNCHES');
}
