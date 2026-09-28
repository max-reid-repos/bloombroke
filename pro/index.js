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

import path from 'node:path';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { revealKeyFrom } from './licence.js';
import { createStripe, stripeEnv, DEFAULT_TERMS_VERSION } from './billing.js';
import { mountPro, defaultLimits } from './routes.js';
import { createFeedbackStore, mountFeedback } from './feedback.js';
import { mountChat } from './chat-routes.js'; // CHAT: private chat between Pro seats
import { getQuote } from '../data/quotes.js'; // CHAT: the price stamp on a $TICKER
import { parseCommand, linkChanges } from '../public/app.js'; // CHAT: what a card may open

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
    const { ready, proActive } = mountPro(app, {
      store,
      stripe,
      limits,
      config: {
        mode: se.mode,
        priceId: se.priceId,
        priceIdYearly: se.priceIdYearly,
        webhookSecret: se.webhookSecret,
        portalConfigId: se.portalConfigId,
        publicUrl: env.PUBLIC_URL || 'https://bloombroke.com',
        proSecretSet: Boolean(aesKey),
        termsVersion: (env.TERMS_VERSION || '').trim() || DEFAULT_TERMS_VERSION,
      },
    });
    // FEEDBACK lives in the same database: POST /api/feedback, for everyone.
    const feedback = createFeedbackStore(db);
    mountFeedback(app, { store: feedback, publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', log, onSaved: () => counters?.bump('feedback_sent') });
    // CHAT: /api/chat, active Pro keys only (pro/chat-routes.js).
    const chat = mountChat(app, {
      db, store, guess: limits.guess, mode: se.mode, publicUrl: env.PUBLIC_URL || 'https://bloombroke.com', getQuote, parse: parseCommand, linkChanges, log,
    });
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
    };
    purge();
    setInterval(purge, 24 * 60 * 60 * 1000).unref();
    log.log(`[pro] ${se.mode} mode, ${ready ? 'ready' : 'not configured: checkout is closed'}`);
    return { db, store, feedback, chat, ready, mode: se.mode, proActive };
  } catch (err) {
    log.error('[pro] could not start:', err.message);
    return null;
  }
}
