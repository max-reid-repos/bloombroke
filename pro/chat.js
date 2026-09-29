// CHAT rules and the long-poll hub. Pure: no database, no Express. pro/chat-store.js
// keeps the rows, pro/chat-routes.js mounts /api/chat.
//
// The rules: a seat number is a public address (never a credential: every route takes
// the key). A username is optional (set in ME), unique, and always shown with the seat,
// so nobody can pass for someone else: Tom #42. Messages are text up to 500 characters,
// no links, no images, no files; each $TICKER (up to 3) gets the price at send time;
// one optional card points at a screen of the terminal.

import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { cleanMessage } from './feedback.js';
import { normalizeKey, normalizeGiftCode } from './licence.js';
import { REGISTRY } from '../public/registry.js';

export const MAX_TEXT = 500;
export const MAX_NAME = 15;
export const MIN_NAME = 3;
export const MAX_REASON = 200;
export const MAX_MEMBERS = 8;
export const MAX_TICKERS = 3;
export const MAX_CARD = 60;
export const MAX_OUT = 30; // open outgoing requests
export const MAX_GROUPS_DAY = 20; // new groups a licence may make in 24 hours
export const PAGE = 50;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const KEEP_MS = 30 * DAY_MS; // messages and requests
export const REPORT_KEEP_MS = 365 * DAY_MS; // reports: 12 months
export const SNAPSHOT = 20; // messages copied into a report

// A username: 3 to 15 of A-Z a-z 0-9 _, starting with a letter (ME, CHAT @name).
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,14}$/;
// The words to type CHAT @name: @ and the username shape, any case.
export const AT_NAME_RE = /^@([A-Za-z][A-Za-z0-9_]{2,14})$/;
export const SEAT_RE = /^\d{1,9}$/;
// A $TICKER in a message: the STOCK_RE shape, upper case, not glued to a word.
export const TICKER_WORD_RE = /(^|[^A-Za-z0-9$])\$([A-Z]{1,5}(?:\.[A-Z]{1,2})?)(?![A-Za-z0-9])/g;
// A card is a terminal command: these characters only (S&P 500, MCAP>10B, EUR/USD, $GOLD).
export const CARD_RE = /^[A-Z0-9 .$&%<>=:/+-]{1,60}$/;
// Screens a card may never point at: account, chat itself, feedback.
export const CARD_DENY = ['HOME', 'CHAT', 'PRO', 'LOGIN', 'LOGOUT', 'REDEEM', 'GIFT', 'FEEDBACK', 'IDEA', 'ME'];
export const NO_LINKS = 'No links. Attach a screen instead.';

export class ChatError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// 'Tom #42' or 'SEAT 42'.
export const label = (seat, name) => (name ? `${name} #${seat}` : `SEAT ${seat}`);

// ---- text ------------------------------------------------------------------------------

// Plain line ends, no control or bidi characters, trimmed, at most 2 blank lines in a row.
export function cleanText(v) {
  if (typeof v !== 'string') return '';
  return cleanMessage(v).replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

// Endings a link can have. A broad list, but not the short ones that are everyday words
// (in, it, is, no, my, at, am, as, do, go, on, or, if, an, id), which only a full URL catches.
export const TLDS = [
  'com', 'net', 'org', 'io', 'co', 'ai', 'app', 'xyz', 'me', 'gg', 'ly', 'to', 'be', 'info', 'biz', 'us', 'uk', 'sg', 'link', 'site', 'online', 'club', 'top', 'shop', 'so',
  'ru', 'su', 'dev', 'tv', 'de', 'cc', 'pro', 'vip', 'cn', 'tk', 'ml', 'ga', 'cf', 'gq', 'pw', 'ws', 'cx', 'ch', 'fr', 'nl', 'eu', 'ca', 'au', 'jp', 'kr', 'br', 'mx',
  'es', 'pl', 'cz', 'ph', 'vn', 'hk', 'tw', 'nz', 'za', 'ae', 'ir', 'ua', 'gl', 'gd', 'im', 'la', 'ms', 'nu', 'sh', 'st', 'sx', 'tl', 'vc', 'vg', 'sc', 'mn', 'fm',
  'lol', 'fun', 'live', 'news', 'tech', 'store', 'space', 'website', 'click', 'today', 'world', 'life', 'cash', 'money', 'finance', 'trade', 'exchange', 'capital',
  'fund', 'bet', 'win', 'casino', 'games', 'game', 'chat', 'email', 'zone', 'digital', 'media', 'agency', 'network', 'cloud', 'host', 'page', 'blog', 'wiki', 'one',
  'art', 'mobi', 'name', 'bid', 'loan', 'cam', 'icu', 'bond', 'sbs', 'cyou', 'rest', 'bar', 'best', 'pics', 'pub', 'rip', 'mom', 'lat', 'ink', 'run', 'fyi', 'gay',
  'tokens', 'crypto', 'eth', 'nft', 'dao', 'coin', 'markets', 'global', 'group', 'plus', 'team', 'social', 'buzz', 'work', 'works', 'services', 'solutions',
];
// Any scheme (https://, ftp://, tg://), a defanged hxxp, or www.
const URL_RE = /\b[a-z][a-z0-9+.-]{1,15}:\/\/|\bhxxps?\b|\bwww\s*[.\u3002\uff0e]\s*\w/i;
// A word, dots, then a known ending, in any case: t.me, bit.ly, pump.Com, x.co/abc. Not
// after a $ ($SHOP.TO is a ticker).
const DOMAIN_RE = new RegExp(`(^|[^$\\w])([a-z0-9-]+(?:[.\\u3002\\uff0e][a-z0-9-]+)*)[.\\u3002\\uff0e](${TLDS.join('|')})(?![a-z0-9])`, 'gi');
// Exchange suffixes of tickers (SAP.DE, SHOP.TO, 0700.HK, 2330.TW): in upper case after an
// upper-case symbol they are a ticker, not a link. CO, ME, LY, GG and IO are not here: in
// any case they stay links.
export const EXCHANGE_SUFFIXES = new Set(['HK', 'DE', 'TO', 'TW', 'CN', 'MX', 'NZ', 'AX', 'SW', 'PA', 'KS', 'SS', 'SZ', 'NS', 'BO', 'SA', 'L', 'T', 'V', 'F', 'AS', 'MI', 'ST', 'OL']);
const isTickerLike = (stem, end) => /^\$?[A-Z0-9]{1,10}$/.test(stem) && EXCHANGE_SUFFIXES.has(end);
// Spelled-out dots in brackets: example[.]com, example(.)com, example (dot) com. A bare
// "dot com" stays text (the dot com bubble).
const DOT_WORDS = /\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/gi;

export function hasLink(text) {
  const s = String(text ?? '').replace(DOT_WORDS, '.');
  if (URL_RE.test(s)) return true;
  for (const m of s.matchAll(DOMAIN_RE)) if (!isTickerLike(m[2], m[3])) return true;
  return false;
}

// The $TICKERs in a message, in order, each once, at most 3: ['NVDA', 'AAPL'].
export function tickersIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(TICKER_WORD_RE)) {
    if (!out.includes(m[2])) out.push(m[2]);
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

// { text } checked: throws ChatError. Empty text only with a card.
export function checkText(raw, { hasCard = false } = {}) {
  const text = cleanText(raw);
  if (!text && !hasCard) throw new ChatError('empty', 'Write something first.');
  if (text.length > MAX_TEXT) throw new ChatError('too_long', `Keep it under ${MAX_TEXT} characters.`);
  if (hasLink(text)) throw new ChatError('no_links', NO_LINKS);
  return text;
}

// ---- names, seats, cards ---------------------------------------------------------------

// ---- usernames (ME) ---------------------------------------------------------------------
// Words nobody may take: staff-like words, anything that reads as a seat (SEAT, BB and
// digits), and every command word of the terminal (a name must never look like a command).
export const RESERVED = ['admin', 'support', 'bloombroke', 'staff', 'mod', 'pro', 'chat', 'seat', 'official', 'root', 'system', 'help', 'me'];
const COMMAND_WORDS = new Set(REGISTRY.flatMap((c) => [c.name, ...(c.aliases || [])]).map((w) => String(w).toLowerCase()));
export const STAFF_WORDS = /bloombroke|admin|support|staff|official|moderator/i;
export const NAME_TAKEN = 'That name is taken. Pick another.';
export const MAX_NAME_CHANGES = 3; // a day
export const RELEASE_MS = 30 * DAY_MS; // a name given up is locked this long
export const NAME_BAD = 'Pick another name.';

let matcher = null;
const profanity = () => { matcher ||= new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers }); return matcher; };
function obscene(name) {
  try {
    const m = profanity();
    const low = name.toLowerCase();
    return m.hasMatch(low) || m.hasMatch(low.replace(/_/g, ' ')) || m.hasMatch(low.replace(/_/g, ''));
  } catch { return true; } // a broken check refuses
}

// A reserved word, a command word, a seat look-alike or a bad word: true.
export function reservedName(name) {
  const low = String(name).toLowerCase();
  if (RESERVED.includes(low) || COMMAND_WORDS.has(low)) return true;
  if (/^bb\d/.test(low) || /^seat[\d_]*$/.test(low) || /^\d+$/.test(low)) return true;
  // Staff-like words anywhere in a name: support_team, TheAdmin, BloombrokeHQ.
  if (STAFF_WORDS.test(low)) return true;
  return obscene(low);
}

// Every rule on one name: true when it may be a username.
export const usernameOk = (v) => typeof v === 'string' && USERNAME_RE.test(v) && !reservedName(v);

// A username from a body, or null to go back to SEAT 42. Shown as typed; unique whatever
// the case (the store checks). Throws ChatError.
export function cleanUsername(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ChatError('bad_name', 'Send { username }.');
  const s = cleanMessage(v).trim();
  if (!s) return null;
  if (s.length < MIN_NAME || s.length > MAX_NAME || !/^[A-Za-z0-9_]+$/.test(s)) throw new ChatError('bad_name', `A username is ${MIN_NAME} to ${MAX_NAME} letters, numbers or _.`);
  if (!/^[A-Za-z]/.test(s)) throw new ChatError('bad_name', 'A username starts with a letter.');
  if (reservedName(s)) throw new ChatError('bad_name', NAME_BAD);
  return s;
}

// A name colour: 0 to 7 (style.css --name-0 .. --name-7), or null for the default.
export function cleanColor(v) {
  if (v === null) return null;
  if (!Number.isInteger(v) || v < 0 || v > 7) throw new ChatError('bad_color', 'A colour is a number from 0 to 7.');
  return v;
}

// A pixel avatar: 16 hex characters (8x8 pixels, row by row), or null for initials.
export function cleanAvatar(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^[0-9a-fA-F]{16}$/.test(v)) throw new ChatError('bad_avatar', 'An avatar is 16 hex characters.');
  return v.toLowerCase();
}

// Seat numbers from a body: 1 to 7, whole, positive, each once.
export function cleanSeats(list, { max = MAX_MEMBERS - 1 } = {}) {
  if (!Array.isArray(list) || !list.length) throw new ChatError('bad_seats', 'Type CHAT and a seat number: CHAT 42.');
  const seats = [];
  for (const v of list) {
    const n = typeof v === 'number' ? v : SEAT_RE.test(String(v ?? '').trim()) ? Number(String(v).trim()) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 999_999_999) throw new ChatError('bad_seats', 'A seat is a number, like 42.');
    if (!seats.includes(n)) seats.push(n);
  }
  if (seats.length > max) throw new ChatError('too_many', `A group has ${MAX_MEMBERS} people at most, you included.`);
  return seats;
}

// A Pro key or a gift code anywhere in a command (HELP BB-XXXX-..., GRID AAPL bbxxxx...,
// WHATIF 7K2M ABCD ...): such a command is never a card and never driven. Any four groups
// of four joined by a sign; one word, or words after BB or GIFT, that make a key or a code
// (case and signs do not matter); and words split by spaces that make one when a digit is
// in them (AAPL MSFT NVDA TSLA stays four tickers). public/screens/chat.js has the same.
export function secretIn(raw) {
  const s = String(raw ?? '').toUpperCase();
  if (/[A-Z0-9]{4}(?:[^A-Z0-9\s][A-Z0-9]{4}){3}/.test(s)) return true;
  const toks = s.split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j <= Math.min(toks.length, i + 9); j++) {
      const part = toks.slice(i, j);
      const joined = part.join('').replace(/[^A-Z0-9]/g, '');
      if (!normalizeKey(joined) && !normalizeGiftCode(joined)) continue;
      if (part.length === 1 || /^(BB|GIFT)/.test(part[0]) || /\d/.test(joined)) return true;
    }
  }
  return false;
}

// A card: { cmd, title } for a screen of the terminal, or null. parse is the terminal's
// own parser (public/app.js parseCommand); linkChanges says whether a link to it would
// change something saved. Throws ChatError.
// titleOf(parsed): the terminal's own title for the screen; what the client sends as a
// title is ignored.
export function cleanCard(card, { parse, linkChanges, titleOf = null }) {
  if (card === undefined || card === null) return null;
  if (typeof card !== 'object' || Array.isArray(card)) throw new ChatError('bad_card', 'That screen cannot be attached.');
  const cmd = typeof card.cmd === 'string' ? card.cmd.replace(/\s+/g, ' ').trim().toUpperCase() : '';
  // No link check here: the command must parse to a screen of the terminal (below), and a
  // card is a button, never a link (SAP.DE is a ticker).
  if (!CARD_RE.test(cmd) || secretIn(cmd)) throw new ChatError('bad_card', 'That screen cannot be attached.');
  const head = cmd.split(' ')[0];
  const c = parse(cmd);
  if (!c || c.name === 'UNKNOWN' || c.secret || c.mutates || c.error || linkChanges(c) || CARD_DENY.includes(head) || CARD_DENY.includes(c.name)) {
    throw new ChatError('bad_card', 'That screen cannot be attached.');
  }
  let title = '';
  try { title = titleOf ? String(titleOf(c) || '') : ''; } catch { title = ''; }
  title = cleanMessage(title).replace(/\s+/g, ' ').trim().slice(0, MAX_CARD).trim();
  if (!title || hasLink(title)) title = cmd;
  return { cmd, title };
}

// ---- the long-poll hub -----------------------------------------------------------------
// Events are nudges: { id, type, room? }. The client answers any of them by loading the
// list again, and the open room's new messages. Each licence keeps its newest event id
// and its last 20 events, in memory only (a restart starts over; ids come from the
// clock, so they still only go up).

export const WAIT_MS = 25_000;
export const MAX_WAITS_PER_LICENCE = 3;
export const MAX_WAITS = 500;
const KEEP_EVENTS = 20;
const MAX_LICENCES = 50_000;

export function createHub({ now = () => Date.now(), waitMs = WAIT_MS, perLicence = MAX_WAITS_PER_LICENCE, total = MAX_WAITS } = {}) {
  let seq = 0;
  const recent = new Map(); // licence id -> { last, floor, events }
  const waiting = new Map(); // licence id -> [waiter]
  let open = 0;

  const seen = new Map(); // licence id -> the last time a wait of theirs started or ended (DRIVE)
  const next = () => { seq = Math.max(now(), seq + 1); return seq; };
  const touch = (lic) => {
    seen.delete(lic);
    seen.set(lic, now());
    if (seen.size > MAX_LICENCES) seen.delete(seen.keys().next().value);
  };

  // Events for a licence after this id: [] when none; a resync nudge when some were dropped.
  function since(lic, after) {
    const r = recent.get(lic);
    if (!r || r.last <= after) return [];
    const kept = r.events.filter((e) => e.id > after);
    return r.floor > after ? [{ id: r.last, type: 'resync' }, ...kept] : kept;
  }

  function drop(lic, w) {
    const list = waiting.get(lic);
    if (!list) return;
    const i = list.indexOf(w);
    if (i >= 0) { list.splice(i, 1); open -= 1; }
    if (!list.length) waiting.delete(lic);
  }

  return {
    cursor: () => seq,
    open: () => open,
    // DRIVE: is this licence still listening? A wait open now, or one that started or
    // ended in the last `ms`. touch(lic) counts as one (the moment DRIVE or FOLLOW starts).
    touch,
    alive(lic, ms) {
      if (waiting.get(lic)?.length) return true;
      const at = seen.get(lic);
      return at !== undefined && now() - at < ms;
    },
    // Send an event to these licences: every waiting request of theirs answers now.
    emit(lics, event) {
      const e = { ...event, id: next() };
      for (const lic of new Set(lics)) {
        let r = recent.get(lic);
        if (r) recent.delete(lic); // newest last, so the oldest go first when full
        else r = { last: 0, floor: 0, events: [] };
        r.last = e.id;
        r.events.push(e);
        if (r.events.length > KEEP_EVENTS) r.floor = r.events.shift().id; // older than the kept ones: resync
        recent.set(lic, r);
        if (recent.size > MAX_LICENCES) recent.delete(recent.keys().next().value);
        for (const w of [...(waiting.get(lic) || [])]) w.finish();
      }
      return e;
    },
    // Wait for events after `after`. answer(events, last) is called once: at once when
    // there is something already, on the next event, or empty after waitMs. Returns
    // cancel() (the request closed), or null when the server holds too many waits.
    wait(lic, after, answer) {
      touch(lic);
      const ready = since(lic, after);
      if (ready.length) { answer(ready, recent.get(lic).last); return () => {}; }
      if (open >= total) return null;
      const list = waiting.get(lic) || [];
      // A fourth tab: the oldest wait answers empty, so a licence holds at most 3.
      while (list.length >= perLicence) list[0].finish(true, true);
      let done = false;
      const w = {
        finish(empty = false, evicted = false) {
          if (done) return;
          done = true;
          clearTimeout(w.timer);
          drop(lic, w);
          touch(lic);
          const events = empty ? [] : since(lic, after);
          answer(events, Math.max(after, events.length ? recent.get(lic).last : after), evicted);
        },
      };
      w.timer = setTimeout(() => w.finish(true), waitMs);
      w.timer.unref?.();
      list.push(w);
      waiting.set(lic, list);
      open += 1;
      return () => {
        if (done) return;
        done = true;
        clearTimeout(w.timer);
        drop(lic, w);
        touch(lic);
      };
    },
  };
}

// ---- DRIVE: friends' terminals follow the screens you open --------------------------------
// One driver per room. In memory only (one server process): a restart ends every drive.
// Followers opt in with FOLLOW; the server sends each screen the driver opens only to the
// followers, as a hub event. Screens are never stored.

export const DRIVE_IDLE_MS = 10 * 60 * 1000; // no screen sent for 10 minutes: it stops
export const DRIVE_GONE_MS = 60 * 1000; // the driver's page stopped listening: it stops
export const DRIVE_CMDS_PER_MIN = 60;
export const drivingLine = (who) => `${who} is driving.`;
export const stoppedLine = (who) => `${who} stopped.`;

export function createDrives({ now = () => Date.now() } = {}) {
  const rooms = new Map(); // room id -> { driver, by, cmd, seq, at, followers: Set }
  return {
    get: (room) => rooms.get(room) || null,
    rooms: () => [...rooms.entries()],
    // lic drives room now. Returns the drive it replaced (a takeover), or null.
    start(room, lic, by) {
      const prev = rooms.get(room) || null;
      rooms.set(room, { driver: lic, by, cmd: null, seq: prev ? prev.seq : 0, at: now(), followers: new Set() });
      return prev && prev.driver !== lic ? prev : null;
    },
    // Ends the drive of this room; returns it, or null when there was none.
    stop(room) {
      const d = rooms.get(room) || null;
      rooms.delete(room);
      return d;
    },
    // The driver's next screen: { cmd, seq }, or null when lic is not the driver.
    send(room, lic, cmd) {
      const d = rooms.get(room);
      if (!d || d.driver !== lic) return null;
      d.seq += 1;
      d.cmd = cmd;
      d.at = now();
      return { cmd, seq: d.seq };
    },
    follow(room, lic) {
      const d = rooms.get(room);
      if (!d || d.driver === lic) return null;
      d.followers.add(lic);
      return d;
    },
    unfollow(room, lic) {
      const d = rooms.get(room);
      if (!d || !d.followers.delete(lic)) return null;
      return d;
    },
    idle: (d) => now() - d.at >= DRIVE_IDLE_MS,
  };
}
