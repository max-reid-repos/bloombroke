// PRO v5 in a small DOM, checkout closed (PRO_CHECKOUT=closed: the config says closed).
// SUBSCRIBE gives way to "Pro opens soon.", the test-mode line and the test card stay
// hidden even in test mode, and the prices still pick. One mode per file: getConfig keeps
// its first good answer for the page's life (test/pro-v5-dom.test.js has test mode).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, SOON_LINE } from '../public/screens/pro.js';
import { mount, flush } from './fixtures/tiny-dom.js';

test('checkout closed: no SUBSCRIBE, "Pro opens soon.", no test-mode line or test card', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ mode: 'test', open: false, closed: true, yearly: true }) };
  };
  const el = mount();
  const ctx = { status() {}, fetchJSON: async () => ({ next: 7 }), store: { get: (k, fb) => fb, set() {} } };
  render(el, { name: 'PRO', args: {} }, ctx);
  await flush(12);
  assert.equal(SOON_LINE, 'Pro opens soon.');
  assert.equal(el.querySelector('#pro-sub'), null, 'no buy button');
  const soon = el.querySelector('#pro-soon');
  assert.equal(soon.hidden, false);
  assert.equal(soon.textContent, 'Pro opens soon.');
  assert.equal(el.querySelector('#pro-test').hidden, true);
  assert.equal(el.querySelector('#pro-demo').hidden, true);
  el.querySelector('#pro-plan-month').click();
  assert.equal(el.querySelector('#pro-plan-month').getAttribute('aria-pressed'), 'true', 'the prices still pick');
  assert.equal(calls.some((u) => u.includes('/api/pro/checkout')), false, 'no checkout call');
});
