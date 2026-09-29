// CHAT storage: names, requests, rooms, members, messages, blocks and reports, in the Pro
// database (migrations/013_chat.sql). Everything here takes internal licence ids; the
// route finds the licence from the key. What goes out is { seat, name } only, never a
// key, a key hash or a licence id.
//
// Contacts: two licences are contacts when they share a DM and neither blocked the
// other. A group can only be made from, and grown with, your own contacts.

import { tx } from './db.js';
import {
  ChatError, label, KEEP_MS, REPORT_KEEP_MS, MAX_MEMBERS, MAX_OUT, PAGE, SNAPSHOT, DAY_MS, MAX_GROUPS_DAY,
  NAME_TAKEN, usernameOk, MAX_NAME_CHANGES, RELEASE_MS,
} from './chat.js';
import { ENDED_KEEP_MS } from './store.js';

const PREVIEW = 60;
// In a group, messages from someone you blocked are hidden for you (@filter = 1 in a
// group, 0 in a DM, which turns read-only instead). @me is the reader.
const HIDDEN = '(@filter = 0 OR c.licence_id IS NULL OR c.licence_id NOT IN (SELECT blocked_licence FROM chat_blocks WHERE licence_id = @me))';
const MAX_ROOMS = 100;
const dmKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const otherOf = (key, me) => key.split(':').map(Number).find((n) => n !== me) ?? me;
// A licence whose Pro ended over 30 days ago (the synced-data rule, store.js purgeEnded).
const ENDED = `(
  (status IN ('canceled', 'unpaid') AND ended_at IS NOT NULL AND ended_at <= @before)
  OR (gift_expires_at IS NOT NULL AND stripe_subscription_id IS NULL AND gift_expires_at <= @before)
)`;

// A person as everyone sees them: seat, username, colour, avatar. Never a licence id.
export const who = (r) => ({ seat: r.seat ?? null, name: r.name || null, color: Number.isInteger(r.color) ? r.color : null, avatar: r.avatar || null });

function preview(m) {
  const t = String(m.body || '').split('\n')[0].trim() || m.card_title || m.card_cmd || '';
  return t.length > PREVIEW ? `${t.slice(0, PREVIEW - 3).trimEnd()}...` : t;
}

// Member labels joined: 'Tom 42, SEAT 88 +2' (fits a list row).
export function groupTitle(labels, max = 40) {
  let out = '';
  let n = 0;
  for (const l of labels) {
    const next = out ? `${out}, ${l}` : l;
    if (out && next.length > max) break;
    out = next;
    n += 1;
  }
  return n < labels.length ? `${out} +${labels.length - n}` : out;
}

export function createChatStore(db, { now = () => Date.now() } = {}) {
  const q = {
    licBySeat: db.prepare('SELECT id, seat FROM licences WHERE seat = ?'),
    seatOf: db.prepare('SELECT l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM licences l LEFT JOIN chat_profiles p ON p.licence_id = l.id WHERE l.id = ?'),
    // ME: the profile row (migrations/015_profiles.sql).
    profileOf: db.prepare('SELECT * FROM chat_profiles WHERE licence_id = ?'),
    profileMake: db.prepare('INSERT OR IGNORE INTO chat_profiles (licence_id, updated_at) VALUES (?, ?)'),
    profileSet: db.prepare(`UPDATE chat_profiles SET username = @username, color = @color, avatar = @avatar,
      name_changes = @changes, name_window = @window, updated_at = @t WHERE licence_id = @lic`),
    nameOwner: db.prepare('SELECT licence_id FROM chat_profiles WHERE lower(username) = lower(?) AND username IS NOT NULL'),
    nameLocked: db.prepare('SELECT 1 FROM name_releases WHERE name_key = ? AND released_at > ? AND (licence_id IS NULL OR licence_id != ?) LIMIT 1'),
    release: db.prepare('INSERT INTO name_releases (name_key, licence_id, released_at) VALUES (?, ?, ?)'),
    oldReleases: db.prepare('DELETE FROM name_releases WHERE released_at <= ?'),
    allNames: db.prepare('SELECT licence_id, username FROM chat_profiles WHERE username IS NOT NULL'),
    dropName: db.prepare('UPDATE chat_profiles SET username = NULL WHERE licence_id = ?'),
    licByName: db.prepare(`SELECT l.id, l.seat FROM chat_profiles p JOIN licences l ON l.id = p.licence_id
      WHERE lower(p.username) = lower(?) AND p.username IS NOT NULL`),
    dm: db.prepare("SELECT * FROM chat_rooms WHERE dm_key = ?"),
    room: db.prepare('SELECT * FROM chat_rooms WHERE id = ?'),
    newRoom: db.prepare('INSERT INTO chat_rooms (kind, dm_key, created_by, created_at, last_at) VALUES (?, ?, ?, ?, ?)'),
    touch: db.prepare('UPDATE chat_rooms SET last_at = ? WHERE id = ?'),
    member: db.prepare('SELECT * FROM chat_members WHERE room_id = ? AND licence_id = ?'),
    active: db.prepare('SELECT * FROM chat_members WHERE room_id = ? AND licence_id = ? AND left_at IS NULL'),
    join: db.prepare(`INSERT INTO chat_members (room_id, licence_id, joined_at, from_id) VALUES (@room, @lic, @t, @from)
      ON CONFLICT (room_id, licence_id) DO UPDATE SET left_at = NULL, joined_at = @t, from_id = @from, last_read_id = 0`),
    leave: db.prepare('UPDATE chat_members SET left_at = ? WHERE room_id = ? AND licence_id = ? AND left_at IS NULL'),
    members: db.prepare(`SELECT m.licence_id, l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM chat_members m JOIN licences l ON l.id = m.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = m.licence_id WHERE m.room_id = ? AND m.left_at IS NULL ORDER BY m.joined_at, m.licence_id`),
    myRooms: db.prepare(`SELECT r.*, m.from_id, m.last_read_id FROM chat_rooms r JOIN chat_members m ON m.room_id = r.id
      WHERE m.licence_id = ? AND m.left_at IS NULL ORDER BY r.last_at DESC, r.id DESC LIMIT ${MAX_ROOMS}`),
    groupsOf: db.prepare(`SELECT r.id FROM chat_rooms r JOIN chat_members m ON m.room_id = r.id
      WHERE r.kind = 'group' AND m.licence_id = ? AND m.left_at IS NULL`),
    maxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM chat_messages WHERE room_id = ?'),
    lastMsg: db.prepare(`SELECT * FROM chat_messages c WHERE room_id = @room AND id > @from AND ${HIDDEN} ORDER BY id DESC LIMIT 1`),
    // Server lines (kind 'sys': "Tom 1 is driving.") are never unread.
    unreadIn: db.prepare(`SELECT COUNT(*) AS n FROM chat_messages c WHERE room_id = @room AND id > @mark AND (licence_id IS NULL OR licence_id != @lic) AND c.kind IS NOT 'sys' AND ${HIDDEN}`),
    unreadAll: db.prepare(`SELECT COUNT(*) AS n FROM chat_messages c JOIN chat_members m ON m.room_id = c.room_id AND m.licence_id = @lic AND m.left_at IS NULL
      JOIN chat_rooms r ON r.id = c.room_id
      WHERE c.id > MAX(m.last_read_id, m.from_id) AND (c.licence_id IS NULL OR c.licence_id != @lic) AND c.kind IS NOT 'sys'
        AND (r.kind = 'dm' OR c.licence_id IS NULL OR c.licence_id NOT IN (SELECT blocked_licence FROM chat_blocks WHERE licence_id = @lic))`),
    page: db.prepare(`SELECT c.*, l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM chat_messages c LEFT JOIN licences l ON l.id = c.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = c.licence_id
      WHERE c.room_id = @room AND c.id > @from AND c.id < @before AND ${HIDDEN} ORDER BY c.id DESC LIMIT @limit`),
    after: db.prepare(`SELECT c.*, l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM chat_messages c LEFT JOIN licences l ON l.id = c.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = c.licence_id
      WHERE c.room_id = @room AND c.id > MAX(@from, @after) AND ${HIDDEN} ORDER BY c.id ASC LIMIT @limit`),
    snapshot: db.prepare(`SELECT c.*, l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM chat_messages c LEFT JOIN licences l ON l.id = c.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = c.licence_id
      WHERE c.room_id = @room AND c.id > @from ORDER BY c.id DESC LIMIT @limit`),
    read: db.prepare('UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE room_id = ? AND licence_id = ?'),
    send: db.prepare('INSERT INTO chat_messages (room_id, licence_id, body, card_cmd, card_title, tickers_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    // DRIVE and GUESS LEAGUE (migrations/014_chat_drive_guess.sql)
    sys: db.prepare("INSERT INTO chat_messages (room_id, licence_id, body, kind, created_at) VALUES (?, NULL, ?, 'sys', ?)"),
    sendGuess: db.prepare("INSERT INTO chat_messages (room_id, licence_id, body, card_cmd, card_title, kind, created_at) VALUES (?, ?, ?, 'GUESS', ?, 'guess', ?)"),
    guessOf: db.prepare('SELECT n, tries, solved FROM chat_guess WHERE message_id = ?'),
    guessHas: db.prepare('SELECT 1 FROM chat_guess WHERE room_id = ? AND licence_id = ? AND n = ?'),
    guessAdd: db.prepare(`INSERT INTO chat_guess (room_id, licence_id, n, day, tries, solved, points, message_id, created_at)
      VALUES (@room, @lic, @n, @day, @tries, @solved, @points, @msg, @t)`),
    guessDay: db.prepare(`SELECT g.licence_id, g.tries, g.solved, g.created_at, l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM chat_guess g JOIN licences l ON l.id = g.licence_id
      JOIN chat_members m ON m.room_id = g.room_id AND m.licence_id = g.licence_id AND m.left_at IS NULL
      LEFT JOIN chat_profiles p ON p.licence_id = g.licence_id
      WHERE g.room_id = @room AND g.n = @n
        AND (@filter = 0 OR g.licence_id NOT IN (SELECT blocked_licence FROM chat_blocks WHERE licence_id = @me))
      ORDER BY g.solved DESC, g.tries ASC, g.created_at ASC`),
    guessWeek: db.prepare(`SELECT g.licence_id, SUM(g.points) AS points, l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM chat_guess g JOIN licences l ON l.id = g.licence_id
      JOIN chat_members m ON m.room_id = g.room_id AND m.licence_id = g.licence_id AND m.left_at IS NULL
      LEFT JOIN chat_profiles p ON p.licence_id = g.licence_id
      WHERE g.room_id = @room AND g.day >= @from AND g.day <= @to GROUP BY g.licence_id ORDER BY points DESC, l.seat ASC`),
    weekDone: db.prepare('SELECT 1 FROM chat_guess_weeks WHERE room_id = ? AND week = ?'),
    weekMark: db.prepare('INSERT OR IGNORE INTO chat_guess_weeks (room_id, week, created_at) VALUES (?, ?, ?)'),
    oldGuess: db.prepare('DELETE FROM chat_guess WHERE created_at <= ?'),
    oldWeeks: db.prepare('DELETE FROM chat_guess_weeks WHERE created_at <= ?'),
    msg: db.prepare(`SELECT c.*, l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM chat_messages c LEFT JOIN licences l ON l.id = c.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = c.licence_id WHERE c.id = ?`),
    // requests
    request: db.prepare('SELECT * FROM chat_requests WHERE from_licence = ? AND to_seat = ?'),
    addRequest: db.prepare('INSERT OR IGNORE INTO chat_requests (from_licence, to_seat, created_at) VALUES (?, ?, ?)'),
    closeRequest: db.prepare('UPDATE chat_requests SET closed_at = ? WHERE from_licence = ? AND to_seat = ? AND closed_at IS NULL'),
    dropRequest: db.prepare('DELETE FROM chat_requests WHERE from_licence = ? AND to_seat = ?'),
    outCount: db.prepare('SELECT COUNT(*) AS n FROM chat_requests WHERE from_licence = ? AND created_at > ?'),
    in: db.prepare(`SELECT r.from_licence, r.created_at, l.seat, p.username AS name, p.color AS color, p.avatar AS avatar FROM chat_requests r JOIN licences l ON l.id = r.from_licence
      LEFT JOIN chat_profiles p ON p.licence_id = r.from_licence
      WHERE r.to_seat = @seat AND r.closed_at IS NULL AND r.created_at > @since
        AND NOT EXISTS (SELECT 1 FROM chat_blocks b WHERE b.licence_id = @lic AND b.blocked_licence = r.from_licence)
      ORDER BY r.created_at DESC LIMIT 50`),
    inCount: db.prepare(`SELECT COUNT(*) AS n FROM chat_requests r WHERE r.to_seat = @seat AND r.closed_at IS NULL AND r.created_at > @since
        AND NOT EXISTS (SELECT 1 FROM chat_blocks b WHERE b.licence_id = @lic AND b.blocked_licence = r.from_licence)`),
    // blocks
    blocked: db.prepare('SELECT 1 FROM chat_blocks WHERE licence_id = ? AND blocked_licence = ?'),
    block: db.prepare('INSERT OR IGNORE INTO chat_blocks (licence_id, blocked_licence, created_at) VALUES (?, ?, ?)'),
    unblock: db.prepare('DELETE FROM chat_blocks WHERE licence_id = ? AND blocked_licence = ?'),
    // reports
    report: db.prepare('INSERT INTO chat_reports (reporter, reporter_seat, room_id, reported, reason, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    // purge
    oldMessages: db.prepare('DELETE FROM chat_messages WHERE created_at <= ?'),
    oldRequests: db.prepare('DELETE FROM chat_requests WHERE created_at <= ?'),
    oldReports: db.prepare('DELETE FROM chat_reports WHERE created_at <= ?'),
    // Groups everyone has left, and DMs with a licence whose chat rows are purged.
    leftGroups: db.prepare("DELETE FROM chat_rooms WHERE kind = 'group' AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.room_id = chat_rooms.id AND m.left_at IS NULL)"),
    dmsOf: db.prepare("DELETE FROM chat_rooms WHERE kind = 'dm' AND (dm_key LIKE @id || ':%' OR dm_key LIKE '%:' || @id)"),
    dropRoom: db.prepare('DELETE FROM chat_rooms WHERE id = ?'),
    groupsToday: db.prepare("SELECT COUNT(*) AS n FROM chat_rooms WHERE kind = 'group' AND created_by = ? AND created_at > ?"),
    endedIds: db.prepare(`SELECT id, seat FROM licences WHERE ${ENDED}`),
    emptyRooms: db.prepare('DELETE FROM chat_rooms WHERE NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.room_id = chat_rooms.id)'),
  };
  const del = {
    profile: db.prepare('DELETE FROM chat_profiles WHERE licence_id = ?'),
    members: db.prepare('DELETE FROM chat_members WHERE licence_id = ?'),
    messages: db.prepare('DELETE FROM chat_messages WHERE licence_id = ?'),
    requestsFrom: db.prepare('DELETE FROM chat_requests WHERE from_licence = ?'),
    requestsTo: db.prepare('DELETE FROM chat_requests WHERE to_seat = ?'),
    guess: db.prepare('DELETE FROM chat_guess WHERE licence_id = ?'),
    blocks: db.prepare('DELETE FROM chat_blocks WHERE licence_id = ? OR blocked_licence = ?'),
    reportsBy: db.prepare('DELETE FROM chat_reports WHERE reporter = ?'),
  };
  // DOWNLOAD MY DATA and DELETE MY ACCOUNT (ME).
  q.blocksOf = db.prepare('SELECT blocked_licence FROM chat_blocks WHERE licence_id = ? ORDER BY created_at');
  q.sentBy = db.prepare('SELECT room_id, body, card_cmd, tickers_json, kind, created_at FROM chat_messages WHERE licence_id = ? AND created_at > ? ORDER BY id');
  q.guessBy = db.prepare('SELECT room_id, n, day, tries, solved, points FROM chat_guess WHERE licence_id = ? ORDER BY created_at');
  q.orphanReleases = db.prepare('UPDATE name_releases SET licence_id = NULL WHERE licence_id = ?');

  const person = (licId) => {
    const r = q.seatOf.get(licId);
    return r ? who(r) : null;
  };
  const isBlocked = (a, b) => Boolean(q.blocked.get(a, b));
  const eitherBlocked = (a, b) => isBlocked(a, b) || isBlocked(b, a);
  const dmOf = (a, b) => q.dm.get(dmKey(a, b)) || null;
  // The DM of two licences when both are still in it. A DM left behind by a purged
  // licence is dropped, so the two can start again with a request.
  function liveDm(a, b) {
    const dm = dmOf(a, b);
    if (!dm) return null;
    if (q.active.get(dm.id, a) && q.active.get(dm.id, b)) return dm;
    q.dropRoom.run(dm.id);
    return null;
  }
  // No block in either direction between any two of these licences.
  const noBlocks = (ids) => ids.every((a, i) => ids.slice(i + 1).every((b) => !eitherBlocked(a, b)));
  const isContact = (a, b) => {
    if (a === b || eitherBlocked(a, b)) return false;
    const dm = dmOf(a, b);
    return Boolean(dm && q.active.get(dm.id, a) && q.active.get(dm.id, b));
  };
  const activeIds = (roomId) => q.members.all(roomId).map((m) => m.licence_id);
  const requestSince = () => now() - KEEP_MS;

  // The room as a licence sees it, or null when they are not in it (never says why).
  function memberOf(roomId, lic) {
    const room = Number.isInteger(roomId) ? q.room.get(roomId) : null;
    if (!room) return null;
    const m = q.active.get(room.id, lic);
    return m ? { room, m } : null;
  }

  function readOnly(room, lic, members) {
    if (members.length < 2) return true;
    if (room.kind === 'dm') return eitherBlocked(lic, otherOf(room.dm_key, lic));
    return false;
  }

  function roomView(room, lic, m) {
    const members = q.members.all(room.id);
    const people = members.map(who);
    const others = members.filter((x) => x.licence_id !== lic).map((x) => label(x.seat, x.name));
    let title;
    let blockedByMe = false;
    if (room.kind === 'dm') {
      const other = otherOf(room.dm_key, lic);
      const p = person(other);
      title = p ? label(p.seat, p.name) : 'SEAT --';
      blockedByMe = isBlocked(lic, other);
    } else title = others.length ? groupTitle(others) : 'Just you';
    const mark = Math.max(m.last_read_id, m.from_id);
    const f = { filter: room.kind === 'group' ? 1 : 0, me: lic };
    const last = q.lastMsg.get({ room: room.id, from: m.from_id, ...f });
    const out = {
      id: room.id,
      kind: room.kind,
      title,
      members: people,
      readOnly: readOnly(room, lic, members),
      unread: Number(q.unreadIn.get({ room: room.id, mark, lic, ...f }).n),
      lastAt: room.last_at,
      last: last ? { at: last.created_at, preview: preview(last), own: last.licence_id === lic } : null,
    };
    if (room.kind === 'dm') out.blockedByMe = blockedByMe;
    return out;
  }

  function messageView(c, lic) {
    let tickers = [];
    try { tickers = c.tickers_json ? JSON.parse(c.tickers_json) : []; } catch { tickers = []; }
    const out = {
      id: c.id,
      seat: c.seat ?? null,
      name: c.name || null,
      color: c.color ?? null,
      avatar: c.avatar || null,
      own: c.licence_id === lic,
      text: c.body,
      card: c.card_cmd ? { cmd: c.card_cmd, title: c.card_title || c.card_cmd } : null,
      tickers,
      at: c.created_at,
    };
    // A line the server posted (DRIVE, the weekly GUESS winner), or a GUESS result.
    if (c.kind === 'sys') out.kind = 'sys';
    if (c.kind === 'guess') {
      const g = q.guessOf.get(c.id);
      out.kind = 'guess';
      out.guess = g ? { n: g.n, tries: g.tries, solved: Boolean(g.solved) } : null;
    }
    return out;
  }

  // A DM between two licences, made once (dm_key is unique), both in it.
  function makeDm(a, b) {
    const t = now();
    const key = dmKey(a, b);
    let room = q.dm.get(key);
    if (!room) {
      const r = q.newRoom.run('dm', key, a, t, t);
      room = q.room.get(r.lastInsertRowid);
    }
    for (const lic of [a, b]) if (!q.active.get(room.id, lic)) q.join.run({ room: room.id, lic, t, from: 0 });
    return room;
  }

  // The room's members who may write now (in it, and it is not closed), or null.
  function writable(roomId, lic) {
    const x = memberOf(roomId, lic);
    if (!x) return null;
    const members = q.members.all(x.room.id);
    return readOnly(x.room, lic, members) ? null : { ...x, members };
  }

  // CHAT 42 or CHAT @name, one person: open the DM, accept their request, or send ours.
  // target: { id, seat } or null (no such seat or name); seat: where a request goes (null
  // for a name nobody has). Inside a transaction. The same answer for every target in
  // every state: the limits come first, for anyone, so a 429 never tells a seat or a name
  // with Pro from one without, or from one that does not exist.
  function openOne(lic, me, target, seat, { allowRequest, isActive }) {
    if (target) {
      const dm = liveDm(lic, target.id);
      if (dm) return { room: dm.id, notify: [] };
      // Asking for someone you blocked is taking the block back.
      q.unblock.run(lic, target.id);
      // Their request to you: only a live one (not ignored, under 30 days old).
      const theirs = q.request.get(target.id, me.seat);
      if (theirs && !theirs.closed_at && theirs.created_at > requestSince() && !isBlocked(target.id, lic)) {
        const room = makeDm(lic, target.id);
        q.dropRequest.run(target.id, me.seat);
        q.dropRequest.run(lic, target.seat);
        return { room: room.id, accepted: true, notify: [lic, target.id] };
      }
    }
    if (Number(q.outCount.get(lic, requestSince()).n) >= MAX_OUT) {
      throw new ChatError('too_many_requests', `You have ${MAX_OUT} requests waiting. Wait for some answers first.`, 429);
    }
    if (!allowRequest()) throw new ChatError('rate_limited', 'That is a lot of requests for one day. Try again tomorrow.', 429);
    // A request is only kept for a seat that has Pro now.
    if (!target || !isActive(target.id)) return { sent: true, seat, notify: [] };
    const existing = q.request.get(lic, seat);
    if (existing && existing.created_at > requestSince()) return { sent: true, seat, notify: [] };
    if (existing) q.dropRequest.run(lic, seat); // expired: start again
    q.addRequest.run(lic, seat, now());
    const notify = isBlocked(target.id, lic) ? [] : [target.id];
    return { sent: true, seat, notify };
  }

  const api = {
    me(lic) { return person(lic); },

    // ---- DRIVE ----
    // Can this licence write in this room now? (DRIVE needs an open room.)
    canWrite(roomId, lic) { return Boolean(writable(roomId, lic)); },
    isMember(roomId, lic) { return Boolean(memberOf(roomId, lic)); },
    // Either blocked the other: no screens pass between them.
    blockedEither(a, b) { return eitherBlocked(a, b); },
    kind(roomId) { return q.room.get(roomId)?.kind || null; },
    // A line from the server in a room ("Tom 1 is driving."). Returns { message, notify }.
    system(roomId, text) {
      return tx(db, () => {
        const room = q.room.get(roomId);
        if (!room) return { message: null, notify: [] };
        const t = now();
        const r = q.sys.run(room.id, text, t); // not moved to the top of the list: only a server line
        return { message: messageView(q.msg.get(r.lastInsertRowid), 0), notify: activeIds(room.id) };
      });
    },

    // ---- GUESS LEAGUE ----
    // A checked result ({ n, day, tries, solved, points }) into each of these rooms: one per
    // licence per room per puzzle. Returns { posted: [{ room, message, notify }], already: [room] };
    // rooms the licence cannot write in are left out (never says why).
    postGuess(roomIds, lic, r) {
      return tx(db, () => {
        const posted = [];
        const already = [];
        for (const id of roomIds) {
          const x = writable(id, lic);
          if (!x) continue;
          if (q.guessHas.get(x.room.id, lic, r.n)) { already.push(x.room.id); continue; }
          const t = now();
          const score = `${r.solved ? r.tries : 'X'}/${r.of}`;
          const m = q.sendGuess.run(x.room.id, lic, `GUESS #${r.n} ${score}`, `GUESS #${r.n}`, t);
          q.guessAdd.run({ room: x.room.id, lic, n: r.n, day: r.day, tries: r.tries, solved: r.solved ? 1 : 0, points: r.points, msg: m.lastInsertRowid, t });
          q.touch.run(t, x.room.id);
          q.read.run(m.lastInsertRowid, x.room.id, lic);
          const notify = x.members.map((mm) => mm.licence_id).filter((mid) => x.room.kind === 'dm' || !isBlocked(mid, lic));
          posted.push({ room: x.room.id, message: messageView(q.msg.get(m.lastInsertRowid), lic), notify });
        }
        return { posted, already };
      });
    },
    // TODAY'S GUESS for the strip: the room's results for puzzle n, best first, without
    // the people this reader blocked (in a group). [] when nobody posted.
    guessToday(roomId, lic, n) {
      const x = memberOf(roomId, lic);
      if (!x) return [];
      return q.guessDay.all({ room: x.room.id, n, filter: x.room.kind === 'group' ? 1 : 0, me: lic })
        .map((g) => ({ ...who(g), tries: g.tries, solved: Boolean(g.solved), own: g.licence_id === lic }));
    },
    // Last week's winner line, once per room: { week, from, to } (New York dates, Mon to
    // Sun). Posts "Last week's GUESS: Ann 2 won with 11 points." when anyone scored, and
    // returns { message, notify }; null when it was posted before or nobody played.
    weekly(roomId, { week, from, to }) {
      return tx(db, () => {
        const room = q.room.get(roomId);
        if (!room || q.weekDone.get(room.id, week)) return null;
        const rows = q.guessWeek.all({ room: room.id, from, to });
        if (!rows.length) return null;
        q.weekMark.run(room.id, week, now());
        const top = Number(rows[0].points);
        if (!(top > 0)) return null;
        const names = rows.filter((w) => Number(w.points) === top).map((w) => label(w.seat, w.name));
        const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        const t = now();
        const r = q.sys.run(room.id, `Last week's GUESS: ${who} won with ${top} ${top === 1 ? 'point' : 'points'}.`, t);
        return { message: messageView(q.msg.get(r.lastInsertRowid), 0), notify: activeIds(room.id) };
      });
    },

    // ---- ME: username, colour, avatar ----
    profile(lic) {
      const r = q.profileOf.get(lic);
      return { username: r?.username || null, color: Number.isInteger(r?.color) ? r.color : null, avatar: r?.avatar || null };
    },

    // patch: { username?, color?, avatar? }, already cleaned (pro/chat.js); a key that is
    // there changes. A new username must be free whatever the case and not locked (given
    // up by someone else in the last 30 days); 3 changes a day. The name given up is
    // locked for 30 days. Returns the person (seat, name, color, avatar). Throws ChatError.
    setProfile(lic, patch = {}) {
      return tx(db, () => {
        const t = now();
        q.profileMake.run(lic, t);
        const cur = q.profileOf.get(lic);
        const next = { username: cur.username || null, color: Number.isInteger(cur.color) ? cur.color : null, avatar: cur.avatar || null };
        let changes = Number(cur.name_changes) || 0;
        let window = Number.isFinite(cur.name_window) ? cur.name_window : null;
        const name = 'username' in patch ? (patch.username || null) : next.username;
        if (name !== next.username) {
          if (window === null || t - window >= DAY_MS) { window = t; changes = 0; }
          if (changes >= MAX_NAME_CHANGES) throw new ChatError('name_limit', `A username can change ${MAX_NAME_CHANGES} times a day. Try again tomorrow.`, 429);
          if (name) {
            const owner = q.nameOwner.get(name);
            if ((owner && owner.licence_id !== lic) || q.nameLocked.get(name.toLowerCase(), t - RELEASE_MS, lic)) throw new ChatError('taken', NAME_TAKEN, 409);
          }
          // Given up (not only a new case of the same name): locked for everyone else.
          if (next.username && (!name || name.toLowerCase() !== next.username.toLowerCase())) q.release.run(next.username.toLowerCase(), lic, t);
          next.username = name;
          changes += 1;
        }
        if ('color' in patch) next.color = patch.color;
        if ('avatar' in patch) next.avatar = patch.avatar;
        try {
          q.profileSet.run({ ...next, changes, window, t, lic });
        } catch (err) {
          if (/UNIQUE/i.test(String(err?.message))) throw new ChatError('taken', NAME_TAKEN, 409);
          throw err;
        }
        return person(lic);
      });
    },

    // At start-up: usernames that break a rule now (a name carried over from the old
    // display name that is a command word or a bad word) go back to SEAT 42. Not locked:
    // they were never usable. Returns how many.
    sweepNames() {
      return tx(db, () => {
        let n = 0;
        for (const r of q.allNames.all()) if (!usernameOk(r.username)) n += Number(q.dropName.run(r.licence_id).changes);
        return n;
      });
    },

    // CHAT @name: like CHAT 42, with the same answer whether the name exists or not.
    openName(lic, name, { allowRequest = () => true, isActive = () => true } = {}) {
      const me = person(lic);
      return tx(db, () => {
        const target = q.licByName.get(name) || null;
        if (target && target.id === lic) throw new ChatError('self', 'That is your own name.');
        return openOne(lic, me, target, target ? target.seat : null, { allowRequest, isActive });
      });
    },

    // DOWNLOAD MY DATA: what CHAT holds about this licence. Other people only as seat and
    // username. Requests you sent are left out (a list would tell which seats have Pro).
    exportOf(lic) {
      const t = now();
      const rooms = q.myRooms.all(lic).map((r) => ({ id: r.id, view: roomView(r, lic, r) }));
      const titleOf = new Map(rooms.map((r) => [r.id, r.view.title]));
      const contacts = rooms.filter((r) => r.view.kind === 'dm').map((r) => person(otherOf(q.room.get(r.id).dm_key, lic)))
        .filter(Boolean).map((p) => ({ seat: p.seat, username: p.name }));
      const blocked = q.blocksOf.all(lic).map((b) => person(b.blocked_licence)).filter(Boolean).map((p) => ({ seat: p.seat, username: p.name }));
      const messages = q.sentBy.all(lic, t - KEEP_MS).map((m) => {
        let tickers = [];
        try { tickers = m.tickers_json ? JSON.parse(m.tickers_json) : []; } catch { tickers = []; }
        return { at: new Date(m.created_at).toISOString(), chat: titleOf.get(m.room_id) || null, text: m.body, card: m.card_cmd || null, tickers, kind: m.kind || 'message' };
      });
      const guess = q.guessBy.all(lic).map((g) => ({ n: g.n, day: g.day, tries: g.tries, solved: Boolean(g.solved), points: g.points, chat: titleOf.get(g.room_id) || null }));
      return { contacts, blocked, chats: rooms.map((r) => ({ kind: r.view.kind, title: r.view.title })), messages, guess };
    },

    // DELETE MY ACCOUNT: every CHAT row of this licence goes (the profile, its username
    // locked for 30 days with nobody able to take it back, the messages it sent, its
    // rooms, requests, blocks, GUESS results and the reports it made). No transaction of
    // its own: the route runs it inside one with the licence changes. Returns a count.
    wipeAccount(lic) {
      const t = now();
      const p = q.profileOf.get(lic);
      const seat = q.seatOf.get(lic)?.seat;
      if (p?.username) q.release.run(p.username.toLowerCase(), null, t);
      q.orphanReleases.run(lic);
      let rows = Number(del.profile.run(lic).changes) + Number(del.messages.run(lic).changes) + Number(del.members.run(lic).changes)
        + Number(del.requestsFrom.run(lic).changes) + Number(del.blocks.run(lic, lic).changes) + Number(del.guess.run(lic).changes)
        + Number(del.reportsBy.run(lic).changes) + (Number.isInteger(seat) ? Number(del.requestsTo.run(seat).changes) : 0);
      rows += Number(q.dmsOf.run({ id: String(lic) }).changes);
      q.emptyRooms.run();
      q.leftGroups.run();
      return rows;
    },

    // CHAT 42 (one seat): open the DM, accept their request, or send ours.
    // CHAT 42 88 (more): a group of you and your contacts.
    // allowRequest(): the route's daily request limit, asked only when a new request row
    // would be made. Returns { room, notify } or { sent, seat, notify }.
    // isActive(licId): the route's check that a licence has Pro now. allowGroup(): the
    // daily cap on new groups.
    open(lic, seats, { allowRequest = () => true, allowGroup = () => true, isActive = () => true } = {}) {
      const me = person(lic);
      const list = seats.filter((s) => s !== me.seat);
      if (!list.length) throw new ChatError('self', 'That is your own seat.');
      if (list.length === 1) {
        const seat = list[0];
        return tx(db, () => openOne(lic, me, q.licBySeat.get(seat) || null, seat, { allowRequest, isActive }));
      }
      if (list.length + 1 > MAX_MEMBERS) throw new ChatError('too_many', `A group has ${MAX_MEMBERS} people at most, you included.`);
      return tx(db, () => {
        const ids = [];
        const not = [];
        for (const seat of list) {
          const t = q.licBySeat.get(seat);
          if (t && isContact(lic, t.id)) ids.push(t.id);
          else not.push(seat);
        }
        if (not.length) {
          throw new ChatError('not_contacts', `Not your contacts yet: ${not.map((s) => `SEAT ${s}`).join(', ')}. Send each one CHAT and their seat first.`);
        }
        // Nobody in a group with someone who blocked them, or whom they blocked.
        if (!noBlocks([lic, ...ids])) throw new ChatError('not_contacts', 'Some of these seats cannot be in one group. Try fewer people.');
        // The same people again: the group you already have.
        const want = [lic, ...ids].sort((a, b) => a - b).join(',');
        for (const g of q.groupsOf.all(lic)) {
          if (activeIds(g.id).sort((a, b) => a - b).join(',') === want) return { room: g.id, notify: [] };
        }
        const t = now();
        if (Number(q.groupsToday.get(lic, t - DAY_MS).n) >= MAX_GROUPS_DAY || !allowGroup()) {
          throw new ChatError('rate_limited', `That is ${MAX_GROUPS_DAY} new groups today. Try again tomorrow.`, 429);
        }
        const r = q.newRoom.run('group', null, lic, t, t);
        const room = Number(r.lastInsertRowid);
        for (const id of [lic, ...ids]) q.join.run({ room, lic: id, t, from: 0 });
        return { room, notify: [lic, ...ids] };
      });
    },

    // { in: [{ seat, name, at }] }. Requests you sent are not listed: a request to a seat
    // without Pro is not kept, so a list would tell you which seats have Pro.
    requests(lic) {
      const me = person(lic);
      return { in: q.in.all({ seat: me.seat, lic, since: requestSince() }).map((r) => ({ ...who(r), at: r.created_at })) };
    },

    // ACCEPT, IGNORE or BLOCK the request from this seat.
    respond(lic, fromSeat, action) {
      const me = person(lic);
      return tx(db, () => {
        const from = q.licBySeat.get(fromSeat);
        const r = from ? q.request.get(from.id, me.seat) : null;
        if (!r || r.closed_at || r.created_at <= requestSince() || isBlocked(lic, from.id)) {
          throw new ChatError('not_found', `No request from SEAT ${fromSeat}.`, 404);
        }
        if (action === 'accept') {
          const room = makeDm(lic, from.id);
          q.dropRequest.run(from.id, me.seat);
          q.dropRequest.run(lic, from.seat);
          return { room: room.id, notify: [lic, from.id] };
        }
        q.closeRequest.run(now(), from.id, me.seat);
        if (action === 'block') q.block.run(lic, from.id, now());
        return { ok: true, notify: [lic] };
      });
    },

    list(lic) {
      return q.myRooms.all(lic).map((r) => roomView(r, lic, r));
    },

    room(roomId, lic) {
      const x = memberOf(roomId, lic);
      return x ? roomView(x.room, lic, x.m) : null;
    },

    // Messages, oldest first. Without before/after: the newest page. Marks the room read
    // unless it is an older page. Returns null when the licence is not in the room.
    messages(roomId, lic, { before = null, after = null, limit = PAGE, read = true } = {}) {
      const x = memberOf(roomId, lic);
      if (!x) return null;
      const n = Math.max(1, Math.min(PAGE * 2, Number(limit) || PAGE));
      let rows;
      let more = false;
      const f = { filter: x.room.kind === 'group' ? 1 : 0, me: lic };
      if (after !== null) {
        rows = q.after.all({ room: x.room.id, from: x.m.from_id, after, limit: n + 1, ...f });
        more = rows.length > n;
        rows = rows.slice(0, n);
      } else {
        rows = q.page.all({ room: x.room.id, from: x.m.from_id, before: before ?? Number.MAX_SAFE_INTEGER, limit: n + 1, ...f });
        more = rows.length > n;
        rows = rows.slice(0, n).reverse();
      }
      if (read && before === null && rows.length) q.read.run(rows[rows.length - 1].id, x.room.id, lic);
      return { messages: rows.map((c) => messageView(c, lic)), more };
    },

    // A new message. The route has checked the text and the card and stamped the tickers.
    send(roomId, lic, { text, card = null, tickers = [] }) {
      return tx(db, () => {
        const x = memberOf(roomId, lic);
        if (!x) throw new ChatError('not_found', 'No such chat.', 404);
        const members = q.members.all(x.room.id);
        if (readOnly(x.room, lic, members)) throw new ChatError('read_only', 'This chat is closed.', 409);
        const t = now();
        const r = q.send.run(x.room.id, lic, text, card?.cmd || null, card?.title || null, tickers.length ? JSON.stringify(tickers) : null, t);
        q.touch.run(t, x.room.id);
        q.read.run(r.lastInsertRowid, x.room.id, lic);
        // In a group, someone who blocked the sender is not nudged (they do not see it).
        const notify = members.map((m) => m.licence_id).filter((id) => x.room.kind === 'dm' || !isBlocked(id, lic));
        return { message: messageView(q.msg.get(r.lastInsertRowid), lic), notify };
      });
    },

    // The room menu: LEAVE and ADD (groups), BLOCK and UNBLOCK (DMs).
    act(roomId, lic, action, seat = null) {
      return tx(db, () => {
        const x = memberOf(roomId, lic);
        if (!x) throw new ChatError('not_found', 'No such chat.', 404);
        const { room } = x;
        const members = q.members.all(room.id);
        const ids = members.map((m) => m.licence_id);
        if (room.kind === 'dm') {
          const other = otherOf(room.dm_key, lic);
          if (action === 'block') q.block.run(lic, other, now());
          else if (action === 'unblock') q.unblock.run(lic, other);
          else throw new ChatError('bad_action', 'A private chat has BLOCK and UNBLOCK.');
          return { ok: true, notify: [lic, other] };
        }
        if (action === 'leave') {
          q.leave.run(now(), room.id, lic);
          return { ok: true, left: true, notify: ids };
        }
        if (action !== 'add') throw new ChatError('bad_action', 'A group has ADD and LEAVE.');
        if (readOnly(room, lic, members)) throw new ChatError('read_only', 'This chat is closed.', 409);
        const t = Number.isInteger(seat) ? q.licBySeat.get(seat) : null;
        if (!t || !isContact(lic, t.id)) throw new ChatError('not_contacts', `Not your contact yet: SEAT ${seat}. Send CHAT ${seat} first.`);
        if (ids.includes(t.id)) throw new ChatError('already', `SEAT ${seat} is in this group.`, 409);
        if (ids.length >= MAX_MEMBERS) throw new ChatError('too_many', `A group has ${MAX_MEMBERS} people at most.`, 409);
        if (!noBlocks([...ids, t.id])) throw new ChatError('not_contacts', `SEAT ${seat} cannot join this group.`);
        const at = now();
        q.join.run({ room: room.id, lic: t.id, t: at, from: Number(q.maxId.get(room.id).n) });
        q.touch.run(at, room.id);
        return { ok: true, notify: [...ids, t.id] };
      });
    },

    // REPORT: a copy of the last 20 messages the reporter can see, the reported seats
    // (everyone else in the room) and an optional reason. Kept 12 months.
    report(roomId, lic, reason = null) {
      const x = memberOf(roomId, lic);
      if (!x) throw new ChatError('not_found', 'No such chat.', 404);
      const me = person(lic);
      const rows = q.snapshot.all({ room: x.room.id, from: x.m.from_id, limit: SNAPSHOT }).reverse();
      const snapshot = rows.map((c) => ({ id: c.id, seat: c.seat ?? null, name: c.name || null, text: c.body, card: c.card_cmd || null, at: c.created_at }));
      let reported = q.members.all(x.room.id).filter((m) => m.licence_id !== lic).map((m) => ({ licence: m.licence_id, seat: m.seat }));
      if (x.room.kind === 'dm' && !reported.length) {
        const other = otherOf(x.room.dm_key, lic);
        const p = person(other);
        if (p) reported = [{ licence: other, seat: p.seat }];
      }
      q.report.run(lic, me.seat, x.room.id, JSON.stringify(reported), reason || null, JSON.stringify(snapshot), now());
      return { ok: true };
    },

    // Unread messages in your rooms plus requests waiting for you.
    unread(lic) {
      const me = person(lic);
      const msgs = Number(q.unreadAll.get({ lic }).n);
      const reqs = Number(q.inCount.get({ seat: me.seat, lic, since: requestSince() }).n);
      return msgs + reqs;
    },

    // Daily (Privacy Policy): messages and requests over 30 days old, reports over 12
    // months, and every chat row of a licence whose Pro ended over 30 days ago. Counts only.
    purge(t = now()) {
      return tx(db, () => {
        const messages = Number(q.oldMessages.run(t - KEEP_MS).changes);
        const requests = Number(q.oldRequests.run(t - KEEP_MS).changes);
        const reports = Number(q.oldReports.run(t - REPORT_KEEP_MS).changes);
        const guess = Number(q.oldGuess.run(t - KEEP_MS).changes) + Number(q.oldWeeks.run(t - KEEP_MS).changes);
        const ended = q.endedIds.all({ before: t - ENDED_KEEP_MS });
        let rows = 0;
        for (const l of ended) {
          // Their username is given up: locked 30 days, and this licence may take it back.
          const p = q.profileOf.get(l.id);
          if (p?.username) q.release.run(p.username.toLowerCase(), l.id, t);
          rows += Number(del.profile.run(l.id).changes) + Number(del.members.run(l.id).changes) + Number(del.messages.run(l.id).changes)
            + Number(del.requestsFrom.run(l.id).changes) + Number(del.blocks.run(l.id, l.id).changes) + Number(del.guess.run(l.id).changes)
            + (Number.isInteger(l.seat) ? Number(del.requestsTo.run(l.seat).changes) : 0);
          rows += Number(q.dmsOf.run({ id: String(l.id) }).changes); // their DMs, with the messages (cascade)
        }
        const rooms = Number(q.emptyRooms.run().changes) + Number(q.leftGroups.run().changes);
        const names = Number(q.oldReleases.run(t - RELEASE_MS).changes);
        return { messages, requests, reports, guess, ended: rows, rooms, names };
      });
    },
  };
  return api;
}
