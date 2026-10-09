#!/usr/bin/env node
// ADMIN ONLY. Sends one founders outbox file (pro/founders.js createOutbox) through
// Cloudflare Email Sending, from Max Reid <hello@bloombroke.com>. Run where the file was
// copied to (not on the server), after the owner read it with "founders.js outbox".
//
//   node scripts/send-outbox.cjs <founders-YYYYMMDD-source.json> --token-file <path> [--account-id <id>] [--send]
//
// Without --send it only counts the emails. With --send it posts them one by one; each
// one sent is taken out of the file at once (so a run that stops can be run again without
// sending anything twice), and the file is deleted when it is empty. The Cloudflare API
// token is read from --token-file (mode 600, never printed); the account id is
// --account-id, else CF_ACCOUNT_ID. Email bodies, subjects and link tokens are never
// printed: only the kind, the seat and a masked address.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FROM = 'Max Reid <hello@bloombroke.com>';
const REPLY_TO = 'hello@bloombroke.com';
const KINDS = ['charge', 'failed', 'key', 'golive'];
const API = (account) => `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`;

function parseArgs(argv) {
  const out = { file: null, tokenFile: null, accountId: null, send: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send') out.send = true;
    else if (a === '--token-file' || a === '--account-id') {
      const v = argv[++i];
      if (!v) return { error: `${a} takes a value` };
      out[a === '--token-file' ? 'tokenFile' : 'accountId'] = v;
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else if (!out.file) out.file = a;
    else return { error: `unexpected ${a}` };
  }
  if (!out.file) return { error: 'name the outbox file' };
  if (!out.tokenFile) return { error: '--token-file is needed' };
  return out;
}

// 'ann@example.com' -> 'a**@example.com'
function mask(e) {
  const [user, host] = String(e || '').split('@');
  if (!host) return '(no address)';
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(user.length - 1, 6)))}@${host}`;
}

function readToken(file) {
  const st = fs.statSync(file);
  if (st.mode & 0o077) throw new Error('the token file can be read by others: chmod 600 it');
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!token || /\s/.test(token)) throw new Error('the token file is empty or not one token');
  return token;
}

function readList(file) {
  let list;
  // A parse error would quote the file: a fixed message instead.
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('the file cannot be read as JSON'); }
  if (!Array.isArray(list)) throw new Error('the file is not a list');
  for (const [i, e] of list.entries()) {
    const ok = e && KINDS.includes(e.kind) && Number.isInteger(e.seat) && typeof e.to === 'string' && /^[^\s@]+@[^\s@]+$/.test(e.to)
      && typeof e.subject === 'string' && e.subject && typeof e.text === 'string' && e.text;
    if (!ok) throw new Error(`email ${i + 1} is not a founders email`);
  }
  return list;
}

// The rest of the list back into the file (atomic, mode 600), or the file gone when empty.
function writeRest(file, rest) {
  if (!rest.length) { fs.rmSync(file, { force: true }); return; }
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(rest, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

// Cloudflare's errors, codes and short messages only: never the email itself.
function cfErrors(body) {
  const errs = Array.isArray(body?.errors) ? body.errors : [];
  return errs.map((x) => `${x?.code ?? '?'} ${String(x?.message ?? '').slice(0, 120)}`).join('; ') || 'no detail';
}

// -> { sent, left, error? }. fetchFn: the global fetch, or a fake in tests.
async function sendOutbox({ file, token, accountId, send = false, fetchFn = globalThis.fetch, log = console.log }) {
  if (!/^[0-9a-f]{32}$/.test(String(accountId || ''))) throw new Error('the Cloudflare account id is not 32 hex characters');
  let list = readList(file);
  log(`${path.basename(file)}: ${list.length} email${list.length === 1 ? '' : 's'}.`);
  if (!send) {
    for (const e of list) log(`  ${e.kind}, seat ${e.seat}, ${mask(e.to)}`);
    log('Add --send to send them.');
    return { sent: 0, left: list.length };
  }
  let sent = 0;
  const total = list.length;
  while (list.length) {
    const e = list[0];
    let res;
    let body = null;
    try {
      res = await fetchFn(API(accountId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: e.to, from: FROM, reply_to: REPLY_TO, subject: e.subject, text: e.text }),
      });
      try { body = await res.json(); } catch { body = null; }
    } catch (err) {
      log(`STOP at ${sent + 1}/${total} (${e.kind}, seat ${e.seat}): the request failed (${err?.code || err?.name || 'network'}). ${list.length} left in the file; run again.`);
      return { sent, left: list.length, error: 'network' };
    }
    if (!res.ok || body?.success === false) {
      log(`STOP at ${sent + 1}/${total} (${e.kind}, seat ${e.seat}): Cloudflare said ${res.status}: ${cfErrors(body)}. ${list.length} left in the file; run again.`);
      return { sent, left: list.length, error: String(res.status) };
    }
    list = list.slice(1);
    writeRest(file, list);
    sent += 1;
    log(`sent ${sent}/${total}: ${e.kind}, seat ${e.seat}, ${mask(e.to)}`);
  }
  log(`All ${sent} sent. The file is deleted; delete the server copy too.`);
  return { sent, left: 0 };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error);
    console.error('Usage: node scripts/send-outbox.cjs <founders-YYYYMMDD-source.json> --token-file <path> [--account-id <id>] [--send]');
    return 1;
  }
  try {
    const token = readToken(args.tokenFile);
    const out = await sendOutbox({ file: args.file, token, accountId: args.accountId || process.env.CF_ACCOUNT_ID, send: args.send });
    return out.error ? 2 : 0;
  } catch (err) {
    console.error(`send-outbox: ${err.message}`);
    return 1;
  }
}

module.exports = { sendOutbox, parseArgs, readToken, readList, mask, FROM, REPLY_TO, API };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
