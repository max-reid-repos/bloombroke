import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getQuotes, getFxMajors, getQuote, getQuoteList, normalizeTicker, MAX_LIST } from './data/quotes.js';
import { getFx, FxError } from './data/fx.js';
import { getChart, ChartError } from './data/charts.js';
import { getCpi, CpiError, CPI_EXAMPLES } from './data/cpi.js';
import { getRates } from './data/rates.js';
import { getNews } from './data/news.js';
import { search } from './data/search.js';
import { getCatalog, getWhatif, getFunding, catalog } from './data/whatif-service.js';
import { WhatifError } from './data/whatif.js';
import { whatifTokens, normalizeWhatif, certModel } from './data/whatif-cert.js';
import { getCert, whatifPng, defaultPng, withMeta, certMeta, DEFAULT_META } from './lib/og.js';
import { getFinancials, FinancialsError } from './data/financials.js';
import { getScreen, ScreenError } from './data/screen.js';
import { buildId, versionIndex } from './lib/assets.js';
import { readFileSync } from 'node:fs';
import { mountCommandRoutes } from './command-routes.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(dir, '.env')); } catch { /* .env is optional */ }

const PORT = Number(process.env.PORT) || 3020;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://datafa.st",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' https://datafa.st",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
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
    const data = await getQuote(ticker);
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
    const from = str(req.query.from);
    const range = from ? { from, to: str(req.query.to) || null } : str(req.query.r);
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
    const data = await getWhatif(tokens);
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

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint.' }));

// Share images. A bad or unknown command gets the site card, never an error.
const ogDeps = { catalog, getWhatif };
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
function sendIndex(res, status = 200, html = INDEX) {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(html);
}

// A shared WHATIF link (/?c=WHATIF+...) gets its own title and certificate image, so
// the card on X shows the result. Anything else, or a slow answer, gets the site card.
async function whatifIndex(c) {
  if (!/^\s*WHATIF\s+\S/i.test(c)) return INDEX;
  const timeout = new Promise((resolve) => { setTimeout(resolve, 2500, null).unref(); });
  try {
    const model = await Promise.race([getCert(c, ogDeps), timeout]);
    return model ? withMeta(PAGE, certMeta(model)) : INDEX;
  } catch {
    return INDEX;
  }
}
app.get(['/', '/index.html'], async (req, res) => sendIndex(res, 200, await whatifIndex(str(req.query.c) || '')));

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

app.listen(PORT, HOST, () => console.log(`bloombroke ${BUILD} listening on http://${HOST}:${PORT}`));
