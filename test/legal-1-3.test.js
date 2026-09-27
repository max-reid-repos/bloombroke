// Legal 1.3: sources by class, the sub-processor and retention tables, GPC, feature
// events, our own counters, what we publish, MCP inputs, and the legal-page tables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdown, legalPage } from '../lib/legal.js';
import { TERMS_VERSION, LEGAL_UPDATED } from '../public/legal-version.js';
import { needsConsent, acceptRecord } from '../public/consent.js';
import { shapeAudience, GLOBE_MIN } from '../lib/datafast.js';
import { GOALS, GOAL_PROPS, loadDataFast } from '../public/goal.js';

const privacy = readFileSync('legal/privacy.md', 'utf8');
const section = (md, n) => md.slice(md.indexOf(`## ${n}.`), md.indexOf(`## ${n + 1}.`));

test('legal 1.3: the version is bumped, so everyone who accepted 1.2 is asked again', () => {
  assert.equal(TERMS_VERSION, '1.3');
  assert.equal(LEGAL_UPDATED, '27 September 2026');
  assert.equal(needsConsent(acceptRecord('1.2')), true);
  assert.equal(needsConsent(acceptRecord('1.3')), false);
});

test('legal pages render tables: a header row, row headers, escaped cells', () => {
  const { html } = renderMarkdown('# T\n\nBefore\n\n| A | B |\n|---|---|\n| **x** | y & <z> |\n| p | q |\n\nAfter');
  assert.match(html, /<p>Before<\/p>\n<div class="legal-table"><table><thead><tr><th scope="col">A<\/th><th scope="col">B<\/th><\/tr><\/thead><tbody><tr><th scope="row"><strong>x<\/strong><\/th><td>y &amp; &lt;z&gt;<\/td><\/tr><tr><th scope="row">p<\/th><td>q<\/td><\/tr><\/tbody><\/table><\/div>\n<p>After<\/p>/);
  assert.match(readFileSync('public/legal.css', 'utf8'), /\.legal-table \{ margin: 0 0 16px; overflow-x: auto; \}/);
});

test('privacy s6: the complete sub-processor table, name, purpose and place', () => {
  const s6 = section(privacy, 6);
  const rows = [...s6.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => m[1].trim()).filter((n) => !/^(Provider|---)$/.test(n));
  assert.deepEqual(rows, ['Stripe', 'Cloudflare', 'DataFast', 'Hetzner', 'Google (Gmail)']);
  assert.match(s6, /\| Cloudflare \| Network, security and delivery for every visit, DNS, page-view counts \(Cloudflare Web Analytics\), and routing of email sent to \{\{CONTACT\}\} \|/);
  assert.match(s6, /\| Google \(Gmail\) \| The mailbox that receives email sent to \{\{CONTACT\}\} \|/);
  assert.match(s6, /\| DataFast \| Visit analytics, as described in section 3 \(not loaded when your browser sends GPC\) \| United States \|/);
  assert.ok(!s6.includes('Our email providers'), 'named, not vague');
  assert.ok(s6.includes('We do not share it with advertisers or data brokers.'));
  const html = legalPage('privacy', privacy);
  assert.match(html, /<th scope="row">Google \(Gmail\)<\/th><td>The mailbox that receives email sent to <a href="mailto:hello@bloombroke\.com">hello@bloombroke\.com<\/a><\/td>/);
});

test('privacy s8: the retention table keeps the earlier promises, one row each', () => {
  const s8 = section(privacy, 8);
  const rows = [...s8.matchAll(/^\| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => m[1].trim()).filter((n) => !/^(Data|---)$/.test(n));
  assert.deepEqual(rows, ['IP addresses in our rate limiters', 'Ticker counter', 'Error logs on our server', 'Records kept by Cloudflare, DataFast and Google', 'Pro licence record', 'Synced data',
    'Encrypted copy of your key', 'Payment records', 'Gift licences', 'Gift code records', 'Feedback', 'Emails', 'Our own counters', 'Your browser storage']);
  for (const kept of ['We aim to delete them within 14 days.', 'for 5 years after your subscription is cancelled', 'Deleted 30 days after your subscription ends, or sooner if you ask.',
    'at the latest 25 hours after checkout', 'normally five years, and are held mainly in Stripe', 'Up to 12 months, then deleted.', 'Until you clear it.']) assert.ok(s8.includes(kept), kept);
});

test('privacy: no AI training, GPC, feature events, Cloudflare counts, our counters, what we publish, MCP inputs, the sponsor strip', () => {
  for (const must of [
    'We do not use your data to train AI models, we do not sell it, and we do not send marketing messages.',
    'If your browser sends a Global Privacy Control (GPC) signal, we do not load DataFast on any page of bloombroke.com.',
    'we send DataFast an event with the feature\'s name and, for some features, a short fixed label, such as how a result was shared. These events contain no personal data.',
    'Cloudflare, our network provider, adds its own count of page views and page load times.',
    'We publish aggregate visitor numbers on our BBRK screen, including visitor counts by country, from DataFast totals; a country with fewer than three visitors is not shown on its own, and we never publish cities or anything about a single visitor.',
    'We do not store the inputs a tool is called with: our logs keep only the tool name and whether the call worked.',
    'We also count, in total, how many times sponsor-strip lines were shown and clicked; nothing is kept per person.',
  ]) assert.ok(privacy.includes(must), must);
  assert.ok(!privacy.includes('We use one analytics service'), 'Cloudflare also counts page views');
  assert.doesNotMatch(privacy, /—/);
});

test('the code matches: GPC stops DataFast, events carry short fixed labels only', () => {
  const doc = { documentElement: { classList: { contains: () => false } }, querySelector: () => null, createElement: () => { throw new Error('no script with GPC'); }, head: { appendChild() {} } };
  assert.equal(loadDataFast({ doc, nav: { globalPrivacyControl: true }, win: {} }), false);
  assert.ok(GOALS.every((g) => /^[a-z_]+$/.test(g)));
  for (const keys of Object.values(GOAL_PROPS)) assert.ok(keys.length <= 1 && keys.every((k) => /^[a-z]+$/.test(k)));
});

test('the code matches: a top country with fewer than three visitors is never shown on its own', () => {
  assert.equal(GLOBE_MIN, 3);
  const r = {
    month: { data: [{ visitors: 100 }] },
    countries: { data: [{ country: 'United States', visitors: 50 }, { country: 'India', visitors: 3 }, { country: 'Iceland', visitors: 2 }] },
    referrers: { data: [{ referrer: 'x.com', visitors: 1 }] },
  };
  const a = shapeAudience(r, '2026-09-27');
  assert.deepEqual(a.countries.map((c) => c.name), ['United States', 'India']);
  assert.equal(a.referrers.length, 1, 'referrers are sites, not places: unchanged');
});
