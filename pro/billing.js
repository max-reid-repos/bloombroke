// Stripe side of Pro: the pinned client, checkout sessions, and the webhook events.
// Every amount and price comes from the server (STRIPE_PRICE_ID for monthly,
// STRIPE_PRICE_ID_YEARLY for yearly), never from the client. The client only picks the plan.

import Stripe from 'stripe';
import { isDeletedLicence } from './store.js';

export const STRIPE_API_VERSION = '2026-08-26.dahlia';

// The Stripe account is shared with other products, so every object we make carries this
// metadata, and events for anything else are ignored.
export const PRO_METADATA = { site: 'bloombroke', product: 'pro' };

export const DEFAULT_TERMS_VERSION = '2026-09-27';

// STRIPE_MODE=test|live (default live) picks the key set: STRIPE_SECRET_KEY,
// STRIPE_PRICE_ID, STRIPE_PRICE_ID_YEARLY (optional), STRIPE_WEBHOOK_SECRET,
// STRIPE_PORTAL_CONFIG_ID, or the same names with _TEST. A key of the other mode is refused, so a demo can never charge real money and a
// live site never runs on a test key.
export function stripeEnv(env = process.env) {
  const mode = String(env.STRIPE_MODE || '').trim().toLowerCase() === 'test' ? 'test' : 'live';
  const sfx = mode === 'test' ? '_TEST' : '';
  const get = (k) => (env[k + sfx] || '').trim() || null;
  let secretKey = get('STRIPE_SECRET_KEY');
  let error = null;
  if (secretKey && !new RegExp(`^(sk|rk)_${mode}_`).test(secretKey)) {
    error = `STRIPE_MODE is ${mode} but STRIPE_SECRET_KEY${sfx} is not a ${mode} key`;
    secretKey = null;
  }
  return {
    mode, error, secretKey,
    priceId: get('STRIPE_PRICE_ID'),
    priceIdYearly: get('STRIPE_PRICE_ID_YEARLY'),
    webhookSecret: get('STRIPE_WEBHOOK_SECRET'),
    portalConfigId: get('STRIPE_PORTAL_CONFIG_ID'),
    names: {
      secretKey: `STRIPE_SECRET_KEY${sfx}`, priceId: `STRIPE_PRICE_ID${sfx}`, priceIdYearly: `STRIPE_PRICE_ID_YEARLY${sfx}`,
      webhookSecret: `STRIPE_WEBHOOK_SECRET${sfx}`, portalConfigId: `STRIPE_PORTAL_CONFIG_ID${sfx}`,
    },
  };
}

export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
];

export function createStripe(secretKey) {
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20_000 });
}

export const idOf = (v) => (typeof v === 'string' ? v : v && typeof v.id === 'string' ? v.id : null);

export function isProSession(s) {
  return Boolean(s && s.mode === 'subscription' && s.metadata?.site === PRO_METADATA.site && s.metadata?.product === PRO_METADATA.product);
}

// Paid and complete: the only state in which a session earns a licence.
export function isPaidSession(s) {
  return isProSession(s) && s.status === 'complete' && s.payment_status === 'paid' && Boolean(idOf(s.subscription));
}

export const TERMS_MESSAGE = 'I agree to the [Terms](https://bloombroke.com/terms) and understand Bloombroke gives information only, not investment advice.';
export const SUBMIT_MESSAGE = 'Auto-renews monthly at $42 USD. Cancel any time: type ME and press CANCEL; access continues to the end of the paid month.';
export const SUBMIT_MESSAGE_YEARLY = 'Auto-renews yearly at $420 USD. Cancel any time: type ME and press CANCEL; access continues to the end of the paid year.';

// The plans a buyer can pick. The price id for each comes from the environment.
export const PLANS = { month: { cents: 4200 }, year: { cents: 42000 } };

// licence: set for REACTIVATE, so the new subscription lands on the same licence and
// the same Stripe customer. interval: 'month' (default) or 'year'; priceId must be the
// price for that interval.
export function checkoutParams({ priceId, publicUrl, licence = null, interval = 'month' }) {
  const base = publicUrl.replace(/\/+$/, '');
  const metadata = licence ? { ...PRO_METADATA, licence_id: String(licence.id) } : { ...PRO_METADATA };
  const params = {
    mode: 'subscription',
    // Cards only: a delayed payment method could complete checkout unpaid.
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/?c=PRO&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?c=PRO`,
    allow_promotion_codes: false,
    automatic_tax: { enabled: false },
    // The buyer must tick the Terms box. Stripe needs a Terms of service URL in the
    // account's public details for this.
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      terms_of_service_acceptance: { message: TERMS_MESSAGE },
      submit: { message: interval === 'year' ? SUBMIT_MESSAGE_YEARLY : SUBMIT_MESSAGE },
    },
    metadata,
    subscription_data: { metadata: { ...metadata } },
  };
  if (licence) {
    params.client_reference_id = String(licence.id);
    if (licence.stripe_customer_id) params.customer = licence.stripe_customer_id;
  }
  return params;
}

// The licence a REACTIVATE checkout belongs to, or null for a new purchase.
export function reactivateLicenceId(session) {
  const ref = session?.client_reference_id;
  return typeof ref === 'string' && /^[1-9]\d{0,15}$/.test(ref) && session.metadata?.licence_id === ref ? Number(ref) : null;
}

// Invoices name their subscription under parent.subscription_details on current API
// versions; older payloads had invoice.subscription.
export function invoiceSubscriptionId(inv) {
  return idOf(inv?.parent?.subscription_details?.subscription) || idOf(inv?.subscription);
}

// Make (or find) the licence for a paid checkout session. Used by the webhook and by the
// success page, whichever runs first. The subscription status is read fresh from Stripe.
// Returns { licence, created, key } (key only when this call created it) or null.
// When the buyer agreed to the Terms: Checkout records consent.terms_of_service as
// 'accepted' without a time, so the time is the completion event's (or now, from the
// success page). null when there was no consent.
export function termsAcceptedAt(session, at = Date.now()) {
  return session?.consent?.terms_of_service === 'accepted' ? at : null;
}

export async function licenceFromSession(session, { store, stripe, log = console, at = Date.now(), termsVersion = DEFAULT_TERMS_VERSION }) {
  if (!isPaidSession(session)) return null;
  const subId = idOf(session.subscription);
  const sub = await stripe.subscriptions.retrieve(subId);
  const accepted = termsAcceptedAt(session, at);
  const licenceId = reactivateLicenceId(session);
  // A licence deleted in ME since this checkout opened is no target: a new licence is made.
  const found = licenceId ? store.findById(licenceId) : null;
  const target = found && !isDeletedLicence(found) ? found : null;
  // Already known (a resent event, a reloaded success page): only the status is read
  // again below. Nothing is cancelled or refunded, and no licence moves.
  const known = Boolean(store.findBySubscription(subId) || store.findBySession(session.id));
  if (!known && target) {
    // A REACTIVATE session whose own subscription has ended (it lost a two-tab race, or
    // was cancelled): the licence stays where it is. No Stripe calls.
    if (ENDED.has(sub.status)) return { licence: target, created: false, reactivated: true, stale: true };
    // REACTIVATE: the licence's old subscription must not keep billing next to the new
    // one. Checkout already refuses while one is live; this is the backstop, for two
    // tabs that each finished a checkout (a gift or demo licence has no customer to
    // check against yet). The subscription started last is kept; the other one's
    // latest payment is refunded in full, then it is cancelled. Done before the licence
    // moves, so a failure here makes Stripe (or the success page) try again.
    const prevId = target.stripe_subscription_id;
    const prevSub = prevId && prevId !== subId ? await retrieveOrNull(stripe, prevId) : null;
    if (prevSub && !ENDED.has(prevSub.status)) {
      if (startedAfter(prevSub, sub)) {
        // The licence already has the later one (events came out of order): this
        // session's subscription is the duplicate.
        await refundAndCancel(stripe, sub);
        return { licence: target, created: false, reactivated: true, duplicate: true };
      }
      await refundAndCancel(stripe, prevSub);
    }
  }
  const out = store.ensureLicence({
    sessionId: session.id,
    customerId: idOf(session.customer) || idOf(sub.customer),
    subscriptionId: subId,
    status: sub.status,
    termsAcceptedAt: accepted,
    termsVersion,
    licenceId,
    livemode: typeof session.livemode === 'boolean' ? session.livemode : null,
  });
  out.licence = store.setBilling(out.licence.id, billingOf(sub));
  if (out.created || out.reactivated) {
    // Only the last 4 characters go to Stripe, so the dashboard can match a customer to a key.
    const metadata = { ...PRO_METADATA, licence_last4: out.licence.last4 };
    if (accepted) {
      metadata.terms_accepted_at = new Date(accepted).toISOString();
      metadata.terms_version = termsVersion;
    }
    try {
      await stripe.subscriptions.update(subId, { metadata });
    } catch (err) {
      log.error('[pro] could not tag subscription with licence last4:', err.message);
    }
  }
  return out;
}

// Renewal facts of a subscription, times in ms. The period end sits on the items in
// current API versions and on the subscription in older ones. interval: 'month' or
// 'year' from the item's price (or its legacy plan), null when it is something else.
export function billingOf(sub) {
  const item = sub?.items?.data?.[0];
  const end = item?.current_period_end ?? sub?.current_period_end;
  const every = item?.price?.recurring?.interval ?? item?.plan?.interval ?? null;
  const count = item?.price?.recurring?.interval_count ?? item?.plan?.interval_count ?? 1;
  return {
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
    currentPeriodEnd: Number.isFinite(end) ? end * 1000 : null,
    cancelAt: Number.isFinite(sub?.cancel_at) ? sub.cancel_at * 1000 : null,
    interval: (every === 'month' || every === 'year') && count === 1 ? every : null,
  };
}

const ENDED = new Set(['canceled', 'incomplete_expired']);

async function listAll(list) {
  const out = [];
  for await (const x of list) out.push(x);
  return out;
}

// Refund what is left of a subscription's latest paid invoice, in full. Idempotent: the
// key names the invoice, and what was refunded before is taken off. Returns the amount
// refunded (0 when there is nothing to refund).
export async function refundLatestInvoice(stripe, sub) {
  const invoiceId = idOf(sub?.latest_invoice);
  if (!invoiceId) return 0;
  const inv = await stripe.invoices.retrieve(invoiceId);
  if (inv.status !== 'paid' || !(inv.amount_paid > 0)) return 0;
  const payments = await listAll(stripe.invoicePayments.list({ invoice: inv.id, limit: 10 }));
  const paid = payments.find((p) => p.status === 'paid');
  const pi = idOf(paid?.payment?.payment_intent);
  const charge = idOf(paid?.payment?.charge);
  const payment = pi ? { payment_intent: pi } : charge ? { charge } : null;
  if (!payment) return 0;
  const refunds = await listAll(stripe.refunds.list({ ...payment, limit: 100 }));
  const done = refunds.filter((r) => r.status === 'succeeded' || r.status === 'pending').reduce((a, r) => a + r.amount, 0);
  const amount = inv.amount_paid - done;
  if (amount <= 0) return 0;
  await stripe.refunds.create(
    { ...payment, amount, reason: 'duplicate', metadata: { ...PRO_METADATA, bloombroke_duplicate: 'true' } },
    { idempotencyKey: `bb-duplicate-refund-${sub.id}-${inv.id}` },
  );
  return amount;
}

// refund: also refund the subscription's latest payment before cancelling it (the
// duplicate of a two-tab checkout). Refund first, so a failure leaves it live and the
// retry does both.
// a started strictly after b (Stripe's created, in seconds). Equal or unknown: no.
export const startedAfter = (a, b) => Number.isFinite(a?.created) && Number.isFinite(b?.created) && a.created > b.created;

async function retrieveOrNull(stripe, subId) {
  try {
    return await stripe.subscriptions.retrieve(subId);
  } catch (err) {
    if (err?.statusCode === 404 || err?.code === 'resource_missing') return null;
    throw err;
  }
}

// The duplicate of a two-tab checkout: refund its latest payment, then cancel it. Refund
// first, so a failure leaves it live and the retry does both. Both calls are idempotent.
export async function refundAndCancel(stripe, sub) {
  await refundLatestInvoice(stripe, sub);
  await stripe.subscriptions.cancel(sub.id, {}, { idempotencyKey: `bb-reactivate-cancel-${sub.id}` });
}

export async function cancelIfLive(stripe, subId, { refund = false } = {}) {
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(subId);
  } catch (err) {
    if (err?.statusCode === 404 || err?.code === 'resource_missing') return 'missing';
    throw err;
  }
  if (ENDED.has(sub.status)) return 'already';
  if (refund) await refundLatestInvoice(stripe, sub);
  await stripe.subscriptions.cancel(subId, {}, { idempotencyKey: `bb-reactivate-cancel-${subId}` });
  return 'canceled';
}

async function refreshStatus(subId, { store, stripe }, { deleted = false } = {}) {
  if (!subId) return 'ignored';
  const lic = store.findBySubscription(subId);
  if (!lic) return 'ignored'; // not a Pro subscription, or its checkout event has not come in yet
  // Events can arrive out of order, so the status is read from Stripe, not the payload.
  if (deleted) {
    store.setStatus(lic.id, 'canceled');
    return 'updated';
  }
  const sub = await stripe.subscriptions.retrieve(subId);
  store.setStatus(lic.id, sub.status);
  store.setBilling(lic.id, billingOf(sub));
  return 'updated';
}

// Handle one verified event. Throws on a transient failure so Stripe retries; the event
// is only recorded as processed after it succeeded.
export async function handleEvent(event, deps) {
  const { store } = deps;
  if (store.isEventProcessed(event.id)) return 'duplicate';
  const obj = event.data?.object;
  let result = 'ignored';
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      result = (await licenceFromSession(obj, { ...deps, at: Number.isFinite(event.created) ? event.created * 1000 : Date.now() })) ? 'licence' : 'ignored';
      break;
    case 'customer.subscription.updated':
      result = await refreshStatus(idOf(obj), deps);
      break;
    case 'customer.subscription.deleted':
      result = await refreshStatus(idOf(obj), deps, { deleted: true });
      break;
    case 'invoice.payment_failed':
      // Stripe moves the subscription to past_due; the fresh status records that.
      result = await refreshStatus(invoiceSubscriptionId(obj), deps);
      break;
    default:
      break;
  }
  store.markEventProcessed(event.id, event.type);
  return result;
}
