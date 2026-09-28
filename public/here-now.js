// N HERE NOW by the New York clock: visitors in the last 10 minutes, from GET /api/live
// (DataFast realtime, kept a minute on the server). Asked again every minute while the tab
// is visible. Hidden when the number is unknown or 0, and on phones under 380 px (CSS).
// Totals only: the server never sends anything about a visitor.

export const HERE_MS = 60_000;

// 7 -> '7 HERE NOW'. Unknown, 0 or nonsense: '' (the token hides).
export function hereText(n) {
  return Number.isInteger(n) && n > 0 ? `${n.toLocaleString('en-US')} HERE NOW` : '';
}

// Paint the token: '7 HERE NOW' ('7 HERE' on a phone: CSS hides the NOW). fits: whether it
// has room (it never sits on the name at the left); no room, hidden.
export function paintHere(el, n, { fits = () => true } = {}) {
  if (!el) return;
  const t = hereText(n);
  if (t) el.innerHTML = `${t.replace(/ HERE NOW$/, '')} HERE<span class="here-x"> NOW</span>`;
  else el.textContent = '';
  if (t) el.title = `${t.toLowerCase()}: visitors in the last 10 minutes`;
  el.hidden = !t;
  if (t && !fits(el)) el.hidden = true;
}

// Room for the token: its left edge clear of the name, the seat and anything else at the
// left of the top bar.
export function clearOfBrand(el, gap = 8) {
  const brand = el?.ownerDocument?.querySelector?.('.brand');
  if (!brand) return true;
  const right = Math.max(...[...brand.children].filter((c) => !c.hidden).map((c) => c.getBoundingClientRect().right), -Infinity);
  return el.getBoundingClientRect().left >= right + gap;
}

// Returns stop(). timer: the shell's liveTimer (skips while hidden, catches up when shown);
// fetchImpl, isHidden and every are for the tests.
export function mountHereNow(el, { fetchImpl = globalThis.fetch, isHidden = () => globalThis.document?.hidden, every = HERE_MS, timer = null, fits = clearOfBrand, win = globalThis.window } = {}) {
  if (!el || typeof fetchImpl !== 'function') return () => {};
  let busy = false;
  let last = null;
  const paint = (n) => { last = n; paintHere(el, n, { fits }); };
  // A narrower window may leave no room (or give it back).
  const onResize = () => paintHere(el, last, { fits });
  win?.addEventListener?.('resize', onResize);
  const load = () => {
    if (busy || isHidden()) return;
    busy = true;
    Promise.resolve()
      .then(() => fetchImpl('/api/live', { headers: { Accept: 'application/json' } }))
      .then((r) => (r?.ok ? r.json() : null))
      .then((d) => paint(d?.here), () => paint(null))
      .finally(() => { busy = false; });
  };
  load();
  const stop = timer ? timer(load, every) : ((id) => () => clearInterval(id))(setInterval(load, every));
  return () => { stop(); win?.removeEventListener?.('resize', onResize); };
}
