// Every instrument the terminal knows by name: the MARKETS rows, the ticker tape,
// the FX majors and the Treasury yields. Shared by the server (which maps ids to
// CNBC symbols) and the browser (names, aliases, kinds). Pure data plus lookups.
//
// kind: index | future | crypto | fx | yield. Plain stocks are not listed here;
// any ticker-shaped word is a stock.
// group: the heading the row sits under on MARKETS and HOME.
// markets: shown on MARKETS and HOME. tape: shown on the ticker tape.
// us: a US index (intraday charts show the 9:30 to 16:00 ET session, unless allDay).

const I = (id, name, group, kind, src, decimals, extra = {}) => ({
  id, name, group, kind, src, decimals, markets: true, tape: false, aliases: [], ...extra,
});

export const INSTRUMENTS = [
  I('SPX', 'S&P 500', 'Americas', 'index', '.SPX', 2, { us: true, tape: true, aliases: ['S&P', 'S&P500', 'SP500', 'SANDP'] }),
  I('NDX', 'Nasdaq 100', 'Americas', 'index', '.NDX', 2, { us: true, tape: true, aliases: ['NASDAQ', 'NASDAQ100'] }),
  I('DJI', 'Dow', 'Americas', 'index', '.DJI', 2, { us: true, tape: true, aliases: ['DOW', 'DOWJONES'] }),
  I('RUT', 'Russell 2000', 'Americas', 'index', '.RUT', 2, { us: true, tape: true, aliases: ['RUSSELL', 'RUSSELL2000'] }),
  I('VIX', 'VIX', 'Americas', 'index', '.VIX', 2, { us: true, tape: true, aliases: ['VOLATILITY'] }),

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

  I('GOLD', 'Gold', 'Commodities', 'future', '@GC.1', 2, { tape: true, aliases: ['XAU', 'XAUUSD'] }),
  I('SILVER', 'Silver', 'Commodities', 'future', '@SI.1', 3, { tape: true, aliases: ['XAG', 'XAGUSD'] }),
  I('WTI', 'Oil (WTI)', 'Commodities', 'future', '@CL.1', 2, { tape: true, aliases: ['OIL', 'CRUDE', 'CRUDEOIL'] }),
  I('NATGAS', 'Natural Gas', 'Commodities', 'future', '@NG.1', 3, { aliases: ['NATURALGAS', 'GAS'] }),
  I('COPPER', 'Copper', 'Commodities', 'future', '@HG.1', 4),

  I('BTC', 'Bitcoin', 'Crypto', 'crypto', 'BTC.CM=', 0, { tape: true, aliases: ['BITCOIN', 'BTCUSD'] }),
  I('ETH', 'Ethereum', 'Crypto', 'crypto', 'ETH.CM=', 2, { tape: true, aliases: ['ETHEREUM', 'ETHER', 'ETHUSD'] }),

  I('EURUSD', 'EUR/USD', 'Currencies', 'fx', 'EUR=', 4, { tape: true, base: 'EUR', quote: 'USD', aliases: ['EUR/USD', 'EURO'] }),
  I('GBPUSD', 'GBP/USD', 'Currencies', 'fx', 'GBP=', 4, { tape: true, base: 'GBP', quote: 'USD', aliases: ['GBP/USD', 'POUND', 'CABLE'] }),
  I('USDJPY', 'USD/JPY', 'Currencies', 'fx', 'JPY=', 2, { tape: true, base: 'USD', quote: 'JPY', aliases: ['USD/JPY', 'YEN'] }),
  I('USDCNY', 'USD/CNY', 'Currencies', 'fx', 'CNY=', 4, { base: 'USD', quote: 'CNY', aliases: ['USD/CNY', 'YUAN', 'RENMINBI'] }),
  I('DXY', 'US Dollar Index', 'Currencies', 'index', '.DXY', 3, { us: true, allDay: true, tape: true, aliases: ['DOLLAR', 'USDX', 'DOLLARINDEX'] }),

  I('US10Y', 'US 10Y yield', 'Rates', 'yield', 'US10Y', 3, { tape: true, aliases: ['TNX', 'TENYEAR'], longName: 'US 10-year Treasury', term: '10Y' }),

  // Not on MARKETS, but every one opens its own screen from HOME and RATES.
  I('USDCHF', 'USD/CHF', 'Currencies', 'fx', 'CHF=', 4, { markets: false, base: 'USD', quote: 'CHF', aliases: ['USD/CHF', 'FRANC'] }),
  I('USDTHB', 'USD/THB', 'Currencies', 'fx', 'THB=', 2, { markets: false, base: 'USD', quote: 'THB', aliases: ['USD/THB', 'BAHT'] }),
  I('US2Y', 'US 2Y yield', 'Rates', 'yield', 'US2Y', 3, { markets: false, longName: 'US 2-year Treasury', term: '2Y' }),
  I('US30Y', 'US 30Y yield', 'Rates', 'yield', 'US30Y', 3, { markets: false, longName: 'US 30-year Treasury', term: '30Y' }),
];

// The FX majors on HOME, and the yields on RATES, in display order.
export const FX_MAJOR_IDS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCNY', 'USDTHB'];
export const YIELD_IDS = ['US2Y', 'US10Y', 'US30Y'];

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
