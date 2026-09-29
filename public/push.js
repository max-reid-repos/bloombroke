// PINGS in the browser (pro/push.js is the server): turning Web Push on and off on this
// device, the ping settings, the TEST ping, and the copy of the price alerts the server
// checks while the tab is closed. Lazy: ME loads it, LOGOUT loads it, and alerts.js loads
// it only while closed-tab alerts are on for this device. Never at startup.
//
// Pure parts (support, keys, the alert list the server gets) are exported for node:test.

import * as pro from './pro.js';

// true while this device gets closed-tab alerts: public/alerts.js reads the same name
// and leaves quote alerts to the server (no second notification from the tab).
export const ALERTS_FLAG = 'bb.push.alerts';
export const SIG_KEY = 'bb.push.sig'; // { sig, at }: the alert list the server has, and when it said so
export const ALERTS_KEY = 'bb.alerts'; // public/alerts.js
export const RECHECK_MS = 5 * 60 * 1000;
export const SW_URL = '/sw.js';

export const IOS_HINT = 'On iPhone, add Bloombroke to your Home Screen first.';
export const DENIED_HINT = 'Notifications are blocked for this site. Allow them in the browser\'s site settings, then try again.';
export const UNSUPPORTED_HINT = 'This browser cannot get notifications.';

// ---- pure ----------------------------------------------------------------------------------

// iPhone or iPad (an iPad says Macintosh, with touch).
export function isIos(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent || '');
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1);
}
// Opened from the Home Screen, as an app.
export function isStandalone(win = globalThis) {
  try { if (win.matchMedia?.('(display-mode: standalone)').matches) return true; } catch { /* old browser */ }
  return win.navigator?.standalone === true;
}

// What this browser can do: 'ok', 'ios' (iPhone or iPad, not on the Home Screen: Safari
// only allows pings to an installed web app), 'denied' (blocked for this site) or 'no'.
export function supportOf(win = globalThis) {
  const nav = win.navigator;
  if (isIos(nav) && !isStandalone(win)) return 'ios';
  if (!nav?.serviceWorker || !('PushManager' in win) || typeof win.Notification === 'undefined') return 'no';
  if (win.Notification.permission === 'denied') return 'denied';
  return 'ok';
}
export const hintOf = (support) => ({ ios: IOS_HINT, denied: DENIED_HINT, no: UNSUPPORTED_HINT }[support] || '');

// The VAPID public key (base64url) as the bytes pushManager.subscribe wants.
export function keyBytes(b64url) {
  const s = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const sameKey = (buf, b64url) => {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  const b = keyBytes(b64url);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

// The alert list the server gets: quote alerts only (a WEIRD gauge stays with the tab),
// the fields that matter to it, and a signature to send it only when it changed.
// Only what the server accepts (pro/push.js cleanServerAlerts), so one odd row never
// refuses the whole list.
const OK_ALERT = (a) => a && a.kind === 'quote' && typeof a.id === 'string' && /^[a-z0-9]{1,24}$/.test(a.id)
  && typeof a.sym === 'string' && /^[A-Z0-9.&/-]{1,16}$/.test(a.sym) && ['>', '<', '>=', '<='].includes(a.op)
  && typeof a.level === 'number' && Number.isFinite(a.level) && Math.abs(a.level) <= 1e12 && (a.state === 'waiting' || a.state === 'triggered');
export function serverAlerts(list) {
  return (Array.isArray(list) ? list : [])
    .filter(OK_ALERT)
    .slice(0, 20)
    .map((a) => ({
      id: a.id, sym: a.sym, op: a.op, level: a.level, dp: Number.isInteger(a.vdp) && a.vdp >= 0 && a.vdp <= 8 ? a.vdp : 2, state: a.state, rearmed: a.rearmed === true,
    }));
}
export const alertsSig = (alerts) => JSON.stringify(alerts);

// ---- storage and the server ------------------------------------------------------------------

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};
export function setAlertsFlag(on) {
  if (on) ls.set(ALERTS_FLAG, true);
  else { ls.del(ALERTS_FLAG); ls.del(SIG_KEY); }
}
export const alertsFlag = () => ls.get(ALERTS_FLAG, false) === true;

async function api(url, { method = 'GET', body, key = pro.getKey() } = {}) {
  const headers = { Accept: 'application/json' };
  if (key) headers[pro.HEADER] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw Object.assign(new Error('You look offline. Check your connection and try again.'), { code: 'network' });
  }
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
  if (!res.ok) throw Object.assign(new Error(data?.message || 'Something went wrong. Try again in a minute.'), { code: data?.error, status: res.status });
  return data;
}

// The site's public VAPID key, or null when pings are off here (ME then shows nothing).
export async function vapidKey() {
  try { return (await api('/api/push/key', { key: null }))?.key || null; } catch { return null; }
}

// This browser's subscription, or null.
export async function currentSub() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch { return null; }
}

// { prefs: { chat, alerts, show_text, devices }, device: this browser gets pings }.
export async function loadState() {
  const [prefs, sub] = await Promise.all([api('/api/push/prefs'), currentSub()]);
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  return { prefs, device: Boolean(sub) && granted, sub };
}

// Pings on for this browser: the service worker, the permission (asked here, after a
// click), the subscription, and the server told. Throws with .code 'denied' or 'no'.
export async function turnOnDevice(vapid) {
  if (typeof Notification === 'undefined' || !navigator.serviceWorker) throw Object.assign(new Error(UNSUPPORTED_HINT), { code: 'no' });
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw Object.assign(new Error(DENIED_HINT), { code: 'denied' });
  await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription for an older site key cannot be used any more.
  if (sub && !sameKey(sub.options?.applicationServerKey, vapid)) { try { await sub.unsubscribe(); } catch { /* gone */ } sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return sub;
}

// The same browser again (ME opened): the server may have dropped it (NEW KEY, 5 failed
// sends). Idempotent.
export async function resubscribe(sub) {
  if (sub) await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

// Pings off for this browser: the server forgets it, then the browser does.
export async function turnOffDevice({ key = pro.getKey() } = {}) {
  setAlertsFlag(false);
  const sub = await currentSub();
  if (!sub) return;
  try { if (key) await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint }, key }); } finally {
    try { await sub.unsubscribe(); } catch { /* already gone */ }
  }
}

export const setPrefs = (patch) => api('/api/push/prefs', { method: 'PUT', body: patch });
export const sendTest = () => api('/api/push/test', { method: 'POST' });

// LOGOUT on this browser: it stops getting this licence's pings.
export async function forgetDevice(key) {
  try { await turnOffDevice({ key }); } catch { /* the browser still unsubscribed */ }
}

// NEW KEY here: the server dropped every device, this one too. Subscribe it again on
// the new key when it had pings.
export async function afterNewKey() {
  const sub = await currentSub();
  if (!sub) return;
  try { await resubscribe(sub); } catch { setAlertsFlag(false); }
}

// The browser's alert list to the server, when closed-tab alerts are on for this device
// and the list changed (or the server was last asked over 5 minutes ago). The server's
// answer keeps the flag true: when it says no (pings off, another key, this device gone),
// the tab takes its alerts back.
let syncing = null;
let queued = null;
async function pushAlerts(list, { force = false, now = Date.now() } = {}) {
  if (!alertsFlag()) return false;
  if (!pro.getKey()) { setAlertsFlag(false); return false; }
  const alerts = serverAlerts(list);
  const sig = alertsSig(alerts);
  const last = ls.get(SIG_KEY, null);
  if (!force && last?.sig === sig && now - (Number(last.at) || 0) < RECHECK_MS) return true;
  const sub = await currentSub();
  if (!sub) { setAlertsFlag(false); return false; }
  try {
    const r = await api('/api/push/alerts', { method: 'PUT', body: { alerts, endpoint: sub.endpoint } });
    if (!r?.on) { setAlertsFlag(false); return false; }
    ls.set(SIG_KEY, { sig, at: now });
    return true;
  } catch (err) {
    // No key, no Pro, pings off here, or a list the server refused: the tab notifies again.
    if ([400, 401, 402, 404].includes(err.status)) setAlertsFlag(false);
    return false;
  }
}
// One at a time; a list that comes in meanwhile goes next.
export function syncAlerts(list = ls.get(ALERTS_KEY, []), opts = {}) {
  if (syncing) { queued = [list, opts]; return syncing; }
  syncing = pushAlerts(list, opts).finally(() => {
    syncing = null;
    if (queued) { const [l, o] = queued; queued = null; syncAlerts(l, o); }
  });
  return syncing;
}
