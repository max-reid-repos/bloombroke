// PRO v4 in a small DOM: the real render() and its real handlers on the visitor's page.
// The plan switch (a click picks the other plan: the hero, the unit, the switch and the
// button follow) and yearly not set up (monthly, the switch off). No DOM library in this
// repo, so a tiny one below: enough of Element for what pro.js touches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../public/screens/pro.js';

// ---- a tiny DOM -------------------------------------------------------------------------

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'rect', 'path', 'polyline', 'circle', 'source']);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '·').replace(/&amp;/g, '&');
const camelToData = (k) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

class Text {
  constructor(text, parent) { this.text = text; this.parent = parent; }
}
class El {
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
  click() { if (this.disabled) return; for (const f of this.listeners.click || []) f({ target: this, preventDefault() {} }); }
  focus() { this.focused = true; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  *all() { for (const c of this.children) if (c instanceof El) { yield c; yield* c.all(); } }
  matches(sel) { return sel.split(',').some((one) => matchOne(this, one.trim())); }
  querySelectorAll(sel) { return [...this.all()].filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let n = this; while (n instanceof El) { if (n.matches(sel)) return n; n = n.parent; } return null; }
}
// '#id', '.a', 'tag', 'tag.a', '.a:not(.b)'.
function matchOne(el, sel) {
  const not = [...sel.matchAll(/:not\(([^)]+)\)/g)].map((m) => m[1]);
  const base = sel.replace(/:not\([^)]+\)/g, '');
  for (const n of not) if (matchOne(el, n)) return false;
  for (const [, kind, name] of base.matchAll(/([#.]?)([\w-]+)/g)) {
    if (kind === '#' && el.id !== name) return false;
    if (kind === '.' && !el.classList.contains(name)) return false;
    if (kind === '' && el.tag !== name) return false;
  }
  return true;
}
function parse(html, parent) {
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

// ---- the page ---------------------------------------------------------------------------

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => { setImmediate(r); }); };
function page(config) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (config === null) throw new Error('offline');
    return { ok: true, json: async () => config };
  };
  const el = new El('section');
  el.connected = true;
  const status = [];
  // No signal: the live minis stay off here (their own tests are in pro-v4.test.js).
  const ctx = { status: (t) => status.push(t), fetchJSON: async () => ({ next: 5 }), store: { get: (k, fb) => fb, set() {} } };
  render(el, { name: 'PRO', args: {} }, ctx);
  return { el, ctx, calls, status };
}
const bits = (el) => ({
  hero: el.querySelector('#pro-price').textContent,
  heroLabel: el.querySelector('#pro-hero').getAttribute('aria-label'),
  unit: el.querySelector('#pro-unit').textContent,
  switch: el.querySelector('#pro-switch').textContent,
  switchPlan: el.querySelector('#pro-switch').dataset.plan,
  plan: el.querySelector('#pro-sub').dataset.plan,
  button: el.querySelector('#pro-sub').textContent,
});

// Yearly first in this file: getConfig() keeps a good answer for the page's life (a
// failed one is asked again), so the failing config goes first.
test('yearly not set up: the page moves to monthly and the switch to yearly is off', async () => {
  const { el, calls } = page(null);
  await flush();
  assert.ok(calls.includes('/api/pro/config'));
  assert.deepEqual(bits(el), { hero: '$42', heroLabel: '$42 a month', unit: 'a month', switch: 'or $420 a year', switchPlan: 'year', plan: 'month', button: 'SUBSCRIBE MONTHLY' });
  const sw = el.querySelector('#pro-switch');
  assert.equal(sw.disabled, true);
  assert.equal(sw.title, 'Yearly is not available yet. Monthly is.');
  assert.equal(el.querySelector('#pro-year-note').hidden, false);
  sw.click();
  assert.equal(bits(el).plan, 'month', 'a disabled switch does nothing');
});

test('the plan switch: a click picks the other plan; the hero, the unit, the switch and SUBSCRIBE follow', async () => {
  const { el } = page({ mode: 'live', open: true, yearly: true });
  await flush();
  assert.deepEqual(bits(el), { hero: '$420', heroLabel: '$420 a year', unit: 'a year', switch: 'or $42 a month', switchPlan: 'month', plan: 'year', button: 'SUBSCRIBE YEARLY' });
  assert.equal(el.querySelector('#pro-switch').disabled, false);
  el.querySelector('#pro-switch').click();
  assert.deepEqual(bits(el), { hero: '$42', heroLabel: '$42 a month', unit: 'a month', switch: 'or $420 a year', switchPlan: 'year', plan: 'month', button: 'SUBSCRIBE MONTHLY' });
  assert.equal(el.querySelector('#pro-switch').hasAttribute('aria-pressed'), false, 'the switch is not a toggle');
  el.querySelector('#pro-switch').click();
  assert.deepEqual(bits(el), { hero: '$420', heroLabel: '$420 a year', unit: 'a year', switch: 'or $42 a month', switchPlan: 'month', plan: 'year', button: 'SUBSCRIBE YEARLY' });
  // The seat fills in the bonus row; the quiet line gives way to LOGIN and REDEEM.
  assert.match(el.querySelector('#pro-seat').getAttribute('aria-label'), /^SEAT 00005$/);
  const q = el.querySelector('#pro-keyq');
  const links = el.querySelector('#pro-keylinks');
  assert.equal(links.hidden, true);
  q.click();
  assert.equal(links.hidden, false);
  assert.equal(q.hidden, true);
  assert.deepEqual(links.querySelectorAll('a').map((a) => a.dataset.cmd), ['LOGIN', 'REDEEM']);
  assert.equal(links.querySelector('a').focused, true);
});
