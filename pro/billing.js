// Stripe side of Pro: the pinned client, checkout sessions, and the webhook events.
// Every amount and price comes from the server (STRIPE_PRICE_ID), never from the client.

import Stripe from 'stripe';

export const STRIPE_API_VERSION = '2026-08-26.dahlia';

// The Stripe account is shared with other products, so every object we make carries this
// metadata, and events for anything else are ignored.
export const PRO_METADATA = { site: 'bloombroke', product: 'pro' };

export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
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
export const SUBMIT_MESSAGE = 'Auto-renews monthly at $4.20 USD. Cancel any time in MANAGE; access continues to the end of the paid month.';

export function checkoutParams({ priceId, publicUrl }) {
  const base = publicUrl.replace(/\/+$/, '');
  return {
    mode: 'subscription',
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
      submit: { message: SUBMIT_MESSAGE },
    },
    metadata: { ...PRO_METADATA },
    subscription_data: { metadata: { ...PRO_METADATA } },
  };
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

export async function licenceFromSession(session, { store, stripe, log = console, at = Date.now() }) {
  if (!isPaidSession(session)) return null;
  const subId = idOf(session.subscription);
  const sub = await stripe.subscriptions.retrieve(subId);
  const accepted = termsAcceptedAt(session, at);
  const out = store.ensureLicence({
    sessionId: session.id,
    customerId: idOf(session.customer) || idOf(sub.customer),
    subscriptionId: subId,
    status: sub.status,
    termsAcceptedAt: accepted,
  });
  if (out.created) {
    // Only the last 4 characters go to Stripe, so the dashboard can match a customer to a key.
    const metadata = { ...PRO_METADATA, licence_last4: out.licence.last4 };
    if (accepted) metadata.terms_accepted_at = new Date(accepted).toISOString();
    try {
      await stripe.subscriptions.update(subId, { metadata });
    } catch (err) {
      log.error('[pro] could not tag subscription with licence last4:', err.message);
    }
  }
  return out;
}

async function refreshStatus(subId, { store, stripe }, { deleted = false } = {}) {
  if (!subId) return 'ignored';
  const lic = store.findBySubscription(subId);
  if (!lic) return 'ignored'; // not a Pro subscription, or its checkout event has not come in yet
  // Events can arrive out of order, so the status is read from Stripe, not the payload.
  const status = deleted ? 'canceled' : (await stripe.subscriptions.retrieve(subId)).status;
  store.setStatus(lic.id, status);
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
