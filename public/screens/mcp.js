// MCP: hook Claude, ChatGPT, Grok or Cursor up to Bloombroke. A card page (kit.js
// cardPage): the URL big with one COPY button, the rule, and one row per app in + Details.
// The server side is lib/mcp/.

import { cardPage, cardButton, cardRows, raw } from '../kit.js';
import { goal } from '../goal.js'; // GOALS

export const MCP_URL = 'https://bloombroke.com/mcp';
export const MCP_APPS = [
  ['CLAUDE', 'Customize > Connectors > + > Add custom connector. Paste the URL.'],
  ['CHATGPT', 'Settings > Security and login > Developer mode on. Then chatgpt.com/plugins > +. Paste the URL.'],
  ['GROK', 'grok.com/connectors > New Connector > Custom. Paste the URL.'],
  ['CURSOR', `Customize > MCP, or in ~/.cursor/mcp.json: "bloombroke": { "url": "${MCP_URL}" }`],
];
export const MCP_RULE = 'Free. Public data only. 300 calls a day.';

export function mcpHtml() {
  return cardPage({
    cls: 'mcp-card', label: 'MCP',
    kicker: 'MCP',
    hero: MCP_URL, heroSize: 32,
    act: raw(cardButton({ label: 'COPY URL', primary: true, id: 'mcp-copy' })),
    note: MCP_RULE,
    details: raw(cardRows([...MCP_APPS, ['SIGN-UP', 'None. Paste the URL and it works.']])),
  });
}

export function render(el, cmd, ctx) {
  el.innerHTML = mcpHtml();
  el.querySelector('#mcp-copy')?.addEventListener('click', async () => {
    const ok = await ctx.copy?.(MCP_URL);
    ctx.status(ok ? 'MCP URL COPIED' : 'COPY THE URL FROM THE SCREEN', ok ? '' : 'warn');
  });
  goal('mcp_screen_opened');
  ctx.status('MCP');
}
