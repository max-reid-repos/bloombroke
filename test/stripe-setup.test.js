import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, upsertEnv, describePrice, PRODUCT, PRICE, PRICE_YEARLY } from '../scripts/stripe-setup.js';
import { WEBHOOK_EVENTS } from '../pro/billing.js';

// An in-memory Stripe with just the calls the setup script makes.
function fakeStripe() {
  const db = { products: [], prices: [], portals: [], endpoints: [], subscriptions: [] };
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
      async update(pid, p) { const o = db.prices.find((x) => x.id === pid); Object.assign(o, p); created.push(`price.update:${pid}`); return o; },
    },
    subscriptions: {
      list: ({ price, status }) => {
        assert.equal(status, 'all');
        return db.subscriptions.filter((s) => s.items.data.some((it) => it.price.id === price));
      },
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

test('stripe setup: creates product, $42 monthly and $420 yearly prices, portal and webhook once', async () => {
  const stripe = fakeStripe();
  const first = await setup({ stripe });
  assert.deepEqual(stripe.created, ['product', 'price', 'price', 'portal', 'endpoint']);
  const [product] = stripe.db.products;
  assert.equal(product.name, PRODUCT.name);
  assert.equal(product.description, 'Bloombroke Pro, monthly or yearly subscription: sync across devices, your own ticker tape and a seat number.');
  assert.doesNotMatch(product.description, /alert/i, 'no promise of price alerts');
  const [price, yearly] = stripe.db.prices;
  assert.equal(price.unit_amount, 4200);
  assert.equal(price.currency, 'usd');
  assert.deepEqual(price.recurring, { interval: 'month', interval_count: 1 });
  assert.deepEqual(PRICE, { unit_amount: 4200, currency: 'usd', interval: 'month' });
  assert.equal(yearly.unit_amount, 42000);
  assert.equal(yearly.currency, 'usd');
  assert.deepEqual(yearly.recurring, { interval: 'year', interval_count: 1 });
  assert.deepEqual(yearly.metadata, { site: 'bloombroke', product: 'pro' });
  assert.deepEqual(PRICE_YEARLY, { unit_amount: 42000, currency: 'usd', interval: 'year' });
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
  stripe.db.prices.push({ id: 'price_month', product: 'prod_1', active: true, unit_amount: 4200, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, metadata: meta });
  // Someone else's $420 yearly price on the same product is not ours.
  stripe.db.prices.push({ id: 'price_other', product: 'prod_1', active: true, unit_amount: 42000, currency: 'usd', recurring: { interval: 'year', interval_count: 1 }, metadata: {} });
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

test('stripe setup: a price change makes new prices, archives old ones nobody is on, keeps the rest', async () => {
  const stripe = fakeStripe();
  const meta = { site: 'bloombroke', product: 'pro' };
  const env = { STRIPE_WEBHOOK_SECRET: 'whsec_x', PRO_SECRET: 'x'.repeat(40) };
  stripe.db.products.push({ id: 'prod_1', active: true, name: PRODUCT.name, description: PRODUCT.description, metadata: meta });
  const recurring = (interval) => ({ interval, interval_count: 1 });
  // The old $4.20 a month (one live subscriber, one cancelled) and $42 a year (only a cancelled one).
  stripe.db.prices.push({ id: 'price_old_m', product: 'prod_1', active: true, unit_amount: 420, currency: 'usd', recurring: recurring('month'), metadata: meta });
  stripe.db.prices.push({ id: 'price_old_y', product: 'prod_1', active: true, unit_amount: 4200, currency: 'usd', recurring: recurring('year'), metadata: meta });
  // Someone else's price on the same account is never touched.
  stripe.db.prices.push({ id: 'price_other', product: 'prod_1', active: true, unit_amount: 999, currency: 'usd', recurring: recurring('month'), metadata: {} });
  const onPrice = (id, status) => ({ id: `sub_${id}_${status}`, status, items: { data: [{ price: { id } }] } });
  stripe.db.subscriptions.push(onPrice('price_old_m', 'active'), onPrice('price_old_m', 'canceled'), onPrice('price_old_y', 'canceled'));

  const first = await setup({ stripe, env });
  const [month, year] = stripe.db.prices.slice(3);
  assert.equal(month.unit_amount, 4200);
  assert.equal(month.recurring.interval, 'month');
  assert.equal(year.unit_amount, 42000);
  assert.equal(year.recurring.interval, 'year');
  assert.equal(first.values.STRIPE_PRICE_ID, month.id, 'the $42 monthly price, not the $42 yearly one');
  assert.equal(first.values.STRIPE_PRICE_ID_YEARLY, year.id);
  assert.ok(first.report.includes('price: created'));
  assert.ok(first.report.includes('yearly price: created'));
  assert.ok(first.report.includes('old price $4.20 a month: kept, 1 subscription still on it'));
  assert.ok(first.report.includes('old price $42 a year: archived'));
  assert.equal(stripe.db.prices.find((p) => p.id === 'price_old_m').active, true, 'grandfathered subscribers keep billing');
  assert.equal(stripe.db.prices.find((p) => p.id === 'price_old_y').active, false);
  assert.equal(stripe.db.prices.find((p) => p.id === 'price_other').active, true);
  assert.deepEqual(stripe.created.filter((c) => c.startsWith('price.update')), ['price.update:price_old_y']);
  assert.ok(!first.report.join('\n').includes('price_'), 'the report shows amounts, never ids');

  // Run again: nothing new is made; the old monthly price is still kept while its subscriber is on it.
  const second = await setup({ stripe, env });
  assert.equal(second.values.STRIPE_PRICE_ID, month.id);
  assert.equal(second.values.STRIPE_PRICE_ID_YEARLY, year.id);
  assert.equal(stripe.created.filter((c) => c === 'price').length, 2);
  assert.ok(second.report.includes('old price $4.20 a month: kept, 1 subscription still on it'));
  // Once the last subscriber has gone, the next run archives it.
  stripe.db.subscriptions[0].status = 'canceled';
  const third = await setup({ stripe, env });
  assert.ok(third.report.includes('old price $4.20 a month: archived'));
  assert.equal(stripe.db.prices.find((p) => p.id === 'price_old_m').active, false);
});

test('stripe setup: price report text', () => {
  assert.equal(describePrice({ unit_amount: 420, currency: 'usd', recurring: { interval: 'month' } }), '$4.20 a month');
  assert.equal(describePrice({ unit_amount: 42000, currency: 'usd', recurring: { interval: 'year' } }), '$420 a year');
});

test('stripe setup: two of our prices with the same amount and interval: one is used, the spare is archived only if nobody is on it', async () => {
  const meta = { site: 'bloombroke', product: 'pro' };
  const env = { STRIPE_WEBHOOK_SECRET: 'whsec_x', PRO_SECRET: 'x'.repeat(40) };
  const recurring = (interval) => ({ interval, interval_count: 1 });
  const build = () => {
    const stripe = fakeStripe();
    stripe.db.products.push({ id: 'prod_1', active: true, name: PRODUCT.name, description: PRODUCT.description, metadata: meta });
    stripe.db.prices.push({ id: 'price_m1', product: 'prod_1', active: true, unit_amount: 4200, currency: 'usd', recurring: recurring('month'), metadata: meta });
    stripe.db.prices.push({ id: 'price_m2', product: 'prod_1', active: true, unit_amount: 4200, currency: 'usd', recurring: recurring('month'), metadata: meta });
    stripe.db.prices.push({ id: 'price_y1', product: 'prod_1', active: true, unit_amount: 42000, currency: 'usd', recurring: recurring('year'), metadata: meta });
    return stripe;
  };
  // Nobody on the spare: it is archived, nothing is created.
  const a = build();
  const ra = await setup({ stripe: a, env });
  assert.equal(ra.values.STRIPE_PRICE_ID, 'price_m1');
  assert.equal(ra.values.STRIPE_PRICE_ID_YEARLY, 'price_y1');
  assert.equal(a.created.filter((c) => c === 'price').length, 0);
  assert.ok(ra.report.includes('old price $42 a month: archived'));
  assert.equal(a.db.prices.find((p) => p.id === 'price_m2').active, false);
  assert.equal(a.db.prices.find((p) => p.id === 'price_m1').active, true);
  // Someone on the spare: it stays, and so does the one in use.
  const b = build();
  b.db.subscriptions.push({ id: 'sub_1', status: 'active', items: { data: [{ price: { id: 'price_m2' } }] } });
  const rb = await setup({ stripe: b, env });
  assert.equal(rb.values.STRIPE_PRICE_ID, 'price_m1');
  assert.ok(rb.report.includes('old price $42 a month: kept, 1 subscription still on it'));
  assert.ok(b.db.prices.every((p) => p.active));
});

test('stripe setup: more than 100 subscribers on an old price are all counted (paged list)', async () => {
  const meta = { site: 'bloombroke', product: 'pro' };
  const env = { STRIPE_WEBHOOK_SECRET: 'whsec_x', PRO_SECRET: 'x'.repeat(40) };
  const stripe = fakeStripe();
  stripe.db.products.push({ id: 'prod_1', active: true, name: PRODUCT.name, description: PRODUCT.description, metadata: meta });
  stripe.db.prices.push({ id: 'price_old_m', product: 'prod_1', active: true, unit_amount: 420, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, metadata: meta });
  // 130 cancelled first, then 120 live: a check of only the first page of 100 would archive it.
  const rows = [
    ...Array.from({ length: 130 }, (_, i) => ({ id: `sub_c${i}`, status: 'canceled', items: { data: [{ price: { id: 'price_old_m' } }] } })),
    ...Array.from({ length: 120 }, (_, i) => ({ id: `sub_l${i}`, status: i % 2 ? 'past_due' : 'active', items: { data: [{ price: { id: 'price_old_m' } }] } })),
  ];
  const pages = [];
  stripe.subscriptions.list = ({ price, status, limit }) => {
    assert.equal(price, 'price_old_m');
    assert.equal(status, 'all');
    return (async function* () {
      for (let at = 0; at < rows.length; at += limit) { pages.push(at); yield* rows.slice(at, at + limit); }
    })();
  };
  const r = await setup({ stripe, env });
  assert.deepEqual(pages, [0, 100, 200]);
  assert.ok(r.report.includes('old price $4.20 a month: kept, 120 subscriptions still on it'));
  assert.equal(stripe.db.prices.find((p) => p.id === 'price_old_m').active, true);
});
