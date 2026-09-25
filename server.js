import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getQuotes, getFxMajors, getQuote, normalizeTicker } from './data/quotes.js';
import { getFx, FxError } from './data/fx.js';
import { getChart, ChartError } from './data/charts.js';
import { getCpi, CpiError, CPI_EXAMPLES } from './data/cpi.js';
import { getRates } from './data/rates.js';
import { getNews } from './data/news.js';
import { getCatalog, getWhatif, getFunding } from './data/whatif-service.js';
import { WhatifError } from './data/whatif.js';

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
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
});

app.get('/api/markets', async (req, res) => {
  try {
    const data = await getQuotes();
    res.set('Cache-Control', 'public, max-age=30');
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
    res.set('Cache-Control', 'public, max-age=30');
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
    res.set('Cache-Control', 'public, max-age=30');
    res.json(data);
  } catch (err) {
    console.error('[quote]', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Quote data is taking a break. Try again in a minute.' });
  }
});

app.get('/api/chart', async (req, res) => {
  try {
    const data = await getChart(str(req.query.s), str(req.query.r));
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
    res.set('Cache-Control', 'public, max-age=60');
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
  const c = str(req.query.c) || '';
  const tokens = c.toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (c.length > 600 || tokens.length > 40 || tokens.some((t) => !/^[A-Z0-9.:-]{1,24}$/.test(t))) {
    return res.status(400).json({ error: 'usage', message: 'That list does not look right. Type WHATIF to pick from the list.' });
  }
  try {
    const data = await getWhatif(tokens);
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

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint.' }));

app.use(express.static(path.join(dir, 'public'), { maxAge: '5m', index: 'index.html' }));

app.use((req, res) => res.status(404).sendFile(path.join(dir, 'public', 'index.html')));

app.listen(PORT, HOST, () => console.log(`bloombroke listening on http://${HOST}:${PORT}`));
