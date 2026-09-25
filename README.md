# Bloombroke

A market terminal for normal people. Type a plain English command, press Enter, get the answer.

## Commands

```
> HOME                         markets, S&P 500, currencies and news on one screen
> MARKETS                      world markets at a glance
> RATES                        Fed rate, Treasury yields, mortgage rates
> NEWS                         headlines that move markets
> AAPL [1D|5D|1M|3M|6M|YTD|1Y|2Y|5Y|10Y|MAX]   any ticker: price, chart and key numbers
> AAPL 2020-01-01 2024-12-31   the chart for any dates (or AAPL FROM 2020-01-01)
> GOLD, EURUSD, SPX, BTC, US10Y   indexes, currency pairs, futures, crypto, yields: same screen
> FX 500 USD THB               convert money, with a 30 day chart
> CPI 100 2015                 what money from a past year is worth today
> AFFORD 1200 [2 PER WEEK] [FOR 3Y]   can I afford it? cost per use of a thing you buy, and a verdict (was BUY)
> WAGE 35                      save your hourly pay (this browser only); AFFORD then shows hours of work
> WHATIF                       in hindsight: what the money would be worth in the maker's stock, with the worst drop along the way
> WHATIF IPHONE6 LATTE:3Y NETFLIX:2015-2024   the same, typed
> HELP                         every command
> TERMS, PRIVACY, DISCLAIMER   open /terms, /privacy, /disclaimer
```

## Legal

`/terms`, `/privacy` and `/disclaimer` are server-rendered from `legal/terms.md`, `legal/privacy.md` and `legal/disclaimer.md` at boot (restart to publish an edit). The version, date, operator and contact live in `public/legal-version.js`. Raise `TERMS_VERSION` there when people should accept again: the first-visit notice stores `{ version, acceptedAt }` under `bb.consent` in localStorage and asks again when the version changes.

Readable names work too: `EUR/USD`, `S&P 500`, `OIL`, `BITCOIN`, `EURO STOXX 50`. Every row with a price opens its own screen (click it, or focus it and press Enter). Typing in the command bar suggests symbols with their names. Each price carries a tag: `RT` real time (US stocks via Nasdaq Last Sale, US indexes, FX, crypto, yields) or `DLY` delayed (futures about 10 minutes, most non-US indexes about 15). The named instruments live in `public/instruments.js`.

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
- `data/`: data sources behind small functions, with an in-memory cache that serves the last good data if a source fails. Quotes are cached 15 seconds and fetched once for every visitor.
- Assets load from `/v/<build>/` (a hash of `public/`), so a deploy never mixes old and new files in a browser or at the edge.
- `public/`: plain ES modules, no build step, no framework. One file per screen in `public/screens/`.

| Route | Returns |
| --- | --- |
| `GET /api/markets` | every named instrument on MARKETS, with real time or delayed |
| `GET /api/fxmajors` | major currency pairs against the dollar |
| `GET /api/fx?amount=&from=&to=` | a conversion plus 30 days of rates |
| `GET /api/quote?s=` | one ticker: price, change, key numbers |
| `GET /api/chart?s=&r=` or `?s=&from=&to=` | price history for a symbol, a preset range or dates |
| `GET /api/search?q=` | symbol suggestions with names |
| `GET /api/cpi?amount=&year=` | CPI-U inflation maths and the series |
| `GET /api/rates` | Fed funds, Treasury yields, mortgage rates |
| `GET /api/news` | market headlines |
| `GET /api/whatif/catalog` | the WHATIF product list |
| `GET /api/whatif?c=` | a WHATIF result, for the words after WHATIF |

## Pro

The terminal stays free. Pro is $4.20 a month (Stripe subscription, USD): your own ticker tape (`TAPE ADD AAPL`, `TAPE REMOVE AAPL`, `TAPE RESET`) and sync of the watchlist, portfolio and tape across devices. Price alerts are planned, not part of Pro yet.

```
> PRO                          what Pro gives, SUBSCRIBE, or your status with MANAGE and LOGOUT
> LOGIN <key>                  use your key on this device (the key never goes in the URL or history)
> LOGOUT                       forget the key on this device
> TAPE ADD AAPL                your own ticker tape (Pro)
```

- There are no accounts. Checkout (cards only) makes a licence key like `BB-7KQ2-M9XD-HT4P-WZ3C`. The server stores only its SHA-256 hash and last 4 characters. The success page takes the session id out of the address bar, then POSTs it to get the full key. The server keeps the key AES-256-GCM encrypted with `PRO_SECRET` until the browser confirms it saved it, and 24 hours at most.
- A pasted key on its own counts as `LOGIN <key>`. A key never goes in the URL, the title, the command history or symbol search.
- A browser whose key has lapsed sees REACTIVATE: the new subscription joins the same licence (same key, same synced data). Checkout is refused while the licence or the customer still has a live Pro subscription, and other open checkouts of that customer are expired, so two tabs cannot buy twice.
- Lost key: `node scripts/pro-reissue.js <path/to/.env> --subscription sub_... | --email address` gives the licence a new key, prints it once, and the old key stops working.
- `STRIPE_MODE=test` switches to the `*_TEST` Stripe settings and shows a demo-checkout banner on PRO. Licences from test checkouts give no Pro on the live site. `TERMS_VERSION` is stored with each acceptance.
- Stripe is the source of truth. The webhook reads each subscription's status fresh from Stripe. Pro is on while the status is `active` or `trialing`, and for 7 days of `past_due`.
- Code: `pro/` (server), `migrations/` (SQLite schema, applied at start), `public/pro.js` and `public/screens/pro.js`, `public/screens/tape.js` (browser). Data lives in `var/pro.db` (SQLite via better-sqlite3, WAL).
- Checkout requires ticking the Terms box (`consent_collection`), and the time is stored as `terms_accepted_at`. Stripe needs a Terms of service URL in the account's public details for that, and `/terms` must exist.
- The PRO screen states the price, the monthly renewal, how to cancel, and: if we ever shut Bloombroke down, we cancel all subscriptions and refund the unused part of the current month. `node scripts/shutdown-refunds.js <path/to/.env>` (admin only) does that: a dry run by default that prints counts and amounts, `--execute` (plus `--live` for a live key) to refund and cancel.
- Bloombroke is run by Bloombroke, Singapore. Contact: hello@bloombroke.com.
- One-time setup: `node scripts/stripe-setup.js <path/to/.env> [--live]` finds or makes the product, the $4.20 monthly price, a Billing Portal configuration and the webhook endpoint, and writes `STRIPE_PRICE_ID`, `STRIPE_PORTAL_CONFIG_ID`, `STRIPE_WEBHOOK_SECRET` and `PRO_SECRET` into that .env without printing them. Checkout stays closed until `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` and `PRO_SECRET` are all set.

| Route | Does |
| --- | --- |
| `POST /api/pro/checkout` | a Stripe Checkout Session URL (rate limited per IP) |
| `POST /api/stripe/webhook` | Stripe events, signature checked, each event handled once |
| `GET /api/pro/config` | `{ mode, open }` for the PRO screen |
| `POST /api/pro/claim` | `{ session_id }` to the new key, for a paid session, within 24 hours |
| `POST /api/pro/claim/confirm` | the browser saved the key: the server forgets its copy |
| `POST /api/pro/login` | `{ key }` to status (rate limited, slowed down) |
| `GET /api/pro/status` | status for the key in the `X-Pro-Key` header |
| `POST /api/pro/portal` | a Stripe Billing Portal URL |
| `GET/PUT /api/pro/sync` | named JSON documents per key, last write wins, 64 KB cap |

## WHATIF data

`data/whatif-products.json` lists each product's US launch date, US launch price and a source link. `data/whatif-prices.json` holds the split-adjusted closes WHATIF needs, baked by `node scripts/build-whatif-prices.js`: CNBC daily bars, each close cross-checked against Yahoo Finance, and the build stops if they differ by more than 1%. Today's price is live. Price return only: dividends and spin-offs are left out.

Quotes come from a free public quote service and currency rates from the Frankfurter API (ECB reference rates). Prices can be delayed. Nothing here is financial advice.
