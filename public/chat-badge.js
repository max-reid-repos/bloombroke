// CHAT 2 next to the seat: unread chat messages plus requests waiting, Pro only. Asked on
// load and every minute while the tab is visible (GET /api/chat/unread); the CHAT screen
// paints it at once with a 'bb:chat-unread' event. The only chat code in the page's
// startup bundle: the screen itself (screens/chat.js) loads when CHAT opens.

import { getKey, isPro, HEADER } from './pro.js';

export const BADGE_MS = 60_000;

// 2 -> 'CHAT 2'; 0, unknown or nonsense -> '' (hidden).
export function badgeText(n) {
  if (!Number.isInteger(n) || n < 1) return '';
  return `CHAT ${n > 99 ? '99+' : n}`;
}

export function paintBadge(el, n) {
  if (!el) return;
  const t = badgeText(n);
  el.textContent = t;
  el.hidden = !t;
  if (t) el.title = `${n} unread in CHAT`;
}

// Returns stop(). timer: the shell's liveTimer (skips while hidden, catches up when shown).
export function mountChatBadge(el, { timer = null, fetchImpl = globalThis.fetch, win = globalThis.window, pro = isPro, key = getKey } = {}) {
  if (!el || typeof fetchImpl !== 'function') return () => {};
  let busy = false;
  const load = () => {
    if (!pro()) { paintBadge(el, 0); return; }
    if (busy || globalThis.document?.hidden) return;
    busy = true;
    Promise.resolve()
      .then(() => fetchImpl('/api/chat/unread', { headers: { Accept: 'application/json', [HEADER]: key() }, cache: 'no-store' }))
      .then((r) => (r?.ok ? r.json() : null))
      .then((d) => paintBadge(el, d?.count), () => {})
      .finally(() => { busy = false; });
  };
  const onCount = (e) => { if (pro()) paintBadge(el, e.detail); };
  win?.addEventListener?.('bb:chat-unread', onCount);
  win?.addEventListener?.('bb:pro', load);
  load();
  const stop = timer ? timer(load, BADGE_MS) : ((id) => () => clearInterval(id))(setInterval(load, BADGE_MS));
  return () => { stop(); win?.removeEventListener?.('bb:chat-unread', onCount); win?.removeEventListener?.('bb:pro', load); };
}
