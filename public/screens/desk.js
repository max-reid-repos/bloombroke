// DESK: your own screen. Four desks, each a 12-column grid of panels. Every panel runs
// any command in a same-origin frame of the app in embed mode (so every screen works
// as it is), with its own command input, link group, as-of time, FULL and close.
// + PANEL (in the bar, and the tile after the last panel) adds one; so does +CANAL or
// +PANEL AAPL 1D typed on DESK. A WEIRD gauge added on its own is a card: its WEIRD
// tile, not a frame (desk-cards.js). The presets in the bar (and DESK WEIRD, MACRO,
// CRYPTO) load a whole desk, asking first when the desk holds panels of your own.
// Drag a header to move a panel; EDIT shows the corner to resize it. Keys: Alt+Arrows
// move the focused panel, Alt+Shift+Arrows resize it, Ctrl+[ and Ctrl+] cycle focus.
// The layout maths and the saved state live in ../desk-layout.js.

import { esc, q, panel, nyTime } from './markets.js';
import { goal } from '../goal.js'; // GOALS
import * as L from '../desk-layout.js';
import { emptyState, cardRows, raw, proLine } from '../kit.js';
import { isPro, getKey, getStatus, refreshStatus } from '../pro.js'; // the quiet PRO line, for a visitor only
import { cardGauge, cardHtml, cardBody, weirdPickItems, mergeCardRows, nextCardFetch, confirmKey, CARD_RETRY_MS } from './desk-cards.js';

const MOBILE = '(max-width: 699px)';
const ROWS_FIT = 16; // desk 1 is 16 rows tall: it fills the window
const GAP = 1;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };


// An empty desk: the model for the kit's empty state. The title, one hint, and the
// buttons that fill it (+ PANEL and the presets); what a panel can show in + Details.
export function deskEmptyHtml(n) {
  return emptyState({
    title: `Desk ${n} is empty.`,
    hint: 'Add a panel with any command, or load a preset.',
    action: raw(`<button type="button" class="desk-btn" data-act="add">+ PANEL</button> ${L.PRESET_NAMES.map((k) => `<button type="button" class="desk-btn" data-act="preset" data-preset="${k}">${k}</button>`).join('')}`),
    details: raw(cardRows([['Any command', 'A chart, NEWS, WATCH, HEATMAP, FX 500 USD THB.']])),
    cls: 'desk-empty', hidden: true,
  });
}

// A quiet line in the bar for a visitor, once per browser: DESK is saved here only, and
// Pro keeps it on every device. Shown the first time, never again (a flag in this
// browser's storage); nothing when that storage cannot be used (the desk is not saved
// there either), and never for Pro.
export const DESK_PRO_LINE = 'Saved in this browser only. Everywhere: PRO';
export const DESK_PRO_FLAG = 'bb.desk.proline';
export function deskProLineHtml(pro = false, storage = globalThis.localStorage) {
  if (pro) return '';
  try {
    if (!storage || storage.getItem(DESK_PRO_FLAG)) return '';
    storage.setItem(DESK_PRO_FLAG, '1');
  } catch { return ''; }
  return proLine(DESK_PRO_LINE);
}
// Only once Pro is known, so a Pro key on a fresh device never sees the line or uses up
// the once: no key is a visitor; a key waits for its status (none: no line, flag kept).
// alive(): the bar is still on the page (the flag is not used up for a page that left).
export async function deskProLineFor({ key = getKey, status = getStatus, refresh = refreshStatus, pro = isPro, alive = () => true, storage } = {}) {
  if (key() && !status()) {
    try { await refresh(); } catch { return ''; }
    if (!status()) return '';
  }
  if (!alive()) return '';
  return deskProLineHtml(pro(), storage);
}

export function render(el, cmd, ctx) {
  if (ctx.embed) {
    el.innerHTML = panel('1', 'Desk', `
      <p class="notice">DESK opens in the full window, not inside a panel.</p>
      <p class="muted">Type another command for this panel.</p>`, { cls: 'panel-solo' });
    ctx.status('DESK OPENS IN THE FULL WINDOW');
    return undefined;
  }
  if (cmd.error) {
    el.innerHTML = panel('1', 'Desk', `
      <p class="notice">DESK takes a desk number, RESET or a preset.</p>
      <p class="muted examples">Try ${['DESK', 'DESK 2', 'DESK RESET', 'DESK WEIRD'].map((c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}" data-example>${esc(c)}</a>`).join(' ')}</p>`, { cls: 'panel-solo' });
    ctx.status('DESK: CHECK THE WORDS AFTER IT', 'warn');
    return undefined;
  }

  const { state, writable } = L.loadDesks(ctx.store);
  goal('desk_opened');
  const n = cmd.args.n || state.active;
  if (cmd.args.reset) state.desks[n - 1] = { panels: n === 1 ? L.defaultDesks().desks[0].panels : [] };
  state.active = n;
  const save = () => L.saveDesks(ctx.store, state, writable);
  save();
  let panels = state.desks[n - 1].panels;
  let editing = false;
  let focusedId = null;
  let rowH = 40;
  const mq = window.matchMedia(MOBILE);
  const frames = new Map(); // id -> { node, iframe, loaded, visible, asof }

  el.innerHTML = `<div class="desk" data-editing="false">
    <div class="desk-bar">
      <span class="desk-label">DESK</span>
      <nav class="tabs desk-tabs" aria-label="Desks">${[1, 2, 3, 4].map((k) => `<a class="tab${k === n ? ' is-active' : ''}" href="${esc(q(`DESK ${k}`))}" data-cmd="DESK ${k}"${k === n ? ' aria-current="page"' : ''}>${k}</a>`).join('')}</nav>
      <span class="desk-focus" aria-live="polite"></span>
      <span class="desk-pro" hidden></span>
      <span class="desk-hint">Drag a header to move, the corner to resize. Alt+Arrows move, Alt+Shift+Arrows resize, Ctrl+[ ] focus.</span>
      <span class="desk-presets" role="group" aria-label="Preset desks">${L.PRESET_NAMES.map((k) => `<button type="button" class="desk-btn desk-preset" data-act="preset" data-preset="${k}">${k}</button>`).join('')}</span>
      <button type="button" class="desk-btn desk-add" data-act="add">+ PANEL</button>
      <button type="button" class="desk-btn desk-edit" data-act="edit" aria-pressed="false">EDIT</button>
    </div>
    <div class="desk-picker" hidden>
      <form class="desk-pick-form" autocomplete="off">
        <span class="prompt" aria-hidden="true">+</span>
        <input class="desk-pick-input" name="c" type="text" maxlength="256" spellcheck="false" autocapitalize="characters" autocorrect="off" aria-label="Command for the new panel" placeholder="Command for the new panel: AAPL 1D, NEWS, HEATMAP">
        <button type="submit" class="desk-btn">ADD</button>
        <button type="button" class="desk-btn" data-act="pick-close">CANCEL</button>
      </form>
      <ul class="desk-pick-list" role="listbox" aria-label="Commands"></ul>
    </div>
    <div class="desk-confirm" role="alertdialog" aria-label="Load a preset" tabindex="-1" hidden>
      <span class="desk-confirm-text"></span>
      <button type="button" class="desk-btn" data-act="confirm-yes">ENTER: REPLACE</button>
      <button type="button" class="desk-btn" data-act="confirm-no">ESC: KEEP</button>
    </div>
    <div class="desk-grid" role="list"><button type="button" class="dp-add" data-act="add">+ PANEL</button></div>
    ${deskEmptyHtml(n)}
  </div>`;
  const desk = el.querySelector('.desk');
  const grid = el.querySelector('.desk-grid');
  const focusEl = el.querySelector('.desk-focus');
  const proEl = el.querySelector('.desk-pro');
  deskProLineFor({ alive: () => proEl.isConnected }).then((html) => {
    if (html && proEl.isConnected) { proEl.innerHTML = html; proEl.hidden = false; }
  }).catch(() => {});
  const picker = el.querySelector('.desk-picker');
  const pickInput = el.querySelector('.desk-pick-input');
  const pickList = el.querySelector('.desk-pick-list');
  const empty = el.querySelector('.desk-empty');
  const addTile = el.querySelector('.dp-add');
  const confirmEl = el.querySelector('.desk-confirm');

  const find = (id) => panels.find((p) => p.id === id);
  const order = () => L.stackOrder(panels);
  const numberOf = (id) => order().findIndex((p) => p.id === id) + 1;
  const nameOf = (id) => `${numberOf(id)}) ${find(id)?.cmd || ''}`;
  const post = (f, msg) => { if (f?.loaded && f.iframe) f.iframe.contentWindow?.postMessage(msg, location.origin); };

  // --- panels in the DOM. A panel's node is never moved or re-created while it lives:
  // moving an iframe in the DOM reloads it. Position is CSS grid placement only.
  function makeNode(p) {
    const g = p.card ? cardGauge(p.cmd) : null;
    const node = document.createElement('section');
    node.className = g ? 'dp is-card' : 'dp';
    node.dataset.id = p.id;
    node.setAttribute('role', 'listitem');
    node.innerHTML = `<header class="dp-head">
        <button type="button" class="dp-link" data-act="link"><span class="offscreen">Link group</span></button>
        <span class="dp-title"></span>
        <form class="dp-form" autocomplete="off"><input class="dp-cmd" name="c" type="text" maxlength="256" spellcheck="false" autocapitalize="characters" autocorrect="off" placeholder="COMMAND" aria-label="Command for this panel"></form>
        <span class="dp-asof num"></span>
        <button type="button" class="dp-btn dp-move" data-act="up" aria-label="Move up">↑</button>
        <button type="button" class="dp-btn dp-move" data-act="down" aria-label="Move down">↓</button>
        <a class="dp-btn dp-full" title="Open full screen">FULL</a>
        <button type="button" class="dp-btn dp-close" data-act="close" aria-label="Close panel">×</button>
      </header>
      <div class="dp-body">${g ? cardHtml(g, null) : '<iframe loading="lazy" referrerpolicy="same-origin"></iframe>'}</div>
      <span class="dp-resize" data-act="resize" aria-hidden="true"></span>`;
    const iframe = g ? null : node.querySelector('iframe');
    const f = { node, iframe, card: g, cmd: p.cmd, html: '', loaded: false, visible: true };
    if (iframe) {
      iframe.addEventListener('load', () => {
        f.loaded = true;
        post(f, { type: 'bb:visible', on: f.visible });
        post(f, { type: 'bb:link', on: Boolean(find(p.id)?.link) });
      });
      iframe.src = L.embedSrc(p.cmd);
    }
    frames.set(p.id, f);
    grid.appendChild(node);
    io?.observe(node);
    return f;
  }

  function dropNode(id, f) {
    io?.unobserve(f.node);
    f.node.remove();
    frames.delete(id);
  }

  // A frame pointed at another command: load it (the load event sends visible and link).
  function reloadFrame(p, f) {
    f.cmd = p.cmd;
    f.loaded = false;
    f.iframe.src = L.embedSrc(p.cmd);
    f.node.querySelector('.dp-asof').textContent = '';
  }

  function paintPanel(p) {
    const f = frames.get(p.id);
    const { node, iframe } = f;
    node.querySelector('.dp-title').textContent = nameOf(p.id);
    const full = node.querySelector('.dp-full');
    full.href = q(p.cmd);
    full.dataset.cmd = p.cmd;
    const link = node.querySelector('.dp-link');
    link.dataset.link = p.link || 'none';
    link.title = p.link ? `Linked (${p.link}): a ticker picked here goes to the other ${p.link} panels. Click to change.` : 'Not linked. Click to link this panel with others.';
    if (iframe) iframe.title = p.cmd;
    node.classList.toggle('is-focused', p.id === focusedId);
    node.style.gridColumn = `${p.x + 1} / span ${p.w}`;
    node.style.gridRow = `${p.y + 1} / span ${p.h}`;
    node.style.order = String(numberOf(p.id));
    node.style.setProperty('--h', String(p.h));
  }

  function layout() {
    L.syncFrames(frames, panels, { cardOf: (p) => (p.card ? cardGauge(p.cmd) : null), make: makeNode, drop: dropNode, reload: reloadFrame });
    panels.forEach(paintPanel);
    syncCards();
    empty.hidden = panels.length > 0;
    grid.hidden = panels.length === 0;
    // The add tile: a row under the lowest panel, the whole width.
    const bottom = panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);
    addTile.hidden = panels.length >= L.MAX_PANELS;
    addTile.style.gridRow = `${bottom + 1} / span 2`;
    focusLine();
  }

  function setPanels(next, { persist = true } = {}) {
    panels = next;
    state.desks[n - 1].panels = next;
    layout();
    if (persist) save();
  }

  function fitRows() {
    desk.classList.toggle('is-mobile', mq.matches);
    const top = grid.getBoundingClientRect().top + window.scrollY;
    const dock = document.querySelector('.dock')?.offsetHeight || 0;
    const avail = window.innerHeight - top - dock - 12;
    rowH = Math.max(24, Math.min(72, Math.floor((avail - (ROWS_FIT - 1) * GAP) / ROWS_FIT)));
    grid.style.setProperty('--desk-row', `${rowH}px`);
  }

  // --- focus: the command bar sends to the focused panel ------------------------------
  function focusLine() {
    focusEl.textContent = focusedId && find(focusedId) ? `COMMANDS GO TO ${nameOf(focusedId)} · ESC TO STOP` : '';
  }
  function setFocus(id) {
    focusedId = id && find(id) ? id : null;
    for (const [k, f] of frames) f.node.classList.toggle('is-focused', k === focusedId);
    focusLine();
  }
  function cycle(dir) {
    const list = order();
    if (!list.length) return;
    const i = list.findIndex((p) => p.id === focusedId);
    const j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    setFocus(list[j].id);
    frames.get(list[j].id)?.node.scrollIntoView({ block: 'nearest' });
  }

  // --- running commands in panels, and linked panels ----------------------------------
  const stored = (c) => {
    const p = ctx.parseCommand(c);
    return p.mutates ? p.view : p.input;
  };

  function sendTo(id, c, { link = true } = {}) {
    const f = frames.get(id);
    if (!f) return;
    const s = stored(c);
    // A card stays a card for another gauge; any other command makes it a framed screen.
    const card = Boolean(find(id)?.card && cardGauge(s));
    if (f.iframe && f.loaded) post(f, { type: 'bb:run', c });
    else if (f.iframe) f.iframe.src = L.embedSrc(c);
    if (f.iframe) f.cmd = s; // the frame shows it now: no reload
    setPanels(panels.map((p) => (p.id === id ? { ...p, cmd: s, card } : p)));
    if (link) linkTicker(id, s);
  }

  // A ticker shown in a linked panel goes to every panel of its group that shows one ticker.
  function linkTicker(fromId, c) {
    const from = find(fromId);
    const ticker = from?.link ? L.tickerOf(c, ctx.parseCommand) : null;
    if (!ticker) return 0;
    let sent = 0;
    for (const p of panels) {
      if (p.id === fromId || p.link !== from.link) continue;
      const next = L.retarget(p.cmd, ticker, ctx.parseCommand);
      if (next) { sendTo(p.id, next, { link: false }); sent += 1; }
    }
    return sent;
  }

  ctx.setCommandHook((c) => {
    if (plusAdd(c)) return true;
    if (!focusedId || /^DESK\b/.test(c)) return false;
    const name = numberOf(focusedId);
    sendTo(focusedId, c);
    ctx.status(`SENT TO PANEL ${name}: ${c}`);
    return true;
  });

  // --- messages from the panels (same origin only, and only from our own frames) -------
  function onMessage(e) {
    if (e.origin !== location.origin) return;
    let id = null;
    for (const [k, f] of frames) if (f.iframe && f.iframe.contentWindow === e.source) id = k;
    if (!id) return;
    const m = e.data || {};
    const f = frames.get(id);
    if (m.type === 'bb:cmd' && typeof m.c === 'string') {
      const s = stored(m.c);
      f.cmd = s; // moved inside the frame: it already shows this
      if (s !== find(id)?.cmd) {
        setPanels(panels.map((p) => (p.id === id ? { ...p, cmd: s } : p)));
        linkTicker(id, s);
      }
      f.node.querySelector('.dp-asof').textContent = '';
    } else if (m.type === 'bb:pick' && typeof m.c === 'string') {
      setFocus(id);
      if (!linkTicker(id, stored(m.c))) sendTo(id, m.c, { link: false });
    } else if (m.type === 'bb:focus') {
      setFocus(id);
    } else if (m.type === 'bb:updated') {
      const t = /T/.test(m.iso || '') ? nyTime(m.iso, true) : '';
      f.node.querySelector('.dp-asof').textContent = t && t !== '--:--' ? `${t} ET` : '';
      f.node.querySelector('.dp-asof').classList.toggle('is-stale', Boolean(m.stale));
    } else if (m.type === 'bb:type' && typeof m.key === 'string' && m.key.length === 1) {
      setFocus(id);
      ctx.typeCommand(m.key);
    } else if (m.type === 'bb:key' && typeof m.key === 'string') {
      setFocus(id);
      const fk = ctx.fkeys.find((k) => k.key === m.key);
      if (fk && !m.alt && !m.ctrl && !m.shift) ctx.run(fk.cmd);
      else deskKey(m);
    }
  }
  window.addEventListener('message', onMessage);

  // --- keys ---------------------------------------------------------------------------
  function deskKey({ key, alt, shift, ctrl }) {
    if (ctrl && (key === '[' || key === ']')) { cycle(key === ']' ? 1 : -1); return true; }
    if (alt && ARROWS[key] && focusedId) {
      const [dx, dy] = ARROWS[key];
      if (mq.matches) { if (dy) setPanels(L.swapInStack(panels, focusedId, dy)); }
      else setPanels(shift ? L.grow(panels, focusedId, dx, dy) : L.nudge(panels, focusedId, dx, dy));
      frames.get(focusedId)?.node.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (key === 'Escape' && focusedId && picker.hidden) { setFocus(null); return true; }
    return false;
  }
  function onKey(e) {
    const t = e.target;
    const typed = t.matches?.('input, textarea, select') && t.value;
    // A preset waiting to replace this desk: Enter on the page, the empty command bar or
    // the confirm line replaces; Enter on a button, link or card does what it does. Esc keeps.
    const where = t === document.body || t === document.documentElement ? 'page'
      : t === confirmEl ? 'confirm'
        : t.id === 'cmd' ? (t.value ? 'typing' : 'command') : 'control';
    const act = pendingPreset && !e.altKey && !e.ctrlKey && !e.metaKey ? confirmKey(e.key, where) : null;
    if (act) {
      e.preventDefault();
      e.stopPropagation();
      if (act === 'replace') loadPreset(pendingPreset);
      else { closeConfirm(); ctx.status(`DESK ${n} KEPT`); }
      return;
    }
    // Enter on a card opens its gauge.
    if (e.key === 'Enter' && t.matches?.('.dp-card') && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      ctx.run(t.dataset.card);
      return;
    }
    if (typed && (e.altKey || e.key === 'Escape')) return; // Alt+Arrows move by word in text
    if (!e.ctrlKey && !e.altKey && e.key !== 'Escape') return;
    if (deskKey({ key: e.key, alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey })) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  document.addEventListener('keydown', onKey, true);

  // --- mouse: EDIT drag to move and resize ---------------------------------------------
  function startDrag(e, id, mode) {
    const p = find(id);
    const f = frames.get(id);
    if (!p || !f) return;
    e.preventDefault();
    const base = panels;
    const colW = (grid.getBoundingClientRect().width + GAP) / L.COLS;
    const rowStep = rowH + GAP;
    const sx = e.clientX;
    const sy = e.clientY;
    let last = '0,0';
    desk.classList.add('is-dragging');
    f.node.classList.add('is-moving');
    setFocus(id);
    // Moving: the panel follows the pointer; a ghost shows the cell it will land in.
    const ghost = mode === 'move' ? grid.appendChild(Object.assign(document.createElement('div'), { className: 'dp-ghost' })) : null;
    const place = () => {
      if (!ghost) return;
      const q2 = find(id);
      ghost.style.gridColumn = `${q2.x + 1} / span ${q2.w}`;
      ghost.style.gridRow = `${q2.y + 1} / span ${q2.h}`;
    };
    const follow = (ev) => {
      if (!ghost) return;
      const q2 = find(id);
      const ox = (q2.x - p.x) * colW;
      const oy = (q2.y - p.y) * rowStep;
      f.node.style.transform = `translate(${ev.clientX - sx - ox}px, ${ev.clientY - sy - oy}px)`;
    };
    place();
    const move = (ev) => {
      const dx = Math.round((ev.clientX - sx) / colW);
      const dy = Math.round((ev.clientY - sy) / rowStep);
      if (`${dx},${dy}` !== last) {
        last = `${dx},${dy}`;
        const next = mode === 'move'
          ? L.dragPreview(base, id, { x: p.x + dx, y: p.y + dy })
          : L.settle(base.map((o) => (o.id === id ? L.clampPanel({ ...o, w: Math.min(L.COLS - o.x, p.w + dx), h: p.h + dy }) : o)), id);
        setPanels(next, { persist: false });
        place();
      }
      follow(ev);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      desk.classList.remove('is-dragging');
      f.node.classList.remove('is-moving');
      f.node.style.transform = '';
      ghost?.remove();
      setPanels(L.settle(panels));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // The whole header moves the panel, except its buttons. A press on the command input
  // waits: moving 5px starts a drag, letting go without moving puts the caret in it.
  function armDrag(e, id, input) {
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
      stop();
      startDrag(e, id, 'move');
    };
    const up = (ev) => {
      stop();
      if (input && ev.type === 'pointerup') {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  // Mouse: dragging works any time. Touch: only in EDIT, so a swipe still scrolls.
  const canDrag = (e) => !mq.matches && e.button === 0 && (editing || e.pointerType === 'mouse' || e.pointerType === 'pen');
  const idleInput = (t) => (t.matches?.('.dp-cmd') && document.activeElement !== t ? t : null);

  grid.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.dp');
    if (!node) return;
    setFocus(node.dataset.id);
    if (!canDrag(e)) return;
    if (e.target.closest('.dp-resize')) { if (editing) startDrag(e, node.dataset.id, 'resize'); return; }
    if (!e.target.closest('.dp-head') || e.target.closest('button, a')) return;
    const input = e.target.closest('.dp-cmd');
    if (input && !idleInput(input)) return; // already typing: select text as usual
    armDrag(e, node.dataset.id, input);
  });
  // A press on an idle command input does not focus it yet (armDrag does, on release).
  grid.addEventListener('mousedown', (e) => {
    if (!mq.matches && e.button === 0 && idleInput(e.target)) e.preventDefault();
  });

  grid.addEventListener('click', (e) => {
    // A card opens its gauge's own screen (a credit link in it opens its site).
    const cardEl = e.target.closest('.dp-card');
    if (cardEl) {
      if (!e.target.closest('a[href]')) ctx.run(cardEl.dataset.card);
      return;
    }
    const b = e.target.closest('[data-act]');
    const node = e.target.closest('.dp');
    if (!b || !node) return;
    const id = node.dataset.id;
    const act = b.dataset.act;
    if (act === 'close') {
      if (focusedId === id) setFocus(null);
      setPanels(L.removePanel(panels, id));
      ctx.status(`PANEL CLOSED. DESK ${n} HAS ${panels.length} ${panels.length === 1 ? 'PANEL' : 'PANELS'}`);
    } else if (act === 'link') {
      const p = find(id);
      const next = L.cycleLink(p.link);
      setPanels(panels.map((o) => (o.id === id ? { ...o, link: next } : o)));
      post(frames.get(id), { type: 'bb:link', on: Boolean(next) });
      ctx.status(next ? `PANEL ${numberOf(id)} LINKED (${next.toUpperCase()})` : `PANEL ${numberOf(id)} NOT LINKED`);
    } else if (act === 'up' || act === 'down') {
      setPanels(L.swapInStack(panels, id, act === 'up' ? -1 : 1));
    }
  });

  grid.addEventListener('submit', (e) => {
    const form = e.target.closest('.dp-form');
    if (!form) return;
    e.preventDefault();
    const id = form.closest('.dp').dataset.id;
    const inp = form.querySelector('input');
    const c = inp.value.trim();
    if (!c) return;
    inp.value = '';
    if (/^DESK\b/i.test(c)) { ctx.run(c); return; }
    if (plusAdd(c)) return;
    setFocus(id);
    sendTo(id, c);
  });

  // --- the bar: EDIT, + PANEL and its command picker ------------------------------------
  function setEditing(on) {
    editing = on;
    desk.dataset.editing = String(on);
    const b = el.querySelector('.desk-edit');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'DONE' : 'EDIT';
    if (!on) closePicker();
  }

  // Two groups: commands (framed screens), then every WEIRD gauge (cards).
  function pickItems() {
    const seen = new Set();
    const weird = weirdPickItems(pickInput.value);
    const inWeird = new Set(weird.map((s) => s.value));
    const cmds = ctx.suggest(pickInput.value)
      .filter((s) => !s.usage && !/^DESK\b/.test(s.value) && !inWeird.has(s.value) && !seen.has(s.value) && seen.add(s.value))
      .slice(0, 14);
    return { cmds, weird };
  }
  function renderPicker() {
    const { cmds, weird } = pickItems();
    const li = (s) => `<li role="option" data-value="${esc(s.value)}"><span class="sug-name">${esc(s.name)}</span><span class="sug-hint">${esc(s.hint)}</span></li>`;
    const head = (t) => `<li class="desk-pick-group" role="presentation">${esc(t)}</li>`;
    pickList.innerHTML = (cmds.length && weird.length ? head('Commands') : '') + cmds.map(li).join('')
      + (weird.length ? head('Weird data') + weird.map(li).join('') : '');
  }
  function openPicker() {
    picker.hidden = false;
    pickInput.value = '';
    renderPicker();
    picker.scrollIntoView({ block: 'nearest' });
    pickInput.focus({ preventScroll: true });
  }
  function closePicker() {
    picker.hidden = true;
  }
  function add(c) {
    const p = ctx.parseCommand(c);
    if (p.name === 'DESK') { ctx.status('A PANEL CANNOT HOLD A DESK', 'warn'); return; }
    if (p.name === 'UNKNOWN') { ctx.status('UNKNOWN COMMAND. TYPE HELP IN A PANEL TO SEE THEM ALL', 'warn'); return; }
    if (panels.length >= L.MAX_PANELS) { ctx.status(`A DESK HOLDS ${L.MAX_PANELS} PANELS`, 'warn'); return; }
    // A WEIRD gauge on its own is a card, 3 x 4 cells.
    const card = Boolean(cardGauge(stored(c)));
    const size = card ? { w: 3, h: 4, card } : L.newPanelSize(stored(c), ctx.parseCommand);
    const next = L.addPanel(panels, stored(c), size);
    const added = next.find((o) => !find(o.id));
    setPanels(next);
    closePicker();
    if (added) {
      setFocus(added.id);
      frames.get(added.id)?.node.scrollIntoView({ block: 'nearest' });
    }
    ctx.status(`PANEL ADDED: ${stored(c)}`);
  }

  // Typed on DESK: +CANAL, +PANEL AAPL 1D add a panel; + or +PANEL opens the picker.
  function plusAdd(c) {
    const plus = L.parseAdd(c);
    if (!plus) return false;
    if (plus.cmd) add(plus.cmd);
    else openPicker();
    return true;
  }

  // --- presets: load one into this desk, asking first over panels of your own ----------
  let pendingPreset = null;
  let focusBack = null; // where focus was before the confirm line took it
  function closeConfirm() {
    const had = confirmEl.contains(document.activeElement);
    pendingPreset = null;
    confirmEl.hidden = true;
    if (had && focusBack?.isConnected) focusBack.focus({ preventScroll: true });
    focusBack = null;
  }
  function loadPreset(name) {
    closeConfirm();
    closePicker();
    setFocus(null);
    // New screens in new nodes: nothing of the old desk keeps running under a new title.
    for (const [id, f] of [...frames]) dropNode(id, f);
    setPanels(L.presetPanels(name));
    for (const p of panels) post(frames.get(p.id), { type: 'bb:link', on: Boolean(p.link) });
    ctx.status(`DESK ${n}: ${name}`);
  }
  function askPreset(name) {
    if (!L.hasUserPanels(panels)) { loadPreset(name); return; }
    pendingPreset = name;
    const k = panels.length;
    confirmEl.querySelector('.desk-confirm-text').textContent = `Replace the ${k} ${k === 1 ? 'panel' : 'panels'} on desk ${n} with ${name}?`;
    confirmEl.hidden = false;
    // The line takes focus (a clicked preset button would take Enter otherwise); the
    // command bar gets it back after.
    const cmdBar = document.getElementById('cmd');
    if (!confirmEl.contains(document.activeElement)) focusBack = document.activeElement === cmdBar ? cmdBar : null;
    confirmEl.focus({ preventScroll: true });
    ctx.status('');
  }

  // --- cards: one /api/weird fetch for every card on this desk ---------------------------
  let cardRows = new Map();
  let cardFetchedAt = 0;
  let cardServerAt = NaN; // the last summary's updated time, server clock
  let cardNext = 0;
  let cardBusy = false;
  let cardError = false;
  const cardIds = () => [...new Set(panels.map((p) => (p.card ? cardGauge(p.cmd)?.id : null)).filter(Boolean))];
  function fillCard(f) {
    const d = cardRows.get(f.card.id) || (cardError ? { ok: false } : null);
    const html = cardBody(f.card, d);
    if (html === f.html) return; // the same reading: nothing is redrawn
    f.html = html;
    const body = f.node.querySelector('.dp-card .panel-body');
    body.innerHTML = html;
    // A big card stretches its sparkline to the width (CSS), so it may lose its shape.
    body.querySelectorAll('svg.spark').forEach((s) => s.setAttribute('preserveAspectRatio', 'none'));
  }
  function planCards() {
    cardNext = cardError ? cardFetchedAt + CARD_RETRY_MS : nextCardFetch(cardRows, cardIds(), cardFetchedAt, cardServerAt) || 0;
  }
  async function loadCards() {
    if (cardBusy) return;
    cardBusy = true;
    cardFetchedAt = Date.now();
    try {
      const d = await ctx.fetchJSON('/api/weird', { signal: ctx.signal });
      cardRows = mergeCardRows(cardRows, d?.gauges);
      cardServerAt = Date.parse(d?.updated || '');
      cardError = false;
    } catch (err) {
      if (err.name === 'AbortError') return;
      cardError = !cardRows.size;
    } finally {
      cardBusy = false;
    }
    planCards();
    for (const f of frames.values()) if (f.card) fillCard(f);
  }
  function syncCards() {
    if (!cardIds().length) return;
    for (const f of frames.values()) if (f.card) fillCard(f);
    if (!cardFetchedAt) loadCards();
    else if (!cardBusy) planCards();
  }
  function tickCards() {
    if (!document.hidden && cardNext && Date.now() >= cardNext && cardIds().length) loadCards();
  }
  const cardTimer = setInterval(tickCards, 15_000);
  document.addEventListener('visibilitychange', tickCards);

  desk.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.closest('.dp')) {
      // A click on the bare desk lets go of the focused panel.
      if (!e.target.closest('.dp, .desk-bar, .desk-picker, .desk-confirm')) setFocus(null);
      return;
    }
    if (b.dataset.act === 'preset') askPreset(b.dataset.preset);
    else if (b.dataset.act === 'confirm-yes') { if (pendingPreset) loadPreset(pendingPreset); }
    else if (b.dataset.act === 'confirm-no') { closeConfirm(); ctx.status(`DESK ${n} KEPT`); }
    else if (b.dataset.act === 'edit') setEditing(!editing);
    else if (b.dataset.act === 'add') { if (picker.hidden) openPicker(); else closePicker(); }
    else if (b.dataset.act === 'pick-close') closePicker();
  });
  pickInput.addEventListener('input', renderPicker);
  pickInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closePicker(); } });
  el.querySelector('.desk-pick-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = L.parseAdd(pickInput.value)?.cmd ?? pickInput.value.trim();
    if (c) add(c);
  });
  pickList.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-value]');
    if (!li) return;
    e.preventDefault();
    const v = li.dataset.value;
    if (v.endsWith(' ')) { pickInput.value = v; pickInput.focus(); renderPicker(); return; }
    add(v);
  });

  // --- panels off screen or in a hidden tab stop refreshing -----------------------------
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const en of entries) {
        const f = frames.get(en.target.dataset.id);
        if (!f) continue;
        f.visible = en.isIntersecting;
        post(f, { type: 'bb:visible', on: f.visible });
      }
    })
    : null;

  const onResize = () => fitRows();
  window.addEventListener('resize', onResize);
  mq.addEventListener?.('change', onResize);
  fitRows();
  layout();
  ctx.status(panels.length ? '' : `DESK ${n} IS EMPTY`);
  if (cmd.args.preset) askPreset(cmd.args.preset);

  return () => {
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    mq.removeEventListener?.('change', onResize);
    io?.disconnect();
    clearInterval(cardTimer);
    document.removeEventListener('visibilitychange', tickCards);
  };
}
