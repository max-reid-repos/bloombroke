#!/usr/bin/env node
// ADMIN ONLY. A customer lost their Pro key: give their licence a new one.
//
//   node scripts/pro-reissue.js <path/to/.env> --subscription sub_...
//   node scripts/pro-reissue.js <path/to/.env> --email person@example.com
//
// The old key stops working at once (every device using it is logged out on its next
// check). The new key is printed ONCE, here, for the admin to pass on; it is not stored
// anywhere in plain text. Synced data and the subscription stay as they are.
// --email looks the customer up in Stripe (needs STRIPE_SECRET_KEY); when that finds more
// than one licence, run again with --subscription.

import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { createStripe, stripeEnv, PRO_METADATA } from '../pro/billing.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Returns { key, licence } or { error, candidates? }.
export async function reissue({ store, stripe = null, subscription = null, email = null }) {
  let licence = null;
  if (subscription) {
    licence = store.findBySubscription(subscription);
    if (!licence) return { error: 'No licence has that subscription.' };
  } else if (email) {
    if (!stripe) return { error: 'Looking up by email needs STRIPE_SECRET_KEY.' };
    const found = [];
    for await (const c of stripe.customers.list({ email: email.trim().toLowerCase(), limit: 100 })) found.push(...store.findByCustomer(c.id));
    if (!found.length) return { error: 'No licence for a Stripe customer with that email.' };
    if (found.length > 1) return { error: 'More than one licence for that email. Pick one with --subscription.', candidates: found };
    [licence] = found;
  } else {
    return { error: 'Give --subscription <sub_id> or --email <address>.' };
  }
  const out = store.rotateKey(licence.id);
  if (stripe && out.licence.stripe_subscription_id) {
    try {
      await stripe.subscriptions.update(out.licence.stripe_subscription_id, { metadata: { ...PRO_METADATA, licence_last4: out.licence.last4 } });
    } catch (err) {
      out.warning = `Could not update the last 4 in Stripe: ${err.message}`;
    }
  }
  return out;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

async function main(argv) {
  const envPath = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
  if (!envPath || !existsSync(envPath)) {
    console.error('Usage: node scripts/pro-reissue.js <path/to/.env> --subscription <sub_id> | --email <address>');
    return 1;
  }
  const env = parseEnv(readFileSync(envPath, 'utf8'));
  const subscription = arg(argv, '--subscription');
  const email = arg(argv, '--email');
  if (subscription && !/^sub_[A-Za-z0-9]+$/.test(subscription)) { console.error('That does not look like a subscription id.'); return 1; }
  // A relative PRO_DB_PATH is relative to the .env file's folder.
  const dbPath = env.PRO_DB_PATH ? path.resolve(path.dirname(envPath), env.PRO_DB_PATH) : path.join(ROOT, 'var', 'pro.db');
  if (!existsSync(dbPath)) { console.error(`No Pro database at ${dbPath}.`); return 1; }
  const store = createStore(openDb(dbPath));
  const se = stripeEnv(env);
  if (se.error) { console.error(se.error); return 1; }
  const stripe = se.secretKey ? createStripe(se.secretKey) : null;
  const out = await reissue({ store, stripe, subscription, email });
  if (out.error) {
    console.error(out.error);
    for (const l of out.candidates || []) console.error(`  ${l.stripe_subscription_id}  status ${l.status}  key ends ${l.last4}`);
    return 1;
  }
  if (out.warning) console.error(out.warning);
  console.log('New key (shown once, the old key no longer works):');
  console.log('');
  console.log(`  ${out.key}`);
  console.log('');
  console.log(`Status: ${out.licence.status}. Tell them: type LOGIN followed by the key.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error('pro-reissue failed:', err.message);
    process.exitCode = 1;
  });
}
