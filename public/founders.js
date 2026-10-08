// /founders and /guide (lib/founders-page.js): the page's own small script, outside the
// terminal's startup code. The pages read without it; it adds:
//   - a seat picked in the grid: its class's button says "Save seat 12";
//   - a class button: POST /api/founders/checkout ({ seat } or { class }), then Stripe;
//   - tips: an amount, POST /api/tips/checkout ({ usd }), then Stripe;
//   - the guide list: POST /api/pro/waitlist?source=guide ({ email, hp }).
// The server checks everything again: the seat, the class, the amount and the address.

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
  if (!res.ok) throw new Error(d?.message || 'Something went wrong. Try again in a minute.');
  return d || {};
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
  // After checkout: the session id leaves the address bar (the page already used it).
  if (/[?&]s=/.test(window.location.search)) {
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

const page = document.body?.dataset?.page;
if (page === 'founders') { founders(); tips(); }
if (page === 'guide') guide();
