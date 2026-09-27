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
// once: a key (the result, the puzzle number). The same goal with the same key is sent
// once per browser tab session (sessionStorage 'bb.goals'); without storage, every time.

export const GOALS = [
  'whatif_run', 'whatif_video', 'whatif_embed', 'whatif_share',
  'guess_played', 'guess_shared',
  'news_why_opened', 'weird_gauge_opened', 'mcp_screen_opened',
  'feedback_sent', 'pro_checkout_started', 'desk_opened',
  'sponsor_click', // a paid sponsor line clicked (never our own AD lines)
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
};
const VALUE_RE = /^[a-z0-9_]{1,16}$/;
const QUEUE_MAX = 50;

export const DATAFAST = {
  src: 'https://datafa.st/js/script.js',
  websiteId: 'dfid_RaIYVk8TuhGSz6fl2wpPa',
  domain: 'bloombroke.com',
};

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

// Add the DataFast script once: not with GPC on, not inside a DESK panel (a desk of
// panels is one visit), not twice. A queue stands in until the script loads.
export function loadDataFast({ doc = globalThis.document, nav = globalThis.navigator, win = globalThis.window } = {}) {
  try {
    if (!doc || !win || gpcOn(nav)) return false;
    if (doc.documentElement?.classList?.contains('is-embed')) return false;
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

// { datafast, counted }: what was sent. Never throws, never waits.
export function goal(name, props, { once, win = globalThis.window, nav = globalThis.navigator, fetchImpl = globalThis.fetch, store } = {}) {
  const sent = { datafast: false, counted: false };
  if (!GOALS.includes(name)) return sent;
  if (seenBefore(name, once, store)) return sent;
  if (!gpcOn(nav)) {
    try {
      const df = win?.datafast;
      if (typeof df === 'function') {
        const p = cleanProps(name, props);
        if (Object.keys(p).length) df(name, p); else df(name);
        sent.datafast = true;
      }
    } catch { /* DataFast broken or blocked: nothing */ }
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

// In a page (the terminal and the legal pages), load DataFast unless GPC says no.
if (typeof window !== 'undefined' && typeof document !== 'undefined') loadDataFast();
