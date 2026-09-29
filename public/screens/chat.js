// CHAT: private chat between Pro members who added each other by seat number. One panel:
// your chats on the left (requests first, then rooms by last activity), the open chat on
// the right. CHAT 42 (or CHAT @tom, by username) opens your chat with seat 42 or asks
// them; CHAT 42 88 makes a group of your contacts. People show as their pixel avatar,
// their username in its colour and #42 (ME sets all three; NAME opens ME). A $TICKER in a message carries the price when it was sent, so the
// chip shows the move since; a card opens a screen of the terminal. No links, no files.
// New messages come by long-poll (GET /api/chat/wait) while this screen is open.
// GO LIVE (../drive.js, DRIVE in the code): the thread head has GO LIVE; a room where
// someone is live shows one line with WATCH. GUESS LEAGUE: GUESS results are one line each, and TODAY'S GUESS sits
// over the thread when anyone in the room posted today's.
//
// Pure *Html builders are exported for node:test; render() is the browser part.

import { esc, panel, metaNote, fmtNum } from './markets.js';
import { getKey, isPro, HEADER, normalizeKey, normalizeGiftCode, chatBeep } from '../pro.js';
import { avatarSvg, nameHtml } from '../pixel-avatar.js';
import { parseCommand, screenTitle, linkChanges, linkPlan } from '../app.js';
import { drive, who as driverName } from '../drive.js';
import { cardPage, cardButton, raw, emptyState } from '../kit.js';

// The same rules as the server (pro/chat.js; test/chat.test.js checks they match).
export const MAX_TEXT = 500;
export const COUNT_FROM = 400; // the character count shows past this
export const CARD_RE = /^[A-Z0-9 .$&%<>=:/+-]{1,60}$/;
export const CARD_DENY = ['HOME', 'CHAT', 'PRO', 'LOGIN', 'LOGOUT', 'REDEEM', 'GIFT', 'FEEDBACK', 'IDEA', 'ME'];
export const TICKER_WORD_RE = /(^|[^A-Za-z0-9$])\$([A-Z]{1,5}(?:\.[A-Z]{1,2})?)(?![A-Za-z0-9])/g;

export const NOT_PRO = 'Private chat with friends who have Pro.';
export const KEEP_NOTE = 'DELETED AFTER 30 DAYS';
export const CLOSED = 'This chat is closed.';
export const emptyText = (seat) => `Your seat is ${seat}. Give it to a Pro friend, then type CHAT and their number.`;

const MINUS = '\u2212';
const q = (c) => '?' + new URLSearchParams({ c }).toString().replace(/%24/g, '$');
export const label = (seat, name) => (name ? `${name} #${seat}` : `SEAT ${seat}`);

// Avatar, username in its colour, and the seat in its own style, so a name can never pass
// for another seat. p: the person's { color, avatar } (ME).
export function whoHtml(seat, name, own = false, p = null) {
  const person = { seat: seat ?? null, name: name || null, color: p?.color ?? null, avatar: p?.avatar || null };
  const av = avatarSvg(person, { size: 16, cls: 'cm-av' });
  if (!name) return `<span class="cm-who${own ? ' is-own' : ''}">${av} SEAT <span class="cm-seat">${esc(seat ?? '--')}</span></span>`;
  return `<span class="cm-who${own ? ' is-own' : ''}">${av} ${nameHtml(person)} <span class="cm-seat">#${esc(seat ?? '--')}</span></span>`;
}

// ---- the screen without Pro -------------------------------------------------------------

// A card page (kit.js cardPage): CHAT, what it is, and PRO.
export function notProHtml() {
  return cardPage({ label: 'CHAT', hero: 'CHAT', heroSize: 60, sub: NOT_PRO, act: raw(cardButton({ label: 'PRO', primary: true, cmd: 'PRO' })) });
}

// ---- $TICKER chips ----------------------------------------------------------------------

// t: { sym, price?, at? } (the price when it was sent); live: the price now, or null.
// '$NVDA 182.40 +4.2% since', green up, red down; no stamp: the live price only.
export function chipHtml(t, live = null) {
  const sym = String(t?.sym || '');
  const stamp = Number.isFinite(t?.price) && t.price > 0 ? t.price : null;
  const now = Number.isFinite(live) && live > 0 ? live : null;
  let text = `$${sym}`;
  let cls = '';
  let title = `Open ${sym}`;
  if (now !== null && stamp !== null) {
    const pct = (now / stamp - 1) * 100;
    const r = Math.round(pct * 10) / 10;
    cls = r > 0 ? ' up' : r < 0 ? ' down' : '';
    text += ` ${fmtNum(now)} ${r > 0 ? '+' : r < 0 ? MINUS : ''}${Math.abs(r).toFixed(1)}% since`;
    title = `${fmtNum(stamp)} when sent`;
  } else if (now !== null) text += ` ${fmtNum(now)}`;
  else if (stamp !== null) { text += ` ${fmtNum(stamp)}`; title = `${fmtNum(stamp)} when sent`; }
  return `<button type="button" class="cm-chip${cls}" data-sym="${esc(sym)}" title="${esc(title)}">${esc(text)}</button>`;
}

// A message's text, escaped, with its stamped $TICKERs as chips. quotes: { SYM: price }.
export function textHtml(text, tickers = [], quotes = {}) {
  const by = new Map((tickers || []).map((t) => [t.sym, t]));
  let out = '';
  let at = 0;
  const s = String(text ?? '');
  for (const m of s.matchAll(TICKER_WORD_RE)) {
    const t = by.get(m[2]);
    if (!t) continue;
    const start = m.index + m[1].length;
    out += esc(s.slice(at, start)) + chipHtml(t, quotes[m[2]] ?? null);
    at = start + m[2].length + 1;
  }
  return out + esc(s.slice(at));
}

// A card: a small box with the screen's title and its command; a click opens it.
export function cardHtml(card) {
  if (!card?.cmd) return '';
  const title = card.title && card.title !== card.cmd ? `<span class="cm-card-t">${esc(card.title)}</span>` : '';
  return `<button type="button" class="cm-card" data-card="${esc(card.cmd)}">${title}<span class="cm-card-c">${esc(card.cmd)}</span></button>`;
}

// A Pro key or a gift code anywhere in a command (HELP BB-XXXX-..., GRID AAPL bbxxxx...,
// WHATIF 7K2M ABCD ...): such a command is never a card and never driven. Any four groups
// of four joined by a sign; one word, or words after BB or GIFT, that make a key or a code
// (case and signs do not matter); and words split by spaces that make one when a digit is
// in them (AAPL MSFT NVDA TSLA stays four tickers). pro/chat.js has the same
// (test/chat-drive.test.js checks they agree).
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

// The screen you came from as a card, or null when it cannot be attached.
export function attachFor(previous) {
  const cmd = String(previous || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!cmd || !CARD_RE.test(cmd) || secretIn(cmd)) return null;
  const c = parseCommand(cmd);
  if (!c || c.name === 'UNKNOWN' || c.secret || c.mutates || c.error || linkChanges(c)) return null;
  if (CARD_DENY.includes(cmd.split(' ')[0]) || CARD_DENY.includes(c.name)) return null;
  const title = String(screenTitle(c).title || cmd).slice(0, 60);
  return { cmd, title };
}

// ---- times ------------------------------------------------------------------------------

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
export const timeText = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function dayLabel(ms, now = Date.now()) {
  if (dayOf(ms) === dayOf(now)) return 'TODAY';
  const d = new Date(ms);
  const y = new Date(now).getFullYear() === d.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${MON[d.getMonth()]} ${d.getDate()}${y}`;
}

// ---- the thread -------------------------------------------------------------------------

// GUESS LEAGUE: '4/6', or 'X/6' for a game not solved.
export const GUESS_OF = 6;
// Typed with a chat open: GO LIVE, or DRIVE (its first name, kept as an alias).
export const LIVE_WORDS = ['GO LIVE', 'DRIVE'];
export const scoreText = (g, of = GUESS_OF) => `${g?.solved ? g.tries : 'X'}/${of}`;

export function messageHtml(m, quotes = {}) {
  // A line from the server: "Tom #1 is live.", last week's GUESS winner.
  if (m.kind === 'sys') return `<div class="cm cm-sys" data-id="${Number(m.id)}"><span class="cm-t">${timeText(m.at)}</span><span class="cm-body">${esc(m.text)}</span></div>`;
  // A GUESS result: one line, a click opens GUESS.
  if (m.kind === 'guess' && m.guess) {
    return `<div class="cm cm-guess" data-id="${Number(m.id)}"><span class="cm-t">${timeText(m.at)}</span>${whoHtml(m.seat, m.name, m.own, m)}<span class="cm-body"><button type="button" class="cm-card cm-gres" data-card="GUESS"><span class="cm-card-t">GUESS #${Number(m.guess.n)}</span><span class="num">${esc(scoreText(m.guess))}</span></button></span></div>`;
  }
  const body = `${m.text ? `<span class="cm-text">${textHtml(m.text, m.tickers, quotes)}</span>` : ''}${cardHtml(m.card)}`;
  return `<div class="cm" data-id="${Number(m.id)}"><span class="cm-t">${timeText(m.at)}</span>${whoHtml(m.seat, m.name, m.own, m)}<span class="cm-body">${body}</span></div>`;
}

// Messages oldest first, with a day row where the day changes.
export function messagesHtml(list, quotes = {}, now = Date.now()) {
  let day = '';
  let out = '';
  for (const m of list) {
    const d = dayOf(m.at);
    if (d !== day) { day = d; out += `<div class="cm-day" role="separator">${esc(dayLabel(m.at, now))}</div>`; }
    out += messageHtml(m, quotes);
  }
  return out;
}

// GO LIVE in the thread head: GO LIVE, STOP while you are live in this room, TAKE OVER
// while someone else is (it asks first). Not in a closed chat.
export function driveChipHtml(room, dv = null) {
  if (!room || room.readOnly) return '';
  const mine = dv?.role === 'drive' && dv.room === room.id;
  if (!mine && room.drive && !room.drive.own) return '<button type="button" class="chip ct-drive" data-act="take">TAKE OVER</button>';
  return `<button type="button" class="chip ct-drive${mine ? ' is-on' : ''}" data-act="${mine ? 'drive-stop' : 'drive'}" aria-pressed="${mine}">${mine ? 'STOP' : 'GO LIVE'}</button>`;
}
// TAKE OVER asks first, one line: Enter takes over, Esc keeps things as they are.
export function takeConfirmHtml(by) {
  return `<div class="desk-confirm ct-confirm" role="alertdialog" aria-label="Take over the live screen" tabindex="-1"><span class="desk-confirm-text">Take over from ${esc(driverName(by))}?</span><button type="button" class="desk-btn" data-act="take-yes">ENTER: TAKE OVER</button><button type="button" class="desk-btn" data-act="take-no">ESC: CANCEL</button></div>`;
}

// The lines over the thread: someone is live (WATCH, or STOP while you watch), and
// TODAY'S GUESS when anyone here posted today's. '' when neither.
export function extraHtml(room, dv = null, guess = null) {
  if (!room) return '';
  let out = '';
  const d = room.drive;
  if (d && !d.own) {
    const on = dv?.role === 'follow' && dv.room === room.id;
    out += on
      ? `<p class="ct-line ct-offer"><span>Watching ${esc(driverName(d.by))}.</span><button type="button" class="chip" data-act="unfollow">STOP</button></p>`
      : `<p class="ct-line ct-offer"><span>${esc(driverName(d.by))} is live.</span><button type="button" class="chip" data-act="follow">WATCH</button></p>`;
  }
  if (guess?.scores?.length) {
    // Each player as everywhere else: avatar, username in its colour, #seat.
    const list = guess.scores.map((g) => `${whoHtml(g.seat, g.name, Boolean(g.own), g)} <span class="num">${esc(scoreText(g, guess.of || GUESS_OF))}</span>`).join('<span class="dv-sep">·</span>');
    out += `<button type="button" class="ct-line ct-guess" data-card="GUESS" title="Open GUESS"><span class="ct-gk">TODAY'S GUESS</span><span class="ct-gl">${list}</span></button>`;
  }
  return out;
}

export function headHtml(room, dv = null) {
  if (!room) return '';
  const members = room.kind === 'group' ? `<span class="ct-members">${esc(room.members.map((p) => label(p.seat, p.name)).join(', '))}</span>` : '';
  const items = room.kind === 'group'
    ? [['add', 'ADD'], ['leave', 'LEAVE'], ['report', 'REPORT']]
    : [[room.blockedByMe ? 'unblock' : 'block', room.blockedByMe ? 'UNBLOCK' : 'BLOCK'], ['report', 'REPORT']];
  if (room.kind === 'group' && room.readOnly) items.shift();
  return `<button type="button" class="chip ct-back" data-act="back">BACK</button>
    <div class="ct-title"><span class="ct-name">${esc(room.title)}</span>${members}</div>
    ${driveChipHtml(room, dv)}<button type="button" class="chip ct-more" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="Chat menu">...</button>
    <div class="ct-menu" role="menu" hidden>${items.map(([a, t]) => `<button type="button" role="menuitem" class="ct-mi" data-menu="${a}">${t}</button>`).join('')}</div>
    <form class="ct-inline" hidden></form>`;
}

export function composerHtml(room, attach = null, on = false) {
  if (!room) return '';
  if (room.readOnly) return `<p class="ct-closed muted">${esc(CLOSED)}</p>`;
  const chip = attach ? `<button type="button" class="chip cc-attach${on ? ' is-on' : ''}" data-act="attach" aria-pressed="${on}" title="Attach this screen">+ ${esc(attach.cmd)}</button>` : '';
  return `<form class="ct-compose" novalidate>${chip}<textarea class="cc-input" rows="1" maxlength="${MAX_TEXT}" spellcheck="true" enterkeyhint="send" aria-label="Message" placeholder="Message"></textarea><span class="cc-count num" hidden></span><button type="submit" class="chip cc-send">SEND</button></form>`;
}

export const countText = (n) => (n > COUNT_FROM ? `${n}/${MAX_TEXT}` : '');

// Messages merged by id: each once, in id order. Your own message can come back from
// SEND before one from someone else that was sent just before it.
export function mergeMessages(list, add) {
  const by = new Map(list.map((m) => [m.id, m]));
  for (const m of add) by.set(m.id, m);
  return [...by.values()].sort((a, b) => a.id - b.id);
}

// How long to wait before the next long-poll: at once after events or a full hold; a
// pause when a newer view took this one's place (evicted) or an empty answer came back
// early, so several open views can never loop at network speed.
export const WAIT_HOLD_MS = 20_000;
export const WAIT_PAUSE_MS = 5_000;
export function waitPause({ events = [], evicted = false, elapsed = 0 } = {}) {
  if (evicted) return WAIT_PAUSE_MS;
  if (!events.length && elapsed < WAIT_HOLD_MS) return WAIT_PAUSE_MS;
  return 0;
}

// ---- the list ---------------------------------------------------------------------------

export function listHtml({ me, requests = { in: [] }, rooms = [] }, open = null) {
  // NAME opens ME, where the username, colour and avatar are set.
  const you = `<div class="cl-me"><span class="cl-k">YOU</span>${whoHtml(me.seat, me.name, true, me)}<a class="chip cl-name" href="?c=ME" data-cmd="ME">NAME</a></div>`;
  const reqs = requests.in.map((r) => `<div class="cl-req"><span class="cl-title">${whoHtml(r.seat, r.name, false, r)}</span><span class="cl-acts">${['accept', 'ignore', 'block'].map((a) => `<button type="button" class="chip" data-req="${Number(r.seat)}" data-do="${a}">${a.toUpperCase()}</button>`).join('')}</span></div>`).join('');
  const row = (r) => {
    const n = r.id === open ? 0 : Number(r.unread) || 0; // the open chat is being read
    return `<li><button type="button" class="cl-room${r.id === open ? ' is-open' : ''}${n ? ' is-unread' : ''}" data-room="${Number(r.id)}"${r.id === open ? ' aria-current="true"' : ''}>
      <span class="cl-title">${esc(r.title)}</span>${n ? `<span class="cl-n num">${n}</span>` : ''}
      <span class="cl-prev">${r.last ? esc(`${r.last.own ? 'You: ' : ''}${r.last.preview}`) : ''}</span></button></li>`;
  };
  return `${you}${reqs}<ul class="cl-rooms">${rooms.map(row).join('')}</ul>`;
}

export const isEmpty = (s) => !s.rooms.length && !s.requests.in.length;

export function chatInnerHtml() {
  return `<div class="chat" data-own-focus>
      <nav class="chat-list" aria-label="Chats"></nav>
      <section class="chat-thread" aria-label="Messages">
        <header class="ct-head"></header>
        <div class="ct-extra"></div>
        <div class="ct-msgs" role="log" aria-live="polite"></div>
        <div class="ct-foot"></div>
      </section>
    </div>`;
}

export function shellHtml() {
  return panel('1', 'CHAT', chatInnerHtml(), { cls: 'panel-solo chat-panel', meta: metaNote(KEEP_NOTE), bodyCls: 'chat-body' });
}

export function emptyHtml(seat) {
  // The kit's empty state: the seat as the title, how to start a chat as the hint.
  const [title, hint] = emptyText(seat).split(/(?<=\.) /);
  return emptyState({ title, hint, cls: 'chat-empty' });
}

// ---- the browser -------------------------------------------------------------------------

class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

function api(url, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json', [HEADER]: getKey() || '' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store' })
    .catch((err) => { if (err?.name === 'AbortError') throw err; throw new ApiError('You look offline. It tries again by itself.', 0, 'network'); })
    .then(async (res) => {
      let d = null;
      try { d = await res.json(); } catch { /* none */ }
      if (!res.ok) throw new ApiError(d?.message || 'Something went wrong. Try again in a minute.', res.status, d?.error);
      return d;
    });
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); resolve(); }, { once: true });
});

export function render(el, cmd, ctx) {
  if (!isPro()) {
    el.innerHTML = notProHtml();
    ctx.status('CHAT IS PART OF PRO');
    return undefined;
  }
  const { signal } = ctx;
  const wide = () => typeof matchMedia !== 'function' || matchMedia('(min-width: 700px)').matches;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const st = { me: null, requests: { in: [] }, rooms: [], cursor: 0, open: null, msgs: [], loadedId: 0, more: false, quotes: {}, attach: attachFor(ctx.previous), attachOn: false, loadingOlder: false, guess: null };
  const dv = drive({ shareable: attachFor }); // DRIVE: one for the page, lives on after this screen
  el.innerHTML = shellHtml();
  const body = () => el.querySelector('.chat-body');
  const alive = () => !signal.aborted && el.isConnected;
  const warn = (msg) => ctx.status(String(msg).toUpperCase(), 'warn');
  const room = () => st.rooms.find((r) => r.id === st.open) || null;
  const $ = (sel) => el.querySelector(sel);

  function unreadOut() {
    const n = st.rooms.reduce((a, r) => a + (r.id === st.open ? 0 : r.unread), 0) + st.requests.in.length;
    window.dispatchEvent(new CustomEvent('bb:chat-unread', { detail: n }));
  }

  // The whole layout for the current state: the empty line, or list + thread.
  function paint() {
    if (!alive() || !body()) return;
    if (isEmpty(st)) { body().innerHTML = emptyHtml(st.me.seat); return; }
    if (!$('.chat')) body().innerHTML = chatInnerHtml();
    $('.chat').classList.toggle('has-room', Boolean(st.open));
    $('.chat-list').innerHTML = listHtml(st, st.open);
    paintThread();
  }
  function paintThread() {
    const r = room();
    const head = $('.ct-head');
    const foot = $('.ct-foot');
    if (!head) return;
    const typed = foot.querySelector('.cc-input')?.value || '';
    head.innerHTML = headHtml(r, dv.state());
    paintExtra();
    foot.innerHTML = composerHtml(r, st.attach, st.attachOn);
    const input = foot.querySelector('.cc-input');
    if (input && typed) { input.value = typed; grow(input); }
    paintMessages(true);
  }
  function paintExtra() {
    const x = $('.ct-extra');
    if (x) x.innerHTML = extraHtml(room(), dv.state(), st.guess);
  }
  // GO LIVE started, ended or its count moved: the head and the lines over the thread.
  const unsub = dv.subscribe(() => {
    if (!alive()) return;
    const head = $('.ct-head');
    if (head && room()) head.innerHTML = headHtml(room(), dv.state());
    paintExtra();
  });
  ctx.onCleanup(unsub);
  // GO LIVE (or DRIVE, its old name) typed in the command bar while a chat is open.
  ctx.setCommandHook?.((clean) => {
    const r = room();
    if (!LIVE_WORDS.includes(clean) || !r || r.readOnly) return false;
    const now = dv.state();
    if (now?.role === 'drive' && now.room === r.id) { ctx.status('LIVE: OPEN ANY SCREEN'); return true; }
    act(() => startDrive(r));
    return true;
  });
  function askTake() {
    const r = room();
    const x = $('.ct-extra');
    if (!r?.drive || !x) return;
    $('.ct-confirm')?.remove();
    x.insertAdjacentHTML('afterbegin', takeConfirmHtml(r.drive.by));
    $('.ct-confirm').focus();
  }
  function answerTake(yes) {
    $('.ct-confirm')?.remove();
    const r = room();
    if (yes && r) act(() => startDrive(r));
    else if (!coarse) $('.cc-input')?.focus();
  }
  async function startDrive(r) {
    await dv.start(r.id);
    ctx.status('LIVE: OPEN ANY SCREEN');
  }

  function paintMessages(stick = false) {
    const box = $('.ct-msgs');
    if (!box) return;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = messagesHtml(st.msgs, st.quotes);
    if (stick || atEnd) box.scrollTop = box.scrollHeight;
  }

  async function loadList() {
    const d = await api('/api/chat', { signal });
    if (!alive()) return;
    st.me = d.me;
    st.requests = d.requests;
    st.rooms = d.rooms;
    if (!st.cursor) st.cursor = d.cursor;
    if (st.open && !room()) { st.open = null; st.msgs = []; }
    paint();
    unreadOut();
  }

  async function openRoom(id) {
    st.open = id;
    st.msgs = [];
    st.more = false;
    st.guess = null;
    paint();
    const d = await api(`/api/chat/rooms/${id}/messages${document.hidden ? '?read=0' : ''}`, { signal });
    if (!alive() || st.open !== id) return;
    st.msgs = mergeMessages([], d.messages);
    st.loadedId = st.msgs.length ? st.msgs[st.msgs.length - 1].id : 0;
    st.more = d.more;
    st.guess = d.guess || null;
    paintExtra();
    const r = room();
    if (r) r.unread = 0;
    $('.chat-list') && ($('.chat-list').innerHTML = listHtml(st, st.open));
    paintMessages(true);
    unreadOut();
    loadQuotes();
    // Not while a link waits for Enter or Esc: Enter must answer the link.
    if (!coarse && !document.querySelector('.link-confirm')) $('.cc-input')?.focus();
    ctx.status(`CHAT: ${r ? r.title.toUpperCase() : ''}`);
  }

  // Everything after the last message this view loaded (st.loadedId: only openRoom and
  // newer move it, never SEND), page by page. A hidden tab reads without marking read.
  async function newer() {
    if (!st.open) return;
    const id = st.open;
    let added = false;
    for (let page = 0; page < 10; page++) {
      const read = document.hidden ? '&read=0' : '';
      const d = await api(`/api/chat/rooms/${id}/messages?after=${st.loadedId}${read}`, { signal });
      if (!alive() || st.open !== id) return;
      if (page === 0 && JSON.stringify(d.guess || null) !== JSON.stringify(st.guess)) { st.guess = d.guess || null; paintExtra(); }
      if (d.messages.length) {
        // CHAT SOUND (ME): a new message from someone else in the open chat.
        const known = new Set(st.msgs.map((m) => m.id));
        if (d.messages.some((m) => !m.own && m.kind !== 'sys' && !known.has(m.id))) chatBeep();
        st.msgs = mergeMessages(st.msgs, d.messages);
        st.loadedId = Math.max(st.loadedId, d.messages[d.messages.length - 1].id);
        added = true;
      }
      if (!d.more) break;
    }
    if (!added) return;
    paintMessages();
    loadQuotes();
  }

  async function older() {
    const box = $('.ct-msgs');
    if (!st.open || !st.more || st.loadingOlder || !st.msgs.length) return;
    st.loadingOlder = true;
    const id = st.open;
    try {
      const d = await api(`/api/chat/rooms/${id}/messages?before=${st.msgs[0].id}`, { signal });
      if (!alive() || st.open !== id) return;
      const h = box.scrollHeight;
      st.msgs = mergeMessages(st.msgs, d.messages);
      st.more = d.more;
      paintMessages();
      box.scrollTop = box.scrollHeight - h;
    } finally { st.loadingOlder = false; }
  }

  // Live prices for every chip in the open chat: one /api/quotes call.
  async function loadQuotes() {
    const syms = [...new Set(st.msgs.flatMap((m) => (m.tickers || []).map((t) => t.sym)))].slice(-60);
    if (!syms.length) return;
    try {
      const d = await ctx.fetchJSON(`/api/quotes?s=${syms.map((s) => `$${s}`).join(',')}`, { signal });
      if (!alive()) return;
      for (const x of d.quotes || []) st.quotes[String(x.ticker).replace(/^\$/, '')] = x.last;
      paintMessages();
    } catch { /* chips keep what they have */ }
  }

  async function send() {
    const input = $('.cc-input');
    const r = room();
    if (!input || !r) return;
    const text = input.value;
    const card = st.attachOn && st.attach ? st.attach : undefined;
    if (!text.trim() && !card) return;
    input.disabled = true;
    try {
      const d = await api(`/api/chat/rooms/${r.id}/messages`, { method: 'POST', body: card ? { text, card } : { text }, signal });
      if (!alive()) return;
      input.value = '';
      grow(input);
      st.attachOn = false;
      $('.cc-attach')?.classList.remove('is-on');
      $('.cc-attach')?.setAttribute('aria-pressed', 'false');
      st.msgs = mergeMessages(st.msgs, [d.message]);
      paintMessages(true);
      counter(input);
      loadQuotes();
      ctx.status('SENT');
    } catch (err) {
      if (err.name !== 'AbortError') warn(err.message);
    } finally {
      input.disabled = false;
      if (alive() && !coarse) input.focus();
    }
  }

  function grow(t) {
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
  }
  function counter(t) {
    const c = $('.cc-count');
    if (!c) return;
    const s = countText(t.value.length);
    c.textContent = s;
    c.hidden = !s;
  }

  async function act(fn) {
    try { await fn(); } catch (err) {
      if (err.name === 'AbortError' || !alive()) return;
      if (err.status === 401 || err.status === 402) { el.innerHTML = notProHtml(); ctx.status('PRO IS NOT ACTIVE ON THIS KEY', 'warn'); return; }
      warn(err.message);
    }
  }

  // The room menu: ADD and REPORT ask one line first; the rest run at once.
  function inline(kind) {
    const f = $('.ct-inline');
    if (!f) return;
    f.hidden = false;
    f.dataset.kind = kind;
    f.innerHTML = kind === 'add'
      ? '<input class="ct-in" inputmode="numeric" maxlength="9" aria-label="Seat number" placeholder="Seat number"><button type="submit" class="chip">ADD</button>'
      : '<input class="ct-in" maxlength="200" aria-label="Reason, optional" placeholder="Reason, optional"><button type="submit" class="chip">REPORT</button>';
    f.querySelector('input').focus();
  }
  async function menuAct(a) {
    const r = room();
    $('.ct-menu').hidden = true;
    if (!r) return;
    if (a === 'add' || a === 'report') { inline(a); return; }
    // Leaving or blocking ends your live or your watching here first.
    if ((a === 'leave' || a === 'block') && dv.state()?.room === r.id) await dv.stop();
    await act(async () => {
      const d = await api(`/api/chat/rooms/${r.id}`, { method: 'POST', body: { action: a }, signal });
      if (a === 'leave') { st.open = null; st.msgs = []; ctx.status('YOU LEFT THE GROUP'); } else ctx.status(a === 'block' ? 'BLOCKED' : 'UNBLOCKED');
      if (d.room) Object.assign(room() || {}, d.room);
      await loadList();
    });
  }

  // ---- events ----
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !el.contains(t)) {
      if (!e.target.closest('.ct-menu, [data-act="menu"]')) { const m = $('.ct-menu'); if (m) m.hidden = true; }
      return;
    }
    if (t.dataset.room) { act(() => openRoom(Number(t.dataset.room))); return; }
    if (t.dataset.req) {
      const seat = Number(t.dataset.req);
      const a = t.dataset.do;
      act(async () => {
        const d = await api(`/api/chat/requests/${seat}`, { method: 'POST', body: { action: a }, signal });
        ctx.status(a === 'accept' ? 'ACCEPTED' : a === 'block' ? 'BLOCKED' : 'IGNORED');
        await loadList();
        if (d.room) await openRoom(d.room.id);
      });
      return;
    }
    if (t.dataset.sym) { ctx.run(`$${t.dataset.sym}`); return; }
    if (t.dataset.card) {
      // Through the router, like a link: anything that would change something only shows.
      const plan = linkPlan(t.dataset.card);
      ctx.run(plan.ask ? plan.url : plan.show);
      return;
    }
    if (t.dataset.menu) { menuAct(t.dataset.menu); return; }
    switch (t.dataset.act) {
      case 'drive': { const r = room(); if (r) act(() => startDrive(r)); break; }
      case 'take': askTake(); break;
      case 'take-yes': answerTake(true); break;
      case 'take-no': answerTake(false); break;
      case 'drive-stop': dv.stop(); ctx.status('ENDED LIVE'); break;
      case 'follow': { const r = room(); if (r) act(async () => { await dv.follow(r.id); if (alive()) ctx.status('WATCHING'); }); break; }
      case 'unfollow': dv.stop(); ctx.status('STOPPED WATCHING'); break;
      case 'back': st.open = null; st.msgs = []; paint(); ctx.status('CHAT'); break;
      case 'menu': {
        const m = $('.ct-menu');
        m.hidden = !m.hidden;
        t.setAttribute('aria-expanded', String(!m.hidden));
        if (!m.hidden) m.querySelector('button')?.focus();
        break;
      }
      case 'attach':
        st.attachOn = !st.attachOn;
        t.classList.toggle('is-on', st.attachOn);
        t.setAttribute('aria-pressed', String(st.attachOn));
        $('.cc-input')?.focus();
        break;
      default:
    }
  });

  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.classList.contains('ct-compose')) { send(); return; }
    const val = f.querySelector('input')?.value || '';
    const r = room();
    if (!r) return;
    if (f.dataset.kind === 'add') {
      act(async () => {
        const d = await api(`/api/chat/rooms/${r.id}`, { method: 'POST', body: { action: 'add', seat: val.trim() }, signal });
        ctx.status('ADDED');
        if (d.room) Object.assign(r, d.room);
        await loadList();
      });
    } else {
      act(async () => {
        const d = await api(`/api/chat/rooms/${r.id}/report`, { method: 'POST', body: { reason: val }, signal });
        f.hidden = true;
        ctx.status(d.message.toUpperCase());
      });
    }
  });

  el.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.classList?.contains('cc-input')) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); return; }
      if (e.key === 'Escape') { e.preventDefault(); document.getElementById('cmd')?.focus(); }
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Escape') && $('.ct-confirm') && !e.repeat && (t.closest?.('.ct-confirm') || t === document.body)) {
      e.preventDefault();
      answerTake(e.key === 'Enter');
      return;
    }
    if (e.key === 'Escape' && t.closest?.('.ct-inline, .ct-menu')) {
      e.preventDefault();
      $('.ct-menu').hidden = true;
      const f = $('.ct-inline');
      if (f) f.hidden = true;
      $('.cc-input')?.focus();
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.classList?.contains('cc-input')) { grow(e.target); counter(e.target); }
  });
  el.addEventListener('scroll', (e) => {
    if (e.target.classList?.contains('ct-msgs') && e.target.scrollTop < 40) act(older);
  }, true);

  // ---- the long-poll: only while this screen is open ----
  // A hidden tab stops asking; it catches up when it is shown again.
  const shown = () => new Promise((resolve) => {
    if (!document.hidden) { resolve(); return; }
    const done = () => { document.removeEventListener('visibilitychange', on); resolve(); };
    const on = () => { if (!document.hidden) done(); };
    document.addEventListener('visibilitychange', on);
    signal.addEventListener('abort', done, { once: true });
  });
  async function loop() {
    let backoff = 5000;
    while (alive()) {
      try {
        if (document.hidden) {
          await shown();
          if (!alive()) return;
          await newer();
          await loadList();
        }
        const t0 = Date.now();
        const d = await api(`/api/chat/wait?after=${st.cursor}`, { signal });
        if (!alive()) return;
        backoff = 5000;
        if (Number.isFinite(d.last) && d.last > st.cursor) st.cursor = d.last;
        // DRIVE's own events (screens, counts) are for drive.js, not a reason to reload.
        if (d.events?.some((e) => !String(e.type).startsWith('drive'))) {
          await newer(); // first, so the open chat is read before the list counts it
          await loadList();
        }
        const pause = waitPause({ events: d.events || [], evicted: Boolean(d.evicted), elapsed: Date.now() - t0 });
        if (pause) await sleep(pause, signal);
      } catch (err) {
        if (!alive() || err.name === 'AbortError') return;
        if (err.status === 401 || err.status === 402) { el.innerHTML = notProHtml(); ctx.status('PRO IS NOT ACTIVE ON THIS KEY', 'warn'); return; }
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  ctx.status('CHAT: LOADING...');
  (async () => {
    try {
      let target = null;
      if (cmd.error) warn('Type CHAT and a seat number, like CHAT 42');
      else if (cmd.args?.seats?.length || cmd.args?.name) {
        const body = cmd.args.name ? { name: cmd.args.name } : { seats: cmd.args.seats };
        const d = await api('/api/chat/open', { method: 'POST', body, signal });
        if (d.room) target = d.room.id;
        else ctx.status(d.message.toUpperCase());
      }
      await loadList();
      if (!target && wide() && st.rooms.length) target = st.rooms[0].id;
      if (target) await openRoom(target);
      else if (!cmd.args?.seats?.length && !cmd.args?.name && !cmd.error) ctx.status('CHAT');
      ctx.live(loadQuotes, 60_000);
      loop();
    } catch (err) {
      if (err.name === 'AbortError' || !alive()) return;
      if (err.status === 401 || err.status === 402) { el.innerHTML = notProHtml(); ctx.status('PRO IS NOT ACTIVE ON THIS KEY', 'warn'); return; }
      warn(err.message);
      if (!st.me) { if (body()) body().innerHTML = `<p class="notice">${esc(err.message)}</p>`; }
      else { await loadList().catch(() => {}); ctx.live(loadQuotes, 60_000); loop(); }
    }
  })();
  return undefined;
}
