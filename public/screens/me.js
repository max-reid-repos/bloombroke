// ME (also SETTINGS and ACCOUNT; the seat in the top bar opens it): you, on one card page
// (kit.js cardPage). With Pro: your pixel avatar and username, big, and #00042 small; the
// profile editor (USERNAME, COLOUR, an 8x8 AVATAR you click, SAVE); your plan as facts;
// this device's settings; MANAGE PLAN, CANCEL and GIFT; + Details for your key and data
// (SHOW KEY, NEW KEY, LOG OUT, DOWNLOAD MY DATA, DELETE MY ACCOUNT). Without Pro: ME, one
// line, PRO, and this device's settings.
//
// This device (bb.prefs, pro.js): START SCREEN (a visit with no ?c= opens on it), CLOCK
// (the top bar only: New York or local), CHAT SOUND (Pro), TAPE (Pro, the TAPE ON/OFF
// setting) and PINGS (Pro, when the site has pings: notifications with the tab closed,
// public/push.js). What to ping about (CHAT MESSAGES, ALERTS WHEN THE TAB IS CLOSED,
// SHOW MESSAGE TEXT) and TEST are in + Details, with the words that explain them. Everything is reachable by keyboard: Tab between the parts, arrows inside the
// colour row and the pixel grid, Space or Enter to press. NEW KEY and DELETE ask first,
// one line: Enter goes ahead, Esc does not; DELETE also wants the word typed.
//
// Pure *Html builders are exported for node:test; render() is the browser part.

import { esc } from './markets.js';
import { cardPage, cardButton, cardLink, cardFacts, cardRows, raw } from '../kit.js';
import * as pro from '../pro.js';
import {
  avatarSvg, encode, bitsFromHex, blank, initialsBits, initialsOf, colorOf, COLORS, SIZE,
} from '../pixel-avatar.js';
import { keyView, MANAGE, CANCEL } from './pro.js';
import { findCommand } from '../registry.js';
import * as push from '../push.js';

export const NOT_PRO_LINE = 'Username, avatar and sync come with Pro.';
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,14}$/; // the server's rule (pro/chat.js)
export const NAME_HINT = 'A username is 3 to 15 letters, numbers or _, starting with a letter.';
export const SAVE_NOW = 'Save it right away. If this page fails, write to hello@bloombroke.com.';
export const NEW_KEY_ASK = `Your old key stops working everywhere. ${SAVE_NOW}`;
export const DELETE_ASK = 'Type DELETE to delete your account.';
export const RENEWING = 'Cancel first: press CANCEL. Then delete.';
export const DELETED = 'Your account is deleted. This browser is logged out.';
export const NEW_KEY_DONE = 'New key made. Your old key stops working everywhere.';
export const START_NAMES = pro.START_SCREENS;

// PINGS: the lines for a browser that cannot have them yet (public/push.js).
export const PING_HINTS = { ios: push.IOS_HINT, denied: push.DENIED_HINT, no: push.UNSUPPORTED_HINT };
// + Details, under PINGS: what they are.
export const PING_ROWS = [
  ['Pings', 'Notifications when the tab is closed. PINGS turns them on or off on this device; the three settings count for all your devices.'],
  ['Chat messages', 'A new message while you are not on CHAT. One ping per chat every 5 minutes.'],
  ['Alerts', 'Your price alerts, checked by our server every minute. WEIRD gauge alerts still need an open tab. Pings can be late or missed: do not rely on them.'],
  ['Message text', 'Off: a ping only says who wrote. On: the first 80 characters of the message.'],
];

// + Details: the rules, as short rows.
export const ME_ROWS = [
  ['Username', '3 to 15 letters, numbers or _, starting with a letter. It can change 3 times a day. A name you give up is locked for 30 days.'],
  ['Colour, avatar', 'The people you chat with see them. Nothing that pretends to be someone else, nothing offensive: we may reset it.'],
  ['This device', 'Saved in this browser. With Pro they sync to your other devices.'],
  ['Clock', 'LOCAL changes the clock in the top bar only. Every time on the data stays New York.'],
  ['New key', `The same seat, plan, chats and synced lists on a new key. The old key stops working everywhere. ${SAVE_NOW}`],
  ['Download', 'What we hold about you, as a JSON file.'],
  ['Delete', 'Cancel first. Your username, avatar, settings, synced lists and chats go. The billing record stays 5 years (Privacy Policy).'],
];

const pad = (n) => (Number.isInteger(n) && n > 0 ? String(n).padStart(5, '0') : '-----');
const when = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Would the server refuse DELETE (pro/me-routes.js willRenew)? The cached status says.
export function renewing(st) {
  if (!st || ['gift', 'gift_ended', 'demo', 'canceled'].includes(st.status)) return false;
  if (st.cancelAtPeriodEnd || st.cancelAt) return false;
  return ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(st.status);
}

// PLAN as facts: the plan, and when it renews or ends.
export function planFacts(st) {
  if (st?.status === 'gift') return [{ value: 'Gift', label: 'PLAN' }, st.giftUntil ? { value: when(st.giftUntil), label: 'ENDS' } : null].filter(Boolean);
  const facts = [{ value: st?.interval === 'year' ? 'Yearly' : st?.interval === 'month' ? 'Monthly' : 'Pro', label: 'PLAN' }];
  const end = st?.cancelAt || (st?.cancelAtPeriodEnd ? st?.currentPeriodEnd : null);
  if (end) facts.push({ value: when(end), label: 'ENDS' });
  else if (st?.currentPeriodEnd) facts.push({ value: when(st.currentPeriodEnd), label: 'RENEWS' });
  if (st?.status === 'past_due') facts.push({ value: 'Failed', label: 'PAYMENT', cls: 'down' });
  return facts;
}

// The editor's state from what the server holds: bits null means the initials.
export const draftOf = (me) => ({ username: me?.username || '', color: Number.isInteger(me?.color) ? me.color : null, bits: bitsFromHex(me?.avatar) });
// The person the draft draws: the initials follow the username as it is typed.
export function draftPerson(d, seat) {
  const name = USERNAME_RE.test(d.username || '') ? d.username : null;
  return { seat, name, color: d.color, avatar: d.bits ? encode(d.bits) : null };
}
export const shownBits = (d, seat) => d.bits || initialsBits(initialsOf(USERNAME_RE.test(d.username || '') ? d.username : '', seat));

// ---- parts ------------------------------------------------------------------------------

export function swatchesHtml(current) {
  let out = '';
  for (let i = 0; i < COLORS; i++) {
    const on = i === current;
    out += `<button type="button" class="me-sw" role="radio" data-color="${i}" data-nc="${i}" aria-checked="${on}" aria-label="Colour ${i + 1}" tabindex="${on ? 0 : -1}"></button>`;
  }
  return out;
}

// The 8x8 grid: one button a pixel, one of them in the Tab order (arrows move).
export function gridHtml(bits, focus = 0) {
  let out = '';
  for (let i = 0; i < SIZE * SIZE; i++) {
    out += `<button type="button" class="me-px" data-i="${i}" aria-pressed="${Boolean(bits[i])}" aria-label="Row ${Math.floor(i / SIZE) + 1}, column ${(i % SIZE) + 1}" tabindex="${i === focus ? 0 : -1}"></button>`;
  }
  return out;
}

export function profileFormHtml(d, seat) {
  const n = colorOf(draftPerson(d, seat));
  return `<form class="me-form" id="me-form" novalidate autocomplete="off">`
    + `<div class="me-row me-row-name"><label class="tag" for="me-name">USERNAME</label><input class="card-input me-input" id="me-name" type="text" maxlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" enterkeyhint="done" value="${esc(d.username)}" placeholder="A-Z 0-9 _" aria-label="Username"></div>`
    + `<div class="me-row me-row-col"><span class="tag" id="me-col-l">COLOUR</span><div class="me-sws" role="radiogroup" aria-labelledby="me-col-l">${swatchesHtml(n)}</div></div>`
    + `<div class="me-row me-row-av"><span class="tag" id="me-av-l">AVATAR</span><div class="me-av-box"><div class="me-grid" id="me-grid" role="group" aria-labelledby="me-av-l" data-nc="${n}">${gridHtml(shownBits(d, seat))}</div>`
    + `<span class="me-av-acts">${cardLink({ label: 'RESET', id: 'me-reset', attrs: 'title="Your initials"' })}${cardLink({ label: 'CLEAR', id: 'me-clear' })}</span></div></div>`
    + `<div class="me-row me-row-save"><span></span>${cardButton({ label: 'SAVE', primary: true, id: 'me-save', type: 'submit' })}</div>`
    + '</form>';
}

// This device. pro: CHAT SOUND and TAPE too. pings: { device } when the site has pings
// (null: no row).
export function deviceHtml({ prefs = pro.DEFAULT_PREFS, pro: isPro = false, tape = false, pings = null } = {}) {
  const p = pro.cleanPrefs(prefs);
  const set = (label, pref, value, pressed = null) => `<div class="me-set"><span class="tag">${esc(label)}</span><button type="button" class="chip me-pref" data-pref="${pref}"${pressed === null ? '' : ` aria-pressed="${pressed}"`}>${esc(value)}</button></div>`;
  return '<div class="me-device" role="group" aria-label="This device"><p class="tag me-dev-k">THIS DEVICE</p>'
    + set('START', 'start', p.start)
    + set('CLOCK', 'clock', p.clock === 'local' ? 'LOCAL' : 'NEW YORK')
    + (isPro ? set('CHAT SOUND', 'sound', p.sound ? 'ON' : 'OFF', p.sound) + set('TAPE', 'tape', tape ? 'ON' : 'OFF', tape) : '')
    + (isPro && pings ? set('PINGS', 'pings', pings.device ? 'ON' : 'OFF', Boolean(pings.device)) : '')
    + '</div>';
}

// NEW KEY and DELETE ask first, one line. 'renewing': DELETE while a plan renews says
// cancel first, right where DELETE was pressed.
export function confirmHtml(kind) {
  if (kind === 'renewing') return `<p class="me-warn" role="status">${esc(RENEWING)}</p>`;
  if (kind === 'key') {
    return `<div class="desk-confirm me-confirm" role="alertdialog" aria-label="New key" tabindex="-1" data-confirm="key"><span class="desk-confirm-text">${esc(NEW_KEY_ASK)}</span><button type="button" class="desk-btn" data-act="yes">ENTER: NEW KEY</button><button type="button" class="desk-btn" data-act="no">ESC: CANCEL</button></div>`;
  }
  if (kind === 'delete') {
    return `<div class="desk-confirm me-confirm" role="alertdialog" aria-label="Delete my account" tabindex="-1" data-confirm="delete"><label class="desk-confirm-text" for="me-del">${esc(DELETE_ASK)}</label><input class="me-del-in" id="me-del" type="text" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="button" class="desk-btn" data-act="yes">ENTER: DELETE</button><button type="button" class="desk-btn" data-act="no">ESC: CANCEL</button></div>`;
  }
  return '';
}

// + Details, PINGS: the three settings (for every device of the licence), TEST, the line
// for a browser that cannot have them yet, and what they are. pings: { device, prefs,
// support, hint }.
export function pingsHtml(pings) {
  const pr = pings.prefs || {};
  const set = (label, k) => `<div class="me-set"><span class="tag">${esc(label)}</span><button type="button" class="chip me-ping" data-ping="${k}" aria-pressed="${Boolean(pr[k])}">${pr[k] ? 'ON' : 'OFF'}</button></div>`;
  const hint = pings.hint || PING_HINTS[pings.support] || '';
  return `<p class="tag me-dk">PINGS</p><div class="me-pings" role="group" aria-label="Pings">`
    + set('CHAT MESSAGES', 'chat') + set('ALERTS WHEN THE TAB IS CLOSED', 'alerts') + set('SHOW MESSAGE TEXT', 'show_text')
    + `</div><p class="me-keys">${cardLink({ label: 'TEST', id: 'me-ping-test' })}</p>`
    + `<p class="me-ping-hint" id="me-ping-hint" role="status"${hint ? '' : ' hidden'}>${esc(hint)}</p>${cardRows(PING_ROWS)}`;
}

// + Details: KEY AND DATA, then the rules. pings: PINGS first, when the site has them.
export function keyDataHtml({ confirm = null, pings = null } = {}) {
  const links = [
    cardLink({ label: 'SHOW KEY', id: 'me-show' }),
    cardLink({ label: 'NEW KEY', id: 'me-newkey' }),
    cardLink({ label: 'LOG OUT', cmd: 'LOGOUT' }),
    cardLink({ label: 'DOWNLOAD MY DATA', id: 'me-export' }),
    cardLink({ label: 'DELETE MY ACCOUNT', id: 'me-delete' }),
  ];
  return `<div id="me-pings-box">${pings ? pingsHtml(pings) : ''}</div><p class="tag me-dk">KEY AND DATA</p><p class="me-keys">${links.join(' ')}</p><div id="me-confirm">${confirmHtml(confirm)}</div>${cardRows(ME_ROWS)}`;
}

// The page. key/st/me: this browser's licence, status and profile (none: a visitor).
// prefs/tape: this device. draft: the editor's state (unsaved changes survive a redraw).
// has: whether a command exists (tests). confirm: 'key' or 'delete' while asking.
export function meHtml(o = {}) {
  const {
    key = null, st = null, me = null, prefs = pro.DEFAULT_PREFS, tape = false, alert = '', alertWarn = false, detailsOpen = false, confirm = null, pings = null,
  } = o;
  const exists = o.has || ((c) => Boolean(findCommand(c)));
  const on = Boolean(key) && pro.statusActive(st);
  const gift = st?.status === 'gift' || st?.status === 'gift_ended';
  const details = key ? raw(keyDataHtml({ confirm, pings: on ? pings : null })) : '';
  const open = detailsOpen || Boolean(confirm);
  if (!on) {
    const links = key
      ? [gift ? '' : cardLink({ label: MANAGE, id: 'me-manage' })]
      : [cardLink({ label: 'LOGIN', cmd: 'LOGIN' }), cardLink({ label: 'REDEEM', cmd: 'REDEEM' })];
    return cardPage({
      label: 'ME', id: 'me-card', cls: 'me-card', alert, alertWarn,
      hero: 'ME', heroSize: 60, sub: NOT_PRO_LINE,
      act: raw(cardButton({ label: 'PRO', primary: true, cmd: 'PRO' })),
      media: raw(deviceHtml({ prefs, pro: false })),
      links: links.filter(Boolean), details, detailsOpen: open,
    });
  }
  const seat = Number.isInteger(st?.seat) ? st.seat : (Number.isInteger(me?.seat) ? me.seat : null);
  const d = o.draft || draftOf(me);
  const person = draftPerson(d, seat);
  const n = colorOf(person);
  const shown = person.name || `SEAT ${pad(seat)}`;
  const ending = Boolean(st?.cancelAt || st?.cancelAtPeriodEnd);
  const links = [
    gift ? '' : cardLink({ label: MANAGE, id: 'me-manage' }),
    gift || ending ? '' : cardLink({ label: CANCEL, id: 'me-cancel' }),
    st?.canGift && exists('GIFT') ? cardLink({ label: 'GIFT', cmd: 'GIFT' }) : '',
  ];
  return cardPage({
    label: 'ME', id: 'me-card', cls: 'me-card', alert, alertWarn,
    kicker: 'ME',
    hero: raw(`<span class="me-hero" id="me-hero" data-nc="${n}"><span class="me-hero-av" id="me-hero-av">${avatarSvg(person, { size: 64, inline: false, bits: shownBits(d, seat) })}</span><span class="me-hero-name" id="me-hero-name">${esc(shown)}</span></span>`),
    heroSize: 44,
    heroLabel: `${shown}, seat ${pad(seat)}`,
    sub: raw(`<span class="me-badge" id="me-badge"${person.name ? '' : ' hidden'}>#${pad(seat)}</span>`),
    act: raw(profileFormHtml(d, seat)),
    // PLAN: the facts, then MANAGE PLAN, CANCEL and GIFT right under them (CANCEL stays in
    // the first view), before this device.
    facts: `<div class="me-plan">${cardFacts(planFacts(st))}<p class="me-plan-links">${links.filter(Boolean).join(' ')}</p></div>`,
    media: raw(deviceHtml({ prefs, pro: true, tape, pings })),
    details,
    detailsOpen: open,
  });
}

// One call at a time: while fn runs, another call does nothing and returns false. NEW KEY
// and DELETE go through it, so a double Enter never sends two requests.
export function oneAtATime() {
  let busy = false;
  const run = async (fn) => {
    if (busy) return false;
    busy = true;
    try { await fn(); return true; } finally { busy = false; }
  };
  run.busy = () => busy;
  return run;
}

// ---- the browser -----------------------------------------------------------------------------

function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function render(el, cmd, ctx) {
  // pings: null until the site says it has pings (then { device, prefs, support, hint }).
  const v = { draft: null, dirty: false, confirm: null, alert: '', warn: false, px: 0, pings: null };
  const alive = () => !ctx.signal?.aborted && el.isConnected;
  const $ = (sel) => el.querySelector(sel);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const state = () => ({ key: pro.getKey(), st: pro.getStatus(), me: pro.getMe() });
  const seatOf = () => { const s = state(); return Number.isInteger(s.st?.seat) ? s.st.seat : (s.me?.seat ?? null); };

  function paint() {
    if (!alive()) return;
    const s = state();
    const detailsOpen = Boolean($('.card-more')?.open);
    el.innerHTML = `<div class="me-page">${meHtml({
      ...s, prefs: pro.getPrefs(), tape: Boolean(ctx.tapeOn?.()), draft: v.draft, alert: v.alert, alertWarn: v.warn, detailsOpen, confirm: v.confirm, pings: v.pings,
    })}</div>`;
    if (v.confirm && v.confirm !== 'renewing') {
      const c = $('.me-confirm');
      const input = c?.querySelector('input');
      if (input) input.focus(); else c?.focus();
    }
  }
  const say = (msg, warn = false) => { v.alert = msg; v.warn = warn; };
  const draft = () => { v.draft ||= draftOf(pro.getMe()); return v.draft; };

  // The hero and the grid follow the draft without a redraw, so focus stays put.
  function preview() {
    const d = draft();
    const seat = seatOf();
    const p = draftPerson(d, seat);
    const n = colorOf(p);
    const hero = $('#me-hero');
    if (!hero) return;
    hero.dataset.nc = String(n);
    $('#me-grid').dataset.nc = String(n);
    $('#me-hero-av').innerHTML = avatarSvg(p, { size: 64, inline: false, bits: shownBits(d, seat) });
    $('#me-hero-name').textContent = p.name || `SEAT ${pad(seat)}`;
    const badge = $('#me-badge');
    if (badge) badge.hidden = !p.name;
    const bits = shownBits(d, seat);
    for (const b of el.querySelectorAll('.me-px')) b.setAttribute('aria-pressed', String(Boolean(bits[Number(b.dataset.i)])));
    for (const b of el.querySelectorAll('.me-sw')) {
      const on = Number(b.dataset.color) === n;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  function setColor(i) {
    draft().color = i;
    v.dirty = true;
    preview();
  }
  function togglePx(i) {
    const d = draft();
    if (!d.bits) d.bits = [...shownBits(d, seatOf())]; // the initials become yours to edit
    d.bits[i] = !d.bits[i];
    v.dirty = true;
    preview();
  }

  async function save() {
    const d = draft();
    const me = pro.getMe() || {};
    const name = String($('#me-name')?.value ?? d.username).trim();
    d.username = name;
    if (name && !USERNAME_RE.test(name)) { ctx.status(NAME_HINT.toUpperCase(), 'warn'); $('#me-name')?.focus(); return; }
    const patch = {};
    if ((name || null) !== (me.username || null)) patch.username = name || null;
    if (d.color !== (Number.isInteger(me.color) ? me.color : null)) patch.color = d.color;
    const avatar = d.bits ? encode(d.bits) : null;
    if (avatar !== (me.avatar || null)) patch.avatar = avatar;
    if (!Object.keys(patch).length) { ctx.status('ME: NOTHING TO SAVE'); return; }
    const btn = $('#me-save');
    if (btn) btn.disabled = true;
    ctx.status('SAVING...');
    try {
      const saved = await pro.saveProfile(patch);
      if (!alive()) return;
      v.draft = draftOf(saved);
      v.dirty = false;
      say('');
      paint();
      ctx.status('ME: SAVED');
    } catch (err) {
      if (!alive()) return;
      if (btn) btn.disabled = false;
      ctx.status(String(err.message).toUpperCase(), 'warn');
      if (err.code === 'taken' || err.code === 'bad_name') $('#me-name')?.focus();
    }
  }

  const deviceNow = () => deviceHtml({ prefs: pro.getPrefs(), pro: pro.isPro(), tape: Boolean(ctx.tapeOn?.()), pings: v.pings });

  // ---- PINGS (public/push.js) ----
  let pingKey = null; // the site's public VAPID key
  const pingsOnce = oneAtATime();
  // The PINGS row and the Details part, redrawn in place (the editor keeps what is typed).
  function paintPings(focus = null) {
    if (!alive()) return;
    const dev = $('.me-device');
    if (dev) dev.outerHTML = deviceNow();
    const box = $('#me-pings-box');
    if (box) box.innerHTML = v.pings && pro.isPro() ? pingsHtml(v.pings) : '';
    if (focus) $(focus)?.focus();
  }
  // Closed-tab alerts on this device: the tab leaves its quote alerts to the server.
  function alertsFollow() {
    const on = Boolean(v.pings?.device && v.pings.prefs.alerts);
    push.setAlertsFlag(on);
    if (on) push.syncAlerts(undefined, { force: true }).catch(() => {});
  }
  async function loadPings() {
    if (!pro.isPro() || !alive()) return;
    const key = await push.vapidKey();
    if (!key || !alive() || !pro.isPro()) return;
    pingKey = key;
    let st;
    try { st = await push.loadState(); } catch { return; }
    if (!alive()) return;
    v.pings = { device: st.device, prefs: st.prefs, support: push.supportOf(), hint: '' };
    // This browser had pings: make sure the server still has it (NEW KEY, failed sends).
    if (st.device && (st.prefs.chat || st.prefs.alerts)) push.resubscribe(st.sub).catch(() => {});
    alertsFollow();
    paintPings();
  }
  const pingFail = (err) => {
    const p = v.pings;
    if (err.code === 'denied') p.support = 'denied';
    p.hint = PING_HINTS[err.code] || '';
    ctx.status(String(err.message).toUpperCase(), 'warn');
  };
  // The PINGS row: this device on or off. On with nothing to ping about turns both on.
  const pingsDevice = () => pingsOnce(async () => {
    const p = v.pings;
    if (!p) return;
    try {
      if (p.device) {
        ctx.status('PINGS: TURNING OFF...');
        await push.turnOffDevice();
        p.device = false;
        ctx.status('PINGS OFF ON THIS DEVICE');
      } else {
        if (p.support === 'ios' || p.support === 'no') throw Object.assign(new Error(PING_HINTS[p.support]), { code: p.support });
        ctx.status('PINGS: ALLOW NOTIFICATIONS IN THE BROWSER...');
        await push.turnOnDevice(pingKey);
        p.device = true;
        p.support = 'ok';
        if (!p.prefs.chat && !p.prefs.alerts) p.prefs = await push.setPrefs({ chat: true, alerts: true });
        ctx.status('PINGS ON. PRESS TEST IN DETAILS TO TRY ONE');
      }
      p.hint = '';
    } catch (err) { pingFail(err); }
    alertsFollow();
    paintPings('.me-pref[data-pref="pings"]');
  });
  const PING_WORDS = { chat: 'CHAT MESSAGES', alerts: 'CLOSED-TAB ALERTS', show_text: 'MESSAGE TEXT' };
  // CHAT MESSAGES, ALERTS, SHOW MESSAGE TEXT: for every device. Turning one on turns this
  // device on too; turning the last of CHAT and ALERTS off turns this device off.
  const pingsToggle = (k) => pingsOnce(async () => {
    const p = v.pings;
    if (!p) return;
    const want = !p.prefs[k];
    try {
      if (want && k !== 'show_text' && !p.device) {
        if (p.support === 'ios' || p.support === 'no') throw Object.assign(new Error(PING_HINTS[p.support]), { code: p.support });
        await push.turnOnDevice(pingKey);
        p.device = true;
        p.support = 'ok';
      }
      p.prefs = await push.setPrefs({ [k]: want });
      if (!p.prefs.chat && !p.prefs.alerts && p.device) {
        await push.turnOffDevice();
        p.device = false;
      }
      p.hint = '';
      ctx.status(`${PING_WORDS[k]} ${want ? 'ON' : 'OFF'}`);
    } catch (err) { pingFail(err); }
    alertsFollow();
    paintPings(`.me-ping[data-ping="${k}"]`);
  });
  const pingsTest = () => pingsOnce(async () => {
    try {
      const d = await push.sendTest();
      ctx.status(`TEST PING SENT TO ${d.sent} DEVICE${d.sent === 1 ? '' : 'S'}`);
    } catch (err) { ctx.status(String(err.message).toUpperCase(), 'warn'); }
  });

  function setPref(pref, back = false) {
    if (pref === 'pings') { pingsDevice(); return; }
    const p = pro.getPrefs();
    if (pref === 'start') {
      const i = START_NAMES.indexOf(p.start);
      const next = START_NAMES[(i + (back ? START_NAMES.length - 1 : 1)) % START_NAMES.length];
      pro.setPrefs({ start: next });
      ctx.status(`START SCREEN: ${next}. IT OPENS THERE NEXT TIME`);
    } else if (pref === 'clock') {
      const next = p.clock === 'local' ? 'ny' : 'local';
      pro.setPrefs({ clock: next });
      ctx.status(`CLOCK: ${next === 'local' ? 'LOCAL TIME' : 'NEW YORK'}`);
    } else if (pref === 'sound') {
      pro.setPrefs({ sound: !p.sound });
      ctx.status(`CHAT SOUND ${p.sound ? 'OFF' : 'ON'}`);
      if (!p.sound) pro.chatBeep(Date.now() + 5000); // a sample (and the browser's audio unlock)
    } else if (pref === 'tape') {
      const on = !ctx.tapeOn?.();
      ctx.setTape?.(on);
      ctx.status(`TAPE ${on ? 'ON' : 'OFF'}`);
    }
    // Redraw the device part only: the editor keeps what is typed.
    const dev = $('.me-device');
    if (dev) {
      dev.outerHTML = deviceNow();
      $(`.me-pref[data-pref="${pref}"]`)?.focus();
    }
  }

  function ask(kind) {
    v.confirm = kind;
    say('');
    keepDraft();
    paint();
  }
  function keepDraft() {
    if (!$('#me-name')) return;
    draft().username = $('#me-name').value;
  }
  const once = oneAtATime(); // NEW KEY and DELETE: never two requests in flight
  async function answer(yes) {
    const kind = v.confirm;
    if (!kind || kind === 'renewing' || once.busy()) return;
    if (!yes) { v.confirm = null; paint(); $(kind === 'key' ? '#me-newkey' : '#me-delete')?.focus(); ctx.status('NOTHING CHANGED'); return; }
    if (kind === 'delete' && String($('#me-del')?.value || '').trim().toUpperCase() !== 'DELETE') {
      ctx.status('TYPE DELETE TO CONFIRM', 'warn');
      $('#me-del')?.focus();
      return;
    }
    await once(() => sendAnswer(kind));
  }
  async function sendAnswer(kind) {
    for (const b of el.querySelectorAll('.me-confirm button, .me-confirm input')) b.disabled = true;
    if (kind === 'key') {
      ctx.status('MAKING A NEW KEY...');
      try {
        const d = await pro.rotateKey();
        push.afterNewKey().catch(() => {}); // the server dropped every device: this one again
        if (!alive()) return;
        v.confirm = null;
        keyView(el, ctx, d.key, d.saved ? NEW_KEY_DONE : `${NEW_KEY_DONE} This browser could not save it, so copy it now.`, { warn: !d.saved });
        ctx.status('NEW KEY: SAVE IT NOW');
      } catch (err) {
        if (!alive()) return;
        v.confirm = null;
        say(err.message, true);
        paint();
        ctx.status('NEW KEY: NOT MADE', 'warn');
      }
      return;
    }
    ctx.status('DELETING YOUR ACCOUNT...');
    try {
      await pro.deleteAccount();
      push.turnOffDevice({ key: null }).catch(() => {}); // the server has already forgotten it
      if (!alive()) return;
      v.confirm = null;
      v.draft = null;
      say(DELETED);
      paint();
      ctx.status('ACCOUNT DELETED');
    } catch (err) {
      if (!alive()) return;
      v.confirm = null;
      say(err.message, true);
      paint();
      ctx.status(err.code === 'renewing' ? 'CANCEL FIRST' : 'NOT DELETED', 'warn');
    }
  }

  async function busy(label, fn) {
    ctx.status(label);
    try { await fn(); } catch (err) { if (alive()) ctx.status(String(err.message).toUpperCase(), 'warn'); }
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest?.('button');
    if (!t || !el.contains(t)) return;
    if (t.dataset.color !== undefined) { setColor(Number(t.dataset.color)); return; }
    if (t.dataset.i !== undefined) { v.px = Number(t.dataset.i); togglePx(v.px); return; }
    if (t.dataset.pref) { setPref(t.dataset.pref); return; }
    if (t.dataset.ping) { pingsToggle(t.dataset.ping); return; }
    if (t.dataset.act === 'yes' || t.dataset.act === 'no') { answer(t.dataset.act === 'yes'); return; }
    switch (t.id) {
      case 'me-reset': draft().bits = null; v.dirty = true; preview(); ctx.status('AVATAR: YOUR INITIALS. SAVE TO KEEP'); break;
      case 'me-clear': draft().bits = blank(); v.dirty = true; preview(); ctx.status('AVATAR: CLEARED. CLICK PIXELS TO DRAW'); break;
      case 'me-manage': busy('OPENING BILLING...', () => pro.openPortal()); break;
      case 'me-cancel': busy('OPENING BILLING. CANCEL IS THERE...', () => pro.openPortal()); break;
      case 'me-ping-test': pingsTest(); break;
      case 'me-show': if (pro.getKey()) { keyView(el, ctx, pro.getKey()); ctx.status('YOUR KEY'); } break;
      case 'me-newkey': ask('key'); ctx.status('NEW KEY: ENTER TO GO AHEAD, ESC TO CANCEL'); break;
      case 'me-export': busy('GETTING YOUR DATA...', async () => {
        const data = await pro.exportData();
        saveFile('bloombroke-my-data.json', JSON.stringify(data, null, 2));
        if (alive()) ctx.status('SAVED BLOOMBROKE-MY-DATA.JSON');
      }); break;
      case 'me-delete':
        if (renewing(pro.getStatus())) { v.confirm = 'renewing'; keepDraft(); paint(); $('#me-delete')?.focus(); ctx.status('CANCEL FIRST', 'warn'); break; }
        ask('delete');
        ctx.status('TYPE DELETE, THEN ENTER. ESC CANCELS');
        break;
      default:
    }
  });

  el.addEventListener('submit', (e) => {
    if (e.target.id !== 'me-form') return;
    e.preventDefault();
    save();
  });

  el.addEventListener('input', (e) => {
    if (e.target.id !== 'me-name') return;
    draft().username = e.target.value;
    v.dirty = true;
    preview();
  });

  // Arrows move inside the colour row and the grid; Space presses (the page would send a
  // typed space to the command bar); Enter and Esc answer a question.
  el.addEventListener('keydown', (e) => {
    const t = e.target;
    if (v.confirm && v.confirm !== 'renewing' && (e.key === 'Enter' || e.key === 'Escape') && !e.repeat && (t.closest?.('.me-confirm') || t === document.body)) {
      e.preventDefault();
      e.stopPropagation();
      answer(e.key === 'Enter');
      return;
    }
    if (t.closest?.('input, textarea, select')) {
      if (e.key === 'Escape' && t.id === 'me-name') { e.preventDefault(); document.getElementById('cmd')?.focus(); }
      return;
    }
    const arrows = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIZE, ArrowDown: SIZE };
    if (t.classList?.contains('me-px') && e.key in arrows) {
      e.preventDefault();
      const i = Number(t.dataset.i);
      const step = arrows[e.key];
      const next = Math.abs(step) === 1 && Math.floor((i + step) / SIZE) !== Math.floor(i / SIZE) ? i : Math.min(SIZE * SIZE - 1, Math.max(0, i + step));
      const b = $(`.me-px[data-i="${next}"]`);
      if (b) { t.tabIndex = -1; b.tabIndex = 0; b.focus(); v.px = next; }
      return;
    }
    if (t.classList?.contains('me-sw') && e.key in arrows) {
      e.preventDefault();
      const i = (Number(t.dataset.color) + (arrows[e.key] > 0 ? 1 : COLORS - 1)) % COLORS;
      setColor(i);
      $(`.me-sw[data-color="${i}"]`)?.focus();
      return;
    }
    if (t.dataset?.pref === 'start' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      setPref('start', e.key === 'ArrowLeft');
      return;
    }
    if (e.key === ' ' && t.tagName === 'BUTTON' && el.contains(t)) {
      e.preventDefault();
      e.stopPropagation();
      t.click();
    }
  });

  const onPro = () => { if (!v.dirty && !v.confirm) { v.draft = null; paint(); } };
  const onPrefs = () => {
    const dev = $('.me-device');
    if (dev) dev.outerHTML = deviceNow();
  };
  window.addEventListener('bb:pro', onPro);
  window.addEventListener('bb:prefs', onPrefs);
  ctx.onCleanup?.(() => { window.removeEventListener('bb:pro', onPro); window.removeEventListener('bb:prefs', onPrefs); });

  paint();
  ctx.status(pro.isPro() ? 'ME' : 'ME: USERNAME, AVATAR AND SYNC COME WITH PRO');
  if (pro.getKey()) {
    pro.refreshStatus()
      .then(() => (pro.getKey() ? pro.refreshMe() : null))
      .then(() => {
        if (!alive()) return;
        if (!v.dirty && !v.confirm) { v.draft = null; paint(); }
        ctx.status(pro.isPro() ? 'ME' : 'ME: USERNAME, AVATAR AND SYNC COME WITH PRO');
      })
      .catch(() => {})
      .then(() => loadPings())
      .catch(() => {});
  }
  if (!coarse && pro.isPro()) setTimeout(() => { if (alive() && !v.confirm) $('#me-name')?.focus({ preventScroll: true }); }, 0);
  return undefined;
}
