// CHAT storage: names, requests, rooms, members, messages, blocks and reports, in the Pro
// database (migrations/013_chat.sql). Everything here takes internal licence ids; the
// route finds the licence from the key. What goes out is { seat, name } only, never a
// key, a key hash or a licence id.
//
// Contacts: two licences are contacts when they share a DM and neither blocked the
// other. A group can only be made from, and grown with, your own contacts.

import { tx } from './db.js';
import {
  ChatError, label, KEEP_MS, REPORT_KEEP_MS, MAX_MEMBERS, MAX_OUT, PAGE, SNAPSHOT,
} from './chat.js';
import { ENDED_KEEP_MS } from './store.js';

const PREVIEW = 60;
const MAX_ROOMS = 100;
const dmKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const otherOf = (key, me) => key.split(':').map(Number).find((n) => n !== me) ?? me;
// A licence whose Pro ended over 30 days ago (the synced-data rule, store.js purgeEnded).
const ENDED = `(
  (status IN ('canceled', 'unpaid') AND ended_at IS NOT NULL AND ended_at <= @before)
  OR (gift_expires_at IS NOT NULL AND stripe_subscription_id IS NULL AND gift_expires_at <= @before)
)`;

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
    seatOf: db.prepare('SELECT l.seat, p.name FROM licences l LEFT JOIN chat_profiles p ON p.licence_id = l.id WHERE l.id = ?'),
    setName: db.prepare(`INSERT INTO chat_profiles (licence_id, name, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (licence_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`),
    dm: db.prepare("SELECT * FROM chat_rooms WHERE dm_key = ?"),
    room: db.prepare('SELECT * FROM chat_rooms WHERE id = ?'),
    newRoom: db.prepare('INSERT INTO chat_rooms (kind, dm_key, created_by, created_at, last_at) VALUES (?, ?, ?, ?, ?)'),
    touch: db.prepare('UPDATE chat_rooms SET last_at = ? WHERE id = ?'),
    member: db.prepare('SELECT * FROM chat_members WHERE room_id = ? AND licence_id = ?'),
    active: db.prepare('SELECT * FROM chat_members WHERE room_id = ? AND licence_id = ? AND left_at IS NULL'),
    join: db.prepare(`INSERT INTO chat_members (room_id, licence_id, joined_at, from_id) VALUES (@room, @lic, @t, @from)
      ON CONFLICT (room_id, licence_id) DO UPDATE SET left_at = NULL, joined_at = @t, from_id = @from, last_read_id = 0`),
    leave: db.prepare('UPDATE chat_members SET left_at = ? WHERE room_id = ? AND licence_id = ? AND left_at IS NULL'),
    members: db.prepare(`SELECT m.licence_id, l.seat, p.name FROM chat_members m JOIN licences l ON l.id = m.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = m.licence_id WHERE m.room_id = ? AND m.left_at IS NULL ORDER BY m.joined_at, m.licence_id`),
    myRooms: db.prepare(`SELECT r.*, m.from_id, m.last_read_id FROM chat_rooms r JOIN chat_members m ON m.room_id = r.id
      WHERE m.licence_id = ? AND m.left_at IS NULL ORDER BY r.last_at DESC, r.id DESC LIMIT ${MAX_ROOMS}`),
    groupsOf: db.prepare(`SELECT r.id FROM chat_rooms r JOIN chat_members m ON m.room_id = r.id
      WHERE r.kind = 'group' AND m.licence_id = ? AND m.left_at IS NULL`),
    maxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM chat_messages WHERE room_id = ?'),
    lastMsg: db.prepare('SELECT * FROM chat_messages WHERE room_id = ? AND id > ? ORDER BY id DESC LIMIT 1'),
    unreadIn: db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE room_id = @room AND id > @mark AND (licence_id IS NULL OR licence_id != @lic)'),
    unreadAll: db.prepare(`SELECT COUNT(*) AS n FROM chat_messages c JOIN chat_members m ON m.room_id = c.room_id AND m.licence_id = @lic AND m.left_at IS NULL
      WHERE c.id > MAX(m.last_read_id, m.from_id) AND (c.licence_id IS NULL OR c.licence_id != @lic)`),
    page: db.prepare(`SELECT c.*, l.seat, p.name FROM chat_messages c LEFT JOIN licences l ON l.id = c.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = c.licence_id
      WHERE c.room_id = @room AND c.id > @from AND c.id < @before ORDER BY c.id DESC LIMIT @limit`),
    after: db.prepare(`SELECT c.*, l.seat, p.name FROM chat_messages c LEFT JOIN licences l ON l.id = c.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = c.licence_id
      WHERE c.room_id = @room AND c.id > MAX(@from, @after) ORDER BY c.id ASC LIMIT @limit`),
    read: db.prepare('UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE room_id = ? AND licence_id = ?'),
    send: db.prepare('INSERT INTO chat_messages (room_id, licence_id, body, card_cmd, card_title, tickers_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    msg: db.prepare(`SELECT c.*, l.seat, p.name FROM chat_messages c LEFT JOIN licences l ON l.id = c.licence_id
      LEFT JOIN chat_profiles p ON p.licence_id = c.licence_id WHERE c.id = ?`),
    // requests
    request: db.prepare('SELECT * FROM chat_requests WHERE from_licence = ? AND to_seat = ?'),
    addRequest: db.prepare('INSERT OR IGNORE INTO chat_requests (from_licence, to_seat, created_at) VALUES (?, ?, ?)'),
    closeRequest: db.prepare('UPDATE chat_requests SET closed_at = ? WHERE from_licence = ? AND to_seat = ? AND closed_at IS NULL'),
    dropRequest: db.prepare('DELETE FROM chat_requests WHERE from_licence = ? AND to_seat = ?'),
    outCount: db.prepare('SELECT COUNT(*) AS n FROM chat_requests WHERE from_licence = ? AND created_at > ?'),
    out: db.prepare('SELECT to_seat, created_at FROM chat_requests WHERE from_licence = ? AND created_at > ? ORDER BY created_at DESC LIMIT 50'),
    in: db.prepare(`SELECT r.from_licence, r.created_at, l.seat, p.name FROM chat_requests r JOIN licences l ON l.id = r.from_licence
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
    endedIds: db.prepare(`SELECT id, seat FROM licences WHERE ${ENDED}`),
    emptyRooms: db.prepare('DELETE FROM chat_rooms WHERE NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.room_id = chat_rooms.id)'),
  };
  const del = {
    profile: db.prepare('DELETE FROM chat_profiles WHERE licence_id = ?'),
    members: db.prepare('DELETE FROM chat_members WHERE licence_id = ?'),
    messages: db.prepare('DELETE FROM chat_messages WHERE licence_id = ?'),
    requestsFrom: db.prepare('DELETE FROM chat_requests WHERE from_licence = ?'),
    requestsTo: db.prepare('DELETE FROM chat_requests WHERE to_seat = ?'),
    blocks: db.prepare('DELETE FROM chat_blocks WHERE licence_id = ? OR blocked_licence = ?'),
  };

  const person = (licId) => {
    const r = q.seatOf.get(licId);
    return r ? { seat: r.seat, name: r.name || null } : null;
  };
  const isBlocked = (a, b) => Boolean(q.blocked.get(a, b));
  const eitherBlocked = (a, b) => isBlocked(a, b) || isBlocked(b, a);
  const dmOf = (a, b) => q.dm.get(dmKey(a, b)) || null;
  const isContact = (a, b) => a !== b && Boolean(dmOf(a, b)) && !eitherBlocked(a, b);
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
    const people = members.map((x) => ({ seat: x.seat, name: x.name || null }));
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
    const last = q.lastMsg.get(room.id, m.from_id);
    const out = {
      id: room.id,
      kind: room.kind,
      title,
      members: people,
      readOnly: readOnly(room, lic, members),
      unread: Number(q.unreadIn.get({ room: room.id, mark, lic }).n),
      lastAt: room.last_at,
      last: last ? { at: last.created_at, preview: preview(last), own: last.licence_id === lic } : null,
    };
    if (room.kind === 'dm') out.blockedByMe = blockedByMe;
    return out;
  }

  function messageView(c, lic) {
    let tickers = [];
    try { tickers = c.tickers_json ? JSON.parse(c.tickers_json) : []; } catch { tickers = []; }
    return {
      id: c.id,
      seat: c.seat ?? null,
      name: c.name || null,
      own: c.licence_id === lic,
      text: c.body,
      card: c.card_cmd ? { cmd: c.card_cmd, title: c.card_title || c.card_cmd } : null,
      tickers,
      at: c.created_at,
    };
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

  const api = {
    me(lic) { return person(lic); },

    setName(lic, name) {
      q.setName.run(lic, name, now());
      return person(lic);
    },

    // CHAT 42 (one seat): open the DM, accept their request, or send ours.
    // CHAT 42 88 (more): a group of you and your contacts.
    // allowRequest(): the route's daily request limit, asked only when a new request row
    // would be made. Returns { room, notify } or { sent, seat, notify }.
    open(lic, seats, { allowRequest = () => true } = {}) {
      const me = person(lic);
      const list = seats.filter((s) => s !== me.seat);
      if (!list.length) throw new ChatError('self', 'That is your own seat.');
      if (list.length === 1) {
        const seat = list[0];
        return tx(db, () => {
          const target = q.licBySeat.get(seat);
          if (target) {
            const dm = dmOf(lic, target.id);
            if (dm) return { room: dm.id, notify: [] };
            // Asking for a seat you blocked is taking the block back.
            q.unblock.run(lic, target.id);
            const theirs = q.request.get(target.id, me.seat);
            if (theirs && !isBlocked(target.id, lic)) {
              const room = makeDm(lic, target.id);
              q.dropRequest.run(target.id, me.seat);
              q.dropRequest.run(lic, seat);
              return { room: room.id, accepted: true, notify: [lic, target.id] };
            }
          }
          // The same neutral answer whether or not the seat exists or has Pro.
          const existing = q.request.get(lic, seat);
          if (existing && existing.created_at > requestSince()) return { sent: true, seat, notify: [] };
          if (existing) q.dropRequest.run(lic, seat); // expired: start again
          if (Number(q.outCount.get(lic, requestSince()).n) >= MAX_OUT) {
            throw new ChatError('too_many_requests', `You have ${MAX_OUT} requests waiting. Wait for some answers first.`, 429);
          }
          if (!allowRequest()) throw new ChatError('rate_limited', 'That is a lot of requests for one day. Try again tomorrow.', 429);
          q.addRequest.run(lic, seat, now());
          const notify = target && !isBlocked(target.id, lic) ? [target.id] : [];
          return { sent: true, seat, notify };
        });
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
        // The same people again: the group you already have.
        const want = [lic, ...ids].sort((a, b) => a - b).join(',');
        for (const g of q.groupsOf.all(lic)) {
          if (activeIds(g.id).sort((a, b) => a - b).join(',') === want) return { room: g.id, notify: [] };
        }
        const t = now();
        const r = q.newRoom.run('group', null, lic, t, t);
        const room = Number(r.lastInsertRowid);
        for (const id of [lic, ...ids]) q.join.run({ room, lic: id, t, from: 0 });
        return { room, notify: [lic, ...ids] };
      });
    },

    // { in: [{ seat, name, at }], out: [{ seat, at }] }
    requests(lic) {
      const me = person(lic);
      const since = requestSince();
      return {
        in: q.in.all({ seat: me.seat, lic, since }).map((r) => ({ seat: r.seat, name: r.name || null, at: r.created_at })),
        out: q.out.all(lic, since).map((r) => ({ seat: r.to_seat, at: r.created_at })),
      };
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
    messages(roomId, lic, { before = null, after = null, limit = PAGE } = {}) {
      const x = memberOf(roomId, lic);
      if (!x) return null;
      const n = Math.max(1, Math.min(PAGE * 2, Number(limit) || PAGE));
      let rows;
      let more = false;
      if (after !== null) {
        rows = q.after.all({ room: x.room.id, from: x.m.from_id, after, limit: n + 1 });
        more = rows.length > n;
        rows = rows.slice(0, n);
      } else {
        rows = q.page.all({ room: x.room.id, from: x.m.from_id, before: before ?? Number.MAX_SAFE_INTEGER, limit: n + 1 });
        more = rows.length > n;
        rows = rows.slice(0, n).reverse();
      }
      if (before === null && rows.length) q.read.run(rows[rows.length - 1].id, x.room.id, lic);
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
        return { message: messageView(q.msg.get(r.lastInsertRowid), lic), notify: members.map((m) => m.licence_id) };
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
      const rows = q.page.all({ room: x.room.id, from: x.m.from_id, before: Number.MAX_SAFE_INTEGER, limit: SNAPSHOT }).reverse();
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
        const ended = q.endedIds.all({ before: t - ENDED_KEEP_MS });
        let rows = 0;
        for (const l of ended) {
          rows += Number(del.profile.run(l.id).changes) + Number(del.members.run(l.id).changes) + Number(del.messages.run(l.id).changes)
            + Number(del.requestsFrom.run(l.id).changes) + Number(del.blocks.run(l.id, l.id).changes)
            + (Number.isInteger(l.seat) ? Number(del.requestsTo.run(l.seat).changes) : 0);
        }
        const rooms = Number(q.emptyRooms.run().changes);
        return { messages, requests, reports, ended: rows, rooms };
      });
    },
  };
  return api;
}
