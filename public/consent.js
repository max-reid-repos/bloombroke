// The first-visit notice: information only, not advice, you agree to the Terms and are
// 18 or older. ACCEPT (or Enter) stores { version, acceptedAt } in localStorage. A new
// TERMS_VERSION asks again. Without localStorage it falls back to sessionStorage (once
// per browser session), and without either to memory (once per page load).
// The HTML never changes, so crawlers still read the page and its share meta.

import { TERMS_VERSION } from './legal-version.js';

export const CONSENT_KEY = 'bb.consent';
export const LEGAL_PATHS = ['/terms', '/privacy', '/disclaimer'];

export const CONSENT_TEXT = {
  lead: 'Bloombroke gives market information only. It is not investment advice. Data may be delayed or wrong.',
  body: 'By continuing you agree to the Terms and Privacy Policy and confirm you are 18 or older.',
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

let open = null;

// Show the notice when it is needed. Resolves once accepted (or at once when not needed).
export function ensureConsent({ doc = document, win = window, store = consentStore(browserStorages(win)), version = TERMS_VERSION, now = () => new Date() } = {}) {
  if (isLegalPath(win.location?.pathname) || !needsConsent(store.get(), version)) return Promise.resolve(false);
  if (open) return open;
  open = new Promise((resolve) => {
    const wrap = doc.createElement('div');
    wrap.className = 'consent';
    wrap.innerHTML = `<div class="consent-box" role="dialog" aria-modal="true" aria-labelledby="consent-lead" aria-describedby="consent-body">
      <p class="consent-k">BEFORE YOU START</p>
      <p class="consent-lead" id="consent-lead">${CONSENT_TEXT.lead}</p>
      <p class="consent-body" id="consent-body">By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a> and confirm you are 18 or older.</p>
      <div class="consent-actions">
        <button type="button" class="consent-accept">ACCEPT (Enter)</button>
        <span class="consent-links"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/disclaimer">Disclaimer</a></span>
      </div>
    </div>`;
    const button = wrap.querySelector('.consent-accept');
    const active = doc.activeElement;

    function accept() {
      store.set(acceptRecord(version, now()));
      win.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('focusin', keepFocus);
      wrap.remove();
      open = null;
      // Back to the command bar (or whatever had focus), unless on a touch screen.
      const input = doc.getElementById('cmd');
      const coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
      const back = input || active;
      if (!coarse && back && typeof back.focus === 'function' && doc.contains(back)) back.focus();
      resolve(true);
    }
    // While the notice is open, keys do not reach the terminal. Enter accepts; Tab moves
    // between the button and the links.
    function onKey(e) {
      if (e.key === 'Tab') {
        const items = [...wrap.querySelectorAll('button, a')];
        const i = items.indexOf(doc.activeElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
        items[next].focus();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // Anything else stays with the browser (shortcuts, Enter on a link), not the terminal.
      e.stopImmediatePropagation();
      const onLink = doc.activeElement && doc.activeElement.tagName === 'A' && wrap.contains(doc.activeElement);
      if (e.key === 'Enter' && !onLink) {
        e.preventDefault();
        accept();
      }
    }

    // Focus stays in the notice, even when the terminal focuses its command bar after this.
    function keepFocus(e) {
      if (!wrap.contains(e.target)) button.focus();
    }

    button.addEventListener('click', accept);
    win.addEventListener('keydown', onKey, true);
    doc.addEventListener('focusin', keepFocus);
    doc.body.appendChild(wrap);
    button.focus();
  });
  return open;
}
