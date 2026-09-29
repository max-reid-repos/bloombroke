// PINGS, the browser: ME's PINGS row and + Details part (public/screens/me.js), what the
// browser can do (public/push.js), the alert list the server gets and its sync, the
// service worker's three handlers (public/sw.js, with a fake self), the in-tab ALERTS
// watcher standing down for quote alerts the server pings (public/alerts.js), the PRO
// row, and the startup bundle (nothing added to it). Every key below is an obvious fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { meHtml, deviceHtml, pingsHtml, keyDataHtml, PING_HINTS, PING_ROWS } from '../public/screens/me.js';
import { cardWords } from '../public/kit.js';
import {
  supportOf, hintOf, isIos, isStandalone, keyBytes, serverAlerts, alertsSig, syncAlerts, switchKey, ALERTS_FLAG, SIG_KEY, IOS_HINT, DENIED_HINT, UNSUPPORTED_HINT,
} from '../public/push.js';
import { topLine, PUSH_LINE, PUSH_FLAG } from '../public/screens/alerts.js';
import { HONEST_LINE } from '../public/alerts.js';
import { pingsFollowKey } from '../public/screens/pro.js';
import { startAlerts, ALERTS_KEY } from '../public/alerts.js';
import { PRO_ROWS, LIVE, shownRows } from '../public/screens/pro.js';
import { buildAssets, serveAssets } from '../lib/assets.js';

const all = () => true;
const KEY = ['BB', '7KQ2', 'M9XD', 'HT4P', 'WZ3C'].join('-'); // a fake licence key, built so no scanner reads it as a secret
const ST = { status: 'active', seat: 12, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
const ME = { seat: 2, username: 'Abcdefghijklmno', color: 3, avatar: null };
const PINGS = { device: false, prefs: { chat: false, alerts: false, show_text: false }, support: 'ok', hint: '' };
const above = (html) => html.split('<details')[0];

// ---- ME ----------------------------------------------------------------------------------------

test('ME: nothing about pings without the site key (pings off here) or without Pro', () => {
  const html = meHtml({ key: KEY, st: { ...ST, seat: 2 }, me: ME, has: all });
  assert.doesNotMatch(html, /PINGS|data-ping=|data-pref="pings"|me-ping-/);
  assert.match(html, /<div id="me-pings-box"><\/div>/, 'an empty box for when the key comes');
  const notPro = meHtml({ key: KEY, st: { ...ST, status: 'canceled' }, pings: PINGS, has: all });
  assert.doesNotMatch(notPro, /PINGS|data-ping=|me-ping-/, 'Pro only');
  assert.doesNotMatch(meHtml({ pings: PINGS, has: all }), /PINGS/, 'a visitor');
});

test('ME with pings: one PINGS row in THIS DEVICE; the three settings, TEST and the words in + Details; the word budget holds', () => {
  const html = meHtml({ key: KEY, st: { ...ST, seat: 2 }, me: ME, tape: true, pings: PINGS, has: all });
  const top = above(html);
  assert.match(top, /<span class="tag">PINGS<\/span><button type="button" class="chip me-pref" data-pref="pings" aria-pressed="false">OFF<\/button>/);
  assert.doesNotMatch(top, /CHAT MESSAGES|SHOW MESSAGE TEXT|ALERTS WHEN/, 'the settings are in + Details');
  const details = html.slice(html.indexOf('<details'));
  for (const [label, k] of [['CHAT MESSAGES', 'chat'], ['ALERTS WHEN THE TAB IS CLOSED', 'alerts'], ['SHOW MESSAGE TEXT', 'show_text']]) {
    assert.match(details, new RegExp(`<span class="tag">${label}</span><button type="button" class="chip me-ping" data-ping="${k}" aria-pressed="false">OFF</button>`), label);
  }
  assert.match(details, /id="me-ping-test">TEST</);
  assert.ok(details.indexOf('PINGS') < details.indexOf('KEY AND DATA'), 'PINGS first in + Details');
  for (const [k] of PING_ROWS) assert.ok(details.includes(k), k);
  assert.match(details, /id="me-ping-hint" role="status" hidden>/);
  // The budget of the ME page (test/layout-rules.test.js: 30 words above + Details).
  const w = cardWords(html);
  assert.ok(w.length <= 30, `${w.length} words: ${w.join(' ')}`);
  // On: pressed, and the settings say ON.
  const on = meHtml({ key: KEY, st: { ...ST, seat: 2 }, me: ME, pings: { ...PINGS, device: true, prefs: { chat: true, alerts: true, show_text: false } }, has: all });
  assert.match(on, /data-pref="pings" aria-pressed="true">ON</);
  assert.match(on, /data-ping="chat" aria-pressed="true">ON</);
  assert.match(on, /data-ping="show_text" aria-pressed="false">OFF</);
});

test('ME hints: iPhone not on the Home Screen, notifications blocked, a browser without push', () => {
  assert.deepEqual(PING_HINTS, { ios: IOS_HINT, denied: DENIED_HINT, no: UNSUPPORTED_HINT });
  assert.equal(IOS_HINT, 'On iPhone, add Bloombroke to your Home Screen first.');
  assert.match(pingsHtml({ ...PINGS, support: 'ios' }), /<p class="me-ping-hint" id="me-ping-hint" role="status">On iPhone, add Bloombroke to your Home Screen first\.<\/p>/);
  assert.match(pingsHtml({ ...PINGS, support: 'denied' }), /Notifications are blocked for this site\. Allow them in the browser&#39;s site settings, then try again\./);
  assert.match(pingsHtml({ ...PINGS, support: 'no' }), /This browser cannot get notifications\./);
  assert.equal(hintOf('ok'), '');
  // Plain words: no em dash, no emoji.
  for (const t of [IOS_HINT, DENIED_HINT, UNSUPPORTED_HINT, ...PING_ROWS.flat()]) {
    assert.doesNotMatch(t, /—/);
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u);
  }
  assert.match(keyDataHtml({ pings: PINGS }), /^<div id="me-pings-box"><p class="tag me-dk">PINGS<\/p>/);
  assert.doesNotMatch(deviceHtml({ pro: true, pings: null }), /pings/);
});

test('support: iPhone and iPad need the Home Screen; blocked; no push at all', () => {
  const win = (ua, { standalone = false, perm = 'default', sw = true, push = true, touch = 0 } = {}) => {
    const w = {
      navigator: { userAgent: ua, maxTouchPoints: touch, standalone, ...(sw ? { serviceWorker: {} } : {}) },
      matchMedia: () => ({ matches: false }),
      Notification: { permission: perm },
    };
    if (push) w.PushManager = function PushManager() {};
    return w;
  };
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
  const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
  assert.equal(supportOf(win(IPHONE)), 'ios');
  assert.equal(supportOf(win(IPHONE, { standalone: true })), 'ok', 'installed on the Home Screen');
  assert.equal(supportOf(win(IPAD, { touch: 5 })), 'ios', 'an iPad says Macintosh, with touch');
  assert.equal(supportOf(win(IPAD)), 'ok', 'a Mac');
  assert.equal(supportOf(win(CHROME, { perm: 'denied' })), 'denied');
  assert.equal(supportOf(win(CHROME, { sw: false })), 'no');
  assert.equal(supportOf(win(CHROME, { push: false })), 'no');
  assert.equal(supportOf(win(CHROME, { perm: 'granted' })), 'ok');
  assert.equal(isIos({ userAgent: CHROME }), false);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: true }), navigator: {} }), true);
});

test('keys and the alert list the server gets: quote alerts only, the fields it needs', () => {
  const k = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]); // fake
  assert.deepEqual([...keyBytes(k.toString('base64url'))], [...k]);
  const list = [
    { id: 'a1', kind: 'quote', sym: 'AAPL', op: '>', level: 350, dp: 2, vdp: 2, state: 'waiting', seen: true, last: 340, name: 'Apple' },
    { id: 'a2', kind: 'gauge', sym: 'CANAL', gauge: 'canal', op: '<', level: 5, state: 'waiting' },
    { id: 'a3', kind: 'quote', sym: 'US10Y', op: '<=', level: 4.25, dp: 3, vdp: 3, state: 'triggered', rearmed: false },
  ];
  const out = serverAlerts(list);
  assert.deepEqual(out, [
    { id: 'a1', sym: 'AAPL', op: '>', level: 350, dp: 2, state: 'waiting', rearmed: false },
    { id: 'a3', sym: 'US10Y', op: '<=', level: 4.25, dp: 3, state: 'triggered', rearmed: false },
  ]);
  assert.equal(alertsSig(out), alertsSig(serverAlerts(list.map((a) => ({ ...a, last: 1, lastAt: 2 })))), 'a new price is no change for the server');
  assert.notEqual(alertsSig(out), alertsSig(serverAlerts([{ ...list[0], state: 'triggered' }])));
  // Rows the server would refuse are left out, so the rest still goes.
  const odd = [{ ...list[0], id: 'BAD ID' }, { ...list[0], id: 'b2', level: NaN }, { ...list[0], id: 'b3', op: '=' }, { ...list[0], id: 'b4', sym: 'x y' }, { ...list[0], id: 'b5', state: 'fired' }, { ...list[0], id: 'b6', vdp: 12 }];
  assert.deepEqual(serverAlerts(odd).map((a) => [a.id, a.dp]), [['b6', 2]]);
});

// A browser for the module: localStorage, a registration with a subscription, fetch.
function fakeBrowser({ flag = true, key = KEY, endpoint = 'https://fcm.googleapis.com/fcm/send/fake', answer = { ok: true, on: true }, status = 200 } = {}) {
  const store = new Map();
  if (flag) store.set(ALERTS_FLAG, 'true');
  if (key) store.set('bb.pro.key', JSON.stringify(key));
  const calls = [];
  const saved = {};
  for (const k of ['localStorage', 'navigator', 'fetch']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set('localStorage', { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  set('navigator', { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => (endpoint ? { endpoint } : null) } }) } });
  set('fetch', async (url, opts) => {
    calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    return { ok: status < 300, status, json: async () => answer };
  });
  return {
    store, calls,
    restore() { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } },
  };
}

test('alert sync: sent when the list changes, not for a new price; the server saying no hands the alerts back to the tab', async () => {
  const quote = { id: 'a1', kind: 'quote', sym: 'AAPL', op: '>', level: 350, vdp: 2, state: 'waiting' };
  let b = fakeBrowser({ answer: { ok: true, on: true, armed: ['a1'], fired: [] } });
  try {
    assert.equal(await syncAlerts([quote], { now: 1000 }), true);
    assert.equal(b.calls.length, 1);
    assert.deepEqual(JSON.parse(b.store.get(SIG_KEY)).armed, ['a1'], 'what the server pings, for the stand-down');
    assert.equal(JSON.parse(b.store.get(SIG_KEY)).at, 1000);
    assert.equal(b.calls[0].url, '/api/push/alerts');
    assert.equal(b.calls[0].method, 'PUT');
    assert.equal(b.calls[0].headers['X-Pro-Key'], KEY);
    assert.deepEqual(b.calls[0].body, { alerts: [{ id: 'a1', sym: 'AAPL', op: '>', level: 350, dp: 2, state: 'waiting', rearmed: false }], endpoint: 'https://fcm.googleapis.com/fcm/send/fake' });
    assert.equal(await syncAlerts([{ ...quote, last: 349, lastAt: 5 }], { now: 2000 }), true);
    assert.equal(b.calls.length, 1, 'the same list: not sent again');
    await syncAlerts([{ ...quote, state: 'triggered' }], { now: 3000 });
    assert.equal(b.calls.length, 2, 'a change goes');
    await syncAlerts([{ ...quote, state: 'triggered' }], { now: 3000 + 5 * 60 * 1000 });
    assert.equal(b.calls.length, 3, 'asked again after 5 minutes, so the flag stays true');
  } finally { b.restore(); }
  // The server fired a1 while the tab was not looking: TRIGGERED here, and that list goes next.
  b = fakeBrowser({ answer: { ok: true, on: true, armed: [], fired: ['a1'] } });
  try {
    b.store.set('bb.alerts', JSON.stringify([quote]));
    assert.equal(await syncAlerts([quote], { now: 5000 }), true);
    const after = JSON.parse(b.store.get('bb.alerts'));
    assert.equal(after[0].state, 'triggered');
    assert.equal(after[0].firedAt, 5000);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(b.calls.length, 2, 'the TRIGGERED list is sent at once');
    assert.equal(b.calls[1].body.alerts[0].state, 'triggered');
  } finally { b.restore(); }
  b = fakeBrowser({ answer: { ok: true, on: false } });
  try {
    assert.equal(await syncAlerts([quote], { now: 1 }), false);
    assert.equal(b.store.has(ALERTS_FLAG), false, 'the server does not ping: the tab notifies again');
    assert.equal(b.store.has(SIG_KEY), false);
  } finally { b.restore(); }
  b = fakeBrowser({ status: 401, answer: { error: 'bad_key' } });
  try {
    await syncAlerts([quote], { now: 1 });
    assert.equal(b.store.has(ALERTS_FLAG), false, 'another key (NEW KEY elsewhere): off');
  } finally { b.restore(); }
  b = fakeBrowser({ endpoint: null });
  try {
    await syncAlerts([quote], { now: 1 });
    assert.equal(b.calls.length, 0);
    assert.equal(b.store.has(ALERTS_FLAG), false, 'no subscription in this browser: off');
  } finally { b.restore(); }
  b = fakeBrowser({ flag: false });
  try {
    assert.equal(await syncAlerts([quote], { now: 1 }), false);
    assert.equal(b.calls.length, 0, 'closed-tab alerts off: nothing leaves the browser');
  } finally { b.restore(); }
});

test('ALERTS top line: says the device is pinged while closed-tab alerts are on here; one line', () => {
  const store = (v) => ({ get: (k, d) => (k === PUSH_FLAG && v !== undefined ? v : d) });
  assert.equal(topLine(store(true)), 'Alerts also ping this device when the tab is closed.');
  assert.equal(PUSH_LINE, 'Alerts also ping this device when the tab is closed.');
  assert.equal(topLine(store(undefined)), HONEST_LINE);
  assert.equal(topLine(store(false)), HONEST_LINE);
  assert.equal(PUSH_FLAG, ALERTS_FLAG, 'the flag ME and push.js set');
  assert.ok(PUSH_LINE.length <= 60);
});

// LOGIN with another key: a browser with a subscription and per-URL server answers.
function switchBrowser({ prefs = { chat: true, alerts: true, show_text: false }, prefsStatus = 200, sub = true } = {}) {
  const b = fakeBrowser({ flag: true, key: 'BB-NEWK-EYAB-CDEF-GHJK' });
  const s = { endpoint: 'https://fcm.googleapis.com/fcm/send/fake', gone: false, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'P', auth: 'A' } }; }, async unsubscribe() { this.gone = true; return true; } };
  globalThis.navigator = { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => (sub ? s : null) } }) } };
  globalThis.fetch = async (url, opts) => {
    b.calls.push({ url, method: opts.method, key: opts.headers['X-Pro-Key'], body: opts.body ? JSON.parse(opts.body) : null });
    const status = url === '/api/push/prefs' ? prefsStatus : 200;
    const body = url === '/api/push/prefs' ? prefs : url === '/api/push/alerts' ? { ok: true, on: true } : { ok: true };
    return { ok: status < 300, status, json: async () => body };
  };
  return { ...b, sub: s };
}

test('LOGIN with another key: the old key lets the browser go; the new key takes it when its pings are on', async () => {
  let b = switchBrowser();
  try {
    assert.equal(await switchKey('BB-OLDK-EYAB-CDEF-GHJK', 'BB-NEWK-EYAB-CDEF-GHJK'), true);
    const calls = b.calls.map((c) => `${c.method} ${c.url} ${c.key}`);
    assert.deepEqual(calls.slice(0, 3), ['POST /api/push/unsubscribe BB-OLDK-EYAB-CDEF-GHJK', 'GET /api/push/prefs BB-NEWK-EYAB-CDEF-GHJK', 'POST /api/push/subscribe BB-NEWK-EYAB-CDEF-GHJK']);
    assert.equal(b.calls[0].body.endpoint, 'https://fcm.googleapis.com/fcm/send/fake');
    assert.equal(b.sub.gone, false);
    assert.equal(b.store.get(ALERTS_FLAG), 'true', 'the new key has closed-tab alerts on');
  } finally { b.restore(); }
  b = switchBrowser({ prefs: { chat: false, alerts: false, show_text: false } });
  try {
    assert.equal(await switchKey('BB-OLDK-EYAB-CDEF-GHJK', 'BB-NEWK-EYAB-CDEF-GHJK'), false);
    assert.ok(!b.calls.some((c) => c.url === '/api/push/subscribe'), 'not subscribed for a key with pings off');
    assert.equal(b.sub.gone, true, 'the browser unsubscribes');
    assert.equal(b.store.has(ALERTS_FLAG), false, 'the tab notifies again');
  } finally { b.restore(); }
  b = switchBrowser({ prefsStatus: 402 });
  try {
    assert.equal(await switchKey('BB-OLDK-EYAB-CDEF-GHJK', 'BB-NEWK-EYAB-CDEF-GHJK'), false);
    assert.equal(b.sub.gone, true, 'no Pro on the new key: unsubscribed');
  } finally { b.restore(); }
  b = switchBrowser({ sub: false });
  try {
    assert.equal(await switchKey('BB-OLDK-EYAB-CDEF-GHJK', 'BB-NEWK-EYAB-CDEF-GHJK'), false);
    assert.equal(b.calls.length, 0, 'no pings on this browser: nothing to do');
  } finally { b.restore(); }
  // The LOGIN screen's hook: only a real change of key, only where pings can be.
  const load = async () => ({ switchKey: async () => true });
  const nav = { serviceWorker: {} };
  assert.equal(await pingsFollowKey(null, 'BB-NEWK-EYAB-CDEF-GHJK', { nav, load }), false, 'no key before');
  assert.equal(await pingsFollowKey('BB-SAME-EYAB-CDEF-GHJK', 'BB-SAME-EYAB-CDEF-GHJK', { nav, load }), false, 'the same key');
  assert.equal(await pingsFollowKey('BB-OLDK-EYAB-CDEF-GHJK', 'BB-NEWK-EYAB-CDEF-GHJK', { nav: {}, load }), false, 'no service worker');
  assert.equal(await pingsFollowKey('BB-OLDK-EYAB-CDEF-GHJK', 'BB-NEWK-EYAB-CDEF-GHJK', { nav, load }), true);
  const slow = async () => ({ switchKey: () => new Promise(() => {}) });
  assert.equal(await pingsFollowKey('BB-OLDK-EYAB-CDEF-GHJK', 'BB-NEWK-EYAB-CDEF-GHJK', { nav, load: slow, waitMs: 20 }), false, 'never holds LOGIN more than a moment');
  assert.match(readFileSync('public/screens/pro.js', 'utf8'), /const old = pro\.getKey\(\); \/\/ PINGS[^\n]*\n  pro\.login\(key\)\.then\(async \(st\) => \{\n    await pingsFollowKey\(old\);/);
});

// ---- the in-tab watcher stands down ------------------------------------------------------------------

async function runWatcher({ flag, sig = null }) {
  const made = [];
  const saved = {};
  for (const k of ['window', 'document', 'Notification', 'setInterval', 'localStorage']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set('window', new EventTarget());
  set('document', Object.assign(new EventTarget(), { hidden: false }));
  set('Notification', class { constructor(title, opts) { made.push({ title, ...opts }); } static permission = 'granted'; });
  set('setInterval', () => 0);
  set('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  const data = new Map();
  data.set(ALERTS_KEY, [
    { id: 'q1', kind: 'quote', sym: 'AAPL', op: '>', level: 350, state: 'waiting' },
    { id: 'g1', kind: 'gauge', sym: 'CANAL', gauge: 'canal', op: '<', level: 5, state: 'waiting' },
  ]);
  if (flag) data.set('bb.push.alerts', true);
  if (sig) data.set('bb.push.sig', sig);
  const store = { get: (k, d) => (data.has(k) ? data.get(k) : d), set: (k, v) => data.set(k, v) };
  const statuses = [];
  try {
    startAlerts({
      store,
      fetchJSON: async (url) => (url.startsWith('/api/quotes') ? { quotes: [{ ticker: 'AAPL', last: 351 }] } : { gauges: [{ id: 'canal', ok: true, value: 4 }] }),
      status: (t) => statuses.push(t),
      run() {},
      statusline: null,
    });
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
  return { made, statuses, list: data.get(ALERTS_KEY) };
}

test('ALERTS stand-down: only for alerts the server said it pings, in a sync under 2 minutes old; a gauge alert stays with the tab', async () => {
  const off = await runWatcher({ flag: false });
  assert.deepEqual(off.made.map((n) => n.tag).sort(), ['bb-alert-g1', 'bb-alert-q1'], 'pings off: the tab notifies both, as today');
  const on = await runWatcher({ flag: true, sig: { sig: 'x', at: Date.now() - 30_000, armed: ['q1'] } });
  assert.deepEqual(on.made.map((n) => n.tag), ['bb-alert-g1'], 'pings on: the server pings AAPL; the tab still notifies the gauge');
  const stale = await runWatcher({ flag: true, sig: { sig: 'x', at: Date.now() - 3 * 60_000, armed: ['q1'] } });
  assert.deepEqual(stale.made.map((n) => n.tag).sort(), ['bb-alert-g1', 'bb-alert-q1'], 'the last sync is over 2 minutes old: the tab notifies');
  const notArmed = await runWatcher({ flag: true, sig: { sig: 'x', at: Date.now(), armed: [] } });
  assert.deepEqual(notArmed.made.map((n) => n.tag).sort(), ['bb-alert-g1', 'bb-alert-q1'], 'the server did not say it pings q1: the tab notifies');
  const noSync = await runWatcher({ flag: true });
  assert.equal(noSync.made.length, 2, 'the flag alone, no sync yet: the tab notifies');
  assert.equal(on.statuses.length, 2, 'both still show in the status line');
  assert.ok(on.list.every((a) => a.state === 'triggered'), 'and turn TRIGGERED on the ALERTS screen');
  // The ping uses the same tag as the tab's notification (bb-alert-<id>): one replaces the other.
  assert.match(readFileSync('pro/push-send.js', 'utf8'), /g: `bb-alert-\$\{row\.client_id\}`/);
});

test('ALERTS on tab start: with pings on, one sync first; an alert the server already fired turns TRIGGERED and the tab does not notify it again', async () => {
  const run = async ({ flag, hang = false, wait = 60, peekAt = 0 }) => {
    let peek = null;
    const data = new Map();
    const made = [];
    const puts = [];
    const saved = {};
    for (const k of ['window', 'document', 'Notification', 'setInterval', 'localStorage', 'navigator', 'fetch']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    set('window', new EventTarget());
    set('document', Object.assign(new EventTarget(), { hidden: false }));
    set('Notification', class { constructor(title, opts) { made.push(opts.tag); } static permission = 'granted'; });
    set('setInterval', () => 0);
    set('localStorage', { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) });
    set('navigator', { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/fake' }) } }) } });
    set('fetch', async (url, opts) => { puts.push(url); if (hang) await new Promise(() => {}); return { ok: true, status: 200, json: async () => ({ ok: true, on: true, armed: [], fired: ['q1'] }) }; });
    const store = { get: (k, d) => { const v = data.get(k); return v ? JSON.parse(v) : d; }, set: (k, v) => data.set(k, JSON.stringify(v)) };
    store.set(ALERTS_KEY, [{ id: 'q1', kind: 'quote', sym: 'AAPL', op: '>', level: 350, state: 'waiting' }]);
    store.set('bb.pro.key', KEY);
    if (flag) store.set(ALERTS_FLAG, true);
    try {
      startAlerts({ store, fetchJSON: async () => ({ quotes: [{ ticker: 'AAPL', last: 351 }] }), status() {}, run() {}, statusline: null });
      if (peekAt) setTimeout(() => { peek = [...made]; }, peekAt);
      await new Promise((r) => setTimeout(r, wait));
    } finally {
      for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    }
    return { made, puts, peek, list: store.get(ALERTS_KEY, []) };
  };
  const off = await run({ flag: false });
  assert.deepEqual(off.made, ['bb-alert-q1'], 'pings off: the tab notifies, as today');
  const on = await run({ flag: true });
  assert.equal(on.puts[0], '/api/push/alerts', 'the sync went first');
  assert.deepEqual(on.made, [], 'the server fired it already: no second notification from the tab');
  assert.equal(on.list[0].state, 'triggered');
  // A sync that never answers holds the first check 5 seconds at most.
  const hung = await run({ flag: true, hang: true, wait: 5400, peekAt: 1000 });
  assert.deepEqual(hung.peek, [], 'still waiting on the sync after 1 s');
  assert.deepEqual(hung.made, ['bb-alert-q1'], 'after 5 s the tab checks and notifies by itself');
});

// ---- the service worker -----------------------------------------------------------------------------------

function loadSw({ clients = [], origin = 'https://bloombroke.com', fetchImpl = null } = {}) {
  const handlers = {};
  const shown = [];
  const opened = [];
  const subscribed = [];
  const self = {
    location: { origin },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    registration: {
      showNotification: async (title, opts) => { shown.push({ title, ...opts }); },
      pushManager: { subscribe: async (o) => { subscribed.push(o); return { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'P', auth: 'A' } }) }; } },
    },
    clients: { matchAll: async () => clients, openWindow: async (u) => { opened.push(u); } },
  };
  const posted = [];
  const fetchFn = fetchImpl || (async (url, opts) => { posted.push({ url, body: opts?.body ? JSON.parse(opts.body) : null }); return { ok: true, json: async () => ({ key: Buffer.alloc(65, 4).toString('base64url') }) }; });
  const code = readFileSync(path.join(import.meta.dirname, '..', 'public', 'sw.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('self', 'fetch', 'atob', code)(self, fetchFn, (s) => Buffer.from(s, 'base64').toString('binary'));
  const fire = async (type, ev) => {
    let p = null;
    handlers[type]({ ...ev, waitUntil: (x) => { p = x; } });
    await p;
  };
  return { handlers, shown, opened, subscribed, posted, fire };
}

test('sw.js: only push, notificationclick and pushsubscriptionchange; no fetch handler, no cache', () => {
  const sw = loadSw();
  assert.deepEqual(Object.keys(sw.handlers).sort(), ['notificationclick', 'push', 'pushsubscriptionchange']);
  const code = readFileSync('public/sw.js', 'utf8');
  assert.doesNotMatch(code, /addEventListener\('fetch'|caches\.|importScripts/);
});

test('sw.js push: the title, body, tag and url of the ping; a url off this site goes home; a broken payload still shows', async () => {
  const sw = loadSw();
  await sw.fire('push', { data: { json: () => ({ t: 'AAPL above 350', b: 'AAPL 351.20 · above your 350', u: '/?c=AAPL', g: 'bb-alert-x1' }) } });
  assert.deepEqual(sw.shown[0], {
    title: 'AAPL above 350', body: 'AAPL 351.20 · above your 350', icon: '/icon-192.png', badge: '/icon-192.png', data: { u: 'https://bloombroke.com/?c=AAPL' }, tag: 'bb-alert-x1', renotify: true,
  });
  await sw.fire('push', { data: { json: () => ({ t: 'x', u: 'https://evil.example/phish' }) } });
  assert.equal(sw.shown[1].data.u, 'https://bloombroke.com/');
  await sw.fire('push', { data: { json: () => { throw new Error('not JSON'); } } });
  assert.equal(sw.shown[2].title, 'Bloombroke');
  assert.equal(sw.shown[2].tag, undefined);
  await sw.fire('push', { data: null });
  assert.equal(sw.shown.length, 4, 'every push shows a notification (userVisibleOnly)');
});

test('sw.js click: focus a tab on that page; else take a tab there; else open a window', async () => {
  const tab = (url, { navigateFails = false } = {}) => {
    const t = { url, focused: 0, went: null };
    t.focus = async () => { t.focused += 1; return t; };
    t.navigate = async (u) => { if (navigateFails) throw new Error('uncontrolled'); t.went = u; return t; };
    return t;
  };
  const click = (u) => ({ notification: { close() {}, data: { u } } });
  const same = tab('https://bloombroke.com/?c=CHAT');
  const other = tab('https://bloombroke.com/?c=HOME');
  let sw = loadSw({ clients: [other, same] });
  await sw.fire('notificationclick', click('https://bloombroke.com/?c=CHAT'));
  assert.equal(same.focused, 1);
  assert.equal(other.focused, 0);
  assert.deepEqual(sw.opened, []);
  const one = tab('https://bloombroke.com/?c=HOME');
  sw = loadSw({ clients: [tab('https://elsewhere.example/'), one] });
  await sw.fire('notificationclick', click('https://bloombroke.com/?c=AAPL'));
  assert.equal(one.focused, 1);
  assert.equal(one.went, 'https://bloombroke.com/?c=AAPL');
  const old = tab('https://bloombroke.com/', { navigateFails: true });
  sw = loadSw({ clients: [old] });
  await sw.fire('notificationclick', click('https://bloombroke.com/?c=AAPL'));
  assert.equal(old.focused, 1, 'a tab from before pings: focused, keeps its screen');
  assert.deepEqual(sw.opened, []);
  sw = loadSw({ clients: [] });
  await sw.fire('notificationclick', click('https://evil.example/'));
  assert.deepEqual(sw.opened, ['https://bloombroke.com/'], 'no tab: a new window, on this site only');
});

test('sw.js pushsubscriptionchange: subscribe again with the site key, tell the server with the old address', async () => {
  let sw = loadSw();
  await sw.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/old', options: {} }, newSubscription: null });
  assert.equal(sw.subscribed.length, 1);
  assert.equal(sw.subscribed[0].userVisibleOnly, true);
  assert.equal(sw.subscribed[0].applicationServerKey.length, 65);
  assert.deepEqual(sw.posted.map((p) => p.url), ['/api/push/key', '/api/push/resubscribe']);
  assert.deepEqual(sw.posted[1].body, { old: 'https://fcm.googleapis.com/fcm/send/old', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'P', auth: 'A' } } });
  sw = loadSw();
  await sw.fire('pushsubscriptionchange', { oldSubscription: null });
  assert.deepEqual(sw.posted, [], 'no old address: nothing to move (ME subscribes again)');
});

// ---- PRO, and the startup bundle ------------------------------------------------------------------------------

test('PRO: closed-tab alerts and CHAT pings are live, and point at ME', () => {
  const row = PRO_ROWS.find(([n]) => /tab is closed/.test(n));
  assert.deepEqual(row, ['Alerts and CHAT pings when the tab is closed', LIVE, 'ME']);
  assert.ok(shownRows(PRO_ROWS).includes(row), 'ME exists, so the row shows');
});

test('startup: pings add nothing to the startup bundle; sw.js and push.js load only when used; /sw.js is a plain path', () => {
  const a = buildAssets(path.join(import.meta.dirname, '..', 'public'));
  const shell = a.closure('app.js');
  assert.ok(!shell.includes('push.js') && !shell.includes('sw.js') && !shell.includes('screens/me.js'));
  assert.ok(shell.length <= 45, `${shell.length} modules`);
  const bytes = shell.reduce((n, r) => n + a.files.get(r).body.length, 0);
  assert.ok(bytes <= 599_202, `${bytes} bytes at startup (599,202 before pings)`);
  // /sw.js is not rewritten to a hashed name: the asset middleware passes it on to the
  // plain static files (server.js serves those with Cache-Control: no-cache).
  let next = false;
  serveAssets(a, { shell: ['app.js', 'lazy.js', 'base.css'] })({ method: 'GET', path: '/sw.js' }, {}, () => { next = true; });
  assert.ok(next);
  assert.match(readFileSync('server.js', 'utf8'), /app\.use\(express\.static\(PUBLIC, \{ index: false, cacheControl: false, setHeaders: \(res\) => res\.set\('Cache-Control', 'no-cache'\) \}\)\);/);
  // The CSP lets a same-origin worker register (default-src 'self', no worker-src narrowing it).
  assert.match(readFileSync('lib/embed.js', 'utf8'), /"default-src 'self'"/);
  assert.doesNotMatch(readFileSync('lib/embed.js', 'utf8'), /worker-src/);
});
