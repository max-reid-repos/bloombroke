// Goals: one per feature, so a feature nobody uses can be dropped. goal(name, props, { once })
//  - sends a DataFast custom goal: window.datafast(name, props) (datafa.st docs, custom
//    goals). Calls made before the script arrives wait in window.datafast.q, which the
//    script replays when it loads.
//  - and, for the actions that never reach our server (a video saved, an embed copied, a
//    share clicked), POSTs /api/count { name } for BBRK's own totals (lib/counters.js).
// Never personal data: the name is from GOALS, props are short enums from GOAL_PROPS
// (anything else is dropped). With Global Privacy Control on, DataFast is never loaded
// and goal() skips it; our own totals (a name and a count, nothing else) still count.
// Blocked, missing or broken DataFast: goal() does nothing there and never throws.
// Pro: a browser holding a licence key (localStorage 'bb.pro.key') never loads DataFast,
// and neither does the checkout return page that fetches the key (?session_id=, or a
// pending session in this tab). goal() then sends only our own totals. A key that lands
// after the page loaded (LOGIN, REDEEM) finds DataFast already running: the page reloads
// (reloadAfterKey) so it stops at once. Cloudflare may still inject its own analytics
// beacon; that is outside this code.
// Ahrefs Web Analytics (page views only, no goals) loads through exactly the same gates
// as DataFast (analyticsBlocked): never with GPC, never for Pro, never in a DESK panel.
// Google Analytics 4 (loadGa4, public/ga4.js) too, and only on bloombroke.com, never on
// /embed/*, only after the visitor accepted the current Terms on the first-visit card
// (gaConsented; ACCEPT or START in this visit arms it at once: gaConsentGiven), after the
// first screen. It gets clean page views (the command word, and for
// stock, chart, WHATIF and GRAVEYARD screens the ticker or item, and on the first page
// view only the link's utm_source/medium/campaign/content tags; nothing else), the goals
// in GA_EVENTS, and one 'share' event for every share button.
// once: a key (the result, the puzzle number). The same goal with the same key is sent
// once per browser tab session (sessionStorage 'bb.goals'); without storage, every time.

import { TERMS_VERSION } from './legal-version.js';

export const GOALS = [
  'whatif_run', 'whatif_video', 'whatif_embed', 'whatif_share',
  'guess_played', 'guess_shared',
  'news_why_opened', 'weird_gauge_opened', 'mcp_screen_opened',
  'feedback_sent', 'pro_checkout_started', 'desk_opened',
  'sponsor_click', // a paid sponsor line clicked (never our own AD lines)
  'notfound_seen', 'graveyard_seen', 'ipo_made', 'ipo_shared', // NO SUCH TICKER. YET.
  'welcome_chip', 'welcome_typed', 'welcome_surprise', // WELCOME: the first-visit card (consent.js)
  'waitlist_joined', // PRO WAITLIST: someone joined; never the address
];

// Counted on our server by the route itself (lib/counters.js SERVER_COUNTS), so not here:
// whatif_run, feedback_sent, mcp_call, and guess_played for a solved game. These are the
// client-only ones, and guess_played is posted only for a game lost (result: 'missed').
export const CLIENT_COUNTED = ['whatif_video', 'whatif_embed', 'whatif_share', 'guess_shared'];
export function postsCount(name, props) {
  return CLIENT_COUNTED.includes(name) || (name === 'guess_played' && props?.result === 'missed');
}
const SEEN_KEY = 'bb.goals';
const SEEN_MAX = 200;

// Was this goal with this key sent in this tab session? Marks it sent. No storage: false.
export function seenBefore(name, once, storage) {
  if (once === undefined || once === null) return false;
  try {
    const store = storage === undefined ? globalThis.sessionStorage : storage; // the getter can throw
    const k = `${name}:${String(once).slice(0, 120)}`;
    const list = JSON.parse(store.getItem(SEEN_KEY) || '[]');
    const seen = Array.isArray(list) ? list : [];
    if (seen.includes(k)) return true;
    store.setItem(SEEN_KEY, JSON.stringify([...seen, k].slice(-SEEN_MAX)));
    return false;
  } catch {
    return false;
  }
}

// The props each goal may carry. Values must be short lower-case words.
export const GOAL_PROPS = {
  whatif_share: ['via'],
  whatif_embed: ['kind'],
  guess_played: ['result'],
  guess_shared: ['via'],
  weird_gauge_opened: ['gauge'],
  pro_checkout_started: ['plan'],
  ipo_shared: ['via'],
  welcome_chip: ['chip'], // guess, whatif, graveyard, chart (screens/welcome.js)
  welcome_surprise: ['kind'], // weird, graveyard, whatif, sectors (never the words typed)
};
const VALUE_RE = /^[a-z0-9_]{1,16}$/;
const QUEUE_MAX = 50;

export const DATAFAST = {
  src: 'https://datafa.st/js/script.js',
  websiteId: 'dfid_RaIYVk8TuhGSz6fl2wpPa',
  domain: 'bloombroke.com',
};

// Ahrefs Web Analytics: its script, async, with the site's public id as data-key.
export const AHREFS = {
  src: 'https://analytics.ahrefs.com/analytics.js',
  site: 'PRP692zzb4D3HwxC/FRBpA', // public: every visitor's browser gets it; the script's data-key
};

// Google Analytics 4: gtag.js with the site's public measurement id.
export const GA4 = {
  id: 'G-N4VN8PCJXK', // public: every visitor's browser gets it
  src: 'https://www.googletagmanager.com/gtag/js?id=G-N4VN8PCJXK',
};
const GA_SCRIPT = 'script[src^="https://www.googletagmanager.com/"]';

// The GA4 event for each goal (snake_case, 40 characters or fewer). Its params are the
// goal's own cleanProps (short fixed words), never anything else. The share goals
// (whatif_share, whatif_video, whatif_embed, guess_shared, ipo_shared) are not here:
// ga4.js sends one 'share' event for every share button, these included.
export const GA_EVENTS = {
  whatif_run: 'whatif_run',
  guess_played: 'guess_played', // a GUESS game finished: { result: solved | missed }
  pro_checkout_started: 'pro_checkout_start', // { plan: month | year }
  news_why_opened: 'news_why_opened',
  weird_gauge_opened: 'weird_gauge_opened',
  mcp_screen_opened: 'mcp_screen_opened',
  feedback_sent: 'feedback_sent',
  desk_opened: 'desk_opened',
  sponsor_click: 'sponsor_click',
  notfound_seen: 'notfound_seen',
  graveyard_seen: 'graveyard_seen',
  ipo_made: 'ipo_made',
  welcome_chip: 'welcome_chip',
  welcome_typed: 'welcome_typed',
  welcome_surprise: 'welcome_surprise',
  waitlist_joined: 'waitlist_joined',
};
export const GA_SHARE_GOALS = ['whatif_share', 'whatif_video', 'whatif_embed', 'guess_shared', 'ipo_shared'];

// GA4 in this page: on once loadGa4 passed the gates; page and early hold the last
// screen shown and the goals sent before ga4.js runs; run is ga4.js's { page, event }.
const gaState = { on: false, page: null, early: [], run: null, search: '', listening: false, waiting: null };
function gaSend(event, params, state = gaState) {
  if (!state.on) return false;
  if (state.run) return state.run.event(event, params);
  if (state.early.length >= QUEUE_MAX) return false;
  state.early.push([event, params]);
  return true;
}

// The licence key's storage name (public/pro.js LS.key; a test keeps them the same).
export const PRO_KEY_STORAGE = 'bb.pro.key';
const PRO_PENDING_STORAGE = 'bb.pro.session';

// Is a Pro key here, or on its way (the checkout return page)? Never throws; a storage
// that cannot be read counts as no key.
export function proKeyPresent({ local, session, loc } = {}) {
  try {
    const ls = local === undefined ? globalThis.localStorage : local;
    if (ls?.getItem?.(PRO_KEY_STORAGE)) return true;
  } catch { /* no storage */ }
  try {
    const ss = session === undefined ? globalThis.sessionStorage : session;
    if (ss?.getItem?.(PRO_PENDING_STORAGE)) return true;
  } catch { /* no storage */ }
  try {
    const search = (loc === undefined ? globalThis.location : loc)?.search || '';
    if (/[?&]session_id=/.test(search)) return true;
  } catch { /* no location */ }
  return false;
}

// A key just landed (LOGIN or REDEEM succeeded). If DataFast or a Cloudflare beacon runs
// in this page, reload to PRO so it stops now; the new page does not load DataFast.
// showKey: the PRO screen shows the key once after the reload (a REDEEM's new key).
// True when it reloads. Never throws.
export const SHOW_KEY_ONCE = 'bb.pro.showkey';
const THIRD_PARTY = 'script[src^="https://datafa.st/"], script[src^="https://analytics.ahrefs.com/"], script[src^="https://www.googletagmanager.com/"], script[src*="cloudflareinsights.com"]';
export function reloadAfterKey({ doc = globalThis.document, loc = globalThis.location, session, showKey = false } = {}) {
  try {
    if (!doc?.querySelector?.(THIRD_PARTY) || !loc?.replace) return false;
    if (showKey) {
      try { (session === undefined ? globalThis.sessionStorage : session)?.setItem(SHOW_KEY_ONCE, '1'); } catch { /* the key stays under SHOW KEY */ }
    }
    loc.replace('/?c=PRO');
    return true;
  } catch {
    return false;
  }
}
// Read and clear the show-the-key-once flag.
export function takeShowKeyOnce(session) {
  try {
    const s = session === undefined ? globalThis.sessionStorage : session;
    if (!s?.getItem(SHOW_KEY_ONCE)) return false;
    s.removeItem(SHOW_KEY_ONCE);
    return true;
  } catch {
    return false;
  }
}

// Global Privacy Control: the browser says "do not sell or share".
export function gpcOn(nav = globalThis.navigator) {
  try { return nav?.globalPrivacyControl === true; } catch { return false; }
}

// Only the allowed keys, only short lower-case words. Never throws.
export function cleanProps(name, props) {
  const keys = GOAL_PROPS[name] || [];
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const k of keys) {
    const v = typeof props[k] === 'string' ? props[k].toLowerCase() : '';
    if (VALUE_RE.test(v)) out[k] = v;
  }
  return out;
}

// The gates every analytics script passes (DataFast and Ahrefs alike): not without a
// page, not with GPC on, not for Pro (proKeyPresent), not inside a DESK panel (a desk of
// panels is one visit). True when the script must not load. Never throws.
export function analyticsBlocked({ doc, nav, win, pro = proKeyPresent } = {}) {
  try {
    if (!doc || !win || gpcOn(nav)) return true;
    if (pro()) return true;
    return Boolean(doc.documentElement?.classList?.contains('is-embed'));
  } catch {
    return true;
  }
}

// Add the DataFast script once, past the gates above. A queue stands in until the
// script loads.
export function loadDataFast({ doc = globalThis.document, nav = globalThis.navigator, win = globalThis.window, pro = proKeyPresent } = {}) {
  try {
    if (analyticsBlocked({ doc, nav, win, pro })) return false;
    if (doc.querySelector('script[src^="https://datafa.st/"]')) return false;
    if (typeof win.datafast !== 'function') {
      const q = function datafastQueue(...args) {
        q.q = q.q || [];
        if (q.q.length < QUEUE_MAX) q.q.push(args);
      };
      win.datafast = q;
    }
    const s = doc.createElement('script');
    s.defer = true;
    s.src = DATAFAST.src;
    s.setAttribute('data-website-id', DATAFAST.websiteId);
    s.setAttribute('data-domain', DATAFAST.domain);
    doc.head.appendChild(s);
    return true;
  } catch {
    return false;
  }
}

// Add the Ahrefs Web Analytics script once, past the same gates as DataFast, and only on
// bloombroke.com itself. async, with its data-key.
export function loadAhrefs({ doc = globalThis.document, nav = globalThis.navigator, win = globalThis.window, pro = proKeyPresent } = {}) {
  try {
    if (analyticsBlocked({ doc, nav, win, pro })) return false;
    // Only on the site itself (DataFast's data-domain): never on localhost, a test server
    // or a copy of the page elsewhere.
    if (win.location?.hostname !== DATAFAST.domain) return false;
    if (doc.querySelector('script[src^="https://analytics.ahrefs.com/"]')) return false;
    const s = doc.createElement('script');
    s.async = true;
    s.src = AHREFS.src;
    s.setAttribute('data-key', AHREFS.site);
    doc.head.appendChild(s);
    return true;
  } catch {
    return false;
  }
}

// Has this browser accepted the current Terms on the first-visit card? The record
// public/consent.js stores (CONSENT_KEY, localStorage, else sessionStorage) with this
// TERMS_VERSION and a real time. A stale version, none, or no storage: false. GA4 only;
// DataFast and Ahrefs do not wait for it.
export const GA_CONSENT_KEY = 'bb.consent'; // public/consent.js CONSENT_KEY (a test keeps them the same)
export function gaConsented({ local, session, version = TERMS_VERSION } = {}) {
  for (const pick of [() => (local === undefined ? globalThis.localStorage : local), () => (session === undefined ? globalThis.sessionStorage : session)]) {
    try {
      const raw = pick()?.getItem?.(GA_CONSENT_KEY);
      if (!raw) continue;
      const r = JSON.parse(raw);
      if (r && r.version === version && Number.isFinite(Date.parse(r.acceptedAt))) return true;
    } catch { /* no storage, or a bad record */ }
  }
  return false;
}

// ACCEPT or START on the first-visit card (consent.js commitWelcome): a GA4 that waited
// for consent in this page starts now. Never throws.
export function gaConsentGiven(state = gaState) {
  try {
    const go = state.waiting;
    state.waiting = null;
    if (typeof go === 'function') go();
  } catch { /* GA4 stays off */ }
}

// Add Google Analytics 4 past the same gates as DataFast and Ahrefs, only on
// bloombroke.com itself and never on an /embed/* page, after the first screen (the page's
// load event, then an idle moment), so start-up does not change. The gates are asked
// again then (a key may have landed). ga4.js starts gtag with clean addresses and no
// automatic page view; then the script tag goes in, async. Until then, the screen shown
// (the terminal's bb:page event) and goals wait in gaState. True when it is on its way.
function afterFirstScreen(win, fn) {
  const idle = () => (typeof win.requestIdleCallback === 'function' ? win.requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 1500));
  if (win.document?.readyState === 'complete') idle(); else win.addEventListener('load', idle, { once: true });
}
export function loadGa4({
  doc = globalThis.document, nav = globalThis.navigator, win = globalThis.window, pro = proKeyPresent,
  state = gaState, later = (fn) => afterFirstScreen(win, fn), start = () => import('./ga4.js'),
  consented = () => gaConsented(),
} = {}) {
  try {
    if (analyticsBlocked({ doc, nav, win, pro })) return false;
    if (win.location?.hostname !== DATAFAST.domain) return false;
    if (/^\/embed(\/|$)/i.test(win.location?.pathname || '')) return false;
    if (state.on || doc.querySelector(GA_SCRIPT)) return false;
    // Before consent too: the screen shown and the landing link's campaign tags (read
    // before the terminal rewrites the address), kept in this page only, sent nowhere.
    if (!state.listening) {
      state.listening = true;
      state.search = win.location?.search || '';
      win.addEventListener('bb:page', (e) => {
        const c = typeof e?.detail === 'string' ? e.detail : null;
        if (state.run) state.run.page(c); else state.page = c;
      });
    }
    if (!consented()) {
      // Not accepted yet: ACCEPT or START on the card starts it (gaConsentGiven).
      state.waiting = () => loadGa4({ doc, nav, win, pro, state, later, start, consented: () => true });
      return false;
    }
    state.on = true;
    const blocked = () => analyticsBlocked({ doc, nav, win, pro });
    later(() => {
      if (blocked()) { state.on = false; return; }
      Promise.resolve().then(start).then((m) => {
        const run = m.startGa4({ win, doc, id: GA4.id, state, blocked });
        if (!run) { state.on = false; return; }
        state.run = run;
        if (doc.querySelector(GA_SCRIPT)) return;
        const s = doc.createElement('script');
        s.async = true;
        s.src = GA4.src;
        doc.head.appendChild(s);
      }).catch(() => { state.on = false; });
    });
    return true;
  } catch {
    return false;
  }
}

// { datafast, counted }: what was sent. Never throws, never waits.
// ga(event, params): where the GA4 event goes (tests); by default GA4 in this page, if
// loadGa4 started it. Same gates as DataFast: never with GPC, never for Pro.
export function goal(name, props, { once, win = globalThis.window, nav = globalThis.navigator, fetchImpl = globalThis.fetch, store, pro = proKeyPresent, ga = gaSend } = {}) {
  const sent = { datafast: false, counted: false };
  if (!GOALS.includes(name)) return sent;
  if (seenBefore(name, once, store)) return sent;
  if (!gpcOn(nav) && !pro()) {
    try {
      const df = win?.datafast;
      if (typeof df === 'function') {
        const p = cleanProps(name, props);
        if (Object.keys(p).length) df(name, p); else df(name);
        sent.datafast = true;
      }
    } catch { /* DataFast broken or blocked: nothing */ }
    try {
      if (GA_EVENTS[name]) ga(GA_EVENTS[name], cleanProps(name, props));
    } catch { /* GA4 broken or blocked: nothing */ }
  }
  if (postsCount(name, props) && typeof fetchImpl === 'function') {
    try {
      const r = fetchImpl('/api/count', {
        method: 'POST', keepalive: true, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      r?.catch?.(() => {});
      sent.counted = true;
    } catch { /* offline: nothing */ }
  }
  return sent;
}

// A plain count for BBRK's sponsor inventory (no DataFast goal): POST /api/count
// { name, n }. Only the names the server allows; n is 1 unless batched (strip_shown).
export function countOnly(name, n = 1, { fetchImpl = globalThis.fetch } = {}) {
  if (!['strip_shown', 'strip_click'].includes(name) || !Number.isInteger(n) || n < 1 || n > 20 || typeof fetchImpl !== 'function') return false;
  try {
    const r = fetchImpl('/api/count', {
      method: 'POST', keepalive: true, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(n === 1 ? { name } : { name, n }),
    });
    r?.catch?.(() => {});
    return true;
  } catch {
    return false;
  }
}

// Sponsor strip lines shown, sent in batches: at 20, every minute, or when the tab is
// hidden or closed. { add(), flush(), pending }.
export function stripShownBatch({ send = (n) => countOnly('strip_shown', n), max = 20, everyMs = 60_000, doc = globalThis.document, win = globalThis.window } = {}) {
  let pending = 0;
  const flush = () => { if (pending > 0) { const n = Math.min(pending, max); pending -= n; send(n); } };
  const timer = typeof setInterval === 'function' ? setInterval(flush, everyMs) : null;
  timer?.unref?.();
  try {
    doc?.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'hidden') flush(); });
    win?.addEventListener?.('pagehide', flush);
  } catch { /* no page: timer only */ }
  return {
    add() { pending += 1; if (pending >= max) flush(); },
    flush,
    get pending() { return pending; },
  };
}

// In a page (the terminal and the legal pages), load DataFast, Ahrefs and GA4 unless a gate says no.
if (typeof window !== 'undefined' && typeof document !== 'undefined') { loadDataFast(); loadAhrefs(); loadGa4(); }
