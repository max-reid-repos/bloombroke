// Pro in the browser: the licence key, status, checkout, the key reveal, sync across
// devices and your own ticker tape. Pure helpers are exported for node:test; the parts
// that touch the network or storage only run in a browser.

import { INSTRUMENTS, resolveInstrument } from './instruments.js';
import { WATCH_KEY } from './watchlist.js';
import { PF_KEY } from './portfolio.js';

export const PRICE = '$4.20';
export const PRICE_LINE = '$4.20 a month';
export const PRO_ONLY = `Your own ticker tape is a Pro feature, ${PRICE_LINE}.`;
export const KEY_RE = /^BB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const HEADER = 'X-Pro-Key';
export const LS = { key: 'bb.pro.key', status: 'bb.pro.status', meta: 'bb.sync.meta', tape: 'bb.tape' };
export const PENDING_KEY = 'bb.pro.session';

// Synced documents: server name -> localStorage key. watch and pf are the WATCH and PF
// lists; tape is your own ticker tape.
export const SYNC_DOCS = { watch: WATCH_KEY, pf: PF_KEY, tape: 'bb.tape' };

export const MAX_TAPE = 40;
export const DEFAULT_TAPE = INSTRUMENTS.filter((i) => i.tape).map((i) => i.id);
const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// ---- keys ---------------------------------------------------------------------

// Mirrors the server: case, spaces and dashes do not matter.
export function normalizeKey(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  let s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length === 18 && s.startsWith('BB')) s = s.slice(2);
  if (!/^[A-HJ-NP-Z2-9]{16}$/.test(s)) return null;
  return `BB-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

// A pasted key on its own: BB-XXXX-XXXX-XXXX-XXXX in one piece, or four groups of four
// (with or without BB in front). Returns the key or null. The router only uses this when
// the first word is not a command, so WATCH ADD AAPL MSFT stays a command.
export function bareKey(toks) {
  if (!Array.isArray(toks) || !toks.length || toks.length > 5) return null;
  if (toks.length === 1) return normalizeKey(toks[0]);
  const groups = toks[0] === 'BB' ? toks.slice(1) : toks;
  if (groups.length !== 4 || groups.some((g) => g.length !== 4)) return null;
  return normalizeKey(groups.join(''));
}

// Words that could be the start of a key being typed: never sent to symbol search.
export function looksLikeKey(text) {
  const t = String(text || '').toUpperCase();
  return /^BB[-\s]/.test(t) || /^[A-Z2-9]{4}-[A-Z2-9]{1,4}/.test(t) || (t.match(/-/g) || []).length >= 2;
}

// A cached status is Pro while active, trialing, or past_due inside its grace period.
export function statusActive(st, now = Date.now()) {
  if (!st) return false;
  if (st.status === 'active' || st.status === 'trialing') return true;
  if (st.status === 'past_due' && st.graceUntil) return now < Date.parse(st.graceUntil);
  return false;
}

// ---- TAPE ---------------------------------------------------------------------------

// A symbol for the tape: a named instrument (GOLD, EURUSD) or a ticker. null otherwise.
export function tapeSymbol(tok) {
  const inst = resolveInstrument(tok);
  if (inst) return inst.id;
  const t = String(tok ?? '').toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

// TAPE | TAPE ADD <symbols> | TAPE REMOVE <symbols> | TAPE RESET
export function parseTape(args) {
  if (!args.length) return { action: 'show' };
  const [verb, ...rest] = args;
  const act = { ADD: 'add', REMOVE: 'remove', RM: 'remove', DEL: 'remove', DELETE: 'remove', RESET: 'reset', CLEAR: 'reset' }[verb];
  if (!act) return { error: 'usage' };
  if (act === 'reset') return rest.length ? { error: 'usage' } : { action: 'reset' };
  const syms = rest.filter((t) => t !== ',').flatMap((t) => t.split(',')).filter(Boolean);
  if (!syms.length) return { error: 'usage' };
  const out = [];
  for (const t of syms) {
    const s = tapeSymbol(t);
    if (!s) return { error: 'symbol', bad: t };
    if (!out.includes(s)) out.push(s);
  }
  return { action: act, symbols: out };
}

// The next tape for an action. null means the default tape.
export function applyTape(current, { action, symbols = [] }) {
  if (action === 'reset') return null;
  const list = [...(current || DEFAULT_TAPE)];
  if (action === 'add') {
    for (const s of symbols) if (!list.includes(s)) list.push(s);
    return list.slice(0, MAX_TAPE);
  }
  if (action === 'remove') return list.filter((s) => !symbols.includes(s));
  return current;
}

export function cleanTape(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const s of v) {
    const t = typeof s === 'string' ? tapeSymbol(s) : null;
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX_TAPE);
}

// Tape rows for a list of symbols, in order, from one /api/quotes call.
export async function loadTapeRows(symbols, fetchJSON) {
  if (!symbols.length) return [];
  const d = await fetchJSON(`/api/quotes?s=${encodeURIComponent(symbols.join(','))}`);
  const byId = new Map((d.quotes || []).map((q) => [q.ticker, q]));
  return symbols.map((s) => byId.get(s)).filter(Boolean)
    .map((q) => ({ ...q, id: q.ticker, name: q.label || q.ticker, decimals: q.decimals ?? 2 }));
}

// ---- sync planning (pure) ----------------------------------------------------------------
// meta: { name: { raw, updatedAt } }, raw being the localStorage string last synced.

// Remote documents that are newer than what this browser last synced.
export function planPull(meta, remote) {
  const out = [];
  for (const [name, doc] of Object.entries(remote || {})) {
    if (!SYNC_DOCS[name] || !doc || !Number.isFinite(doc.updatedAt)) continue;
    if (doc.updatedAt > (meta[name]?.updatedAt || 0)) out.push({ name, data: doc.data, updatedAt: doc.updatedAt });
  }
  return out;
}

// After a PUT: documents the server took are synced; for any it did not take (a tie or
// a newer copy there) the server copy wins and this browser adopts it, so a dropped
// write is never counted as pushed. reply: { docs, written }.
export function resolvePush(push, local, reply) {
  const written = new Set(reply?.written || []);
  const accepted = [];
  const adopt = [];
  for (const name of Object.keys(push)) {
    const srv = reply?.docs?.[name];
    if (written.has(name)) accepted.push({ name, raw: local[name] ?? null, updatedAt: srv?.updatedAt ?? push[name].updatedAt });
    else if (srv) adopt.push({ name, data: srv.data, updatedAt: srv.updatedAt });
    // Neither: leave it unsynced, the next round tries again.
  }
  return { accepted, adopt };
}

// Local documents that changed since the last sync. local: { name: raw string or null }.
export function planPush(meta, local, now) {
  const docs = {};
  for (const name of Object.keys(SYNC_DOCS)) {
    const raw = local[name] ?? null;
    const prev = meta[name];
    if (raw === (prev ? prev.raw : null)) continue;
    let data = null;
    if (raw !== null) {
      try { data = JSON.parse(raw); } catch { continue; }
    }
    docs[name] = { data, updatedAt: Math.max(now, (prev?.updatedAt || 0) + 1) };
  }
  return docs;
}

// ---- browser ---------------------------------------------------------------------------------

const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined';

const storage = {
  raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
  get(k, fb = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

export const getKey = () => normalizeKey(storage.get(LS.key, null) || '');
export const getStatus = () => storage.get(LS.status, null);
export const isPro = () => Boolean(getKey()) && statusActive(getStatus());
export function saveKey(key) { return storage.set(LS.key, key); }

// Your tape, or null for the default tape. Only Pro gets its own tape.
export function getTape() {
  if (!isPro()) return null;
  const t = cleanTape(storage.get(LS.tape, null));
  return t && t.length ? t : null;
}
export function getTapeRaw() { return cleanTape(storage.get(LS.tape, null)); }
export function setTape(list) {
  if (list === null) storage.del(LS.tape);
  else storage.set(LS.tape, list);
  if (hasWindow) window.dispatchEvent(new Event('bb:tape'));
  syncNow({ pull: false }).catch(() => {});
}

async function call(url, { method = 'GET', body, auth = true, keepalive = false } = {}) {
  const headers = { Accept: 'application/json' };
  const key = auth ? getKey() : null;
  if (key) headers[HEADER] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), keepalive, cache: 'no-store' });
  } catch {
    throw Object.assign(new Error('You look offline. Check your connection and try again.'), { code: 'network' });
  }
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
  if (!res.ok) throw Object.assign(new Error(data?.message || 'Something went wrong. Try again in a minute.'), { code: data?.error, status: res.status, body: data });
  return data;
}

// The session id from the Stripe success URL. Read when this module loads, then taken
// out of the address bar at once; kept for this tab until the key is saved.
export function withoutSessionId(search) {
  const p = new URLSearchParams(search || '');
  p.delete('session_id');
  const q = p.toString();
  return q ? `?${q}` : '';
}
let pendingSession = null;
function readPending() {
  if (!hasWindow) return;
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('session_id')) {
      const id = params.get('session_id');
      history.replaceState(history.state, '', location.pathname + withoutSessionId(location.search) + location.hash);
      if (id && /^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(id)) {
        pendingSession = id;
        try { sessionStorage.setItem(PENDING_KEY, id); } catch { /* this tab only */ }
        return;
      }
    }
  } catch { /* ignore */ }
  try { pendingSession = sessionStorage.getItem(PENDING_KEY); } catch { /* ignore */ }
}
readPending();

export const pendingCheckout = () => pendingSession;
export function clearPending() {
  pendingSession = null;
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

// Site config: { mode: 'live'|'test', open }. Asked once per page load.
let configPromise = null;
export function getConfig() {
  configPromise ||= call('/api/pro/config', { auth: false }).catch(() => { configPromise = null; return { mode: 'live', open: false }; });
  return configPromise;
}

// SUBSCRIBE, or REACTIVATE when this browser holds a key (the key goes along, so the new
// subscription joins the same licence).
export async function startCheckout() {
  const { url } = await call('/api/pro/checkout', { method: 'POST' });
  if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error('Checkout did not open. Try again in a minute.');
  location.assign(url);
}

export async function openPortal() {
  const { url } = await call('/api/pro/portal', { method: 'POST' });
  if (!/^https:\/\/billing\.stripe\.com\//.test(url)) throw new Error('Billing did not open. Try again in a minute.');
  location.assign(url);
}

function saveStatus(d) {
  const st = { active: Boolean(d.active), status: d.status, last4: d.last4, graceUntil: d.graceUntil || null, checked: Date.now() };
  storage.set(LS.status, st);
  return st;
}

// The success page: fetch the new key, save it, tell the server it is saved (so it drops
// its copy), start syncing. After REACTIVATE there is no new key, only a new status.
export async function claim(sessionId) {
  const d = await call('/api/pro/claim', { method: 'POST', body: { session_id: sessionId }, auth: false });
  if (d.reactivated) {
    saveStatus(d);
    syncNow().catch(() => {});
    startSync();
    return { ...d, saved: true };
  }
  const saved = saveKey(d.key) && getKey() === d.key;
  saveStatus(d);
  if (saved) call('/api/pro/claim/confirm', { method: 'POST', body: { session_id: sessionId } }).catch(() => {});
  syncNow().catch(() => {});
  startSync();
  return { ...d, saved };
}

export async function login(rawKey) {
  const key = normalizeKey(rawKey);
  if (!key) throw Object.assign(new Error('That does not look like a key. It looks like BB-XXXX-XXXX-XXXX-XXXX.'), { code: 'format' });
  const d = await call('/api/pro/login', { method: 'POST', body: { key }, auth: false });
  saveKey(key);
  storage.del(LS.meta); // a new device or account: the server copy wins on the first pull
  const st = saveStatus(d);
  if (st.active) await syncNow().catch(() => {});
  startSync();
  if (hasWindow) window.dispatchEvent(new Event('bb:tape'));
  return st;
}

export function logout() {
  storage.del(LS.key);
  storage.del(LS.status);
  storage.del(LS.meta);
  if (hasWindow) window.dispatchEvent(new Event('bb:tape'));
}

// Ask the server again. A key the server no longer knows is removed.
export async function refreshStatus() {
  if (!getKey()) return null;
  try {
    return saveStatus(await call('/api/pro/status'));
  } catch (err) {
    if (err.status === 401) logout();
    return getStatus();
  }
}

// ---- sync ------------------------------------------------------------------------------------

let syncing = null;

function localDocs() {
  return Object.fromEntries(Object.entries(SYNC_DOCS).map(([name, k]) => [name, storage.raw(k)]));
}

function applyPulls(meta, pulls) {
  const changed = [];
  for (const p of pulls) {
    const k = SYNC_DOCS[p.name];
    let raw = null;
    if (p.data === null || p.data === undefined) storage.del(k);
    else { raw = JSON.stringify(p.data); try { localStorage.setItem(k, raw); } catch { continue; } }
    meta[p.name] = { raw, updatedAt: p.updatedAt };
    changed.push(p.name);
  }
  return changed;
}

// Pull newer server copies, then push local changes. Last write wins, per document.
export function syncNow({ pull = true } = {}) {
  if (!getKey() || !isPro()) return Promise.resolve([]);
  if (syncing) return syncing;
  syncing = (async () => {
    const meta = storage.get(LS.meta, {}) || {};
    const changed = [];
    if (pull) {
      const r = await call('/api/pro/sync');
      changed.push(...applyPulls(meta, planPull(meta, r.docs)));
    }
    const local = localDocs();
    const push = planPush(meta, local, Date.now());
    if (Object.keys(push).length) {
      const r = await call('/api/pro/sync', { method: 'PUT', body: { docs: push } });
      const { accepted, adopt } = resolvePush(push, local, r);
      for (const a of accepted) meta[a.name] = { raw: a.raw, updatedAt: a.updatedAt };
      changed.push(...applyPulls(meta, adopt));
      changed.push(...applyPulls(meta, planPull(meta, r.docs)));
    }
    storage.set(LS.meta, meta);
    if (changed.length && hasWindow) {
      window.dispatchEvent(new CustomEvent('bb:synced', { detail: changed }));
      if (changed.includes('tape')) window.dispatchEvent(new Event('bb:tape'));
    }
    return changed;
  })().finally(() => { syncing = null; });
  return syncing;
}

// Push local changes every 20 seconds and pull again when the tab comes back.
let started = false;
export function startSync() {
  if (started || !hasWindow || !getKey()) return;
  started = true;
  let lastPull = Date.now();
  setInterval(() => { if (!document.hidden) syncNow({ pull: false }).catch(() => {}); }, 20_000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { syncNow({ pull: false }).catch(() => {}); return; }
    if (Date.now() - lastPull > 60_000) { lastPull = Date.now(); syncNow().catch(() => {}); }
  });
}

// On load: refresh the status, pull, then keep syncing.
function onLoad() {
  if (!getKey()) return;
  refreshStatus().then(() => syncNow()).catch(() => {});
  startSync();
}

if (hasWindow) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onLoad);
  else setTimeout(onLoad, 0);
}
