// MCP: hook Claude, ChatGPT, Grok or Cursor up to Bloombroke. The URL, one line
// per app, and the rule. The server side is lib/mcp/.

import { esc, panel, metaNote } from './markets.js';
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
  return panel('1', 'MCP', `<p class="notice"><span class="code">${esc(MCP_URL)}</span></p>
    <table class="hd-opts"><tbody>${MCP_APPS.map(([app, how]) => `<tr><th scope="row">${esc(app)}</th><td>${esc(how)}</td></tr>`).join('')}</tbody></table>
    <p class="muted">${esc(MCP_RULE)}</p>`, { cls: 'panel-solo', meta: metaNote('NO SIGN-UP') });
}

export function render(el, cmd, ctx) {
  el.innerHTML = mcpHtml();
  goal('mcp_screen_opened');
  ctx.status('MCP');
}
