// JSON routes for the extra commands (WORLD, MOVERS, HEATMAP, ...). One route per command.
// Mounted from server.js with mountCommandRoutes(app).

import { getWorld } from './data/world.js';
import { getMovers, getHeatmap } from './data/sp100.js';
import { getSectors } from './data/sectors.js';
import { getCompare, CompareError } from './data/compare.js';
import { getCurve } from './data/curve.js';
import { getBonds } from './data/bonds.js';
import { getCommodities } from './data/commodities.js';
import { getCrypto } from './data/crypto.js';
import { getFxMatrix } from './data/fxmatrix.js';
import { getEarnings, EarningsError } from './data/earnings.js';
import { getCalendar } from './data/calendar.js';
import { getProfile, ProfileError } from './data/profile.js';
import { getHistory, HistoryError } from './data/history.js';
import { getDividends, DividendsError } from './data/dividends.js';
import { getTickerNews, TickerNewsError } from './data/tickernews.js';

const BREAK = 'Data is taking a break. Try again in a minute.';
const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : undefined);
const STATUS = { unavailable: 503, not_found: 404, no_data: 404 };
const KNOWN = [CompareError, EarningsError, ProfileError, HistoryError, DividendsError, TickerNewsError];

// route(app, '/api/x', maxAgeSeconds, (req) => promise)
function route(app, path, maxAge, load) {
  app.get(path, async (req, res) => {
    try {
      const data = await load(req);
      res.set('Cache-Control', `public, max-age=${maxAge}`);
      res.json(data);
    } catch (err) {
      if (KNOWN.some((E) => err instanceof E)) {
        const status = STATUS[err.code] || 400;
        if (status === 503) console.error(`[${path}]`, err.message);
        return res.status(status).json({ error: err.code, message: err.message });
      }
      console.error(`[${path}]`, err.message);
      res.status(503).json({ error: 'unavailable', message: BREAK });
    }
  });
}

export function mountCommandRoutes(app) {
  route(app, '/api/world', 30, () => getWorld());
  route(app, '/api/movers', 30, () => getMovers());
  route(app, '/api/heatmap', 30, () => getHeatmap());
  route(app, '/api/sectors', 60, () => getSectors());
  route(app, '/api/compare', 60, (req) => getCompare({ symbols: str(req.query.s), range: str(req.query.r) || '1Y' }));
  route(app, '/api/curve', 60, () => getCurve());
  route(app, '/api/bonds', 60, () => getBonds());
  route(app, '/api/commodities', 60, () => getCommodities());
  route(app, '/api/crypto', 60, () => getCrypto());
  route(app, '/api/fxmatrix', 300, () => getFxMatrix());
  route(app, '/api/earnings', 300, (req) => getEarnings({ date: str(req.query.d), week: req.query.w === '1' }));
  route(app, '/api/calendar', 300, () => getCalendar());
  route(app, '/api/profile', 3600, (req) => getProfile(str(req.query.s)));
  route(app, '/api/history', 300, (req) => getHistory({ ticker: str(req.query.s), from: str(req.query.from), to: str(req.query.to) }));
  route(app, '/api/dividends', 3600, (req) => getDividends(str(req.query.s)));
  route(app, '/api/tickernews', 120, (req) => getTickerNews(str(req.query.s)));
}
