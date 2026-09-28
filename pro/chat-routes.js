// CHAT routes: private chat between Pro seats who added each other. Every route needs an
// active Pro key (X-Pro-Key); every write also needs a same-origin browser request.
// Every room read or write checks that the licence is in the room (not left): an
// outsider gets 404, never a hint that the room exists.
//
//   GET  /api/chat                          -> { me, requests: { in, out }, rooms, cursor }
//   GET  /api/chat/unread                   -> { count }   unread messages + requests waiting
//   GET  /api/chat/wait?after=<id>          -> { events, last }   long-poll, up to 25 s
//   GET  /api/chat/rooms/:id/messages?before=&after=&limit=   -> { messages, more } (marks read)
//   POST /api/chat/open        { seats }    -> { room } | { sent, message }
//   POST /api/chat/rooms/:id/messages { text, card? } -> { message }
//   POST /api/chat/requests/:seat { action: accept|ignore|block } -> { ok, room? }
//   POST /api/chat/rooms/:id   { action: leave|add|block|unblock, seat? } -> { ok, room? }
//   POST /api/chat/rooms/:id/report { reason? } -> { ok, message }
//   PUT  /api/chat/me          { name }     -> { me }
//
// Nothing that goes out holds a key, a key hash or a licence id: people are { seat, name }.

import express from 'express';
import { normalizeKey } from './licence.js';
import { publicStatus, KEY_HEADER } from './routes.js';
import { createLimiter, clientIp } from './ratelimit.js';
import { sameOrigin, cleanMessage } from './feedback.js';
import {
  ChatError, checkText, cleanCard, cleanName, cleanSeats, tickersIn, createHub, MAX_REASON, DAY_MS,
} from './chat.js';
import { createChatStore } from './chat-store.js';

const MIN = 60 * 1000;
export const STAMP_MS = 2500; // a quote that takes longer: the ticker goes without a price
const ID_RE = /^\d{1,12}$/;
const ACTIONS = new Set(['accept', 'ignore', 'block']);
const ROOM_ACTIONS = new Set(['leave', 'add', 'block', 'unblock']);

export function chatLimits(now = () => Date.now()) {
  return {
    send: createLimiter({ max: 30, windowMs: MIN, now }),
    request: createLimiter({ max: 10, windowMs: DAY_MS, now }),
    name: createLimiter({ max: 10, windowMs: DAY_MS, now }),
    report: createLimiter({ max: 10, windowMs: DAY_MS, now }),
    // Every write but a message (open, requests, room actions, report, name) per licence.
    write: createLimiter({ max: 60, windowMs: 60 * MIN, now }),
    // Reads (list, messages, unread, wait) per licence: plenty for a few open tabs.
    read: createLimiter({ max: 3000, windowMs: 10 * MIN, now }),
  };
}

// deps: db (the Pro database), store (licences), guess (the shared wrong-key limiter from
// mountPro, so CHAT is no second place to guess keys), mode (the Stripe mode), getQuote
// (the server's quote function), parse + linkChanges (the terminal's parser, for cards).
export function mountChat(app, {
  db, store, guess = createLimiter({ max: 20, windowMs: 15 * MIN }), mode = 'live', publicUrl = 'https://bloombroke.com',
  getQuote = async () => null, parse, linkChanges, titleOf = null, now = () => Date.now(), limits = chatLimits(now),
  hub = createHub({ now }), stampMs = STAMP_MS, log = console,
}) {
  if (!parse || !linkChanges) throw new Error('mountChat needs the terminal parser');
  const chat = createChatStore(db, { now });
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  const limited = (res, r, message = 'Too many tries. Wait a minute and try again.') => {
    res.set('Retry-After', String(r.retryAfter));
    return fail(res, 429, 'rate_limited', message);
  };
  const nudge = (out, type, room = null) => { if (out?.notify?.length) hub.emit(out.notify, room ? { type, room } : { type }); };

  // The licence behind X-Pro-Key, active, with a seat; or the error is sent and null returned.
  function auth(req, res) {
    const ip = clientIp(req);
    if (guess.blocked(ip)) { limited(res, guess.hit(ip)); return null; }
    const key = normalizeKey(req.get(KEY_HEADER) || '');
    const lic = key ? store.findByKey(key) : null;
    if (!lic) {
      guess.hit(ip);
      fail(res, 401, 'bad_key', 'That key is not valid. Check it and try LOGIN again.');
      return null;
    }
    if (!publicStatus(lic, now(), mode).active) { fail(res, 402, 'not_active', 'CHAT needs an active Pro licence.'); return null; }
    if (!Number.isInteger(lic.seat)) { fail(res, 409, 'no_seat', 'This licence has no seat number yet.'); return null; }
    return lic;
  }

  // The $TICKERs of a message with the price at send time: { sym, price, at }, or { sym }
  // when the quote fails or is slow.
  async function stamp(text) {
    return Promise.all(tickersIn(text).map(async (sym) => {
      let timer;
      try {
        const late = new Promise((resolve) => { timer = setTimeout(resolve, stampMs, null); timer.unref?.(); });
        const q = await Promise.race([Promise.resolve().then(() => getQuote(`$${sym}`)), late]);
        // A stale quote is no price at send time: the symbol only. The time is the
        // quote's own, when it has one.
        if (q && !q.stale && Number.isFinite(q.last) && q.last > 0) {
          const own = Date.parse(q.asOf || '');
          return { sym, price: q.last, at: Number.isFinite(own) ? own : now() };
        }
      } catch { /* no price */ } finally { clearTimeout(timer); }
      return { sym };
    }));
  }

  const roomId = (req) => (ID_RE.test(req.params.id) ? Number(req.params.id) : null);

  const r = express.Router();
  r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Writes: from this site's own pages only.
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Use CHAT on bloombroke.com.');
    next();
  });
  r.use((req, res, next) => {
    const lic = auth(req, res);
    if (!lic) return;
    req.lic = lic;
    // Messages have their own limit (30 a minute); every other write shares 60 an hour.
    const sending = req.method === 'POST' && /^\/rooms\/\d+\/messages$/.test(req.path);
    if (!sending) {
      const hit = (req.method === 'GET' ? limits.read : limits.write).hit(`lic:${lic.id}`);
      if (!hit.ok) return limited(res, hit);
    }
    next();
  });
  const body = express.json({ limit: '2kb' });

  r.get('/', (req, res) => {
    const lic = req.lic.id;
    const cursor = hub.cursor();
    res.json({ me: chat.me(lic), requests: chat.requests(lic), rooms: chat.list(lic), cursor });
  });

  r.get('/unread', (req, res) => res.json({ count: chat.unread(req.lic.id) }));

  r.get('/wait', (req, res) => {
    const after = Number(req.query.after);
    let sent = false;
    // evicted: a newer wait of the same licence took this one's place (3 at most); the
    // client waits a little before asking again.
    const answer = (events, last, evicted = false) => {
      if (sent || res.writableEnded || res.destroyed) return;
      sent = true;
      res.json(evicted ? { events, last, evicted: true } : { events, last });
    };
    req.socket?.setTimeout?.(0);
    const cancel = hub.wait(req.lic.id, Number.isFinite(after) && after > 0 ? after : 0, answer);
    if (!cancel) {
      res.set('Retry-After', '15');
      return fail(res, 503, 'busy', 'CHAT is busy. It tries again by itself.');
    }
    res.on('close', cancel);
  });

  r.get('/rooms/:id/messages', (req, res) => {
    const id = roomId(req);
    const num = (v) => (ID_RE.test(String(v ?? '')) ? Number(v) : null);
    // read=0: a tab in the background asks without marking anything read.
    const out = id === null ? null : chat.messages(id, req.lic.id, { before: num(req.query.before), after: num(req.query.after), limit: num(req.query.limit) || undefined, read: req.query.read !== '0' });
    if (!out) return fail(res, 404, 'not_found', 'No such chat.');
    res.json(out);
  });

  r.post('/open', body, (req, res) => {
    const lic = req.lic;
    const seats = cleanSeats(req.body?.seats);
    const isActive = (id) => { const l = store.findById(id); return Boolean(l && publicStatus(l, now(), mode).active); };
    const out = chat.open(lic.id, seats, { allowRequest: () => limits.request.hit(`lic:${lic.id}`).ok, isActive });
    if (out.sent) {
      nudge(out, 'requests');
      return res.json({ sent: true, seat: out.seat, message: `Request sent to SEAT ${out.seat}.` });
    }
    nudge(out, 'rooms', out.room);
    res.json({ room: chat.room(out.room, lic.id), accepted: Boolean(out.accepted) });
  });

  r.post('/rooms/:id/messages', body, async (req, res, next) => {
    try {
      const id = roomId(req);
      const lic = req.lic;
      if (id === null || !chat.room(id, lic.id)) return fail(res, 404, 'not_found', 'No such chat.');
      const card = cleanCard(req.body?.card, { parse, linkChanges, titleOf });
      const text = checkText(req.body?.text, { hasCard: Boolean(card) });
      const hit = limits.send.hit(`lic:${lic.id}`);
      if (!hit.ok) return limited(res, hit, 'That is a lot of messages for one minute. Slow down a little.');
      const tickers = await stamp(text);
      const out = chat.send(id, lic.id, { text, card, tickers });
      nudge(out, 'message', id);
      res.json({ message: out.message });
    } catch (err) { next(err); }
  });

  r.post('/requests/:seat', body, (req, res) => {
    const seat = ID_RE.test(req.params.seat) ? Number(req.params.seat) : null;
    const action = req.body?.action;
    if (!seat || !ACTIONS.has(action)) return fail(res, 400, 'bad_request', 'Send { action: accept, ignore or block }.');
    const out = chat.respond(req.lic.id, seat, action);
    nudge(out, action === 'accept' ? 'rooms' : 'requests', out.room || null);
    res.json(out.room ? { ok: true, room: chat.room(out.room, req.lic.id) } : { ok: true });
  });

  r.post('/rooms/:id', body, (req, res) => {
    const id = roomId(req);
    const action = req.body?.action;
    if (id === null) return fail(res, 404, 'not_found', 'No such chat.');
    if (!ROOM_ACTIONS.has(action)) return fail(res, 400, 'bad_request', 'Send { action: leave, add, block or unblock }.');
    let seat = null;
    if (action === 'add') [seat] = cleanSeats([req.body?.seat], { max: 1 });
    const out = chat.act(id, req.lic.id, action, seat);
    nudge(out, 'rooms', id);
    res.json({ ok: true, room: out.left ? null : chat.room(id, req.lic.id) });
  });

  r.post('/rooms/:id/report', body, (req, res) => {
    const id = roomId(req);
    if (id === null || !chat.room(id, req.lic.id)) return fail(res, 404, 'not_found', 'No such chat.');
    const raw = req.body?.reason;
    if (raw !== undefined && raw !== null && typeof raw !== 'string') return fail(res, 400, 'bad_request', 'Send { reason }.');
    const reason = cleanMessage(raw || '').replace(/\s+/g, ' ').trim();
    if (reason.length > MAX_REASON) return fail(res, 400, 'too_long', `Keep the reason under ${MAX_REASON} characters.`);
    const hit = limits.report.hit(`lic:${req.lic.id}`);
    if (!hit.ok) return limited(res, hit, 'That is a lot of reports for one day. Email hello@bloombroke.com.');
    chat.report(id, req.lic.id, reason || null);
    res.json({ ok: true, message: 'Reported. We will look at it.' });
  });

  r.put('/me', body, (req, res) => {
    if (!req.body || typeof req.body !== 'object' || !('name' in req.body)) return fail(res, 400, 'bad_request', 'Send { name }.');
    const name = cleanName(req.body.name);
    const hit = limits.name.hit(`lic:${req.lic.id}`);
    if (!hit.ok) return limited(res, hit, 'That is a lot of name changes for one day. Try again tomorrow.');
    const me = chat.setName(req.lic.id, name);
    // Your other tabs redraw; the people you chat with see it on their next load.
    hub.emit([req.lic.id], { type: 'rooms' });
    res.json({ me });
  });

  r.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ChatError) return fail(res, err.status, err.code, err.message);
    if (err?.type === 'entity.too.large') return fail(res, 413, 'too_long', 'That message is too long.');
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_json', 'That is not valid JSON.');
    log.error('[chat]', err?.message);
    return fail(res, 500, 'error', 'Something went wrong. Try again in a minute.');
  });

  app.use('/api/chat', r);
  return { chat, hub, purge: (t) => chat.purge(t) };
}
