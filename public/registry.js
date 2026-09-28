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
//   options     [[word, meaning]] for HELP <name>      } in registry-detail.js: HELP's
//   source      where the data comes from             } long text, loaded with HELP
//   delay       how fresh it is                       } (mergeDetail below; lib/registry.js in Node)
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
  // --- MCP (screens/mcp.js, server lib/mcp/) ---
  {
    name: 'MCP', category: 'Start here', summary: 'Use Bloombroke from Claude, ChatGPT, Grok or Cursor: the MCP link',
    syntax: 'MCP', examples: ['MCP'], keywords: ['mcp', 'ai', 'claude', 'chatgpt', 'grok', 'cursor', 'connector', 'llm', 'agent'],
  },
  // --- end MCP ---
  {
    name: 'HELP', aliases: ['?', 'H'], category: 'Start here', summary: 'Every command, with a search box and examples',
    syntax: 'HELP [<command>]', examples: ['HELP', 'HELP FX', 'HELP AAPL'], keywords: ['commands', 'how', 'guide', 'manual', 'list'],
  },
  {
    name: 'MENU', category: 'Start here', summary: 'Every command by category, in a quick overlay (Ctrl+K)',
    syntax: 'MENU', examples: ['MENU'], keywords: ['launcher', 'navigate', 'find', 'categories'],
  },

  // --- Markets --------------------------------------------------------------------
  {
    name: 'HOME', category: 'Markets', summary: 'Markets, the S&P 500 and news on one screen',
    syntax: 'HOME', examples: ['HOME'], keywords: ['start', 'overview', 'dashboard', 'front page'],
  },
  {
    name: 'MARKETS', aliases: ['M', 'MARKET'], category: 'Markets', summary: 'World markets at a glance: indexes, futures, commodities, FX, rates',
    syntax: 'MARKETS', examples: ['MARKETS'], keywords: ['indexes', 'indices', 'overview', 'futures', 'stocks', 'world'],
  },
  {
    name: 'WORLD', category: 'Markets', summary: 'World stock indexes by region, open or closed',
    syntax: 'WORLD', examples: ['WORLD'], keywords: ['global', 'international', 'europe', 'asia', 'indexes'],
  },
  {
    name: 'CLOCK', category: 'Markets', summary: 'World market clocks: open, closed, time to the bell',
    syntax: 'CLOCK', examples: ['CLOCK'], keywords: ['hours', 'open', 'close', 'bell', 'time', 'holiday'],
  },
  {
    name: 'MOVERS', category: 'Markets', summary: 'Biggest gainers, losers and most traded in the S&P 100',
    syntax: 'MOVERS', examples: ['MOVERS'], keywords: ['gainers', 'losers', 'top', 'active', 'volume'],
  },
  // --- TRENDING: most opened tickers here (data/trending.js) ---
  {
    name: 'TRENDING', category: 'Markets', summary: 'Most opened tickers here',
    syntax: 'TRENDING', examples: ['TRENDING'], keywords: ['popular', 'most viewed', 'most opened', 'people', 'crowd', 'trending'],
  },
  // --- end TRENDING ---
  // --- BBRK: our own site numbers as a joke quote (screens/bbrk.js, lib/counters.js) ---
  {
    name: 'BBRK', category: 'Markets', summary: 'Our own site numbers, drawn like a quote. Not a security, not for sale',
    syntax: 'BBRK', examples: ['BBRK'], keywords: ['bloombroke', 'site numbers', 'stats', 'usage', 'open startup', 'metrics', 'mrr', 'parody'],
  },
  // --- end BBRK ---
  {
    name: 'HEATMAP', category: 'Markets', summary: 'The S&P 100 by sector, size and colour',
    syntax: 'HEATMAP', examples: ['HEATMAP'], keywords: ['map', 'treemap', 'sectors', 'colour', 'color'],
  },
  // --- WORLDMAP (screens/worldmap.js) ---
  {
    name: 'WORLDMAP', category: 'Markets', summary: 'World map: indexes, ships, storms',
    syntax: 'WORLDMAP', examples: ['WORLDMAP'], keywords: ['world map', 'globe', 'countries', 'geography', 'chokepoints', 'hurricanes', 'storms'],
  },
  // --- end WORLDMAP ---
  {
    name: 'SECTORS', category: 'Markets', summary: 'The 11 sectors and their S&P 100 stocks, as a table or a map',
    syntax: 'SECTORS [1D|1W|1M|YTD|1Y] [MAP]', examples: ['SECTORS', 'SECTORS 1M', 'SECTORS YTD MAP'], keywords: ['industries', 'etf', 'performance', 'rotation', 'members', 'market map', 'drill down', 'contribution'],
  },
  {
    name: 'BREADTH', category: 'Markets', summary: 'How many stocks rose and fell, by exchange and sector',
    syntax: 'BREADTH', examples: ['BREADTH'], keywords: ['advance', 'decline', 'up', 'down', 'participation'],
  },
  {
    name: 'NEWS', category: 'Markets', summary: 'Headlines that move markets, or about one company', takesTicker: true, bar: 2,
    syntax: 'NEWS [MACRO|SEC|WIRES|WSB|<ticker>]', examples: ['NEWS', 'NEWS AAPL', 'TSLA NEWS', 'NEWS MACRO', 'NEWS SEC', 'NEWS WIRES', 'NEWS WSB'],
    keywords: ['headlines', 'stories', 'articles', 'press', 'press releases', 'fed', 'bls', '8-k', 'wires', 'reddit', 'wallstreetbets', 'wsb'],
  },

  // --- Stocks and companies -----------------------------------------------------------
  {
    name: '<TICKER>', pattern: true, category: 'Stocks and companies', summary: 'Any ticker, index, currency pair, commodity or coin: price, chart and key numbers',
    syntax: '<symbol> [<range>]', examples: ['AAPL', 'TSLA 5Y', 'GOLD', 'EURUSD', 'SPX YTD', 'AAPL 2020-01-01 2024-12-31'],
    keywords: ['stock', 'quote', 'price', 'symbol', 'share', 'index', 'coin'],
  },
  {
    name: '<TICKER> <FUNCTION>', pattern: true, category: 'Stocks and companies', summary: 'Any function for one ticker, ticker first',
    syntax: '<ticker> <function> [<words>]', examples: ['AAPL NEWS', 'AAPL CHART 5Y', 'AAPL FINANCIALS', 'AAPL INSIDERS', 'AAPL WATCH', 'AAPL COMPARE MSFT'],
    keywords: ['grammar', 'function', 'ticker first'],
  },
  {
    name: 'PROFILE', category: 'Stocks and companies', summary: 'What a company does, where it is, its website', takesTicker: true, bar: 4,
    syntax: 'PROFILE <ticker>', examples: ['PROFILE AAPL', 'PROFILE KO'], keywords: ['about', 'description', 'business', 'company', 'website', 'sector'],
  },
  {
    name: 'VALUE', category: 'Stocks and companies', summary: 'P/E, dividend yield, margins, debt and the 52 week range', takesTicker: true, bar: 13,
    syntax: 'VALUE <ticker>', examples: ['VALUE AAPL', 'VALUE JPM'], keywords: ['valuation', 'pe', 'p/e', 'ratio', 'margin', 'debt', 'fundamentals', 'cheap'],
  },
  {
    name: 'FINANCIALS', category: 'Stocks and companies', summary: 'Income, balance sheet and cash flow from SEC filings', takesTicker: true, bar: 3,
    syntax: 'FINANCIALS <ticker> [BALANCE|CASHFLOW] [QUARTERLY]', examples: ['FINANCIALS AAPL', 'FINANCIALS MSFT BALANCE'],
    keywords: ['income', 'revenue', 'profit', 'balance sheet', 'cash flow', 'statements', 'sales', 'earnings'],
  },
  {
    name: 'DIVIDENDS', category: 'Stocks and companies', summary: 'Dividend yield and every payment', takesTicker: true, bar: 6,
    syntax: 'DIVIDENDS <ticker>', examples: ['DIVIDENDS PEP', 'DIVIDENDS AAPL'], keywords: ['dividend', 'yield', 'payout', 'income', 'payments'],
  },
  {
    name: 'BEATS', category: 'Stocks and companies', summary: 'Reported EPS against the consensus estimate', takesTicker: true, bar: 12,
    syntax: 'BEATS <ticker>', examples: ['BEATS AAPL', 'BEATS KO'], keywords: ['earnings', 'eps', 'surprise', 'estimate', 'consensus', 'miss'],
  },
  {
    name: 'INSIDERS', category: 'Stocks and companies', summary: 'What officers and directors bought and sold', takesTicker: true, bar: 8,
    syntax: 'INSIDERS <ticker>', examples: ['INSIDERS AAPL', 'INSIDERS NVDA'], keywords: ['insider', 'form 4', 'executives', 'directors', 'buying', 'selling'],
  },
  {
    name: 'OWNERS', category: 'Stocks and companies', summary: 'The biggest funds holding a stock, from 13F filings', takesTicker: true, bar: 9,
    syntax: 'OWNERS <ticker>', examples: ['OWNERS AAPL', 'OWNERS KO'], keywords: ['holders', 'institutions', 'funds', '13f', 'ownership', 'shareholders'],
  },
  {
    name: 'FILINGS', category: 'Stocks and companies', summary: 'Latest SEC filings, with links to sec.gov', takesTicker: true, bar: 10,
    syntax: 'FILINGS <ticker> [10-K|10-Q|8-K|4|ALL]', examples: ['FILINGS AAPL', 'FILINGS TSLA 8-K'], keywords: ['sec', 'edgar', '10-k', 'annual report', 'documents'],
  },
  {
    name: 'SHORTS', category: 'Stocks and companies', summary: 'Short interest and days to cover, twice a month', takesTicker: true, bar: 11,
    syntax: 'SHORTS <ticker>', examples: ['SHORTS AAPL', 'SHORTS TSLA'], keywords: ['short interest', 'short sellers', 'squeeze', 'days to cover'],
  },
  // WHY
  {
    name: 'WHY', category: 'Stocks and companies', summary: 'The 10 biggest daily moves of the last year, and what came out each day', takesTicker: true, bar: 14,
    syntax: 'WHY <ticker>', examples: ['WHY AAPL', 'AAPL WHY', 'WHY TSLA'], keywords: ['moves', 'biggest moves', 'jump', 'drop', 'crash', 'spike', 'what happened', 'filings'],
  },
  {
    name: 'OPTIONS', category: 'Stocks and companies', summary: 'Option chain: calls and puts by strike', takesTicker: true, bar: 7,
    syntax: 'OPTIONS <ticker> [<expiry>]', examples: ['OPTIONS AAPL', 'AAPL OPTIONS', 'OPTIONS SPY'], keywords: ['calls', 'puts', 'chain', 'strike', 'derivatives', 'implied volatility'],
  },

  // --- Charts ---------------------------------------------------------------------------
  {
    name: 'CHART', category: 'Charts', summary: 'A price chart for any symbol and range', takesTicker: true, bar: 1,
    syntax: 'CHART <symbol> [<range>]', examples: ['CHART AAPL 5Y', 'AAPL CHART YTD'], keywords: ['graph', 'price', 'history', 'plot'],
  },
  {
    name: 'COMPARE', category: 'Charts', summary: 'Race 2 to 5 tickers over a range', takesTicker: true,
    syntax: 'COMPARE <tickers> [<range>]', examples: ['COMPARE AAPL MSFT NVDA', 'COMPARE KO PEP 5Y'], keywords: ['versus', 'vs', 'race', 'performance', 'relative'],
  },
  {
    name: 'GRID', category: 'Charts', summary: 'A board of up to 16 mini charts',
    syntax: 'GRID [<tickers>] [<range>]', examples: ['GRID', 'GRID NVDA AMD INTC 1Y', 'GRID BTC ETH GOLD W:PIZZA RIP:LEH'],
    keywords: ['board', 'dashboard', 'multi chart', 'many charts', 'tiles', 'small multiples', 'sparklines', 'overview', 'my board', 'share'],
  },
  {
    name: 'HISTORY', category: 'Charts', summary: 'Daily prices for any dates, with a CSV download', takesTicker: true, bar: 5,
    syntax: 'HISTORY <ticker> [<from> [<to>]]', examples: ['HISTORY AAPL', 'HISTORY TSLA 2024'], keywords: ['historical', 'prices', 'csv', 'download', 'close', 'data'],
  },
  // --- GUESS (screens/guess.js, data/guess.js) ---
  {
    name: 'GUESS', category: 'Charts', summary: 'One mystery stock a day: guess it from its 1-year chart',
    syntax: 'GUESS', examples: ['GUESS'], keywords: ['game', 'puzzle', 'daily', 'mystery', 'play', 'guessing game', 's&p 100'],
  },
  // --- end GUESS ---

  // --- Rates and bonds ----------------------------------------------------------------
  {
    name: 'RATES', aliases: ['RATE'], category: 'Rates and bonds', summary: 'The interest rates that touch your money',
    syntax: 'RATES', examples: ['RATES'], keywords: ['interest', 'mortgage', 'fed funds', 'treasury', 'yield'],
  },
  {
    name: 'CURVE', category: 'Rates and bonds', summary: 'US Treasury yield curve: today, 1 month and 1 year ago',
    syntax: 'CURVE', examples: ['CURVE'], keywords: ['yield curve', 'treasury', 'inversion', 'yield', 'bonds'],
  },
  {
    name: 'BONDS', category: 'Rates and bonds', summary: 'Government bond yields by country: 2Y to 30Y, spreads, curves',
    syntax: 'BONDS [SPREADS|CURVE]', examples: ['BONDS', 'BONDS SPREADS', 'BONDS CURVE'], keywords: ['yield', 'government', 'gilts', 'bunds', 'jgb', 'spreads'],
  },
  {
    name: 'FEDPATH', category: 'Rates and bonds', summary: 'The Fed funds rate implied by futures, month by month',
    syntax: 'FEDPATH', examples: ['FEDPATH'], keywords: ['fed', 'rate cut', 'rate hike', 'fomc', 'futures', 'central bank'],
  },

  // --- FX -------------------------------------------------------------------------------
  {
    name: 'FX', category: 'FX', summary: 'Convert money between currencies',
    syntax: 'FX [<amount>] <from> <to>', examples: ['FX 500 USD THB', 'FX USD CAD'], keywords: ['currency', 'convert', 'exchange rate', 'forex', 'money'],
  },
  {
    name: 'FXMATRIX', category: 'FX', summary: "Cross rates for nine currencies, or HEAT for today's moves",
    syntax: 'FXMATRIX [HEAT]', examples: ['FXMATRIX', 'FXMATRIX HEAT'], keywords: ['cross rates', 'currency', 'forex', 'heat'],
  },

  // --- Crypto and commodities -----------------------------------------------------------
  {
    name: 'CRYPTO', category: 'Crypto and commodities', summary: 'The top 20 coins, 24 hours and 7 days',
    syntax: 'CRYPTO', examples: ['CRYPTO'], keywords: ['bitcoin', 'ethereum', 'coins', 'btc', 'eth'],
  },
  {
    name: 'COMMODITIES', category: 'Crypto and commodities', summary: 'Oil, gold, wheat and more',
    syntax: 'COMMODITIES', examples: ['COMMODITIES'], keywords: ['oil', 'gold', 'silver', 'wheat', 'futures', 'metals', 'energy'],
  },

  // --- Economy and calendars ------------------------------------------------------------
  {
    name: 'ECONOMY', category: 'Economy and calendars', summary: 'US economy: jobs, inflation, growth, spending, with charts',
    syntax: 'ECONOMY [<indicator>] [<range>]', examples: ['ECONOMY', 'ECONOMY UNRATE', 'ECONOMY CPI MAX'], keywords: ['gdp', 'jobs', 'unemployment', 'inflation', 'macro', 'fred'],
  },
  {
    name: 'CALENDAR', category: 'Economy and calendars', summary: "This week's economic events: jobs, inflation, central banks",
    syntax: 'CALENDAR [US|ALL]', examples: ['CALENDAR', 'CALENDAR ALL'], keywords: ['events', 'releases', 'schedule', 'fomc', 'payrolls'],
  },
  {
    name: 'EARNINGS', category: 'Economy and calendars', summary: 'Who reports earnings today, or this week', tickerSoon: true,
    syntax: 'EARNINGS [<day>|WEEK]', examples: ['EARNINGS', 'EARNINGS WEEK', 'EARNINGS TOMORROW'], keywords: ['reports', 'eps', 'results', 'quarterly'],
  },
  {
    name: 'IPOS', category: 'Economy and calendars', summary: 'IPOs: upcoming, priced and filed',
    syntax: 'IPOS', examples: ['IPOS'], keywords: ['ipo', 'listing', 'new issues', 'offering'],
  },
  {
    name: 'SPLITS', category: 'Economy and calendars', summary: 'Upcoming stock splits and reverse splits',
    syntax: 'SPLITS', examples: ['SPLITS'], keywords: ['split', 'reverse split'],
  },
  {
    name: 'EXDIV', category: 'Economy and calendars', summary: 'Ex-dividend dates for the next five weekdays',
    syntax: 'EXDIV [<day>]', examples: ['EXDIV', 'EXDIV 2026-10-01'], keywords: ['ex-dividend', 'dividend', 'record date'],
  },

  // --- Screens and lists ----------------------------------------------------------------
  {
    name: 'SCREEN', aliases: ['SCREENER'], category: 'Screens and lists', summary: 'Find stocks by sector, size, price and move',
    syntax: 'SCREEN [<filters>]', examples: ['SCREEN', 'SCREEN GAINERS', 'SCREEN SECTOR TECH MCAP>10B'], keywords: ['screener', 'filter', 'find', 'search', 'stocks'],
  },

  // --- Your stuff -----------------------------------------------------------------------
  {
    name: 'WATCH', aliases: ['WATCHLIST'], category: 'Your stuff', summary: 'Your watchlist, live: any stock, index, pair, coin or future', takesTicker: true,
    syntax: 'WATCH [ADD|REMOVE <symbols>] [CLEAR|EXPORT|IMPORT]', examples: ['WATCH', 'WATCH ADD AAPL TSLA EURUSD', 'WATCH REMOVE TSLA', 'WATCH EXPORT'], usageExample: 'WATCH ADD AAPL TSLA',
    keywords: ['watchlist', 'favourites', 'favorites', 'list', 'track'],
  },
  {
    name: 'PORTFOLIO', aliases: ['PF'], category: 'Your stuff', summary: 'Your holdings: value, day gain, total gain, weights',
    syntax: 'PF [ADD <ticker> <shares> @ <cost>|SELL <ticker> <shares>|REMOVE <ticker>]', examples: ['PF', 'PF ADD AAPL 10 @ 150', 'PF SELL AAPL 3', 'PF EXPORT'], usageExample: 'PF ADD AAPL 10 @ 150',
    keywords: ['holdings', 'positions', 'gains', 'profit', 'loss'],
  },
  {
    name: 'DESK', category: 'Your stuff', summary: 'Build your own screen: any commands side by side, four desks',
    // DESK cards: presets, and +<command> typed on DESK.
    syntax: 'DESK [1-4] [RESET|WEIRD|MACRO|CRYPTO]', examples: ['DESK', 'DESK 2', 'DESK RESET', 'DESK WEIRD', 'DESK MACRO', 'DESK CRYPTO'], keywords: ['layout', 'workspace', 'panels', 'dashboard', 'custom', 'preset', 'cards'],
  },
  {
    name: 'TAPE', category: 'Your stuff', summary: 'The scrolling ticker tape: on or off, a DESK panel, or your own list (Pro)',
    syntax: 'TAPE [ON|OFF|ADD <tickers>|REMOVE <tickers>|RESET]', examples: ['TAPE', 'TAPE ON', 'TAPE OFF', 'TAPE ADD AAPL'], keywords: ['ticker tape', 'scroll', 'crawl', 'marquee'],
  },

  // --- Money tools ----------------------------------------------------------------------
  {
    name: 'CPI', aliases: ['INFLATION'], category: 'Money tools', summary: 'What money from a past year is worth today',
    syntax: 'CPI [<amount>] [<year>]', examples: ['CPI 100 2015', 'CPI 1000 1990'], keywords: ['inflation', 'purchasing power', 'prices', 'then and now'],
  },
  {
    name: 'WHATIF', category: 'Money tools', summary: "In hindsight: the maker's stock instead of what you bought",
    syntax: 'WHATIF [<item> ...] [MY <amount> <ticker> <date>]', examples: ['WHATIF', 'WHATIF IPHONE6 LATTE:3Y', 'WHATIF MY 1200 AAPL 2015', 'WHATIF MY 5 A DAY SBUX SINCE 2018'], keywords: ['regret', 'instead', 'what if', 'opportunity cost', 'my own purchase'],
  },
  {
    name: 'AFFORD', category: 'Money tools', summary: 'Can I afford it? Cost per use of a thing you buy, and a verdict',
    syntax: 'AFFORD <price> [<thing>] [<n> PER WEEK] [FOR <n>Y]', examples: ['AFFORD 1200', 'AFFORD 1200 BIKE 2 PER WEEK', 'AFFORD 90 3 TIMES A MONTH FOR 2Y'], keywords: ['buy', 'cost per use', 'purchase', 'worth it', 'spend'],
  },
  {
    name: 'WAGE', category: 'Money tools', summary: 'Save your hourly pay, then AFFORD shows hours of work',
    syntax: 'WAGE <per hour>', examples: ['WAGE 35'], keywords: ['salary', 'pay', 'hourly', 'income'],
  },
  {
    name: 'LOAN', category: 'Money tools', summary: "Monthly payment and total interest, at today's mortgage rate or yours",
    syntax: 'LOAN <amount> [<years>] [<rate>%]', examples: ['LOAN 400000 30Y', 'LOAN 25000 5Y 7.9%'], keywords: ['mortgage', 'payment', 'interest', 'car loan', 'amortization'],
  },
  {
    name: 'COMPOUND', category: 'Money tools', summary: 'What saving every month grows to, at a return you pick',
    syntax: 'COMPOUND [<start>] [<monthly>/MO] <return>% <years>Y', examples: ['COMPOUND 500/MO 8% 30Y', 'COMPOUND 10000 7% 20Y'], keywords: ['savings', 'growth', 'interest', 'retirement', 'invest'],
  },

  // --- Pro ------------------------------------------------------------------------------
  {
    name: 'PRO', category: 'Pro', summary: 'What is free and what is Pro: sync, DESK, tape, seat. $42 a month or $420 a year',
    syntax: 'PRO [YEARLY|MONTHLY]', examples: ['PRO', 'PRO MONTHLY'], keywords: ['subscribe', 'upgrade', 'paid', 'account', 'sync', 'yearly', 'annual', 'seat'],
  },
  // --- Pro structure: GIFT, REDEEM, CHAT, SPONSOR ---
  {
    name: 'GIFT', category: 'Pro', summary: 'Give a friend a free month of Pro: up to 3 gift codes',
    syntax: 'GIFT', examples: ['GIFT'], keywords: ['gift', 'friend', 'invite', 'code', 'free month'],
  },
  {
    name: 'REDEEM', category: 'Pro', summary: 'Use a gift code: 30 days of Pro, no card',
    syntax: 'REDEEM <code>', examples: ['REDEEM'], keywords: ['gift code', 'redeem', 'free month', 'code'],
  },
  {
    name: 'CHAT', category: 'Pro', summary: 'Private 1-to-1 chat between Pro seats. Coming when Pro launches',
    syntax: 'CHAT', examples: ['CHAT'], keywords: ['chat', 'message', 'talk', 'private'],
  },
  // --- end Pro structure ---
  {
    name: 'LOGIN', category: 'Pro', summary: 'Use your Pro key on this device',
    syntax: 'LOGIN <key>', examples: ['LOGIN'], keywords: ['sign in', 'key', 'account', 'device'],
  },
  {
    name: 'LOGOUT', category: 'Pro', summary: 'Log this device out of Pro',
    syntax: 'LOGOUT', examples: ['LOGOUT'], keywords: ['sign out', 'account', 'device'],
  },
  // --- ALERTS (price and gauge alerts) ---
  {
    name: 'ALERTS', aliases: ['ALERT'], category: 'Your stuff', summary: 'Price alerts: a note when a symbol or gauge crosses your level',
    syntax: 'ALERTS [<symbol> >|< <level>|CLEAR]', examples: ['ALERTS', 'ALERTS AAPL > 350', 'ALERTS SPX > 7800', 'ALERTS CANAL < 5', 'ALERTS CLEAR'], usageExample: 'ALERTS AAPL > 350',
    keywords: ['alert', 'alerts', 'notify', 'notification', 'price alert', 'target', 'level', 'cross'],
  },
  // --- end ALERTS ---

  // --- Legal ----------------------------------------------------------------------------
  {
    name: 'TERMS', category: 'Legal', summary: 'Terms of Use: information only, not investment advice',
    syntax: 'TERMS', examples: ['TERMS'], keywords: ['terms of use', 'rules', 'legal'],
  },
  {
    name: 'PRIVACY', category: 'Legal', summary: 'Privacy Policy: what we collect and why',
    syntax: 'PRIVACY', examples: ['PRIVACY'], keywords: ['privacy policy', 'data', 'cookies', 'legal'],
  },
  {
    name: 'DISCLAIMER', category: 'Legal', summary: 'Disclaimer: data may be delayed or wrong, investing is risky',
    syntax: 'DISCLAIMER', examples: ['DISCLAIMER'], keywords: ['risk', 'advice', 'legal', 'warning'],
  },
  {
    name: 'FEEDBACK', aliases: ['IDEA'], category: 'Legal', summary: 'Tell us what to fix or build: a short note, email optional',
    syntax: 'FEEDBACK', examples: ['FEEDBACK'], keywords: ['feedback', 'idea', 'suggestion', 'bug', 'contact', 'report'],
  },
  // --- Provenance (screens/data.js, status.js, changes.js) ---
  {
    name: 'DATA', aliases: ['SOURCES'], category: 'Legal', summary: 'Where the data comes from, in eight groups: how often it updates, how fresh it is',
    syntax: 'DATA [<dataset>]', examples: ['DATA', 'DATA CPI'], keywords: ['sources', 'data sources', 'licence', 'license', 'delay', 'provenance', 'where from', 'attribution'],
  },
  {
    name: 'STATUS', category: 'Legal', summary: 'Pro: is each data feed up right now',
    syntax: 'STATUS', examples: ['STATUS'], keywords: ['status', 'uptime', 'down', 'outage', 'health', 'broken'],
  },
  {
    name: 'CHANGES', aliases: ['CHANGELOG'], category: 'Legal', summary: 'What changed on Bloombroke, by day',
    syntax: 'CHANGES', examples: ['CHANGES'], keywords: ['changelog', 'release notes', 'new features', 'updates', 'what is new'],
  },
  // --- end Provenance ---
  {
    name: 'SPONSOR', category: 'Legal', summary: 'Sponsors: lines that rotate in the status bar, no tracking, and who we do not take',
    syntax: 'SPONSOR', examples: ['SPONSOR'], keywords: ['sponsor', 'sponsored', 'advertise', 'ads'],
  },

  // --- Weird data (WEIRD and one command per gauge; screens in screens/weird*.js) ------
  // --- GRAVEYARD (screens/nosuch.js, data/graveyard.json) ---
  {
    name: 'GRAVEYARD', category: 'Weird data', summary: 'Famous tickers that are gone: bankrupt, seized, bought out or taken private',
    syntax: 'GRAVEYARD [<ticker>|TABLE|MOURNED|ZOMBIES|TODAY]', examples: ['GRAVEYARD', 'GRAVEYARD LEH', 'GRAVEYARD ZOMBIES', 'GRAVEYARD MOURNED'],
    keywords: ['dead', 'delisted', 'bankrupt', 'bankruptcy', 'defunct', 'gone', 'failed', 'collapse', 'rip'],
  },
  // --- end GRAVEYARD ---
  {
    name: 'WEIRD', category: 'Weird data', summary: 'Odd live gauges on one screen: ships, pizza, waffles, eggs, omens',
    syntax: 'WEIRD [3M|1Y|5Y|10Y|MAX]', examples: ['WEIRD', 'WEIRD 10Y'], keywords: ['odd', 'fun', 'alternative data', 'gauges', 'indicators', 'strange'],
  },
  {
    name: 'CANAL', aliases: ['SHIPS', 'CHOKEPOINTS'], category: 'Weird data', summary: 'Ships through Hormuz, Suez, Panama and other chokepoints',
    syntax: 'CANAL [3M|1Y|5Y|10Y|MAX]', examples: ['CANAL', 'CANAL 5Y'], keywords: ['shipping', 'hormuz', 'suez', 'panama', 'tankers', 'strait', 'chokepoint'],
  },
  {
    name: 'PIZZA', aliases: ['PIZZINT'], category: 'Weird data', summary: 'Pentagon Pizza Index: pizza place traffic near the Pentagon',
    syntax: 'PIZZA [3M|1Y|5Y|10Y|MAX]', examples: ['PIZZA', 'PIZZA MAX'], keywords: ['pentagon', 'pizza index', 'defcon', 'pizzint'],
  },
  {
    name: 'DEGEN', category: 'Weird data', summary: 'App Store rank of Kalshi, Polymarket, Robinhood, Coinbase',
    syntax: 'DEGEN [3M|1Y|5Y|10Y|MAX]', examples: ['DEGEN', 'DEGEN MAX'], keywords: ['app store', 'kalshi', 'polymarket', 'robinhood', 'coinbase', 'prediction markets', 'betting', 'trading apps'],
  },
  {
    name: 'WAFFLE', aliases: ['WAFFLEHOUSE'], category: 'Weird data', summary: 'Waffle House stores inside active tropical storms',
    syntax: 'WAFFLE [3M|1Y|5Y|10Y|MAX]', examples: ['WAFFLE', 'WAFFLE MAX'], keywords: ['waffle house index', 'hurricane', 'storm', 'fema', 'tropical'],
  },
  {
    name: 'PANIC', category: 'Weird data', summary: 'Wikipedia views of Recession, Stock market crash and more',
    syntax: 'PANIC [3M|1Y|5Y|10Y|MAX]', examples: ['PANIC', 'PANIC 5Y'], keywords: ['wikipedia', 'recession', 'crash', 'stagflation', 'bank run', 'fear'],
  },
  {
    name: 'HIRING', category: 'Weird data', summary: 'Hacker News job seekers per job post, by month',
    syntax: 'HIRING [3M|1Y|5Y|10Y|MAX]', examples: ['HIRING', 'HIRING 5Y'], keywords: ['hacker news', 'who is hiring', 'tech jobs', 'hn', 'job market'],
  },
  {
    name: 'HOTDOG', aliases: ['HOTDOGS'], category: 'Weird data', summary: "Costco's $1.50 hot dog, adjusted for inflation",
    syntax: 'HOTDOG [3M|1Y|5Y|10Y|MAX]', examples: ['HOTDOG', 'HOTDOG 5Y'], keywords: ['costco', 'hot dog', 'inflation', 'cpi'],
  },
  {
    name: 'OMENS', aliases: ['MOON'], category: 'Weird data', summary: 'Moon phase, New York sky and sunspots',
    syntax: 'OMENS [3M|1Y|5Y|10Y|MAX]', examples: ['OMENS', 'OMENS 5Y'], keywords: ['moon', 'lunar', 'weather', 'sunshine', 'sunspots', 'solar'],
  },
  {
    name: 'UNDIES', aliases: ['UNDERWEAR'], category: 'Weird data', summary: "Men's underwear price index, the Greenspan folklore gauge",
    syntax: 'UNDIES [3M|1Y|5Y|10Y|MAX]', examples: ['UNDIES', 'UNDIES 5Y'], keywords: ['underwear', 'greenspan', 'cpi', 'prices', 'clothing'],
  },
  {
    name: 'BIGMAC', aliases: ['BURGER'], category: 'Weird data', summary: 'Big Mac index: where a Big Mac costs more or less than in the US',
    syntax: 'BIGMAC [3M|1Y|5Y|10Y|MAX]', examples: ['BIGMAC', 'BIGMAC 5Y'], keywords: ['big mac index', 'burger', 'currency', 'valuation', 'economist', 'ppp'],
  },
  {
    name: 'BILLIONS', aliases: ['BILLIONAIRES'], category: 'Weird data', summary: 'How much the richest people made or lost today',
    syntax: 'BILLIONS [3M|1Y|5Y|10Y|MAX]', examples: ['BILLIONS', 'BILLIONS MAX'], keywords: ['billionaires', 'rich list', 'net worth', 'forbes', 'wealth'],
  },
  {
    name: 'WSB', aliases: ['WALLSTREETBETS'], category: 'Weird data', summary: 'Most-mentioned tickers on WallStreetBets, 24 hours',
    syntax: 'WSB [3M|1Y|5Y|10Y|MAX]', examples: ['WSB', 'WSB MAX'], keywords: ['reddit', 'wallstreetbets', 'mentions', 'meme stocks', 'apewisdom'],
  },
  {
    name: 'CHANCES', category: 'Weird data', summary: 'Prediction-market odds of a US recession and the next Fed move',
    syntax: 'CHANCES [3M|1Y|5Y|10Y|MAX]', examples: ['CHANCES', 'CHANCES MAX'], keywords: ['odds', 'prediction market', 'polymarket', 'recession', 'fed', 'fomc', 'probability'],
  },
  {
    name: 'BOXRATE', aliases: ['FREIGHTRATE'], category: 'Weird data', summary: 'Cost to ship one 40ft container, Drewry World Container Index',
    syntax: 'BOXRATE [3M|1Y|5Y|10Y|MAX]', examples: ['BOXRATE', 'BOXRATE MAX'], keywords: ['container', 'shipping', 'freight rate', 'drewry', 'wci'],
  },
  {
    name: 'EGGPRICE', aliases: ['EGGPRICES'], category: 'Weird data', summary: 'Average price of a dozen eggs in the US, and how far from the peak',
    syntax: 'EGGPRICE [3M|1Y|5Y|10Y|MAX]', examples: ['EGGPRICE', 'EGGPRICE 5Y'], keywords: ['eggs', 'food prices', 'grocery', 'inflation', 'bird flu'],
  },
  {
    name: 'RIDES', aliases: ['QUEUES'], category: 'Weird data', summary: 'Average ride wait at Walt Disney World and Disneyland right now',
    syntax: 'RIDES [3M|1Y|5Y|10Y|MAX]', examples: ['RIDES', 'RIDES MAX'], keywords: ['disney', 'theme park', 'wait times', 'queues', 'consumer'],
  },
  {
    name: 'BUZZWORD', aliases: ['BUZZWORDS'], category: 'Weird data', summary: '10-Q filings that say AI, tariff or recession, by quarter',
    syntax: 'BUZZWORD [3M|1Y|5Y|10Y|MAX]', examples: ['BUZZWORD', 'BUZZWORD 5Y'], keywords: ['buzz', 'sec', 'edgar', '10-q', 'artificial intelligence', 'tariffs', 'recession', 'filings'],
  },
  {
    name: 'BEIGE', aliases: ['BEIGEBOOK'], category: 'Weird data', summary: 'Word counts in the Fed Beige Book: uncertain, tariff, slow, recession, AI',
    syntax: 'BEIGE [3M|1Y|5Y|10Y|MAX]', examples: ['BEIGE', 'BEIGE MAX'], keywords: ['beige book', 'federal reserve', 'fed', 'words', 'uncertainty'],
  },
  {
    name: 'TRUCKS', aliases: ['FREIGHT'], category: 'Weird data', summary: 'Freight shipments, truck tonnage and rail carloads vs a year ago',
    syntax: 'TRUCKS [3M|1Y|5Y|10Y|MAX]', examples: ['TRUCKS', 'TRUCKS 5Y'], keywords: ['freight', 'cass', 'trucking', 'rail', 'carloads', 'shipping'],
  },
  {
    name: 'BOXES', aliases: ['CARDBOARD'], category: 'Weird data', summary: 'Cardboard box output and box prices vs a year ago',
    syntax: 'BOXES [3M|1Y|5Y|10Y|MAX]', examples: ['BOXES', 'BOXES 5Y'], keywords: ['cardboard', 'corrugated', 'packaging', 'boxes', 'industrial production'],
  },
  {
    name: 'LIPSTICK', category: 'Weird data', summary: 'Cosmetics price index vs a year ago, the lipstick folklore gauge',
    syntax: 'LIPSTICK [3M|1Y|5Y|10Y|MAX]', examples: ['LIPSTICK', 'LIPSTICK 5Y'], keywords: ['lipstick index', 'cosmetics', 'cpi', 'prices', 'beauty'],
  },
  {
    name: 'SICK', aliases: ['WASTEWATER'], category: 'Weird data', summary: 'Wastewater virus level, national: COVID, flu A and RSV',
    syntax: 'SICK [3M|1Y|5Y|10Y|MAX]', examples: ['SICK', 'SICK 1Y'], keywords: ['wastewater', 'covid', 'flu', 'rsv', 'cdc', 'virus'],
  },
  {
    name: 'MACAU', category: 'Weird data', summary: 'Macau casino gaming revenue by month, vs a year ago',
    syntax: 'MACAU [3M|1Y|5Y|10Y|MAX]', examples: ['MACAU', 'MACAU 5Y'], keywords: ['macau', 'casino', 'gaming revenue', 'china', 'dicj'],
  },
  // --- FISHTANK (screens/fishtank.js) ---
  {
    name: 'FISHTANK', category: 'Weird data', summary: 'The market as fish',
    syntax: 'FISHTANK [sector]', examples: ['FISHTANK', 'FISHTANK TECH'], keywords: ['aquarium', 'tank', 'easter egg', 'sea', 'swim', 's&p 100'],
  },
  // --- end FISHTANK ---

  // --- Hidden ---------------------------------------------------------------------------
  { name: '420', hidden: true, category: 'Money tools', summary: 'Funding', syntax: '420', examples: ['420'], keywords: [] },
  { name: 'BUY', hidden: true, category: 'Money tools', summary: 'Renamed to AFFORD', syntax: 'BUY', examples: [], keywords: [] },
];

// HELP's long text (options, source, delay: registry-detail.js) joins each entry here.
// The page loads it only with HELP (screens/help.js imports it and calls this); in Node
// (the server, tests) lib/registry.js merges it in, so every entry is whole there.
export function mergeDetail(detail) {
  for (const c of REGISTRY) if (detail[c.name]) Object.assign(c, detail[c.name]);
  return REGISTRY;
}

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
  WHY: ['biggest moves', 'biggest daily moves', 'big moves'],
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
