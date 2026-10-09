// Legal 1.9: the Pro waitlist. The Privacy Policy says what is stored (the email address
// and the time), why (one email when Pro opens), that nothing else is sent, how to be
// taken off (write to the contact address), that the list is deleted after that email
// or on request, that no IP address is stored with it and analytics never get the
// address. The version goes up so everyone who accepted 1.7 is asked again. 1.8 is
// skipped on purpose: the parked google-login branch already carries a different 1.8.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED, CONTACT } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';

const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));

test('legal 1.9: the version is bumped, so everyone who accepted 1.7 is asked again', () => {
  const [major, minor] = TERMS_VERSION.split('.').map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 9), TERMS_VERSION);
  assert.notEqual(TERMS_VERSION, '1.8', '1.8 belongs to the google-login branch');
  assert.equal(needsConsent(acceptRecord('1.7')), true);
  assert.equal(needsConsent(acceptRecord(TERMS_VERSION)), false);
  const v = TERMS_VERSION.replace('.', '\\.');
  assert.match(legalPage('privacy', privacy), new RegExp(`Version ${v}\\. Last updated ${LEGAL_UPDATED}`));
});

test('privacy: the Pro waitlist in the short version, section 3, the purposes, the limiter and the retention table', () => {
  assert.ok(section(privacy, 2).includes('- If you leave your email address under "Pro opens soon." on the PRO screen, we send it one email when Pro opens, and nothing else.'));
  const s3 = section(privacy, 3);
  const w = s3.slice(s3.indexOf('### Pro waitlist'), s3.indexOf('### CHAT'));
  for (const must of [
    'We store your email address and the time you gave it.',
    'We use it only to send you one email when Pro opens, and we send nothing else to it.',
    'We do not store your IP address with it, and our analytics tools get only a note that someone joined the list, never your email address.',
    'To be taken off the list, write to {{CONTACT}}.',
    'We delete the whole list once that email has been sent, and your address sooner if you ask.',
  ]) assert.ok(w.includes(must), must);
  assert.ok(s3.includes('the feedback form, the Pro waitlist and the founders email list (a one hour window)'));
  assert.ok(section(privacy, 4).includes('- send the one email when Pro opens to the people who asked for it on the PRO screen;'));
  assert.ok(section(privacy, 8).includes('| Pro waitlist | Until the email that Pro is open has been sent, then the whole list is deleted. Your address sooner if you ask. |'));
  assert.match(legalPage('privacy', privacy), new RegExp(`To be taken off the list, write to <a href="mailto:${CONTACT.replace('.', '\\.')}">`));
});

test('privacy: what the policy promises matches the code', async () => {
  const { PER_IP } = await import('../pro/waitlist.js');
  assert.equal(PER_IP, 5);
  const wl = readFileSync('pro/waitlist.js', 'utf8');
  assert.match(wl, /windowMs: HOUR/);
  assert.doesNotMatch(wl, /INSERT INTO waitlist \([^)]*ip/i, 'no IP address stored');
  const sql = readFileSync('migrations/019_waitlist.sql', 'utf8');
  assert.doesNotMatch(sql, /\bip\b/i);
});

test('copy: no em dash, no brand word', () => {
  assert.doesNotMatch(privacy, /—/);
  assert.doesNotMatch(privacy, new RegExp(['bloom', 'berg'].join(''), 'i'));
});
