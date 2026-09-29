// Loading files by name: screens and their stylesheets come in on first use.
// The page carries a manifest (a JSON data block, id bb-assets, written by lib/assets.js)
// of each file's content hash, so a name like 'screens/whatif.js' becomes its hashed URL
// /screens/whatif.3f2a1b9c0d.js. Without a manifest (node:test, an older page) names
// resolve next to this file.
//
// A load that fails (most likely a deploy happened since this page opened: its hashed
// names are gone) reloads the page once, and the fresh page has today's names.

const ROOT = new URL('./', import.meta.url);
const manifest = readManifest();
const hashes = manifest?.files || null;
const deps = manifest?.deps || {};
const styles = manifest?.css || {};

// The stylesheets a module needs beyond the page's own (the sheet beside it, and beside
// each module it imports), in load order. None without a manifest: an older page has
// every stylesheet already.
export function stylesOf(js) {
  return styles[js] || [];
}

function readManifest() {
  if (typeof document === 'undefined') return null;
  try {
    const el = document.getElementById('bb-assets');
    return el ? JSON.parse(el.textContent) : null;
  } catch {
    return null;
  }
}

// 'screens/whatif.js' -> '/screens/whatif.3f2a1b9c0d.js' (or the plain path, unhashed).
export function assetUrl(rel) {
  const h = hashes?.[rel];
  if (h) return `/${rel.replace(/(\.[a-z0-9]+)$/i, `.${h}$1`)}`;
  return new URL(rel, ROOT).href;
}

// --- modules ------------------------------------------------------------------------

const pending = new Map(); // rel -> Promise<module>
const ready = new Map(); // rel -> module, once loaded

// The module, loaded once. Rejects if it cannot load (after asking for a reload).
// recover: false for an optional extra (HERE NOW, the chat badge, hints, TRENDING, the
// menu): it just rejects, and the page carries on without it, never reloading.
export function loadModule(rel, { recover: canRecover = true } = {}) {
  let p = pending.get(rel);
  if (!p) {
    p = import(assetUrl(rel)).then((m) => { ready.set(rel, m); return m; }, (err) => {
      pending.delete(rel);
      if (canRecover) recover(err);
      throw err;
    });
    pending.set(rel, p);
  }
  return p;
}

// The module if it is already loaded, else null: a screen seen before draws at once.
export function loadedModule(rel) {
  return ready.get(rel) || null;
}

// --- screens --------------------------------------------------------------------------

// A screen that loads on first use: its module's name, and (pick) the export that draws
// it when that is not the module itself: a name (screens/pro.js: 'loginCommand') or a
// function of the module. The router tables (commands*.js, app.js) hold these; app.js
// loads and draws them.
export function lazyScreen(js, pick = null) {
  return { js, pick };
}
const picked = (entry, m) => (typeof entry.pick === 'function' ? entry.pick(m) : entry.pick ? m[entry.pick] : m);

// The screen object ({ render }) if it can draw now: an eager screen, or a lazy one
// already loaded. Else null.
export function screenNow(entry) {
  if (!entry) return null;
  if (!entry.js) return entry;
  const m = ready.get(entry.js);
  return m ? picked(entry, m) : null;
}

// Load a lazy screen's module and stylesheets; resolves to its screen object.
export async function loadScreen(entry, styles = []) {
  if (!entry?.js) return entry;
  const [m] = await Promise.all([loadModule(entry.js), ...styles.map(loadCss)]);
  return picked(entry, m);
}

// --- stylesheets ----------------------------------------------------------------------

const sheets = new Map(); // rel -> Promise<void>
// The order the stylesheets had when they were one file: a sheet goes in before any
// later one already on the page, so the cascade is the same whatever loads first.
let order = [];
export function setStyleOrder(list) { order = list; }

// Put the stylesheet on the page once; resolves when it has loaded (or failed).
export function loadCss(rel) {
  if (typeof document === 'undefined' || !manifest) return Promise.resolve();
  let p = sheets.get(rel);
  if (p) return p;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = assetUrl(rel);
  link.dataset.sheet = rel;
  p = new Promise((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => { sheets.delete(rel); link.remove(); recover(new Error(`stylesheet ${rel}`)); resolve(); }, { once: true });
  });
  sheets.set(rel, p);
  const rank = order.indexOf(rel);
  const later = rank < 0 ? null : [...document.querySelectorAll('link[data-sheet]')].find((l) => order.indexOf(l.dataset.sheet) > rank);
  if (later) later.before(link); else document.head.append(link);
  return p;
}

// Is the stylesheet on the page and loaded?
export function cssReady(rel) {
  return typeof document === 'undefined' || !manifest || Boolean(document.querySelector(`link[data-sheet="${rel}"]`)?.sheet);
}

// --- prefetch -------------------------------------------------------------------------

const hinted = new Set();
// Fetch ahead without running: modulepreload for a module and the modules it imports
// (the manifest lists them), prefetch for a stylesheet.
export function prefetch(rel) {
  if (typeof document === 'undefined' || hinted.has(rel) || ready.has(rel) || sheets.has(rel)) return;
  hinted.add(rel);
  const link = document.createElement('link');
  // A stylesheet: prefetch (idle, low priority, no "preloaded but not used" warning).
  link.rel = rel.endsWith('.css') ? 'prefetch' : 'modulepreload';
  link.href = assetUrl(rel);
  document.head.append(link);
  for (const d of deps[rel] || []) prefetch(d);
}

// --- recovery ---------------------------------------------------------------------------

const RELOAD_KEY = 'bb.reloadedAt';
let reloading = false;
let beforeReload = null;
// fn runs just before that reload (app.js keeps the command that was cut off).
export function onReload(fn) { beforeReload = fn; }
// Once per minute at most: reload the page so it gets today's file names. The address
// bar already holds the command, so the fresh page opens the same screen.
function recover(err) {
  if (typeof window === 'undefined' || reloading) return;
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* no storage: no reload loop guard, so no reload */ return; }
  if (Date.now() - last < 60_000) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // offline: reloading will not help
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { return; }
  reloading = true;
  try { beforeReload?.(); } catch { /* the reload still helps */ }
  console.warn('[bb] reloading for a newer build:', err?.message || err);
  window.location.reload();
}
