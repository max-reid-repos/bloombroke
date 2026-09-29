// Google Analytics 4: page views with clean addresses, the goals goal.js mirrors, and one
// share count. goal.js (loadGa4) loads this file after the first screen, past the same
// gates as DataFast and Ahrefs (analyticsBlocked: GPC, Pro, a DESK panel), only on
// bloombroke.com and never on an /embed/* page.
//
// Clean addresses: Google never sees the page's own address. Every page view, and every
// event after it (gtag 'set'), carries page_location = https://bloombroke.com + a known
// path + ?c=<a listed command word>, and for stock, chart, WHATIF and GRAVEYARD screens
// the ticker or catalogue item and fixed range words (1Y, MAX). Every other word and every
// other query parameter is dropped: keys, gift codes, LOGIN, REDEEM and GIFT words,
// Stripe's session_id, amounts, alert prices, chat text, @usernames, emails, gclid, fbclid.
// One exception, for campaign attribution: the FIRST page view of a visit keeps the
// link's utm_source, utm_medium, utm_campaign and utm_content (cleanUtm: short lower-case
// tags only, never a key, a gift code or a checkout id). Later page views have none.
// The referrer is the previous clean page, or another site's origin only.
// Config: no automatic page view, Google Signals and ad personalisation off.
// Never throws into the page.

import { REGISTRY, ALIASES } from './registry.js';

export const SITE = 'https://bloombroke.com';
const LEGAL_PATHS = new Set(['/terms', '/privacy', '/disclaimer']);

// Command words: every command the registry lists or runs (hidden ones too), never a
// pattern (<TICKER>) or a SOON entry.
const COMMANDS = new Set(REGISTRY.filter((c) => !c.pattern && !c.soon).map((c) => c.name));
// Commands whose ticker is kept (at most one; COMPARE up to four). WATCH is not here:
// its tickers are your own list.
export const TICKER_HEADS = new Set(['CHART', 'COMPARE', 'WHY', 'PROFILE', 'VALUE', 'FINANCIALS', 'DIVIDENDS', 'BEATS',
  'INSIDERS', 'OWNERS', 'FILINGS', 'SHORTS', 'OPTIONS', 'HISTORY', 'NEWS', 'GRAVEYARD']);
// Commands that keep fixed words (a range, a tab) but no ticker.
const WORD_HEADS = new Set([...TICKER_HEADS, ...REGISTRY.filter((c) => c.category === 'Weird data').map((c) => c.name),
  'SECTORS', 'BONDS', 'FXMATRIX', 'CALENDAR', 'EARNINGS', 'PRO']);
// The fixed words: ranges, tabs and views. Our own vocabulary, never a person's.
export const WORDS = new Set(['1D', '5D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '3Y', '5Y', '10Y', 'MAX',
  'MACRO', 'SEC', 'WIRES', 'WSB', 'TABLE', 'MOURNED', 'ZOMBIES', 'TODAY', 'BALANCE', 'CASHFLOW', 'QUARTERLY',
  'SPREADS', 'CURVE', 'HEAT', 'MAP', 'US', 'ALL', 'WEEK', 'YEARLY', 'MONTHLY', '10-K', '10-Q', '8-K']);
// A ticker or instrument id: letters first, no dash, no @, no digits-only (AAPL, BRK.B, $GOLD, US10Y).
const TICKER = /^\$?[A-Z][A-Z0-9]{0,7}(?:\.[A-Z]{1,2})?$/;
// A WHATIF catalogue item, with an optional :3Y (IPHONE6, LATTE:3Y).
const ITEM = /^[A-Z][A-Z0-9]{1,19}(?::\d{1,2}Y)?$/;
const MAX_TOKENS = 12;

// A command (the ?c= value or a screen's command) -> the words Google may see, '' for
// HOME, 'UNKNOWN' for anything not a command or a ticker. Never throws.
export function cleanCommand(c) {
  try {
    const toks = String(c ?? '').toUpperCase().trim().split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
    if (!toks.length) return '';
    const head = ALIASES[toks[0]] || toks[0];
    const rest = toks.slice(1);
    if (head === 'HOME') return '';
    if (!COMMANDS.has(head)) {
      if (head === 'UNKNOWN' || !TICKER.test(head)) return 'UNKNOWN';
      // <TICKER> <FUNCTION> [words]: as FUNCTION TICKER [words]. <TICKER> [range]: a quote.
      const fn = ALIASES[rest[0]] || rest[0];
      if (fn && TICKER_HEADS.has(fn)) return [fn, head, ...rest.slice(1).filter((w) => WORDS.has(w)).slice(0, 2)].join(' ');
      return [head, ...rest.filter((w) => WORDS.has(w)).slice(0, 2)].join(' ');
    }
    if (head === 'WHATIF') {
      const stop = rest.indexOf('MY'); // MY <amount> <ticker> <date>: your own purchase, never kept
      const items = (stop < 0 ? rest : rest.slice(0, stop)).filter((w) => ITEM.test(w)).slice(0, 4);
      return ['WHATIF', ...items].join(' ');
    }
    if (TICKER_HEADS.has(head)) {
      const most = head === 'COMPARE' ? 4 : 1;
      const out = [head];
      let tickers = 0;
      for (const w of rest) {
        if (WORDS.has(w)) out.push(w);
        else if (TICKER.test(w) && tickers < most) { out.push(w); tickers += 1; }
      }
      return out.slice(0, 7).join(' ');
    }
    if (WORD_HEADS.has(head)) return [head, ...rest.filter((w) => WORDS.has(w)).slice(0, 2)].join(' ');
    return head;
  } catch {
    return 'UNKNOWN';
  }
}

// A request path -> a known one: /, /terms, /privacy, /disclaimer; /index.html is /;
// anything else (the not-found page) is /not-found.
export function cleanPath(pathname) {
  const p = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/index.html') return '/';
  return LEGAL_PATHS.has(p) ? p : '/not-found';
}

// Campaign tags kept on the first page view of a visit, in this order.
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
const UTM_VALUE = /^[a-z0-9._-]{1,40}$/;
// Never a tag, even when it fits UTM_VALUE: a licence key or gift code (BB-XXXX-...,
// GIFT-XXXX-..., four-character groups without the prefix, any separator, or run
// together: 16 or more letters and digits in a row with two digits or more) or a Stripe
// id (cs_live_, sk_test_, whsec_).
const UTM_SECRET = /(?:bb|gift)(?:[-._][a-z0-9]{4}){2,}|(?:[a-z0-9]{4}[-._]){3}[a-z0-9]{4}|(?:^|[^a-z0-9])(?:cs|sk|rk|pk)_(?:live|test)_|whsec_/;
const secretTag = (v) => UTM_SECRET.test(v) || (v.match(/[a-z0-9]{16,}/g) || []).some((run) => (run.match(/\d/g) || []).length >= 2);

// A landing page's search -> a query string of only the four campaign tags (UTM_KEYS,
// in that order), each lower-cased and a short plain tag, else left out; '' for none.
export function cleanUtm(search) {
  try {
    const q = new URLSearchParams(String(search || ''));
    const out = new URLSearchParams();
    for (const k of UTM_KEYS) {
      const v = String(q.get(k) ?? '').trim().toLowerCase();
      if (UTM_VALUE.test(v) && !secretTag(v)) out.set(k, v);
    }
    return out.toString();
  } catch {
    return '';
  }
}

const query = (c) => `?${new URLSearchParams({ c }).toString().replace(/%24/g, '$')}`;

// { location, title } for a page: a path and, on the terminal, its command. utm: a
// cleanUtm string, after ?c= (or on its own), for the first page view only.
export function pageFor({ path = '/', command = null, utm = '' } = {}) {
  const p = cleanPath(path);
  const tags = cleanUtm(utm);
  if (p !== '/') return { location: SITE + p + (tags ? `?${tags}` : ''), title: `${p.slice(1).replace(/-/g, ' ').toUpperCase()} | Bloombroke` };
  const c = cleanCommand(command);
  const base = c ? `${SITE}/${query(c)}` : `${SITE}/`;
  const location = tags ? `${base}${c ? '&' : '?'}${tags}` : base;
  return { location, title: c ? `${c} | Bloombroke` : 'Bloombroke' };
}

// Any address -> its clean page_location. Only ?c= is read; everything else is dropped.
export function cleanUrl(href) {
  try {
    const u = new URL(String(href), SITE);
    return pageFor({ path: u.pathname, command: u.searchParams.get('c') }).location;
  } catch {
    return `${SITE}/`;
  }
}

// document.referrer -> this site's clean page, another site's origin only, or ''.
export function cleanReferrer(ref) {
  if (!ref) return '';
  try {
    const u = new URL(String(ref));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.origin === SITE) return cleanUrl(u.href);
    return `${u.origin}/`;
  } catch {
    return '';
  }
}

// The content_type of a share: the screen's command word, lower case ('quote' for a
// ticker, 'home', 'unknown').
export function contentType(clean) {
  const head = String(clean || '').split(' ')[0];
  if (!head) return 'home';
  if (head === 'UNKNOWN') return 'unknown';
  return COMMANDS.has(head) ? head.toLowerCase() : 'quote';
}

// Share buttons, first match wins: SHARE ON X, DOWNLOAD IMAGE, SAVE VIDEO, EMBED, COPY
// RESULT, and SHARE (the F-key) or COPY LINK.
export const SHARES = [
  ['a[href^="https://x.com/intent/"]', 'x'],
  ['a[download][href^="/og/"]', 'image'],
  ['[data-video]', 'video'],
  ['[data-embed], .gs-embed', 'embed'],
  ['.gs-copy', 'copy'],
  ['#share, [data-copy]', 'link'],
];
export function shareMethod(target) {
  try {
    for (const [sel, method] of SHARES) if (target?.closest?.(sel)) return method;
  } catch { /* not an element */ }
  return null;
}

const EVENT_RE = /^[a-z][a-z0-9_]{0,39}$/;
// The only param names an event may carry (goal.js GOAL_PROPS, and the share event's).
export const PARAMS = new Set(['result', 'plan', 'gauge', 'chip', 'kind', 'method', 'content_type']);
const VALUE_RE = /^[a-z0-9_]{1,16}$/;

// Start GA4: the gtag queue, the clean page, the config, the first page view. Returns
// { page(command), event(name, params) }, or null when blocked. goal.js adds the script.
// state: { page, early, search } from goal.js: the last screen shown, goals sent before
// now, and the landing address's search (read before the terminal rewrites the address
// bar), whose campaign tags go on the first page view only.
// blocked(): the gates again, asked before every send (a key can land at any time).
export function startGa4({ win, doc, id, state = { page: null, early: [] }, blocked = () => false }) {
  try {
    if (!win || !doc || blocked()) return null;
    win.dataLayer = win.dataLayer || [];
    // gtag.js reads each call as an arguments object, so this must stay a plain function.
    const gtag = function gtag() { win.dataLayer.push(arguments); };
    win.gtag = gtag;
    const path = win.location?.pathname || '/';
    const terminal = cleanPath(path) === '/' || cleanPath(path) === '/not-found';
    let referrer = cleanReferrer(doc.referrer);
    let last = null;
    let current = '';
    let utm = cleanUtm(state.search ?? win.location?.search); // the first page view's only

    const page = (command) => {
      try {
        if (blocked()) return false;
        const plain = pageFor({ path, command });
        if (plain.location === last) return false;
        const pg = utm ? pageFor({ path, command, utm }) : plain;
        const params = { page_location: pg.location, page_referrer: referrer, page_title: pg.title };
        gtag('set', params);
        gtag('event', 'page_view', params);
        utm = ''; // later page views stay tag-free
        referrer = plain.location;
        last = plain.location;
        current = cleanCommand(command);
        return true;
      } catch {
        return false;
      }
    };
    const event = (name, params) => {
      try {
        if (blocked() || !EVENT_RE.test(String(name))) return false;
        const p = {};
        for (const [k, v] of Object.entries(params && typeof params === 'object' ? params : {})) {
          if (PARAMS.has(k) && VALUE_RE.test(String(v))) p[k] = String(v);
        }
        gtag('event', name, p);
        return true;
      } catch {
        return false;
      }
    };

    // Before config: the clean address, so nothing automatic ever carries the real one.
    const first = pageFor({ path, command: state.page ?? new URLSearchParams(win.location?.search || '').get('c'), utm });
    gtag('js', new Date());
    gtag('set', { page_location: first.location, page_referrer: referrer, page_title: first.title });
    gtag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    // The terminal's first screen: the one it showed (bb:page), or the next one it shows.
    if (!terminal) page(null);
    else if (state.page != null) page(state.page);
    for (const [name, params] of (state.early || []).splice(0)) event(name, params);

    // One share count for every share button (capture: some buttons stop the click).
    doc.addEventListener?.('click', (e) => {
      const method = shareMethod(e.target);
      if (method) event('share', { method, content_type: contentType(current) });
    }, true);
    return { page, event };
  } catch {
    return null;
  }
}
