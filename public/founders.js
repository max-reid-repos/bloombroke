// /founders and /guide (lib/founders-page.js): the page's own small script, outside the
// terminal's startup code. The pages read without it; it adds:
//   - a seat picked in the grid: its class's button says "Save seat 12";
//   - a class button: POST /api/founders/checkout ({ seat } or { class }), then Stripe;
//   - tips: an amount, POST /api/tips/checkout ({ usd }), then Stripe;
//   - the guide list: POST /api/pro/waitlist?source=guide ({ email, hp });
//   - charge day: #claim=<token> (the key, once), #pay=<token> (pay for a seat whose card
//     failed) and ?paid=<seat>&s=<session> (the key after that payment).
// The server checks everything again: the seat, the class, the amount and the address.
//
// Charge day, first of all: the token leaves the address bar before anything else runs.
// This module is the page's first script, and module scripts run in order, so goal.js
// (analytics) only ever sees /founders. The token stays in memory, never in storage.

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const CONTACT = 'hello@bloombroke.com';
// The API's own words (pro/founders.js mountFounders) for a link that cannot work.
export const LOST = `This link does not work. Email ${CONTACT}.`;

// '#claim=<token>' or '#pay=<token>' -> { kind, token, ok } (ok: the token's shape is
// right); anything else -> null.
export function readFragment(hash) {
  const m = /^#(claim|pay)=(.*)$/s.exec(String(hash || ''));
  if (!m) return null;
  return { kind: m[1], token: m[2], ok: TOKEN_RE.test(m[2]) };
}

// '?paid=7&s=cs_...' -> { seat, s } (s '' when it is not there); anything else -> null.
export function readPaid(search) {
  let p;
  try { p = new URLSearchParams(String(search || '')); } catch { return null; }
  const seat = p.get('paid');
  if (!/^[1-9]\d?$/.test(seat || '') || Number(seat) > 42) return null;
  const s = p.get('s') || '';
  return { seat: Number(seat), s: /^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(s) ? s : '' };
}

// The address to put back: the fragment and the session id gone.
export function cleanUrl(loc, paid) {
  return paid ? `${loc.pathname}?paid=${paid.seat}` : `${loc.pathname}${loc.search}`;
}

// Read, then clear, at once. -> { frag, paid }.
function takeSecrets() {
  const loc = window.location;
  const frag = readFragment(loc.hash);
  const paid = readPaid(loc.search);
  if (frag || (paid && /[?&]s=/.test(loc.search))) {
    try { window.history.replaceState(null, '', cleanUrl(loc, paid)); } catch { /* keep it */ }
  }
  return { frag, paid };
}
const SECRETS = typeof window !== 'undefined' && window.location ? takeSecrets() : { frag: null, paid: null };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function post(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new Error('You look offline. Try again in a minute.');
  }
  let d = null;
  try { d = await res.json(); } catch { /* none */ }
  if (!res.ok) throw Object.assign(new Error(d?.message || 'Something went wrong. Try again in a minute.'), { status: res.status, code: d?.error });
  return { ...(d || {}), status: res.status };
}

function say(el, text, warn = false) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

// ---- /founders: seats ----
function founders() {
  const msg = $('#fd-msg');
  const buttons = $$('.fd-class .card-btn');
  let picked = null; // { seat, cls }
  const label = () => {
    for (const b of buttons) {
      const mine = picked && picked.cls === b.dataset.class;
      if (!b.disabled || b.dataset.busy) b.textContent = mine ? `Save seat ${picked.seat}` : b.dataset.label;
    }
  };
  for (const p of $$('.fd-pick')) {
    p.addEventListener('click', () => {
      const seat = Number(p.dataset.seat);
      picked = picked?.seat === seat ? null : { seat, cls: p.dataset.class };
      for (const o of $$('.fd-pick')) o.setAttribute('aria-pressed', String(Number(o.dataset.seat) === picked?.seat));
      label();
      say(msg, picked ? `Seat ${seat} picked.` : '');
    });
  }
  for (const b of buttons) {
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      const cls = b.dataset.class;
      const body = picked && picked.cls === cls ? { seat: picked.seat } : { class: cls };
      for (const x of buttons) x.disabled = true;
      b.dataset.busy = '1';
      say(msg, 'Opening Stripe...');
      try {
        const d = await post('/api/founders/checkout', body);
        if (!d.url) throw new Error('Checkout is taking a break. Try again in a minute.');
        window.location.assign(d.url);
      } catch (err) {
        say(msg, err.message, true);
        for (const x of buttons) x.disabled = x.textContent === 'All taken';
        delete b.dataset.busy;
      }
    });
  }
  // After checkout or a cancel: the session id or hold token leaves the address bar (the page already used it).
  if (/[?&](s|release)=/.test(window.location.search)) {
    try { window.history.replaceState(null, '', '/founders'); } catch { /* keep it */ }
  }
}

// ---- /founders: tips ----
function tips() {
  const form = $('#fd-tip-form');
  if (!form) return;
  const msg = $('#fd-tip-msg');
  const other = $('#fd-tip-usd');
  const send = $('#fd-tip-send');
  let usd = 10;
  const amounts = $$('.fd-amt', form);
  const show = () => { send.textContent = Number.isInteger(usd) ? `Tip $${usd}` : 'Tip'; };
  for (const a of amounts) {
    a.addEventListener('click', () => {
      usd = Number(a.dataset.usd);
      other.value = '';
      for (const x of amounts) x.setAttribute('aria-pressed', String(x === a));
      show();
    });
  }
  other.addEventListener('input', () => {
    const v = other.value.replace(/\D/g, '').slice(0, 3);
    if (v !== other.value) other.value = v;
    usd = v ? Number(v) : null;
    for (const x of amounts) x.setAttribute('aria-pressed', 'false');
    show();
  });
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!Number.isInteger(usd) || usd < 3 || usd > 200) { say(msg, 'Pick $3 to $200, in whole dollars.', true); return; }
    busy = true;
    send.disabled = true;
    say(msg, 'Opening Stripe...');
    try {
      const d = await post('/api/tips/checkout', { usd });
      if (!d.url) throw new Error('Checkout is taking a break. Try again in a minute.');
      window.location.assign(d.url);
    } catch (err) {
      say(msg, err.message, true);
      busy = false;
      send.disabled = false;
    }
  });
}

// ---- /guide ----
function guide() {
  const form = $('#fd-guide-form');
  if (!form) return;
  const input = $('#fd-guide-email');
  const note = $('#fd-guide-note');
  const btn = $('#fd-guide-send');
  const NOTE = note?.textContent || '';
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      say(note, 'That email address does not look right.', true);
      note.parentElement?.classList.add('warn');
      return;
    }
    busy = true;
    btn.disabled = true;
    try {
      await post('/api/pro/waitlist?source=guide', { email, hp: $('#fd-guide-hp')?.value || '' });
      form.remove();
      say(note, 'Done. We will email you once when it is ready.');
      note.parentElement?.classList.remove('warn');
    } catch (err) {
      say(note, err.message, true);
      note.parentElement?.classList.add('warn');
      busy = false;
      btn.disabled = false;
    }
  });
  input.addEventListener('input', () => {
    if (note && note.textContent !== NOTE && !busy) { say(note, NOTE); note.parentElement?.classList.remove('warn'); }
  });
}

// ---- charge day: the key card, the pay card -------------------------------------
// The cards are drawn by the server (lib/founders-page.js keyCardHtml, payCardHtml):
// #claim and #pay swap the page for theirs, from a <template>; ?paid= is served alone.

// The waits between asks while a pay-link payment is being applied (POST /api/founders/paid
// shares a limit of 20 per 10 minutes): 6 asks in all, then "check your email".
export const PAID_WAITS = [3000, 6000, 12000, 24000, 30000];
export const STILL = 'Still processing. Check your email for the link to your key.';
export const NO_SESSION = 'Check your email for the link to your key.';
export const DONE = 'Done. Log in with it on any device.';
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'fd-offscreen';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// The page becomes one card: a template's copy. The templates stay (a second link
// opened in this tab swaps again).
function swapIn(id, title) {
  const tpl = document.getElementById(id);
  const main = $('#fd');
  if (!tpl || !main) return false;
  main.replaceChildren(tpl.content.cloneNode(true), ...main.querySelectorAll('template'));
  if (title) document.title = title;
  return true;
}

// The key card: the key once, COPY, I SAVED IT. A failure: the API's line, no buttons.
function keyCard() {
  const sub = $('#fd-key-sub');
  const key = $('#fd-key');
  const act = $('#fd-key-card .card-act');
  // No key: the title says what the card is about, the line under it why.
  const fail = (text, warn = true) => {
    say(sub, text);
    sub.classList.toggle('down', warn);
    act?.remove();
    $('#fd-key-note')?.closest('.card-note')?.remove();
    $('#fd-key-card .card-kicker')?.remove();
    key.className = '';
    key.textContent = 'Your Pro key';
  };
  const show = (k) => {
    key.textContent = k;
    key.classList.remove('is-wait');
    say(sub, 'Save it now. It is your login on any device.');
    const copy = $('#fd-copy');
    const saved = $('#fd-saved');
    copy.disabled = false;
    copy.classList.add('btn-solid'); // the card's one solid button, now it can be pressed
    saved.disabled = false;
    copy.addEventListener('click', async () => {
      const ok = await copyText(k);
      copy.textContent = ok ? 'Copied' : 'Select the key and copy it';
      setTimeout(() => { copy.textContent = 'Copy key'; }, 2000);
    });
    saved.addEventListener('click', () => {
      key.textContent = `BB-XXXX-XXXX-XXXX-${k.slice(-4)}`;
      say(sub, DONE);
      act.innerHTML = '<a class="btn card-btn btn-solid" href="/?c=LOGIN">Log in</a>';
    });
  };
  return { fail, show };
}

async function claim(token) {
  if (!swapIn('fd-tpl-claim', 'Your Pro key | Bloombroke')) return;
  const card = keyCard();
  if (!TOKEN_RE.test(token)) { card.fail(LOST); return; }
  try {
    const d = await post('/api/founders/claim', { token });
    if (!d.key) throw new Error(LOST);
    card.show(d.key);
  } catch (err) {
    card.fail(err.message);
  }
}

// 'Dec 18, 2:05 PM GMT+7': the viewer's own time, its zone named.
export function untilText(iso, locale = 'en-US', timeZone = undefined) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) });
  } catch { return d.toUTCString(); }
}
export const payHero = (d) => `${d.class === 'ten' ? 'Five-year seat' : 'Founder seat'} ${d.seat}`;
export const PAY_SUB = 'Your card did not go through on the charge day. Pay here to keep the seat.';
export const payNote = (d) => `This link works until ${untilText(d.payUntil)}.`;

async function pay(token) {
  if (!swapIn('fd-tpl-pay', 'Pay for your seat | Bloombroke')) return;
  const sub = $('#fd-pay-sub');
  const btn = $('#fd-pay');
  const note = $('#fd-pay-note');
  const fail = (text, warn = true) => {
    say(sub, text);
    sub.classList.toggle('down', warn);
    btn.closest('.card-act')?.remove();
    note.closest('.card-note')?.remove();
  };
  if (!TOKEN_RE.test(token)) { fail(LOST); return; }
  let d;
  try {
    d = await post('/api/founders/pay', { token, peek: true });
  } catch (err) { fail(err.message, err.code !== 'paid'); return; } // paid: a plain line, not a warning
  $('#fd-pay-hero').textContent = payHero(d);
  say(sub, PAY_SUB);
  note.textContent = payNote(d);
  const label = `Pay $${Number(d.usd).toLocaleString('en-US')}`;
  btn.textContent = label;
  btn.disabled = false;
  btn.classList.add('btn-solid');
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Opening Stripe...';
    try {
      const r = await post('/api/founders/pay', { token });
      if (!r.url) throw new Error('Checkout is taking a break. Try again in a minute.');
      window.location.assign(r.url);
    } catch (err) {
      // Paid already: the key is on its way; nothing to press.
      if (err.code === 'paid' || err.code === 'expired' || err.code === 'not_found') { fail(err.message, err.code !== 'paid'); return; }
      say(sub, err.message);
      sub.classList.add('down');
      btn.textContent = label;
      btn.disabled = false;
    }
  });
}

// Back from a pay-link checkout: the key, once. While the payment is being applied the
// server answers 202 { pending }: ask again after PAID_WAITS, then say check your email.
export async function askPaid({ seat, s }, { send = post, sleep = wait, waits = PAID_WAITS } = {}) {
  for (let i = 0; ; i++) {
    const d = await send('/api/founders/paid', { s, seat });
    if (d.key) return { key: d.key };
    if (i >= waits.length) return { still: true };
    await sleep(waits[i]);
  }
}

async function paidPage({ seat, s }) {
  const card = keyCard();
  if (!s) { card.fail(NO_SESSION, false); return; }
  try {
    const r = await askPaid({ seat, s });
    if (r.key) card.show(r.key);
    else card.fail(STILL, false);
  } catch (err) {
    card.fail(err.message, err.code !== 'refunding');
  }
}

const page = typeof document !== 'undefined' ? document.body?.dataset?.page : null;
if (page === 'founders') {
  // A claim or pay link opened in a tab already on /founders changes only the fragment
  // (no new load). The fragment leaves the address first, then the link is used in place.
  // Left over, as on a first load: the browser may have written the address with the
  // token into its own history before this runs. It never reaches our server or analytics.
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (/^#(claim|pay)=/.test(hash)) {
      try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); } catch { /* keep it */ }
    }
    const f = readFragment(hash);
    if (f?.kind === 'claim') claim(f.token);
    else if (f?.kind === 'pay') pay(f.token);
  });
  if (SECRETS.paid && $('#fd-key-card')) paidPage(SECRETS.paid);
  else if (SECRETS.frag?.kind === 'claim') claim(SECRETS.frag.token);
  else if (SECRETS.frag?.kind === 'pay') pay(SECRETS.frag.token);
  else { founders(); tips(); }
}
if (page === 'guide') guide();
