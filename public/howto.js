// HOW TO PLAY: a small pop-up that says how a game screen works, on the native <dialog>
// (showModal). Shared: GUESS uses it now, WHATIF and GRID can later. Only the screens
// that use it load it (lazy.js, by name), never the page itself. Styles: howto.css, in
// the look of the first-visit WELCOME card (legal.css, screens/welcome.css).
//
//   howtoHtml(slots)   the pop-up's markup, the slots always in this order:
//     title    'How to play'
//     goal     one line: what you are trying to do
//     lines    up to 3 short lines
//     example  markup the screen draws with its own classes (GUESS: one real guess row);
//              its table cells flip in one by one (none with reduced motion)
//     legend   [{ cls, label, say }]: tiny cells with the screen's own classes, a word
//              each (say: what the colour is, for screen readers)
//     foot     one small line
//     button   the one primary button; it closes the pop-up (PLAY)
//   mountHowto(opts)   wires it to a screen: it opens by itself once (a key in
//     localStorage, set when it closes), never over the WELCOME card, never in a DESK
//     panel or any other frame; ? opens it again, but not while typing in the command
//     bar. Esc, a click on the backdrop and the button close it; the focus goes back to
//     the command bar.

import { consentNeeded } from './consent.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const MAX_LINES = 3;

export function howtoHtml({ title = 'How to play', goal = '', lines = [], example = '', legend = [], foot = '', button = 'PLAY' } = {}) {
  const list = lines.slice(0, MAX_LINES);
  const keys = legend.map((k) => `<li class="howto-k"><span class="howto-sw ${esc(k.cls)}" aria-hidden="true"></span>${k.say ? `<span class="offscreen">${esc(k.say)}: </span>` : ''}${esc(k.label)}</li>`);
  return `<div class="howto-box">
    <div class="howto-head">
      <h2 class="howto-title" id="howto-title">${esc(title)}</h2>
      ${goal ? `<p class="howto-goal">${esc(goal)}</p>` : ''}
    </div>
    ${list.length ? `<ul class="howto-lines">${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${example || keys.length ? `<div class="howto-ex">${example}${keys.length ? `<ul class="howto-legend">${keys.join('')}</ul>` : ''}</div>` : ''}
    ${foot ? `<p class="howto-foot">${esc(foot)}</p>` : ''}
    <div class="howto-act"><button type="button" class="btn card-btn btn-solid howto-go" data-howto-close autofocus>${esc(button)}</button></div>
  </div>`;
}

// ---- seen once ------------------------------------------------------------------------
// Every read and write in try/catch: a blocked storage throws, even on access. Without
// storage it is remembered for this page only.
const memory = new Set();
export function howtoSeen(key, win = globalThis) {
  if (memory.has(key)) return true;
  try { return win.localStorage.getItem(key) !== null; } catch { return false; }
}
export function markHowtoSeen(key, win = globalThis, now = new Date()) {
  memory.add(key);
  try { win.localStorage.setItem(key, JSON.stringify(now.toISOString())); } catch { /* this page only */ }
}

// ---- where it may show ------------------------------------------------------------------
// A DESK panel (embed mode) or any frame: never.
export function inFrame(win = globalThis, doc = globalThis.document) {
  try {
    if (doc?.documentElement?.classList?.contains('is-embed')) return true;
    return Boolean(win.top && win.self && win.top !== win.self);
  } catch {
    return true; // a frame we cannot look out of
  }
}

// The WELCOME card is up (or about to be: the notice is still needed).
export function consentBusy(doc, needed) {
  try { return Boolean(doc.querySelector('.consent')) || Boolean(needed()); } catch { return false; }
}

// Runs fn once the WELCOME card is gone (at once when it is not there). -> stop().
export function afterConsent(fn, { doc, needed, Observer = globalThis.MutationObserver, every = 500 } = {}) {
  if (!consentBusy(doc, needed)) { fn(); return () => {}; }
  let stopped = false;
  let obs = null;
  let timer = null;
  const stop = () => { stopped = true; obs?.disconnect(); if (timer) clearInterval(timer); };
  const check = () => { if (!stopped && !consentBusy(doc, needed)) { stop(); fn(); } };
  if (typeof Observer === 'function') {
    obs = new Observer(check);
    obs.observe(doc.body, { childList: true });
  } else {
    timer = setInterval(check, every);
  }
  return stop;
}

// ? opens it: not in the command bar, not in another text field, except the screen's
// own fields that never take a ? (fields: a selector, GUESS: its guess input).
export function isHowtoKey(e, fields = '') {
  if (!e || e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  const t = e.target;
  if (!t || t.id === 'cmd') return false;
  if (fields && t.closest?.(fields)) return true;
  return !t.closest?.('input, select, textarea, [contenteditable]');
}

// ---- the pop-up on a screen ---------------------------------------------------------------
// opts: { key, slots, auto (open once by itself), fields, doc, win, needed (the notice is
// still needed: consent.js) }. -> { open(), close(), destroy(), isOpen() }.
export function mountHowto({ key, slots, auto = true, fields = '', doc = document, win = window, needed = () => consentNeeded({ win }), Observer } = {}) {
  let current = null; // { d, done } while it is open
  let dead = false;
  let stopWait = null;
  const framed = inFrame(win, doc);
  const coarse = () => { try { return Boolean(win.matchMedia?.('(pointer: coarse)').matches); } catch { return false; } };

  function open() {
    if (dead || current || framed) return false;
    const d = doc.createElement('dialog');
    d.className = 'howto howto-flip';
    d.setAttribute('aria-labelledby', 'howto-title');
    d.innerHTML = howtoHtml(slots);
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      if (current?.d === d) current = null;
      d.remove();
      markHowtoSeen(key, win);
      // Back to the command bar (on a touch screen nothing, so no keyboard pops up).
      const bar = doc.getElementById('cmd');
      if (!coarse() && bar && typeof bar.focus === 'function') bar.focus();
    };
    current = { d, done };
    d.addEventListener('close', done);
    // The button, or a click on the backdrop (the dialog itself: its box fills it).
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target?.closest?.('[data-howto-close]')) shut(d, done);
    });
    // Esc closes it here, so it never reaches the terminal (Esc there goes back a screen).
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      shut(d, done);
    });
    doc.body.appendChild(d);
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    return true;
  }
  function close() {
    if (current) shut(current.d, current.done);
  }

  function onKey(e) {
    if (dead || !isHowtoKey(e, fields)) return;
    e.preventDefault();
    e.stopPropagation();
    open();
  }
  doc.addEventListener('keydown', onKey, true);

  if (auto && !framed && !howtoSeen(key, win)) stopWait = afterConsent(open, { doc, needed, Observer });

  return {
    open,
    close,
    isOpen: () => Boolean(current),
    // The screen is gone: no more ?, no waiting, and an open pop-up closes.
    destroy() {
      dead = true;
      stopWait?.();
      doc.removeEventListener('keydown', onKey, true);
      close();
    },
  };
}

// Close a dialog: its own close() (its close event does the rest), else by hand.
function shut(d, done) {
  if (typeof d.close === 'function' && d.open !== false) d.close();
  else done();
}
