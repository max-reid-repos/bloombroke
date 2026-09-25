# Bloombroke

A market terminal for normal people. Type a plain English command, press Enter, get the answer.

## Commands

```
> HOME                         markets, S&P 500, currencies and news on one screen
> MARKETS                      world markets at a glance
> RATES                        Fed rate, Treasury yields, mortgage rates
> NEWS                         headlines that move markets
> AAPL [1D|1M|6M|1Y|5Y]        any ticker: price, chart and key numbers
> FX 500 USD THB               convert money, with a 30 day chart
> CPI 100 2015                 what money from a past year is worth today
> BUY 1200 [2 PER WEEK] [FOR 3Y]   should I buy it? cost per use and a verdict
> WAGE 35                      save your hourly pay (this browser only); BUY then shows hours of work
> WHATIF                       the stock you should have bought: pick what you bought
> WHATIF IPHONE6 LATTE:3Y NETFLIX:2015-2024   the same, typed
> HELP                         every command
```

`WHATIF IPHONE` opens the picker with every iPhone picked. Habits take years (`:3Y`) or dates (`:2015-2024`). F1 to F8 jump between screens. Every screen is a shareable link: the command lives in the URL (`/?c=FX+500+USD+THB`).

## Run

Requires Node 20.12 or newer.

```
cp .env.example .env
npm install
npm start          # http://localhost:3020
npm test
```

## How it is built

- `server.js`: Express 5. Serves `public/` and the JSON routes below.
- `data/`: data sources behind small functions, with an in-memory cache that serves the last good data if a source fails.
- `public/`: plain ES modules, no build step, no framework. One file per screen in `public/screens/`.

| Route | Returns |
| --- | --- |
| `GET /api/markets` | world indexes, commodities, bitcoin, two currency pairs |
| `GET /api/fxmajors` | major currency pairs against the dollar |
| `GET /api/fx?amount=&from=&to=` | a conversion plus 30 days of rates |
| `GET /api/quote?s=` | one ticker: price, change, key numbers |
| `GET /api/chart?s=&r=` | price history for a ticker and range |
| `GET /api/cpi?amount=&year=` | CPI-U inflation maths and the series |
| `GET /api/rates` | Fed funds, Treasury yields, mortgage rates |
| `GET /api/news` | market headlines |
| `GET /api/whatif/catalog` | the WHATIF product list |
| `GET /api/whatif?c=` | a WHATIF result, for the words after WHATIF |

## WHATIF data

`data/whatif-products.json` lists each product's US launch date, US launch price and a source link. `data/whatif-prices.json` holds the split-adjusted closes WHATIF needs, baked by `node scripts/build-whatif-prices.js`: CNBC daily bars, each close cross-checked against Yahoo Finance, and the build stops if they differ by more than 1%. Today's price is live. Price return only: dividends and spin-offs are left out.

Quotes come from a free public quote service and currency rates from the Frankfurter API (ECB reference rates). Prices can be delayed. Nothing here is financial advice.
