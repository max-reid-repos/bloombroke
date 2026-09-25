import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom, KEY_RE } from '../pro/licence.js';
import { reissue } from '../scripts/pro-reissue.js';

function fixture() {
  const store = createStore(openDb(':memory:'), { aesKey: revealKeyFrom('z'.repeat(40)) });
  const a = store.ensureLicence({ sessionId: 'cs_test_a', customerId: 'cus_a', subscriptionId: 'sub_a', status: 'active' });
  store.putDocs(a.licence.id, { watch: { data: ['KO'], updatedAt: 1 } });
  const calls = [];
  const stripe = {
    customers: { list: ({ email }) => ({ 'a@example.com': [{ id: 'cus_a' }], 'two@example.com': [{ id: 'cus_b' }, { id: 'cus_c' }] }[email] || []) },
    subscriptions: { async update(id, p) { calls.push([id, p]); } },
  };
  return { store, stripe, calls, a };
}

test('reissue by subscription: new key works, old key stops, data stays', async () => {
  const { store, stripe, calls, a } = fixture();
  const out = await reissue({ store, stripe, subscription: 'sub_a' });
  assert.match(out.key, KEY_RE);
  assert.notEqual(out.key, a.key);
  assert.equal(store.findByKey(a.key), null, 'old key no longer works');
  assert.equal(store.findByKey(out.key).id, a.licence.id);
  assert.equal(out.licence.reveal_ciphertext, null);
  assert.deepEqual(store.getDocs(a.licence.id).watch.data, ['KO']);
  assert.deepEqual(calls, [['sub_a', { metadata: { site: 'bloombroke', product: 'pro', licence_last4: out.key.slice(-4) } }]]);
  assert.match((await reissue({ store, stripe, subscription: 'sub_nope' })).error, /No licence/);
});

test('reissue by email: one match rotates, several ask for --subscription', async () => {
  const { store, stripe, a } = fixture();
  store.ensureLicence({ sessionId: 'cs_test_b', customerId: 'cus_b', subscriptionId: 'sub_b', status: 'active' });
  store.ensureLicence({ sessionId: 'cs_test_c', customerId: 'cus_c', subscriptionId: 'sub_c', status: 'canceled' });
  const one = await reissue({ store, stripe, email: 'a@example.com' });
  assert.equal(store.findByKey(one.key).id, a.licence.id);
  const two = await reissue({ store, stripe, email: 'two@example.com' });
  assert.match(two.error, /--subscription/);
  assert.equal(two.candidates.length, 2);
  assert.match((await reissue({ store, stripe, email: 'none@example.com' })).error, /No licence/);
  assert.match((await reissue({ store, email: 'a@example.com' })).error, /STRIPE_SECRET_KEY/);
  assert.match((await reissue({ store })).error, /--subscription/);
});
