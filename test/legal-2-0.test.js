// Legal 2.0: founders seats, tips and the build guide list. The Terms say what a seat is,
// that Stripe saves the card, that nothing is charged until the goal and no later than the
// deadline, that a missed goal deletes every card, the 30 and 45 day promise, the founder
// price lock, the ten-year seat and its pro-rata refund, one seat per person, no
// transfers, giving a seat up by email, the optional handle, and the data-cost cancel;
// then tips (a gift, not refunded, names reviewed, 365 days) and the guide list. The
// Privacy Policy names what is stored for each, Stripe as the processor, and how long it
// is kept. After 1.9 comes 2.0 (never 1.10), so everyone who accepted 1.9 is asked again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';
import { CLASSES, DEFAULT_GOAL_USD, DEFAULT_DEADLINE, HOLD_MS } from '../pro/founders.js';
import { FISH_DAYS } from '../pro/tips.js';

const terms = readFileSync('legal/terms.md', 'utf8');
const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));
const sub = (md, name) => { const i = md.indexOf(`### ${name}`); return md.slice(i, md.indexOf('\n#', i + 4)); };

test('legal 2.0: the version is 2.0, so everyone who accepted 1.9 is asked again', () => {
  assert.equal(TERMS_VERSION, '2.0');
  assert.notEqual(TERMS_VERSION, '1.10');
  assert.equal(needsConsent(acceptRecord('1.9')), true);
  assert.equal(needsConsent(acceptRecord(TERMS_VERSION)), false);
  for (const page of [legalPage('terms', terms), legalPage('privacy', privacy)]) assert.match(page, new RegExp(`Version 2\\.0\\. Last updated ${LEGAL_UPDATED}`));
});

test('terms: the founders seats rules, inside section 9 (Pro), so the section numbers stay', () => {
  const s9 = section(terms, 9);
  const f = sub(s9, 'Founders seats');
  for (const must of [
    'Seats 1 to 10 are ten-year seats: USD 1,420 once, for ten years of Pro.',
    'Seats 11 to 42 are founder seats: USD 420 a year, renewed every year at USD 420.',
    'Stripe saves your card. We never see or store your full card number. Saving a card is not a payment.',
    'only when the committed seats reach the goal shown on the founders page (USD 17,640), no later than the deadline shown there (15 December 2026)',
    'we delete every saved card at Stripe and nobody is charged.',
    'Pro goes live for the charged seats within 30 days of the charge. If it is not live within 45 days of the charge, we refund every charged seat in full.',
    'renews every year at USD 420 for as long as you keep the seat, even if the Pro price goes up.',
    'gives ten years of Pro from the day Pro goes live, and does not renew. If we discontinue the service before the ten years end, we refund the unused part, pro rata',
    'Each person may hold one seat',
    'Seats cannot be transferred, sold or passed on.',
    'You can give up your seat at any time before the charge by writing to {{CONTACT}}.',
    'It is optional and is shown as plain text on your seat',
    'If the cost of licensed live prices rises so that the goal no longer covers it, we may cancel the founders seats before the charge. We then delete every saved card and nobody pays.',
  ]) assert.ok(f.includes(must), must);
  const t = sub(s9, 'Tips');
  for (const must of ['is a gift to Bloombroke. It is not a seat', 'Tips are not refunded', 'for 365 days', 'We review each fish name before it is shown', 'We may change or remove a name']) assert.ok(t.includes(must), must);
  assert.ok(sub(s9, 'Build guide list').includes('one email when the guide is ready'));
  assert.ok(s9.includes('Nothing in this section limits any right you have under the law'), 'the CPFTA line still covers the section');
  for (const n of [10, 11, 12, 19]) assert.ok(terms.includes(`## ${n}. `), `section ${n} is still there`);
  assert.doesNotMatch(terms, /lifetime/i, 'a ten-year seat, never "lifetime"');
});

test('terms and code agree: the prices, the goal, the deadline, the fish days', () => {
  assert.equal(CLASSES.ten.usd, 1420);
  assert.equal(CLASSES.founder.usd, 420);
  assert.equal(DEFAULT_GOAL_USD, 17640);
  assert.equal(DEFAULT_DEADLINE, '2026-12-15');
  assert.equal(FISH_DAYS, 365);
});

test('privacy: founders seats, tips and the guide list; Stripe named; the retention rows', () => {
  const s3 = section(privacy, 3);
  const f = sub(s3, 'Founders seats');
  for (const must of ['Stripe collects your card details, email address and name, and holds your card.', 'We do not receive your full card number.',
    'your email address, the X handle if you give one, your Stripe customer ID', "the card's fingerprint", 'the time you agreed to the charge terms, which version of these terms you agreed to, and the IP address that started the checkout',
    'to delete the card and your customer record at Stripe if the goal is missed, you give up the seat or the checkout did not give you a seat',
    'if the checkout is not finished, the address is deleted']) assert.ok(f.includes(must), must);
  assert.ok(HOLD_MS < 35 * 60 * 1000, 'the hold is "about 30 minutes"');
  const t = sub(s3, 'Tips');
  for (const must of ['Stripe processes the payment', 'We store the amount, the fish name you typed, whether it was approved, and the time.', 'never who gave the tip']) assert.ok(t.includes(must), must);
  const g = sub(s3, 'Build guide list');
  for (const must of ['kept apart from the Pro waitlist', 'one email when the guide is ready', 'To be taken off the list, write to {{CONTACT}}.', 'We do not store your IP address with it.']) assert.ok(g.includes(must), must);
  assert.ok(s3.includes('The one place we store an IP address is a founders seat'));
  assert.ok(section(privacy, 4).includes('- run founders seats: hold the saved cards, charge them when the goal is reached, or delete them; and take tips and show tip fish;'));
  assert.ok(section(privacy, 6).includes('| Stripe | Pro payments and billing, founders seats (saved cards) and tips |'));
  const s8 = section(privacy, 8);
  for (const row of ['| Founders seats |', '| Tips |', '| Build guide list |']) assert.ok(s8.includes(row), row);
});

test('copy: no em dash, no brand word, no data vendor', () => {
  for (const md of [terms, privacy]) {
    assert.doesNotMatch(md, /—/);
    assert.doesNotMatch(md, new RegExp(['bloom', 'berg'].join(''), 'i'));
  }
});
