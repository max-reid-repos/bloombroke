// Pro wiring for server.js: reads the environment, opens the database, mounts the routes
// and starts the hourly clean-up. If Pro cannot start, the free terminal keeps running.
//
// Environment (all in .env, never committed):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET   Stripe
//   STRIPE_PORTAL_CONFIG_ID   optional Billing Portal configuration (scripts/stripe-setup.js)
//   PRO_SECRET                32+ characters; encrypts the 24 hour key reveal
//   PRO_DB_PATH               default var/pro.db
//   PUBLIC_URL                default https://bloombroke.com

import path from 'node:path';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { revealKeyFrom } from './licence.js';
import { createStripe } from './billing.js';
import { mountPro } from './routes.js';

export function startPro(app, { dir, env = process.env, log = console }) {
  try {
    const db = openDb(env.PRO_DB_PATH || path.join(dir, 'var', 'pro.db'));
    let aesKey = null;
    try { aesKey = env.PRO_SECRET ? revealKeyFrom(env.PRO_SECRET) : null; } catch (err) { log.error('[pro]', err.message); }
    const store = createStore(db, { aesKey });
    const stripe = env.STRIPE_SECRET_KEY ? createStripe(env.STRIPE_SECRET_KEY) : null;
    const { ready } = mountPro(app, {
      store,
      stripe,
      config: {
        priceId: env.STRIPE_PRICE_ID,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        portalConfigId: env.STRIPE_PORTAL_CONFIG_ID,
        publicUrl: env.PUBLIC_URL || 'https://bloombroke.com',
        proSecretSet: Boolean(aesKey),
      },
    });
    const clean = () => {
      try { store.purgeReveals(); store.pruneEvents(); } catch (err) { log.error('[pro] clean-up', err.message); }
    };
    clean();
    setInterval(clean, 60 * 60 * 1000).unref();
    log.log(`[pro] ${ready ? 'ready' : 'not configured: checkout is closed'}`);
    return { db, store, ready };
  } catch (err) {
    log.error('[pro] could not start:', err.message);
    return null;
  }
}
