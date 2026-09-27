// GET /api/news/stream?tabs=MARKETS,SEC: Server-Sent Events from the news hub
// (data/newshub.js). Events:
//   event: news  id: <boot-seq>  data: { tab, items }   stories that are new
//   event: sync                  data: { tab, items }   the tab's list (on connect, and
//                                                       when a feed first loads)
//   : hb                                                a comment every 25 s, so a proxy
//                                                       (Cloudflare Tunnel) never sees
//                                                       an idle connection
// A reconnect with Last-Event-ID (the header EventSource sends, or ?last= when the page
// opens a new one) first gets the news events it missed.
//
// At most MAX_CONN streams in all and MAX_PER_IP per address (counted in memory while
// the stream is open, never stored). Past a cap the answer is 503 or 429 and the page
// falls back to polling.

export const MAX_CONN = 2000;
export const MAX_PER_IP = 4;
export const HEARTBEAT_MS = 25_000;
export const STREAM_TABS = ['MARKETS', 'MACRO', 'SEC', 'WIRES', 'WSB'];

// One SSE message. Data is JSON on one line (JSON never holds a raw newline).
export function sseFrame({ event = null, id = null, data = null } = {}) {
  let s = '';
  if (event) s += `event: ${event}\n`;
  if (id) s += `id: ${id}\n`;
  s += `data: ${JSON.stringify(data)}\n\n`;
  return s;
}

// "MARKETS,sec" -> ['MARKETS', 'SEC'], or null when empty or any tab is unknown.
export function parseTabs(raw) {
  if (typeof raw !== 'string' || raw.length > 60) return null;
  const tabs = [...new Set(raw.toUpperCase().split(',').map((t) => t.trim()).filter(Boolean))];
  return tabs.length && tabs.every((t) => STREAM_TABS.includes(t)) ? tabs : null;
}

export function mountNewsStream(app, hub, { maxConn = MAX_CONN, maxPerIp = MAX_PER_IP, heartbeatMs = HEARTBEAT_MS, ipOf = (req) => req.ip || req.socket?.remoteAddress || '?' } = {}) {
  const perIp = new Map();
  const open = new Set();
  let beat = null;

  function heartbeat() {
    if (beat || !open.size) return;
    beat = setInterval(() => {
      for (const res of open) res.write(': hb\n\n');
    }, heartbeatMs);
    beat.unref?.();
  }

  app.get('/api/news/stream', (req, res) => {
    const tabs = parseTabs(req.query.tabs);
    if (!tabs) return res.status(400).json({ error: 'bad_tab', message: 'No such news tab.' });
    if (open.size >= maxConn) {
      return res.status(503).set({ 'Retry-After': '60', 'Cache-Control': 'no-store' }).json({ error: 'busy', message: 'Live news is full. The page checks every minute instead.' });
    }
    const ip = ipOf(req);
    if ((perIp.get(ip) || 0) >= maxPerIp) {
      return res.status(429).set({ 'Retry-After': '60', 'Cache-Control': 'no-store' }).json({ error: 'too_many', message: 'Too many live news streams from here. The page checks every minute instead.' });
    }
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    open.add(res);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: a proxy must not compress (and so buffer) the stream.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    req.socket?.setNoDelay?.(true);
    req.socket?.setTimeout?.(0);
    res.write('retry: 5000\n\n');

    const lastEventId = req.get('last-event-id') || (typeof req.query.last === 'string' ? req.query.last.slice(0, 40) : null);
    const client = { send: (ev) => { if (!res.writableEnded) res.write(sseFrame(ev)); } };
    const unsubscribe = hub.subscribe(tabs, client, { lastEventId });
    heartbeat();

    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      open.delete(res);
      const n = (perIp.get(ip) || 1) - 1;
      if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
      if (!open.size && beat) { clearInterval(beat); beat = null; }
    };
    req.on('close', done);
    res.on('close', done);
    res.on('error', done);
  });

  return {
    connections: () => open.size,
    addresses: () => perIp.size,
    closeAll: () => { for (const res of [...open]) res.end(); },
  };
}
