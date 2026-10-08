// Pro wiring for server.js: reads the environment, opens the database, mounts the routes
// and starts the hourly clean-up. If Pro cannot start, the free terminal keeps running.
//
// Environment (all in .env, never committed):
//   STRIPE_MODE               live (default) or test; test reads the *_TEST names below
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET   Stripe
//   STRIPE_PRICE_ID_YEARLY    optional: the $420 a year price; without it yearly says not yet
//   TERMS_VERSION             the Terms buyers accept (default 2026-09-25)
//   STRIPE_PORTAL_CONFIG_ID   optional Billing Portal configuration (scripts/stripe-setup.js)
//   PRO_SECRET                32+ characters; encrypts the 24 hour key reveal
//   PRO_DB_PATH               default var/pro.db
//   PUBLIC_URL                default https://bloombroke.com
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   PINGS (pro/push.js); without the keys pings are off
//   FOUNDERS, FOUNDERS_GOAL_USD, FOUNDERS_DEADLINE   FOUNDERS SEATS (pro/founders.js); closed unless FOUNDERS=open
//   TIPS                      TIPS (pro/tips.js); closed unless TIPS=open

import path from 'node:path';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { revealKeyFrom } from './licence.js';
import { createStripe, stripeEnv, DEFAULT_TERMS_VERSION } from './billing.js';
import { mountPro, defaultLimits } from './routes.js';
import { createFeedbackStore, mountFeedback } from './feedback.js';
import { createWaitlistStore, mountWaitlist } from './waitlist.js'; // PRO WAITLIST: an email while checkout is closed
import { mountChat } from './chat-routes.js'; // CHAT: private chat between Pro seats
import { getQuote, getQuoteList } from '../data/quotes.js'; // CHAT: the price stamp on a $TICKER; PINGS: closed-tab ALERTS
import { mountPush, pushConfig } from './push.js'; // PINGS: Web Push for CHAT and ALERTS
import { parseCommand, linkChanges, screenTitle } from '../public/app.js'; // CHAT: what a card may open, and its title
import { createFounders, mountFounders, handleFoundersEvent } from './founders.js'; // FOUNDERS SEATS: /founders, /api/founders
import { createTips, mountTips } from './tips.js'; // TIPS: fuel the feed, a named fish

// PRO_CHECKOUT=closed: no new checkouts on this site (pro/routes.js). Unset: as before.
export const checkoutClosed = (env) => String(env.PRO_CHECKOUT || '').trim().toLowerCase() === 'closed';

export function startPro(app, { dir, env = process.env, log = console, counters = null }) {
  try {
    const db = openDb(env.PRO_DB_PATH || path.join(dir, 'var', 'pro.db'));
    counters?.attach(db); // BBRK: the site's own daily totals (lib/counters.js)
    let aesKey = null;
    try { aesKey = env.PRO_SECRET ? revealKeyFrom(env.PRO_SECRET) : null; } catch (err) { log.error('[pro]', err.message); }
    const store = createStore(db, { aesKey });
    const se = stripeEnv(env);
    if (se.error) log.error('[pro]', se.error);
    const stripe = se.secretKey ? createStripe(se.secretKey) : null;
    // One wrong-key limiter for Pro and CHAT, so CHAT is no second place to guess keys.
    const limits = defaultLimits(() => Date.now());
    // FOUNDERS SEATS and TIPS: their own tables, the same Stripe account and webhook.
    const webhookReady = Boolean(se.webhookSecret && aesKey);
    const founders = createFounders({ db, stripe, env, mode: se.mode, webhookReady, log });
    const tips = createTips({ db, stripe, env, webhookReady, log });
    const { ready, proActive } = mountPro(app, {
      store,
      stripe,
      limits,
      onEvent: (event) => handleFoundersEvent(event, { founders: founders.store, tips, stripe, log }),
      config: {
        mode: se.mode,
        priceId: se.priceId,
        priceIdYearly: se.priceIdYearly,
        webhookSecret: se.webhookSecret,
        portalConfigId: se.portalConfigId,
        publicUrl: env.PUBLIC_URL || 'https://bloombroke.com',
        proSecretSet: Boolean(aesKey),
        termsVersion: (env.TERMS_VERSION || '').trim() || DEFAULT_TERMS_VERSION,
        checkoutClosed: checkoutClosed(env),
      },
    });
    // FEEDBACK lives in the same database: POST /api/feedback, for everyone.
    const feedback = createFeedbackStore(db);
    mountFeedback(app, { store: feedback, publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', log, onSaved: () => counters?.bump('feedback_sent') });
    // FOUNDERS SEATS: GET /api/founders/status, POST /api/founders/checkout. TIPS: POST
    // /api/tips/checkout (404 unless TIPS=open). The pages are lib/founders-page.js.
    mountFounders(app, { founders, publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', log });
    mountTips(app, { tips, publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', log });
    // PRO WAITLIST: POST /api/pro/waitlist, only with PRO_CHECKOUT=closed (404 otherwise).
    mountWaitlist(app, { store: createWaitlistStore(db), checkoutClosed: checkoutClosed(env), publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', log });
    // PINGS: /api/push (pro/push.js). Off (404 push_off) without the VAPID keys.
    const push = mountPush(app, {
      db, store, guess: limits.guess, mode: se.mode, publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', config: pushConfig(env, log), getQuoteList, log,
    });
    // CHAT: /api/chat, active Pro keys only (pro/chat-routes.js). A new message may ping;
    // DELETE MY ACCOUNT takes the push rows too, and DOWNLOAD MY DATA lists them.
    const chat = mountChat(app, {
      db, store, guess: limits.guess, mode: se.mode, publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', getQuote, parse: parseCommand, linkChanges, titleOf: (c) => screenTitle(c).title, log,
      onMessage: (m) => push.onMessage(m), onAccountDelete: (id) => push.wipe(id), pingsOf: (id) => push.exportOf(id),
    });
    // NEW KEY logs out every device, so no device gets pings for this licence any more.
    store.onKeyChange((id) => { try { push.forgetDevices(id); } catch (err) { log.error('[push] new key', err.message); } });
    push.alerts?.start();
    const clean = () => {
      try { store.purgeReveals(); store.pruneEvents(); } catch (err) { log.error('[pro] clean-up', err.message); }
    };
    clean();
    setInterval(clean, 60 * 60 * 1000).unref();
    // Privacy Policy: synced data of subscriptions that ended over 30 days ago is deleted.
    const purge = () => {
      try {
        const n = store.purgeEnded();
        log.log(`[pro] purge: ${n.docs} synced documents, ${n.reveals} reveal copies`);
      } catch (err) { log.error('[pro] purge', err.message); }
      // Privacy Policy: licence records go 5 years after the licence ended, gift code
      // records 12 months after they were used or expired.
      try {
        const r = store.purgeRecords();
        log.log(`[pro] purge: ${r.licences} licence records over 5 years old, ${r.gifts} gift code records over 12 months old`);
      } catch (err) { log.error('[pro] records purge', err.message); }
      // Privacy Policy: feedback is kept up to 12 months.
      try {
        log.log(`[pro] purge: ${feedback.prune()} feedback notes over 12 months old`);
      } catch (err) { log.error('[pro] feedback purge', err.message); }
      // Privacy Policy: chat messages and requests go after 30 days, chat reports after 12
      // months, and all chat rows of a licence 30 days after its Pro ended.
      try {
        const c = chat.purge();
        log.log(`[pro] purge: chat ${c.messages} messages, ${c.requests} requests, ${c.reports} reports, ${c.ended} rows of ended licences, ${c.rooms} empty rooms`);
      } catch (err) { log.error('[pro] chat purge', err.message); }
      // Privacy Policy: push subscriptions, ping settings and server alerts go 30 days
      // after the Pro ended (and at once for a deleted account).
      try {
        const p = push.purge();
        log.log(`[pro] purge: pings ${p.subs} devices, ${p.prefs} settings, ${p.alerts} alerts`);
      } catch (err) { log.error('[pro] push purge', err.message); }
    };
    purge();
    setInterval(purge, 24 * 60 * 60 * 1000).unref();
    log.log(`[pro] ${se.mode} mode, ${ready ? 'ready' : 'not configured: checkout is closed'}${checkoutClosed(env) ? ', PRO_CHECKOUT=closed: no new checkouts' : ''}`);
    if (founders.isOpen()) log.log(`[founders] open${founders.testMode() ? ' (test mode)' : ''}, until ${founders.cfg.deadline}`);
    if (tips.isOpen()) log.log('[tips] open');
    return { db, store, feedback, chat, push, ready, mode: se.mode, proActive, founders, tips };
  } catch (err) {
    log.error('[pro] could not start:', err.message);
    return null;
  }
}
