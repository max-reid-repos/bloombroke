import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unusedRefund, periodOf, isProSubscription, run, fmtMoney } from '../scripts/shutdown-refunds.js';

const DAY = 86400;
const START = 1_790_000_000;
const END = START + 30 * DAY;

test('proration: the unused part of the period, in whole cents, rounded down', () => {
  const r = (now, extra = {}) => unusedRefund({ amountPaid: 420, periodStart: START, periodEnd: END, now, ...extra });
  assert.equal(r(START), 420, 'nothing used yet');
  assert.equal(r(START - 10), 420, 'before the period');
  assert.equal(r(END), 0, 'period over');
  assert.equal(r(END + 10), 0);
  assert.equal(r(START + 15 * DAY), 210, 'half way');
  assert.equal(r(START + 10 * DAY), 280, 'a third used');
  assert.equal(r(START + 29 * DAY), 14, '1 of 30 days left');
  assert.equal(r(START + 1), 419, '419.99... rounds down');
  assert.equal(r(START + 15 * DAY, { alreadyRefunded: 300 }), 120, 'never more than is still refundable');
  assert.equal(r(START + 15 * DAY, { alreadyRefunded: 500 }), 0);
  assert.equal(unusedRefund({ amountPaid: 0, periodStart: START, periodEnd: END, now: START }), 0);
  assert.equal(unusedRefund({ amountPaid: 420, periodStart: END, periodEnd: START, now: START }), 0, 'bad period');
  assert.equal(unusedRefund({ amountPaid: -5, periodStart: START, periodEnd: END, now: START }), 0);
  // Never negative, never more than paid, for any moment.
  for (let t = START - DAY; t <= END + DAY; t += 3571) {
    const v = r(t);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 420, `${t}: ${v}`);
  }
  assert.equal(fmtMoney(210, 'usd'), '2.10 USD');
});

test('period and Pro filter', () => {
  assert.deepEqual(periodOf({ items: { data: [{ current_period_start: 1, current_period_end: 2 }] } }), { start: 1, end: 2 });
  assert.deepEqual(periodOf({ current_period_start: 3, current_period_end: 4, items: { data: [] } }), { start: 3, end: 4 });
  assert.equal(periodOf({}), null);
  const pro = { metadata: { site: 'bloombroke', product: 'pro' }, items: { data: [{ price: { id: 'price_pro' } }] } };
  assert.equal(isProSubscription(pro), true);
  assert.equal(isProSubscription(pro, 'price_pro'), true);
  assert.equal(isProSubscription(pro, 'price_other'), false);
  assert.equal(isProSubscription({ metadata: { site: 'trackmyage' }, items: { data: [] } }), false);
});

function fakeStripe(now) {
  const calls = [];
  const sub = (id, status, extra = {}) => ({
    id, status, metadata: { site: 'bloombroke', product: 'pro' }, latest_invoice: `in_${id}`,
    items: { data: [{ price: { id: 'price_pro' }, current_period_start: now - 15 * DAY, current_period_end: now + 15 * DAY }] }, ...extra,
  });
  const subs = {
    active: [sub('s1', 'active'), sub('s2', 'active'), sub('x1', 'active', { metadata: { site: 'trackmyage' } })],
    trialing: [],
    past_due: [sub('s3', 'past_due')],
  };
  const invoices = {
    in_s1: { id: 'in_s1', status: 'paid', amount_paid: 420, currency: 'usd' },
    in_s2: { id: 'in_s2', status: 'paid', amount_paid: 420, currency: 'usd' },
    in_s3: { id: 'in_s3', status: 'open', amount_paid: 0, currency: 'usd' },
  };
  const refunds = { pi_s2: [{ amount: 210, status: 'succeeded', metadata: { bloombroke_shutdown: 'true' } }] };
  return {
    calls,
    subscriptions: {
      list: ({ status }) => subs[status],
      async cancel(id, params, opts) { calls.push(['cancel', id, params, opts]); return {}; },
    },
    invoices: { async retrieve(id) { return invoices[id]; } },
    invoicePayments: { list: ({ invoice }) => [{ status: 'paid', payment: { payment_intent: `pi_${invoice.slice(3)}` } }] },
    refunds: {
      list: ({ payment_intent }) => refunds[payment_intent] || [],
      async create(p, opts) { calls.push(['refund', p, opts]); return {}; },
    },
  };
}

test('shutdown: dry run changes nothing and prints no ids', async () => {
  const now = START + 15 * DAY;
  const stripe = fakeStripe(now);
  const lines = [];
  const s = await run({ stripe, now, log: (l) => lines.push(l) });
  assert.deepEqual(stripe.calls, []);
  assert.equal(s.subscriptions, 3, 'the other product is left alone');
  assert.deepEqual(s.byStatus, { active: 2, past_due: 1 });
  assert.equal(s.refunds, 1, 's2 was already refunded by an earlier run, s3 never paid');
  assert.equal(s.refundTotal, 210);
  assert.ok(lines.every((l) => !/s1|s2|s3|pi_|in_/.test(l)), lines.join('\n'));
});

test('shutdown: execute refunds with idempotency keys, then cancels now', async () => {
  const now = START + 15 * DAY;
  const stripe = fakeStripe(now);
  const s = await run({ stripe, now, execute: true, priceId: 'price_pro', log: () => {} });
  const refunds = stripe.calls.filter((c) => c[0] === 'refund');
  assert.equal(refunds.length, 1);
  assert.deepEqual(refunds[0][1], { payment_intent: 'pi_s1', amount: 210, reason: 'requested_by_customer', metadata: { bloombroke_shutdown: 'true', site: 'bloombroke', product: 'pro' } });
  assert.equal(refunds[0][2].idempotencyKey, 'bb-shutdown-refund-s1-in_s1');
  const cancels = stripe.calls.filter((c) => c[0] === 'cancel').map((c) => c[1]);
  assert.deepEqual(cancels, ['s1', 's2', 's3']);
  assert.deepEqual(stripe.calls.find((c) => c[0] === 'cancel')[2], { invoice_now: false, prorate: false });
  assert.equal(s.canceled, 3);
  assert.equal(s.errors, 0);
});

test('shutdown: yearly subscriptions are refunded too (monthly and yearly price ids)', () => {
  const meta = { site: 'bloombroke', product: 'pro' };
  const yearly = { metadata: meta, items: { data: [{ price: { id: 'price_year' } }] } };
  const monthly = { metadata: meta, items: { data: [{ price: 'price_month' }] } };
  const ids = ['price_month', 'price_year'];
  assert.equal(isProSubscription(yearly, ids), true);
  assert.equal(isProSubscription(monthly, ids), true);
  assert.equal(isProSubscription({ metadata: meta, items: { data: [{ price: { id: 'price_x' } }] } }, ids), false);
  assert.equal(isProSubscription(yearly, []), true, 'no ids: any Pro subscription');
  // A year paid, a quarter used: three quarters back.
  assert.equal(unusedRefund({ amountPaid: 4200, periodStart: 0, periodEnd: 400, now: 100 }), 3150);
});
