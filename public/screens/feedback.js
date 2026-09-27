// FEEDBACK (and IDEA): a short note to us, from anyone, free or Pro. One panel: the
// note, an optional email, SEND. Ctrl+Enter in the note or Enter in the email sends.
// The note goes to POST /api/feedback with the screen you came from, for context.

import { esc, panel, metaNote } from './markets.js';
import { goal } from '../goal.js'; // GOALS

export const MAX_FEEDBACK = 1000;
export const PROMPT = 'What should we fix or build?';
export const EMAIL_LABEL = 'Email, only if you want a reply';
export const THANKS = 'Thanks. We read every one.';
export const CONTACT = 'hello@bloombroke.com';

export const counterText = (n) => `${n} / ${MAX_FEEDBACK}`;

// What the form sends. screen: the address bar form of the command you came from.
export function feedbackPayload({ message, email, screen, website }) {
  const out = { message: String(message ?? '').trim(), screen: screen || null };
  const e = String(email ?? '').trim();
  if (e) out.email = e;
  if (website) out.website = String(website);
  return out;
}

export function formHtml() {
  return `<form id="fb-form" class="fb" novalidate>
      <label class="fb-l" for="fb-msg">${esc(PROMPT)}</label>
      <textarea id="fb-msg" class="fb-msg" maxlength="${MAX_FEEDBACK}" rows="5" spellcheck="true"></textarea>
      <p class="fb-count num" id="fb-count" aria-live="polite">${counterText(0)}</p>
      <label class="fb-l" for="fb-email">${esc(EMAIL_LABEL)}</label>
      <input id="fb-email" class="fb-email" type="email" maxlength="254" autocomplete="email" spellcheck="false">
      <input id="fb-website" class="fb-hp" name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="pro-actions"><button type="submit" class="btn btn-solid" id="fb-send">SEND</button><span class="muted fb-keys">Ctrl+Enter sends</span></p>
      <p class="notice warn" id="fb-err" hidden></p>
    </form>`;
}

export function feedbackHtml() {
  return panel('1', 'Feedback', `<div id="fb-body">${formHtml()}</div>
    <p class="muted fb-mail">Or email <a href="mailto:${CONTACT}">${CONTACT}</a></p>`, { cls: 'panel-solo', meta: metaNote('NO IP ADDRESS STORED') });
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
  ctx.status('FEEDBACK: WRITE A NOTE, CTRL+ENTER SENDS');
  msg.addEventListener('input', () => { count.textContent = counterText(msg.value.length); });
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
      el.querySelector('#fb-body').innerHTML = `<p class="notice">${esc(THANKS)}</p>`;
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
  if (!coarse) setTimeout(() => { if (el.isConnected) msg.focus(); }, 0);
}
