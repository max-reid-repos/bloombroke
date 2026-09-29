// Legal 1.7: Google Analytics. The Privacy Policy says it runs next to DataFast, sets
// first-party cookies (_ga, _ga_*), gets only a command's name (and a ticker or item),
// has Google Signals and ad personalisation off, runs for free visitors only and is
// skipped with GPC; it is in the sub-processor table and the ways to stop it. The version
// goes up so everyone who accepted 1.6 is asked again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';

const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));

test('legal 1.7: the version is bumped, so everyone who accepted 1.6 is asked again', () => {
  assert.equal(TERMS_VERSION, '1.7');
  assert.equal(LEGAL_UPDATED, '29 September 2026');
  assert.equal(needsConsent(acceptRecord('1.6')), true);
  assert.equal(needsConsent(acceptRecord('1.7')), false);
  assert.match(legalPage('privacy', privacy), /Version 1\.7\. Last updated 29 September 2026/);
});

test('privacy: Google Analytics in the short version, with the analytics, in the tables and the ways to stop it', () => {
  assert.ok(section(privacy, 2).includes('- We count visits with DataFast and Google Analytics; Ahrefs Web Analytics and Cloudflare count page views without cookies. If your browser sends Global Privacy Control, we load none of DataFast, Google Analytics and Ahrefs Web Analytics.'));
  const s3 = section(privacy, 3);
  for (const must of [
    '- **Google Analytics.** We also count visits with Google Analytics, a service of Google.',
    'It sets first-party cookies named _ga and _ga_ followed by a code, which last up to two years',
    'For each screen it gets only the command\'s name and, for stock, chart, WHATIF and GRAVEYARD screens, the ticker or item and range, and campaign tags from the link you arrived on; never anything else you type, such as keys, gift codes, amounts, messages, usernames or email addresses.',
    'and the same feature events we send DataFast, plus one share event when you copy or share a link or image.',
    'We have turned Google Signals and ad personalisation off, so this data is not linked to Google accounts and is not used for ads.',
    'Google Analytics runs for free visitors only: it starts only after you accept on the first-visit card, it is never loaded for Pro users, and it is not loaded when your browser sends GPC.',
  ]) assert.ok(s3.includes(must), must);
  const at = s3.indexOf('**Google Analytics.**');
  assert.ok(at > s3.indexOf('**Ahrefs Web Analytics.**') && at < s3.indexOf('**Cloudflare Web Analytics.**'), 'with the other analytics');
  assert.ok(section(privacy, 5).includes('You can also stop DataFast and Google Analytics by turning on Global Privacy Control in your browser, or by blocking cookies or scripts from datafa.st and googletagmanager.com; the terminal keeps working.'));
  assert.ok(section(privacy, 6).includes('| Google (Google Analytics) | Visit analytics, as described in section 3: first-party cookies, Google Signals and ad personalisation off, not loaded when your browser sends GPC, never loaded for Pro users | United States, among other places |'));
  assert.ok(section(privacy, 8).includes('| Records kept by Cloudflare, DataFast, Ahrefs and Google | For the periods in their own policies. |'));
  assert.ok(privacy.includes('Google Analytics counts clicks on sponsor links as a feature event.'));
});

test('privacy: what the policy promises matches the code (config, gates, host)', () => {
  const goal = readFileSync('public/goal.js', 'utf8');
  const ga4 = readFileSync('public/ga4.js', 'utf8');
  assert.match(ga4, /gtag\('config', id, \{\s+send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,/);
  assert.match(goal, /if \(!consented\(\)\) \{/, 'GA4 waits for the first-visit card');
  assert.match(goal, /export function loadGa4[\s\S]*?if \(analyticsBlocked\(\{ doc, nav, win, pro \}\)\) return false;/);
});

test('copy: no em dash, no brand word', () => {
  assert.doesNotMatch(privacy, /—/);
  assert.doesNotMatch(privacy, new RegExp(['bloom', 'berg'].join(''), 'i'));
});
