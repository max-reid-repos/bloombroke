// DRIVE: friends' terminals follow the screens you open, live. Loaded with the CHAT
// screen (never at startup); once loaded it keeps working on every screen.
//
// Driver: every screen the router draws (app.js sends 'bb:screen') that could be a chat
// card is sent to the server, 300 ms after the last change. Other screens are not sent.
// Follower: opt-in only (FOLLOW). Each screen the driver sends goes through the router
// like a link (app.js 'bb:drive-run': linkPlan, so nothing that changes anything runs by
// itself). Esc, a command of your own or STOP ends following.
// Both keep one long-poll (GET /api/chat/wait) while driving or following, and none after.
// Zoom and drag inside a chart are not sent: only commands.
//
// Pure *Html builders and pickers are exported for node:test; createDrive takes its
// window, document and fetch so tests can run it without a browser.

import { getKey, HEADER } from './pro.js';

export const DEBOUNCE_MS = 300;
export const PAUSE_MS = 5000;
export const HOLD_MS = 20_000;
const BACKOFF_MS = 5000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const who = (by) => (by?.name ? `${by.name} ${by.seat}` : `SEAT ${by?.seat ?? '--'}`);

// One line each, on every screen while driving or following.
export function driverBarHtml(followers = 0) {
  return `<span class="dv-k">DRIVING</span><span class="dv-sep">·</span><span class="num">${Number(followers) || 0}</span> following<span class="dv-sep">·</span><button type="button" class="dv-btn" data-dv="stop">STOP</button>`;
}
export function followBarHtml(by, cmd = '') {
  const screen = cmd ? `<span class="dv-sep">·</span><span class="dv-cmd">${esc(cmd)}</span>` : '';
  return `<span class="dv-k">FOLLOWING</span> ${esc(who(by))}${screen}<span class="dv-sep">·</span><button type="button" class="dv-btn" data-dv="stop">ESC stops</button><span class="dv-sep">·</span><button type="button" class="dv-btn" data-dv="chat">CHAT</button>`;
}

// A follower's events: the newest screen for this room after seq, and whether it ended.
export function pickFollow(events, room, seq = 0) {
  let next = null;
  let ended = false;
  for (const e of events || []) {
    if (e?.room !== room) continue;
    if (e.type === 'drive-end') ended = true;
    else if (e.type === 'drive' && typeof e.cmd === 'string' && Number(e.seq) > (next ? next.seq : seq)) next = { cmd: e.cmd, seq: Number(e.seq) };
  }
  return { next, ended };
}
// A driver's events: how many follow now (or null), and whether it ended (a takeover).
export function pickDrive(events, room) {
  let followers = null;
  let ended = false;
  for (const e of events || []) {
    if (e?.room !== room) continue;
    if (e.type === 'drive-count' && Number.isFinite(e.followers)) followers = e.followers;
    if (e.type === 'drive-end') ended = true;
  }
  return { followers, ended };
}
// The pause before the next long-poll (the same rule as the CHAT screen's).
export function nextPause(d, elapsed) {
  if (d?.evicted) return PAUSE_MS;
  if (!(d?.events || []).length && elapsed < HOLD_MS) return PAUSE_MS;
  return 0;
}

class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

// shareable(raw) -> { cmd } or null: the CHAT card rule (screens/chat.js attachFor).
export function createDrive({ win = globalThis.window, doc = globalThis.document, fetchImpl = (...a) => fetch(...a), key = getKey, shareable = () => null } = {}) {
  let st = null; // { role, room, by, cmd, seq, followers, cursor, ctl, gen, last, timer }
  let gen = 0;
  const subs = new Set();
  let bar = null;

  const changed = () => { for (const fn of subs) { try { fn(); } catch { /* a view that went away */ } } };

  function api(url, { method = 'GET', body, signal } = {}) {
    const headers = { Accept: 'application/json', [HEADER]: key() || '' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return Promise.resolve()
      .then(() => fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store' }))
      .catch((err) => { if (err?.name === 'AbortError') throw err; throw new ApiError('offline', 0, 'network'); })
      .then(async (res) => {
        let d = null;
        try { d = await res.json(); } catch { /* none */ }
        if (!res.ok) throw new ApiError(d?.message || 'error', res.status, d?.error);
        return d;
      });
  }
  const sleep = (ms, signal) => new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); resolve(); }, { once: true });
  });

  // ---- the bar ----
  function paintBar() {
    if (!doc) return;
    if (!st) { bar?.remove(); bar = null; doc.body?.classList?.remove('has-drive'); return; }
    if (!bar || !bar.isConnected) {
      bar = doc.createElement('div');
      bar.id = 'drive-bar';
      bar.className = 'drive-bar';
      bar.setAttribute('role', 'status');
      bar.addEventListener('click', onBarClick);
      const after = doc.querySelector('.commandbar');
      if (after) after.after(bar); else doc.body.prepend(bar);
    }
    bar.dataset.role = st.role;
    bar.innerHTML = st.role === 'drive' ? driverBarHtml(st.followers) : followBarHtml(st.by, st.cmd);
    doc.body?.classList?.add('has-drive');
  }
  function onBarClick(e) {
    const b = e.target.closest?.('[data-dv]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.dv === 'stop') stop();
    // CHAT from the follow bar: open the chat and keep following.
    else if (b.dataset.dv === 'chat') win.dispatchEvent(new CustomEvent('bb:drive-run', { detail: 'CHAT' }));
  }

  // ---- driver: the screens ----
  function onScreen(e) {
    if (!st || st.role !== 'drive') return;
    clearTimeout(st.timer);
    const raw = String(e?.detail || '');
    const mine = st;
    st.timer = setTimeout(() => sendScreen(mine, raw), DEBOUNCE_MS);
  }
  async function sendScreen(mine, raw) {
    if (st !== mine) return;
    const card = shareable(raw);
    if (!card || card.cmd === mine.last) return;
    mine.last = card.cmd;
    try {
      const d = await api(`/api/chat/rooms/${mine.room}/drive/cmd`, { method: 'POST', body: { cmd: card.cmd }, signal: mine.ctl.signal });
      if (st !== mine) return;
      if (Number.isFinite(d?.followers) && d.followers !== mine.followers) { mine.followers = d.followers; paintBar(); changed(); }
    } catch (err) {
      if (err.name === 'AbortError' || st !== mine) return;
      if (err.code === 'not_driver' || err.status === 404 || err.status === 401 || err.status === 402) end();
      else if (err.status !== 429) mine.last = null; // try it again with the next screen
    }
  }

  // ---- follower: the keys and own commands ----
  function onKey(e) {
    if (!st || st.role !== 'follow' || e.key !== 'Escape' || e.defaultPrevented) return;
    // A link waiting for Enter or Esc keeps its Esc.
    if (doc?.querySelector?.('.link-confirm[role="alertdialog"]')) return;
    e.preventDefault();
    stop();
  }
  function onOwn() { if (st?.role === 'follow') stop(); }
  function runScreen(mine, cmd) {
    // The card rule here too: only a plain screen, never anything that changes something.
    const card = shareable(cmd);
    if (!card) return;
    mine.cmd = card.cmd;
    paintBar();
    win.dispatchEvent(new CustomEvent('bb:drive-run', { detail: card.cmd }));
  }

  // ---- the long-poll, only while driving or following ----
  async function loop(mine) {
    let backoff = BACKOFF_MS;
    while (st === mine) {
      try {
        const t0 = Date.now();
        const d = await api(`/api/chat/wait?after=${mine.cursor}`, { signal: mine.ctl.signal });
        if (st !== mine) return;
        backoff = BACKOFF_MS;
        if (Number.isFinite(d?.last) && d.last > mine.cursor) mine.cursor = d.last;
        if (mine.role === 'follow') {
          const f = pickFollow(d?.events, mine.room, mine.seq);
          if (f.ended) { end(); return; }
          if (f.next) { mine.seq = f.next.seq; runScreen(mine, f.next.cmd); }
        } else {
          const p = pickDrive(d?.events, mine.room);
          if (p.ended) { end(); return; }
          if (p.followers !== null && p.followers !== mine.followers) { mine.followers = p.followers; paintBar(); changed(); }
        }
        const pause = nextPause(d, Date.now() - t0);
        if (pause) await sleep(pause, mine.ctl.signal);
      } catch (err) {
        if (st !== mine || err.name === 'AbortError') return;
        if (err.status === 401 || err.status === 402) { end(); return; }
        await sleep(backoff, mine.ctl.signal);
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  function begin(next) {
    end();
    gen += 1;
    st = { ...next, gen, ctl: new AbortController(), last: null, timer: 0 };
    if (st.role === 'drive') win.addEventListener('bb:screen', onScreen);
    else {
      win.addEventListener('keydown', onKey, true);
      win.addEventListener('bb:own', onOwn);
    }
    paintBar();
    changed();
    loop(st);
    return st;
  }
  // Local end: no request (the server ended it, or it was told already).
  function end() {
    if (!st) return;
    const old = st;
    st = null;
    clearTimeout(old.timer);
    old.ctl.abort();
    win.removeEventListener('bb:screen', onScreen);
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('bb:own', onOwn);
    paintBar();
    changed();
  }
  // STOP: ends it here and tells the server (STOP for a driver, UNFOLLOW for a follower).
  function stop() {
    const old = st;
    if (!old) return Promise.resolve();
    end();
    return api(`/api/chat/rooms/${old.room}/drive`, { method: 'POST', body: { action: old.role === 'drive' ? 'stop' : 'unfollow' } }).catch(() => {});
  }

  return {
    state: () => (st ? { role: st.role, room: st.room, by: st.by, cmd: st.cmd, followers: st.followers } : null),
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    // DRIVE in a room: { by } comes back from the server.
    async start(room) {
      const d = await api(`/api/chat/rooms/${room}/drive`, { method: 'POST', body: { action: 'start' } });
      begin({ role: 'drive', room, by: d.drive?.by || null, cmd: null, seq: 0, followers: d.drive?.followers || 0, cursor: Number(d.cursor) || 0 });
    },
    // FOLLOW: opt-in. Opens the driver's current screen, if there is one yet.
    async follow(room) {
      const d = await api(`/api/chat/rooms/${room}/drive`, { method: 'POST', body: { action: 'follow' } });
      const mine = begin({ role: 'follow', room, by: d.drive.by, cmd: null, seq: Number(d.drive.seq) || 0, followers: 0, cursor: Number(d.cursor) || 0 });
      if (d.drive.cmd) runScreen(mine, d.drive.cmd);
    },
    stop,
    end,
  };
}

// The one for this page, made on first use.
let one = null;
export function drive(opts) {
  one ||= createDrive(opts);
  return one;
}
