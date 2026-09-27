#!/usr/bin/env node
// ADMIN ONLY. For the day Bloombroke shuts down: cancel every Pro subscription now and
// refund the unused part of the current month, as the PRO screen promises.
//
//   node scripts/shutdown-refunds.js <path/to/.env>                     dry run (default)
//   node scripts/shutdown-refunds.js <path/to/.env> --execute [--live]   really do it
//
// Only subscriptions carrying the Pro metadata (site=bloombroke, product=pro) are touched,
// and only on STRIPE_PRICE_ID or STRIPE_PRICE_ID_YEARLY when those are set, because the
// Stripe account is shared. Monthly and yearly subscriptions are both refunded.
// The dry run prints counts and amounts only: no keys, ids, names or emails.
// Refunds use idempotency keys and skip anything already refunded by this script, so a
// run that stops half way can be run again.

import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStripe, stripeEnv, PRO_METADATA, idOf } from '../pro/billing.js';

export const STATUSES = ['active', 'trialing', 'past_due'];
const SHUTDOWN_TAG = 'bloombroke_shutdown';

// The refund, in the smallest currency unit, for the unused part of a paid period.
// Times in seconds. Rounded down to a whole cent, never below 0, never more than what is
// still refundable (paid minus already refunded).
export function unusedRefund({ amountPaid, periodStart, periodEnd, now, alreadyRefunded = 0 }) {
  const paid = Math.max(0, Math.floor(Number(amountPaid) || 0));
  const left = Math.max(0, paid - Math.max(0, Math.floor(Number(alreadyRefunded) || 0)));
  if (!left || !(periodEnd > periodStart)) return 0;
  let amount;
  if (now <= periodStart) amount = paid;
  else if (now >= periodEnd) amount = 0;
  else amount = Math.floor((paid * (periodEnd - now)) / (periodEnd - periodStart));
  return Math.min(amount, left);
}

// Current period: on subscription items in current API versions, on the subscription in old ones.
export function periodOf(sub) {
  const item = sub?.items?.data?.[0];
  const start = item?.current_period_start ?? sub?.current_period_start;
  const end = item?.current_period_end ?? sub?.current_period_end;
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

// priceId: one price id or a list of them (monthly and yearly); empty means any.
export function isProSubscription(sub, priceId) {
  if (sub?.metadata?.site !== PRO_METADATA.site || sub?.metadata?.product !== PRO_METADATA.product) return false;
  const ids = (Array.isArray(priceId) ? priceId : [priceId]).filter(Boolean);
  if (!ids.length) return true;
  return (sub.items?.data || []).some((it) => ids.includes(idOf(it.price)));
}

export const fmtMoney = (cents, currency = 'usd') => `${(cents / 100).toFixed(2)} ${String(currency).toUpperCase()}`;

async function all(list) {
  const out = [];
  for await (const x of list) out.push(x);
  return out;
}

// What to do for one subscription: { refund, currency, payment, invoiceId, reason }.
async function plan(stripe, sub, now) {
  const period = periodOf(sub);
  const invoiceId = idOf(sub.latest_invoice);
  if (!period || !invoiceId) return { refund: 0, reason: 'no paid period' };
  const inv = await stripe.invoices.retrieve(invoiceId);
  if (inv.status !== 'paid' || !(inv.amount_paid > 0)) return { refund: 0, reason: 'latest invoice not paid', currency: inv.currency };
  const payments = await all(stripe.invoicePayments.list({ invoice: inv.id, limit: 10 }));
  const paid = payments.find((p) => p.status === 'paid');
  const payment = paid && (idOf(paid.payment?.payment_intent) ? { payment_intent: idOf(paid.payment.payment_intent) } : idOf(paid.payment?.charge) ? { charge: idOf(paid.payment.charge) } : null);
  if (!payment) return { refund: 0, reason: 'no payment found', currency: inv.currency };
  const refunds = await all(stripe.refunds.list({ ...payment, limit: 100 }));
  if (refunds.some((r) => r.metadata?.[SHUTDOWN_TAG] === 'true' && r.status !== 'failed' && r.status !== 'canceled')) {
    return { refund: 0, reason: 'already refunded by this script', currency: inv.currency };
  }
  const alreadyRefunded = refunds.filter((r) => r.status === 'succeeded' || r.status === 'pending').reduce((a, r) => a + r.amount, 0);
  const refund = unusedRefund({ amountPaid: inv.amount_paid, periodStart: period.start, periodEnd: period.end, now, alreadyRefunded });
  return { refund, currency: inv.currency, payment, invoiceId: inv.id, daysLeft: Math.max(0, (period.end - now) / 86400) };
}

// Returns a summary. With execute false nothing is changed at Stripe.
export async function run({ stripe, now = Math.floor(Date.now() / 1000), execute = false, priceId = null, log = console.log }) {
  const subs = [];
  for (const status of STATUSES) {
    for (const s of await all(stripe.subscriptions.list({ status, limit: 100 }))) if (isProSubscription(s, priceId)) subs.push(s);
  }
  const summary = { subscriptions: subs.length, byStatus: {}, refunds: 0, refundTotal: 0, canceled: 0, errors: 0, currency: 'usd' };
  let i = 0;
  for (const sub of subs) {
    i += 1;
    summary.byStatus[sub.status] = (summary.byStatus[sub.status] || 0) + 1;
    try {
      const p = await plan(stripe, sub, now);
      if (p.currency) summary.currency = p.currency;
      const days = p.daysLeft === undefined ? '' : `, ${p.daysLeft.toFixed(1)} days left`;
      log(`#${i} ${sub.status}: refund ${fmtMoney(p.refund, p.currency)}${days}${p.reason ? ` (${p.reason})` : ''}`);
      if (execute && p.refund > 0) {
        await stripe.refunds.create(
          { ...p.payment, amount: p.refund, reason: 'requested_by_customer', metadata: { [SHUTDOWN_TAG]: 'true', ...PRO_METADATA } },
          { idempotencyKey: `bb-shutdown-refund-${sub.id}-${p.invoiceId}` },
        );
      }
      if (p.refund > 0) { summary.refunds += 1; summary.refundTotal += p.refund; }
      if (execute) {
        await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false }, { idempotencyKey: `bb-shutdown-cancel-${sub.id}` });
        summary.canceled += 1;
      }
    } catch (err) {
      summary.errors += 1;
      log(`#${i} ${sub.status}: FAILED (${err.message}). Run again to retry.`);
    }
  }
  return summary;
}

async function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const execute = argv.includes('--execute');
  const envPath = args[0] && path.resolve(args[0]);
  if (!envPath || !existsSync(envPath)) {
    console.error('Usage: node scripts/shutdown-refunds.js <path/to/.env> [--execute] [--live]');
    return 1;
  }
  const env = parseEnv(readFileSync(envPath, 'utf8'));
  const se = stripeEnv(env);
  if (se.error) { console.error(se.error); return 1; }
  if (!se.secretKey) { console.error(`${se.names.secretKey} is not in that .env.`); return 1; }
  const { mode } = se;
  console.log(`stripe mode: ${mode}. ${execute ? 'EXECUTE: cancelling and refunding.' : 'Dry run: nothing is changed.'}`);
  if (mode === 'live' && execute && !argv.includes('--live')) { console.error('This is a live key. Add --live to really cancel and refund.'); return 1; }

  const s = await run({ stripe: createStripe(se.secretKey), execute, priceId: [se.priceId, se.priceIdYearly].filter(Boolean) });
  const by = Object.entries(s.byStatus).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  console.log(`subscriptions: ${s.subscriptions} (${by})`);
  console.log(`refunds: ${s.refunds}, total ${fmtMoney(s.refundTotal, s.currency)}${execute ? '' : ' (not sent)'}`);
  if (execute) console.log(`canceled: ${s.canceled}`);
  if (s.errors) console.log(`errors: ${s.errors}`);
  return s.errors ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error('shutdown-refunds failed:', err.message);
    process.exitCode = 1;
  });
}
