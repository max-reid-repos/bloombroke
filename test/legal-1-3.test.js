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

test('legal 1.3: the version was bumped, so everyone who accepted 1.2 is asked again (1.4 since: test/legal-1-4.test.js)', () => {
  assert.ok(Number(TERMS_VERSION) >= 1.3);
  assert.ok(LEGAL_UPDATED);
  assert.equal(needsConsent(acceptRecord('1.2')), true);
  assert.equal(needsConsent(acceptRecord(TERMS_VERSION)), false);
});

test('legal pages render tables: a header row, row headers, escaped cells', () => {
  const { html } = renderMarkdown('# T\n\nBefore\n\n| A | B |\n|---|---|\n| **x** | y & <z> |\n| p | q |\n\nAfter');
  assert.match(html, /<p>Before<\/p>\n<div class="legal-table"><table><thead><tr><th scope="col">A<\/th><th scope="col">B<\/th><\/tr><\/thead><tbody><tr><th scope="row"><strong>x<\/strong><\/th><td>y &amp; &lt;z&gt;<\/td><\/tr><tr><th scope="row">p<\/th><td>q<\/td><\/tr><\/tbody><\/table><\/div>\n<p>After<\/p>/);
  assert.match(readFileSync('public/legal.css', 'utf8'), /\.legal-table \{ margin: 0 0 16px; overflow-x: auto; \}/);
});

test('privacy s6: the complete sub-processor table, name, purpose and place', () => {
  const s6 = section(privacy, 6);
  const rows = [...s6.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => m[1].trim()).filter((n) => !/^(Provider|---)$/.test(n));
  assert.deepEqual(rows, ['Stripe', 'Cloudflare', 'DataFast', 'Ahrefs', 'Google (Google Analytics)', 'Hetzner', 'Google (Gmail)', 'Apple, Google, Mozilla, Microsoft (push services)']);
  assert.match(s6, /\| Cloudflare \| Network, security and delivery for every visit, DNS, page-view counts \(Cloudflare Web Analytics\), and routing of email sent to \{\{CONTACT\}\} \|/);
  assert.match(s6, /\| Google \(Gmail\) \| The mailbox that receives email sent to \{\{CONTACT\}\} \|/);
  assert.match(s6, /\| DataFast \| Visit analytics, as described in section 3 \(not loaded when your browser sends GPC\) \| Mostly outside the EU, including the United States, as its data processing terms state \|/);
  assert.ok(!s6.includes('Our email providers'), 'named, not vague');
  assert.ok(s6.includes('We do not share it with advertisers or data brokers.'));
  const html = legalPage('privacy', privacy);
  assert.match(html, /<th scope="row">Google \(Gmail\)<\/th><td>The mailbox that receives email sent to <a href="mailto:hello@bloombroke\.com">hello@bloombroke\.com<\/a><\/td>/);
});

test('privacy s8: the retention table keeps the earlier promises, one row each', () => {
  const s8 = section(privacy, 8);
  const rows = [...s8.matchAll(/^\| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => m[1].trim()).filter((n) => !/^(Data|---)$/.test(n));
  assert.deepEqual(rows, ['IP addresses in our rate limiters', 'Ticker counter', 'Error logs on our server', 'Records kept by Cloudflare, DataFast, Ahrefs and Google', 'Pro licence record', 'Synced data',
    'Encrypted copy of your key', 'Payment records', 'Gift licences', 'Gift code records', 'Feedback', 'Pro waitlist', 'Chat messages', 'Chat reports', 'Chat contacts and blocks',
    'Username, colour and avatar', 'A username you gave up', 'Ping subscriptions', 'Ping settings and server alerts', 'ME device settings', 'Emails', 'Our own counters', 'Your browser storage']);
  for (const kept of ['We aim to delete them within 14 days.', 'for 5 years after your subscription is cancelled', 'Deleted 30 days after your subscription ends, or sooner if you ask.',
    'at the latest 25 hours after checkout', 'normally five years, and are held mainly in Stripe', 'Up to 12 months, then deleted.', 'Until you clear it.']) assert.ok(s8.includes(kept), kept);
});

test('privacy: no AI training, GPC, feature events, Cloudflare counts, our counters, what we publish, MCP inputs, the sponsor strip', () => {
  for (const must of [
    'We do not use your data to train AI models, we do not sell it, and we send no marketing messages except the one email you ask for under "Pro opens soon." on the PRO screen.',
    'If your browser sends a Global Privacy Control (GPC) signal, we do not load DataFast on any page of bloombroke.com.',
    'we send DataFast an event with the feature\'s name and, for some features, a short fixed label, such as how a result was shared. The event itself carries no personal data, but DataFast links it to the same visitor and session cookies as your visits.',
    'Cloudflare, our network provider, adds its own count of page views and page load times.',
    'We publish aggregate visitor numbers on our BBRK screen, including visitor counts by country, from DataFast totals; a country or referring site with fewer than three visitors is not shown on its own, and we publish approximate locations: country totals, and city dots rounded to about 100 km, only for places with three or more visitors in the last seven days; never anything about a single visitor.',
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

test('the code matches: a top country or referrer with fewer than three visitors is never shown on its own', () => {
  assert.equal(GLOBE_MIN, 3);
  const r = {
    month: { data: [{ visitors: 100 }] },
    countries: { data: [{ country: 'United States', visitors: 50 }, { country: 'India', visitors: 3 }, { country: 'Iceland', visitors: 2 }] },
    referrers: { data: [{ referrer: 'news.example', visitors: 9 }, { referrer: 'one-person.example', visitors: 1 }] },
  };
  const a = shapeAudience(r, '2026-09-27');
  assert.deepEqual(a.countries.map((c) => c.name), ['United States', 'India']);
  assert.deepEqual(a.referrers.map((r) => r.name), ['news.example'], 'a referrer with one visitor could point at that visitor');
});

test('the code matches: city dots only for three or more visitors in seven days, rounded to about 100 km', () => {
  const r = {
    globe: { data: [{ country: 'Japan', visitors: 20 }, { country: 'Germany', visitors: 5 }] },
    cities: { data: [{ city: 'Tokyo', visitors: 3 }, { city: 'Osaka', visitors: 2 }, { city: 'Berlin', visitors: 1 }] },
  };
  const g = shapeAudience(r, '2026-09-28').globe;
  assert.deepEqual(g.cities.map((c) => c.name), ['Tokyo']);
  assert.ok(g.cities.every((c) => c.visitors >= 3 && c.at.every(Number.isInteger)));
  assert.doesNotMatch(JSON.stringify(g), /Osaka|Berlin/);
});

// ---- Review fixes -------------------------------------------------------------------------

test('fonts are served from this site: no Google Fonts request on any page, CSP self only', async () => {
  const index = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(index, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(index, /<link rel="stylesheet" href="\/fonts\.css">/);
  const html = legalPage('privacy', privacy, { build: 'b1' });
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(html, /href="\/v\/b1\/fonts\.css"/);
  const css = readFileSync('public/fonts.css', 'utf8');
  assert.doesNotMatch(css, /https?:/, 'every font file is local');
  const files = [...css.matchAll(/url\(\/fonts\/([\w.-]+\.woff2)\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 10);
  for (const f of new Set(files)) assert.equal(readFileSync(`public/fonts/${f}`).subarray(0, 4).toString('latin1'), 'wOF2', f);
  for (const fam of ["'JetBrains Mono'", "'Caveat'"]) assert.ok(css.includes(`font-family: ${fam};`), fam);
  for (const w of [400, 600, 800]) assert.match(css, new RegExp(`font-family: 'JetBrains Mono';\\n  font-style: normal;\\n  font-weight: ${w};`));
  for (const l of ['OFL-JetBrainsMono.txt', 'OFL-Caveat.txt']) assert.match(readFileSync(`public/fonts/${l}`, 'utf8'), /SIL Open Font License, Version 1\.1/);
  const { securityHeaders } = await import('../lib/embed.js');
  const csp = securityHeaders()['Content-Security-Policy'];
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.match(csp, /font-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /googleapis|gstatic/);
  // The share images keep their own TTF files.
  assert.ok(readFileSync('assets/fonts/JetBrainsMono-ExtraBold.ttf').length > 1000);
  assert.doesNotMatch(privacy, /Google Fonts/);
});

test('New York Fed: named in DATA, and its notice is linked with the EFFR on RATES and FEDPATH', async () => {
  const { DATASETS, NYFED } = await import('../lib/provenance.js');
  const row = DATASETS.find((d) => d.id === 'nyfed');
  assert.equal(row.source, 'Federal Reserve Bank of New York');
  assert.equal(NYFED, row.source);
  const { NYFED_NOTICE } = await import('../public/screens/rates.js');
  assert.equal(NYFED_NOTICE, '<p class="src-note">Source: Federal Reserve Bank of New York. <a href="/disclaimer#federal-reserve-bank-of-new-york">See notice</a></p>');
  assert.match(readFileSync('public/screens/rates.js', 'utf8'), /rows\.some\(\(r\) => r\.id === 'EFFR'\) \? NYFED_NOTICE : ''/);
  assert.match(readFileSync('public/screens/fedpath.js', 'utf8'), /Number\.isFinite\(fed\.effective\) \? NYFED_NOTICE : ''/);
  const disclaimer = readFileSync('legal/disclaimer.md', 'utf8');
  const { html } = renderMarkdown(disclaimer);
  assert.match(html, /<h3 id="federal-reserve-bank-of-new-york">Federal Reserve Bank of New York<\/h3>/, 'the link target');
  assert.match(disclaimer, /name US government sources, a few public-domain sources, and credits a licence requires/);
  assert.match(disclaimer, /Headlines: news publishers and online forums,/);
});

test('registry sources name government agencies, never FRED or private series owners', () => {
  // Sources live in registry-detail.js (HELP's long text), the rest in registry.js.
  const reg = readFileSync('public/registry.js', 'utf8') + readFileSync('public/registry-detail.js', 'utf8');
  assert.doesNotMatch(reg, /source: '[^']*\b(FRED|Cass|ATA)\b/);
  assert.match(reg, /source: 'US Bureau of Labor Statistics \(CPI-U\)'/);
  assert.match(reg, /source: 'Public web data: freight, truck tonnage and rail carload indexes'/);
});
