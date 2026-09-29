// WHATIS: market words in plain English. The definitions and how a typed word finds
// one. Loaded only with screens/whatis.js (lazy), never at startup: the registry has
// only the command's name and one line.
//
// Each entry: { term, aliases, text, example?, see }
//   term     its plain name, the card's hero
//   aliases  other ways to type it (WHATIS PE, WHATIS P/E, WHATIS price to earnings)
//   text     what it MEANS, in plain words: 1 to 3 short sentences, 45 words at most.
//            [word] links to another term; [words|target] links the words to target.
//   example  one line with made-up round numbers, never a real company's numbers
//   see      related terms (their names or aliases)
//
// Content rules (test/whatis.test.js checks): definitions only. No opinions, advice,
// good or bad, predictions, ratings or signals.

import { editDistance } from './resolve.js';

export const TERMS = [
  {
    term: '10-K and 10-Q',
    aliases: ['10-K', '10K', '10-Q', '10Q', 'annual report', 'quarterly report', 'form 10-K', 'form 10-Q'],
    text: 'A 10-K is a US public company\'s yearly report to the SEC, the US market regulator, with full accounts checked by outside auditors. A 10-Q is the shorter report for each of the other three quarters.',
    see: ['8-K filing', 'Earnings'],
  },
  {
    term: '13F filing',
    aliases: ['13F', '13-F', 'form 13F', 'owners', 'institutional owners', 'institutions', 'holders'],
    text: 'A 13F is a report that US investment managers with $100 million or more in US [stocks|stock] must file every three months. It lists what they held at the end of the quarter and is due 45 days later.',
    see: ['Insider', 'Stock'],
  },
  {
    term: '2s10s spread',
    aliases: ['2s10s', '2s 10s', 'US2S10S', '2-10 spread', '2s10s curve', '10s2s'],
    text: 'The 2s10s spread is the 10-year [Treasury] [yield] minus the 2-year Treasury yield, often shown in [basis points|basis point]. A number below zero means the [yield curve] is inverted between those two points.',
    example: 'A 10-year yield of 4.30% and a 2-year yield of 4.00% make a spread of +30 bp.',
    see: ['Yield curve', 'Basis point', 'Treasury'],
  },
  {
    term: '52-week range',
    aliases: ['52W range', '52 week range', '52W', '52-week high', '52-week low', '52 week high', '52 week low', 'year range'],
    text: 'The 52-week range is the lowest and the highest price over the last year (52 weeks). Some screens use each day\'s [closing price]; others use every trade during the day.',
    example: 'A range of $40 to $60 means the price has been as low as $40 and as high as $60 this past year.',
    see: ['Closing price', 'Volatility'],
  },
  {
    term: '8-K filing',
    aliases: ['8-K', '8K', 'form 8-K', 'current report'],
    text: 'An 8-K is a report a US public company files to announce a major event, such as a new chief executive, a merger with another company or a [bankruptcy]. It is usually due within four business days of the event.',
    see: ['10-K and 10-Q', 'Earnings'],
  },
  {
    term: 'Bankruptcy',
    aliases: ['bankrupt', 'Chapter 11', 'Chapter 7', 'chapter11', 'insolvency', 'insolvent'],
    text: 'Bankruptcy is a court process for a company that cannot pay its debts. Under US Chapter 11 it keeps running while it makes a plan to pay or cut its debts. Under Chapter 7 it shuts down and what it owns is sold.',
    see: ['Delisted', 'Bond'],
  },
  {
    term: 'Basis point',
    aliases: ['bp', 'bps', 'basis points', 'bip', 'bips'],
    text: 'A basis point is one hundredth of one percentage point: 0.01%. Interest rates and [yields|yield] often move in basis points, written bp.',
    example: 'A yield that goes from 4.00% to 4.25% has risen 25 basis points.',
    see: ['Yield', '2s10s spread'],
  },
  {
    term: 'Bid and ask',
    aliases: ['bid', 'ask', 'bid/ask', 'bid ask', 'bid-ask spread', 'bid ask spread', 'offer', 'asking price'],
    text: 'The bid is the highest price someone is offering to pay right now. The ask is the lowest price someone is willing to accept right now. The gap between the two is called the bid-ask spread.',
    example: 'A bid of $9.98 and an ask of $10.00 make a spread of 2 cents.',
    see: ['Volume', 'Stock exchange'],
  },
  {
    term: 'Bond',
    aliases: ['bonds', 'fixed income', 'coupon', 'coupons', 'maturity'],
    text: 'A bond is a loan that people or funds make to a government or a company. The borrower pays interest, often twice a year, and pays back the full amount on a set date, called maturity. The interest payments are called coupons.',
    example: 'A $1,000 bond paying 4% interest pays $40 a year until it is paid back.',
    see: ['Yield', 'Treasury', 'Basis point'],
  },
  {
    term: 'Candlestick',
    aliases: ['candle', 'candles', 'candlesticks', 'candlestick chart', 'candle chart'],
    text: 'A candlestick shows one period of prices, such as one day. Its thick body spans the opening and [closing price]; thin lines reach the high and the low. Its colour shows whether the price ended above or below where it started.',
    see: ['Closing price', 'Volatility'],
  },
  {
    term: 'Closing price',
    aliases: ['close', 'closing', 'previous close', 'prev close', 'market close', 'last close', 'closing bell'],
    text: 'The closing price is the official last price of a trading day. The previous close is the closing price of the trading day before; a day\'s change is usually measured from it.',
    see: ['Pre-market and after hours', 'Market holiday'],
  },
  {
    term: 'Commodity',
    aliases: ['commodities', 'raw material', 'raw materials'],
    text: 'A commodity is a basic raw material that is the same whoever produces it, such as oil, gold, wheat or copper. Much commodity trading happens through [futures].',
    see: ['Futures', 'Spot price'],
  },
  {
    term: 'Consensus estimate',
    aliases: ['consensus', 'estimate', 'estimates', 'EPS estimate', 'beat', 'beats', 'miss', 'earnings surprise', 'surprise'],
    text: 'The consensus estimate is the average of what market analysts expected a company to report, most often for [EPS]. A result above it is called a beat; a result below it, a miss.',
    see: ['EPS', 'Earnings'],
  },
  {
    term: 'CPI',
    aliases: ['consumer price index', 'consumer prices'],
    text: 'The CPI, or consumer price index, tracks the average price of a basket of things households pay for, such as food, rent and fuel. In the US it comes out every month. Its change over a year is a common measure of [inflation].',
    see: ['Inflation', 'Fed funds rate'],
  },
  {
    term: 'Crypto',
    aliases: ['cryptocurrency', 'cryptocurrencies', 'coin', 'coins', 'token', 'tokens', 'digital currency'],
    text: 'Crypto, short for cryptocurrency, is a digital token recorded on a shared public ledger called a blockchain. It is not issued or backed by a central bank or a government. Bitcoin and ether are two examples, and crypto trades all day, every day.',
    see: ['Exchange rate', 'Volatility'],
  },
  {
    term: 'Delisted',
    aliases: ['delisting', 'delist', 'delistings'],
    text: 'Delisted means a [stock] no longer trades on a [stock exchange]. It can happen after a [bankruptcy], a takeover, the company\'s own choice, or when it breaks the exchange\'s rules, such as a minimum share price.',
    see: ['Bankruptcy', 'IPO'],
  },
  {
    term: 'Dividend',
    aliases: ['dividends', 'payout', 'dividend payment'],
    text: 'A dividend is cash a company pays to its shareholders, often every three months, usually out of its profits. Not every company pays one, and a company can raise, cut or stop it.',
    example: 'A company paying $0.50 per share each quarter pays $2 per share a year.',
    see: ['Dividend yield', 'Ex-dividend date'],
  },
  {
    term: 'Dividend yield',
    aliases: ['div yield', 'dividend yields', 'yield on dividend'],
    text: 'Dividend yield is one year of [dividends|dividend] per share divided by the share price, shown as a percent.',
    example: 'A $100 share that pays $3 a year in dividends has a dividend yield of 3%.',
    see: ['Dividend', 'Yield', 'Ex-dividend date'],
  },
  {
    term: 'Earnings',
    aliases: ['profit', 'profits', 'net income', 'earnings report', 'earnings season', 'quarterly results'],
    text: 'Earnings are a company\'s profit: the money left after all its costs, interest and taxes are paid. US public companies report them every three months, in an earnings report.',
    see: ['EPS', 'P/E ratio', 'Consensus estimate'],
  },
  {
    term: 'EPS',
    aliases: ['earnings per share', 'E.P.S.'],
    text: 'EPS, or earnings per share, is a company\'s profit for a period divided by the number of its [shares|stock]. It shows how much of the profit belongs to each share.',
    example: '$10 million of profit and 5 million shares make an EPS of $2.',
    see: ['Earnings', 'P/E ratio', 'Consensus estimate'],
  },
  {
    term: 'ETF',
    aliases: ['ETFs', 'exchange-traded fund', 'exchange traded fund', 'exchange-traded funds'],
    text: 'An ETF, or exchange-traded fund, is a fund that holds a basket of things, such as many [stocks|stock] or [bonds|bond], and trades on a [stock exchange] like a single share. Many ETFs follow an [index].',
    see: ['Index', 'Stock', 'Sector'],
  },
  {
    term: 'Ex-dividend date',
    aliases: ['ex-dividend', 'ex dividend', 'ex-date', 'ex date', 'exdiv', 'ex-div', 'ex dividend date'],
    text: 'The ex-dividend date is the cut-off day for the next [dividend]. A buyer before that day gets the payment; a buyer on or after it does not, and it stays with the seller. The price often drops by about the dividend that day.',
    see: ['Dividend', 'Dividend yield'],
  },
  {
    term: 'Exchange rate',
    aliases: ['FX', 'forex', 'foreign exchange', 'currency', 'currencies', 'exchange rates', 'currency pair', 'FX rate'],
    text: 'An exchange rate is the price of one currency in another. FX, short for foreign exchange, is the market where currencies are traded.',
    example: 'If 1 euro costs 1.10 US dollars, the EURUSD rate is 1.10.',
    see: ['Spot price', 'Inflation'],
  },
  {
    term: 'Fed funds rate',
    aliases: ['fed funds', 'federal funds rate', 'fed rate', 'the fed', 'fed', 'federal reserve', 'FOMC', 'policy rate'],
    text: 'The fed funds rate is the interest rate US banks charge each other to borrow overnight. The Federal Reserve, the US central bank, sets a target range for it, which moves many other interest rates.',
    see: ['Inflation', 'Yield curve', 'Basis point'],
  },
  {
    term: 'Futures',
    aliases: ['future', 'futures contract', 'futures contracts', 'fut', 'futs'],
    text: 'A futures contract is a deal to trade a set amount of something, such as oil or an [index], at a price agreed today, on a set date later. Many futures trade nearly around the clock on weekdays.',
    see: ['Spot price', 'Commodity', 'Option'],
  },
  {
    term: 'GDP',
    aliases: ['gross domestic product', 'economic growth', 'growth', 'output'],
    text: 'GDP, or gross domestic product, is the total value of the final goods and services a country produces in a period, not counting parts used to make other things. In the US it is reported every three months.',
    see: ['Recession', 'Inflation'],
  },
  {
    term: 'Index',
    aliases: ['indexes', 'indices', 'stock index', 'market index'],
    text: 'An index is one number that tracks the prices of a chosen group of [stocks|stock] or other things, such as 500 large US companies. It shows how that group as a whole is moving.',
    example: 'An index that goes from 1,000 to 1,010 has risen 1%.',
    see: ['ETF', 'Sector', 'Futures'],
  },
  {
    term: 'Inflation',
    aliases: ['inflation rate', 'rising prices', 'price rises'],
    text: 'Inflation is the rise in the prices of everyday goods and services over time. When prices rise, the same amount of money pays for fewer things. It is often measured with the [CPI].',
    example: 'With 3% inflation, something that cost $100 a year ago costs about $103 now.',
    see: ['CPI', 'Fed funds rate'],
  },
  {
    term: 'Insider',
    aliases: ['insiders', 'insider trading', 'insider trade', 'insider trades', 'form 4'],
    text: 'An insider is a top manager, a board member or an owner of more than 10% of a company. In the US, insiders report their trades in its shares within two business days, on Form 4. Trading on secret company news is illegal.',
    see: ['13F filing', '8-K filing'],
  },
  {
    term: 'IPO',
    aliases: ['IPOs', 'initial public offering', 'going public', 'go public', 'new listing'],
    text: 'An IPO, or initial public offering, is when a private company first offers its [shares|stock] to the public, and they start to trade on a [stock exchange].',
    see: ['Stock', 'Delisted', 'Stock exchange'],
  },
  {
    term: 'Market cap',
    aliases: ['mkt cap', 'market capitalization', 'market capitalisation', 'mcap', 'market value'],
    text: 'Market cap is the total value the stock market puts on a company: the share price times the number of [shares|stock] that exist.',
    example: '1 million shares at $20 each make a market cap of $20 million.',
    see: ['Stock', 'P/E ratio'],
  },
  {
    term: 'Market holiday',
    aliases: ['holiday', 'holidays', 'market holidays', 'early close', 'half day', 'market closed'],
    text: 'A market holiday is a weekday when a [stock exchange] is closed, such as Christmas Day. On an early close day, US stock trading ends at 1:00 pm New York time.',
    see: ['Closing price', 'Pre-market and after hours'],
  },
  {
    term: 'MOVE index',
    aliases: ['MOVE', 'MOVEINDEX', 'bond volatility'],
    text: 'The MOVE index measures how much the market expects US [Treasury] [yields|yield] to swing over the next month, worked out from [option] prices. It is like the [VIX], but for [bonds|bond].',
    see: ['VIX', 'Volatility', 'Treasury'],
  },
  {
    term: 'Option',
    aliases: ['options', 'call', 'calls', 'put', 'puts', 'call option', 'put option', 'strike', 'strike price', 'option chain', 'options chain', 'expiry', 'expiration'],
    text: 'An option is a contract giving the right, but not the duty, to buy or sell something, such as shares, at a set price (the strike) by a set date. A call is the right to buy; a put is the right to sell.',
    see: ['Futures', 'Volatility', 'VIX'],
  },
  {
    term: 'P/E ratio',
    aliases: ['PE', 'P/E', 'PE ratio', 'P E', 'price to earnings', 'price-to-earnings', 'price to earnings ratio', 'price earnings ratio', 'price/earnings'],
    text: 'The P/E ratio is a share\'s price divided by its [earnings per share|EPS] over the last year. It shows how many dollars the market pays for each $1 of yearly profit.',
    example: 'A $50 share with $2 of earnings per share has a P/E of 25.',
    see: ['EPS', 'Earnings', 'Market cap'],
  },
  {
    term: 'Pre-market and after hours',
    aliases: ['pre-market', 'premarket', 'pre market', 'after hours', 'after-hours', 'afterhours', 'extended hours', 'extended trading'],
    text: 'Pre-market and after hours are trading times outside the main US stock market day, which runs from 9:30 am to 4:00 pm New York time. Fewer trades happen then, so prices can move in bigger jumps.',
    see: ['Closing price', 'Market holiday', 'Volume'],
  },
  {
    term: 'Real time and delayed',
    aliases: ['RT', 'DLY', 'real time', 'realtime', 'real-time', 'delayed', 'delay', 'delayed quote', 'delayed data', 'live price'],
    text: 'Real time (RT) means a price is shown as soon as it is known. Delayed (DLY) means it is shown a set time late, often 15 minutes.',
    see: ['Bid and ask', 'Closing price'],
  },
  {
    term: 'Recession',
    aliases: ['recessions', 'downturn', 'economic downturn'],
    text: 'A recession is a period when a country\'s economy shrinks: less is made, spent and earned, and jobs are often lost. A common rule of thumb is two quarters in a row of falling [GDP].',
    see: ['GDP', 'Inflation'],
  },
  {
    term: 'Sector',
    aliases: ['sectors', 'industry', 'industries'],
    text: 'A sector is a big group of companies that do similar kinds of business, such as technology, energy or health care. Sorting [stocks|stock] into sectors shows which parts of the market are moving.',
    see: ['Index', 'ETF'],
  },
  {
    term: 'Short interest',
    aliases: ['days to cover', 'short ratio', 'shorts'],
    text: 'Short interest is the number of a company\'s shares that have been [sold short|short selling] and not yet returned. In the US it is reported twice a month. Days to cover is short interest divided by average daily [volume].',
    see: ['Short selling', 'Volume'],
  },
  {
    term: 'Short selling',
    aliases: ['short', 'shorting', 'short sale', 'short seller', 'short sellers', 'sold short', 'going short'],
    text: 'Short selling means borrowing shares, selling them now, and later buying the same number back to return to the lender. It makes money if the price falls in between, and loses money if it rises, with no set limit on the loss.',
    see: ['Short interest', 'Stock'],
  },
  {
    term: 'Spot price',
    aliases: ['spot', 'cash price', 'spot rate'],
    text: 'The spot price is the price to trade something for delivery right now, not on a later date as with [futures].',
    see: ['Futures', 'Commodity', 'Exchange rate'],
  },
  {
    term: 'Stock',
    aliases: ['stocks', 'share', 'shares', 'equity', 'equities', 'shareholder', 'shareholders'],
    text: 'A stock, or share, is a small piece of ownership in a company. People who own shares are called shareholders. A share\'s price moves as people trade it on a [stock exchange].',
    example: 'A company split into 1,000 shares: owning 10 of them means owning 1% of it.',
    see: ['Ticker', 'Market cap', 'Stock exchange'],
  },
  {
    term: 'Stock exchange',
    aliases: ['exchange', 'exchanges', 'stock market', 'bourse', 'listing'],
    text: 'A stock exchange is a market where [shares|stock] and other things are traded under set rules and hours. A company whose shares trade there is said to be listed.',
    see: ['Stock', 'IPO', 'Delisted'],
  },
  {
    term: 'Stock split',
    aliases: ['split', 'splits', 'stock splits', 'reverse split', 'reverse splits', 'reverse stock split'],
    text: 'A stock split turns each share into more shares, each worth less, so the company\'s total value does not change. A reverse split does the opposite: fewer shares, each worth more.',
    example: 'In a 2-for-1 split, one $100 share becomes two $50 shares.',
    see: ['Stock', 'Market cap'],
  },
  {
    term: 'Ticker',
    aliases: ['tickers', 'symbol', 'symbols', 'ticker symbol', 'stock symbol'],
    text: 'A ticker is a short code, often a few capital letters, that stands for one [stock] or other thing that trades. Typing it is the quick way to look up its price.',
    see: ['Stock', 'Stock exchange'],
  },
  {
    term: 'Treasury',
    aliases: ['treasuries', 'treasury bond', 'treasury bonds', 'treasury bill', 'treasury note', 'T-bill', 'T-bills', 'T-bond', 'T-note', 'US treasury'],
    text: 'A Treasury is a [bond] issued by the US government. Bills last a year or less, notes last 2 to 10 years, and bonds last 20 or 30 years.',
    see: ['Bond', 'Yield', 'Yield curve'],
  },
  {
    term: 'VIX',
    aliases: ['VIX index', 'fear index', 'fear gauge', 'volatility index'],
    text: 'The VIX is an [index] of how much [volatility] the market expects in large US stocks over the next 30 days, worked out from [option] prices. It is often called the fear gauge.',
    see: ['Volatility', 'MOVE index', 'Option'],
  },
  {
    term: 'Volatility',
    aliases: ['volatile', 'swings', 'price swings'],
    text: 'Volatility is how much and how fast a price moves up and down. A price that swings a lot has high volatility; a steady one has low volatility.',
    see: ['VIX', 'MOVE index', '52-week range'],
  },
  {
    term: 'Volume',
    aliases: ['vol', 'trading volume', 'shares traded'],
    text: 'Volume is the number of [shares|stock] or contracts traded in a period, usually one trading day. Each share counts once per trade.',
    example: 'If 3 trades of 100 shares each happen today, today\'s volume is 300.',
    see: ['Bid and ask', 'Short interest'],
  },
  {
    term: 'Yield',
    aliases: ['yields', 'bond yield', 'bond yields'],
    text: 'A yield is the yearly return on a [bond] or other investment, as a percent of its price. A bond\'s quoted yield also counts any gain or loss by [maturity|bond]. When a bond\'s price rises, its yield falls.',
    example: 'A $100 bond paying $5 a year yields 5%.',
    see: ['Bond', 'Dividend yield', 'Basis point'],
  },
  {
    term: 'Yield curve',
    aliases: ['curve', 'treasury curve', 'inverted yield curve', 'inverted curve', 'inversion', 'inverted'],
    text: 'The yield curve is a line joining the [yields|yield] of [Treasuries|Treasury] from short to long terms, such as 3 months to 30 years. Longer ones usually pay more. When short ones pay more than long ones, the curve is called inverted.',
    see: ['2s10s spread', 'Treasury', 'Fed funds rate'],
  },
];

// How a word is compared: lower case, letters and digits only ("P/E" and "pe" are one).
export const termKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const INDEX = new Map();
for (const t of TERMS) for (const w of [t.term, ...t.aliases]) if (!INDEX.has(termKey(w))) INDEX.set(termKey(w), t);

// The words a person may type before a term: WHATIS a bond, WHATIS the VIX.
const LEAD = /^(?:what\s+is\s+|what\s+are\s+|whats\s+|what's\s+|define\s+)?(?:an?\s+|the\s+)?/i;

// The entry a typed term means, or null: its name or an alias, with "a", "the" or a
// plural s left off, or "ratio" at the end (PE RATIO, P/E).
export function findTerm(words) {
  const raw = String(words ?? '').trim().replace(/[?!.]+$/, '').replace(LEAD, '');
  const k = termKey(raw);
  if (!k) return null;
  const tries = [k, k.replace(/ies$/, 'y'), k.replace(/es$/, ''), k.replace(/s$/, ''), k.replace(/ratio$/, '')];
  for (const t of tries) if (t && INDEX.has(t)) return INDEX.get(t);
  return null;
}

// How far off a guess may be (0 the same, 1 nothing alike) and still count as close.
export const CLOSE = 0.34;
// Shown when nothing is close (WHATIS XYZ): the terms most screens use.
export const COMMON = ['P/E ratio', 'Yield', 'ETF'];

// The closest terms to a word that matched none, best first: a name or alias that
// starts with it or has a word that does, else the fewest letters changed (as a share
// of its length).
// Each entry: [score, term].
export function scoredTerms(words) {
  const k = termKey(words);
  const scored = TERMS.map((t) => {
    let best = Infinity;
    for (const w of [t.term, ...t.aliases]) {
      const a = termKey(w);
      if (!a) continue;
      let s;
      if (k && (a.startsWith(k) || k.startsWith(a))) s = 0.1 + Math.abs(a.length - k.length) / 100;
      else if (k.length >= 3 && String(w).toLowerCase().split(/[^a-z0-9]+/).some((x) => x.startsWith(k))) s = 0.3; // a later word: RATIO, PE RATIO
      else s = editDistance(k, a) / Math.max(k.length, a.length, 1);
      if (s < best) best = s;
    }
    return [best, t];
  });
  return scored.sort((x, y) => x[0] - y[0] || x[1].term.localeCompare(y[1].term));
}
export const closestTerms = (words, n = 3) => scoredTerms(words).slice(0, n).map(([, t]) => t);

// What an unknown word gets: up to 3 close terms, topped up with COMMON ones.
// close: false when none was close (the card then says "Some common terms").
export function suggestTerms(words, n = 3) {
  const near = scoredTerms(words).filter(([s]) => s <= CLOSE).slice(0, n).map(([, t]) => t);
  const common = COMMON.map((c) => TERMS.find((t) => t.term === c)).filter((t) => t && !near.includes(t));
  return { close: near.length > 0, terms: [...near, ...common].slice(0, n) };
}

// [words] and [words|target] in a definition: the words and the term each links to.
export const LINK_RE = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;
export function linksIn(text) {
  return [...String(text).matchAll(LINK_RE)].map((m) => ({ words: m[1], target: m[2] || m[1] }));
}
// The definition as plain words, the link marks taken out.
export const plainText = (text) => String(text ?? '').replace(LINK_RE, '$1');
// Its words, as the budget counts them (45 at most).
export const wordCount = (text) => plainText(text).split(/\s+/).filter(Boolean).length;
