// PRO WAITLIST in a small DOM, checkout open (the config does not say closed): the box is
// empty and hidden, SUBSCRIBE is there, and nothing is ever sent to the waitlist.
// One mode per file (test/pro-waitlist-dom-closed.test.js: checkout closed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../public/screens/pro.js';
import { mount, flush } from './fixtures/tiny-dom.js';

test('checkout open: no waitlist on show, SUBSCRIBE is there', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ mode: 'test', open: true, yearly: true }) };
  };
  const el = mount();
  const ctx = { status() {}, fetchJSON: async () => ({ next: 7 }), store: { get: (k, fb) => fb, set() {} } };
  render(el, { name: 'PRO', args: {} }, ctx);
  await flush(12);
  assert.ok(el.querySelector('#pro-sub'), 'the buy button');
  assert.equal(el.querySelector('#pro-soon').hidden, true);
  assert.equal(el.querySelector('#pro-wait').hidden, true, 'the waitlist is hidden');
  assert.equal(el.querySelector('#pro-wait').children.length, 0, 'and empty: no form, no words');
  assert.equal(el.querySelector('#pro-wait-email'), null);
  assert.equal(calls.some((u) => u.includes('/api/pro/waitlist')), false);
});
