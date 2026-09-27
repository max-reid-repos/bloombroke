// Tickers the browser knows without asking the server: the S&P 100 (the same list as
// data/sp100.js, checked by test/resolve.test.js), a few big ETFs, and some well-known
// names outside the index. Used to turn a company name into its ticker offline
// ("nvidia" -> NVDA) and to tell a real ticker from an ordinary word (AFFORD 1200 BIKE).

import { ALIASES, REGISTRY } from './registry.js';
import { resolveInstrument, STOCK_RE } from './instruments.js';

// [ticker, name, ...other names people type]
export const SP100_NAMES = [
  ['AAPL', 'Apple'], ['ABBV', 'AbbVie'], ['ABT', 'Abbott Laboratories', 'Abbott'], ['ACN', 'Accenture'], ['ADBE', 'Adobe'],
  ['AMAT', 'Applied Materials'], ['AMD', 'Advanced Micro Devices'], ['AMGN', 'Amgen'], ['AMT', 'American Tower'],
  ['AMZN', 'Amazon'], ['ANET', 'Arista Networks', 'Arista'], ['AVGO', 'Broadcom'], ['AXP', 'American Express', 'Amex'],
  ['BA', 'Boeing'], ['BAC', 'Bank of America'], ['BKNG', 'Booking Holdings', 'Booking'], ['BLK', 'BlackRock'],
  ['BMY', 'Bristol Myers Squibb'], ['BNY', 'BNY Mellon'], ['BRK.B', 'Berkshire Hathaway B', 'Berkshire Hathaway', 'Berkshire'],
  ['C', 'Citigroup', 'Citi'], ['CAT', 'Caterpillar'], ['CMCSA', 'Comcast'], ['COF', 'Capital One'], ['COP', 'ConocoPhillips'],
  ['COST', 'Costco'], ['CRM', 'Salesforce'], ['CSCO', 'Cisco'], ['CVS', 'CVS Health'], ['CVX', 'Chevron'], ['DE', 'Deere', 'John Deere'],
  ['DELL', 'Dell Technologies', 'Dell'], ['DHR', 'Danaher'], ['DIS', 'Walt Disney', 'Disney'], ['DUK', 'Duke Energy'],
  ['EMR', 'Emerson Electric', 'Emerson'], ['FDX', 'FedEx'], ['GD', 'General Dynamics'], ['GE', 'GE Aerospace', 'General Electric'],
  ['GEV', 'GE Vernova'], ['GILD', 'Gilead Sciences', 'Gilead'], ['GM', 'General Motors'], ['GOOG', 'Alphabet C'],
  ['GOOGL', 'Alphabet A', 'Alphabet', 'Google'], ['GS', 'Goldman Sachs', 'Goldman'], ['HD', 'Home Depot'], ['IBM', 'IBM'],
  ['INTC', 'Intel'], ['INTU', 'Intuit'], ['ISRG', 'Intuitive Surgical'], ['JNJ', 'Johnson & Johnson', 'Johnson and Johnson'],
  ['JPM', 'JPMorgan Chase', 'JPMorgan', 'JP Morgan', 'Chase'], ['KO', 'Coca-Cola', 'Coke'], ['LIN', 'Linde'],
  ['LLY', 'Eli Lilly', 'Lilly'], ['LMT', 'Lockheed Martin', 'Lockheed'], ['LOW', "Lowe's"], ['LRCX', 'Lam Research'],
  ['MA', 'Mastercard'], ['MCD', "McDonald's"], ['MDLZ', 'Mondelez'], ['MDT', 'Medtronic'], ['META', 'Meta Platforms', 'Meta', 'Facebook'],
  ['MMM', '3M'], ['MO', 'Altria'], ['MRK', 'Merck'], ['MS', 'Morgan Stanley'], ['MSFT', 'Microsoft'], ['MU', 'Micron Technology', 'Micron'],
  ['NEE', 'NextEra Energy', 'NextEra'], ['NFLX', 'Netflix'], ['NOW', 'ServiceNow'], ['NVDA', 'Nvidia'], ['ORCL', 'Oracle'],
  ['PANW', 'Palo Alto Networks'], ['PEP', 'PepsiCo', 'Pepsi'], ['PFE', 'Pfizer'], ['PG', 'Procter & Gamble', 'Procter and Gamble'],
  ['PLTR', 'Palantir'], ['PM', 'Philip Morris'], ['QCOM', 'Qualcomm'], ['RTX', 'RTX', 'Raytheon'], ['SBUX', 'Starbucks'],
  ['SCHW', 'Charles Schwab', 'Schwab'], ['SNDK', 'Sandisk'], ['SO', 'Southern Company'], ['T', 'AT&T'], ['TMO', 'Thermo Fisher'],
  ['TMUS', 'T-Mobile US', 'T-Mobile'], ['TSLA', 'Tesla'], ['TXN', 'Texas Instruments'], ['UBER', 'Uber'], ['UNH', 'UnitedHealth'],
  ['UNP', 'Union Pacific'], ['UPS', 'UPS'], ['USB', 'U.S. Bancorp', 'US Bancorp'], ['V', 'Visa'], ['VZ', 'Verizon'],
  ['WFC', 'Wells Fargo'], ['WMT', 'Walmart'], ['XOM', 'ExxonMobil', 'Exxon'],
];

// Big ETFs people type as tickers.
export const BIG_ETFS = ['SPY', 'QQQ', 'VOO', 'VTI', 'IVV', 'IWM', 'DIA', 'VT', 'VXUS', 'BND', 'GLD', 'SLV', 'ARKK', 'SCHD', 'TLT'];

// Well-known companies outside the S&P 100, by name.
export const OTHER_NAMES = [
  ['F', 'Ford'], ['NKE', 'Nike'], ['PYPL', 'PayPal'], ['ABNB', 'Airbnb'], ['SHOP', 'Shopify'], ['SPOT', 'Spotify'],
  ['COIN', 'Coinbase'], ['GME', 'GameStop'], ['TGT', 'Target'], ['SNAP', 'Snap', 'Snapchat'],
  ['PINS', 'Pinterest'], ['RDDT', 'Reddit'], ['RIVN', 'Rivian'], ['TSM', 'TSMC', 'Taiwan Semiconductor'], ['BABA', 'Alibaba'],
  ['SONY', 'Sony'], ['TM', 'Toyota'], ['DAL', 'Delta Air Lines'], ['AAL', 'American Airlines'], ['LUV', 'Southwest Airlines', 'Southwest'],
  ['SMCI', 'Super Micro Computer', 'Supermicro'], ['MSTR', 'MicroStrategy'], ['ZM', 'Zoom'], ['EBAY', 'eBay'],
  ['ETSY', 'Etsy'], ['DASH', 'DoorDash'], ['LYFT', 'Lyft'], ['CMG', 'Chipotle'], ['HSY', 'Hershey'], ['KHC', 'Kraft Heinz'],
];

// A name as a plain key: "McDonald's" -> "mcdonalds", "Coca-Cola" -> "coca cola".
export function nameKey(s) {
  return String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const NAME_INDEX = new Map();
for (const [id, ...names] of [...SP100_NAMES, ...OTHER_NAMES]) {
  for (const n of names) if (!NAME_INDEX.has(nameKey(n))) NAME_INDEX.set(nameKey(n), { id, name: names[0] });
}

// Tickers that are surely tickers (for AFFORD's investment check and to skip a lookup).
export const KNOWN_TICKERS = new Set([...SP100_NAMES.map(([id]) => id), ...BIG_ETFS]);
// Every ticker listed here, including the well-known names outside the index.
export const LISTED_TICKERS = new Set([...KNOWN_TICKERS, ...OTHER_NAMES.map(([id]) => id)]);

// "nvidia" -> { id: 'NVDA', name: 'Nvidia' }; "coca cola" -> KO. Exact names only.
export function tickerForName(text) {
  return NAME_INDEX.get(nameKey(text)) || null;
}

// The listed name of a ticker, or null.
export function nameForTicker(id) {
  const row = [...SP100_NAMES, ...OTHER_NAMES].find(([t]) => t === id);
  return row ? row[1] : null;
}

// Listed US stocks and ETFs whose plain ticker opens something else here: an alias (M is
// MARKETS, H is HELP), a command (HELP, DESK, CHAT) or an instrument (GOLD is spot gold,
// DOW is the Dow). $ + the ticker opens the stock; the plain word shows a "Stock: $GOLD"
// hint. Checked against the quote source (NYSE, Nasdaq, NYSE Arca), Sep 2026.
export const SHADOWED_TICKERS = new Set([
  'M', 'H', 'DOW', 'GOLD', 'WTI', 'BTC', 'ETH', 'CORN', 'DAX', 'ASX', 'USDX', 'XPT', 'TRON',
  'HELP', 'DESK', 'CHAT', 'IPOS', 'LOAN', 'GIFT',
]);

// "$" + ticker typed anywhere (WATCH ADD $GOLD, ALERTS $GOLD > 30, a form field): the
// stock's id. The plain ticker when the plain word opens only that stock ($AAPL -> AAPL),
// else the ticker with its $ ($GOLD, $M, $W). null for anything else. The router's own
// stockId (app.js) gives the same answer; words typed in the command bar reach the
// screens already in this form.
export function stockIdOf(word) {
  const w = String(word ?? '').trim().toUpperCase();
  const m = STOCK_RE.exec(w);
  if (!m) return null;
  const t = m[1];
  const clash = resolveInstrument(t) || ALIASES[t] || t === 'W' || SHADOWED_TICKERS.has(t) || REGISTRY.some((c) => c.name === t);
  return clash ? `$${t}` : t;
}
