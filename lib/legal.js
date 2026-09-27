// The legal pages: /terms, /privacy and /disclaimer. Each page's text lives in one
// Markdown file in legal/, rendered to HTML once at boot. The version and date come
// from public/legal-version.js, the same module the first-visit notice reads.
//
// The Markdown is deliberately small: # headings, paragraphs, "- " lists, **bold**,
// [links](/terms) and {{OPERATOR}} {{CONTACT}} {{VERSION}} {{UPDATED}} placeholders.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERMS_VERSION, LEGAL_UPDATED, OPERATOR, CONTACT } from '../public/legal-version.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'legal');
const SITE = 'https://bloombroke.com';

export const LEGAL_PAGES = {
  terms: { file: 'terms.md', title: 'Terms of Use', description: `The terms for using ${OPERATOR}. Information only, not investment advice.` },
  privacy: { file: 'privacy.md', title: 'Privacy Policy', description: `How ${OPERATOR} collects, uses and protects personal data, under Singapore's PDPA.` },
  disclaimer: { file: 'disclaimer.md', title: 'Disclaimer', description: 'Bloombroke gives general market information only. It is not investment advice, and data may be delayed or wrong.' },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only site paths, https links and mailto: become links.
function safeUrl(u) {
  return /^(\/[\w\-/#?=&.]*|https:\/\/[\w\-.]+(\/[\w\-/#?=&.%]*)?|mailto:[\w.+-]+@[\w.-]+)$/.test(u) ? u : null;
}

const EMAIL_RE = /\b([\w.+-]+@[\w-]+\.[\w.-]*\w)\b/g;

// Inline Markdown on already-escaped text: **bold**, [text](url), bare email addresses.
export function inline(text) {
  let out = esc(text);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const links = [];
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'));
    if (!u) return label;
    links.push(`<a href="${esc(u)}"${u.startsWith('https://') ? ' rel="noopener noreferrer"' : ''}>${label}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  out = out.replace(EMAIL_RE, '<a href="mailto:$1">$1</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => links[Number(i)]);
}

const slug = (s) => String(s).toLowerCase().replace(/^\d+\.\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function fill(md, vars = {}) {
  const v = { OPERATOR, CONTACT, VERSION: TERMS_VERSION, UPDATED: LEGAL_UPDATED, ...vars };
  return String(md).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? v[k] : m));
}

// Markdown -> { title, html }. The first # heading is the page title, not in html.
export function renderMarkdown(md) {
  const lines = String(md).replace(/\r/g, '').split('\n');
  const out = [];
  let title = '';
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flushPara(); flushList();
      const level = m[1].length;
      if (level === 1 && !title) { title = m[2]; continue; }
      out.push(`<h${level} id="${slug(m[2])}">${inline(m[2])}</h${level}>`);
      continue;
    }
    if ((m = /^(-|\d+\.)\s+(.*)$/.exec(line))) {
      flushPara();
      const tag = m[1] === '-' ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(m[2]);
      continue;
    }
    if (list && /^\s+\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return { title, html: out.join('\n') };
}

const NAV = [['terms', 'Terms'], ['privacy', 'Privacy'], ['disclaimer', 'Disclaimer']];

export function legalPage(key, md, { build = '' } = {}) {
  const page = LEGAL_PAGES[key];
  const { title, html } = renderMarkdown(fill(md));
  const heading = title || page.title;
  const asset = (f) => (build ? `/v/${build}/${f}` : `/${f}`);
  const nav = NAV.map(([k, label]) => `<a href="/${k}"${k === key ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const docTitle = `${heading} | Bloombroke`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(docTitle)}</title>
  <meta name="description" content="${esc(page.description)}">
  <meta name="theme-color" content="#05080C">
  <meta name="color-scheme" content="dark">
  <link rel="canonical" href="${SITE}/${key}">
  <meta property="og:title" content="${esc(docTitle)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}/${key}">
  <meta property="og:image" content="${SITE}/og/default.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&display=swap">
  <link rel="stylesheet" href="${asset('legal.css')}">
  <script type="module" src="${asset('goal.js')}"></script>
</head>
<body class="legal-body">
  <header class="legal-top">
    <a class="legal-mark" href="/">BLOOMBROKE</a>
    <nav class="legal-nav" aria-label="Legal">${nav}</nav>
  </header>
  <main class="legal">
    <p class="legal-cmd" aria-hidden="true">&gt; ${esc(key.toUpperCase())}</p>
    <h1>${inline(heading)}</h1>
    <p class="legal-meta">Version ${esc(TERMS_VERSION)}. Last updated ${esc(LEGAL_UPDATED)}.</p>
    ${html}
  </main>
  <footer class="legal-foot">
    <p>${esc(OPERATOR)}. <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a></p>
    <p>Information only. Not investment advice. Data may be delayed.</p>
    <p><a href="/">Back to the terminal</a></p>
  </footer>
</body>
</html>
`;
}

// Read and render every page once. Returns { terms: html, privacy: html, disclaimer: html }.
export function buildLegalPages({ build = '', legalDir = dir } = {}) {
  return Object.fromEntries(Object.entries(LEGAL_PAGES).map(([key, p]) => [key, legalPage(key, readFileSync(path.join(legalDir, p.file), 'utf8'), { build })]));
}

// GET /terms, /privacy, /disclaimer (a trailing slash works too).
export function mountLegal(app, { build = '' } = {}) {
  const pages = buildLegalPages({ build });
  for (const key of Object.keys(pages)) {
    app.get([`/${key}`, `/${key}/`], (req, res) => {
      res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }).send(pages[key]);
    });
  }
  return pages;
}
