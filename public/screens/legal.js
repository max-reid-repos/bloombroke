// TERMS, PRIVACY, DISCLAIMER: open the server-rendered legal pages.

import { esc, panel } from './markets.js';

export const LEGAL_COMMANDS = {
  TERMS: { path: '/terms', title: 'Terms of Use' },
  PRIVACY: { path: '/privacy', title: 'Privacy Policy' },
  DISCLAIMER: { path: '/disclaimer', title: 'Disclaimer' },
};

export function legalTarget(name) {
  return LEGAL_COMMANDS[name] || null;
}

export function render(el, cmd, ctx) {
  const t = legalTarget(cmd.name);
  if (!t) return;
  el.innerHTML = panel('1', t.title, `
    <p class="notice">Opening the ${esc(t.title)}.</p>
    <p class="muted"><a class="code" href="${esc(t.path)}">${esc(t.path)}</a></p>`, { cls: 'panel-solo' });
  ctx.status(`${cmd.name}: OPENING`);
  window.location.assign(t.path);
}
