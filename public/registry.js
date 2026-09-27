// The command registry: one entry per command, and the one source for HELP, the MENU
// launcher, the command bar suggestions and the stock function bar. The router (app.js
// and the commands*.js files) parses and runs commands; this file only describes them.
//
// Entry fields:
//   name        what you type (HELP <name> opens its detail)
//   aliases     other words that run it
//   category    one of CATEGORIES
//   summary     what it does, one line
//   syntax      the words it takes: <needed> [optional] A|B
//   examples    runnable commands; the first is the one HELP and MENU run
//   keywords    words people search for (synonyms), lower case
//   takesTicker AAPL <NAME> works (ticker first)
//   bar         its place on a stock screen's function bar (1 = first)
//   options     [[word, meaning]] for HELP <name>
//   source      where the data comes from
//   delay       how fresh it is
//   pattern     not a word you type (<TICKER>): HELP only, never suggested
//   soon        on the way: listed, not runnable
//   hidden      runs, but never listed (420)
// PHRASES (below) lists the plain words that surely mean one command.

export const CATEGORIES = [
  'Start here',
  'Markets',
  'Stocks and companies',
  'Charts',
  'Rates and bonds',
  'FX',
  'Crypto and commodities',
  'Economy and calendars',
  'Screens and lists',
  'Weird data',
  'Your stuff',
  'Money tools',
  'Pro',
  'Legal',
];

const RANGES = [['1D 5D 1M 3M 6M YTD', 'A preset range'], ['1Y 2Y 5Y 10Y MAX', 'Longer ranges'], ['<from> <to>', 'Two dates, like 2020-01-01 2024-12-31'], ['FROM <date>', 'From a date to today']];

export const REGISTRY = [
  // --- Start here -----------------------------------------------------------------
  {
    name: 'HELP', aliases: ['?', 'H'], category: 'Start here', summary: 'Every command, with a search box and examples',
    syntax: 'HELP [<command>]', examples: ['HELP', 'HELP FX', 'HELP AAPL'], keywords: ['commands', 'how', 'guide', 'manual', 'list'],
    options: [['<command>', 'Opens that command: syntax, options, examples, source']],
    source: 'Built in', delay: 'None',
  },
  {
    name: 'MENU', category: 'Start here', summary: 'Every command by category, in a quick overlay (Ctrl+K)',
    syntax: 'MENU', examples: ['MENU'], keywords: ['launcher', 'navigate', 'find', 'categories'],
    source: 'Built in', delay: 'None',
  },

  // --- Markets --------------------------------------------------------------------
  {
    name: 'HOME', category: 'Markets', summary: 'Markets, the S&P 500 and news on one screen',
    syntax: 'HOME', examples: ['HOME'], keywords: ['start', 'overview', 'dashboard', 'front page'],
    source: 'CNBC quotes; headlines from CNBC, MarketWatch and Yahoo Finance', delay: 'Real time or delayed, marked RT or DLY on each row',
  },
  {
    name: 'MARKETS', aliases: ['M', 'MARKET'], category: 'Markets', summary: 'World markets at a glance: indexes, futures, commodities, FX, rates',
    syntax: 'MARKETS', examples: ['MARKETS'], keywords: ['indexes', 'indices', 'overview', 'futures', 'stocks', 'world'],
    source: 'CNBC', delay: 'US indexes, FX, crypto and yields real time. Futures about 10 minutes, non-US indexes about 15',
  },
  {
    name: 'WORLD', category: 'Markets', summary: 'World stock indexes by region, open or closed',
    syntax: 'WORLD', examples: ['WORLD'], keywords: ['global', 'international', 'europe', 'asia', 'indexes'],
    source: 'CNBC; hours from each exchange', delay: 'May be delayed',
  },
  {
    name: 'CLOCK', category: 'Markets', summary: 'World market clocks: open, closed, time to the bell',
    syntax: 'CLOCK', examples: ['CLOCK'], keywords: ['hours', 'open', 'close', 'bell', 'time', 'holiday'],
    source: 'Exchange hours, built in', delay: 'Live',
  },
  {
    name: 'MOVERS', category: 'Markets', summary: 'Biggest gainers, losers and most traded in the S&P 100',
    syntax: 'MOVERS', examples: ['MOVERS'], keywords: ['gainers', 'losers', 'top', 'active', 'volume'],
    source: 'CNBC', delay: 'May be delayed',
  },
  // --- TRENDING: most opened tickers here (data/trending.js) ---
  {
    name: 'TRENDING', category: 'Markets', summary: 'Most opened tickers here',
    syntax: 'TRENDING', examples: ['TRENDING'], keywords: ['popular', 'most viewed', 'most opened', 'people', 'crowd', 'trending'],
    source: 'Anonymous counts of ticker screens opened on Bloombroke; prices from CNBC', delay: 'The last hour, or the last 24 hours when it is quiet; refreshed every minute',
  },
  // --- end TRENDING ---
  {
    name: 'HEATMAP', category: 'Markets', summary: 'The S&P 100 by sector, size and colour',
    syntax: 'HEATMAP', examples: ['HEATMAP'], keywords: ['map', 'treemap', 'sectors', 'colour', 'color'],
    source: 'CNBC', delay: 'May be delayed',
  },
  // --- WORLDMAP (screens/worldmap.js) ---
  {
    name: 'WORLDMAP', category: 'Markets', summary: 'World map: indexes, ships, storms',
    syntax: 'WORLDMAP', examples: ['WORLDMAP'], keywords: ['world map', 'globe', 'countries', 'geography', 'chokepoints', 'hurricanes', 'storms'],
    source: 'CNBC; IMF PortWatch; National Hurricane Center; map: Natural Earth', delay: 'Indexes may be delayed; ships about 6 days behind; storms at the latest NHC advisory',
  },
  // --- end WORLDMAP ---
  {
    name: 'SECTORS', category: 'Markets', summary: 'The 11 sectors: today, 1 month and this year',
    syntax: 'SECTORS', examples: ['SECTORS'], keywords: ['industries', 'etf', 'performance', 'rotation'],
    source: 'CNBC', delay: 'May be delayed',
  },
  {
    name: 'BREADTH', category: 'Markets', summary: 'How many stocks rose and fell, by exchange and sector',
    syntax: 'BREADTH', examples: ['BREADTH'], keywords: ['advance', 'decline', 'up', 'down', 'participation'],
    source: 'Nasdaq stock screener; S&P 100 from CNBC', delay: 'Exchanges at the last close; S&P 100 live',
  },
  {
    name: 'NEWS', category: 'Markets', summary: 'Headlines that move markets, or about one company', takesTicker: true, bar: 2,
    syntax: 'NEWS [MACRO|SEC|WIRES|WSB|<ticker>]', examples: ['NEWS', 'NEWS AAPL', 'TSLA NEWS', 'NEWS MACRO', 'NEWS SEC', 'NEWS WIRES', 'NEWS WSB'],
    keywords: ['headlines', 'stories', 'articles', 'press', 'press releases', 'fed', 'bls', '8-k', 'wires', 'reddit', 'wallstreetbets', 'wsb'],
    options: [
      ['MARKETS', 'Market headlines (the default)'], ['MACRO', 'Fed and BLS releases'], ['SEC', 'Latest 8-K company filings'],
      ['WIRES', 'Company press releases'], ['WSB', 'Hot posts on wallstreetbets'], ['<ticker>', 'Only headlines about that company'],
    ],
    source: 'CNBC, MarketWatch, Yahoo Finance; Federal Reserve, BLS; SEC EDGAR; PR Newswire, GlobeNewswire, Business Wire; Reddit; per company Nasdaq, Seeking Alpha, SEC EDGAR',
    delay: 'A few minutes',
  },

  // --- Stocks and companies -----------------------------------------------------------
  {
    name: '<TICKER>', pattern: true, category: 'Stocks and companies', summary: 'Any ticker, index, currency pair, commodity or coin: price, chart and key numbers',
    syntax: '<symbol> [<range>]', examples: ['AAPL', 'TSLA 5Y', 'GOLD', 'EURUSD', 'SPX YTD', 'AAPL 2020-01-01 2024-12-31'],
    keywords: ['stock', 'quote', 'price', 'symbol', 'share', 'index', 'coin'], options: RANGES,
    source: 'Nasdaq Last Sale for US stocks; CNBC for the rest', delay: 'US stocks real time; others marked RT or DLY',
  },
  {
    name: '<TICKER> <FUNCTION>', pattern: true, category: 'Stocks and companies', summary: 'Any function for one ticker, ticker first',
    syntax: '<ticker> <function> [<words>]', examples: ['AAPL NEWS', 'AAPL CHART 5Y', 'AAPL FINANCIALS', 'AAPL INSIDERS', 'AAPL WATCH', 'AAPL COMPARE MSFT'],
    keywords: ['grammar', 'function', 'ticker first'],
    source: 'The function you pick', delay: 'The function you pick',
  },
  {
    name: 'PROFILE', category: 'Stocks and companies', summary: 'What a company does, where it is, its website', takesTicker: true, bar: 4,
    syntax: 'PROFILE <ticker>', examples: ['PROFILE AAPL', 'PROFILE KO'], keywords: ['about', 'description', 'business', 'company', 'website', 'sector'],
    source: 'Nasdaq; SEC EDGAR', delay: 'Daily',
  },
  {
    name: 'VALUE', category: 'Stocks and companies', summary: 'P/E, dividend yield, margins, debt and the 52 week range', takesTicker: true, bar: 13,
    syntax: 'VALUE <ticker>', examples: ['VALUE AAPL', 'VALUE JPM'], keywords: ['valuation', 'pe', 'p/e', 'ratio', 'margin', 'debt', 'fundamentals', 'cheap'],
    source: 'CNBC', delay: 'May be delayed',
  },
  {
    name: 'FINANCIALS', category: 'Stocks and companies', summary: 'Income, balance sheet and cash flow from SEC filings', takesTicker: true, bar: 3,
    syntax: 'FINANCIALS <ticker> [BALANCE|CASHFLOW] [QUARTERLY]', examples: ['FINANCIALS AAPL', 'FINANCIALS MSFT BALANCE'],
    keywords: ['income', 'revenue', 'profit', 'balance sheet', 'cash flow', 'statements', 'sales', 'earnings'],
    options: [['BALANCE', 'Balance sheet'], ['CASHFLOW', 'Cash flow statement'], ['QUARTERLY', 'Quarters, not years']],
    source: 'SEC EDGAR company facts', delay: 'As filed',
  },
  {
    name: 'DIVIDENDS', category: 'Stocks and companies', summary: 'Dividend yield and every payment', takesTicker: true, bar: 6,
    syntax: 'DIVIDENDS <ticker>', examples: ['DIVIDENDS PEP', 'DIVIDENDS AAPL'], keywords: ['dividend', 'yield', 'payout', 'income', 'payments'],
    source: 'Nasdaq', delay: 'Daily',
  },
  {
    name: 'BEATS', category: 'Stocks and companies', summary: 'Reported EPS against the consensus estimate', takesTicker: true, bar: 12,
    syntax: 'BEATS <ticker>', examples: ['BEATS AAPL', 'BEATS KO'], keywords: ['earnings', 'eps', 'surprise', 'estimate', 'consensus', 'miss'],
    source: 'Nasdaq', delay: 'Daily',
  },
  {
    name: 'INSIDERS', category: 'Stocks and companies', summary: 'What officers and directors bought and sold', takesTicker: true, bar: 8,
    syntax: 'INSIDERS <ticker>', examples: ['INSIDERS AAPL', 'INSIDERS NVDA'], keywords: ['insider', 'form 4', 'executives', 'directors', 'buying', 'selling'],
    source: 'Nasdaq, from SEC Form 4', delay: 'Daily',
  },
  {
    name: 'OWNERS', category: 'Stocks and companies', summary: 'The biggest funds holding a stock, from 13F filings', takesTicker: true, bar: 9,
    syntax: 'OWNERS <ticker>', examples: ['OWNERS AAPL', 'OWNERS KO'], keywords: ['holders', 'institutions', 'funds', '13f', 'ownership', 'shareholders'],
    source: 'Nasdaq, from SEC 13F filings', delay: 'Quarterly filings',
  },
  {
    name: 'FILINGS', category: 'Stocks and companies', summary: 'Latest SEC filings, with links to sec.gov', takesTicker: true, bar: 10,
    syntax: 'FILINGS <ticker> [10-K|10-Q|8-K|4|ALL]', examples: ['FILINGS AAPL', 'FILINGS TSLA 8-K'], keywords: ['sec', 'edgar', '10-k', 'annual report', 'documents'],
    options: [['10-K', 'Annual reports'], ['10-Q', 'Quarterly reports'], ['8-K', 'News the company must report'], ['4', 'Insider trades'], ['ALL', 'Every filing, insider paperwork too (the default leaves it out)']],
    source: 'SEC EDGAR', delay: 'Minutes after filing',
  },
  {
    name: 'SHORTS', category: 'Stocks and companies', summary: 'Short interest and days to cover, twice a month', takesTicker: true, bar: 11,
    syntax: 'SHORTS <ticker>', examples: ['SHORTS AAPL', 'SHORTS TSLA'], keywords: ['short interest', 'short sellers', 'squeeze', 'days to cover'],
    source: 'Nasdaq', delay: 'Twice a month',
  },
  {
    name: 'OPTIONS', category: 'Stocks and companies', summary: 'Option chain: calls and puts by strike', takesTicker: true, bar: 7,
    syntax: 'OPTIONS <ticker> [<expiry>]', examples: ['OPTIONS AAPL', 'AAPL OPTIONS', 'OPTIONS SPY'], keywords: ['calls', 'puts', 'chain', 'strike', 'derivatives', 'implied volatility'],
    options: [['<expiry>', 'An expiry date, like 2026-12-18']],
    source: 'Cboe', delay: '15 minutes',
  },

  // --- Charts ---------------------------------------------------------------------------
  {
    name: 'CHART', category: 'Charts', summary: 'A price chart for any symbol and range', takesTicker: true, bar: 1,
    syntax: 'CHART <symbol> [<range>]', examples: ['CHART AAPL 5Y', 'AAPL CHART YTD'], keywords: ['graph', 'price', 'history', 'plot'], options: RANGES,
    source: 'CNBC; Nasdaq for US stocks today', delay: 'Marked RT or DLY',
  },
  {
    name: 'COMPARE', category: 'Charts', summary: 'Race 2 to 5 tickers over a range', takesTicker: true,
    syntax: 'COMPARE <tickers> [<range>]', examples: ['COMPARE AAPL MSFT NVDA', 'COMPARE KO PEP 5Y'], keywords: ['versus', 'vs', 'race', 'performance', 'relative'],
    options: [['<tickers>', '2 to 5 tickers'], ['<range>', '1M 3M 6M YTD 1Y 2Y 5Y 10Y MAX']],
    source: 'CNBC', delay: 'May be delayed',
  },
  {
    name: 'HISTORY', category: 'Charts', summary: 'Daily prices for any dates, with a CSV download', takesTicker: true, bar: 5,
    syntax: 'HISTORY <ticker> [<from> [<to>]]', examples: ['HISTORY AAPL', 'HISTORY TSLA 2024'], keywords: ['historical', 'prices', 'csv', 'download', 'close', 'data'],
    options: [['<from>', 'A year (2024) or a date'], ['<to>', 'An end date']],
    source: 'CNBC, adjusted for splits', delay: 'Daily closes',
  },

  // --- Rates and bonds ----------------------------------------------------------------
  {
    name: 'RATES', aliases: ['RATE'], category: 'Rates and bonds', summary: 'The interest rates that touch your money',
    syntax: 'RATES', examples: ['RATES'], keywords: ['interest', 'mortgage', 'fed funds', 'treasury', 'yield'],
    source: 'CNBC, New York Fed, Freddie Mac', delay: 'Treasuries real time; mortgages weekly',
  },
  {
    name: 'CURVE', category: 'Rates and bonds', summary: 'US Treasury yield curve: today, 1 month and 1 year ago',
    syntax: 'CURVE', examples: ['CURVE'], keywords: ['yield curve', 'treasury', 'inversion', 'yield', 'bonds'],
    source: 'CNBC; US Treasury', delay: 'Today may be delayed',
  },
  {
    name: 'BONDS', category: 'Rates and bonds', summary: 'Government bond yields by country: 2Y to 30Y, spreads, curves',
    syntax: 'BONDS [SPREADS|CURVE]', examples: ['BONDS', 'BONDS SPREADS', 'BONDS CURVE'], keywords: ['yield', 'government', 'gilts', 'bunds', 'jgb', 'spreads'],
    options: [['SPREADS', 'Each country against the US'], ['CURVE', 'Yield curves side by side']],
    source: 'CNBC', delay: 'May be delayed',
  },
  {
    name: 'FEDPATH', category: 'Rates and bonds', summary: 'The Fed funds rate implied by futures, month by month',
    syntax: 'FEDPATH', examples: ['FEDPATH'], keywords: ['fed', 'rate cut', 'rate hike', 'fomc', 'futures', 'central bank'],
    source: 'CBOT Fed funds futures via CNBC; New York Fed', delay: 'About 10 minutes',
  },

  // --- FX -------------------------------------------------------------------------------
  {
    name: 'FX', category: 'FX', summary: 'Convert money between currencies',
    syntax: 'FX [<amount>] <from> <to>', examples: ['FX 500 USD THB', 'FX USD CAD'], keywords: ['currency', 'convert', 'exchange rate', 'forex', 'money'],
    options: [['<amount>', 'How much (1 if left out)'], ['<from> <to>', 'Three-letter currency codes']],
    source: 'CNBC', delay: 'Real time',
  },
  {
    name: 'FXMATRIX', category: 'FX', summary: "Cross rates for nine currencies, or HEAT for today's moves",
    syntax: 'FXMATRIX [HEAT]', examples: ['FXMATRIX', 'FXMATRIX HEAT'], keywords: ['cross rates', 'currency', 'forex', 'heat'],
    options: [['HEAT', "Today's % moves instead of rates"]],
    source: 'CNBC', delay: 'Real time',
  },

  // --- Crypto and commodities -----------------------------------------------------------
  {
    name: 'CRYPTO', category: 'Crypto and commodities', summary: 'The top 20 coins, 24 hours and 7 days',
    syntax: 'CRYPTO', examples: ['CRYPTO'], keywords: ['bitcoin', 'ethereum', 'coins', 'btc', 'eth'],
    source: 'CoinGecko', delay: 'A minute or two',
  },
  {
    name: 'COMMODITIES', category: 'Crypto and commodities', summary: 'Oil, gold, wheat and more',
    syntax: 'COMMODITIES', examples: ['COMMODITIES'], keywords: ['oil', 'gold', 'silver', 'wheat', 'futures', 'metals', 'energy'],
    source: 'CNBC futures', delay: 'Delayed',
  },

  // --- Economy and calendars ------------------------------------------------------------
  {
    name: 'ECONOMY', category: 'Economy and calendars', summary: 'US economy: jobs, inflation, growth, spending, with charts',
    syntax: 'ECONOMY [<indicator>] [<range>]', examples: ['ECONOMY', 'ECONOMY UNRATE', 'ECONOMY CPI MAX'], keywords: ['gdp', 'jobs', 'unemployment', 'inflation', 'macro', 'fred'],
    options: [['<indicator>', 'A FRED series, like UNRATE or CPI'], ['<range>', 'A chart range, like 5Y or MAX']],
    source: 'FRED, St. Louis Fed', delay: 'As released',
  },
  {
    name: 'CALENDAR', category: 'Economy and calendars', summary: "This week's economic events: jobs, inflation, central banks",
    syntax: 'CALENDAR [US|ALL]', examples: ['CALENDAR', 'CALENDAR ALL'], keywords: ['events', 'releases', 'schedule', 'fomc', 'payrolls'],
    options: [['US', 'US events only'], ['ALL', 'Every country and every event']],
    source: 'Forex Factory weekly feed', delay: 'Hourly',
  },
  {
    name: 'EARNINGS', category: 'Economy and calendars', summary: 'Who reports earnings today, or this week', tickerSoon: true,
    syntax: 'EARNINGS [<day>|WEEK]', examples: ['EARNINGS', 'EARNINGS WEEK', 'EARNINGS TOMORROW'], keywords: ['reports', 'eps', 'results', 'quarterly'],
    options: [['<day>', 'TODAY, TOMORROW or a date'], ['WEEK', 'The whole week']],
    source: 'Nasdaq', delay: 'Hourly',
  },
  {
    name: 'IPOS', category: 'Economy and calendars', summary: 'IPOs: upcoming, priced and filed',
    syntax: 'IPOS', examples: ['IPOS'], keywords: ['ipo', 'listing', 'new issues', 'offering'],
    source: 'Nasdaq', delay: 'Hourly',
  },
  {
    name: 'SPLITS', category: 'Economy and calendars', summary: 'Upcoming stock splits and reverse splits',
    syntax: 'SPLITS', examples: ['SPLITS'], keywords: ['split', 'reverse split'],
    source: 'Nasdaq', delay: 'Hourly',
  },
  {
    name: 'EXDIV', category: 'Economy and calendars', summary: 'Ex-dividend dates for the next five weekdays',
    syntax: 'EXDIV [<day>]', examples: ['EXDIV', 'EXDIV 2026-10-01'], keywords: ['ex-dividend', 'dividend', 'record date'],
    options: [['<day>', 'A date, like 2026-10-01']],
    source: 'Nasdaq', delay: 'Hourly',
  },

  // --- Screens and lists ----------------------------------------------------------------
  {
    name: 'SCREEN', aliases: ['SCREENER'], category: 'Screens and lists', summary: 'Find stocks by sector, size, price and move',
    syntax: 'SCREEN [<filters>]', examples: ['SCREEN', 'SCREEN GAINERS', 'SCREEN SECTOR TECH MCAP>10B'], keywords: ['screener', 'filter', 'find', 'search', 'stocks'],
    options: [['SECTOR <name>', 'TECH, FINANCE, ENERGY ...'], ['MCAP PRICE CHG VOL', 'With > < >= <=, like MCAP>10B'], ['PE DIV', 'P/E and dividend yield, like PE<30'], ['SORT <column>', 'Sort, then HIGH or LOW'], ['GAINERS LOSERS', 'Presets']],
    source: 'Nasdaq stock screener; CNBC', delay: 'Delayed',
  },

  // --- Your stuff -----------------------------------------------------------------------
  {
    name: 'WATCH', aliases: ['WATCHLIST'], category: 'Your stuff', summary: 'Your watchlist, live: any stock, index, pair, coin or future', takesTicker: true,
    syntax: 'WATCH [ADD|REMOVE <symbols>] [CLEAR|EXPORT|IMPORT]', examples: ['WATCH', 'WATCH ADD AAPL TSLA EURUSD', 'WATCH REMOVE TSLA', 'WATCH EXPORT'], usageExample: 'WATCH ADD AAPL TSLA',
    keywords: ['watchlist', 'favourites', 'favorites', 'list', 'track'],
    options: [['ADD <symbols>', 'Add one or more'], ['REMOVE <symbols>', 'Take them off'], ['CLEAR', 'Empty the list'], ['EXPORT', 'Copy the list as text'], ['IMPORT <list>', 'Paste a list back']],
    source: 'Saved in this browser; prices live', delay: 'Marked RT or DLY',
  },
  {
    name: 'PORTFOLIO', aliases: ['PF'], category: 'Your stuff', summary: 'Your holdings: value, day gain, total gain, weights',
    syntax: 'PF [ADD <ticker> <shares> @ <cost>|SELL <ticker> <shares>|REMOVE <ticker>]', examples: ['PF', 'PF ADD AAPL 10 @ 150', 'PF SELL AAPL 3', 'PF EXPORT'], usageExample: 'PF ADD AAPL 10 @ 150',
    keywords: ['holdings', 'positions', 'gains', 'profit', 'loss'],
    options: [['ADD <ticker> <shares> @ <cost>', 'Record a buy'], ['SELL <ticker> <shares>', 'Record a sale'], ['REMOVE <ticker>', 'Drop a holding'], ['EXPORT', 'Copy as CSV'], ['IMPORT', 'Paste a CSV back']],
    source: 'Saved in this browser; prices live', delay: 'Every 15 seconds',
  },
  {
    name: 'DESK', category: 'Your stuff', summary: 'Build your own screen: any commands side by side, four desks',
    // DESK cards: presets, and +<command> typed on DESK.
    syntax: 'DESK [1-4] [RESET|WEIRD|MACRO|CRYPTO]', examples: ['DESK', 'DESK 2', 'DESK RESET', 'DESK WEIRD', 'DESK MACRO', 'DESK CRYPTO'], keywords: ['layout', 'workspace', 'panels', 'dashboard', 'custom', 'preset', 'cards'],
    options: [['1-4', 'Which desk'], ['RESET', 'Start that desk again'], ['WEIRD', 'Twelve weird gauge cards'], ['MACRO', 'Rates, FX, CPI, macro news'], ['CRYPTO', 'Bitcoin, Ether, coins, news'], ['+<command>', 'On DESK: add a panel']],
    source: 'Saved in this browser', delay: 'Each panel its own',
  },
  {
    name: 'TAPE', category: 'Your stuff', summary: 'The scrolling ticker tape: on or off, a DESK panel, or your own list (Pro)',
    syntax: 'TAPE [ON|OFF|ADD <tickers>|REMOVE <tickers>|RESET]', examples: ['TAPE', 'TAPE ON', 'TAPE OFF', 'TAPE ADD AAPL'], keywords: ['ticker tape', 'scroll', 'crawl', 'marquee'],
    options: [['ON', 'Show the tape above the status line'], ['OFF', 'Hide it (the default)'], ['ADD <tickers>', 'Put them on your tape (Pro)'], ['REMOVE <tickers>', 'Take them off (Pro)'], ['RESET', 'Back to the standard tape (Pro)']],
    source: 'CNBC', delay: 'Marked RT or DLY',
  },

  // --- Money tools ----------------------------------------------------------------------
  {
    name: 'CPI', aliases: ['INFLATION'], category: 'Money tools', summary: 'What money from a past year is worth today',
    syntax: 'CPI [<amount>] [<year>]', examples: ['CPI 100 2015', 'CPI 1000 1990'], keywords: ['inflation', 'purchasing power', 'prices', 'then and now'],
    options: [['<amount>', 'Dollars (100 if left out)'], ['<year>', 'The past year (2000 if left out)']],
    source: 'US Bureau of Labor Statistics, CPI-U', delay: 'Monthly',
  },
  {
    name: 'WHATIF', category: 'Money tools', summary: "In hindsight: the maker's stock instead of what you bought",
    syntax: 'WHATIF [<item> ...]', examples: ['WHATIF', 'WHATIF IPHONE6 LATTE:3Y'], keywords: ['regret', 'instead', 'what if', 'opportunity cost'],
    options: [['<item>', 'A thing you bought, like IPHONE6'], ['<habit>:<years>', 'A habit over years, like LATTE:3Y']],
    source: 'Built-in prices; CNBC stock history', delay: 'Daily closes',
  },
  {
    name: 'AFFORD', category: 'Money tools', summary: 'Can I afford it? Cost per use of a thing you buy, and a verdict',
    syntax: 'AFFORD <price> [<thing>] [<n> PER WEEK] [FOR <n>Y]', examples: ['AFFORD 1200', 'AFFORD 1200 BIKE 2 PER WEEK', 'AFFORD 90 3 TIMES A MONTH FOR 2Y'], keywords: ['buy', 'cost per use', 'purchase', 'worth it', 'spend'],
    options: [['<price>', 'What it costs'], ['<thing>', 'What it is, like BIKE (a label, optional)'], ['<n> PER DAY|WEEK|MONTH|YEAR', 'How often you use it. Also TWICE A WEEK, 2X WEEK, 3 TIMES A MONTH, DAILY'], ['FOR <n>Y', 'How long it lasts, like FOR 3Y or FOR 18 MONTHS']],
    source: 'Built in', delay: 'None',
  },
  {
    name: 'WAGE', category: 'Money tools', summary: 'Save your hourly pay, then AFFORD shows hours of work',
    syntax: 'WAGE <per hour>', examples: ['WAGE 35'], keywords: ['salary', 'pay', 'hourly', 'income'],
    options: [['<per hour>', 'Your pay per hour'], ['OFF', 'Forget it']],
    source: 'Saved in this browser', delay: 'None',
  },
  {
    name: 'LOAN', category: 'Money tools', summary: "Monthly payment and total interest, at today's mortgage rate or yours",
    syntax: 'LOAN <amount> [<years>] [<rate>%]', examples: ['LOAN 400000 30Y', 'LOAN 25000 5Y 7.9%'], keywords: ['mortgage', 'payment', 'interest', 'car loan', 'amortization'],
    options: [['<amount>', 'How much you borrow'], ['<years>', 'Like 30Y'], ['<rate>%', "Your rate; today's mortgage rate if left out"]],
    source: 'Freddie Mac weekly survey', delay: 'Weekly',
  },
  {
    name: 'COMPOUND', category: 'Money tools', summary: 'What saving every month grows to, at a return you pick',
    syntax: 'COMPOUND [<start>] [<monthly>/MO] <return>% <years>Y', examples: ['COMPOUND 500/MO 8% 30Y', 'COMPOUND 10000 7% 20Y'], keywords: ['savings', 'growth', 'interest', 'retirement', 'invest'],
    options: [['<monthly>/MO', 'Saved every month'], ['<return>%', 'A yearly return you assume'], ['<years>Y', 'How long']],
    source: 'Built in', delay: 'None',
  },

  // --- Pro ------------------------------------------------------------------------------
  {
    name: 'PRO', category: 'Pro', summary: 'Your own ticker tape and sync across devices, $4.20 a month',
    syntax: 'PRO', examples: ['PRO'], keywords: ['subscribe', 'upgrade', 'paid', 'account', 'sync'],
    source: 'Built in', delay: 'None',
  },
  {
    name: 'LOGIN', category: 'Pro', summary: 'Use your Pro key on this device',
    syntax: 'LOGIN <key>', examples: ['LOGIN'], keywords: ['sign in', 'key', 'account', 'device'],
    options: [['<key>', 'Your Pro key, BB-XXXX-XXXX-XXXX-XXXX. It never goes in the address bar']],
    source: 'Built in', delay: 'None',
  },
  {
    name: 'LOGOUT', category: 'Pro', summary: 'Log this device out of Pro',
    syntax: 'LOGOUT', examples: ['LOGOUT'], keywords: ['sign out', 'account', 'device'],
    source: 'Built in', delay: 'None',
  },
  // --- ALERTS (price and gauge alerts) ---
  {
    name: 'ALERTS', aliases: ['ALERT'], category: 'Your stuff', summary: 'Price alerts: a note when a symbol or gauge crosses your level',
    syntax: 'ALERTS [<symbol> >|< <level>|CLEAR]', examples: ['ALERTS', 'ALERTS AAPL > 350', 'ALERTS SPX > 7800', 'ALERTS CANAL < 5', 'ALERTS CLEAR'], usageExample: 'ALERTS AAPL > 350',
    keywords: ['alert', 'alerts', 'notify', 'notification', 'price alert', 'target', 'level', 'cross'],
    options: [['<symbol> > <level>', 'When it goes above the level'], ['<symbol> < <level>', 'When it goes below'], ['CLEAR', 'Remove them all (asks first)']],
    source: 'Saved in this browser, up to 20; prices live', delay: 'Checked every 60 seconds while Bloombroke is open in a tab',
  },
  // --- end ALERTS ---

  // --- Legal ----------------------------------------------------------------------------
  {
    name: 'TERMS', category: 'Legal', summary: 'Terms of Use: information only, not investment advice',
    syntax: 'TERMS', examples: ['TERMS'], keywords: ['terms of use', 'rules', 'legal'],
    source: 'Built in', delay: 'None',
  },
  {
    name: 'PRIVACY', category: 'Legal', summary: 'Privacy Policy: what we collect and why',
    syntax: 'PRIVACY', examples: ['PRIVACY'], keywords: ['privacy policy', 'data', 'cookies', 'legal'],
    source: 'Built in', delay: 'None',
  },
  {
    name: 'DISCLAIMER', category: 'Legal', summary: 'Disclaimer: data may be delayed or wrong, investing is risky',
    syntax: 'DISCLAIMER', examples: ['DISCLAIMER'], keywords: ['risk', 'advice', 'legal', 'warning'],
    source: 'Built in', delay: 'None',
  },

  // --- Weird data (WEIRD and one command per gauge; screens in screens/weird*.js) ------
  {
    name: 'WEIRD', category: 'Weird data', summary: 'Odd live gauges on one screen: ships, pizza, waffles, eggs, omens',
    syntax: 'WEIRD [3M|1Y|5Y|10Y|MAX]', examples: ['WEIRD', 'WEIRD 10Y'], keywords: ['odd', 'fun', 'alternative data', 'gauges', 'indicators', 'strange'],
    source: 'Public sources, named on each tile', delay: 'Each tile shows its own date',
  },
  {
    name: 'CANAL', aliases: ['SHIPS', 'CHOKEPOINTS'], category: 'Weird data', summary: 'Ships through Hormuz, Suez, Panama and other chokepoints',
    syntax: 'CANAL [3M|1Y|5Y|10Y|MAX]', examples: ['CANAL', 'CANAL 5Y'], keywords: ['shipping', 'hormuz', 'suez', 'panama', 'tankers', 'strait', 'chokepoint'],
    source: 'IMF PortWatch', delay: 'Daily, about 6 days behind',
  },
  {
    name: 'PIZZA', aliases: ['PIZZINT'], category: 'Weird data', summary: 'Pentagon Pizza Index: pizza place traffic near the Pentagon',
    syntax: 'PIZZA [3M|1Y|5Y|10Y|MAX]', examples: ['PIZZA', 'PIZZA MAX'], keywords: ['pentagon', 'pizza index', 'defcon', 'pizzint'],
    source: 'pizzint.watch (unofficial)', delay: 'Minutes; often empty overnight',
  },
  {
    name: 'DEGEN', category: 'Weird data', summary: 'App Store rank of Kalshi, Polymarket, Robinhood, Coinbase',
    syntax: 'DEGEN [3M|1Y|5Y|10Y|MAX]', examples: ['DEGEN', 'DEGEN MAX'], keywords: ['app store', 'kalshi', 'polymarket', 'robinhood', 'coinbase', 'prediction markets', 'betting', 'trading apps'],
    source: 'Apple App Store top free chart, US', delay: 'About daily',
  },
  {
    name: 'WAFFLE', aliases: ['WAFFLEHOUSE'], category: 'Weird data', summary: 'Waffle House stores inside active tropical storms',
    syntax: 'WAFFLE [3M|1Y|5Y|10Y|MAX]', examples: ['WAFFLE', 'WAFFLE MAX'], keywords: ['waffle house index', 'hurricane', 'storm', 'fema', 'tropical'],
    source: 'National Hurricane Center; stores © OpenStreetMap contributors', delay: 'Latest NHC advisory',
  },
  {
    name: 'PANIC', category: 'Weird data', summary: 'Wikipedia views of Recession, Stock market crash and more',
    syntax: 'PANIC [3M|1Y|5Y|10Y|MAX]', examples: ['PANIC', 'PANIC 5Y'], keywords: ['wikipedia', 'recession', 'crash', 'stagflation', 'bank run', 'fear'],
    source: 'Wikimedia pageviews', delay: 'Daily, up to yesterday',
  },
  {
    name: 'HIRING', category: 'Weird data', summary: 'Hacker News job seekers per job post, by month',
    syntax: 'HIRING [3M|1Y|5Y|10Y|MAX]', examples: ['HIRING', 'HIRING 5Y'], keywords: ['hacker news', 'who is hiring', 'tech jobs', 'hn', 'job market'],
    source: 'HN Algolia search', delay: 'Monthly threads, counts grow during the month',
  },
  {
    name: 'HOTDOG', aliases: ['HOTDOGS'], category: 'Weird data', summary: "Costco's $1.50 hot dog, adjusted for inflation",
    syntax: 'HOTDOG [3M|1Y|5Y|10Y|MAX]', examples: ['HOTDOG', 'HOTDOG 5Y'], keywords: ['costco', 'hot dog', 'inflation', 'cpi'],
    source: 'FRED CPIAUCSL', delay: 'Monthly CPI',
  },
  {
    name: 'OMENS', aliases: ['MOON'], category: 'Weird data', summary: 'Moon phase, New York sky and sunspots',
    syntax: 'OMENS [3M|1Y|5Y|10Y|MAX]', examples: ['OMENS', 'OMENS 5Y'], keywords: ['moon', 'lunar', 'weather', 'sunshine', 'sunspots', 'solar'],
    source: 'Computed moon; NWS KNYC; NOAA SWPC', delay: 'Live moon, hourly sky, monthly sunspots',
  },
  {
    name: 'UNDIES', aliases: ['UNDERWEAR'], category: 'Weird data', summary: "Men's underwear price index, the Greenspan folklore gauge",
    syntax: 'UNDIES [3M|1Y|5Y|10Y|MAX]', examples: ['UNDIES', 'UNDIES 5Y'], keywords: ['underwear', 'greenspan', 'cpi', 'prices', 'clothing'],
    source: 'BLS CPI CUUR0000SEAA02', delay: 'Monthly',
  },
  {
    name: 'BIGMAC', aliases: ['BURGER'], category: 'Weird data', summary: 'Big Mac index: where a Big Mac costs more or less than in the US',
    syntax: 'BIGMAC [3M|1Y|5Y|10Y|MAX]', examples: ['BIGMAC', 'BIGMAC 5Y'], keywords: ['big mac index', 'burger', 'currency', 'valuation', 'economist', 'ppp'],
    source: 'The Economist, CC BY 4.0', delay: 'Twice a year',
  },
  {
    name: 'BILLIONS', aliases: ['BILLIONAIRES'], category: 'Weird data', summary: 'How much the richest people made or lost today',
    syntax: 'BILLIONS [3M|1Y|5Y|10Y|MAX]', examples: ['BILLIONS', 'BILLIONS MAX'], keywords: ['billionaires', 'rich list', 'net worth', 'forbes', 'wealth'],
    source: 'Forbes real-time billionaires (unofficial feed)', delay: 'Minutes',
  },
  {
    name: 'WSB', aliases: ['WALLSTREETBETS'], category: 'Weird data', summary: 'Most-mentioned tickers on WallStreetBets, 24 hours',
    syntax: 'WSB [3M|1Y|5Y|10Y|MAX]', examples: ['WSB', 'WSB MAX'], keywords: ['reddit', 'wallstreetbets', 'mentions', 'meme stocks', 'apewisdom'],
    source: 'ApeWisdom', delay: 'About hourly',
  },
  {
    name: 'CHANCES', category: 'Weird data', summary: 'Prediction-market odds of a US recession and the next Fed move',
    syntax: 'CHANCES [3M|1Y|5Y|10Y|MAX]', examples: ['CHANCES', 'CHANCES MAX'], keywords: ['odds', 'prediction market', 'polymarket', 'recession', 'fed', 'fomc', 'probability'],
    source: 'Polymarket', delay: 'Minutes',
  },
  {
    name: 'BOXRATE', aliases: ['FREIGHTRATE'], category: 'Weird data', summary: 'Cost to ship one 40ft container, Drewry World Container Index',
    syntax: 'BOXRATE [3M|1Y|5Y|10Y|MAX]', examples: ['BOXRATE', 'BOXRATE MAX'], keywords: ['container', 'shipping', 'freight rate', 'drewry', 'wci'],
    source: 'Drewry WCI', delay: 'Weekly, Thursdays',
  },
  {
    name: 'EGGPRICE', aliases: ['EGGPRICES'], category: 'Weird data', summary: 'Average price of a dozen eggs in the US, and how far from the peak',
    syntax: 'EGGPRICE [3M|1Y|5Y|10Y|MAX]', examples: ['EGGPRICE', 'EGGPRICE 5Y'], keywords: ['eggs', 'food prices', 'grocery', 'inflation', 'bird flu'],
    source: 'FRED APU0000708111 (BLS)', delay: 'Monthly',
  },
  {
    name: 'RIDES', aliases: ['QUEUES'], category: 'Weird data', summary: 'Average ride wait at Walt Disney World and Disneyland right now',
    syntax: 'RIDES [3M|1Y|5Y|10Y|MAX]', examples: ['RIDES', 'RIDES MAX'], keywords: ['disney', 'theme park', 'wait times', 'queues', 'consumer'],
    source: 'Powered by Queue-Times.com', delay: 'About 5 minutes',
  },
  {
    name: 'BUZZWORD', aliases: ['BUZZWORDS'], category: 'Weird data', summary: '10-Q filings that say AI, tariff or recession, by quarter',
    syntax: 'BUZZWORD [3M|1Y|5Y|10Y|MAX]', examples: ['BUZZWORD', 'BUZZWORD 5Y'], keywords: ['buzz', 'sec', 'edgar', '10-q', 'artificial intelligence', 'tariffs', 'recession', 'filings'],
    source: 'SEC EDGAR full-text search', delay: 'Daily',
  },
  {
    name: 'BEIGE', aliases: ['BEIGEBOOK'], category: 'Weird data', summary: 'Word counts in the Fed Beige Book: uncertain, tariff, slow, recession, AI',
    syntax: 'BEIGE [3M|1Y|5Y|10Y|MAX]', examples: ['BEIGE', 'BEIGE MAX'], keywords: ['beige book', 'federal reserve', 'fed', 'words', 'uncertainty'],
    source: 'Federal Reserve Beige Book', delay: 'Eight editions a year',
  },
  {
    name: 'TRUCKS', aliases: ['FREIGHT'], category: 'Weird data', summary: 'Freight shipments, truck tonnage and rail carloads vs a year ago',
    syntax: 'TRUCKS [3M|1Y|5Y|10Y|MAX]', examples: ['TRUCKS', 'TRUCKS 5Y'], keywords: ['freight', 'cass', 'trucking', 'rail', 'carloads', 'shipping'],
    source: 'FRED: Cass, ATA, rail carloads', delay: 'Monthly, each with its own lag',
  },
  {
    name: 'BOXES', aliases: ['CARDBOARD'], category: 'Weird data', summary: 'Cardboard box output and box prices vs a year ago',
    syntax: 'BOXES [3M|1Y|5Y|10Y|MAX]', examples: ['BOXES', 'BOXES 5Y'], keywords: ['cardboard', 'corrugated', 'packaging', 'boxes', 'industrial production'],
    source: 'FRED IPN32221S, PCU322211322211', delay: 'Monthly',
  },
  {
    name: 'LIPSTICK', category: 'Weird data', summary: 'Cosmetics price index vs a year ago, the lipstick folklore gauge',
    syntax: 'LIPSTICK [3M|1Y|5Y|10Y|MAX]', examples: ['LIPSTICK', 'LIPSTICK 5Y'], keywords: ['lipstick index', 'cosmetics', 'cpi', 'prices', 'beauty'],
    source: 'FRED CUUR0000SEGB02 (BLS)', delay: 'Monthly',
  },
  {
    name: 'SICK', aliases: ['WASTEWATER'], category: 'Weird data', summary: 'Wastewater virus level, national: COVID, flu A and RSV',
    syntax: 'SICK [3M|1Y|5Y|10Y|MAX]', examples: ['SICK', 'SICK 1Y'], keywords: ['wastewater', 'covid', 'flu', 'rsv', 'cdc', 'virus'],
    source: 'CDC NWSS wastewater data', delay: 'Weekly',
  },
  {
    name: 'MACAU', category: 'Weird data', summary: 'Macau casino gaming revenue by month, vs a year ago',
    syntax: 'MACAU [3M|1Y|5Y|10Y|MAX]', examples: ['MACAU', 'MACAU 5Y'], keywords: ['macau', 'casino', 'gaming revenue', 'china', 'dicj'],
    source: 'DICJ Macau', delay: 'Monthly, early in the next month',
  },
  // --- FISHTANK (screens/fishtank.js) ---
  {
    name: 'FISHTANK', category: 'Weird data', summary: 'The market as fish',
    syntax: 'FISHTANK', examples: ['FISHTANK'], keywords: ['aquarium', 'tank', 'easter egg', 'sea', 'swim', 's&p 100'],
    source: 'CNBC, the S&P 100 batch HEATMAP uses', delay: 'May be delayed; refreshes every minute',
  },
  // --- end FISHTANK ---

  // --- Hidden ---------------------------------------------------------------------------
  { name: '420', hidden: true, category: 'Money tools', summary: 'Funding', syntax: '420', examples: ['420'], keywords: [] },
  { name: 'BUY', hidden: true, category: 'Money tools', summary: 'Renamed to AFFORD', syntax: 'BUY', examples: [], keywords: [] },
];

const norm = (s) => String(s ?? '').trim().toUpperCase();

// Listed commands: what HELP and MENU show.
export const LISTED = REGISTRY.filter((c) => !c.hidden);

// The entry for a typed word (or alias), or null.
export function findCommand(word) {
  const w = norm(word);
  if (!w) return null;
  return REGISTRY.find((c) => c.name === w || c.aliases?.includes(w)) || null;
}

export function byCategory(category) {
  return LISTED.filter((c) => c.category === category);
}

// Categories that have something in them, in order.
export function categoriesInUse() {
  return CATEGORIES.filter((cat) => byCategory(cat).length);
}

// Search every listed command by name, alias, summary words and keywords.
// Best first: exact name, name starts with, keyword, then summary words.
export function searchCommands(query, list = LISTED) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const c of list) {
    const name = c.name.toLowerCase();
    const names = [name, ...(c.aliases || []).map((a) => a.toLowerCase())];
    const keys = (c.keywords || []).map((k) => k.toLowerCase());
    const text = `${c.summary} ${c.syntax} ${c.category}`.toLowerCase();
    let total = 0;
    let ok = true;
    for (const w of words) {
      let s = 0;
      if (names.includes(w)) s = 100;
      else if (names.some((n) => n.startsWith(w))) s = 60;
      else if (keys.some((k) => k === w)) s = 50;
      else if (keys.some((k) => k.startsWith(w) || k.split(/\s+/).some((p) => p.startsWith(w)))) s = 40;
      else if (w.length >= 3 && keys.some((k) => w.startsWith(k) && k.length >= 4)) s = 35; // "dividends" finds "dividend"
      else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(text)) s = 20;
      if (!s) { ok = false; break; }
      total += s;
    }
    if (ok) scored.push([total, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, c]) => c);
}

// The stock function bar, in order.
export const FUNCTION_BAR = REGISTRY.filter((c) => c.bar).sort((a, b) => a.bar - b.bar).map((c) => c.name);

// Functions that work ticker first (AAPL NEWS). tickerSoon ones answer "coming soon".
export const TICKER_FUNCTIONS = REGISTRY.filter((c) => c.takesTicker || c.tickerSoon).map((c) => c.name);

// Aliases -> name, for the router.
export const ALIASES = Object.fromEntries(REGISTRY.flatMap((c) => (c.aliases || []).map((a) => [a, c.name])));

// Plain words that surely mean one command, for the resolver (resolve.js) and HELP
// <word>: "apple revenue" is AAPL FINANCIALS, "yield curve" is CURVE. A phrase may carry
// words to add after the ticker ([phrase, 'BALANCE']). One phrase can name two
// commands (earnings): the one that takes a ticker wins when a ticker was typed.
export const PHRASES = {
  NEWS: ['news', 'headlines', 'latest news'],
  PROFILE: ['profile', 'company profile', 'what does it do', 'business'],
  VALUE: ['valuation', 'pe', 'p/e', 'pe ratio', 'p/e ratio', 'price to earnings', 'value'],
  FINANCIALS: ['financials', 'financial', 'revenue', 'revenues', 'sales', 'income statement', 'income', 'net income', 'profit', 'profits',
    'financial statements', 'statements', 'margins', ['balance sheet', 'BALANCE'], ['balance', 'BALANCE'], ['cash flow', 'CASHFLOW'], ['cashflow', 'CASHFLOW']],
  DIVIDENDS: ['dividend', 'dividends', 'dividend history', 'dividend yield', 'payout'],
  BEATS: ['earnings', 'eps', 'earnings surprise', 'beats', 'earnings history'],
  EARNINGS: ['earnings', 'earnings calendar', 'earnings today', 'earnings this week'],
  INSIDERS: ['insider', 'insiders', 'insider trading', 'insider buying', 'insider selling', 'insider trades'],
  OWNERS: ['owners', 'holders', 'institutional holders', 'institutions', 'who owns', 'shareholders', 'ownership'],
  FILINGS: ['filings', 'sec filings', 'sec', '10-k', '10k', '10-q', 'annual report'],
  SHORTS: ['short interest', 'short', 'shorts', 'short sellers', 'days to cover', 'short squeeze'],
  OPTIONS: ['options', 'option', 'options chain', 'option chain', 'calls', 'puts'],
  CHART: ['chart', 'graph'],
  HISTORY: ['history', 'historical prices', 'price history', 'historical'],
  COMPARE: ['compare', 'vs', 'versus', 'against'],
  CURVE: ['yield curve', 'treasury curve'],
  RATES: ['interest rates', 'mortgage rates', 'rates'],
  FEDPATH: ['fed path', 'rate cuts', 'rate cut', 'fed funds futures'],
  BONDS: ['bond yields', 'government bonds'],
  CRYPTO: ['crypto', 'cryptocurrency', 'cryptocurrencies'],
  COMMODITIES: ['commodities', 'commodity prices'],
  ECONOMY: ['economy', 'gdp', 'unemployment', 'jobs report'],
  CALENDAR: ['economic calendar', 'calendar'],
  IPOS: ['ipo', 'ipos', 'ipo calendar'],
  SPLITS: ['stock splits', 'splits'],
  EXDIV: ['ex-dividend', 'ex dividend', 'ex-dividend dates'],
  MOVERS: ['movers', 'top movers', 'gainers', 'losers', 'top gainers', 'top losers'],
  HEATMAP: ['heatmap', 'heat map'],
  SECTORS: ['sectors', 'sector performance'],
  CLOCK: ['market hours', 'market clock', 'is the market open'],
  WATCH: ['watchlist', 'my watchlist'],
  PORTFOLIO: ['portfolio', 'my portfolio', 'holdings', 'my holdings'],
  LOAN: ['mortgage calculator', 'loan calculator', 'loan payment'],
  COMPOUND: ['compound interest'],
  FX: ['exchange rate', 'exchange rates', 'currency converter'],
};

// "Start here": the commands to know, one short line each, and the keys.
export const START_HERE = [
  ['AAPL', 'A stock: price and chart'],
  ['AAPL NEWS', 'Ticker, then a function'],
  ['MARKETS', 'World markets'],
  ['NEWS', 'Market headlines'],
  ['FX 500 USD THB', 'Convert money'],
  ['RATES', 'US rates and yields'],
  ['CPI 100 2000', 'Inflation since a year'],
  ['HEATMAP', 'S&P 100 in colour'],
  ['MOVERS', 'Top gainers and losers'],
  ['SCREEN', 'Filter US stocks'],
  ['EARNINGS', 'Earnings calendar'],
  ['WATCH', 'Your watchlist'],
  ['PORTFOLIO', 'Your holdings'],
  ['DESK', 'Build your own screen'],
  ['WHATIF', "The maker's stock instead"],
  ['AFFORD 1200', 'Can you afford it'],
  ['MENU', 'Every command (Ctrl K)'],
  ['HELP FX', 'How one command works'],
];

// The one line of keys under the list.
export const START_KEYS = [
  ['Enter', 'run'], ['Tab', 'complete'], ['Esc', 'back'], ['Ctrl K', 'menu'], ['/', 'search'],
  ['1-9', 'stock functions'], ['number Enter', 'panel'], ['F1-F10', 'screens'],
];
