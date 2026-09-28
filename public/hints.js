// Rolling hints in the command bar's placeholder: while the bar is empty and nobody is
// typing, "Try AAPL 1Y", "Try GRAVEYARD", "Try FX 500 USD THB"... one every few
// seconds, typed out quickly (with reduced motion: a plain swap). They stop for good once this browser has
// run HINT_STOP commands (localStorage bb.tried, or the recent commands already saved),
// and the bar keeps its plain placeholder from then on.

// A market command, then a quirky one, in turn.
export const MARKET_HINTS = ['Try AAPL 1Y', 'Try FX 500 USD THB', 'Try WHY NVDA', 'Try CPI', 'Try GOLD', 'Try GRID NVDA AMD INTC'];
export const QUIRKY_HINTS = ['Try GRAVEYARD', 'Try GUESS', 'Try SECTORS MAP', 'Try WHATIF IPHONE6', 'Try WEIRD', 'Try FISHTANK'];
export const HINTS = MARKET_HINTS.flatMap((m, i) => [m, QUIRKY_HINTS[i]]);
export const HINT_KEY = 'bb.tried';
export const HINT_STOP = 3;
export const HINT_EVERY = 3000; // ms a hint stays up
export const HINT_TYPE = 40; // ms per letter

const localStore = (storage) => {
  try { return storage === undefined ? globalThis.localStorage : storage; } catch { return null; }
};

// Commands run in this browser so far (0 without storage). Never throws.
export function triedCount(storage) {
  try {
    const n = Number(localStore(storage)?.getItem(HINT_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

// One more command run -> the new count, which never goes past HINT_STOP. known: the
// count so far (the page keeps its own, so hints stop even without storage). Never throws.
export function countTried(storage, known = triedCount(storage)) {
  const n = Math.min(HINT_STOP, Math.max(known, triedCount(storage)) + 1);
  try { localStore(storage)?.setItem(HINT_KEY, String(n)); } catch { /* no storage: hints show each visit */ }
  return n;
}

// Done with hints: HINT_STOP commands run, or a returning visitor (that many saved).
export function hintsDone({ storage, historyLength = 0 } = {}) {
  return triedCount(storage) >= HINT_STOP || historyLength >= HINT_STOP;
}

// Start rolling. input: the command bar (its placeholder now is the plain one, put back
// on stop). paused(): true while typing (or, on a phone, while the bar has focus): the
// hint then stays as it is. reduced(): plain swaps, no typing. -> { stop(), running }.
export function startHints({ input, paused = () => false, reduced = () => false, hints = HINTS, every = HINT_EVERY, typeMs = HINT_TYPE, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const plain = input.placeholder;
  let timer = null;
  let i = 0;
  let stopped = false;
  const later = (fn, ms) => { timer = schedule(fn, ms); };

  function show() {
    if (stopped) return;
    if (paused()) { later(show, every); return; }
    const text = hints[i % hints.length];
    i += 1;
    if (reduced()) { input.placeholder = text; later(show, every); return; }
    let n = 0;
    const type = () => {
      if (stopped) return;
      // Typing started halfway: the whole hint at once, then wait.
      if (paused()) { input.placeholder = text; later(show, every); return; }
      n += 1;
      input.placeholder = text.slice(0, n);
      if (n < text.length) later(type, typeMs);
      else later(show, every);
    };
    type();
  }
  show();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) cancel(timer);
      timer = null;
      input.placeholder = plain;
    },
    get running() { return !stopped; },
  };
}
