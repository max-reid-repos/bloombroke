// Pro wiring for server.js: reads the environment, opens the database, mounts the routes
// and starts the hourly clean-up. If Pro cannot start, the free terminal keeps running.
//
// Environment (all in .env, never committed):
//   STRIPE_MODE               live (default) or test; test reads the *_TEST names below
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET   Stripe
//   STRIPE_PRICE_ID_YEARLY    optional: the $42 a year price; without it yearly says not yet
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
import { mountPro } from './routes.js';

export function startPro(app, { dir, env = process.env, log = console }) {
  try {
    const db = openDb(env.PRO_DB_PATH || path.join(dir, 'var', 'pro.db'));
    let aesKey = null;
    try { aesKey = env.PRO_SECRET ? revealKeyFrom(env.PRO_SECRET) : null; } catch (err) { log.error('[pro]', err.message); }
    const store = createStore(db, { aesKey });
    const se = stripeEnv(env);
    if (se.error) log.error('[pro]', se.error);
    const stripe = se.secretKey ? createStripe(se.secretKey) : null;
    const { ready } = mountPro(app, {
      store,
      stripe,
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
    };
    purge();
    setInterval(purge, 24 * 60 * 60 * 1000).unref();
    log.log(`[pro] ${se.mode} mode, ${ready ? 'ready' : 'not configured: checkout is closed'}`);
    return { db, store, ready };
  } catch (err) {
    log.error('[pro] could not start:', err.message);
    return null;
  }
}
