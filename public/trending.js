// TRENDING's counter, browser side: when a ticker screen opens, tell the server "some
// session opened this symbol". The session id is random, made for this browser session
// only (sessionStorage, gone when the tab closes), and never linked to anything else.
// One beacon per symbol per hour per page load; the server dedupes again.

const KEY = 'bb.sid';

// Does opening this command count? Only a ticker screen (QUOTE: stocks, ETFs, indexes,
// FX, crypto, commodities, yields), never inside a DESK panel (embed=1) and never while
// the first-visit notice is still waiting for ACCEPT.
export function countsAsOpen(cmd, { embed = false, consentPending = true } = {}) {
  return Boolean(cmd && cmd.name === 'QUOTE' && !cmd.error && cmd.args?.ticker && !embed && !consentPending);
}
const HOUR = 3_600_000;
const sent = new Map(); // symbol -> time sent
let memoryId = null;

export function randomId(cryptoImpl = globalThis.crypto) {
  const b = new Uint8Array(16);
  cryptoImpl.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// This session's id: kept in sessionStorage, or in memory when storage is blocked.
export function sessionId(storage = globalThis.sessionStorage) {
  try {
    let v = storage.getItem(KEY);
    if (!v || !/^[a-f0-9]{32}$/.test(v)) {
      v = randomId();
      storage.setItem(KEY, v);
    }
    return v;
  } catch {
    memoryId ||= randomId();
    return memoryId;
  }
}

// Should this symbol be sent now? Once per symbol per hour per page load.
export function shouldSend(symbol, now = Date.now(), log = sent) {
  const at = log.get(symbol);
  if (at !== undefined && now - at < HOUR) return false;
  log.set(symbol, now);
  return true;
}

export function sendSeen(symbol) {
  try {
    if (!symbol || !shouldSend(symbol)) return;
    const body = JSON.stringify({ s: symbol, v: sessionId() });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/seen', body)) return;
    fetch('/api/seen', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch { /* counting never gets in the way */ }
}
