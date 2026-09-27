// Search pages: the title, description and canonical URL for a bare command
// (/?c=MARKETS), and /sitemap.xml. Share cards with their own image (WHATIF, AFFORD, a
// ticker, WEIRD gauges) are in lib/og.js and lib/og-weird.js; this covers the rest.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findCommand } from '../public/registry.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { SITE } from './og.js';

const sentence = (s) => (!s ? '' : /[.?!]$/.test(s) ? s : `${s}.`);

// ?c=<one listed command> -> page meta, or null. parse is the router's parseCommand.
// A command that needs words after it (FX alone is its usage screen) gets null, and so
// does anything the router reads as a ticker.
export function commandMeta(c, parse) {
  const text = String(c || '').trim();
  if (!/^[A-Za-z0-9]{1,20}$/.test(text)) return null;
  const cmd = parse(text);
  if (!cmd || cmd.error || cmd.name === 'HOME') return null;
  const entry = findCommand(cmd.name);
  if (!entry || entry.name !== cmd.name || entry.hidden || entry.soon || entry.pattern) return null;
  const legal = entry.category === 'Legal';
  const source = entry.source && entry.source !== 'Built in' ? ` Source: ${sentence(entry.source)}` : '';
  return {
    title: `${entry.name} | ${entry.summary} | Bloombroke`,
    description: `${sentence(entry.summary)}${source} Bloombroke is a free market terminal for normal people.`,
    image: `${SITE}/og/default.png`,
    url: legal ? `${SITE}/${entry.name.toLowerCase()}` : `${SITE}/?${new URLSearchParams({ c: entry.name })}`,
    alt: 'Bloombroke: a free market terminal for normal people.',
  };
}

// WHY <ticker> (/?c=WHY+AAPL): its own title, description and card (lib/og-why.js draws
// the card). top: the biggest move ({ date, pct }) when the numbers are in; a slow answer
// gets the same title without them. company: false (an index, a coin) gets no card.
export function whyMeta(ticker, { name = '', top = null, company = true } = {}) {
  const q = new URLSearchParams({ c: `WHY ${ticker}` }).toString();
  const who = name ? `${name} (${ticker})` : ticker;
  const biggest = top ? ` Biggest: ${top.pct} on ${top.date}.` : '';
  return {
    title: `${ticker} biggest daily moves, 1Y | WHY | Bloombroke`,
    description: company
      ? `The 10 biggest daily moves in ${who} over the last year, close to close, with the SEC filings, earnings dates and headlines that came out each day.${biggest} A list, not a cause. Bloombroke is a free market terminal.`
      : `WHY lists a company stock's biggest daily moves and what came out each day. ${ticker} is not a company stock. Bloombroke is a free market terminal.`,
    image: company ? `${SITE}/og/why.png?${q}` : `${SITE}/og/default.png`,
    url: `${SITE}/?${q}`,
    alt: top ? `${ticker}: biggest daily moves of the last year. Top: ${top.pct} on ${top.date}.` : `${ticker}: biggest daily moves of the last year.`,
  };
}

// The sitemap: the home page, key screens, big tickers, every WEIRD gauge (each has its
// own share card) and the legal pages. No lastmod: the screens are live data.
export const SITEMAP_COMMANDS = [
  'MARKETS', 'NEWS', 'WORLDMAP', 'HEATMAP', 'MOVERS', 'CRYPTO', 'COMMODITIES', 'RATES', 'ECONOMY', 'WHATIF',
  'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN',
  'WEIRD', 'FISHTANK', ...WEIRD_GAUGES.map((g) => g.command),
];
export const SITEMAP_PAGES = ['terms', 'privacy', 'disclaimer'];

const escXml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));

export function sitemapUrls() {
  return [
    `${SITE}/`,
    ...SITEMAP_COMMANDS.map((c) => `${SITE}/?${new URLSearchParams({ c })}`),
    ...SITEMAP_PAGES.map((p) => `${SITE}/${p}`),
  ];
}

export function sitemapXml(urls = sitemapUrls()) {
  const rows = urls.map((u) => `  <url><loc>${escXml(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

// Icons, the web manifest, robots.txt and the sitemap: fixed files, kept a day. Read once
// at start, so a missing one fails the start rather than falling through to the 404 page.
export const SITE_FILES = {
  '/favicon.ico': 'image/x-icon',
  '/favicon.svg': 'image/svg+xml',
  '/apple-touch-icon.png': 'image/png',
  '/icon-192.png': 'image/png',
  '/icon-512.png': 'image/png',
  '/site.webmanifest': 'application/manifest+json',
  '/robots.txt': 'text/plain; charset=utf-8',
};

export function mountSiteFiles(app, publicDir) {
  const files = new Map(Object.entries(SITE_FILES).map(([p, type]) => [p, { type, body: readFileSync(path.join(publicDir, p.slice(1))) }]));
  files.set('/apple-touch-icon-precomposed.png', files.get('/apple-touch-icon.png'));
  files.set('/sitemap.xml', { type: 'application/xml; charset=utf-8', body: Buffer.from(sitemapXml()) });
  app.get([...files.keys()], (req, res, next) => {
    const f = files.get(req.path); // routing ignores case and a trailing slash; this does not
    if (!f) return next();
    res.set({ 'Content-Type': f.type, 'Cache-Control': 'public, max-age=86400' }).send(f.body);
  });
}
