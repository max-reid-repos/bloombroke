// Pro HTTP routes. Mounted from server.js with mountPro(app, deps), before any JSON body
// parser, because the webhook needs the raw body for its signature.
//
//   POST /api/stripe/webhook   Stripe events (signature checked)
//   GET  /api/pro/config       -> { mode: live|test, open, yearly }
//   POST /api/pro/checkout     { plan?: month|year } -> { url } of a Stripe Checkout Session
//   POST /api/pro/checkout     with X-Pro-Key: REACTIVATE on the same licence
//   POST /api/pro/claim        { session_id } -> the new key, once paid, for 24 hours
//   POST /api/pro/claim/confirm   X-Pro-Key, { session_id }: the browser saved it, forget it
//   POST /api/pro/login        { key } -> status
//   GET  /api/pro/status       X-Pro-Key -> status
//   POST /api/pro/portal       X-Pro-Key -> { url } of the Stripe Billing Portal
//   GET  /api/pro/sync         X-Pro-Key -> { docs }
//   PUT  /api/pro/sync         X-Pro-Key, { docs } -> { docs }   (64 KB cap, last write wins)
//   GET  /api/pro/gifts        X-Pro-Key -> { gifts, left, canGift }
//   POST /api/pro/gifts        X-Pro-Key -> { code, gift }   (a paid, active licence; 3 at most)
//   POST /api/pro/redeem       { code } -> a new 30 day licence: { key, ...status }, once
//
// A seat number goes out with the status, for display. It is never read back as a
// credential: every route that needs a licence takes the key.

import express from 'express';
import { normalizeKey, normalizeGiftCode, proAccess, isGiftLicence, ACTIVE_STATUSES } from './licence.js';
import { MAX_SYNC_BYTES, SyncError, GiftError } from './store.js';
import {
  checkoutParams, handleEvent, isProSession, isPaidSession, licenceFromSession, idOf, PRO_METADATA, DEFAULT_TERMS_VERSION, PLANS,
} from './billing.js';
import { createLimiter, clientIp } from './ratelimit.js';

export const KEY_HEADER = 'x-pro-key';
export const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,250}$/;
const MIN = 60 * 1000;
// A subscription in one of these can still bill or give access: no second purchase.
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);
const ALREADY_ACTIVE = 'Pro is already active on this key, so there is nothing to buy. Use MANAGE to change your card.';
const isProObject = (o) => o?.metadata?.site === PRO_METADATA.site && o?.metadata?.product === PRO_METADATA.product;

export function defaultLimits(now) {
  return {
    checkout: createLimiter({ max: 10, windowMs: 10 * MIN, now }),
    claim: createLimiter({ max: 30, windowMs: 10 * MIN, now }),
    login: createLimiter({ max: 10, windowMs: 15 * MIN, now }),
    guess: createLimiter({ max: 20, windowMs: 15 * MIN, now }),
    portal: createLimiter({ max: 10, windowMs: 10 * MIN, now }),
    sync: createLimiter({ max: 120, windowMs: 10 * MIN, now }),
    // Every REDEEM try counts, right or wrong, per IP.
    redeem: createLimiter({ max: 10, windowMs: 15 * MIN, now }),
    gift: createLimiter({ max: 20, windowMs: 10 * MIN, now }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What the client may see about a licence.
// mode: the site's Stripe mode. A licence from a test (demo) checkout gives no Pro on
// the live site; live licences keep working in test mode (they were paid for).
export function publicStatus(lic, now, mode = 'live') {
  if (lic && mode === 'live' && lic.livemode === 0) return { active: false, status: 'demo', last4: lic.last4 };
  const a = proAccess(lic, now);
  const out = { active: a.active, status: a.status, last4: a.last4 };
  // Display only: SEAT 00042 in the top bar and on PRO.
  if (Number.isInteger(lic?.seat)) out.seat = lic.seat;
  if (a.graceUntil) out.graceUntil = new Date(a.graceUntil).toISOString();
  if (a.giftUntil) out.giftUntil = new Date(a.giftUntil).toISOString();
  if (lic?.billing_interval === 'month' || lic?.billing_interval === 'year') out.interval = lic.billing_interval;
  out.canGift = canGift(lic, a);
  // Renewal: shown as "Renews Oct 26" or "Active until Oct 26 (cancelled, will not renew)".
  if (lic?.cancel_at_period_end !== null && lic?.cancel_at_period_end !== undefined) out.cancelAtPeriodEnd = Boolean(lic.cancel_at_period_end);
  if (Number.isFinite(lic?.current_period_end)) out.currentPeriodEnd = new Date(lic.current_period_end).toISOString();
  if (Number.isFinite(lic?.cancel_at)) out.cancelAt = new Date(lic.cancel_at).toISOString();
  return out;
}

// Gift codes come from paid Pro only: a live subscription that is active or trialing.
// A gift licence, a demo licence on the live site, or a lapsed one cannot make them.
function canGift(lic, access) {
  return Boolean(lic && access.active && !isGiftLicence(lic) && lic.stripe_subscription_id && ACTIVE_STATUSES.has(lic.status));
}

export function mountPro(app, {
  store, stripe = null, config = {}, now = () => Date.now(), loginDelayMs = 300, limits = defaultLimits(now), log = console,
}) {
  const {
    priceId, priceIdYearly = null, webhookSecret, publicUrl = 'https://bloombroke.com', portalConfigId, proSecretSet, mode = 'live', termsVersion = DEFAULT_TERMS_VERSION,
  } = config;
  const priceFor = { month: priceId, year: priceIdYearly };
  const ready = Boolean(stripe && priceId && webhookSecret && proSecretSet);
  const base = publicUrl.replace(/\/+$/, '');

  const fail = (res, status, error, message, extra = {}) => res.status(status).json({ error, message, ...extra });
  const limited = (res, r) => { res.set('Retry-After', String(r.retryAfter)); return fail(res, 429, 'rate_limited', 'Too many tries. Wait a few minutes and try again.'); };
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  // ---- webhook --------------------------------------------------------------
  app.post('/api/stripe/webhook', express.raw({ type: () => true, limit: '1mb' }), noStore, async (req, res) => {
    if (!stripe || !webhookSecret || !proSecretSet) return fail(res, 503, 'not_configured', 'Webhook is not configured.');
    const sig = req.get('stripe-signature');
    if (!sig || !Buffer.isBuffer(req.body)) return fail(res, 400, 'bad_signature', 'Missing signature.');
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch {
      return fail(res, 400, 'bad_signature', 'Signature check failed.');
    }
    try {
      const result = await handleEvent(event, { store, stripe, log, termsVersion });
      res.json({ received: true, result });
    } catch (err) {
      log.error('[stripe webhook]', event.type, event.id, err.message);
      fail(res, 500, 'retry', 'Could not process the event.');
    }
  });

  const pro = express.Router();
  pro.use(noStore);

  // X-Pro-Key -> { lic, status }, { bad: true } (no such key: counts against the
  // wrong-key limit) or { limited } (that limit is hit).
  function keyCheck(req) {
    const ip = clientIp(req);
    if (limits.guess.blocked(ip)) return { limited: limits.guess.hit(ip) };
    const key = normalizeKey(req.get(KEY_HEADER) || '');
    const lic = key ? store.findByKey(key) : null;
    if (!lic) {
      limits.guess.hit(ip);
      return { bad: true };
    }
    return { lic, status: publicStatus(lic, now(), mode) };
  }

  // X-Pro-Key -> { lic, access } or sends the error and returns null.
  function auth(req, res, { requireActive = false } = {}) {
    const k = keyCheck(req);
    if (k.limited) { limited(res, k.limited); return null; }
    if (k.bad) {
      fail(res, 401, 'bad_key', 'That key is not valid. Check it and try LOGIN again.');
      return null;
    }
    if (requireActive && !k.status.active) {
      fail(res, 402, 'not_active', 'Pro is not active on this key.', { status: k.status });
      return null;
    }
    return { lic: k.lic, status: k.status };
  }

  // For routes outside /api/pro (STATUS): does this request carry an active Pro key?
  // The same check as auth(), true or false. No key at all is simply false.
  const proActive = (req) => (req.get(KEY_HEADER) ? Boolean(keyCheck(req).status?.active) : false);

  // ---- config: what the PRO screen needs to know (test mode shows a demo banner) ----
  pro.get('/config', (req, res) => {
    res.json({ mode, open: ready, price: PLANS.month.cents, currency: 'usd', yearly: Boolean(ready && priceIdYearly), yearPrice: PLANS.year.cents });
  });

  // ---- checkout ---------------------------------------------------------------
  // With X-Pro-Key this is REACTIVATE: same licence, same customer. Refused while the
  // licence (or any Pro subscription of that customer) is still live, and any other open
  // checkout for the customer is expired first, so two tabs cannot buy twice.
  // plan: 'month' (the default, also with no body) or 'year'. Yearly needs its price id;
  // without it the answer says so instead of failing.
  pro.post('/checkout', express.json({ limit: '1kb' }), async (req, res) => {
    if (!ready) return fail(res, 503, 'not_open', 'Pro is not open yet. Try again soon.');
    const plan = req.body?.plan === undefined ? 'month' : req.body.plan;
    if (plan !== 'month' && plan !== 'year') return fail(res, 400, 'bad_plan', 'Pick monthly or yearly.');
    if (!priceFor[plan]) return fail(res, 409, 'plan_unavailable', 'Yearly billing is not available yet. Monthly is.');
    const r = limits.checkout.hit(clientIp(req));
    if (!r.ok) return limited(res, r);
    let licence = null;
    if (req.get(KEY_HEADER)) {
      const a = auth(req, res);
      if (!a) return;
      licence = a.lic;
      // A demo (test mode) licence on the live site: buy for real on the same key, with a
      // new live customer (the test customer does not exist in live mode).
      if (mode === 'live' && licence.livemode === 0) licence = { ...licence, stripe_customer_id: null };
      // A gift month still running: subscribing now would end it early, so wait.
      else if (isGiftLicence(licence) && a.status.active) return fail(res, 409, 'gift_active', `Your gift month runs until ${new Date(licence.gift_expires_at).toISOString().slice(0, 10)}. You can subscribe on this key after it ends.`);
      else if (LIVE_STATUSES.has(licence.status)) return fail(res, 409, 'already_active', ALREADY_ACTIVE);
    }
    try {
      const customer = licence?.stripe_customer_id;
      if (customer) {
        for await (const sub of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) {
          if (isProObject(sub) && LIVE_STATUSES.has(sub.status)) return fail(res, 409, 'already_active', ALREADY_ACTIVE);
        }
        for await (const open of stripe.checkout.sessions.list({ customer, status: 'open', limit: 100 })) {
          if (isProSession(open)) await stripe.checkout.sessions.expire(open.id);
        }
      }
      const session = await stripe.checkout.sessions.create(checkoutParams({ priceId: priceFor[plan], publicUrl: base, licence, interval: plan }));
      res.json({ url: session.url });
    } catch (err) {
      log.error('[pro checkout]', err.message);
      fail(res, 503, 'unavailable', 'Checkout is taking a break. Try again in a minute.');
    }
  });

  // ---- claim: the success page asks for the new key ---------------------------------
  // POST with the session id in the body, so it is never in a URL or a log line.
  pro.post('/claim', express.json({ limit: '1kb' }), async (req, res) => {
    if (!ready) return fail(res, 503, 'not_open', 'Pro is not open yet.');
    const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : '';
    if (!SESSION_RE.test(sessionId)) return fail(res, 400, 'bad_session', 'That checkout link does not look right.');
    const r = limits.claim.hit(clientIp(req));
    if (!r.ok) return limited(res, r);
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      if (err?.statusCode === 404 || err?.code === 'resource_missing') return fail(res, 404, 'not_found', 'No checkout found for that link.');
      log.error('[pro claim]', err.message);
      return fail(res, 503, 'unavailable', 'Payments are taking a break. Reload in a minute.');
    }
    if (!isProSession(session)) return fail(res, 404, 'not_found', 'No checkout found for that link.');
    if (!isPaidSession(session)) return fail(res, 402, 'not_paid', 'Payment is not complete yet. Reload in a minute.');
    let made;
    try {
      made = await licenceFromSession(session, { store, stripe, log, at: now(), termsVersion });
    } catch (err) {
      log.error('[pro claim] licence', err.message);
      return fail(res, 503, 'unavailable', 'Payments are taking a break. Reload in a minute.');
    }
    // REACTIVATE: the browser already has the key; only the status changes.
    if (made?.reactivated) return res.json({ reactivated: true, ...publicStatus(made.licence, now(), mode) });
    const out = store.reveal(sessionId);
    if (!out) {
      // A reload after REACTIVATE: the licence was made by an earlier checkout.
      const lic = made?.licence || store.findBySubscription(idOf(session.subscription));
      if (lic) return res.json({ reactivated: true, ...publicStatus(lic, now(), mode) });
      return fail(res, 404, 'not_found', 'No key found for that checkout.');
    }
    if (out.expired) {
      return fail(res, 410, 'expired', 'This key is no longer shown here. Use LOGIN with the key you saved.', { status: publicStatus(out.licence, now(), mode) });
    }
    res.json({ key: out.key, ...publicStatus(out.licence, now(), mode) });
  });

  // The browser saved the key: the server forgets its copy now instead of in 24 hours.
  pro.post('/claim/confirm', express.json({ limit: '1kb' }), (req, res) => {
    const ip = clientIp(req);
    if (limits.guess.blocked(ip)) return limited(res, limits.guess.hit(ip));
    const r = limits.claim.hit(ip);
    if (!r.ok) return limited(res, r);
    const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : '';
    const key = normalizeKey(req.get(KEY_HEADER) || '');
    if (!SESSION_RE.test(sessionId) || !key) return fail(res, 400, 'bad_request', 'Send the session id and the key.');
    const lic = store.findByKey(key);
    if (!lic || lic.checkout_session_id !== sessionId) {
      limits.guess.hit(ip);
      return fail(res, 401, 'bad_key', 'That key does not belong to this checkout.');
    }
    store.forgetReveal(sessionId, key);
    res.json({ ok: true });
  });

  // ---- login / status -------------------------------------------------------------
  pro.post('/login', express.json({ limit: '1kb' }), async (req, res) => {
    const ip = clientIp(req);
    const r = limits.login.hit(ip);
    if (!r.ok || limits.guess.blocked(ip)) return limited(res, r);
    if (loginDelayMs) await sleep(loginDelayMs);
    const key = normalizeKey(req.body?.key);
    const lic = key ? store.findByKey(key) : null;
    if (!lic) {
      limits.guess.hit(ip);
      return fail(res, 401, 'bad_key', 'That key is not valid. Check it and try again.');
    }
    res.json({ ok: true, ...publicStatus(lic, now(), mode) });
  });

  pro.get('/status', (req, res) => {
    const a = auth(req, res);
    if (a) res.json(a.status);
  });

  // ---- billing portal ----------------------------------------------------------------
  pro.post('/portal', async (req, res) => {
    if (!stripe) return fail(res, 503, 'not_open', 'Pro is not open yet.');
    const a = auth(req, res);
    if (!a) return;
    const r = limits.portal.hit(clientIp(req));
    if (!r.ok) return limited(res, r);
    if (!a.lic.stripe_customer_id) return fail(res, 409, 'no_customer', 'No billing account on this key.');
    try {
      const params = { customer: a.lic.stripe_customer_id, return_url: `${base}/?c=PRO` };
      if (portalConfigId) params.configuration = portalConfigId;
      const session = await stripe.billingPortal.sessions.create(params);
      res.json({ url: session.url });
    } catch (err) {
      log.error('[pro portal]', err.message);
      fail(res, 503, 'unavailable', 'Billing is taking a break. Try again in a minute.');
    }
  });

  // ---- sync --------------------------------------------------------------------------
  pro.get('/sync', (req, res) => {
    const a = auth(req, res, { requireActive: true });
    if (!a) return;
    res.json({ docs: store.getDocs(a.lic.id), serverTime: now() });
  });

  pro.put('/sync', express.json({ limit: MAX_SYNC_BYTES }), (req, res) => {
    const a = auth(req, res, { requireActive: true });
    if (!a) return;
    const r = limits.sync.hit(`lic:${a.lic.id}`);
    if (!r.ok) return limited(res, r);
    try {
      const written = store.putDocs(a.lic.id, req.body?.docs);
      res.json({ docs: store.getDocs(a.lic.id), written, serverTime: now() });
    } catch (err) {
      if (err instanceof SyncError) return fail(res, err.code === 'too_large' ? 413 : 400, err.code, err.message);
      throw err;
    }
  });

  // ---- gifts ---------------------------------------------------------------------------
  pro.get('/gifts', (req, res) => {
    const a = auth(req, res);
    if (!a) return;
    res.json({ ...store.listGifts(a.lic.id), canGift: a.status.canGift });
  });

  pro.post('/gifts', (req, res) => {
    const a = auth(req, res);
    if (!a) return;
    const r = limits.gift.hit(`lic:${a.lic.id}`);
    if (!r.ok) return limited(res, r);
    if (!a.status.canGift) {
      const why = isGiftLicence(a.lic) ? 'A gift licence cannot make gift codes.' : 'Gift codes come with an active paid Pro subscription.';
      return fail(res, 403, 'cannot_gift', why);
    }
    try {
      res.json(store.createGift(a.lic.id));
    } catch (err) {
      if (err instanceof GiftError) return fail(res, 409, err.code, err.message);
      throw err;
    }
  });

  // REDEEM <code>: one new licence, Pro for 30 days, no card. The code goes in the body,
  // never in a URL. Every try counts against the IP, and a wrong code also counts as a
  // guess, like a wrong key.
  pro.post('/redeem', express.json({ limit: '1kb' }), async (req, res) => {
    const ip = clientIp(req);
    const r = limits.redeem.hit(ip);
    if (!r.ok || limits.guess.blocked(ip)) return limited(res, r);
    if (loginDelayMs) await sleep(loginDelayMs);
    const code = normalizeGiftCode(req.body?.code);
    if (!code) {
      limits.guess.hit(ip);
      return fail(res, 400, 'bad_format', 'That does not look like a gift code. It looks like GIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX.');
    }
    try {
      const out = store.redeemGift(code);
      res.json({ key: out.key, ...publicStatus(out.licence, now(), mode) });
    } catch (err) {
      if (!(err instanceof GiftError)) throw err;
      if (err.code === 'bad_code') limits.guess.hit(ip);
      fail(res, err.code === 'bad_code' ? 404 : 410, err.code, err.message);
    }
  });

  // Body parser errors (too large, bad JSON) as JSON.
  pro.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large') {
      // Only sync takes big bodies; everything else takes a few small fields.
      return req.path === '/sync' ? fail(res, 413, 'too_large', 'Synced data is capped at 64 KB.') : fail(res, 413, 'too_large', 'That request is too large.');
    }
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_json', 'That is not valid JSON.');
    log.error('[pro]', err?.message);
    return fail(res, 500, 'error', 'Something went wrong. Try again in a minute.');
  });

  app.use('/api/pro', pro);
  return { ready, proActive };
}
