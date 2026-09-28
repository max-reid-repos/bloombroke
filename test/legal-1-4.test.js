// Legal 1.4: CHAT. The Terms get a Messages section (sections after it move up by one),
// the Privacy Policy says what CHAT stores and for how long, and the version goes up so
// everyone who accepted 1.3 is asked again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';
import { KEEP_MS, REPORT_KEEP_MS, SNAPSHOT, DAY_MS } from '../pro/chat.js';
import { ENDED_KEEP_MS } from '../pro/store.js';

const terms = readFileSync('legal/terms.md', 'utf8');
const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));

test('legal 1.4: the version is bumped, so everyone who accepted 1.3 is asked again', () => {
  assert.equal(TERMS_VERSION, '1.4');
  assert.equal(LEGAL_UPDATED, '28 September 2026');
  assert.equal(needsConsent(acceptRecord('1.3')), true);
  assert.equal(needsConsent(acceptRecord('1.4')), false);
  assert.match(legalPage('terms', terms), /Version 1\.4\. Last updated/);
});

test('terms s10 Messages: plain words, the rules, reports, 30 days', () => {
  const s10 = section(terms, 10);
  assert.match(s10, /^## 10\. Messages/);
  for (const must of [
    'CHAT carries private messages between Pro members who added each other by seat number.',
    'We do not write, rank or recommend anything in a message, and nothing in a message is advice from us.',
    'Do not use CHAT for paid tips or signals, pump schemes, spam, harassment or anything illegal.',
    'Links, images and files are not allowed.',
    'If a chat is reported, we may read the reported messages.',
    'We may close CHAT or Pro access for anyone who breaks these rules',
    'Messages are deleted after 30 days.',
  ]) assert.ok(s10.includes(must), must);
  // Every section after it moved up by one, and the cross references with them.
  const heads = [...terms.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(heads.slice(9), ['10 Messages', '11 Changes to the service', '12 Suspension and termination', '13 No warranties', '14 Limits on our responsibility',
    '15 Indemnity', '16 Claims and governing law', '17 Changes to these terms', '18 General', '19 Contact']);
  assert.ok(terms.includes('Sections 3, 6, 7, 8, 13, 14, 15, 16 and 18 continue after these terms end.'));
  assert.ok(section(terms, 9).includes('Other Pro members can type it to send you a CHAT request (section 10).'));
  assert.ok(section(terms, 9).includes('A seat number is for display only'), 'a seat is still no login');
  for (const md of [terms, privacy]) {
    assert.doesNotMatch(md, /—/, 'no em dash');
    assert.doesNotMatch(md, new RegExp(['bloom', 'berg'].join(''), 'i'));
  }
});

test('privacy: what CHAT stores, who sees it, reports, and the retention rows match the code', () => {
  for (const must of [
    'CHAT messages between Pro members are seen only by the people in that chat, unless a chat is reported, and are deleted after 30 days.',
    'we store your seat number, the display name you choose',
    'we also store that ticker\'s price at the moment you sent it',
    'A message is shown only to the people in that chat.',
    `we store a copy of the last ${SNAPSHOT} messages of that chat, who reported it, the seats in it and the reason given`,
    'carry CHAT messages',
  ]) assert.ok(privacy.includes(must), must);
  const s8 = section(privacy, 8);
  assert.ok(s8.includes('| Chat messages | Deleted 30 days after they were sent. Chat requests are deleted after 30 days too. |'));
  assert.ok(s8.includes('| Chat reports | Up to 12 months, then deleted. |'));
  assert.ok(s8.includes('| Chat name, contacts and blocks | Deleted 30 days after your Pro ends, or sooner if you ask. |'));
  assert.equal(KEEP_MS, 30 * DAY_MS);
  assert.equal(REPORT_KEEP_MS, 365 * DAY_MS);
  assert.equal(ENDED_KEEP_MS, 30 * DAY_MS);
});
