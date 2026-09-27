// JSON routes for the extra commands (WORLD, MOVERS, HEATMAP, ...). One route per command.
// Mounted from server.js with mountCommandRoutes(app).

import { getWorld } from './data/world.js';
import { getMovers, getHeatmap, getFishtank } from './data/sp100.js';
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
import { getTickerNews, getTickerHeadlines, TickerNewsError } from './data/tickernews.js';
import { CompanyDataError } from './data/company-kit.js';
import { getInsiders } from './data/insiders.js';
import { getOwners } from './data/owners.js';
import { getFilings } from './data/filings.js';
import { getShorts } from './data/shorts.js';
import { getBeats } from './data/beats.js';
import { getValue } from './data/value.js';
import { getIpos } from './data/ipos.js';
import { getSplits, getExDiv } from './data/splits.js';
import { getOptions, OptionsError } from './data/options.js';
import { getEconomy, getEconomySeries, EconomyError } from './data/economy.js';
import { getFedPath } from './data/fedpath.js';
import { getBreadth } from './data/breadth.js';
import { getWhy, WhyError } from './data/why.js'; // WHY

const BREAK = 'Data is taking a break. Try again in a minute.';
const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : undefined);
const STATUS = { unavailable: 503, not_found: 404, no_data: 404, no_expiry: 404 };
const KNOWN = [CompareError, EarningsError, ProfileError, HistoryError, DividendsError, TickerNewsError, CompanyDataError, OptionsError, EconomyError, WhyError];

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
  route(app, '/api/fishtank', 30, () => getFishtank()); // FISHTANK: every member, cap or not
  route(app, '/api/sectors', 60, (req) => getSectors({ period: str(req.query.p) })); // ?p=1D 1W 1M YTD 1Y
  route(app, '/api/compare', 60, (req) => getCompare({ symbols: str(req.query.s), range: str(req.query.r) || '1Y' }));
  // Today's yields: the same 15 s quote batch as /api/rates, so the same short max-age.
  route(app, '/api/curve', 5, () => getCurve());
  route(app, '/api/bonds', 60, () => getBonds());
  route(app, '/api/commodities', 60, () => getCommodities());
  route(app, '/api/crypto', 60, () => getCrypto());
  route(app, '/api/fxmatrix', 30, () => getFxMatrix());
  route(app, '/api/earnings', 300, (req) => getEarnings({ date: str(req.query.d), week: req.query.w === '1' }));
  route(app, '/api/calendar', 300, () => getCalendar());
  route(app, '/api/profile', 3600, (req) => getProfile(str(req.query.s)));
  route(app, '/api/history', 300, (req) => getHistory({ ticker: str(req.query.s), from: str(req.query.from), to: str(req.query.to) }));
  route(app, '/api/dividends', 3600, (req) => getDividends(str(req.query.s)));
  route(app, '/api/tickernews', 120, (req) => getTickerNews(str(req.query.s)));
  // WHY: the biggest daily moves of the last year and what came out each day.
  route(app, '/api/why', 300, (req) => getWhy(str(req.query.s)));
  // Chart N flags on 1D and 5D: the company's headlines of the last few days.
  route(app, '/api/chart-news', 120, (req) => getTickerHeadlines(str(req.query.s)));
  // Company data: filings and holdings change daily at most, calendars hourly.
  route(app, '/api/insiders', 900, (req) => getInsiders(str(req.query.s)));
  route(app, '/api/owners', 900, (req) => getOwners(str(req.query.s)));
  route(app, '/api/filings', 900, (req) => getFilings(str(req.query.s), str(req.query.f)));
  route(app, '/api/shorts', 900, (req) => getShorts(str(req.query.s)));
  route(app, '/api/beats', 900, (req) => getBeats(str(req.query.s)));
  route(app, '/api/value', 60, (req) => getValue(str(req.query.s)));
  route(app, '/api/ipos', 300, () => getIpos());
  route(app, '/api/splits', 300, () => getSplits());
  route(app, '/api/exdiv', 300, (req) => getExDiv(str(req.query.d)));
  route(app, '/api/options', 60, (req) => getOptions(str(req.query.s), str(req.query.e)));
  // ?id=UNRATE&r=10Y: one series for the chart. No id: the whole dashboard.
  route(app, '/api/economy', 600, (req) => (req.query.id ? getEconomySeries(str(req.query.id), str(req.query.r)) : getEconomy()));
  route(app, '/api/fedpath', 60, () => getFedPath());
  route(app, '/api/breadth', 60, () => getBreadth());
}
