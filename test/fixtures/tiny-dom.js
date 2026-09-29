// A tiny DOM for the PRO page tests (test/pro-v5-dom*.test.js, test/pro-v5.test.js): no
// DOM library in this repo, so enough of Element for what screens/pro.js and
// screens/pro-demo.js touch. Selectors: '#id', '.a', 'tag', '[attr]', '[attr="v"]', and
// ':not(...)' of those, joined by commas. Not a test file itself (it has no tests).

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'rect', 'path', 'polyline', 'circle', 'source']);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '·').replace(/&amp;/g, '&');
const camelToData = (k) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export class Text {
  constructor(text, parent) { this.text = text; this.parent = parent; }
}
export class El {
  constructor(tag, attrs = {}, parent = null) {
    this.tag = tag;
    this.attrs = attrs;
    this.parent = parent;
    this.children = [];
    this.listeners = {};
    this.connected = false;
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => self.attrs[camelToData(String(k))],
      set: (_, k, v) => { self.attrs[camelToData(String(k))] = String(v); return true; },
    });
    this.classList = {
      contains: (c) => (self.attrs.class || '').split(/\s+/).includes(c),
      add: (c) => { if (!self.classList.contains(c)) self.attrs.class = `${self.attrs.class || ''} ${c}`.trim(); },
      remove: (c) => { self.attrs.class = (self.attrs.class || '').split(/\s+/).filter((x) => x !== c).join(' '); },
      toggle: (c, on) => { if (on ?? !self.classList.contains(c)) self.classList.add(c); else self.classList.remove(c); },
    };
  }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.connected; }
  get id() { return this.attrs.id || ''; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get disabled() { return 'disabled' in this.attrs; }
  set disabled(v) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }
  set title(v) { this.attrs.title = String(v); }
  get title() { return this.attrs.title || ''; }
  get textContent() { return this.children.map((c) => (c instanceof Text ? decode(c.text) : c.textContent)).join(''); }
  set textContent(v) { this.children = [new Text(String(v), this)]; }
  set innerHTML(html) { this.children = parse(String(html), this); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  dispatch(t, ev = {}) { for (const f of [...(this.listeners[t] || [])]) f({ target: this, preventDefault() {}, stopPropagation() {}, ...ev }); }
  click() { if (this.disabled) return; this.dispatch('click'); }
  focus() { this.focused = true; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  *all() { for (const c of this.children) if (c instanceof El) { yield c; yield* c.all(); } }
  matches(sel) { return splitList(sel).some((one) => matchOne(this, one.trim())); }
  querySelectorAll(sel) { return [...this.all()].filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  contains(n) { for (; n; n = n.parent) if (n === this) return true; return false; }
  closest(sel) { let n = this; while (n instanceof El) { if (n.matches(sel)) return n; n = n.parent; } return null; }
}
// Commas outside brackets and parentheses.
function splitList(sel) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '[' || ch === '(') depth += 1;
    if (ch === ']' || ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function matchOne(el, sel) {
  const not = [...sel.matchAll(/:not\(([^)]+)\)/g)].map((m) => m[1]);
  let base = sel.replace(/:not\([^)]+\)/g, '');
  for (const n of not) if (matchOne(el, n)) return false;
  for (const [, name, val] of base.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!(name in el.attrs)) return false;
    if (val !== undefined && el.attrs[name] !== val) return false;
  }
  base = base.replace(/\[[^\]]*\]/g, '');
  for (const [, kind, name] of base.matchAll(/([#.]?)([\w-]+)/g)) {
    if (kind === '#' && el.id !== name) return false;
    if (kind === '.' && !el.classList.contains(name)) return false;
    if (kind === '' && el.tag !== name) return false;
  }
  return true;
}
export function parse(html, parent) {
  const out = [];
  const stack = [{ el: parent, kids: out }];
  const top = () => stack[stack.length - 1];
  for (const m of html.matchAll(/<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g)) {
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    if (m[2]) {
      const attrs = {};
      for (const a of (m[3] || '').matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
      const cur = top();
      const el = new El(m[2].toLowerCase(), attrs, cur.el);
      cur.kids.push(el);
      if (!m[4] && !VOID.has(el.tag)) stack.push({ el, kids: el.children });
      continue;
    }
    if (m[5].trim()) top().kids.push(new Text(m[5], top().el));
  }
  return out;
}

// A connected root holding html.
export function mount(html = '', tag = 'section') {
  const el = new El(tag);
  el.connected = true;
  if (html) el.innerHTML = html;
  return el;
}

// A document for keydown listeners (capture or not), and a tab that can hide.
export function fakeDocument() {
  const fns = { keydown: new Set(), visibilitychange: new Set() };
  return {
    hidden: false,
    addEventListener(t, f) { (fns[t] ||= new Set()).add(f); },
    removeEventListener(t, f) { fns[t]?.delete(f); },
    // A key pressed with the focus on target: { prevented, stopped }.
    key(key, target, mods = {}) {
      const ev = { key, target, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, prevented: false, stopped: false, ...mods };
      ev.preventDefault = () => { ev.prevented = true; };
      ev.stopPropagation = () => { ev.stopped = true; };
      for (const f of [...fns.keydown]) f(ev);
      return ev;
    },
    fire(t = 'visibilitychange') { for (const f of [...(fns[t] || [])]) f(); },
    count(t) { return fns[t]?.size || 0; },
  };
}

// Timers that run when told: step() runs the one due first (all due together at once).
export function fakeTimers() {
  let n = 0;
  const q = new Map();
  return {
    q,
    setTimeout(fn, ms) { n += 1; q.set(n, { fn, ms }); return n; },
    clearTimeout(id) { q.delete(id); },
    step() {
      if (!q.size) return false;
      const min = Math.min(...[...q.values()].map((t) => t.ms));
      const due = [...q.entries()].filter(([, t]) => t.ms === min);
      for (const [id] of due) q.delete(id);
      for (const t of q.values()) t.ms -= min;
      for (const [, t] of due) t.fn();
      return min;
    },
    // Run timers until ms have passed (a timer due later stays, its time shortened).
    advance(ms) {
      let left = ms;
      while (q.size) {
        const min = Math.min(...[...q.values()].map((t) => t.ms));
        if (min > left) { for (const t of q.values()) t.ms -= left; return; }
        left -= min;
        this.step();
      }
    },
  };
}

export const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => { setImmediate(r); }); };
