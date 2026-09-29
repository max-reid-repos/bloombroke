// NEWS in a small DOM (test/fixtures/tiny-dom.js): the real render(). The source toggles
// in the title strip keep working while an "N NEW" badge shows: the reader's first
// pointerdown or key clears the badge (liveNews, a capture listener on the document)
// without replacing the toggle being pressed, so that click still switches the source,
// and a toggle that had the focus keeps it when the strip is rebuilt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../public/screens/news-page.js';
import { mount, fakeDocument, flush } from './fixtures/tiny-dom.js';

const doc = fakeDocument();
doc.activeElement = null;
globalThis.document = doc;
globalThis.window = { scrollY: 0, scrollBy() {} };

const story = (title, min, source) => ({ title, link: `https://x.test/${title}`, time: new Date(Date.now() - min * 60_000).toISOString(), source });
const SOURCES = ['CNBC', 'MarketWatch'];

function page() {
  let items = [story('A', 5, 'CNBC'), story('B', 9, 'MarketWatch'), story('C', 20, 'CNBC')];
  let poll = null;
  const cleanups = [];
  const saved = new Map();
  const ctx = {
    fetchJSON: async () => ({ items, sources: SOURCES, updated: null }),
    store: { get: (k, f) => (saved.has(k) ? saved.get(k) : f), set: (k, v) => saved.set(k, v) },
    live: (fn) => { poll = fn; },
    onCleanup: (fn) => cleanups.push(fn),
    status() {},
    updated() {},
  };
  const el = mount();
  render(el, { name: 'NEWS', args: { tab: 'MARKETS' } }, ctx);
  return {
    el, saved,
    meta: () => el.querySelector('#news-meta'),
    rows: () => el.querySelectorAll('.news-row').map((r) => r.querySelector('.news-title').textContent),
    async more(extra) { items = [extra, ...items]; poll(); await flush(); await new Promise((r) => { setTimeout(r, 5); }); },
    leave() { for (const f of cleanups) f(); },
  };
}

test('NEWS strip: a toggle pressed while "1 NEW" shows still switches the source', async () => {
  const p = page();
  await flush();
  assert.deepEqual(p.rows(), ['A', 'B', 'C']);
  const meta = p.meta();
  assert.equal(meta.querySelectorAll('.seg-item').map((b) => b.textContent).join(' '), 'ALL CNBC MKTW', 'the toggles, once, in the strip');
  await p.more(story('D', 1, 'MarketWatch'));
  assert.equal(meta.querySelector('.news-new')?.textContent, '1 NEW');
  const cnbc = meta.querySelector('button[data-value="CNBC"]:not(.news-src-one)');
  // The press: pointerdown first (it clears the badge), then the click on the same button.
  doc.activeElement = cnbc;
  doc.fire('pointerdown');
  assert.equal(meta.querySelector('.news-new'), null, 'the badge is gone');
  assert.equal(meta.querySelector('button[data-value="CNBC"]:not(.news-src-one)'), cnbc, 'the toggle under the pointer is the same element');
  assert.ok(meta.contains(cnbc));
  meta.dispatch('click', { target: cnbc });
  assert.deepEqual(p.rows(), ['A', 'C'], 'the click switched the source');
  // The toggles were rebuilt (CNBC is now the active one): the focus came back to CNBC.
  const now = meta.querySelector('button[data-value="CNBC"]:not(.news-src-one)');
  assert.notEqual(now, cnbc);
  assert.ok(now.classList.contains('is-active'));
  assert.equal(now.focused, true, 'the focus is back on the toggle');
  p.leave();
});

test('NEWS strip: a key (Enter) pressed while "1 NEW" shows is not lost either', async () => {
  const p = page();
  await flush();
  await p.more(story('E', 1, 'CNBC'));
  const meta = p.meta();
  const mktw = meta.querySelector('button[data-value="MKTW"]:not(.news-src-one)');
  assert.ok(meta.querySelector('.news-new'));
  doc.activeElement = mktw;
  doc.key('Enter', mktw); // the capture keydown clears the badge first
  assert.equal(meta.querySelector('.news-new'), null);
  assert.equal(meta.querySelector('button[data-value="MKTW"]:not(.news-src-one)'), mktw, 'still the focused toggle');
  meta.dispatch('click', { target: mktw }); // Enter on a button clicks it
  assert.deepEqual(p.rows(), ['B']);
  // The LIVE marker and the badge have slots of their own; the toggles are not rebuilt
  // by a repaint that changes nothing.
  const again = meta.querySelector('button[data-value="MKTW"]:not(.news-src-one)');
  await p.more(story('F', 0, 'CNBC'));
  assert.equal(meta.querySelector('button[data-value="MKTW"]:not(.news-src-one)'), again);
  p.leave();
});
