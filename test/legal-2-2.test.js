// Legal 2.2: the founders charge-day rules. A failed card gets a 3-day pay link, then the
// seat is given back and the card deleted; a pay-link payment can come up to 3 days after
// the deadline. If failed cards leave the total short, we may go ahead or refund every
// charged seat. Stripe emails the receipt. A link to collect the Pro key works 30 days.
// Founder seats first renew one year after go-live (not the charge); five-year seats run
// five years from go-live; the go-live date comes by email. The Privacy Policy names the
// new stored items, says founders keys are never stored, and the mandate on Stripe's page
// names the 3-day pay link. After 2.1 comes 2.2, so everyone who accepted 2.1 is asked again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED, CONTACT } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';
import { mandateText, foundersEnv } from '../pro/founders.js';

const terms = readFileSync('legal/terms.md', 'utf8');
const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));
const sub = (md, name) => { const i = md.indexOf(`### ${name}`); return md.slice(i, md.indexOf('\n#', i + 4)); };

test('legal 2.2: the version is 2.2, so everyone who accepted 2.1 is asked again', () => {
  assert.equal(TERMS_VERSION, '2.2');
  assert.equal(LEGAL_UPDATED, '9 October 2026');
  assert.equal(needsConsent(acceptRecord('2.1')), true);
  assert.equal(needsConsent(acceptRecord('2.0')), true);
  assert.equal(needsConsent(acceptRecord(TERMS_VERSION)), false);
  for (const page of [legalPage('terms', terms), legalPage('privacy', privacy)]) assert.match(page, /Version 2\.2\. Last updated 9 October 2026/);
});

test('terms: the charge-day rules sit in the founders seats rules', () => {
  const f = sub(section(terms, 9), 'Founders seats');
  for (const must of [
    '- **If a card fails.** If your card fails on the charge day, we email you a link to pay within 3 days.',
    'If you do not pay within those 3 days, we give the seat back, delete your card and you pay nothing.',
    'A payment by this link can come up to 3 days after the deadline.',
    'If failed cards leave the paid total below the goal, we may still go ahead, or we may refund every charged seat in full.',
    '- **Receipt.** Stripe emails you a receipt for the payment on the charge day, or for your payment by the link.',
    '- **Your Pro key.** After your seat is paid, we email you a link to collect your Pro key. The link works for 30 days. After that, write to {{CONTACT}} for your key.',
    'We tell you the go-live date by email.',
    'The first renewal is one year after the day Pro goes live, not one year after the charge.',
    '- **Five-year seat.** A five-year seat gives five years of Pro from the day Pro goes live, and does not renew.',
  ]) assert.ok(f.includes(must), must);
  // Receipts are promised for the first payment only, never for renewals.
  assert.doesNotMatch(f, /receipt[^.]*renew/i);
  // No long dashes and no 7-day window left from the first draft.
  assert.doesNotMatch(f, /—|7 days|seven days/);
  // The rendered page names the contact address in the key rule.
  const page = legalPage('terms', terms);
  assert.ok(page.includes(`After that, write to <a href="mailto:${CONTACT}">${CONTACT}</a> for your key.`));
});

test('terms: nothing in the founders seats rules contradicts the charge-day rules', () => {
  const f = sub(section(terms, 9), 'Founders seats');
  assert.doesNotMatch(f, /renews? (one year|a year) after the charge/i);
  assert.doesNotMatch(f, /five years (of Pro )?from the (day of the )?charge/i);
  // The deadline rule still says the charge day is no later than the deadline; only the
  // pay link may land after it.
  assert.ok(f.includes('no later than the deadline shown there (15 December 2026)'));
});

test('privacy: the new founders items are named, and founders keys are never stored', () => {
  const p = sub(section(privacy, 3), 'Founders seats');
  for (const must of [
    'the ID of the payment and, for a founder seat, of its yearly subscription',
    'the code Stripe gives if the card fails',
    'a one-way hash of each link we email you to pay or to collect your Pro key (never the link itself)',
    'We prepare the email we send you about the charge, and delete it once it is sent.',
    "We never store your founders seat's Pro key, in plain text or encrypted: the link to collect it makes a new key when you use it.",
    'If your card fails and you do not pay within 3 days, we delete the card and your customer record at Stripe too.',
    'We use your email address to email you about the charge, a failed card, your Pro key and the go-live date.',
    'We send these emails from {{CONTACT}} through Cloudflare.',
  ]) assert.ok(p.includes(must), must);
  // The Pro checkout key copy rule stays true, and founders keys have no copy.
  assert.ok(privacy.includes("| Encrypted copy of your key | Deleted as soon as your browser has saved the key, and at the latest 25 hours after checkout. A founders seat's key is never stored, so it has no copy. |"));
  assert.match(privacy, /\| Founders seats \| If the goal is missed, you give up your seat, or you do not pay within 3 days after a failed charge, we delete the card/);
  assert.match(privacy, /The email we prepare for you about the charge is deleted once it is sent\. \|/);
  assert.ok(section(privacy, 4).includes('- email founders seat holders about the charge, a failed card, their Pro key and the go-live date;'));
});

test('terms and code agree: the mandate names the 3-day pay link, inside Stripe\'s limit', () => {
  const at = foundersEnv({}).deadlineAt;
  for (const cls of ['founder', 'ten']) {
    const t = mandateText(cls, { goalUsd: 17640, deadlineAt: at });
    assert.ok(t.includes('If the card fails, you get 3 days to pay by link.'), cls);
    assert.ok(t.length < 1200, `${cls}: ${t.length}`);
    assert.doesNotMatch(t, /—|7 days/);
  }
  const f = sub(section(terms, 9), 'Founders seats');
  assert.match(f, /link to pay within 3 days/, 'the Terms and the mandate give the same window');
});
