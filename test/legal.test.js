import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { needsConsent, consentStore, acceptRecord, isLegalPath, CONSENT_KEY, CONSENT_TEXT } from '../public/consent.js';
import { TERMS_VERSION, OPERATOR } from '../public/legal-version.js';
import { mountLegal, renderMarkdown, inline, fill } from '../lib/legal.js';
import { parseCommand } from '../public/app.js';
import { HELP_GROUPS } from '../public/screens/help.js';

// The one brand name that must never appear, built so it does not appear here either.
const FORBIDDEN = new RegExp(['bloom', 'berg'].join(''), 'i');

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => m,
  };
}
const broken = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); },
};

test('consent: needed until the current version is accepted', () => {
  assert.equal(needsConsent(null), true);
  assert.equal(needsConsent({}), true);
  assert.equal(needsConsent('yes'), true);
  assert.equal(needsConsent({ version: TERMS_VERSION }), true, 'no time, no acceptance');
  assert.equal(needsConsent(acceptRecord()), false);
  assert.equal(needsConsent(acceptRecord('0.9')), true, 'an older version asks again');
  assert.equal(needsConsent(acceptRecord('1.0'), '1.1'), true, 'a new TERMS_VERSION asks again');
  const r = acceptRecord('2.0', new Date('2026-09-25T10:00:00Z'));
  assert.deepEqual(r, { version: '2.0', acceptedAt: '2026-09-25T10:00:00.000Z' });
});

test('consent: stored in localStorage with its version', () => {
  const local = memoryStorage();
  const session = memoryStorage();
  const store = consentStore({ local, session });
  assert.equal(store.mode, 'local');
  assert.equal(store.get(), null);
  store.set(acceptRecord());
  assert.equal(JSON.parse(local.getItem(CONSENT_KEY)).version, TERMS_VERSION);
  assert.equal(session.getItem(CONSENT_KEY), null);
  // A later visit reads it back and does not ask again.
  assert.equal(needsConsent(consentStore({ local, session }).get()), false);
});

test('consent: blocked localStorage falls back to the session, then to memory', () => {
  const session = memoryStorage();
  const s1 = consentStore({ local: broken, session });
  assert.equal(s1.mode, 'session');
  s1.set(acceptRecord());
  assert.equal(needsConsent(consentStore({ local: broken, session }).get()), false, 'once per session');

  const s2 = consentStore({ local: broken, session: broken });
  assert.equal(s2.mode, 'memory');
  assert.equal(needsConsent(s2.get()), true);
  s2.set(acceptRecord());
  assert.equal(needsConsent(s2.get()), false, 'remembered for this page');
  assert.equal(needsConsent(consentStore({ local: broken, session: broken }).get()), true, 'asked again on the next load');

  const s3 = consentStore({ local: null, session: undefined });
  assert.equal(s3.mode, 'memory');
});

test('consent: garbage in storage asks again instead of throwing', () => {
  const local = memoryStorage();
  local.setItem(CONSENT_KEY, '{not json');
  assert.equal(needsConsent(consentStore({ local }).get()), true);
});

test('consent: never on the legal pages', () => {
  for (const p of ['/terms', '/privacy', '/disclaimer', '/terms/']) assert.equal(isLegalPath(p), true, p);
  for (const p of ['/', '/index.html', '/termsx', '']) assert.equal(isLegalPath(p), false, p);
  assert.match(CONSENT_TEXT.lead, /not investment advice/);
  assert.match(CONSENT_TEXT.body, /18 or older/);
});

test('legal pages: 200, operator named, version and date shown', async () => {
  const app = express();
  mountLegal(app, { build: 'test' });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [path, h1] of [['/terms', 'Terms of Use'], ['/privacy', 'Privacy Policy'], ['/disclaimer', 'Disclaimer']]) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.ok(html.includes(OPERATOR), `${path} names the operator`);
      assert.ok(html.includes(`<h1>${h1}</h1>`), `${path} title`);
      assert.match(html, new RegExp(`Version ${TERMS_VERSION.replace('.', '\\.')}\\. Last updated`));
      assert.match(html, /<link rel="canonical" href="https:\/\/bloombroke\.com\//);
      assert.ok(html.includes('/v/test/legal.css'));
      assert.doesNotMatch(html, /\{\{\w+\}\}/, 'no unfilled placeholders');
      assert.doesNotMatch(html, /class="consent|consent\.js|app\.js/, 'no first-visit notice or app script on legal pages');
      assert.doesNotMatch(html, /\u2014/, 'no em dashes');
      assert.doesNotMatch(html, FORBIDDEN);
    }
    const terms = await (await fetch(`${base}/terms`)).text();
    for (const must of ['Monetary Authority of Singapore', 'Contracts (Rights of Third Parties) Act 2001', 'USD 50', '18 years', 'experimental', 'USD 4.20', 'laws of Singapore']) {
      assert.ok(terms.includes(must), `terms mention ${must}`);
    }
    const privacy = await (await fetch(`${base}/privacy`)).text();
    for (const must of ['Personal Data Protection Act 2012', 'Data Protection Officer', 'Stripe', 'Cloudflare', 'DataFast', 'Hetzner', 'Personal Data Protection Commission', '30 days']) {
      assert.ok(privacy.includes(must), `privacy mentions ${must}`);
    }
    const disclaimer = await (await fetch(`${base}/disclaimer`)).text();
    for (const must of ['investment objectives, your financial situation or your particular needs', 'Past performance does not predict future results', 'experimental project']) {
      assert.ok(disclaimer.includes(must), `disclaimer says ${must}`);
    }
  } finally {
    server.close();
  }
});

test('legal markdown: headings, lists, bold, safe links, emails, placeholders', () => {
  const { title, html } = renderMarkdown('# Title\n\n## 1. Hello there\n\nA **bold** [link](/terms) and [bad](javascript:alert(1)).\n\n- one\n- two\n  wrapped\n\nMail hello@bloombroke.com.');
  assert.equal(title, 'Title');
  assert.match(html, /<h2 id="hello-there">1\. Hello there<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="\/terms">link<\/a>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<ul><li>one<\/li><li>two wrapped<\/li><\/ul>/);
  assert.match(html, /<a href="mailto:hello@bloombroke\.com">hello@bloombroke\.com<\/a>/);
  assert.equal(inline('<script>'), '&lt;script&gt;');
  assert.equal(fill('{{OPERATOR}} {{NOPE}}'), `${OPERATOR} {{NOPE}}`);
});

test('legal text files: no em dashes, no forbidden name', () => {
  for (const f of ['terms.md', 'privacy.md', 'disclaimer.md']) {
    const md = readFileSync(new URL(`../legal/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(md, /\u2014/, `${f}: no em dashes`);
    assert.doesNotMatch(md, FORBIDDEN, f);
  }
});

test('TERMS, PRIVACY and DISCLAIMER are commands, listed in HELP', () => {
  for (const name of ['TERMS', 'PRIVACY', 'DISCLAIMER']) {
    assert.equal(parseCommand(name.toLowerCase()).name, name);
  }
  assert.ok(HELP_GROUPS.includes('Legal'));
});

test('the status bar carries the short legal line and a Terms link', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<span class="legal-line">Not advice<\/span>/);
  assert.match(html, /<a href="\/terms">Terms<\/a>/);
  assert.match(html, /href="\/legal\.css"/);
});
