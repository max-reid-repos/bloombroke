// Bloombroke front end: command bar, router and URL state.
// Pure helpers are exported so node:test can import this file; the DOM wiring
// only runs in a browser.

import * as helpScreen from './screens/help.js';
import * as marketsScreen from './screens/markets.js';
import * as fxScreen from './screens/fx.js';
import { fmtNum, fmtPct, dirOf } from './screens/markets.js';

export const COMMANDS = [
  { name: 'MARKETS', hint: 'World markets at a glance', usage: 'MARKETS', example: 'MARKETS' },
  { name: 'FX', hint: 'Convert money between currencies', usage: 'FX <amount> <from> <to>', example: 'FX 500 USD THB' },
  { name: 'HELP', hint: 'Every command, with examples', usage: 'HELP', example: 'HELP' },
];

export const SOON = [
  { name: 'AAPL', hint: 'Any ticker: price, chart and what moved it' },
  { name: 'CPI', hint: 'Inflation, in plain words' },
  { name: 'RATES', hint: 'The interest rates that touch your money' },
  { name: 'NEWS', hint: 'Headlines that move markets' },
  { name: 'BUY', hint: 'Practice trading with play money' },
  { name: 'WHATIF', hint: 'What if you had bought ten years ago' },
  { name: 'PRO', hint: 'Everything, for $4.20 a month' },
];

const SCREENS = { HELP: helpScreen, MARKETS: marketsScreen, FX: fxScreen };
const ALIASES = { '?': 'HELP', H: 'HELP', M: 'MARKETS', MARKET: 'MARKETS' };
export const DEFAULT_COMMAND = 'MARKETS';

export function tokenize(raw) {
  return String(raw ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);
}

// Parse FX arguments: [amount] <from> [TO] <to>. Amount may use commas.
export function parseFxArgs(args) {
  const toks = args.filter((t) => t !== 'TO' && t !== 'IN' && t !== '=');
  let amount = 1;
  let amountGiven = false;
  if (toks.length && /^[\d.,]+$/.test(toks[0])) {
    const n = Number(toks[0].replace(/,/g, ''));
    if (!Number.isFinite(n)) return { error: 'amount' };
    amount = n;
    amountGiven = true;
    toks.shift();
  }
  if (toks.length !== 2) return { error: 'usage' };
  const [from, to] = toks;
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return { error: 'code', from, to };
  return { amount, amountGiven, from, to };
}

// Turn raw input into { name, args?, error?, input }. Unknown commands get name 'UNKNOWN'.
export function parseCommand(raw) {
  const toks = tokenize(raw);
  if (!toks.length) return { name: DEFAULT_COMMAND, input: DEFAULT_COMMAND };
  const head = ALIASES[toks[0]] || toks[0];
  const rest = toks.slice(1);
  if (head === 'HELP' || head === 'MARKETS') return { name: head, input: head };
  if (head === 'FX') {
    const args = parseFxArgs(rest);
    return { name: 'FX', args, error: args.error, input: ['FX', ...rest].join(' ') };
  }
  return { name: 'UNKNOWN', input: toks.join(' ') };
}

// URL state: ?c=FX+500+USD+THB
export function toQuery(input) {
  const c = tokenize(input).join(' ');
  return '?' + new URLSearchParams({ c }).toString();
}

export function fromQuery(search) {
  const c = new URLSearchParams(search || '').get('c');
  const cleaned = tokenize(c).join(' ');
  return cleaned || DEFAULT_COMMAND;
}

// Suggestions for the dropdown: [{ name, hint, value }].
export function suggest(raw) {
  const text = String(raw ?? '').replace(/^\s+/, '').toUpperCase();
  const toks = tokenize(text);
  if (!toks.length) return COMMANDS.map((c) => ({ name: c.name, hint: c.hint, value: c.example }));
  const head = toks[0];
  const typingHead = toks.length === 1 && !/\s$/.test(text);
  if (typingHead) {
    return COMMANDS
      .filter((c) => c.name.startsWith(head))
      .map((c) => ({ name: c.name, hint: c.hint, value: c.name === 'FX' ? 'FX ' : c.name }));
  }
  const cmd = COMMANDS.find((c) => c.name === head);
  if (cmd && cmd.name === 'FX') {
    const args = parseFxArgs(toks.slice(1));
    if (args.error) return [{ name: cmd.usage, hint: 'e.g. ' + cmd.example, value: cmd.example, usage: true }];
  }
  return [];
}

// Tab completion: complete to the n-th suggestion.
export function complete(raw, index = 0) {
  const list = suggest(raw);
  if (!list.length) return raw;
  return list[((index % list.length) + list.length) % list.length].value;
}

// New York market hours: 9:30 to 16:00 ET, Monday to Friday. Holidays are ignored.
export function nyParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get('weekday'), hour: Number(get('hour')) % 24, minute: Number(get('minute')), second: Number(get('second')) };
}

export function marketStatus(date = new Date()) {
  const { weekday, hour, minute } = nyParts(date);
  const mins = hour * 60 + minute;
  const weekdayOpen = !['Sat', 'Sun'].includes(weekday);
  return weekdayOpen && mins >= 9 * 60 + 30 && mins < 16 * 60 ? 'OPEN' : 'CLOSED';
}

export function nyClock(date = new Date()) {
  const { hour, minute, second } = nyParts(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(hour)}:${p(minute)}:${p(second)}`;
}

// ---------------------------------------------------------------------------
// Browser wiring
// ---------------------------------------------------------------------------

async function fetchJSON(url, { signal } = {}) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw Object.assign(new Error('You look offline. Check your connection and try again.'), { code: 'network' });
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    throw Object.assign(new Error(body?.message || 'Something went wrong. Try again in a minute.'), { code: body?.error, body });
  }
  return body;
}

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function boot() {
  const $ = (id) => document.getElementById(id);
  const form = $('cmd-form');
  const input = $('cmd');
  const cursor = $('cursor');
  const measure = $('measure');
  const list = $('suggest');
  const screen = $('screen');
  const tape = $('tape');
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  if (window.matchMedia('(max-width: 639px)').matches) input.placeholder = 'Try FX 500 USD THB';

  let cmdHistory = store.get('bb.history', []);
  let histIndex = cmdHistory.length;
  let draft = '';
  let tabIndex = -1;
  let tabBase = '';
  let active = -1;
  let cleanup = null;
  let screenAbort = null;
  let currentName = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // --- blinking block cursor that follows the caret -------------------------
  function placeCursor() {
    const ch = measure.getBoundingClientRect().width || 10;
    const pos = input.selectionStart ?? input.value.length;
    const x = pos * ch - input.scrollLeft;
    cursor.style.width = `${ch}px`;
    cursor.style.transform = `translateX(${Math.max(0, x)}px)`;
    cursor.classList.toggle('is-empty', input.value.length === 0);
    cursor.classList.remove('blink');
    void cursor.offsetWidth; // restart the blink so the cursor stays solid while typing
    cursor.classList.add('blink');
  }

  // --- suggestions ----------------------------------------------------------
  let items = [];
  function renderSuggest() {
    items = document.activeElement === input ? suggest(input.value) : [];
    const exact = items.length === 1 && !items[0].usage && items[0].value.trim() === input.value.trim().toUpperCase();
    if (!items.length || exact || !input.value.trim()) {
      closeSuggest();
      return;
    }
    list.innerHTML = items.map((s, i) => `
      <li role="option" id="sug-${i}" data-i="${i}" class="${i === active ? 'is-active' : ''}${s.usage ? ' is-usage' : ''}" aria-selected="${i === active}">
        <span class="sug-name">${escapeHtml(s.name)}</span><span class="sug-hint">${escapeHtml(s.hint)}</span>
      </li>`).join('');
    clearTimeout(closeTimer);
    list.classList.remove('is-closing');
    if (list.hidden) {
      list.hidden = false;
      void list.offsetWidth; // let the closed state paint so the open transition runs
    }
    list.classList.add('is-open');
    input.setAttribute('aria-expanded', 'true');
  }

  let closeTimer = 0;
  function closeSuggest() {
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    if (list.hidden || !list.classList.contains('is-open')) return;
    list.classList.remove('is-open');
    list.classList.add('is-closing');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { list.classList.remove('is-closing'); list.hidden = true; }, 150);
  }

  // --- running commands -----------------------------------------------------
  function setChips(name) {
    document.querySelectorAll('.chip').forEach((c) => {
      const on = tokenize(c.dataset.cmd)[0] === name;
      c.classList.toggle('is-active', on);
      if (on) c.setAttribute('aria-current', 'page'); else c.removeAttribute('aria-current');
    });
  }

  function render(raw) {
    const cmd = parseCommand(raw);
    if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
    if (screenAbort) screenAbort.abort();
    screenAbort = new AbortController();

    const view = document.createElement('section');
    view.className = 'view';
    const order = ['MARKETS', 'FX', 'HELP', 'UNKNOWN'];
    const dir = Math.sign(order.indexOf(cmd.name) - order.indexOf(currentName));
    view.style.setProperty('--view-from-x', `${dir * 8}px`);
    screen.querySelectorAll('.view.is-leaving').forEach((v) => v.remove());
    const old = screen.querySelector('.view');
    if (old && !reduceMotion.matches) {
      const r = old.getBoundingClientRect();
      const host = screen.getBoundingClientRect();
      Object.assign(old.style, { top: `${r.top - host.top}px`, left: `${r.left - host.left}px`, width: `${r.width}px` });
      old.style.setProperty('--view-to-x', `${dir * -8}px`);
      old.classList.add('is-leaving');
      old.setAttribute('aria-hidden', 'true');
      old.addEventListener('animationend', () => old.remove(), { once: true });
      setTimeout(() => old.remove(), 400);
      screen.appendChild(view);
    } else {
      screen.replaceChildren(view);
    }
    currentName = cmd.name;
    setChips(cmd.name);
    document.title = cmd.name === 'MARKETS' || cmd.name === 'UNKNOWN'
      ? 'Bloombroke: the $32,000 terminal. Now $4.20 a month.'
      : `${cmd.input} | Bloombroke`;

    const ctx = { run, fetchJSON, signal: screenAbort.signal, commands: COMMANDS, soon: SOON, escapeHtml };
    const mod = SCREENS[cmd.name];
    if (mod) {
      cleanup = mod.render(view, cmd, ctx) || null;
    } else {
      view.innerHTML = `
        <p class="eyebrow">Unknown command</p>
        <h1 class="notice">Unknown command. Type <a href="${toQuery('HELP')}" data-cmd="HELP">HELP</a>.</h1>
        <p class="muted">You typed <span class="code">${escapeHtml(cmd.input)}</span>. Ticker screens like <span class="code">AAPL</span> are coming soon.</p>`;
    }
  }

  function run(raw, { push = true } = {}) {
    const clean = tokenize(raw).join(' ') || DEFAULT_COMMAND;
    if (push) {
      const q = toQuery(clean);
      if (location.search !== q) window.history.pushState({ c: clean }, '', q);
      if (cmdHistory[cmdHistory.length - 1] !== clean) {
        cmdHistory.push(clean);
        cmdHistory = cmdHistory.slice(-50);
        store.set('bb.history', cmdHistory);
      }
    }
    histIndex = cmdHistory.length;
    input.value = '';
    draft = '';
    closeSuggest();
    placeCursor();
    render(clean);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = active >= 0 && items[active] && !items[active].usage ? items[active].value : input.value;
    if (!value.trim()) { run(fromQuery(location.search), { push: false }); return; }
    run(value);
    if (coarse) input.blur();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (!input.value.trim() && !items.length) return;
      e.preventDefault();
      if (tabIndex === -1) tabBase = input.value;
      tabIndex = e.shiftKey ? tabIndex - 1 : tabIndex + 1;
      input.value = complete(tabBase, tabIndex);
      input.setSelectionRange(input.value.length, input.value.length);
      active = -1;
      renderSuggest();
      placeCursor();
      return;
    }
    tabIndex = -1;
    if (e.key === 'ArrowUp') {
      if (!cmdHistory.length) return;
      e.preventDefault();
      if (histIndex === cmdHistory.length) draft = input.value;
      histIndex = Math.max(0, histIndex - 1);
      input.value = cmdHistory[histIndex];
      closeSuggest();
      requestAnimationFrame(() => { input.setSelectionRange(input.value.length, input.value.length); placeCursor(); });
    } else if (e.key === 'ArrowDown') {
      if (histIndex >= cmdHistory.length) return;
      e.preventDefault();
      histIndex += 1;
      input.value = histIndex === cmdHistory.length ? draft : cmdHistory[histIndex];
      closeSuggest();
      requestAnimationFrame(() => { input.setSelectionRange(input.value.length, input.value.length); placeCursor(); });
    } else if (e.key === 'Escape') {
      if (!list.hidden) closeSuggest(); else { input.value = ''; placeCursor(); }
    }
  });

  input.addEventListener('input', () => { active = -1; renderSuggest(); placeCursor(); });
  ['keyup', 'click', 'select', 'scroll'].forEach((ev) => input.addEventListener(ev, placeCursor));
  input.addEventListener('focus', () => { document.body.classList.add('cmd-focused'); placeCursor(); });
  input.addEventListener('blur', () => { document.body.classList.remove('cmd-focused'); setTimeout(closeSuggest, 120); });

  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    const s = items[Number(li.dataset.i)];
    if (!s) return;
    if (s.value.endsWith(' ')) {
      input.value = s.value;
      renderSuggest();
      placeCursor();
    } else {
      run(s.value);
    }
  });

  // Links and buttons that carry a command run it in place.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-cmd]');
    if (el) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      run(el.dataset.cmd);
      if (!coarse) input.focus();
      return;
    }
    // Keep the command bar focused, unless the user is selecting text.
    if (!coarse && !String(window.getSelection?.() || '')) input.focus();
  });

  // Typing anywhere goes to the command bar.
  document.addEventListener('keydown', (e) => {
    if (document.activeElement === input || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1 || e.key === 'Backspace') input.focus();
  });

  window.addEventListener('popstate', () => render(fromQuery(location.search)));

  // --- clock ----------------------------------------------------------------
  const clockEl = $('clock');
  const statusEl = $('market-status');
  function tick() {
    const now = new Date();
    clockEl.textContent = nyClock(now);
    const open = marketStatus(now) === 'OPEN';
    statusEl.dataset.open = String(open);
    statusEl.querySelector('.status-text').textContent = open ? 'MARKET OPEN' : 'MARKET CLOSED';
  }
  tick();
  setInterval(tick, 1000);

  // --- ticker tape ----------------------------------------------------------
  let tapeKey = '';
  async function loadTape() {
    try {
      const data = await fetchJSON('/api/markets');
      const html = data.instruments.map((q) => {
        const d = dirOf(q.change);
        return `<a class="tape-item" href="${toQuery('MARKETS')}" data-cmd="MARKETS">
          <span class="tape-name">${escapeHtml(q.name)}</span>
          <span class="tape-last num">${fmtNum(q.last, q.decimals)}</span>
          <span class="tape-chg num ${d}">${fmtPct(q.changePct)}</span></a>`;
      }).join('');
      const key = html;
      if (key === tapeKey) return;
      tapeKey = key;
      const group = `<div class="tape-group">${html}</div>`;
      tape.innerHTML = group + group.replace('class="tape-group"', 'class="tape-group" aria-hidden="true"');
      const w = tape.firstElementChild.getBoundingClientRect().width;
      tape.style.setProperty('--tape-duration', `${Math.max(30, Math.round(w / 40))}s`);
      tape.classList.add('is-running');
    } catch {
      if (!tapeKey) tape.innerHTML = '<span class="tape-empty">Market data is taking a break.</span>';
    }
  }
  loadTape();
  setInterval(loadTape, 60_000);

  // --- share: copy the current link, confirm with a toast ---------------------
  const toast = $('toast');
  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-open'), 1800);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }
  $('share').addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = location.origin + location.pathname + toQuery(fromQuery(location.search));
    showToast((await copyText(url)) ? 'Link copied' : 'Copy the link from the address bar');
    if (!coarse) input.focus();
  });

  // --- first render ---------------------------------------------------------
  const initial = fromQuery(location.search);
  window.history.replaceState({ c: initial }, '', location.search ? toQuery(initial) : location.pathname);
  const firstVisit = !store.get('bb.booted', false);
  if (firstVisit && !location.search && !reduceMotion.matches) {
    store.set('bb.booted', true);
    bootSequence(screen, () => render(initial));
  } else {
    render(initial);
  }
  if (!coarse) input.focus();
  placeCursor();
}

// First visit only: a short, fast boot log. Any key or tap skips it.
export const BOOT_LINES = [
  ['BLOOMBROKE OS v4.20', ''],
  ['connecting to markets ....... ', 'ok'],
  ['loading ticker tape ......... ', 'ok'],
  ['syncing New York clock ...... ', 'ok'],
  ['cost: $4.20/mo (they charge $32,000/yr)', ''],
  ['ready.', ''],
];

function bootSequence(screen, done) {
  const view = document.createElement('section');
  view.className = 'view boot';
  view.setAttribute('aria-label', 'Starting up');
  screen.replaceChildren(view);
  const total = BOOT_LINES.reduce((n, [a, b]) => n + a.length + b.length, 0);
  const DURATION = 1150;
  const start = performance.now();
  let finished = false;
  let raf = 0;

  function paint(count) {
    let left = count;
    const html = [];
    for (const [text, ok] of BOOT_LINES) {
      if (left <= 0) break;
      const t = text.slice(0, left);
      left -= t.length;
      const o = left > 0 ? ok.slice(0, left) : '';
      left -= o.length;
      html.push(`<p class="boot-line">${escapeHtml(t)}${o ? `<span class="boot-ok">${escapeHtml(o)}</span>` : ''}</p>`);
    }
    view.innerHTML = html.join('') + '<span class="boot-cursor" aria-hidden="true"></span><p class="boot-skip">Press any key to skip</p>';
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', finish, true);
    window.removeEventListener('pointerdown', finish, true);
    if (view.isConnected) done();
  }

  function frame(now) {
    if (!view.isConnected) { finish(); return; }
    const p = Math.min(1, (now - start) / DURATION);
    paint(Math.ceil(p * total));
    if (p < 1) raf = requestAnimationFrame(frame);
    else setTimeout(finish, 180);
  }

  window.addEventListener('keydown', finish, true);
  window.addEventListener('pointerdown', finish, true);
  raf = requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
