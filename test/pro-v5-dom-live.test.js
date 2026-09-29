// PRO v5 in a small DOM, live mode (test/pro-v5-dom.test.js has test mode: getConfig keeps
// its first good answer for the page's life, so one mode per file). The test-mode line and
// the test card stay hidden; the price is still not in the status bar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../public/screens/pro.js';
import { mount, flush } from './fixtures/tiny-dom.js';

test('live mode: no test-mode line, no test card; yearly first; the status bar without the price', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ mode: 'live', open: true, yearly: true }) });
  const el = mount();
  const status = [];
  const ctx = { status: (t) => status.push(t), fetchJSON: async () => ({ next: 7 }), store: { get: (k, fb) => fb, set() {} } };
  render(el, { name: 'PRO', args: {} }, ctx);
  await flush(12);
  assert.equal(el.querySelector('#pro-test').hidden, true);
  assert.equal(el.querySelector('#pro-demo').hidden, true);
  assert.equal(el.querySelector('#pro-year-note').hidden, true);
  assert.equal(el.querySelector('#pro-plan-year').getAttribute('aria-pressed'), 'true');
  assert.equal(el.querySelector('#pro-plan-year').disabled, false);
  assert.equal(el.querySelector('.card-note').textContent, 'Cancel any time. Yearly is not available yet. Monthly is.Test mode: no card is charged yet.', 'the hidden lines are there, hidden');
  assert.deepEqual(status, ['']);
});
