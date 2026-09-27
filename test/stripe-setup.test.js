import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, upsertEnv, PRODUCT, PRICE, PRICE_YEARLY } from '../scripts/stripe-setup.js';
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
      async update(pid, p) { const o = db.products.find((x) => x.id === pid); Object.assign(o, p); created.push('product.update'); return o; },
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

test('stripe setup: creates product, $4.20 monthly and $42 yearly prices, portal and webhook once', async () => {
  const stripe = fakeStripe();
  const first = await setup({ stripe });
  assert.deepEqual(stripe.created, ['product', 'price', 'price', 'portal', 'endpoint']);
  const [product] = stripe.db.products;
  assert.equal(product.name, PRODUCT.name);
  assert.equal(product.description, 'Bloombroke Pro, monthly or yearly subscription: sync across devices, your own ticker tape and a seat number.');
  assert.doesNotMatch(product.description, /alert/i, 'no promise of price alerts');
  const [price, yearly] = stripe.db.prices;
  assert.equal(price.unit_amount, 420);
  assert.equal(price.currency, 'usd');
  assert.deepEqual(price.recurring, { interval: 'month', interval_count: 1 });
  assert.deepEqual(PRICE, { unit_amount: 420, currency: 'usd', interval: 'month' });
  assert.equal(yearly.unit_amount, 4200);
  assert.equal(yearly.currency, 'usd');
  assert.deepEqual(yearly.recurring, { interval: 'year', interval_count: 1 });
  assert.deepEqual(yearly.metadata, { site: 'bloombroke', product: 'pro' });
  assert.deepEqual(PRICE_YEARLY, { unit_amount: 4200, currency: 'usd', interval: 'year' });
  const [ep] = stripe.db.endpoints;
  assert.equal(ep.url, 'https://bloombroke.com/api/stripe/webhook');
  assert.deepEqual(ep.enabled_events, WEBHOOK_EVENTS);
  assert.equal(stripe.db.portals[0].features.subscription_update, undefined, 'no plan switching');
  assert.equal(first.values.STRIPE_PRICE_ID, price.id);
  assert.equal(first.values.STRIPE_PRICE_ID_YEARLY, yearly.id);
  assert.equal(first.values.STRIPE_WEBHOOK_SECRET, 'whsec_created_once');
  assert.ok(first.values.PRO_SECRET.length >= 32);
  assert.ok(!first.report.join('\n').includes('whsec_'), 'the report never shows a secret');
  assert.ok(!first.report.join('\n').includes(price.id));
  assert.ok(first.report.includes('yearly price: created'));

  // Second run, secrets already in the .env: finds everything, creates nothing.
  const second = await setup({ stripe, env: { STRIPE_WEBHOOK_SECRET: 'whsec_created_once', PRO_SECRET: first.values.PRO_SECRET } });
  assert.deepEqual(stripe.created, ['product', 'price', 'price', 'portal', 'endpoint']);
  assert.equal(second.values.STRIPE_PRICE_ID, price.id);
  assert.equal(second.values.STRIPE_PRICE_ID_YEARLY, yearly.id);
  assert.ok(second.report.includes('yearly price: found'));
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

test('stripe setup: an existing product with the old description is updated once', async () => {
  const stripe = fakeStripe();
  stripe.db.products.push({ id: 'prod_old', active: true, name: 'Bloombroke Pro', description: 'Bloombroke Pro, monthly subscription: price alerts and watchlist sync across devices.', metadata: { site: 'bloombroke', product: 'pro' } });
  const first = await setup({ stripe, env: { STRIPE_WEBHOOK_SECRET: 'whsec_x', PRO_SECRET: 'x'.repeat(40) } });
  assert.ok(first.report.includes('product: found, description updated'));
  assert.equal(stripe.db.products.length, 1);
  assert.equal(stripe.db.products[0].description, PRODUCT.description);
  const second = await setup({ stripe, env: { STRIPE_WEBHOOK_SECRET: 'whsec_x', PRO_SECRET: 'x'.repeat(40) } });
  assert.ok(second.report.includes('product: found'));
  assert.equal(stripe.created.filter((c) => c === 'product.update').length, 1, 'idempotent');
});

test('stripe setup: an account with only the monthly price gets the yearly one, once', async () => {
  const stripe = fakeStripe();
  const meta = { site: 'bloombroke', product: 'pro' };
  stripe.db.products.push({ id: 'prod_1', active: true, name: PRODUCT.name, description: PRODUCT.description, metadata: meta });
  stripe.db.prices.push({ id: 'price_month', product: 'prod_1', active: true, unit_amount: 420, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, metadata: meta });
  // Someone else's $42 yearly price on the same product is not ours.
  stripe.db.prices.push({ id: 'price_other', product: 'prod_1', active: true, unit_amount: 4200, currency: 'usd', recurring: { interval: 'year', interval_count: 1 }, metadata: {} });
  const env = { STRIPE_WEBHOOK_SECRET: 'whsec_x', PRO_SECRET: 'x'.repeat(40) };
  const first = await setup({ stripe, env });
  assert.equal(first.values.STRIPE_PRICE_ID, 'price_month');
  assert.ok(first.values.STRIPE_PRICE_ID_YEARLY && first.values.STRIPE_PRICE_ID_YEARLY !== 'price_other');
  assert.equal(stripe.created.filter((c) => c === 'price').length, 1);
  const second = await setup({ stripe, env });
  assert.equal(second.values.STRIPE_PRICE_ID_YEARLY, first.values.STRIPE_PRICE_ID_YEARLY);
  assert.equal(stripe.created.filter((c) => c === 'price').length, 1, 'idempotent');
});

test('stripe setup: test mode writes the _TEST name for the yearly price', async () => {
  const { stripeEnv } = await import('../pro/billing.js');
  assert.equal(stripeEnv({ STRIPE_MODE: 'test' }).names.priceIdYearly, 'STRIPE_PRICE_ID_YEARLY_TEST');
  assert.equal(stripeEnv({}).names.priceIdYearly, 'STRIPE_PRICE_ID_YEARLY');
  assert.equal(stripeEnv({ STRIPE_MODE: 'test', STRIPE_PRICE_ID_YEARLY_TEST: ' price_y ' }).priceIdYearly, 'price_y');
  assert.equal(stripeEnv({ STRIPE_MODE: 'test', STRIPE_PRICE_ID_YEARLY: 'price_live_y' }).priceIdYearly, null, 'the live name is not read in test mode');
});
