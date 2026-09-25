import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, upsertEnv, PRODUCT, PRICE } from '../scripts/stripe-setup.js';
import { WEBHOOK_EVENTS } from '../pro/billing.js';

// An in-memory Stripe with just the calls the setup script makes.
function fakeStripe() {
  const db = { products: [], prices: [], portals: [], endpoints: [] };
  const created = [];
  let n = 0;
  const id = (p) => `${p}_${++n}`;
  return {
    db, created,
    products: {
      list: () => db.products.filter((p) => p.active),
      async create(p) { const o = { id: id('prod'), active: true, ...p }; db.products.push(o); created.push('product'); return o; },
    },
    prices: {
      list: ({ product }) => db.prices.filter((p) => p.product === product && p.active),
      async create(p) { const o = { id: id('price'), active: true, ...p }; db.prices.push(o); created.push('price'); return o; },
    },
    billingPortal: {
      configurations: {
        list: () => db.portals,
        async create(p) { const o = { id: id('bpc'), active: true, ...p }; db.portals.push(o); created.push('portal'); return o; },
      },
    },
    webhookEndpoints: {
      list: () => db.endpoints,
      async create(p) { const o = { id: id('we'), status: 'enabled', secret: 'whsec_created_once', ...p }; db.endpoints.push(o); created.push('endpoint'); return o; },
      async update(eid, p) { Object.assign(db.endpoints.find((e) => e.id === eid), p, { status: 'enabled' }); created.push('endpoint.update'); },
    },
  };
}

test('stripe setup: creates product, $4.20 monthly price, portal and webhook once', async () => {
  const stripe = fakeStripe();
  const first = await setup({ stripe });
  assert.deepEqual(stripe.created, ['product', 'price', 'portal', 'endpoint']);
  const [product] = stripe.db.products;
  assert.equal(product.name, PRODUCT.name);
  assert.equal(product.description, 'Bloombroke Pro, monthly subscription: price alerts and watchlist sync across devices.');
  const [price] = stripe.db.prices;
  assert.equal(price.unit_amount, 420);
  assert.equal(price.currency, 'usd');
  assert.deepEqual(price.recurring, { interval: 'month', interval_count: 1 });
  assert.deepEqual(PRICE, { unit_amount: 420, currency: 'usd', interval: 'month' });
  const [ep] = stripe.db.endpoints;
  assert.equal(ep.url, 'https://bloombroke.com/api/stripe/webhook');
  assert.deepEqual(ep.enabled_events, WEBHOOK_EVENTS);
  assert.equal(stripe.db.portals[0].features.subscription_update, undefined, 'no plan switching');
  assert.equal(first.values.STRIPE_PRICE_ID, price.id);
  assert.equal(first.values.STRIPE_WEBHOOK_SECRET, 'whsec_created_once');
  assert.ok(first.values.PRO_SECRET.length >= 32);
  assert.ok(!first.report.join('\n').includes('whsec_'), 'the report never shows a secret');
  assert.ok(!first.report.join('\n').includes(price.id));

  // Second run, secrets already in the .env: finds everything, creates nothing.
  const second = await setup({ stripe, env: { STRIPE_WEBHOOK_SECRET: 'whsec_created_once', PRO_SECRET: first.values.PRO_SECRET } });
  assert.deepEqual(stripe.created, ['product', 'price', 'portal', 'endpoint']);
  assert.equal(second.values.STRIPE_PRICE_ID, price.id);
  assert.equal(second.values.STRIPE_WEBHOOK_SECRET, undefined);
  assert.equal(second.values.PRO_SECRET, undefined);

  // Endpoint exists but the secret is lost: say so, do not invent one.
  const third = await setup({ stripe, env: { PRO_SECRET: 'x'.repeat(40) } });
  assert.equal(third.values.__missingWebhookSecret, true);
  // An endpoint missing an event gets it back.
  stripe.db.endpoints[0].enabled_events = ['checkout.session.completed'];
  await setup({ stripe, env: { STRIPE_WEBHOOK_SECRET: 'whsec_created_once', PRO_SECRET: 'x'.repeat(40) } });
  assert.deepEqual([...stripe.db.endpoints[0].enabled_events].sort(), [...WEBHOOK_EVENTS].sort());
});

test('stripe setup: .env lines are replaced or appended, the rest kept', () => {
  const before = '# comment\nPORT=3020\nSTRIPE_SECRET_KEY=sk_test_abc\nSTRIPE_PRICE_ID=price_old\n';
  const after = upsertEnv(before, { STRIPE_PRICE_ID: 'price_new', STRIPE_WEBHOOK_SECRET: 'whsec_x', __missingWebhookSecret: true });
  assert.equal(after, '# comment\nPORT=3020\nSTRIPE_SECRET_KEY=sk_test_abc\nSTRIPE_PRICE_ID=price_new\nSTRIPE_WEBHOOK_SECRET=whsec_x\n');
  assert.equal(upsertEnv('', { A: 'b' }), 'A=b\n');
  assert.throws(() => upsertEnv('', { A: 'two words' }));
  assert.throws(() => upsertEnv('', { A: 'x\nEVIL=1' }));
});
