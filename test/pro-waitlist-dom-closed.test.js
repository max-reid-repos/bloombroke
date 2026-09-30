// PRO WAITLIST in a small DOM, checkout closed (the config says closed): under "Pro opens
// soon." one email box, TELL ME and one line; a bad address stays in the browser; a good
// one is sent once and the form gives way to the done line; errors go to the status line;
// analytics get the goal and never the address. One mode per file: getConfig keeps its
// first good answer for the page's life (test/pro-waitlist-dom-open.test.js: checkout open).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, mainHtml, WAIT_LABEL, WAIT_BUTTON, WAIT_NOTE, WAIT_DONE, WAIT_BAD } from '../public/screens/pro.js';
import { cardWords } from '../public/kit.js';
import { mount, flush, El, Text } from './fixtures/tiny-dom.js';

const posts = [];
let answer = { status: 200, body: { ok: true } };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/api/pro/waitlist')) {
    posts.push({ url: u, opts, body: JSON.parse(opts.body) });
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  }
  return { ok: true, json: async () => ({ mode: 'live', open: false, closed: true, yearly: true }) };
};
const df = [];
globalThis.window = { datafast: (...a) => df.push(a) };

async function page() {
  const el = mount();
  const status = [];
  const ctx = { status: (t, kind) => status.push([t, kind || '']), fetchJSON: async () => ({ next: 7 }), store: { get: (k, fb) => fb, set() {} } };
  render(el, { name: 'PRO', args: {} }, ctx);
  await flush(12);
  return { el, status };
}

test('copy: the words the owner asked for', () => {
  assert.equal(WAIT_LABEL, 'Your email');
  assert.equal(WAIT_BUTTON, 'TELL ME');
  assert.equal(WAIT_NOTE, 'One email when Pro opens. Nothing else.');
  assert.equal(WAIT_DONE, 'Done. We will email you once when Pro opens.');
  for (const s of [WAIT_LABEL, WAIT_BUTTON, WAIT_NOTE, WAIT_DONE, WAIT_BAD]) {
    assert.doesNotMatch(s, /—/);
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'));
  }
});

test('checkout closed: "Pro opens soon.", then the email box, TELL ME and one line; no "Cancel any time."', async () => {
  const { el } = await page();
  assert.equal(el.querySelector('#pro-sub'), null, 'no buy button');
  assert.equal(el.querySelector('#pro-soon').hidden, false);
  const box = el.querySelector('#pro-wait');
  assert.equal(box.hidden, false);
  const input = box.querySelector('#pro-wait-email');
  assert.equal(input.getAttribute('type'), 'email');
  assert.equal(input.getAttribute('placeholder'), 'Your email');
  assert.equal(input.getAttribute('aria-label'), 'Your email');
  assert.equal(input.getAttribute('autocomplete'), 'email');
  assert.equal(input.getAttribute('maxlength'), '254');
  assert.ok(input.classList.contains('card-input'), 'the kit input');
  const btn = box.querySelector('#pro-wait-send');
  assert.equal(btn.getAttribute('type'), 'submit', 'Enter in the box sends');
  assert.equal(btn.textContent, 'TELL ME');
  assert.ok(btn.classList.contains('btn-solid'), 'the one white action');
  assert.equal(box.querySelector('#pro-wait-note').textContent, WAIT_NOTE);
  const hp = box.querySelector('#pro-wait-hp');
  assert.equal(hp.getAttribute('tabindex'), '-1');
  assert.equal(hp.getAttribute('aria-hidden'), 'true');
  // Nothing to buy or cancel: the visitor's note ("Cancel any time.", the yearly line) is hidden.
  assert.equal(el.querySelector('#pro-note').hidden, true);
  // The soon line comes first, the form under it, in the action row.
  const act = el.querySelector('.card-act');
  const ids = act.querySelectorAll('#pro-soon, #pro-wait').map((e) => e.id);
  assert.deepEqual(ids, ['pro-soon', 'pro-wait']);
});

test('a bad address stays in the browser and says so in the status line', async () => {
  const { el, status } = await page();
  const n = posts.length;
  const input = el.querySelector('#pro-wait-email');
  for (const v of ['', 'nope', 'a@b', 'a b@c.co']) {
    input.value = v;
    el.querySelector('#pro-wait-form').dispatch('submit');
    await flush(4);
  }
  assert.equal(posts.length, n, 'nothing sent');
  assert.deepEqual(status.at(-1), [WAIT_BAD, 'warn']);
  // A phone cuts the status line: the error is in the line under the form too.
  const note = el.querySelector('#pro-wait-note');
  assert.equal(note.textContent, WAIT_BAD);
  assert.ok(note.classList.contains('warn'));
  assert.equal(note.getAttribute('aria-live'), 'polite');
  // The next try puts the usual line back (here it fails again, with the same words).
  input.value = 'still-bad';
  let seen = null;
  const orig = note.classList.toggle;
  note.classList.toggle = (c, on) => { if (seen === null) seen = [note.textContent, on]; return orig(c, on); };
  el.querySelector('#pro-wait-form').dispatch('submit');
  await flush(4);
  assert.deepEqual(seen, [WAIT_NOTE, false], 'the usual line first');
  assert.equal(input.focused, true);
  assert.equal(el.querySelector('#pro-wait-form') !== null, true, 'the form stays');
});

test('a good address: sent once, the form gives way to the done line; the goal has no address', async () => {
  answer = { status: 200, body: { ok: true } };
  df.length = 0;
  const { el, status } = await page();
  const n = posts.length;
  el.querySelector('#pro-wait-email').value = '  Ann@Example.com ';
  const form = el.querySelector('#pro-wait-form');
  form.dispatch('submit');
  form.dispatch('submit'); // a double press sends once
  await flush(8);
  assert.equal(posts.length, n + 1);
  const p = posts.at(-1);
  assert.equal(p.url, '/api/pro/waitlist');
  assert.equal(p.opts.method, 'POST');
  assert.deepEqual(p.body, { email: 'Ann@Example.com', hp: '' });
  assert.equal(el.querySelector('#pro-wait-form'), null, 'the form is gone');
  assert.equal(el.querySelector('#pro-wait-done').textContent, WAIT_DONE);
  assert.equal(el.querySelector('#pro-soon').hidden, false, 'the soon line stays');
  assert.deepEqual(status.at(-1), ['ON THE LIST', '']);
  assert.deepEqual(df, [['waitlist_joined']], 'one goal, no props');
  assert.doesNotMatch(JSON.stringify(df), /ann|example/i);
});

test('a server error goes to the status line; the form stays and can send again', async () => {
  answer = { status: 429, body: { error: 'rate_limited', message: 'Too many tries. Wait an hour and try again.' } };
  df.length = 0;
  const { el, status } = await page();
  el.querySelector('#pro-wait-email').value = 'bo@example.com';
  el.querySelector('#pro-wait-form').dispatch('submit');
  await flush(8);
  assert.deepEqual(status.at(-1), ['Too many tries. Wait an hour and try again.', 'warn']);
  assert.equal(el.querySelector('#pro-wait-note').textContent, 'Too many tries. Wait an hour and try again.');
  assert.ok(el.querySelector('#pro-wait-note').classList.contains('warn'));
  assert.ok(el.querySelector('#pro-wait-form'), 'the form stays');
  assert.equal(el.querySelector('#pro-wait-send').disabled, false);
  assert.deepEqual(df, [], 'no goal');
  answer = { status: 200, body: { ok: true } };
  el.querySelector('#pro-wait-form').dispatch('submit');
  await flush(8);
  assert.equal(el.querySelector('#pro-wait-done').textContent, WAIT_DONE);
});

test('Esc in the form hands the keyboard back to the command bar', async () => {
  const { el } = await page();
  const cmd = { focused: false, focus() { this.focused = true; } };
  const prev = globalThis.document;
  globalThis.document = { getElementById: (id) => (id === 'cmd' ? cmd : null) };
  try {
    let prevented = false;
    el.querySelector('#pro-wait-form').dispatch('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
    assert.equal(cmd.focused, true);
    assert.equal(prevented, true);
  } finally {
    globalThis.document = prev;
  }
});

test('screen keys never fire while typing in the box', async () => {
  const { stageKeyFor } = await import('../public/screens/pro.js');
  const { el } = await page();
  const input = el.querySelector('#pro-wait-email');
  assert.equal(stageKeyFor({ key: '2', target: input }, input), null, '1 to 4 only on the stage');
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /if \(e\.target\.closest\('input, select, textarea, button, summary, \[data-own-focus\]'\)\) return;/, 'the global keys leave inputs alone');
});

test('waitlist: nothing goes to analytics', () => {
  const src = readFileSync('public/screens/pro.js', 'utf8');
  const wl = src.slice(src.indexOf('// ---- PRO WAITLIST'), src.indexOf('// ---- end PRO WAITLIST'));
  assert.ok(wl.length > 100);
  assert.match(wl, /goal\('waitlist_joined'\)/, 'one goal, no props');
  assert.doesNotMatch(wl, /goal\('waitlist_joined', /);
  assert.doesNotMatch(wl, /datafast|gtag|ahrefs/i);
});

// The words a visitor sees above + Details, read from the page as drawn: the rules of
// kit.js cardWords (hidden parts, pictures with a label and aria-hidden parts do not count).
function shownWords(root) {
  const parts = [];
  const walk = (n) => {
    if (n instanceof Text) { parts.push(n.text); return; }
    if (!(n instanceof El)) return;
    if (n.tag === 'details' && n.classList.contains('card-more')) return;
    if ('hidden' in n.attrs || n.attrs['aria-hidden'] === 'true' || (n.attrs.role === 'img' && n.attrs['aria-label'])) return;
    for (const c of n.children) walk(c);
    parts.push(' ');
  };
  walk(root);
  return cardWords(parts.join(' '));
}

test('word budget: closed mode reads 43 words above Details (live mode: 35)', async () => {
  const open = mount(mainHtml({ next: 4, has: () => true }));
  assert.equal(shownWords(open).length, cardWords(mainHtml({ next: 4, has: () => true })).length, 'the same count as cardWords on the live page');
  const { el } = await page();
  const w = shownWords(el);
  // 35 - SUBSCRIBE - "Cancel any time." + "Pro opens soon." + TELL ME + the one line.
  assert.equal(w.length, 35 - 1 - 3 + 3 + 2 + 7, w.join(' '));
  assert.ok(!w.includes('SUBSCRIBE'));
  assert.ok(!w.join(' ').includes('Cancel any time.'));
});
