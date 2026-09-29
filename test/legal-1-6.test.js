// Legal 1.6: PINGS. The Privacy Policy says what pings store (a push subscription per
// device, the ping settings, the copy of the alerts while closed-tab alerts are on), who
// delivers them (the browser maker's push service, end to end encrypted), that the
// message text goes only with SHOW MESSAGE TEXT, and how long each is kept; the Terms
// say pings are best effort. Also Ahrefs Web Analytics, named next to DataFast and
// Cloudflare. The version goes up so everyone who accepted 1.5 is asked again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';
import { MAX_FAILS, TEXT_MAX } from '../pro/push-send.js';
import { ENDED_KEEP_MS } from '../pro/store.js';

const terms = readFileSync('legal/terms.md', 'utf8');
const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));
const DAY = 24 * 60 * 60 * 1000;

test('legal 1.6: the version is bumped, so everyone who accepted 1.5 is asked again', () => {
  assert.equal(TERMS_VERSION, '1.6');
  assert.equal(LEGAL_UPDATED, '29 September 2026');
  assert.equal(needsConsent(acceptRecord('1.5')), true);
  assert.equal(needsConsent(acceptRecord('1.6')), false);
  assert.match(legalPage('terms', terms), /Version 1\.6\. Last updated 29 September 2026/);
  assert.match(legalPage('privacy', privacy), /Version 1\.6\./);
});

test('privacy: what pings store, who delivers them, encrypted end to end, message text only when turned on', () => {
  const s3 = section(privacy, 3);
  assert.ok(s3.includes('### Pings'), 'a section of its own');
  for (const must of [
    'your browser gives us a push subscription for that device: an address at the push service of your browser\'s maker (Apple, Google, Mozilla or Microsoft) and the keys that encrypt a ping for that browser only',
    'your ping settings (chat messages, alerts when the tab is closed, show message text)',
    'for each device that has alerts when the tab is closed on, a copy of that device\'s price alert rules (symbol, above or below, level, and whether each one has fired) so that our server can check them with the tab closed and ping that device',
    'its content is encrypted end to end: the push service delivers it but cannot read it',
    'it includes the start of the message text only if you turn on SHOW MESSAGE TEXT',
  ]) assert.ok(s3.includes(must), must);
  assert.ok(section(privacy, 4).includes('- send you the pings you turn on in ME;'));
  assert.ok(section(privacy, 6).includes('| Apple, Google, Mozilla, Microsoft (push services) | Only if you turn on pings'));
  const s8 = section(privacy, 8);
  for (const row of [
    '| Ping subscriptions | Each device\'s push subscription is kept until you turn pings off on that device, log out on it, make a NEW KEY or delete your account, or 30 days after your Pro ends, whichever comes first.',
    'A subscription the push service says is gone, or that fails 5 times in a row, is deleted at once.',
    '| Ping settings and server alerts | Your ping settings are kept until you delete your account, or 30 days after your Pro ends. The copy of a device\'s price alert rules is kept only while alerts when the tab is closed are on for that device, is replaced each time you change the alerts there, and is deleted with that device\'s subscription. |',
  ]) assert.ok(s8.includes(row), row);
  assert.ok(section(privacy, 8).includes('one hour for feedback and for moving a ping subscription'));
  // The numbers match the code.
  assert.equal(MAX_FAILS, 5);
  assert.equal(ENDED_KEEP_MS, 30 * DAY);
  assert.equal(TEXT_MAX, 80);
  assert.ok(readFileSync('public/screens/me.js', 'utf8').includes('the first 80 characters of the message'));
});

test('terms s9: pings and closed-tab alerts are best effort, can be late or missed, not to be relied on', () => {
  const s9 = section(terms, 9);
  assert.ok(s9.includes('- **Pings and closed-tab alerts.** Pings (notifications about CHAT messages and your price alerts while the tab is closed) are best effort.'));
  assert.ok(s9.includes('they can be late or missed. Do not rely on them'));
});

test('privacy: Ahrefs Web Analytics, next to DataFast and Cloudflare: what it records, no cookies, never for Pro, in the tables', () => {
  assert.ok(section(privacy, 2).includes('Ahrefs Web Analytics and Cloudflare count page views without cookies. If your browser sends Global Privacy Control, we load neither DataFast nor Ahrefs Web Analytics.'));
  const s3 = section(privacy, 3);
  for (const must of [
    '- **Ahrefs Web Analytics.** We also count page views with Ahrefs Web Analytics (analytics.ahrefs.com).',
    'It sets no cookies.',
    'It records the pages viewed, the referring page, your approximate country, and your device and browser type.',
    'it is never loaded for Pro users',
  ]) assert.ok(s3.includes(must), must);
  assert.ok(s3.indexOf('**Ahrefs Web Analytics.**') > s3.indexOf('### Analytics') && s3.indexOf('**Ahrefs Web Analytics.**') < s3.indexOf('**Cloudflare Web Analytics.**'), 'with the other analytics');
  assert.ok(section(privacy, 6).includes('| Ahrefs | Page-view analytics (Ahrefs Web Analytics), as described in section 3: no cookies, not loaded when your browser sends GPC, never loaded for Pro users |'));
  assert.ok(section(privacy, 8).includes('| Records kept by Cloudflare, DataFast, Ahrefs and Google | For the periods in their own policies. |'));
});

test('copy: no em dash, no brand word', () => {
  for (const md of [terms, privacy]) {
    assert.doesNotMatch(md, /—/);
    assert.doesNotMatch(md, new RegExp(['bloom', 'berg'].join(''), 'i'));
  }
});
