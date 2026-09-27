// /llms.txt: what Bloombroke is, the MCP endpoint, its tools (from the tool list, so it
// never drifts), the data rules and the notice. Plain text, kept an hour.

import { TOOLS } from './tools.js';
import { MCP_URL } from './server.js';
import { MCP_LIMITS } from './limits.js';
import { NOTICE } from './envelope.js';
import { MCP_GAUGES } from './gauges.js';

export function llmsTxt() {
  const L = MCP_LIMITS;
  return [
    '# Bloombroke',
    '',
    '> A free keyboard market terminal for normal people at https://bloombroke.com. Type a command, press Enter. Every screen is a link: the command lives in the URL (https://bloombroke.com/?c=AAPL+1Y).',
    '',
    '## MCP server',
    '',
    `- URL: ${MCP_URL}`,
    '- Transport: Streamable HTTP, stateless, JSON responses. Protocol 2026-07-28, and 2025-03-26 to 2025-11-25 with initialize.',
    '- Auth: none. Read-only tools.',
    `- Limits per IP address: ${L.shortMax} tool calls per 10 minutes, ${L.dayMax} per 24 hours, ${L.requestMax} requests a minute; ${L.globalDayMax.toLocaleString('en-US')} tool calls per 24 hours for everyone together. Row and point caps per tool.`,
    '',
    '## Tools',
    '',
    ...TOOLS.map((t) => `- ${t.name}: ${t.description}`),
    '',
    '## Data rules',
    '',
    `- The MCP server serves only public-domain and open data: SEC EDGAR, US Bureau of Labor Statistics, Federal Reserve Board Beige Book, National Weather Service, NOAA, CDC, Wikimedia pageviews. Gauges served: ${MCP_GAUGES.map((g) => g.id).join(', ')}.`,
    '- Market quotes, charts, symbol search, news, WHATIF, GUESS and anything priced from them come from sources that may not be passed on. They are available only on bloombroke.com: open_in_bloombroke returns the link.',
    '- Every result carries its source, source URL, as-of time, fetch time and age.',
    '- Use of the data follows the Terms of Use: https://bloombroke.com/terms',
    '',
    '## Notice',
    '',
    NOTICE,
    '',
  ].join('\n');
}

export function mountLlmsTxt(app) {
  const body = llmsTxt();
  app.get('/llms.txt', (req, res) => {
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).send(body);
  });
}
