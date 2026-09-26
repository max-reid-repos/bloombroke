import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getQuotes, getFxMajors, getQuote, getQuoteList, normalizeTicker, MAX_LIST } from './data/quotes.js';
import { getFx, FxError } from './data/fx.js';
import { getChart, ChartError, chartSpecFromQuery } from './data/charts.js';
import { getChartEvents, ChartEventsError } from './data/chart-events.js';
import { precise52 } from './data/range52.js';
import { getCpi, CpiError, CPI_EXAMPLES } from './data/cpi.js';
import { getRates } from './data/rates.js';
import { getNews } from './data/news.js';
import { getNewsTab, NEWS_TABS } from './data/newsfeeds.js';
import { search } from './data/search.js';
import { getCatalog, getWhatif, getFunding, catalog } from './data/whatif-service.js';
import { WhatifError } from './data/whatif.js';
import { whatifTokens, normalizeWhatif, certModel } from './data/whatif-cert.js';
import {
  getCert, whatifPng, defaultPng, withMeta, certMeta, DEFAULT_META,
  getQuoteCard, quotePng, quoteMeta, affordModel, affordPng, affordMeta,
} from './lib/og.js';
import { parseCommand } from './public/app.js';
import { getFinancials, FinancialsError } from './data/financials.js';
import { getScreen, ScreenError, startScreenPrewarm } from './data/screen.js';
import { buildId, versionIndex } from './lib/assets.js';
import { readFileSync } from 'node:fs';
import { mountCommandRoutes } from './command-routes.js';
import { mountLegal } from './lib/legal.js';
import { securityHeaders, isEmbedQuery, embedHtml } from './lib/embed.js';
import { startPro } from './pro/index.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(dir, '.env')); } catch { /* .env is optional */ }

const PORT = Number(process.env.PORT) || 3020;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

const HEADERS = securityHeaders();
app.use((req, res, next) => {
  res.set(HEADERS);
  next();
});

app.get('/api/markets', async (req, res) => {
  try {
    const data = await getQuotes();
    res.set('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (err) {
    console.error('[markets]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Market data is taking a break. Try again in a minute.' });
  }
});

app.get('/api/fx', async (req, res) => {
  const { amount, from, to } = req.query;
  if (typeof from !== 'string' || typeof to !== 'string') {
    return res.status(400).json({ error: 'usage', message: 'Use FX <amount> <from> <to>.' });
  }
  try {
    const data = await getFx({ amount: typeof amount === 'string' ? amount : undefined, from, to });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (err) {
    if (err instanceof FxError) {
      const status = err.code === 'unavailable' ? 503 : 400;
      const { code, message, unknown, examples, supported } = err;
      return res.status(status).json({ error: code, message, unknown, examples, supported });
    }
    console.error('[fx]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Currency data is taking a break. Try again in a minute.' });
  }
});

const BREAK = 'Data is taking a break. Try again in a minute.';
const str = (v) => (typeof v === 'string' ? v : undefined);

app.get('/api/fxmajors', async (req, res) => {
  try {
    const data = await getFxMajors();
    res.set('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (err) {
    console.error('[fxmajors]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Currency data is taking a break. Try again in a minute.' });
  }
});

app.get('/api/quote', async (req, res) => {
  const ticker = normalizeTicker(str(req.query.s));
  if (!ticker) return res.status(400).json({ error: 'bad_symbol', message: 'That does not look like a ticker.' });
  try {
    const data = await precise52(await getQuote(ticker));
    if (!data) return res.status(404).json({ error: 'not_found', message: `No ticker called ${ticker}.` });
    res.set('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (err) {
    console.error('[quote]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Quote data is taking a break. Try again in a minute.' });
  }
});

// ?s=AAPL,MSFT,GOLD: many quotes in one call (WATCH, PORTFOLIO, HOME).
app.get('/api/quotes', async (req, res) => {
  const raw = (str(req.query.s) || '').split(',').map((t) => t.trim()).filter(Boolean);
  if (!raw.length || raw.length > MAX_LIST || raw.some((t) => t.length > 16)) {
    return res.status(400).json({ error: 'usage', message: `Ask for 1 to ${MAX_LIST} symbols, separated by commas.` });
  }
  try {
    const data = await getQuoteList(raw);
    res.set('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (err) {
    console.error('[quotes]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Quote data is taking a break. Try again in a minute.' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const data = await search(str(req.query.q));
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (err) {
    console.error('[search]', err.message);
    res.status(503).json({ error: 'unavailable', message: BREAK });
  }
});

app.get('/api/chart', async (req, res) => {
  try {
    // ?bar= takes only the sizes in public/bars.js; anything else is a 400 (bad_bar).
    const range = chartSpecFromQuery({ r: str(req.query.r), from: str(req.query.from), to: str(req.query.to), bar: str(req.query.bar) });
    const data = await getChart(str(req.query.s), range);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    if (err instanceof ChartError) {
      const status = { unavailable: 503, not_found: 404, no_data: 404 }[err.code] || 400;
      if (status === 503) console.error('[chart]', err.message);
      return res.status(status).json({ error: err.code, message: err.message });
    }
    console.error('[chart]', err.message);
    res.status(503).json({ error: 'unavailable', message: BREAK });
  }
});

// Chart flags for a stock: earnings (SEC 8-K item 2.02 and the next date) and ex-dividend days.
app.get('/api/chart-events', async (req, res) => {
  try {
    const data = await getChartEvents(str(req.query.s));
    res.set('Cache-Control', 'public, max-age=900');
    res.json(data);
  } catch (err) {
    if (err instanceof ChartEventsError) return res.status(400).json({ error: err.code, message: err.message });
    console.error('[chart-events]', err.message);
    res.status(503).json({ error: 'unavailable', message: BREAK });
  }
});

app.get('/api/cpi', async (req, res) => {
  try {
    const data = await getCpi({ amount: str(req.query.amount), year: str(req.query.year) });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (err) {
    if (err instanceof CpiError) return res.status(400).json({ error: err.code, message: err.message, examples: CPI_EXAMPLES });
    console.error('[cpi]', err.message);
    res.status(503).json({ error: 'unavailable', message: BREAK });
  }
});

app.get('/api/rates', async (req, res) => {
  try {
    const data = await getRates();
    res.set('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (err) {
    console.error('[rates]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Rate data is taking a break. Try again in a minute.' });
  }
});

app.get('/api/news', async (req, res) => {
  const tab = String(req.query.tab || 'MARKETS').toUpperCase();
  if (!NEWS_TABS.includes(tab)) return res.status(400).json({ error: 'bad_tab', message: 'No such news tab.' });
  if (tab !== 'MARKETS') {
    // Never an error: a tab whose feeds all failed comes back with no items.
    const data = await getNewsTab(tab);
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(data);
  }
  try {
    const data = await getNews();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    console.error('[news]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'News is taking a break. Try again in a minute.' });
  }
});

app.get('/api/whatif/catalog', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(getCatalog());
});

// ?c=IPHONE6+LATTE:3Y (the words after WHATIF)
app.get('/api/whatif', async (req, res) => {
  const tokens = whatifTokens(str(req.query.c) || '');
  if (!tokens) {
    return res.status(400).json({ error: 'usage', message: 'That list does not look right. Type WHATIF to pick from the list.' });
  }
  try {
    const data = await getWhatif(tokens, { risk: true });
    // The certificate: the same words and numbers as the share image.
    const norm = data.rows ? normalizeWhatif(tokens.join(' '), catalog) : null;
    if (norm) data.cert = certModel(data, catalog, norm.command);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    if (err instanceof WhatifError) return res.status(400).json({ error: err.code, message: err.message, unknown: err.unknown });
    console.error('[whatif]', err.message);
    res.status(503).json({ error: 'unavailable', message: BREAK });
  }
});

app.get('/api/funding', async (req, res) => {
  try {
    const data = await getFunding();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    console.error('[funding]', err.message);
    res.status(503).json({ error: 'unavailable', message: BREAK });
  }
});

// FINANCIALS: ?s=AAPL. SEC EDGAR filings, cached a day on the server.
app.get('/api/financials', async (req, res) => {
  try {
    const data = await getFinancials(str(req.query.s));
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (err) {
    if (err instanceof FinancialsError) {
      const status = { bad_symbol: 400, not_found: 404, no_data: 404 }[err.code] || 503;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    console.error('[financials]', err.message);
    res.status(503).json({ error: 'unavailable', message: BREAK });
  }
});

// SCREEN: ?c=SECTOR+TECHNOLOGY+MCAP>10B (the words after SCREEN) &limit=100.
app.get('/api/screen', async (req, res) => {
  const c = str(req.query.c) || '';
  if (c.length > 300) return res.status(400).json({ error: 'usage', message: 'That screen is too long.' });
  try {
    const data = await getScreen(c, str(req.query.limit));
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (err) {
    if (err instanceof ScreenError) return res.status(400).json({ error: err.code, message: err.message });
    console.error('[screen]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Screener data is taking a break. Try again in a minute.' });
  }
});

mountCommandRoutes(app);
startPro(app, { dir });

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint.' }));

// Share images. A bad or unknown command gets the site card, never an error.
const ogDeps = { catalog, getWhatif };
const quoteDeps = { getQuote, getChart, parse: parseCommand };
function sendPng(res, png, maxAge) {
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${maxAge}` }).send(png);
}
app.get('/og/whatif.png', async (req, res) => {
  try {
    sendPng(res, await whatifPng(str(req.query.c) || '', ogDeps), 86400);
  } catch (err) {
    console.error('[og]', err.message);
    try { sendPng(res, await defaultPng(), 300); } catch { res.status(503).end(); }
  }
});
// A ticker card changes with the price: kept 10 minutes.
app.get('/og/quote.png', async (req, res) => {
  try {
    sendPng(res, await quotePng(str(req.query.c) || '', quoteDeps), 600);
  } catch (err) {
    console.error('[og]', err.message);
    try { sendPng(res, await defaultPng(), 300); } catch { res.status(503).end(); }
  }
});
app.get('/og/afford.png', async (req, res) => {
  try {
    sendPng(res, await affordPng(str(req.query.c) || ''), 86400);
  } catch (err) {
    console.error('[og]', err.message);
    try { sendPng(res, await defaultPng(), 300); } catch { res.status(503).end(); }
  }
});
app.get('/og/default.png', async (req, res) => {
  try {
    sendPng(res, await defaultPng(), 86400);
  } catch (err) {
    console.error('[og]', err.message);
    res.status(503).end();
  }
});

// Pages: the HTML is never cached, and it points at versioned assets (see lib/assets.js).
const PUBLIC = path.join(dir, 'public');
const BUILD = buildId(PUBLIC);
const PAGE = versionIndex(readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), BUILD);
const INDEX = withMeta(PAGE, DEFAULT_META);
// /terms, /privacy, /disclaimer: plain server-rendered pages, text in legal/*.md.
mountLegal(app, { build: BUILD });
function sendIndex(res, status = 200, html = INDEX) {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(html);
}

// A shared link gets its own title and image, so the card on X shows the result:
// WHATIF (the certificate), AFFORD (cost per use and verdict) and a ticker (price and a
// 1-month line). Anything else, or a slow answer, gets the site card.
async function shareIndex(c) {
  if (/^\s*AFFORD\s+\S/i.test(c)) {
    const model = affordModel(c);
    return model ? withMeta(PAGE, affordMeta(model)) : INDEX;
  }
  const whatif = /^\s*WHATIF\s+\S/i.test(c);
  if (!whatif && !c.trim()) return INDEX;
  const timeout = new Promise((resolve) => { setTimeout(resolve, 2500, null).unref(); });
  try {
    if (whatif) {
      const model = await Promise.race([getCert(c, ogDeps), timeout]);
      return model ? withMeta(PAGE, certMeta(model)) : INDEX;
    }
    const model = await Promise.race([getQuoteCard(c, quoteDeps), timeout]);
    return model ? withMeta(PAGE, quoteMeta(model)) : INDEX;
  } catch {
    return INDEX;
  }
}
app.get(['/', '/index.html'], async (req, res) => {
  const html = await shareIndex(str(req.query.c) || '');
  sendIndex(res, 200, isEmbedQuery(req.query) ? embedHtml(html) : html);
});

// /v/<build>/...: this build's files are immutable. An older build id (a page loaded
// before a deploy) gets today's files, uncached, so it never pins a mismatched copy.
const immutable = express.static(PUBLIC, { index: false, maxAge: '365d', immutable: true });
const uncached = express.static(PUBLIC, { index: false, cacheControl: false });
app.use('/v/:build', (req, res, next) => {
  if (req.params.build === BUILD) return immutable(req, res, next);
  res.set('Cache-Control', 'no-cache');
  return uncached(req, res, next);
});

// Unversioned paths still work for pages cached before this change.
app.use(express.static(PUBLIC, { index: false, cacheControl: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

app.use((req, res) => sendIndex(res, 404));

app.listen(PORT, HOST, () => {
  console.log(`bloombroke ${BUILD} listening on http://${HOST}:${PORT}`);
  // SCREEN's P/E and dividend numbers: loaded in the background, so no one waits on a cold cache.
  startScreenPrewarm();
});
