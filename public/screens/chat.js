// CHAT: private chat between Pro members who added each other by seat number. One panel:
// your chats on the left (requests first, then rooms by last activity), the open chat on
// the right. CHAT 42 opens your chat with seat 42 or asks them; CHAT 42 88 makes a group
// of your contacts. A $TICKER in a message carries the price when it was sent, so the
// chip shows the move since; a card opens a screen of the terminal. No links, no files.
// New messages come by long-poll (GET /api/chat/wait) while this screen is open.
//
// Pure *Html builders are exported for node:test; render() is the browser part.

import { esc, panel, metaNote, fmtNum } from './markets.js';
import { getKey, isPro, HEADER } from '../pro.js';
import { parseCommand, screenTitle, linkChanges, linkPlan } from '../app.js';

// The same rules as the server (pro/chat.js; test/chat.test.js checks they match).
export const MAX_TEXT = 500;
export const COUNT_FROM = 400; // the character count shows past this
export const CARD_RE = /^[A-Z0-9 .$&%<>=:/+-]{1,60}$/;
export const CARD_DENY = ['HOME', 'CHAT', 'PRO', 'LOGIN', 'LOGOUT', 'REDEEM', 'GIFT', 'FEEDBACK', 'IDEA'];
export const TICKER_WORD_RE = /(^|[^A-Za-z0-9$])\$([A-Z]{1,5}(?:\.[A-Z]{1,2})?)(?![A-Za-z0-9])/g;

export const NOT_PRO = 'Private chat with friends who have Pro.';
export const KEEP_NOTE = 'DELETED AFTER 30 DAYS';
export const CLOSED = 'This chat is closed.';
export const emptyText = (seat) => `Your seat is ${seat}. Give it to a friend with Pro, then type CHAT and their number.`;

const MINUS = '\u2212';
const q = (c) => '?' + new URLSearchParams({ c }).toString().replace(/%24/g, '$');
export const label = (seat, name) => (name ? `${name} ${seat}` : `SEAT ${seat}`);

// Name and seat, the seat in its own style so a name can never pass for another seat.
export function whoHtml(seat, name, own = false) {
  return `<span class="cm-who${own ? ' is-own' : ''}">${name ? `${esc(name)} ` : 'SEAT '}<span class="cm-seat">${esc(seat ?? '--')}</span></span>`;
}

// ---- the screen without Pro -------------------------------------------------------------

export function notProHtml() {
  return panel('1', 'CHAT', `<p class="notice">${esc(NOT_PRO)}</p>
    <p class="pro-actions"><a class="btn btn-solid" href="${q('PRO')}" data-cmd="PRO">PRO</a></p>`, { cls: 'panel-solo' });
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

// The screen you came from as a card, or null when it cannot be attached.
export function attachFor(previous) {
  const cmd = String(previous || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!cmd || !CARD_RE.test(cmd)) return null;
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

export function messageHtml(m, quotes = {}) {
  const body = `${m.text ? `<span class="cm-text">${textHtml(m.text, m.tickers, quotes)}</span>` : ''}${cardHtml(m.card)}`;
  return `<div class="cm" data-id="${Number(m.id)}"><span class="cm-t">${timeText(m.at)}</span>${whoHtml(m.seat, m.name, m.own)}<span class="cm-body">${body}</span></div>`;
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

export function headHtml(room) {
  if (!room) return '';
  const members = room.kind === 'group' ? `<span class="ct-members">${esc(room.members.map((p) => label(p.seat, p.name)).join(', '))}</span>` : '';
  const items = room.kind === 'group'
    ? [['add', 'ADD'], ['leave', 'LEAVE'], ['report', 'REPORT']]
    : [[room.blockedByMe ? 'unblock' : 'block', room.blockedByMe ? 'UNBLOCK' : 'BLOCK'], ['report', 'REPORT']];
  if (room.kind === 'group' && room.readOnly) items.shift();
  return `<button type="button" class="chip ct-back" data-act="back">BACK</button>
    <div class="ct-title"><span class="ct-name">${esc(room.title)}</span>${members}</div>
    <button type="button" class="chip ct-more" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="Chat menu">...</button>
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

// ---- the list ---------------------------------------------------------------------------

export function listHtml({ me, requests = { in: [], out: [] }, rooms = [] }, open = null) {
  const you = `<div class="cl-me"><span class="cl-k">YOU</span>${whoHtml(me.seat, me.name, true)}<button type="button" class="chip cl-name" data-act="name">NAME</button></div>`;
  const reqs = requests.in.map((r) => `<div class="cl-req"><span class="cl-title">${whoHtml(r.seat, r.name)}</span><span class="cl-acts">${['accept', 'ignore', 'block'].map((a) => `<button type="button" class="chip" data-req="${Number(r.seat)}" data-do="${a}">${a.toUpperCase()}</button>`).join('')}</span></div>`).join('');
  const row = (r) => {
    const n = r.id === open ? 0 : Number(r.unread) || 0; // the open chat is being read
    return `<li><button type="button" class="cl-room${r.id === open ? ' is-open' : ''}${n ? ' is-unread' : ''}" data-room="${Number(r.id)}"${r.id === open ? ' aria-current="true"' : ''}>
      <span class="cl-title">${esc(r.title)}</span>${n ? `<span class="cl-n num">${n}</span>` : ''}
      <span class="cl-prev">${r.last ? esc(`${r.last.own ? 'You: ' : ''}${r.last.preview}`) : ''}</span></button></li>`;
  };
  const out = requests.out.map((r) => `<div class="cl-out">${whoHtml(r.seat, null)}<span class="cl-k">SENT</span></div>`).join('');
  return `${you}${reqs}<ul class="cl-rooms">${rooms.map(row).join('')}</ul>${out}`;
}

export const isEmpty = (s) => !s.rooms.length && !s.requests.in.length && !s.requests.out.length;

export function chatInnerHtml() {
  return `<div class="chat" data-own-focus>
      <nav class="chat-list" aria-label="Chats"></nav>
      <section class="chat-thread" aria-label="Messages">
        <header class="ct-head"></header>
        <div class="ct-msgs" role="log" aria-live="polite"></div>
        <div class="ct-foot"></div>
      </section>
    </div>`;
}

export function shellHtml() {
  return panel('1', 'CHAT', chatInnerHtml(), { cls: 'panel-solo chat-panel', meta: metaNote(KEEP_NOTE), bodyCls: 'chat-body' });
}

export function emptyHtml(seat) {
  return `<div class="chat-empty"><p class="notice">${esc(emptyText(seat))}</p></div>`;
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
  const st = { me: null, requests: { in: [], out: [] }, rooms: [], cursor: 0, open: null, msgs: [], more: false, quotes: {}, attach: attachFor(ctx.previous), attachOn: false, loadingOlder: false };
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
    head.innerHTML = headHtml(r);
    foot.innerHTML = composerHtml(r, st.attach, st.attachOn);
    const input = foot.querySelector('.cc-input');
    if (input && typed) { input.value = typed; grow(input); }
    paintMessages(true);
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
    paint();
    const d = await api(`/api/chat/rooms/${id}/messages`, { signal });
    if (!alive() || st.open !== id) return;
    st.msgs = d.messages;
    st.more = d.more;
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

  async function newer() {
    if (!st.open) return;
    const id = st.open;
    const last = st.msgs.length ? st.msgs[st.msgs.length - 1].id : 0;
    const d = await api(`/api/chat/rooms/${id}/messages${last ? `?after=${last}` : ''}`, { signal });
    if (!alive() || st.open !== id) return;
    const have = new Set(st.msgs.map((m) => m.id));
    const add = d.messages.filter((m) => !have.has(m.id));
    if (!add.length) return;
    st.msgs.push(...add);
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
      st.msgs.unshift(...d.messages);
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
      if (!st.msgs.some((m) => m.id === d.message.id)) st.msgs.push(d.message);
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
    await act(async () => {
      const d = await api(`/api/chat/rooms/${r.id}`, { method: 'POST', body: { action: a }, signal });
      if (a === 'leave') { st.open = null; st.msgs = []; ctx.status('YOU LEFT THE GROUP'); } else ctx.status(a === 'block' ? 'BLOCKED' : 'UNBLOCKED');
      if (d.room) Object.assign(room() || {}, d.room);
      await loadList();
    });
  }

  function editName() {
    const box = $('.cl-me');
    if (!box) return;
    box.innerHTML = `<form class="cl-name-form"><input class="ct-in" maxlength="16" aria-label="Your name" placeholder="Your name" value="${esc(st.me.name || '')}"><button type="submit" class="chip">SAVE</button></form>`;
    const i = box.querySelector('input');
    i.focus();
    i.select();
    i.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); $('.chat-list').innerHTML = listHtml(st, st.open); } });
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
      case 'name': editName(); break;
      default:
    }
  });

  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.classList.contains('ct-compose')) { send(); return; }
    const val = f.querySelector('input')?.value || '';
    if (f.classList.contains('cl-name-form')) {
      act(async () => {
        const d = await api('/api/chat/me', { method: 'PUT', body: { name: val }, signal });
        st.me = d.me;
        for (const m of st.msgs) if (m.own) m.name = d.me.name;
        ctx.status('NAME SAVED');
        await loadList();
      });
      return;
    }
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
  async function loop() {
    let backoff = 5000;
    while (alive()) {
      try {
        const d = await api(`/api/chat/wait?after=${st.cursor}`, { signal });
        if (!alive()) return;
        backoff = 5000;
        if (Number.isFinite(d.last) && d.last > st.cursor) st.cursor = d.last;
        if (d.events?.length) {
          await newer(); // first, so the open chat is read before the list counts it
          await loadList();
        }
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
      else if (cmd.args?.seats?.length) {
        const d = await api('/api/chat/open', { method: 'POST', body: { seats: cmd.args.seats }, signal });
        if (d.room) target = d.room.id;
        else ctx.status(d.message.toUpperCase());
      }
      await loadList();
      if (!target && wide() && st.rooms.length) target = st.rooms[0].id;
      if (target) await openRoom(target);
      else if (!cmd.args?.seats?.length && !cmd.error) ctx.status('CHAT');
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
