# Bloombroke

A market terminal for normal people. Type a plain English command, press Enter, get the answer.

```
> MARKETS            world markets at a glance
> FX 500 USD THB     convert money, with a 30 day chart
> HELP               every command
```

Every screen is a shareable link: the command lives in the URL (`/?c=FX+500+USD+THB`).

## Run

Requires Node 20.12 or newer.

```
cp .env.example .env
npm install
npm start          # http://localhost:3020
npm test
```

## How it is built

- `server.js`: Express 5. Serves `public/` and two JSON routes, `/api/markets` and `/api/fx`.
- `data/`: data sources behind small functions, with an in-memory cache that serves the last good data if a source fails.
- `public/`: plain ES modules, no build step, no framework.

Quotes come from a free public quote service and currency rates from the Frankfurter API (ECB reference rates). Prices can be delayed. Nothing here is financial advice.
