// FEEDBACK (and IDEA): a short note to us, from anyone, free or Pro. A card page (kit.js
// cardPage): the question, the note, an optional email, SEND. Ctrl+Enter in the note or
// Enter in the email sends. The note goes to POST /api/feedback with the screen you came
// from, for context. No IP address is stored (the status line says so).

import { esc } from './markets.js';
import { cardPage, raw } from '../kit.js';
import { goal } from '../goal.js'; // GOALS

export const MAX_FEEDBACK = 1000;
export const PROMPT = 'What should we fix or build?';
export const EMAIL_LABEL = 'Email for a reply (optional)';
export const STATUS = 'FEEDBACK: NO IP ADDRESS STORED. CTRL+ENTER SENDS';
export const THANKS = 'Thanks. We read every one.';
export const CONTACT = 'hello@bloombroke.com';

export const counterText = (n) => `${n} / ${MAX_FEEDBACK}`;

// A note to start the form with, used once by the next FEEDBACK screen (NO SUCH TICKER's
// "Tell us." sets "Please add: WORD").
let prefill = '';
export function setPrefill(text) { prefill = String(text ?? '').slice(0, 200); }
export function takePrefill() { const t = prefill; prefill = ''; return t; }

// What the form sends. screen: the address bar form of the command you came from.
export function feedbackPayload({ message, email, screen, website }) {
  const out = { message: String(message ?? '').trim(), screen: screen || null };
  const e = String(email ?? '').trim();
  if (e) out.email = e;
  if (website) out.website = String(website);
  return out;
}

// The question is the card's hero; it labels the note.
export function formHtml() {
  return `<form id="fb-form" class="fb" novalidate aria-labelledby="fb-q">
      <textarea id="fb-msg" class="fb-msg" maxlength="${MAX_FEEDBACK}" rows="5" spellcheck="true" aria-labelledby="fb-q"></textarea>
      <p class="fb-count num" id="fb-count" aria-live="polite">${counterText(0)}</p>
      <label class="fb-l" for="fb-email">${esc(EMAIL_LABEL)}</label>
      <input id="fb-email" class="fb-email" type="email" maxlength="254" autocomplete="email" spellcheck="false">
      <input id="fb-website" class="fb-hp" name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="fb-send"><button type="submit" class="btn card-btn btn-solid" id="fb-send" title="Ctrl+Enter sends">SEND</button></p>
      <p class="fb-err" id="fb-err" role="alert" hidden></p>
    </form>`;
}

export function feedbackHtml() {
  return cardPage({
    label: 'Feedback',
    cls: 'fb-card',
    hero: raw(`<span id="fb-q">${esc(PROMPT)}</span>`),
    heroSize: 32,
    act: raw(`<div id="fb-body" class="fb-body">${formHtml()}</div>`),
    note: raw(`Or email <a href="mailto:${CONTACT}">${CONTACT}</a>. No IP address stored.`),
  });
}

async function send(payload) {
  let res;
  try {
    res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
  } catch {
    throw new Error(`You look offline. Try again, or email ${CONTACT}.`);
  }
  let d = null;
  try { d = await res.json(); } catch { /* none */ }
  if (!res.ok) throw new Error(d?.message || `Could not send that. Try again, or email ${CONTACT}.`);
  return d;
}

export function render(el, cmd, ctx) {
  el.innerHTML = feedbackHtml();
  const form = el.querySelector('#fb-form');
  const msg = el.querySelector('#fb-msg');
  const email = el.querySelector('#fb-email');
  const count = el.querySelector('#fb-count');
  const err = el.querySelector('#fb-err');
  const btn = el.querySelector('#fb-send');
  ctx.status(STATUS);
  msg.addEventListener('input', () => { count.textContent = counterText(msg.value.length); });
  const start = takePrefill();
  if (start) { msg.value = start; count.textContent = counterText(start.length); }
  let busy = false;
  const submit = async () => {
    if (busy) return;
    const payload = feedbackPayload({ message: msg.value, email: email.value, screen: ctx.previous || null, website: el.querySelector('#fb-website').value });
    if (!payload.message) { err.textContent = 'Write something first.'; err.hidden = false; msg.focus(); return; }
    busy = true;
    btn.disabled = true;
    err.hidden = true;
    ctx.status('SENDING...');
    try {
      await send(payload);
      if (!el.isConnected) return;
      el.querySelector('#fb-body').innerHTML = `<p class="card-alert">${esc(THANKS)}</p>`;
      ctx.status('FEEDBACK SENT');
      goal('feedback_sent');
    } catch (e) {
      if (!el.isConnected) return;
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
      busy = false;
      ctx.status('FEEDBACK NOT SENT', 'warn');
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  msg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  });
  email.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  // Esc in the form hands the keyboard back to the command bar.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); document.getElementById('cmd')?.focus(); }
  });
  // Keyboard first: the note takes the focus, after the command bar lets go.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (!coarse) setTimeout(() => { if (el.isConnected) { msg.focus(); msg.setSelectionRange(msg.value.length, msg.value.length); } }, 0);
}
