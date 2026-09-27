// GUESS: one mystery S&P 100 stock a day, from its 1-year chart (public/screens/guess.js).
//
// The pick: the day is the New York date, and puzzle #1 is GUESS_EPOCH. Each cycle
// through the pool is its own order, a shuffle keyed by a server secret (an HMAC of the
// secret, the cycle and the ticker), so every stock comes up once per cycle and the order
// cannot be worked out from the code. The secret is GUESS_SECRET, or else a random one
// made once and kept in data/.cache/guess-secret (gitignored), so puzzles stay the same
// across restarts and deploys.
//
// The chart: the answer's daily closes over the last year, before today (past prices
// only, so the puzzle does not move during the day), as % change from the first close.
// No price levels and no name.
//
// Hints: four cells per guess, from data we already have: SECTOR (the S&P 100 list),
// 1Y MOVE (the same daily closes), SIZE (market cap from the CNBC S&P 100 batch) and the
// first letter of the ticker. Each says where the answer is compared with the guess.
//
// Routes (mountGuess): /api/guess/today, /api/guess/check?n=&g=, /api/guess/reveal?n=.
// Reveal is not enforced (the answer is one request away); that is fine for a game.

import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTORS } from './sp100.js';
import { nyToday } from '../public/ranges.js';
import { createLimiter, clientIp } from '../pro/ratelimit.js';

export const GUESS_EPOCH = '2026-09-27';
export const TRIES = 6;
export const SOURCE = 'CNBC daily closes';
// The game's own list, frozen: the S&P 100 of 21 Sep 2026 (data/sp100.js) without GOOG
// (GOOG and GOOGL are one company with one chart). It is a copy, not a live filter, so a
// later change to the index list never reshuffles the puzzles. Add or drop names here
// only knowing that it changes every puzzle from then on.
export const POOL = [
  ['AAPL', 'Apple', 'TECH'], ['ABBV', 'AbbVie', 'HEALTH'], ['ABT', 'Abbott Laboratories', 'HEALTH'],
  ['ACN', 'Accenture', 'TECH'], ['ADBE', 'Adobe', 'TECH'], ['AMAT', 'Applied Materials', 'TECH'],
  ['AMD', 'Advanced Micro Devices', 'TECH'], ['AMGN', 'Amgen', 'HEALTH'], ['AMT', 'American Tower', 'RE'],
  ['AMZN', 'Amazon', 'DISC'], ['ANET', 'Arista Networks', 'TECH'], ['AVGO', 'Broadcom', 'TECH'],
  ['AXP', 'American Express', 'FIN'], ['BA', 'Boeing', 'IND'], ['BAC', 'Bank of America', 'FIN'],
  ['BKNG', 'Booking Holdings', 'DISC'], ['BLK', 'BlackRock', 'FIN'], ['BMY', 'Bristol Myers Squibb', 'HEALTH'],
  ['BNY', 'BNY Mellon', 'FIN'], ['BRK.B', 'Berkshire Hathaway B', 'FIN'], ['C', 'Citigroup', 'FIN'],
  ['CAT', 'Caterpillar', 'IND'], ['CMCSA', 'Comcast', 'COMM'], ['COF', 'Capital One', 'FIN'],
  ['COP', 'ConocoPhillips', 'ENERGY'], ['COST', 'Costco', 'STAPLES'], ['CRM', 'Salesforce', 'TECH'],
  ['CSCO', 'Cisco', 'TECH'], ['CVS', 'CVS Health', 'HEALTH'], ['CVX', 'Chevron', 'ENERGY'],
  ['DE', 'Deere', 'IND'], ['DELL', 'Dell Technologies', 'TECH'], ['DHR', 'Danaher', 'HEALTH'],
  ['DIS', 'Walt Disney', 'COMM'], ['DUK', 'Duke Energy', 'UTIL'], ['EMR', 'Emerson Electric', 'IND'],
  ['FDX', 'FedEx', 'IND'], ['GD', 'General Dynamics', 'IND'], ['GE', 'GE Aerospace', 'IND'],
  ['GEV', 'GE Vernova', 'IND'], ['GILD', 'Gilead Sciences', 'HEALTH'], ['GM', 'General Motors', 'DISC'],
  ['GOOGL', 'Alphabet A', 'COMM'], ['GS', 'Goldman Sachs', 'FIN'], ['HD', 'Home Depot', 'DISC'],
  ['IBM', 'IBM', 'TECH'], ['INTC', 'Intel', 'TECH'], ['INTU', 'Intuit', 'TECH'],
  ['ISRG', 'Intuitive Surgical', 'HEALTH'], ['JNJ', 'Johnson & Johnson', 'HEALTH'], ['JPM', 'JPMorgan Chase', 'FIN'],
  ['KO', 'Coca-Cola', 'STAPLES'], ['LIN', 'Linde', 'MAT'], ['LLY', 'Eli Lilly', 'HEALTH'],
  ['LMT', 'Lockheed Martin', 'IND'], ['LOW', "Lowe's", 'DISC'], ['LRCX', 'Lam Research', 'TECH'],
  ['MA', 'Mastercard', 'FIN'], ['MCD', "McDonald's", 'DISC'], ['MDLZ', 'Mondelez', 'STAPLES'],
  ['MDT', 'Medtronic', 'HEALTH'], ['META', 'Meta Platforms', 'COMM'], ['MMM', '3M', 'IND'],
  ['MO', 'Altria', 'STAPLES'], ['MRK', 'Merck', 'HEALTH'], ['MS', 'Morgan Stanley', 'FIN'],
  ['MSFT', 'Microsoft', 'TECH'], ['MU', 'Micron Technology', 'TECH'], ['NEE', 'NextEra Energy', 'UTIL'],
  ['NFLX', 'Netflix', 'COMM'], ['NOW', 'ServiceNow', 'TECH'], ['NVDA', 'Nvidia', 'TECH'],
  ['ORCL', 'Oracle', 'TECH'], ['PANW', 'Palo Alto Networks', 'TECH'], ['PEP', 'PepsiCo', 'STAPLES'],
  ['PFE', 'Pfizer', 'HEALTH'], ['PG', 'Procter & Gamble', 'STAPLES'], ['PLTR', 'Palantir', 'TECH'],
  ['PM', 'Philip Morris', 'STAPLES'], ['QCOM', 'Qualcomm', 'TECH'], ['RTX', 'RTX', 'IND'],
  ['SBUX', 'Starbucks', 'DISC'], ['SCHW', 'Charles Schwab', 'FIN'], ['SNDK', 'Sandisk', 'TECH'],
  ['SO', 'Southern Company', 'UTIL'], ['T', 'AT&T', 'COMM'], ['TMO', 'Thermo Fisher', 'HEALTH'],
  ['TMUS', 'T-Mobile US', 'COMM'], ['TSLA', 'Tesla', 'DISC'], ['TXN', 'Texas Instruments', 'TECH'],
  ['UBER', 'Uber', 'IND'], ['UNH', 'UnitedHealth', 'HEALTH'], ['UNP', 'Union Pacific', 'IND'],
  ['UPS', 'UPS', 'IND'], ['USB', 'U.S. Bancorp', 'FIN'], ['V', 'Visa', 'FIN'],
  ['VZ', 'Verizon', 'COMM'], ['WFC', 'Wells Fargo', 'FIN'], ['WMT', 'Walmart', 'STAPLES'],
  ['XOM', 'ExxonMobil', 'ENERGY'],

].map(([ticker, name, sector]) => ({ ticker, name, sector }));
export const SECRET_FILE = fileURLToPath(new URL('./.cache/guess-secret', import.meta.url));

const DAY = 86_400_000;
const dayMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// '2026-09-27' -> 1. A date before the first puzzle is puzzle 1.
export function puzzleNumber(date, epoch = GUESS_EPOCH) {
  if (!isDay(date)) return 1;
  return Math.max(1, Math.round((dayMs(date) - dayMs(epoch)) / DAY) + 1);
}

export function puzzleDate(n, epoch = GUESS_EPOCH) {
  return new Date(dayMs(epoch) + (n - 1) * DAY).toISOString().slice(0, 10);
}

const rank = (secret, cycle, ticker) => createHmac('sha256', String(secret)).update(`guess:${cycle}:${ticker}`).digest('hex');

// The pool in the order of one cycle. The first of a cycle is never the last of the one
// before (no stock two days running across the join).
export function cycleOrder(secret, cycle, pool = POOL) {
  const order = pool
    .map((m) => [rank(secret, cycle, m.ticker), m])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, m]) => m);
  if (cycle > 0 && order.length > 1) {
    const prev = pool
      .map((m) => [rank(secret, cycle - 1, m.ticker), m])
      .reduce((best, x) => (best === null || x[0] > best[0] ? x : best), null)[1];
    if (order[0].ticker === prev.ticker) [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

// Puzzle n -> its member of the pool ({ ticker, name, sector }).
export function pickAnswer(n, secret, pool = POOL) {
  const i = Math.max(1, Math.floor(n)) - 1;
  const cycle = Math.floor(i / pool.length);
  return cycleOrder(secret, cycle, pool)[i % pool.length];
}

// The secret: GUESS_SECRET, else the one kept in `file`, else a new random one written
// there. When the file cannot be written, the new secret lasts until the next restart.
export function loadSecret({ env = process.env, file = SECRET_FILE, log = console } = {}) {
  const fromEnv = String(env.GUESS_SECRET || '').trim();
  if (fromEnv) return fromEnv;
  const read = () => {
    try { return readFileSync(file, 'utf8').trim(); } catch { return ''; }
  };
  const kept = read();
  if (kept.length >= 32) return kept;
  const fresh = randomBytes(32).toString('hex');
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    // wx: two processes starting at once both end up with the first one's secret.
    writeFileSync(file, `${fresh}\n`, { flag: kept ? 'w' : 'wx', mode: 0o600 });
    return fresh;
  } catch (err) {
    if (err.code === 'EEXIST') {
      const other = read();
      if (other.length >= 32) return other;
    }
    log.error?.('[guess] secret not saved, puzzles change on restart:', err.message);
    return fresh;
  }
}

// '2026-09-28' -> '2025-09-28': the first day of the puzzle's one-year window.
export function yearBefore(date) {
  return `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
}

// Chart points -> the closes on New York days from `from` (the puzzle date a year back)
// up to the day before `date`, oldest first. Both ends come from the puzzle date, so every
// fetch that day (the answer and each guess) covers the same window, whatever day the
// source's own 1Y window starts on.
export function closesBefore(points, date, from = yearBefore(date)) {
  return (Array.isArray(points) ? points : [])
    .filter((p) => {
      if (!Number.isFinite(p?.t) || !Number.isFinite(p?.v) || !(p.v > 0)) return false;
      const d = nyToday(new Date(p.t));
      return d >= from && d < date;
    })
    .sort((a, b) => a.t - b.t);
}

const round2 = (x) => Math.round(x * 100) / 100;

// Closes -> [[t, % change from the first close]].
export function normalise(closes) {
  if (!closes.length) return [];
  const v0 = closes[0].v;
  return closes.map((p) => [p.t, round2((p.v / v0 - 1) * 100)]);
}

// The whole-window move in %, or null with fewer than two closes.
export function oneYearMove(closes) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  return (closes[closes.length - 1].v / closes[0].v - 1) * 100;
}

const MINUS = '−';
export function fmtMove(x) {
  if (!Number.isFinite(x)) return '--';
  const s = Math.abs(x).toFixed(1);
  return `${Number(s) === 0 ? '' : x > 0 ? '+' : MINUS}${s}%`;
}

export function fmtCap(n) {
  if (!(n > 0)) return '--';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

// Grades: hit (right or very close), near (close), miss, none (no data to compare).
// dir says it about the ANSWER, under the guess's own value: ANSWER SMALLER means the
// mystery stock is smaller than the guess; LETTER is A to Z (ANSWER BEFORE: earlier).
// a, g: { ticker, sector, move, cap } for the answer and the guess.
export function hintCells(a, g) {
  const same = a.ticker === g.ticker;
  const cells = [];

  const sectorHit = a.sector === g.sector;
  cells.push({ key: 'SECTOR', value: g.sector || '--', dir: sectorHit ? 'SAME' : 'DIFFERENT', grade: sectorHit ? 'hit' : 'miss' });

  if (Number.isFinite(a.move) && Number.isFinite(g.move)) {
    const diff = a.move - g.move;
    const grade = same || Math.abs(diff) < 5 ? 'hit' : Math.abs(diff) < 20 ? 'near' : 'miss';
    cells.push({ key: '1Y MOVE', value: fmtMove(g.move), dir: grade === 'hit' ? 'CLOSE' : diff > 0 ? 'ANSWER HIGHER' : 'ANSWER LOWER', grade });
  } else {
    cells.push({ key: '1Y MOVE', value: fmtMove(g.move), dir: '--', grade: 'none' });
  }

  if (a.cap > 0 && g.cap > 0) {
    const r = a.cap / g.cap;
    const grade = same || (r >= 0.8 && r <= 1.25) ? 'hit' : r >= 0.5 && r <= 2 ? 'near' : 'miss';
    cells.push({ key: 'SIZE', value: fmtCap(g.cap), dir: grade === 'hit' ? 'CLOSE' : r > 1 ? 'ANSWER BIGGER' : 'ANSWER SMALLER', grade });
  } else {
    cells.push({ key: 'SIZE', value: fmtCap(g.cap), dir: '--', grade: 'none' });
  }

  const la = a.ticker[0];
  const lg = g.ticker[0];
  const d = la.charCodeAt(0) - lg.charCodeAt(0);
  cells.push({ key: 'LETTER', value: lg, dir: d === 0 ? 'SAME' : d > 0 ? 'ANSWER AFTER' : 'ANSWER BEFORE', grade: d === 0 ? 'hit' : Math.abs(d) <= 3 ? 'near' : 'miss' });

  return cells;
}

// "aapl", "BRK-B", "apple" -> the pool member, or null.
export function findMember(raw, pool = POOL) {
  const s = String(raw ?? '').trim().toUpperCase().replace(/-/g, '.');
  if (!s || s.length > 40) return null;
  return pool.find((m) => m.ticker === s) || pool.find((m) => m.name.toUpperCase() === s) || null;
}

export class GuessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The game over a chart source and a market cap source.
// getChart(ticker, '1Y') -> { points: [{ t, v }] }; getCaps() -> { stocks: [{ ticker, marketCap }] }.
export function makeGuess({ getChart, getCaps, secret, now = () => new Date(), pool = POOL } = {}) {
  let day = null;
  const closes = new Map(); // ticker -> Promise<closes> for `day`

  function today() {
    const date = nyToday(now());
    if (date !== day) { day = date; closes.clear(); }
    const n = puzzleNumber(date);
    return { date, n, answer: pickAnswer(n, secret, pool) };
  }

  // One fetch per ticker per day; a failure is not kept.
  function closesFor(date, ticker) {
    if (!closes.has(ticker)) {
      const p = Promise.resolve()
        .then(() => getChart(ticker, '1Y'))
        .then((d) => closesBefore(d?.points, date));
      p.catch(() => { if (closes.get(ticker) === p) closes.delete(ticker); });
      closes.set(ticker, p);
    }
    return closes.get(ticker);
  }

  async function answerCloses(t) {
    let c;
    try { c = await closesFor(t.date, t.answer.ticker); } catch { c = []; }
    if (c.length < 20) throw new GuessError(503, 'unavailable', 'GUESS is taking a break. Try again in a minute.');
    return c;
  }

  async function caps() {
    try {
      const d = await getCaps();
      return new Map((d?.stocks || []).map((s) => [s.ticker, s.marketCap]));
    } catch {
      return new Map();
    }
  }

  const readN = (raw) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : null;
  };

  return {
    async todayPuzzle() {
      const t = today();
      const c = await answerCloses(t);
      return {
        n: t.n, date: t.date, tries: TRIES, source: SOURCE,
        series: normalise(c),
        pool: pool.map((m) => [m.ticker, m.name]),
      };
    },

    async check(rawN, rawGuess) {
      const t = today();
      const n = readN(rawN);
      if (n === null || n > t.n) throw new GuessError(400, 'usage', `Say which puzzle: n=${t.n} is today's.`);
      if (n !== t.n) throw new GuessError(409, 'old_puzzle', `A new puzzle is out: GUESS #${t.n}. Reload to play it.`);
      const g = findMember(rawGuess, pool);
      if (!g) throw new GuessError(400, 'unknown', 'Pick a stock from the S&P 100 list.');
      const ac = await answerCloses(t);
      const [gc, capMap] = await Promise.all([
        g.ticker === t.answer.ticker ? ac : closesFor(t.date, g.ticker).catch(() => []),
        caps(),
      ]);
      const side = (m, c) => ({ ticker: m.ticker, sector: m.sector, move: oneYearMove(c), cap: capMap.get(m.ticker) ?? null });
      const solved = g.ticker === t.answer.ticker;
      return {
        n, guess: { ticker: g.ticker, name: g.name, sector: g.sector },
        cells: hintCells(side(t.answer, ac), side(g, gc)),
        solved,
      };
    },

    reveal(rawN) {
      const t = today();
      const n = readN(rawN);
      if (n === null || n > t.n) throw new GuessError(400, 'usage', `Puzzles run from #1 to #${t.n}.`);
      const a = pickAnswer(n, secret, pool);
      return { n, ticker: a.ticker, name: a.name, sector: a.sector, sectorName: SECTORS[a.sector] || a.sector };
    },
  };
}

export const GUESS_LIMIT = { perMinute: 60 };

// The routes. A mild limit per visitor over all three.
export function mountGuess(app, { getChart, getCaps, secret = loadSecret(), now = () => new Date(), limiter } = {}) {
  const game = makeGuess({ getChart, getCaps, secret, now });
  const lim = limiter || createLimiter({ max: GUESS_LIMIT.perMinute, windowMs: 60_000, maxKeys: 20_000 });
  const str = (v) => (typeof v === 'string' ? v.slice(0, 60) : undefined);

  const handle = (maxAge, fn) => async (req, res) => {
    const hit = lim.hit(clientIp(req));
    if (!hit.ok) {
      res.set('Retry-After', String(hit.retryAfter));
      return res.status(429).json({ error: 'rate_limited', message: 'Too many tries at once. Wait a minute.' });
    }
    try {
      const data = await fn(req);
      res.set('Cache-Control', maxAge ? `private, max-age=${maxAge}` : 'no-store');
      res.json(data);
    } catch (err) {
      if (err instanceof GuessError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error('[guess]', err.message);
      res.status(503).json({ error: 'unavailable', message: 'GUESS is taking a break. Try again in a minute.' });
    }
  };

  app.get('/api/guess/today', handle(60, () => game.todayPuzzle()));
  app.get('/api/guess/check', handle(60, (req) => game.check(str(req.query.n), str(req.query.g))));
  app.get('/api/guess/reveal', handle(300, (req) => game.reveal(str(req.query.n))));
  return game;
}
