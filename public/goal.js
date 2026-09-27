// Goals: one per feature, so a feature nobody uses can be dropped. goal(name, props)
//  - sends a DataFast custom goal: window.datafast(name, props) (datafa.st docs, custom
//    goals). Calls made before the script arrives wait in window.datafast.q, which the
//    script replays when it loads.
//  - and, for the actions that never reach our server (a video saved, an embed copied, a
//    share clicked), POSTs /api/count { name } for BBRK's own totals (lib/counters.js).
// Never personal data: the name is from GOALS, props are short enums from GOAL_PROPS
// (anything else is dropped). With Global Privacy Control on, DataFast is never loaded
// and goal() skips it; our own totals (a name and a count, nothing else) still count.
// Blocked, missing or broken DataFast: goal() does nothing there and never throws.

export const GOALS = [
  'whatif_run', 'whatif_video', 'whatif_embed', 'whatif_share',
  'guess_played', 'guess_shared',
  'news_why_opened', 'weird_gauge_opened', 'mcp_screen_opened',
  'feedback_sent', 'pro_checkout_started', 'desk_opened',
];

// Counted on our server by the route itself (lib/counters.js SERVER_COUNTS), so not here:
// whatif_run, guess_played, feedback_sent. These are the client-only ones.
export const CLIENT_COUNTED = ['whatif_video', 'whatif_embed', 'whatif_share', 'guess_shared'];

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
export function goal(name, props, { win = globalThis.window, nav = globalThis.navigator, fetchImpl = globalThis.fetch } = {}) {
  const sent = { datafast: false, counted: false };
  if (!GOALS.includes(name)) return sent;
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
  if (CLIENT_COUNTED.includes(name) && typeof fetchImpl === 'function') {
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

// In a page (the terminal and the legal pages), load DataFast unless GPC says no.
if (typeof window !== 'undefined' && typeof document !== 'undefined') loadDataFast();
