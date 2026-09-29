// Bloombroke's service worker: PINGS only (pro/push.js, public/push.js). It shows a push
// as a notification, opens the page a notification points at, and moves a subscription
// the browser replaced to its new address. No fetch handler and no cache: the site
// loads exactly as it does without it. Registered from ME when pings are turned on.
//
// A push is { t: title, b: body, u: url on this site, g: tag }, encrypted end to end.

const HOME = `${self.location.origin}/`;

// A url on this site, or the home page: a ping never opens another site.
function safeUrl(u) {
  try {
    const url = new URL(typeof u === 'string' && u ? u : '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : HOME;
  } catch {
    return HOME;
  }
}

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  if (!d || typeof d !== 'object') d = {};
  const title = typeof d.t === 'string' && d.t ? d.t.slice(0, 120) : 'Bloombroke';
  const opts = {
    body: typeof d.b === 'string' ? d.b.slice(0, 240) : '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { u: safeUrl(d.u) },
  };
  if (typeof d.g === 'string' && d.g) {
    opts.tag = d.g.slice(0, 64);
    opts.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, opts));
});

// A click: a tab of this site on that page gets the focus; otherwise the first tab of
// this site gets it and goes there; with no tab, a new window opens.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data?.u);
  event.waitUntil((async () => {
    const wins = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter((w) => { try { return new URL(w.url).origin === self.location.origin; } catch { return false; } });
    const same = wins.find((w) => w.url === url);
    if (same) { await same.focus(); return; }
    const w = wins[0];
    if (w) {
      try {
        await w.focus();
        try { await w.navigate(url); } catch { /* a tab opened before pings: it keeps its screen */ }
        return;
      } catch { /* the browser would not focus it: open a new one */ }
    }
    await self.clients.openWindow(url);
  })());
});

// The browser replaced the subscription (it expired or its keys changed): subscribe
// again with the site's key and tell the server, which knows the old address.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    if (!old?.endpoint) return;
    let sub = event.newSubscription;
    if (!sub) {
      let key = old.options?.applicationServerKey;
      if (!key) {
        const r = await fetch('/api/push/key', { headers: { Accept: 'application/json' } });
        if (!r.ok) return;
        const k = (await r.json()).key;
        const b64 = k.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (k.length % 4)) % 4);
        key = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      }
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    await fetch('/api/push/resubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ old: old.endpoint, sub: sub.toJSON() }),
    });
  })());
});
