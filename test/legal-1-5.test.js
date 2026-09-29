// Legal 1.5: ME. Usernames, colours and pixel avatars (chosen by you, no pretending, not
// offensive, we may reset them, the seat never changes), cancelling from ME, NEW KEY,
// DOWNLOAD MY DATA and DELETE MY ACCOUNT, what deletion keeps and removes, and the new
// retention rows. The version goes up so everyone who accepted 1.4 is asked again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';
import { SUBMIT_MESSAGE, SUBMIT_MESSAGE_YEARLY } from '../pro/billing.js';
import { RELEASE_MS, DAY_MS } from '../pro/chat.js';

const terms = readFileSync('legal/terms.md', 'utf8');
const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));

test('legal 1.5: the version is bumped, so everyone who accepted 1.4 is asked again', () => {
  assert.equal(TERMS_VERSION, '1.5');
  assert.equal(LEGAL_UPDATED, '29 September 2026');
  assert.equal(needsConsent(acceptRecord('1.4')), true);
  assert.equal(needsConsent(acceptRecord('1.5')), false);
  assert.match(legalPage('terms', terms), /Version 1\.5\. Last updated 29 September 2026/);
  assert.match(legalPage('privacy', privacy), /Version 1\.5\./);
});

test('terms s9: cancel from ME, NEW KEY, usernames and avatars, deleting the account', () => {
  const s9 = section(terms, 9);
  for (const must of [
    'type ME (or PRO) and press CANCEL, which opens the Stripe billing portal',
    'NEW KEY in ME gives your licence a new key at once: the old key stops working on every device',
    'In ME you can choose a username, a name colour and a pixel avatar',
    'They are chosen by you.',
    'must not pretend to be anyone else',
    'must not be offensive',
    'We may reset a username or an avatar that breaks this.',
    'Your seat number never changes.',
    'A username you give up cannot be taken by anyone else for 30 days.',
    'You can delete your account yourself in ME once no subscription on it will renew: cancel first.',
    'Anyone who has your key can also make a new key or delete your account in ME. If that happens, write to us at {{CONTACT}}.',
  ]) assert.ok(s9.includes(must), must);
  assert.ok(!terms.includes('press MANAGE,'), 'the old "press MANAGE" is gone');
  assert.ok(section(terms, 10).includes('always with their seat number, so nobody can pass for another seat'));
  // The numbers match the code.
  assert.equal(RELEASE_MS, 30 * DAY_MS);
});

test('privacy: what ME stores, NEW KEY, download, delete (kept and removed), retention rows', () => {
  for (const must of [
    'In ME you can download your data and delete your account yourself, at any time, as well as by writing to us.',
    'we store your username, your name colour (one of 8) and your pixel avatar',
    'we keep the old name for 30 days so that nobody else can take it at once',
    'the settings you choose in ME for this device (start screen, clock, chat sound)',
    'NEW KEY in ME gives your licence a new key.',
    'It never holds your key, its hash or any Stripe ID.',
    'We keep the licence record (seat number, Stripe IDs and dates) for the 5 years in section 8',
    'we make your key unusable',
    'the messages and chat requests you sent (except copies inside reports others made, kept as section 8 says)',
    'the username, colour and avatar you choose in ME',
    'DOWNLOAD MY DATA gives you a copy of what we hold about you, and DELETE MY ACCOUNT deletes it',
  ]) assert.ok(privacy.includes(must), must);
  const s8 = section(privacy, 8);
  for (const row of [
    '| Username, colour and avatar | Deleted 30 days after your Pro ends, at once when you delete your account in ME, or sooner if you ask. |',
    '| A username you gave up | Kept 30 days so nobody else takes it at once, then deleted. |',
    '| ME device settings |',
    'If you delete your account in ME, the record stays for the same time, with a key that no longer works.',
  ]) assert.ok(s8.includes(row), row);
  for (const md of [terms, privacy]) {
    assert.doesNotMatch(md, /—/, 'no em dash');
    assert.doesNotMatch(md, new RegExp(['bloom', 'berg'].join(''), 'i'));
  }
});

test('checkout copy: cancel from ME', () => {
  assert.equal(SUBMIT_MESSAGE, 'Auto-renews monthly at $42 USD. Cancel any time: type ME and press CANCEL; access continues to the end of the paid month.');
  assert.equal(SUBMIT_MESSAGE_YEARLY, 'Auto-renews yearly at $420 USD. Cancel any time: type ME and press CANCEL; access continues to the end of the paid year.');
});
