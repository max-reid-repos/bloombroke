// The first-visit WELCOME card, which is also the notice: information only, not advice,
// you agree to the Terms and are 18 or older. Continuing in any way (START, Enter, a chip)
// stores { version, acceptedAt } in localStorage. The card has its own command input:
// words typed before it showed (in the command bar) start there, and on START or Enter
// they go to the command bar and the terminal runs them (app.js). A chip accepts and runs
// its command in one go (screens/welcome.js, loaded on first visit only). A new
// TERMS_VERSION asks again. Without localStorage it falls back to sessionStorage (once
// per browser session), and without either to memory (once per page load).
// The HTML never changes, so crawlers still read the page and its share meta.

import { TERMS_VERSION } from './legal-version.js';
import { lazyScreen, loadScreen, loadedModule, cssReady, stylesOf } from './lazy.js';
import { goal, gaConsentGiven } from './goal.js'; // GOALS: welcome_chip, welcome_typed, welcome_surprise; GA4 waits for ACCEPT

export const CONSENT_KEY = 'bb.consent';
export const LEGAL_PATHS = ['/terms', '/privacy', '/disclaimer'];

export const CONSENT_TEXT = {
  title: 'BLOOMBROKE',
  line: 'A market terminal you drive with your keyboard. Free.',
  try: 'Type anything, or try one:',
  lead: 'Information only, not advice.',
  body: 'By continuing you agree to the Terms and Privacy Policy and confirm you are 18+.',
};

// Does this record still count? Only an acceptance of the current version does.
export function needsConsent(record, version = TERMS_VERSION) {
  return !(record && typeof record === 'object' && record.version === version && Number.isFinite(Date.parse(record.acceptedAt)));
}

export function isLegalPath(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '') || '/';
  return LEGAL_PATHS.includes(p);
}

// A storage that works: can it write, read back and remove a probe?
function usable(storage) {
  try {
    if (!storage) return false;
    const k = '__bb_probe__';
    storage.setItem(k, '1');
    const ok = storage.getItem(k) === '1';
    storage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

// { get(), set(record), mode }: 'local', 'session' or 'memory'.
export function consentStore({ local, session } = {}) {
  const backing = usable(local) ? local : usable(session) ? session : null;
  let memory = null;
  return {
    mode: backing === local && backing ? 'local' : backing ? 'session' : 'memory',
    get() {
      if (!backing) return memory;
      try { const v = backing.getItem(CONSENT_KEY); return v ? JSON.parse(v) : null; } catch { return memory; }
    },
    set(record) {
      memory = record;
      if (!backing) return;
      try { backing.setItem(CONSENT_KEY, JSON.stringify(record)); } catch { /* memory keeps it for this page */ }
    },
  };
}

export function acceptRecord(version = TERMS_VERSION, now = new Date()) {
  return { version, acceptedAt: now.toISOString() };
}

// The browser's storages, each read inside try/catch (a blocked one throws on access).
export function browserStorages(win = globalThis) {
  const get = (name) => { try { return win[name]; } catch { return null; } };
  return { local: get('localStorage'), session: get('sessionStorage') };
}

// Is the notice needed on this page? (Sync: the terminal holds a deep link until ACCEPT.)
export function consentNeeded({ win = window, store = consentStore(browserStorages(win)), version = TERMS_VERSION } = {}) {
  return !isLegalPath(win.location?.pathname) && needsConsent(store.get(), version);
}

// A key in the moment before the card is on the page (its chips still loading) -> what
// happens to the words typed so far. { typed, action }: 'accept' (Enter), 'type' (a
// letter, a space, Backspace) or 'pass'.
export function consentKey(typed, e) {
  if (e.key === 'Enter') return { typed, action: 'accept' };
  if (e.ctrlKey || e.metaKey || e.altKey) return { typed, action: 'pass' };
  if (e.key === 'Backspace') return { typed: typed.slice(0, -1), action: 'type' };
  // A space before any words stays with the ACCEPT button.
  if (e.key === ' ' && !typed) return { typed, action: 'pass' };
  if (e.key.length === 1) return { typed: (typed + e.key).slice(0, 120), action: 'type' };
  return { typed, action: 'pass' };
}


// --- the WELCOME card -----------------------------------------------------------------

// The chips (screens/welcome.js and its stylesheet), loaded once, on first visit only.
// app.js starts this at boot when the card will show, so it is here by the time it does.
export const WELCOME_JS = 'screens/welcome.js';
let welcomeLoad = null;
export function loadWelcome() {
  if (!welcomeLoad) {
    welcomeLoad = loadScreen(lazyScreen(WELCOME_JS), stylesOf(WELCOME_JS)).catch(() => { welcomeLoad = null; return null; });
  }
  return welcomeLoad;
}
// The chips module if it and its stylesheet are on the page already, else null.
function welcomeNow() {
  const m = loadedModule(WELCOME_JS);
  return m && stylesOf(WELCOME_JS).every(cssReady) ? m : null;
}

// Continuing: the record of acceptance first, then the goal. choice: { cmd } typed, or
// { cmd, chip } a chip, or { cmd, surprise } SURPRISE ME. -> the command to run ('' for
// none). goalOpts: goal()'s options (tests).
export function commitWelcome(choice, { store, version = TERMS_VERSION, now = () => new Date(), goalOpts } = {}) {
  store.set(acceptRecord(version, now()));
  gaConsentGiven(); // GA4 (goal.js) starts only now, for this visit and the next ones
  const cmd = String(choice?.cmd || '').trim().slice(0, 120);
  if (choice?.chip) goal('welcome_chip', { chip: choice.chip }, goalOpts);
  else if (choice?.surprise) goal('welcome_surprise', { kind: choice.surprise }, goalOpts);
  else if (cmd) goal('welcome_typed', undefined, goalOpts);
  return cmd;
}

// The card's HTML. ui: the chips module, or null (it did not load: the card still works,
// with the input and START only). The legal line is always there, under the chips.
export function welcomeHtml(ui) {
  const t = CONSENT_TEXT;
  return `<div class="consent-box" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="consent-title" aria-describedby="consent-body">
      <p class="consent-k" id="consent-title">${t.title}</p>
      <p class="consent-lead">${t.line}</p>
      ${ui ? `<p class="consent-try" id="consent-try">${t.try}</p>` : ''}
      <form class="consent-bar" autocomplete="off">
        <span class="consent-prompt" aria-hidden="true">&gt;</span>
        <input class="consent-input" type="text" maxlength="120" spellcheck="false" autocapitalize="characters" autocorrect="off" enterkeyhint="go" aria-label="Type a command">
        <button type="submit" class="consent-accept btn-solid">START</button>
      </form>
      ${ui ? ui.chipsHtml() : ''}
      <p class="consent-body" id="consent-body">${t.lead} By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a> and confirm you are 18+. <a href="/disclaimer">Disclaimer</a></p>
    </div>`;
}

let open = null;

// Show the card when it is needed. Resolves once accepted (or at once when not needed):
// the command to run is then in the command bar (#cmd), and app.js runs it.
// waitMs: how long the card waits for its chips before it shows without them.
export function ensureConsent({ doc = document, win = window, store = consentStore(browserStorages(win)), version = TERMS_VERSION, now = () => new Date(), load = loadWelcome, ready = welcomeNow, rand = Math.random, waitMs = 1500, goalOpts } = {}) {
  if (isLegalPath(win.location?.pathname) || !needsConsent(store.get(), version)) return Promise.resolve(false);
  if (open) return open;
  open = new Promise((resolve) => {
    const active = doc.activeElement;
    const input = doc.getElementById('cmd');
    const coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
    // Words typed before the card (in the command bar) and while its chips load.
    let typed = input?.value || '';
    let mounted = false;

    // Until the card is on the page, keys do not reach the terminal: letters are kept,
    // Enter waits (nothing is accepted before the card and its legal line show).
    function holdKey(e) {
      e.stopImmediatePropagation();
      const next = consentKey(typed, e);
      if (next.action === 'pass') return;
      e.preventDefault();
      if (next.action === 'type') typed = next.typed;
    }

    function mount(ui) {
      if (mounted) return;
      mounted = true;
      win.removeEventListener('keydown', holdKey, true);
      const wrap = doc.createElement('div');
      wrap.className = ui ? 'consent consent-welcome' : 'consent';
      wrap.innerHTML = welcomeHtml(ui);
      const field = wrap.querySelector('.consent-input');
      const start = wrap.querySelector('.consent-accept');
      const box = wrap.querySelector('.consent-box');
      field.value = typed;
      const chips = () => [...wrap.querySelectorAll('.wc-chip, .wc-surprise')];
      // Focus rests in the input; on a phone on the card itself, so no keyboard pops up.
      const home = () => (coarse ? box : field);
      let done = false;

      function finish(choice) {
        if (done) return;
        done = true;
        const cmd = commitWelcome(choice, { store, version, now, goalOpts });
        if (input) input.value = cmd;
        win.removeEventListener('keydown', onKey, true);
        doc.removeEventListener('focusin', keepFocus);
        wrap.remove();
        open = null;
        // Back to the command bar (or whatever had focus), unless on a touch screen.
        const back = input || active;
        if (!coarse && back && typeof back.focus === 'function' && doc.contains(back)) back.focus();
        resolve(true);
      }
      // SURPRISE ME answers with a promise (it asks which gauges are empty first); START,
      // typing and the other chips still work meanwhile, and the first choice wins.
      const chipPressed = (el) => {
        const c = ui?.chipChoice(el, rand);
        if (c && typeof c.then === 'function') c.then((x) => { if (x) finish(x); }, () => {});
        else if (c) finish(c);
      };

      // While the card is open, keys do not reach the terminal. Enter on a chip runs it,
      // anywhere else it starts with what is typed (a link keeps its Enter). Arrows move
      // between the chips; a letter typed on a chip goes to the input. Tab stays inside.
      function onKey(e) {
        e.stopImmediatePropagation();
        if (e.isComposing || e.keyCode === 229) return; // an IME is composing
        const a = doc.activeElement;
        if (e.key === 'Tab') {
          const items = [field, start, ...chips(), ...wrap.querySelectorAll('a')];
          const i = items.indexOf(a);
          const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
          items[next].focus();
          e.preventDefault();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (a && a.tagName === 'A' && wrap.contains(a)) return;
        const list = chips();
        const i = list.indexOf(a);
        if (e.key === 'Enter') {
          e.preventDefault();
          if (i >= 0) chipPressed(list[i]);
          else finish({ cmd: field.value });
          return;
        }
        if (ui && (i >= 0 || a === field)) {
          const to = ui.chipNav(a === field ? -1 : i, e.key, list.length);
          if (to !== null) { e.preventDefault(); (to < 0 ? field : list[to]).focus(); return; }
        }
        const k = typeof e.key === 'string' ? e.key : '';
        if (a !== field && ((k.length === 1 && k !== ' ') || k === 'Backspace')) {
          e.preventDefault();
          field.value = k === 'Backspace' ? field.value.slice(0, -1) : (field.value + k).slice(0, 120);
          field.focus();
        }
      }
      // Focus stays in the card, even when the terminal focuses its command bar after this.
      function keepFocus(e) {
        if (!wrap.contains(e.target)) home().focus();
      }

      wrap.querySelector('.consent-bar').addEventListener('submit', (e) => { e.preventDefault(); finish({ cmd: field.value }); });
      wrap.addEventListener('click', (e) => {
        const el = e.target.closest?.('.wc-chip, .wc-surprise');
        if (el && wrap.contains(el)) chipPressed(el);
      });
      win.addEventListener('keydown', onKey, true);
      doc.addEventListener('focusin', keepFocus);
      doc.body.appendChild(wrap);
      home().focus();
    }

    const now1 = ready();
    if (now1) { mount(now1); return; }
    win.addEventListener('keydown', holdKey, true);
    const timer = setTimeout(() => mount(null), waitMs);
    Promise.resolve().then(load).then((ui) => { clearTimeout(timer); mount(ui || null); }, () => { clearTimeout(timer); mount(null); });
  });
  return open;
}
