#!/usr/bin/env node
// One-time Stripe setup for Bloombroke Pro. Safe to run again: it finds what it made
// before (by metadata site=bloombroke, product=pro) and only creates what is missing.
//
//   node scripts/stripe-setup.js <path/to/.env> [--live]
//
// Uses the key set STRIPE_MODE picks (live: STRIPE_SECRET_KEY, test: STRIPE_SECRET_KEY_TEST)
// and writes the matching names (with _TEST in test mode). Makes, or finds:
//   - the product "Bloombroke Pro"
//   - its price: $4.20 USD a month
//   - a Billing Portal configuration (card, invoices, cancel; no plan switching)
//   - the webhook endpoint <PUBLIC_URL>/api/stripe/webhook with the four Pro events
// and writes STRIPE_PRICE_ID, STRIPE_PORTAL_CONFIG_ID, STRIPE_WEBHOOK_SECRET (only when the
// endpoint is created, the one time Stripe shows it) and PRO_SECRET (if missing) into the
// .env. It never prints a secret or the values it writes. A live key needs --live.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStripe, stripeEnv, PRO_METADATA, WEBHOOK_EVENTS } from '../pro/billing.js';

export const PRODUCT = {
  name: 'Bloombroke Pro',
  description: 'Bloombroke Pro, monthly subscription: price alerts and watchlist sync across devices.',
};
export const PRICE = { unit_amount: 420, currency: 'usd', interval: 'month' };

const isOurs = (o) => o?.metadata?.site === PRO_METADATA.site && o?.metadata?.product === PRO_METADATA.product;

async function all(listPromise) {
  const out = [];
  for await (const x of listPromise) out.push(x);
  return out;
}

// Returns { values: { NAME: value }, report: [lines without secrets] }.
export async function setup({ stripe, env = {}, publicUrl = 'https://bloombroke.com' }) {
  const base = publicUrl.replace(/\/+$/, '');
  const values = {};
  const report = [];

  // Product
  let product = (await all(stripe.products.list({ active: true, limit: 100 }))).find(isOurs);
  if (product) report.push('product: found');
  else {
    product = await stripe.products.create({ ...PRODUCT, metadata: { ...PRO_METADATA } });
    report.push('product: created');
  }

  // Price
  const prices = await all(stripe.prices.list({ product: product.id, active: true, type: 'recurring', limit: 100 }));
  let price = prices.find((p) => isOurs(p) && p.unit_amount === PRICE.unit_amount && p.currency === PRICE.currency
    && p.recurring?.interval === PRICE.interval && (p.recurring?.interval_count ?? 1) === 1);
  if (price) report.push('price: found');
  else {
    price = await stripe.prices.create({
      product: product.id, unit_amount: PRICE.unit_amount, currency: PRICE.currency,
      recurring: { interval: PRICE.interval, interval_count: 1 }, metadata: { ...PRO_METADATA },
    });
    report.push('price: created');
  }
  values.STRIPE_PRICE_ID = price.id;

  // Billing Portal configuration: its own, so a Pro customer cannot switch to another
  // product sold from the same Stripe account.
  let portal = (await all(stripe.billingPortal.configurations.list({ active: true, limit: 100 }))).find(isOurs);
  if (portal) report.push('portal configuration: found');
  else {
    portal = await stripe.billingPortal.configurations.create({
      business_profile: { headline: 'Bloombroke Pro' },
      default_return_url: `${base}/?c=PRO`,
      features: {
        customer_update: { enabled: true, allowed_updates: ['email'] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
      },
      metadata: { ...PRO_METADATA },
    });
    report.push('portal configuration: created');
  }
  values.STRIPE_PORTAL_CONFIG_ID = portal.id;

  // Webhook endpoint
  const url = `${base}/api/stripe/webhook`;
  const endpoint = (await all(stripe.webhookEndpoints.list({ limit: 100 }))).find((e) => e.url === url);
  if (endpoint) {
    const events = new Set(endpoint.enabled_events || []);
    const missing = WEBHOOK_EVENTS.filter((e) => !events.has(e) && !events.has('*'));
    if (missing.length || endpoint.status !== 'enabled') {
      await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: [...new Set([...events, ...WEBHOOK_EVENTS])], disabled: false });
      report.push('webhook endpoint: found, events updated');
    } else {
      report.push('webhook endpoint: found');
    }
    if (!env.STRIPE_WEBHOOK_SECRET) {
      report.push('webhook secret: NOT in the .env. Stripe only shows it once: copy it from the dashboard (Developers, Webhooks, this endpoint, Signing secret) into STRIPE_WEBHOOK_SECRET.');
      values.__missingWebhookSecret = true;
    }
  } else {
    const created = await stripe.webhookEndpoints.create({
      url, enabled_events: WEBHOOK_EVENTS, description: 'Bloombroke Pro', metadata: { ...PRO_METADATA },
    });
    values.STRIPE_WEBHOOK_SECRET = created.secret;
    report.push('webhook endpoint: created');
  }

  if (!env.PRO_SECRET) {
    values.PRO_SECRET = randomBytes(32).toString('base64url');
    report.push('PRO_SECRET: generated');
  }
  return { values, report };
}

// Replace or append NAME=value lines, keeping everything else as it was.
export function upsertEnv(content, updates) {
  const lines = content.length ? content.replace(/\n$/, '').split('\n') : [];
  for (const [k, v] of Object.entries(updates)) {
    if (k.startsWith('__') || v === undefined) continue;
    if (!/^[A-Za-z0-9_\-.~+/=]+$/.test(String(v))) throw new Error(`refusing to write an odd value for ${k}`);
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  return lines.join('\n') + '\n';
}

async function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const live = argv.includes('--live');
  const envPath = args[0] && path.resolve(args[0]);
  if (!envPath || !existsSync(envPath)) {
    console.error('Usage: node scripts/stripe-setup.js <path/to/.env> [--live]');
    return 1;
  }
  const content = readFileSync(envPath, 'utf8');
  const env = parseEnv(content);
  const se = stripeEnv(env);
  if (se.error) { console.error(se.error); return 1; }
  if (!se.secretKey) { console.error(`${se.names.secretKey} is not in that .env.`); return 1; }
  const mode = se.mode;
  console.log(`stripe mode: ${mode}`);
  if (mode === 'live' && !live) { console.error('This is a live key. Run again with --live to go ahead.'); return 1; }

  const out = await setup({
    stripe: createStripe(se.secretKey),
    env: { STRIPE_WEBHOOK_SECRET: se.webhookSecret, PRO_SECRET: env.PRO_SECRET },
    publicUrl: env.PUBLIC_URL || 'https://bloombroke.com',
  });
  const { report } = out;
  const rename = { STRIPE_PRICE_ID: se.names.priceId, STRIPE_WEBHOOK_SECRET: se.names.webhookSecret, STRIPE_PORTAL_CONFIG_ID: se.names.portalConfigId };
  const values = Object.fromEntries(Object.entries(out.values).map(([k, v]) => [rename[k] || k, v]));
  const tmp = `${envPath}.tmp-${process.pid}`;
  writeFileSync(tmp, upsertEnv(content, values), { mode: 0o600 });
  renameSync(tmp, envPath);
  for (const line of report) console.log(line);
  console.log(`wrote ${Object.keys(values).filter((k) => !k.startsWith('__')).join(', ') || 'nothing'} to ${envPath}`);
  return values.__missingWebhookSecret ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error('setup failed:', err.message);
    process.exitCode = 1;
  });
}
