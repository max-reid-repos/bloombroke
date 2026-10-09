// Legal 2.3: the founders email list. On the founders page, someone not ready to save a
// card can leave an email address (POST /api/founders/reserve). It holds no seat. We keep
// it to write about the founders seats, a few emails at most, from hello@bloombroke.com
// through Cloudflare Email Sending; it can be deleted on request any time, and the whole
// list goes 30 days after the founders deadline. The Privacy Policy names it in the short
// version, its own part of section 3, the purposes, the rate limits and the retention
// table. The Terms do not change. After 2.2 comes 2.3, so everyone who accepted 2.2 is
// asked again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED, CONTACT } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';
import { DEFAULT_DEADLINE } from '../pro/founders.js';
import { COPY } from '../lib/founders-page.js';

const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));
const sub = (md, name) => { const i = md.indexOf(`### ${name}`); return md.slice(i, md.indexOf('\n#', i + 4)); };

test('legal 2.3: the version is 2.3, so everyone who accepted 2.2 is asked again', () => {
  assert.equal(TERMS_VERSION, '2.3');
  assert.equal(LEGAL_UPDATED, '9 October 2026');
  assert.equal(needsConsent(acceptRecord('2.2')), true);
  assert.equal(needsConsent(acceptRecord('2.1')), true);
  assert.equal(needsConsent(acceptRecord(TERMS_VERSION)), false);
  assert.match(legalPage('privacy', privacy), /Version 2\.3\. Last updated 9 October 2026/);
});

test('privacy: the founders email list, what we keep, why, who sends, and when it goes', () => {
  const p = sub(section(privacy, 3), 'Founders email list');
  assert.ok(p.length > 200, 'its own part of section 3');
  for (const must of [
    'If you leave your email address on the founders page (bloombroke.com/founders) without saving a card, we store it and the time you gave it',
    'It holds no seat.',
    'We keep it to write to you about the founders seats, a few emails at most.',
    'We send them from {{CONTACT}} through Cloudflare (Cloudflare Email Sending).',
    'We do not store your IP address with it.',
    'The founders page shows how many addresses are on the list, never the addresses.',
    'You can ask us to delete your address at any time by writing to {{CONTACT}}.',
    'We delete the whole list 30 days after the founders deadline (15 December 2026), and your address sooner if you ask.',
  ]) assert.ok(p.includes(must), must);
  // The short version, the purposes, the rate limits, the retention table.
  assert.ok(section(privacy, 2).includes('and the few emails about the founders seats you ask for on the founders page.'));
  assert.ok(section(privacy, 2).includes('If you leave your email address on the founders page without saving a card, we write to you about the founders seats, a few emails at most, and delete the address 30 days after the founders deadline.'));
  assert.ok(section(privacy, 4).includes('- write a few emails about the founders seats to the people who left their email address for them on the founders page;'));
  assert.ok(section(privacy, 3).includes('the feedback form, the Pro waitlist and the founders email list (a one hour window)'));
  assert.ok(section(privacy, 8).includes('| Founders email list | Until 30 days after the founders deadline (15 December 2026), then the whole list is deleted. Your address sooner if you ask. |'));
  // The Cloudflare row already names the founders emails it sends.
  assert.ok(section(privacy, 6).includes('sending the founders seat emails from {{CONTACT}} (Cloudflare Email Sending)'));
  // The rendered page names the contact address, and no long dash slipped in.
  const page = legalPage('privacy', privacy);
  assert.ok(page.includes(`writing to <a href="mailto:${CONTACT}">${CONTACT}</a>`));
  assert.doesNotMatch(p, /—/);
});

test('privacy and code agree: the deadline, the page line, no seat held', () => {
  assert.equal(DEFAULT_DEADLINE, '2026-12-15', 'the policy names 15 December 2026');
  assert.match(COPY.reserve, /It holds no seat\./);
  // The page never promises more than the policy: no "one email", no seat, no price.
  assert.doesNotMatch(COPY.reserve + COPY.reserveDone, /one email|reserved|\$/i);
});
