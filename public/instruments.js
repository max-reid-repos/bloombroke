// Every instrument the terminal knows by name: the MARKETS rows, the ticker tape,
// the FX majors and the Treasury yields. Shared by the server (which maps ids to
// CNBC symbols) and the browser (names, aliases, kinds). Pure data plus lookups.
//
// kind: index | future | spot | crypto | fx | yield (spot: a metal's spot price).
// Plain stocks are not listed here; any ticker-shaped word is a stock.
// group: the heading the row sits under on MARKETS and HOME.
// markets: shown on MARKETS and HOME. tape: shown on the ticker tape.
// us: a US index (intraday charts show the 9:30 to 16:00 ET session, unless allDay).

const I = (id, name, group, kind, src, decimals, extra = {}) => ({
  id, name, group, kind, src, decimals, markets: true, tape: false, aliases: [], ...extra,
});

// BONDS grid: government bond yields by country. `terms` lists only the maturities the
// source quotes (checked one by one); a missing one shows as --.
export const BOND_TERMS = ['2Y', '5Y', '10Y', '30Y'];
export const BOND_GRID = [
  { cc: 'US', name: 'United States', short: 'US', region: 'Americas', terms: ['2Y', '5Y', '10Y', '30Y'] },
  { cc: 'CA', name: 'Canada', short: 'Canada', region: 'Americas', terms: ['2Y', '5Y', '10Y', '30Y'] },
  { cc: 'BR', name: 'Brazil', short: 'Brazil', region: 'Americas', terms: ['2Y', '10Y'] },
  { cc: 'MX', name: 'Mexico', short: 'Mexico', region: 'Americas', terms: ['10Y'] },
  { cc: 'DE', name: 'Germany', short: 'Germany', region: 'Europe', terms: ['2Y', '5Y', '10Y', '30Y'] },
  { cc: 'GB', name: 'United Kingdom', short: 'UK', region: 'Europe', terms: ['2Y', '5Y', '10Y', '30Y'] },
  { cc: 'FR', name: 'France', short: 'France', region: 'Europe', terms: ['2Y', '5Y', '10Y', '30Y'] },
  { cc: 'IT', name: 'Italy', short: 'Italy', region: 'Europe', terms: ['2Y', '5Y', '10Y', '30Y'] },
  { cc: 'ES', name: 'Spain', short: 'Spain', region: 'Europe', terms: ['2Y', '5Y', '10Y', '30Y'] },
  { cc: 'NL', name: 'Netherlands', short: 'Netherlands', region: 'Europe', terms: ['2Y', '10Y'] },
  { cc: 'CH', name: 'Switzerland', short: 'Switzerland', region: 'Europe', terms: ['2Y', '10Y'] },
  { cc: 'PT', name: 'Portugal', short: 'Portugal', region: 'Europe', terms: ['2Y', '5Y', '10Y'] },
  { cc: 'GR', name: 'Greece', short: 'Greece', region: 'Europe', terms: ['2Y', '10Y'] },
  { cc: 'SE', name: 'Sweden', short: 'Sweden', region: 'Europe', terms: ['2Y', '10Y'] },
  { cc: 'JP', name: 'Japan', short: 'Japan', region: 'Asia-Pacific', terms: ['2Y', '5Y', '10Y', '30Y'] },
  { cc: 'CN', name: 'China', short: 'China', region: 'Asia-Pacific', terms: ['2Y', '10Y'] },
  { cc: 'AU', name: 'Australia', short: 'Australia', region: 'Asia-Pacific', terms: ['2Y', '5Y', '10Y'] },
  { cc: 'IN', name: 'India', short: 'India', region: 'Asia-Pacific', terms: ['10Y', '30Y'] },
  { cc: 'KR', name: 'South Korea', short: 'South Korea', region: 'Asia-Pacific', terms: ['5Y', '10Y'] },
  { cc: 'NZ', name: 'New Zealand', short: 'New Zealand', region: 'Asia-Pacific', terms: ['2Y', '5Y', '10Y'] },
  { cc: 'HK', name: 'Hong Kong', short: 'Hong Kong', region: 'Asia-Pacific', terms: ['10Y'] },
];
const TERM_WORDS = { '2Y': '2-year', '5Y': '5-year', '10Y': '10-year', '30Y': '30-year' };
// Yields listed further down by hand; the rest of the grid is generated.
const LISTED_YIELDS = new Set(['US2Y', 'US10Y', 'US30Y', 'DE10Y', 'GB10Y', 'FR10Y', 'IT10Y', 'JP10Y', 'CN10Y', 'AU10Y', 'CA10Y', 'IN10Y']);

export const INSTRUMENTS = [
  I('SPX', 'S&P 500', 'Americas', 'index', '.SPX', 2, { us: true, tape: true, aliases: ['S&P', 'S&P500', 'SP500', 'SANDP'] }),
  I('NDX', 'Nasdaq 100', 'Americas', 'index', '.NDX', 2, { us: true, tape: true, aliases: ['NASDAQ', 'NASDAQ100'] }),
  I('DJI', 'Dow', 'Americas', 'index', '.DJI', 2, { us: true, tape: true, aliases: ['DOW', 'DOWJONES'] }),
  I('RUT', 'Russell 2000', 'Americas', 'index', '.RUT', 2, { us: true, tape: true, aliases: ['RUSSELL', 'RUSSELL2000'] }),
  I('VIX', 'VIX', 'Americas', 'index', '.VIX', 2, { us: true, tape: true, aliases: ['VOLATILITY'] }),
  I('VXN', 'Nasdaq volatility (VXN)', 'Americas', 'index', '.VXN', 2, { us: true, aliases: ['NASDAQVIX', 'NASDAQVOLATILITY'] }),

  I('SPFUT', 'S&P 500 futures', 'US futures', 'future', '@SP.1', 2, { aliases: ['SPFUTURES', 'SP500FUTURES', 'S&PFUTURES', 'S&P500FUTURES'] }),
  I('NDFUT', 'Nasdaq 100 futures', 'US futures', 'future', '@ND.1', 2, { aliases: ['NASDAQFUTURES', 'NASDAQ100FUTURES'] }),
  I('DJFUT', 'Dow futures', 'US futures', 'future', '@DJ.1', 0, { aliases: ['DOWFUTURES'] }),

  I('FTSE', 'FTSE 100', 'Europe', 'index', '.FTSE', 2, { tape: true, aliases: ['FTSE100'] }),
  I('DAX', 'DAX', 'Europe', 'index', '.GDAXI', 2, { tape: true }),
  I('STOXX50', 'Euro Stoxx 50', 'Europe', 'index', '.STOXX50E', 2, { tape: true, aliases: ['EUROSTOXX', 'EUROSTOXX50', 'SX5E'] }),
  I('CAC40', 'CAC 40', 'Europe', 'index', '.FCHI', 2, { aliases: ['FCHI'] }),

  I('N225', 'Nikkei 225', 'Asia Pacific', 'index', '.N225', 2, { tape: true, aliases: ['NIKKEI', 'NIKKEI225'] }),
  I('HSI', 'Hang Seng', 'Asia Pacific', 'index', '.HSI', 2, { tape: true, aliases: ['HANGSENG'] }),
  I('SHANGHAI', 'Shanghai Composite', 'Asia Pacific', 'index', '.SSEC', 2, { aliases: ['SSEC', 'SHCOMP'] }),
  I('KOSPI', 'KOSPI', 'Asia Pacific', 'index', '.KS11', 2, { aliases: ['KS11'] }),
  I('ASX200', 'ASX 200', 'Asia Pacific', 'index', '.AXJO', 2, { aliases: ['ASX', 'AXJO'] }),
  I('SET', 'SET Thailand', 'Asia Pacific', 'index', '.SETI', 2, { aliases: ['SETI', 'THAILAND'] }),

  // GOLD and SILVER are the spot prices (what "the gold price" means, real time); the
  // COMEX front-month futures are GOLD FUTURES and SILVER FUTURES (and on COMMODITIES).
  I('GOLD', 'Spot gold (XAU)', 'Commodities', 'spot', 'XAU=', 2, { tape: true, base: 'XAU', quote: 'USD', aliases: ['XAU', 'XAUUSD', 'SPOTGOLD', 'SPOTXAU', 'GOLDSPOT'] }),
  I('SILVER', 'Spot silver (XAG)', 'Commodities', 'spot', 'XAG=', 3, { tape: true, base: 'XAG', quote: 'USD', aliases: ['XAG', 'XAGUSD', 'SPOTSILVER', 'SPOTXAG', 'SILVERSPOT'] }),
  I('WTI', 'Oil (WTI)', 'Commodities', 'future', '@CL.1', 2, { tape: true, aliases: ['OIL', 'CRUDE', 'CRUDEOIL'] }),
  I('NATGAS', 'Natural Gas', 'Commodities', 'future', '@NG.1', 3, { aliases: ['NATURALGAS', 'GAS'] }),
  I('COPPER', 'Copper', 'Commodities', 'future', '@HG.1', 4),
  I('GOLDFUT', 'Gold futures (COMEX)', 'Commodities', 'future', '@GC.1', 2, { aliases: ['GOLDFUTURES', 'GOLDFUTURE', 'COMEXGOLD'] }),
  I('SILVERFUT', 'Silver futures (COMEX)', 'Commodities', 'future', '@SI.1', 3, { aliases: ['SILVERFUTURES', 'SILVERFUTURE', 'COMEXSILVER'] }),
  I('BALTICDRY', 'Baltic Dry Index', 'Commodities', 'index', '.BADI', 0, { aliases: ['BDI', 'BADI', 'BALTIC', 'BALTICDRYINDEX'] }),

  I('BTC', 'Bitcoin', 'Crypto', 'crypto', 'BTC.CM=', 0, { tape: true, aliases: ['BITCOIN', 'BTCUSD'] }),
  I('ETH', 'Ethereum', 'Crypto', 'crypto', 'ETH.CM=', 2, { tape: true, aliases: ['ETHEREUM', 'ETHER', 'ETHUSD'] }),
  I('BTCFUT', 'Bitcoin futures (CME)', 'Crypto', 'future', '@BTC.1', 0, { aliases: ['BITCOINFUTURES', 'BTCFUTURES'] }),

  I('EURUSD', 'EUR/USD', 'Currencies', 'fx', 'EUR=', 4, { tape: true, base: 'EUR', quote: 'USD', aliases: ['EUR/USD', 'EURO'] }),
  I('GBPUSD', 'GBP/USD', 'Currencies', 'fx', 'GBP=', 4, { tape: true, base: 'GBP', quote: 'USD', aliases: ['GBP/USD', 'POUND', 'CABLE'] }),
  I('USDJPY', 'USD/JPY', 'Currencies', 'fx', 'JPY=', 2, { tape: true, base: 'USD', quote: 'JPY', aliases: ['USD/JPY', 'YEN'] }),
  I('USDCNY', 'USD/CNY', 'Currencies', 'fx', 'CNY=', 4, { base: 'USD', quote: 'CNY', aliases: ['USD/CNY', 'YUAN', 'RENMINBI'] }),
  I('DXY', 'US Dollar Index', 'Currencies', 'index', '.DXY', 3, { us: true, allDay: true, tape: true, aliases: ['DOLLAR', 'USDX', 'DOLLARINDEX'] }),

  I('US10Y', 'US 10Y yield', 'Rates', 'yield', 'US10Y', 3, { tape: true, aliases: ['TNX', 'TENYEAR'], longName: 'US 10-year Treasury', term: '10Y' }),
  I('MOVEINDEX', 'MOVE bond volatility', 'Rates', 'index', '.MOVE', 2, { us: true, allDay: true, aliases: ['BONDVOLATILITY', 'MOVEVOLATILITY'] }),

  // Not on MARKETS, but every one opens its own screen from HOME and RATES.
  I('USDCHF', 'USD/CHF', 'Currencies', 'fx', 'CHF=', 4, { markets: false, base: 'USD', quote: 'CHF', aliases: ['USD/CHF', 'FRANC'] }),
  I('USDTHB', 'USD/THB', 'Currencies', 'fx', 'THB=', 2, { markets: false, base: 'USD', quote: 'THB', aliases: ['USD/THB', 'BAHT'] }),
  I('US2Y', 'US 2Y yield', 'Rates', 'yield', 'US2Y', 3, { markets: false, longName: 'US 2-year Treasury', term: '2Y' }),
  I('US30Y', 'US 30Y yield', 'Rates', 'yield', 'US30Y', 3, { markets: false, longName: 'US 30-year Treasury', term: '30Y' }),
  // The rest of the Treasury curve (CURVE). In the one shared quote batch, so CURVE and
  // RATES show the same yields with the same time and the same RT or DLY tag.
  ...[['1M', '1-month'], ['3M', '3-month'], ['6M', '6-month'], ['1Y', '1-year'], ['3Y', '3-year'], ['7Y', '7-year'], ['20Y', '20-year']].map(([t, words]) => I(`US${t}`, `US ${t} yield`, 'Rates', 'yield', `US${t}`, 3, {
    markets: false, longName: `US ${words} Treasury`, term: t,
  })),

  // Rows on COMMODITIES, BONDS and CRYPTO. Each opens its own screen.
  I('BRENT', 'Oil (Brent)', 'Commodities', 'future', '@LCO.1', 2, { markets: false, aliases: ['BRENTOIL', 'BRENTCRUDE'] }),
  I('PLATINUM', 'Platinum', 'Commodities', 'future', '@PL.1', 2, { markets: false, aliases: ['XPT', 'XPTUSD'] }),
  I('WHEAT', 'Wheat', 'Commodities', 'future', '@W.1', 2, { markets: false }),
  I('CORN', 'Corn', 'Commodities', 'future', '@C.1', 2, { markets: false }),
  I('SOYBEANS', 'Soybeans', 'Commodities', 'future', '@S.1', 2, { markets: false, aliases: ['SOYBEAN', 'SOY'] }),
  I('COFFEE', 'Coffee', 'Commodities', 'future', '@KC.1', 2, { markets: false }),
  I('SUGAR', 'Sugar', 'Commodities', 'future', '@SB.1', 2, { markets: false }),
  I('COCOA', 'Cocoa', 'Commodities', 'future', '@CC.1', 0, { markets: false }),
  I('GASOLINE', 'Gasoline (RBOB)', 'Commodities', 'future', '@RB.1', 4, { markets: false, aliases: ['RBOB', 'PETROL'] }),
  I('LIVECATTLE', 'Live cattle', 'Commodities', 'future', '@LC.1', 3, { markets: false, aliases: ['CATTLE'] }),

  // More indexes, shown on WORLD. Each opens its own screen.
  I('SOX', 'Semiconductors (SOX)', 'Americas', 'index', '.SOX', 2, { markets: false, us: true, aliases: ['SEMIS', 'SEMICONDUCTORS', 'PHLXSEMI'] }),
  I('DJTRANS', 'Dow Transports', 'Americas', 'index', '.DJT', 2, { markets: false, us: true, aliases: ['DOWTRANSPORTS', 'TRANSPORTS'] }),
  I('SPXEW', 'S&P 500 Equal Weight', 'Americas', 'index', '.SPXEW', 2, { markets: false, us: true, aliases: ['EQUALWEIGHT', 'S&P500EQUALWEIGHT'] }),
  I('NYA', 'NYSE Composite', 'Americas', 'index', '.NYA', 2, { markets: false, us: true, aliases: ['NYSECOMPOSITE'] }),
  I('MERVAL', 'Merval', 'Americas', 'index', '.MERV', 2, { markets: false, aliases: ['MERV', 'ARGENTINA'] }),
  I('STOXX600', 'STOXX Europe 600', 'Europe', 'index', '.STOXX', 2, { markets: false, aliases: ['STOXX', 'SXXP', 'EUROPE600'] }),
  I('BIST100', 'BIST 100', 'Europe', 'index', '.XU100', 2, { markets: false, aliases: ['XU100', 'BIST', 'TURKEY'] }),
  I('HSCEI', 'Hang Seng China Enterprises', 'Asia Pacific', 'index', '.HSCE', 2, { markets: false, aliases: ['HSCE', 'HCHINA', 'CHINAENTERPRISES'] }),
  I('VNINDEX', 'VN-Index', 'Asia Pacific', 'index', '.VNI', 2, { markets: false, aliases: ['VNI', 'VIETNAM'] }),
  ...[
    ['DE', 'Germany'], ['GB', 'UK'], ['FR', 'France'], ['IT', 'Italy'], ['JP', 'Japan'],
    ['CN', 'China'], ['AU', 'Australia'], ['CA', 'Canada'], ['IN', 'India'],
  ].map(([cc, country]) => I(`${cc}10Y`, `${country} 10Y yield`, 'Rates', 'yield', `${cc}10Y`, 3, { markets: false, longName: `${country} 10-year government bond`, term: '10Y' })),
  ...BOND_GRID.flatMap((b) => b.terms.filter((t) => !LISTED_YIELDS.has(`${b.cc}${t}`)).map((t) => I(`${b.cc}${t}`, `${b.short} ${t} yield`, 'Rates', 'yield', `${b.cc}${t}`, 3, {
    markets: false, longName: b.cc === 'US' ? `US ${TERM_WORDS[t]} Treasury` : `${b.short} ${TERM_WORDS[t]} government bond`, term: t,
  }))),
  ...[
    ['SOL', 'Solana'], ['XRP', 'XRP'], ['BNB', 'BNB'], ['DOGE', 'Dogecoin'], ['ADA', 'Cardano'], ['TRX', 'Tron'],
    ['LINK', 'Chainlink'], ['XLM', 'Stellar'], ['LTC', 'Litecoin'], ['AVAX', 'Avalanche'], ['DOT', 'Polkadot'],
    ['HYPE', 'Hyperliquid'], ['ZEC', 'Zcash'], ['BCH', 'Bitcoin Cash'], ['SHIB', 'Shiba Inu'], ['SUI', 'Sui'],
    ['USDT', 'Tether'], ['USDC', 'USD Coin'],
  ].map(([sym, name]) => I(`${sym}USD`, name, 'Crypto', 'crypto', `${sym}.CM=`, 4, {
    markets: false,
    aliases: name.toUpperCase().replace(/\s+/g, '') === sym ? [] : [name.toUpperCase().replace(/\s+/g, '')],
  })),

  // --- WORLDMAP: each country's main index (screens/worldmap-geo.js) -----------------
  // The ones WORLD lists that had no screen of their own. Ids are 6+ letters or not a US
  // ticker, so no stock is shadowed (IBEX is a Nasdaq stock: the index is IBEX35).
  I('TSX', 'S&P/TSX Composite', 'Americas', 'index', '.GSPTSE', 2, { markets: false, aliases: ['GSPTSE', 'CANADA'] }),
  I('MEXBOL', 'S&P/BMV IPC', 'Americas', 'index', '.MXX', 2, { markets: false, aliases: ['MXX', 'MEXICO'] }),
  I('BOVESPA', 'Bovespa', 'Americas', 'index', '.BVSP', 2, { markets: false, aliases: ['BVSP', 'BRAZIL'] }),
  I('IBEX35', 'IBEX 35', 'Europe', 'index', '.IBEX', 2, { markets: false, aliases: ['SPAIN'] }),
  I('FTSEMIB', 'FTSE MIB', 'Europe', 'index', '.FTMIB', 2, { markets: false, aliases: ['FTMIB', 'ITALY'] }),
  I('AEX', 'AEX', 'Europe', 'index', '.AEX', 2, { markets: false, aliases: ['NETHERLANDS'] }),
  I('SMI', 'SMI', 'Europe', 'index', '.SSMI', 2, { markets: false, aliases: ['SSMI', 'SWITZERLAND'] }),
  I('TAIEX', 'Taiwan Weighted', 'Asia Pacific', 'index', '.TWII', 2, { markets: false, aliases: ['TWII', 'TAIWAN'] }),
  I('NIFTY50', 'Nifty 50', 'Asia Pacific', 'index', '.NSEI', 2, { markets: false, aliases: ['NIFTY', 'NSEI', 'INDIA'] }),
  // --- end WORLDMAP ------------------------------------------------------------------
];

// The instrument behind a CNBC symbol, for rows that come from other lists.
export function instrumentBySrc(src) {
  return INSTRUMENTS.find((i) => i.src === src) || null;
}

// The FX majors on HOME, and the yields on RATES, in display order.
export const FX_MAJOR_IDS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCNY', 'USDTHB'];
export const YIELD_IDS = ['US2Y', 'US10Y', 'US30Y'];
// The US Treasury curve, shortest first (CURVE).
export const CURVE_IDS = ['US1M', 'US3M', 'US6M', 'US1Y', 'US2Y', 'US3Y', 'US5Y', 'US7Y', 'US10Y', 'US20Y', 'US30Y'];

const BY_KEY = new Map();
for (const inst of INSTRUMENTS) {
  for (const k of [inst.id, ...inst.aliases]) BY_KEY.set(k.toUpperCase(), inst);
}

export function instrumentById(id) {
  return INSTRUMENTS.find((i) => i.id === id) || null;
}

// "gold", "EUR/USD", "S&P500" -> the instrument, or null.
export function resolveInstrument(word) {
  return BY_KEY.get(String(word ?? '').trim().toUpperCase()) || null;
}

// The leading words of a command that name an instrument: "EURO STOXX 50 5Y" -> STOXX50
// using 3 words. Returns { inst, used } or null. Tries the longest match first.
export function matchInstrument(tokens) {
  for (let n = Math.min(3, tokens.length); n >= 1; n -= 1) {
    const inst = resolveInstrument(tokens.slice(0, n).join(''));
    if (inst) return { inst, used: n };
  }
  return null;
}

// Instruments whose id, alias or name starts with the typed text (for the suggestion list).
export function searchInstruments(text, limit = 8) {
  const t = String(text ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!t) return [];
  const score = (i) => {
    if (i.id === t) return 0;
    if (i.id.startsWith(t)) return 1;
    if (i.aliases.some((a) => a.toUpperCase().startsWith(t))) return 2;
    if (i.name.toUpperCase().replace(/\s+/g, '').startsWith(t)) return 3;
    return 9;
  };
  return INSTRUMENTS.map((i) => [score(i), i]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, i]) => i);
}
