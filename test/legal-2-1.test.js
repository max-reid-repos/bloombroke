// Legal 2.1: the ten-year founders seat became a five-year seat (seats 1 to 10, still
// USD 1,420 once), and Stripe Checkout no longer asks for an X handle (Stripe allows no
// custom fields in setup mode). The Terms say five years everywhere in the Founders
// seats rules, never ten, and the handle line no longer promises a checkout field.
// After 2.0 comes 2.1, so everyone who accepted 2.0 is asked again.
// 2.2 added the charge-day rules: test/legal-2-2.test.js holds that wording.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';
import { CLASSES, mandateText } from '../pro/founders.js';
import { CLASS_COPY } from '../lib/founders-page.js';

const terms = readFileSync('legal/terms.md', 'utf8');
const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));
const sub = (md, name) => { const i = md.indexOf(`### ${name}`); return md.slice(i, md.indexOf('\n#', i + 4)); };

test('legal 2.1: the version is 2.1 or later, so everyone who accepted 2.0 is asked again', () => {
  const [major, minor] = TERMS_VERSION.split('.').map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 1), TERMS_VERSION);
  assert.equal(needsConsent(acceptRecord('2.0')), true);
  assert.equal(needsConsent(acceptRecord(TERMS_VERSION)), false);
  for (const page of [legalPage('terms', terms), legalPage('privacy', privacy)]) assert.match(page, new RegExp(`Version ${TERMS_VERSION.replace('.', '\\.')}\\. Last updated ${LEGAL_UPDATED}`));
});

test('terms: the founders seats rules say five years for seats 1 to 10, never ten', () => {
  const f = sub(section(terms, 9), 'Founders seats');
  for (const must of [
    'Seats 1 to 10 are five-year seats: USD 1,420 once, for five years of Pro.',
    '- **Five-year seat.** A five-year seat gives five years of Pro from the day Pro goes live, and does not renew.',
    'If we discontinue the service before the five years end, we refund the unused part, pro rata',
  ]) assert.ok(f.includes(must), must);
  assert.doesNotMatch(f, /ten-year|ten years|10 years|10-year/i);
  assert.doesNotMatch(terms, /ten-year seat|ten years of Pro/i);
});

test('terms: the handle is optional and no longer promised at checkout', () => {
  const f = sub(section(terms, 9), 'Founders seats');
  assert.ok(f.includes('- **Your handle.** If you give us an X handle for your seat, it is shown as plain text on your seat on the founders page. It is optional.'));
  assert.doesNotMatch(f, /at checkout you can add/i);
  assert.ok(sub(section(privacy, 3), 'Founders seats').includes('the X handle if you give one'), 'the privacy line stays conditional');
});

test('terms and code agree: the five-year seat name, price and mandate', () => {
  assert.equal(CLASSES.ten.usd, 1420, 'the price is unchanged');
  assert.equal(CLASSES.ten.name, 'five-year seat');
  assert.equal(CLASS_COPY.ten.name, 'Five-year seat');
  assert.equal(CLASS_COPY.ten.line, 'Seats 1 to 10. Five years of Pro.');
  assert.equal(CLASS_COPY.ten.button, 'Save a five-year seat');
  assert.match(mandateText('ten'), /once for this five-year seat/);
  assert.doesNotMatch(mandateText('ten'), /ten-year/);
});
