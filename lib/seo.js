// Search pages: the title, description and canonical URL for a bare command
// (/?c=MARKETS), and /sitemap.xml. Share cards with their own image (WHATIF, AFFORD, a
// ticker, WEIRD gauges) are in lib/og.js and lib/og-weird.js; this covers the rest.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findCommand } from './registry.js'; // whole entries, HELP's long text too
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { SITE } from './og.js';
import { whatifSitemapUrls } from './whatif-seo.js';
import { loadGraveyardData } from './graveyard.js'; // GRAVEYARD stone pages

const sentence = (s) => (!s ? '' : /[.?!]$/.test(s) ? s : `${s}.`);

// Commands whose search title and description are written out, not built from the registry.
export const PAGE_META = {
  GUESS: {
    title: 'GUESS: the daily stock chart puzzle | Bloombroke',
    description: 'One mystery S&P 100 stock a day. Read its 1-year chart, then name it in six tries with hints on sector, size and move. Free on Bloombroke, a market terminal for normal people.',
    image: `${SITE}/og/guess.png`, // today's chart, never the answer (lib/og-guess.js)
    alt: "Today's GUESS: a mystery stock's 1-year chart as % change. Can you name this stock?",
  },
  // GRID alone: the starter board's card (lib/og-grid.js). A board with tickers gets its
  // own title and card in lib/og-grid.js gridMeta.
  GRID: {
    title: 'GRID: up to 16 mini charts on one board | Bloombroke',
    description: 'A board of up to 16 mini charts: stocks, indexes, coins, yields, US CPI, WEIRD gauges and GRAVEYARD stones, each with its high and low. Free on Bloombroke, a market terminal for normal people.',
    image: `${SITE}/og/grid.png`,
    alt: 'A Bloombroke GRID board: mini charts of the S&P 500, Nasdaq 100, Nvidia, Bitcoin, gold, oil and more.',
  },
};

// The commands with a page of their own on the site (lib/legal.js LEGAL_PAGES).
const LEGAL_COMMANDS = new Set(['TERMS', 'PRIVACY', 'DISCLAIMER']);

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
  const legal = LEGAL_COMMANDS.has(entry.name); // /terms, /privacy, /disclaimer (lib/legal.js)
  const source = entry.source && entry.source !== 'Built in' ? ` Source: ${sentence(entry.source)}` : '';
  return {
    title: `${entry.name} | ${entry.summary} | Bloombroke`,
    description: `${sentence(entry.summary)}${source} Bloombroke is a free market terminal for normal people.`,
    image: `${SITE}/og/default.png`,
    url: legal ? `${SITE}/${entry.name.toLowerCase()}` : `${SITE}/?${new URLSearchParams({ c: entry.name })}`,
    alt: 'Bloombroke: a free market terminal for normal people.',
    ...PAGE_META[entry.name],
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
// own share card), one WHATIF page per catalogue item (lib/whatif-seo.js) and the legal
// pages. No lastmod: the screens are live data.
export const SITEMAP_COMMANDS = [
  'MARKETS', 'NEWS', 'WORLDMAP', 'HEATMAP', 'MOVERS', 'CRYPTO', 'COMMODITIES', 'RATES', 'ECONOMY', 'WHATIF',
  'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN',
  'WEIRD', 'FISHTANK', ...WEIRD_GAUGES.map((g) => g.command),
  'GUESS', 'GRID',
];
export const SITEMAP_PAGES = ['terms', 'privacy', 'disclaimer'];

const escXml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));

const WHATIF_CATALOG = JSON.parse(readFileSync(new URL('../data/whatif-products.json', import.meta.url), 'utf8'));

// GRAVEYARD: the cemetery, ZOMBIES and one page per stone and per zombie.
export function graveyardSitemapUrls(data = loadGraveyardData()) {
  return ['GRAVEYARD', 'GRAVEYARD ZOMBIES', ...[...data.stones, ...data.zombies].map((e) => `GRAVEYARD ${e.ticker}`)]
    .map((c) => `${SITE}/?${new URLSearchParams({ c })}`);
}

export function sitemapUrls() {
  return [
    `${SITE}/`,
    ...SITEMAP_COMMANDS.map((c) => `${SITE}/?${new URLSearchParams({ c })}`),
    ...graveyardSitemapUrls(),
    ...whatifSitemapUrls(WHATIF_CATALOG),
    ...SITEMAP_PAGES.map((p) => `${SITE}/${p}`),
  ];
}

export function sitemapXml(urls = sitemapUrls()) {
  const rows = urls.map((u) => `  <url><loc>${escXml(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

// Only bloombroke.com is indexed (and localhost, for development). Any other host that
// reaches this server, like the frozen Build Games copy at buildgames.bloombroke.com,
// says noindex, nofollow on every answer, and its robots.txt shuts the whole site.
// Canonical links point at bloombroke.com either way. The host is the Host header only
// (cloudflared keeps the original one). Never X-Forwarded-Host: the tunnel passes a
// visitor's own through, so anyone could make bloombroke.com say noindex.
export const INDEXED_HOSTS = new Set(['bloombroke.com', 'www.bloombroke.com', 'localhost', '127.0.0.1', '::1']);
// A Host header -> the bare name: lower case, no port, no IPv6 brackets, no trailing dot.
export function hostOf(raw) {
  const h = String(raw || '').trim().toLowerCase();
  const v6 = /^\[([^\]]*)\](?::\d*)?$/.exec(h);
  return (v6 ? v6[1] : h.replace(/:\d*$/, '')).replace(/\.$/, '');
}
export const isIndexedHost = (host) => INDEXED_HOSTS.has(hostOf(host));
const indexedReq = (req) => isIndexedHost(req.get('host'));
export const NOINDEX = 'noindex, nofollow';
export const ROBOTS_CLOSED = 'User-agent: *\nDisallow: /\n';

// Every answer to another host: X-Robots-Tag noindex, nofollow, kept even when a route
// sets its own (the embed pages say noindex).
export function noindexOtherHosts() {
  return (req, res, next) => {
    if (indexedReq(req)) return next();
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => setHeader(name, String(name).toLowerCase() === 'x-robots-tag' ? NOINDEX : value);
    res.setHeader('X-Robots-Tag', NOINDEX);
    next();
  };
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
  // Old iOS asks for these names too; all get the one 180x180 icon.
  for (const p of ['/apple-touch-icon-precomposed.png', '/apple-touch-icon-120x120.png', '/apple-touch-icon-120x120-precomposed.png']) files.set(p, files.get('/apple-touch-icon.png'));
  files.set('/sitemap.xml', { type: 'application/xml; charset=utf-8', body: Buffer.from(sitemapXml()) });
  app.get([...files.keys()], (req, res, next) => {
    const f = files.get(req.path); // routing ignores case and a trailing slash; this does not
    if (!f) return next();
    // Another host's robots.txt shuts the site and is never cached (a cache must not
    // hand it to bloombroke.com, or bloombroke.com's to another host).
    if (req.path === '/robots.txt' && !indexedReq(req)) return res.set({ 'Content-Type': f.type, 'Cache-Control': 'no-store' }).send(Buffer.from(ROBOTS_CLOSED));
    res.set({ 'Content-Type': f.type, 'Cache-Control': 'public, max-age=86400' }).send(f.body);
  });
}
