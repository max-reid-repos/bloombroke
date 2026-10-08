#!/usr/bin/env node
// ADMIN ONLY. The FOUNDERS SEATS table (pro/founders.js), on the server.
//
//   node scripts/founders.js list [--db path]           every seat, with its email: local only
//   node scripts/founders.js export [--db path]         the committed seats as CSV
//   node scripts/founders.js release <seat> [--execute] [--live] [--env path] [--db path]
//   node scripts/founders.js reset-test [--execute] [--db path]
//
// release: a founder gave up the seat before the charge (by email). Dry run by default:
// it says what it would do. With --execute it takes the saved card off (detach, so it can
// never be charged), deletes the Stripe customer (only one tagged site=bloombroke,
// product=founders), puts the seat back to open with every private field cleared, and
// writes one public log line ("Seat 12 released Nov 3.").
// reset-test: before live keys go in, every test-mode seat (livemode 0) back to open and
// the test log lines and test tips deleted. No Stripe calls (test objects stay in test
// mode). The server already ignores test rows with a live key; this clears them.
// A live key needs --live as well. The Stripe call carries an idempotency key, so a run
// that stops half way can be run again.
//
// The database is --db, else PRO_DB_PATH (from the environment or the .env next to
// server.js), else var/pro.db. The Stripe keys come from --env, else that .env.
// The charge on the day the goal is reached is a later script, not this one.

import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dbPath } from './feedback-export.js';
import { createStripe, stripeEnv } from '../pro/billing.js';
import { createFoundersStore, removeCustomer, CLASSES, isSeat, fmtUsd } from '../pro/founders.js';
import { csvField } from './waitlist.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// argv -> { cmd, seat, execute, live, db, env } or { error }.
export function parseArgs(argv) {
  const out = { cmd: null, seat: null, execute: false, live: false, db: null, env: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') out.execute = true;
    else if (a === '--live') out.live = true;
    else if (a === '--db' || a === '--env') {
      const v = argv[++i];
      if (!v) return { error: `${a} takes a path` };
      out[a.slice(2)] = v;
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else if (!out.cmd) out.cmd = a;
    else if (out.cmd === 'release' && out.seat === null) {
      const n = Number(a);
      if (!isSeat(n)) return { error: 'release takes a seat number from 1 to 42' };
      out.seat = n;
    } else return { error: `unexpected ${a}` };
  }
  if (!['list', 'export', 'release', 'reset-test'].includes(out.cmd)) return { error: 'say list, export, release <seat> or reset-test' };
  if (out.cmd === 'release' && out.seat === null) return { error: 'release takes a seat number from 1 to 42' };
  return out;
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : '');

export function listText(rows) {
  const lines = rows.map((r) => `${String(r.seat).padStart(2)}  ${r.class.padEnd(7)}  ${r.status.padEnd(9)}  ${r.email || ''}${r.handle ? `  @${r.handle}` : ''}`);
  const done = rows.filter((r) => r.status === 'committed');
  const usd = done.reduce((n, r) => n + CLASSES[r.class].usd, 0);
  return `${lines.join('\n')}\n\n${done.length} committed, ${fmtUsd(usd)}.\n`;
}

export function exportCsv(rows) {
  const out = ['seat,class,email,handle,stripe_customer_id,committed_at,mandate_ip,livemode'];
  for (const r of rows.filter((x) => x.status === 'committed')) {
    out.push([r.seat, r.class, r.email, r.handle, r.stripe_customer_id, iso(r.mandate_at), r.mandate_ip, r.livemode].map(csvField).join(','));
  }
  return `${out.join('\n')}\n`;
}

// release one seat. With execute false nothing changes. -> { done, text }.
export async function release({ db, stripe = null, seat, execute = false, now = () => Date.now() }) {
  const store = createFoundersStore(db, { now });
  const r = store.seat(seat);
  if (!r) return { done: false, text: `No seat ${seat}.` };
  if (r.status !== 'committed') return { done: false, text: `Seat ${seat} is ${r.status}: nothing to release.` };
  if (!execute) return { done: false, text: `Dry run: seat ${seat} (${r.class}) would be released, its card ${r.payment_method_id ? 'detached' : '(none on file)'} and its Stripe customer ${r.stripe_customer_id ? 'deleted' : '(none on file)'}, and the log would say it. Add --execute.` };
  let customer = 'none';
  if (r.payment_method_id || r.stripe_customer_id) {
    if (!stripe) return { done: false, text: 'No Stripe key: cannot remove the card. Nothing changed.' };
    try {
      if (r.payment_method_id) {
        try {
          await stripe.paymentMethods.detach(r.payment_method_id, {}, { idempotencyKey: `bb-founders-detach-${r.payment_method_id}` });
        } catch (err) {
          const gone = err?.statusCode === 404 || err?.code === 'resource_missing' || err?.code === 'payment_method_unexpected_state';
          if (!gone) throw err;
        }
      }
      customer = await removeCustomer(stripe, r.stripe_customer_id, { requireTag: true });
    } catch (err) {
      return { done: false, text: `Stripe said: ${err.message}. Nothing changed here; run it again.` };
    }
  }
  store.release(seat);
  const note = customer === 'not_ours' ? ' The Stripe customer was not tagged as ours, so it was left: check it by hand.' : '';
  return { done: true, text: `Seat ${seat} released: card detached, customer ${customer === 'deleted' || customer === 'gone' ? 'deleted' : 'kept'}, seat open, log written.${note}` };
}

// reset-test: the test-mode rows. -> { done, text }.
export function resetTest({ db, execute = false }) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM founders_seats WHERE livemode = 0').get().n;
  const t = db.prepare('SELECT COUNT(*) AS n FROM tips WHERE livemode = 0').get().n;
  if (!execute) return { done: false, text: `Dry run: ${n} test seats would go back to open and ${t} test tips would be deleted. Add --execute.` };
  const out = createFoundersStore(db).resetTest();
  return { done: true, text: `Reset: ${out.seats} test seats open, ${out.log} test log lines and ${out.tips} test tips deleted.` };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error);
    console.error('Usage: node scripts/founders.js list|export [--db path]\n       node scripts/founders.js release <seat> [--execute] [--live] [--env path] [--db path]\n       node scripts/founders.js reset-test [--execute] [--db path]');
    return 1;
  }
  const file = dbPath(args.db);
  if (!existsSync(file)) { console.error(`No database at ${file}.`); return 1; }
  const write = (args.cmd === 'release' || args.cmd === 'reset-test') && args.execute;
  const db = new Database(file, { readonly: !write, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    // Read-only: a hold that ran out still says held here (the server opens it on its next read).
    if (args.cmd === 'list') { process.stdout.write(listText(db.prepare('SELECT * FROM founders_seats ORDER BY seat').all())); return 0; }
    if (args.cmd === 'export') { process.stdout.write(exportCsv(db.prepare('SELECT * FROM founders_seats ORDER BY seat').all())); return 0; }
    if (args.cmd === 'reset-test') {
      const r = resetTest({ db, execute: args.execute });
      console.log(r.text);
      return 0;
    }
    let stripe = null;
    if (write) {
      const envFile = path.resolve(args.env || path.join(ROOT, '.env'));
      const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
      const se = stripeEnv(env);
      if (se.error) { console.error(se.error); return 1; }
      if (se.mode === 'live' && !args.live) { console.error('This is a live key. Add --live to really detach the card.'); return 1; }
      stripe = se.secretKey ? createStripe(se.secretKey) : null;
    }
    const out = await release({ db, stripe, seat: args.seat, execute: args.execute });
    console.log(out.text);
    return out.done || !args.execute ? 0 : 2;
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error('founders failed:', err.message);
    process.exitCode = 1;
  });
}
