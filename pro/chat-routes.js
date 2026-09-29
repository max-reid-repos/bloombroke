// CHAT routes: private chat between Pro seats who added each other. Every route needs an
// active Pro key (X-Pro-Key); every write also needs a same-origin browser request.
// Every room read or write checks that the licence is in the room (not left): an
// outsider gets 404, never a hint that the room exists.
//
//   GET  /api/chat                          -> { me, requests: { in, out }, rooms, cursor }
//   GET  /api/chat/unread                   -> { count }   unread messages + requests waiting
//   GET  /api/chat/wait?after=<id>          -> { events, last }   long-poll, up to 25 s
//   GET  /api/chat/rooms/:id/messages?before=&after=&limit=   -> { messages, more } (marks read)
//   POST /api/chat/open        { seats } | { name } -> { room } | { sent, message }   (CHAT 42, CHAT @name)
//   POST /api/chat/rooms/:id/messages { text, card? } -> { message }
//   POST /api/chat/requests/:seat { action: accept|ignore|block } -> { ok, room? }
//   POST /api/chat/rooms/:id   { action: leave|add|block|unblock, seat? } -> { ok, room? }
//   POST /api/chat/rooms/:id/report { reason? } -> { ok, message }
//   PUT  /api/chat/me          { name }     -> { me }   (an alias of ME's username: pro/me-routes.js)
//   POST /api/chat/rooms/:id/drive { action: start|stop|follow|unfollow } -> { drive, cursor } | { ok }
//   POST /api/chat/rooms/:id/drive/cmd { cmd } -> { ok, cmd, seq, followers }   the driver's screen
//   POST /api/chat/guess       { n, guesses, rooms: [id] | 'all' } -> { posted, already, result }
//
// DRIVE: one driver per room; followers opt in with FOLLOW and get each screen as a hub
// event { type: 'drive', room, by, cmd, seq }, never stored. 'drive-end' tells the driver
// and followers it is over; 'drive-count' tells the driver how many follow. A drive stops
// after 10 minutes without a screen, or when the driver's page has not listened (a wait)
// for 60 seconds. GUESS LEAGUE: a result is the server's replay of the guesses
// (data/guess.js verifyPlay); TODAY'S GUESS rides on the messages answer ({ guess }), and
// last week's winner line is posted on the first room load after the week ends.
//
// Nothing that goes out holds a key, a key hash or a licence id: people are { seat, name,
// color, avatar } (name: the username from ME).
// ME's routes (/api/me) are mounted from here too (pro/me-routes.js): they share the CHAT
// profile rows and the wrong-key limiter.

import express from 'express';
import { normalizeKey } from './licence.js';
import { publicStatus, KEY_HEADER } from './routes.js';
import { createLimiter, clientIp } from './ratelimit.js';
import { sameOrigin, cleanMessage } from './feedback.js';
import {
  ChatError, checkText, cleanCard, cleanUsername, cleanSeats, tickersIn, createHub, MAX_REASON, DAY_MS, AT_NAME_RE,
} from './chat.js';
import { mountMe, meLimits } from './me-routes.js';
import { isDeletedLicence } from './store.js';
import { createChatStore } from './chat-store.js';
import {
  createDrives, drivingLine, stoppedLine, label, DRIVE_GONE_MS, DRIVE_CMDS_PER_MIN,
} from './chat.js';
import { verifyPlay, loadSecret, puzzleNumber, GuessError, TRIES as GUESS_TRIES } from '../data/guess.js';
import { nyToday } from '../public/ranges.js';

const MIN = 60 * 1000;
export const STAMP_MS = 2500; // a quote that takes longer: the ticker goes without a price
const ID_RE = /^\d{1,12}$/;
const ACTIONS = new Set(['accept', 'ignore', 'block']);
const ROOM_ACTIONS = new Set(['leave', 'add', 'block', 'unblock']);
const DRIVE_ACTIONS = new Set(['start', 'stop', 'follow', 'unfollow']);
export const DRIVE_SWEEP_MS = 15_000;

// GUESS LEAGUE: the week before the one this New York date is in, Monday to Sunday.
export function lastWeek(day) {
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  const mon = t - (((new Date(t).getUTCDay() + 6) % 7) + 7) * DAY_MS;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return { week: iso(mon), from: iso(mon), to: iso(mon + 6 * DAY_MS) };
}
// A day's GUESS points: 7 minus the tries when solved (1 try: 6 points), 0 when not.
export const guessPoints = (tries, solved) => (solved ? GUESS_TRIES + 1 - tries : 0);

export function chatLimits(now = () => Date.now()) {
  return {
    send: createLimiter({ max: 30, windowMs: MIN, now }),
    request: createLimiter({ max: 10, windowMs: DAY_MS, now }),
    report: createLimiter({ max: 10, windowMs: DAY_MS, now }),
    // Every write but a message (open, requests, room actions, report, name) per licence.
    write: createLimiter({ max: 60, windowMs: 60 * MIN, now }),
    // Reads (list, messages, unread, wait) per licence: plenty for a few open tabs.
    read: createLimiter({ max: 3000, windowMs: 10 * MIN, now }),
    // DRIVE: the driver's screens, per licence.
    drive: createLimiter({ max: DRIVE_CMDS_PER_MIN, windowMs: MIN, now }),
  };
}

// deps: db (the Pro database), store (licences), guess (the shared wrong-key limiter from
// mountPro, so CHAT is no second place to guess keys), mode (the Stripe mode), getQuote
// (the server's quote function), parse + linkChanges (the terminal's parser, for cards).
export function mountChat(app, {
  db, store, guess = createLimiter({ max: 20, windowMs: 15 * MIN }), mode = 'live', publicUrl = 'https://bloombroke.com',
  getQuote = async () => null, parse, linkChanges, titleOf = null, now = () => Date.now(), limits = chatLimits(now),
  hub = createHub({ now }), stampMs = STAMP_MS, log = console, guessSecret = null, sweepMs = DRIVE_SWEEP_MS,
  meLimitsFor = meLimits(now),
}) {
  if (!parse || !linkChanges) throw new Error('mountChat needs the terminal parser');
  const chat = createChatStore(db, { now });
  // Old display names that break a username rule now go back to SEAT 42 (015_profiles.sql).
  try {
    const n = chat.sweepNames();
    if (n.aborted) log.error(`[chat] name sweep stopped, nothing cleared: ${n.aborted}`);
    else if (n.cleared) log.log?.(`[chat] ${n.cleared} usernames that break a rule were cleared`);
  } catch (err) { log.error('[chat] name sweep', err?.message); }
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
    // DRIVE screens have theirs (60 a minute), counted in the route.
    const sending = req.method === 'POST' && /^\/rooms\/\d+\/(messages|drive\/cmd)$/.test(req.path);
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
    res.json({ me: chat.me(lic), requests: chat.requests(lic), rooms: chat.list(lic).map((x) => withDrive(x, lic)), cursor });
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
    const before = num(req.query.before);
    const day = nyToday(new Date(now()));
    // GUESS LEAGUE: the first load after a week ends posts last week's winner, once.
    if (id !== null && before === null && chat.isMember(id, req.lic.id)) {
      try { nudge(chat.weekly(id, lastWeek(day)), 'message', id); } catch (err) { log.error('[chat] weekly', err?.message); }
    }
    // read=0: a tab in the background asks without marking anything read.
    const out = id === null ? null : chat.messages(id, req.lic.id, { before, after: num(req.query.after), limit: num(req.query.limit) || undefined, read: req.query.read !== '0' });
    if (!out) return fail(res, 404, 'not_found', 'No such chat.');
    // TODAY'S GUESS: the strip, when anyone here posted today's result.
    const n = puzzleNumber(day);
    const scores = chat.guessToday(id, req.lic.id, n);
    res.json(scores.length ? { ...out, guess: { n, of: GUESS_TRIES, scores } } : out);
  });

  r.post('/open', body, (req, res) => {
    const lic = req.lic;
    // A deleted account (ME) has no Pro to chat with, whatever its billing status says.
    const isActive = (id) => { const l = store.findById(id); return Boolean(l && !isDeletedLicence(l) && publicStatus(l, now(), mode).active); };
    const allowRequest = () => limits.request.hit(`lic:${lic.id}`).ok;
    // CHAT @name: the same answer whether the name exists or not, and the same limits as
    // CHAT 42. The seat behind a name is never sent back.
    if (req.body?.name !== undefined) {
      const m = AT_NAME_RE.exec(`@${String(req.body.name ?? '').replace(/^@/, '')}`);
      if (!m) throw new ChatError('bad_name', 'Type CHAT and a username: CHAT @tom.');
      const out = chat.openName(lic.id, m[1], { allowRequest, isActive });
      if (out.sent) {
        nudge(out, 'requests');
        return res.json({ sent: true, message: `Request sent to @${m[1]}.` });
      }
      nudge(out, 'rooms', out.room);
      return res.json({ room: chat.room(out.room, lic.id), accepted: Boolean(out.accepted) });
    }
    const seats = cleanSeats(req.body?.seats);
    const out = chat.open(lic.id, seats, { allowRequest, isActive });
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
    checkDrive(id); // DRIVE: a driver who left, or a DM now closed, ends the drive
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

  // The old NAME: now the username of ME, with its rules (3 changes a day, unique).
  r.put('/me', body, (req, res) => {
    if (!req.body || typeof req.body !== 'object' || !('name' in req.body)) return fail(res, 400, 'bad_request', 'Send { name }.');
    const username = cleanUsername(req.body.name);
    const me = chat.setProfile(req.lic.id, { username });
    // Your other tabs redraw; the people you chat with see it on their next load.
    hub.emit([req.lic.id], { type: 'rooms' });
    res.json({ me });
  });

  // ---- DRIVE --------------------------------------------------------------------------
  const drives = createDrives({ now });
  const driveView = (roomId, lic) => {
    const d = drives.get(roomId);
    if (!d || (d.driver !== lic && chat.blockedEither(d.driver, lic))) return null;
    const out = { by: d.by, own: d.driver === lic, following: d.followers.has(lic) };
    if (out.own) out.followers = d.followers.size;
    return out;
  };
  function withDrive(view, lic) {
    const drive = view ? driveView(view.id, lic) : null;
    return drive ? { ...view, drive } : view;
  }
  const countTo = (roomId, d) => hub.emit([d.driver], { type: 'drive-count', room: roomId, followers: d.followers.size });
  // The drive of this room is over: the driver and followers hear it, the room gets a line.
  function endDrive(roomId) {
    const d = drives.stop(roomId);
    if (!d) return;
    hub.emit([d.driver, ...d.followers], { type: 'drive-end', room: roomId });
    nudge(chat.system(roomId, stoppedLine(label(d.by.seat, d.by.name))), 'message', roomId);
  }
  // Ends a drive that should not go on; drops followers who left or stopped listening.
  function checkDrive(roomId) {
    const d = drives.get(roomId);
    if (!d) return;
    if (drives.idle(d) || !hub.alive(d.driver, DRIVE_GONE_MS) || !chat.canWrite(roomId, d.driver)) { endDrive(roomId); return; }
    let dropped = false;
    for (const f of [...d.followers]) {
      if (!hub.alive(f, DRIVE_GONE_MS) || !chat.isMember(roomId, f) || chat.blockedEither(f, d.driver)) { d.followers.delete(f); dropped = true; }
    }
    if (dropped) countTo(roomId, d);
  }
  const sweep = () => {
    for (const [roomId] of drives.rooms()) {
      try { checkDrive(roomId); } catch (err) { log.error('[chat] drive', err?.message); }
    }
  };
  if (sweepMs > 0) setInterval(sweep, sweepMs).unref?.();

  r.post('/rooms/:id/drive', body, (req, res) => {
    const id = roomId(req);
    const lic = req.lic.id;
    const action = req.body?.action;
    if (id === null || !chat.isMember(id, lic)) return fail(res, 404, 'not_found', 'No such chat.');
    if (!DRIVE_ACTIONS.has(action)) return fail(res, 400, 'bad_request', 'Send { action: start, stop, follow or unfollow }.');
    const d = drives.get(id);
    if (action === 'start') {
      if (!chat.canWrite(id, lic)) return fail(res, 409, 'read_only', 'This chat is closed.');
      // No takeover across a block, either way.
      if (d && d.driver !== lic && chat.blockedEither(d.driver, lic)) return fail(res, 409, 'taken', 'Someone else is driving here.');
      hub.touch(lic);
      if (d?.driver !== lic) {
        const by = chat.me(lic);
        const prev = drives.start(id, lic, by);
        // A takeover: the old driver and their followers stop (following is opt-in).
        if (prev) hub.emit([prev.driver, ...prev.followers], { type: 'drive-end', room: id });
        nudge(chat.system(id, drivingLine(label(by.seat, by.name))), 'message', id);
      }
      return res.json({ drive: driveView(id, lic), cursor: hub.cursor() });
    }
    if (action === 'stop') {
      if (!d || d.driver !== lic) return fail(res, 409, 'not_driver', 'You are not driving here.');
      endDrive(id);
      return res.json({ ok: true });
    }
    if (action === 'follow') {
      if (!d || d.driver === lic || chat.blockedEither(d.driver, lic)) return fail(res, 409, 'no_drive', 'Nobody is driving here now.');
      drives.follow(id, lic);
      hub.touch(lic);
      countTo(id, d);
      return res.json({ drive: { by: d.by, cmd: d.cmd, seq: d.seq }, cursor: hub.cursor() });
    }
    if (d && drives.unfollow(id, lic)) countTo(id, d);
    return res.json({ ok: true });
  });

  r.post('/rooms/:id/drive/cmd', body, (req, res, next) => {
    try {
      const id = roomId(req);
      const lic = req.lic.id;
      if (id === null || !chat.isMember(id, lic)) return fail(res, 404, 'not_found', 'No such chat.');
      const hit = limits.drive.hit(`lic:${lic}`);
      if (!hit.ok) return limited(res, hit, 'That is a lot of screens for one minute. Slow down a little.');
      const d = drives.get(id);
      if (!d || d.driver !== lic) return fail(res, 409, 'not_driver', 'You are not driving here.');
      // The card rule: a known screen that changes nothing and holds no secret.
      const card = cleanCard({ cmd: req.body?.cmd }, { parse, linkChanges, titleOf });
      if (!chat.canWrite(id, lic)) { endDrive(id); return fail(res, 409, 'not_driver', 'This chat is closed.'); }
      const sent = drives.send(id, lic, card.cmd);
      for (const f of [...d.followers]) {
        if (!chat.isMember(id, f) || chat.blockedEither(f, lic)) d.followers.delete(f);
      }
      if (d.followers.size) hub.emit([...d.followers], { type: 'drive', room: id, by: d.by, cmd: sent.cmd, seq: sent.seq });
      res.json({ ok: true, cmd: sent.cmd, seq: sent.seq, followers: d.followers.size });
    } catch (err) { next(err); }
  });

  // ---- GUESS LEAGUE ----------------------------------------------------------------------
  let secret = guessSecret;
  r.post('/guess', body, (req, res) => {
    const lic = req.lic.id;
    let play;
    try {
      secret ||= loadSecret({ log });
      play = verifyPlay(req.body?.n, req.body?.guesses, { secret, now: () => new Date(now()) });
    } catch (err) {
      if (err instanceof GuessError) return fail(res, err.status, err.code, err.message);
      throw err;
    }
    const want = req.body?.rooms;
    const ids = want === 'all' ? chat.list(lic).map((x) => x.id)
      : Array.isArray(want) ? want.filter((v) => Number.isInteger(v) && v > 0).slice(0, 100) : [];
    if (!ids.length) return fail(res, 400, 'bad_request', 'Pick a chat.');
    const out = chat.postGuess(ids, lic, { ...play, of: GUESS_TRIES, points: guessPoints(play.tries, play.solved) });
    for (const p of out.posted) nudge(p, 'message', p.room);
    if (!out.posted.length) {
      return out.already.length ? fail(res, 409, 'already', 'Today\'s GUESS is in that chat already.') : fail(res, 404, 'not_found', 'No such chat.');
    }
    res.json({ posted: out.posted.map((p) => p.room), already: out.already, result: { n: play.n, tries: play.tries, solved: play.solved, of: GUESS_TRIES } });
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
  // ME: /api/me (profile, export, delete). A deleted account's drives end quietly: the
  // driver and followers hear drive-end, and no "stopped" line names the account.
  const endDrivesOf = (licId) => {
    for (const [roomId, d] of drives.rooms()) {
      if (d.driver === licId) {
        drives.stop(roomId);
        hub.emit([d.driver, ...d.followers], { type: 'drive-end', room: roomId });
      } else if (d.followers.delete(licId)) countTo(roomId, d);
    }
  };
  // NEW KEY: the licence's open long-polls answer at once; the old key's next call is 401.
  store.onKeyChange?.((licId) => hub.emit([licId], { type: 'rooms' }));
  mountMe(app, {
    db, store, chat, hub, guess, mode, publicUrl, now, log, limits: meLimitsFor, onDelete: endDrivesOf,
  });
  return { chat, hub, drives, sweep, purge: (t) => chat.purge(t) };
}
