#!/usr/bin/env node
// ADMIN ONLY. Review the fish names people gave with a tip (pro/tips.js). A tip fish shows
// as "Fish #<id>" until its name is approved here.
//
//   node scripts/fish-review.js list [--all] [--db path]          the pending names (--all: every tip)
//   node scripts/fish-review.js approve <id> [--execute] [--db path]       show the name as typed
//   node scripts/fish-review.js rename <id> <name> [--execute] [--db path] show another name
//   node scripts/fish-review.js remove <id> [--execute] [--db path]        no name: "Fish #<id>"
//
// Dry run by default: it says what it would do. --execute changes the database. A name
// must pass the same rules as at checkout: 2 to 16 letters, digits or spaces, no link,
// nothing rude or staff-like. Nothing here talks to Stripe; a tip is not refunded.

import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dbPath } from './feedback-export.js';
import { createTipsStore, cleanFishName } from '../pro/tips.js';

// argv -> { cmd, id, name, all, execute, db } or { error }.
export function parseArgs(argv) {
  const out = { cmd: null, id: null, name: null, all: false, execute: false, db: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') out.execute = true;
    else if (a === '--all') out.all = true;
    else if (a === '--db') {
      const v = argv[++i];
      if (!v) return { error: '--db takes a path' };
      out.db = v;
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else rest.push(a);
  }
  [out.cmd] = rest;
  if (!['list', 'approve', 'rename', 'remove'].includes(out.cmd)) return { error: 'say list, approve <id>, rename <id> <name> or remove <id>' };
  if (out.cmd !== 'list') {
    const id = Number(rest[1]);
    if (!Number.isInteger(id) || id < 1) return { error: `${out.cmd} takes a tip id` };
    out.id = id;
  }
  if (out.cmd === 'rename') {
    out.name = rest.slice(2).join(' ');
    if (!out.name) return { error: 'rename takes a new name' };
  }
  return out;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export function listText(rows) {
  if (!rows.length) return 'Nothing to review.\n';
  return `${rows.map((r) => `#${r.id}  $${(r.amount_cents / 100).toFixed(0)}  ${day(r.created_at)}  ${r.status.padEnd(8)}  typed: ${r.fish_name_raw ?? '(none)'}${r.fish_name ? `  shown: ${r.fish_name}` : ''}${cleanFishName(r.fish_name_raw).name ? '' : '  (fails the rules: rename or remove)'}`).join('\n')}\n`;
}

// One change. -> { done, text }. With execute false nothing changes.
export function apply({ db, cmd, id, name = null, execute = false }) {
  const store = createTipsStore(db);
  const t = store.one(id);
  if (!t) return { done: false, text: `No tip #${id}.` };
  let shown = null;
  if (cmd === 'approve') {
    shown = cleanFishName(t.fish_name_raw).name;
    if (!shown) return { done: false, text: `Tip #${id}: "${t.fish_name_raw ?? ''}" fails the name rules. Use rename or remove.` };
  } else if (cmd === 'rename') {
    const c = cleanFishName(name);
    if (!c.name || c.name !== name.trim().replace(/\s+/g, ' ')) return { done: false, text: `"${name}" fails the name rules: 2 to 16 letters, digits or spaces, nothing rude.` };
    shown = c.name;
  }
  const what = cmd === 'remove' ? `Tip #${id}: no name, shown as "Fish #${id}"` : `Tip #${id}: shown as "${shown}"`;
  if (!execute) return { done: false, text: `Dry run. ${what}. Add --execute.` };
  if (cmd === 'remove') store.remove(id); else store.approve(id, shown);
  return { done: true, text: `${what}.` };
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error);
    console.error('Usage: node scripts/fish-review.js list [--all] | approve <id> | rename <id> <name> | remove <id>  [--execute] [--db path]');
    return 1;
  }
  const file = dbPath(args.db);
  if (!existsSync(file)) { console.error(`No database at ${file}.`); return 1; }
  const write = args.cmd !== 'list' && args.execute;
  const db = new Database(file, { readonly: !write, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    if (args.cmd === 'list') {
      const rows = args.all ? db.prepare('SELECT * FROM tips ORDER BY id').all() : db.prepare("SELECT * FROM tips WHERE status = 'pending' ORDER BY id").all();
      process.stdout.write(listText(rows));
      return 0;
    }
    const out = apply({ db, cmd: args.cmd, id: args.id, name: args.name, execute: args.execute });
    console.log(out.text);
    return out.done || !args.execute ? 0 : 2;
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (err) {
    console.error('fish-review failed:', err.message);
    process.exitCode = 1;
  }
}
