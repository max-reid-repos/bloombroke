// Embeds: one line of HTML for newsletters and blogs.
//
//   /embed/whatif?c=WHATIF+IPHONE6  a WHATIF result card: the certificate, the number,
//                                   one sentence and the footer. Drawn on the server, no
//                                   script.
//   /embed/guess                    today's GUESS, playable (public/embed-guess.js, the
//                                   same /api/guess routes as the screen).
//
// These are the only pages another site may frame: /embed/* answers with
// frame-ancestors * and no X-Frame-Options; every other route keeps the site's own
// headers (lib/embed.js securityHeaders). An embed loads nothing from another site: no
// analytics, no web fonts from Google, no cookies. The footer (source, not advice, a
// link to bloombroke.com) is part of the page and no parameter turns it off: the pages
// read no parameter but c.

import express from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from './og.js';
import { seoItem, seoWords } from './whatif-seo.js';
import { whatifTokens } from '../data/whatif-cert.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const EMBED_SOURCE = 'Prices: daily closes from a market data provider, split-adjusted, price only.';
export const EMBED_NOT_ADVICE = 'Hindsight. Not financial advice.';
export const EMBED_WAIT_MS = 6000;
// Every embed page carries its own CSP nonce, so no shared cache keeps it.
export const PAGE_CACHE = 'private, max-age=600';
export const NO_EMBED = 'There is no embed here.';

// The fonts the certificate is drawn in, served from here (the site itself loads them
// from Google Fonts, which an embed does not).
const FONTS = {
  'mono-500.ttf': 'JetBrainsMono-Medium.ttf',
  'mono-800.ttf': 'JetBrainsMono-ExtraBold.ttf',
  'hand-700.ttf': 'Caveat-Bold.ttf',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// The headers for every /embed/* response: framable anywhere, nothing from elsewhere.
export function embedHeaders(nonce) {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'self'",
      `style-src 'nonce-${nonce}'`,
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      'frame-ancestors *',
    ].join('; '),
    'X-Robots-Tag': 'noindex',
  };
}

// The footer: the same on every embed, whatever the query says.
export function embedFooter(href) {
  return `<footer class="em-foot"><span>${esc(EMBED_SOURCE)}</span><span>${esc(EMBED_NOT_ADVICE)}</span><a href="${esc(href)}" target="_blank" rel="noopener">bloombroke.com</a></footer>`;
}

const BASE_CSS = `
@font-face { font-family: 'EmMono'; src: url('/embed/fonts/mono-500.ttf') format('truetype'); font-weight: 500; font-display: swap; }
@font-face { font-family: 'EmMono'; src: url('/embed/fonts/mono-800.ttf') format('truetype'); font-weight: 800; font-display: swap; }
@font-face { font-family: 'EmHand'; src: url('/embed/fonts/hand-700.ttf') format('truetype'); font-weight: 700; font-display: swap; }
:root {
  --bg: #05080C; --panel: #0A0F15; --panel-2: #10161E; --panel-3: #141D27; --rule: #161F29; --rule-strong: #2B3847;
  --text: #CFEAFF; --text-2: #A9C6DB; --dim: #7C93A8; --faint: #4B5B6B;
  --accent: #6CCBFF; --accent-tint: rgba(108, 203, 255, .1); --ink: #030609;
  --up: #3DDC84; --down: #FF5C5C;
  --font: 'EmMono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: var(--font); font-weight: 500; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.em { height: 100%; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 9px; border: 1px solid var(--rule-strong); }
.em-top { flex: 0 0 auto; display: flex; align-items: baseline; gap: 12px; min-width: 0; font-size: 11px; letter-spacing: .06em; white-space: nowrap; }
.em-brand { font-weight: 800; letter-spacing: .18em; }
.em-cmd { color: var(--text); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.em-foot {
  flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1px 10px;
  padding-top: 6px; border-top: 1px solid var(--rule-strong); font-size: 10px; line-height: 14px; color: var(--dim);
}
.em-foot a { font-weight: 800; }
.em-msg { flex: 1 1 auto; min-height: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); margin: 0; }
`;

const CERT_CSS = `
.em-main { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.em-certbox { flex: 1 1 auto; min-height: 0; container-type: size; display: flex; align-items: center; justify-content: center; }
.em-cert { position: relative; flex: none; container-type: inline-size; width: min(94cqw, 141cqh); aspect-ratio: 3 / 2; margin-left: 3%; }
.em-paper { display: block; width: 100%; height: 100%; }
.wc { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; text-align: center; line-height: 1; color: #2A1A10; }
.wc-receipt { left: 7.33%; top: 13.3%; transform: rotate(-15deg); transform-origin: top left; display: flex; flex-direction: column; text-align: left; font-size: .92cqw; line-height: 2.18cqw; font-weight: 800; color: #5A4330; }
.wc-ribbon { left: 49.6%; top: 20.2%; font-family: 'EmHand', cursive; font-weight: 700; }
.wc-big { left: 49%; top: 43.5%; font-weight: 800; letter-spacing: -.04em; transform: translate(-50%, -50%) rotate(-1.5deg); }
.is-loss .wc-big { color: #C23B2A; }
.wc-today { left: 49%; top: 56.5%; font-family: 'EmHand', cursive; font-weight: 700; font-size: 3.4cqw; color: #5A4330; }
.wc-l1, .wc-l2 { left: 49.9%; }
.wc-l1 { top: calc(71.3% - .62em); font-weight: 800; }
.wc-l2 { top: calc(76.9% - .62em); color: #5A4330; }
.wc-mult { left: 82.5%; top: 68.4%; font-weight: 800; }
.is-loss .wc-mult { top: 66.2%; color: #5A4330; }
.wc-strike { left: 82.5%; top: 66.2%; width: 9.2%; height: .45cqw; border-radius: .3cqw; background: #C23B2A; transform: translate(-50%, -50%) rotate(-14deg); }
.wc-dodged { left: 82.5%; top: 72%; font-family: 'EmHand', cursive; font-weight: 700; font-size: 2.4cqw; color: #C23B2A; }
.wc-sticker { position: absolute; left: -3%; bottom: -5%; width: 17%; height: auto; transform: rotate(-8deg); }
.em-side { flex: 0 0 auto; container-type: inline-size; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.em-big { margin: 0; font-weight: 800; line-height: 1.05; letter-spacing: -.02em; color: var(--up); white-space: nowrap; }
.em-big.is-down { color: var(--down); }
.em-x { margin: 0; font-size: 11px; color: var(--dim); letter-spacing: .04em; }
.em-line { margin: 2px 0 0; font-size: 12px; line-height: 1.4; color: var(--text-2); }
.em-open { margin-top: 2px; font-size: 11px; font-weight: 800; letter-spacing: .1em; }
@media (min-width: 500px) {
  .em-main { flex-direction: row; align-items: center; gap: 14px; }
  .em-certbox { flex: 2.1 1 0; align-self: stretch; }
  .em-side { flex: 1 1 0; }
  .em-line { font-size: 12.5px; }
}
`;

function page({ title, canonical, nonce, css, body, script = '' }) {
  return `<!doctype html>
<html lang="en" class="is-embed">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="canonical" href="${esc(canonical)}">
<style nonce="${esc(nonce)}">${BASE_CSS}${css}</style>
${script}
</head>
<body>
${body}
</body>
</html>
`;
}

// The certificate in HTML, sized in cqw of its own width (the numbers are the ones in
// lib/og.js POS and certModel fit, so it matches the share image).
function certFigure(m, build) {
  const art = (f) => `/v/${esc(build)}/img/whatif/${esc(f)}`;
  const fs = m.fit || {};
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const rules = [
    `.wc-ribbon { font-size: ${n(fs.ribbon, 3.8)}cqw; }`,
    `.wc-big { font-size: ${n(fs.big, 11)}cqw; }`,
    `.wc-l1, .wc-l2 { font-size: ${Math.round(n(fs.lines, 2.4) * 115) / 100}cqw; }`,
    `.wc-mult { font-size: ${n(fs.mult, 3)}cqw; }`,
  ].join('\n');
  const html = `<figure class="em-cert${m.loss ? ' is-loss' : ''}" role="img" aria-label="${esc(`A certificate: ${m.ribbon}, worth ${m.big} today. ${m.spent}. ${m.holding}. ${m.multiple}.`)}">
      <img class="em-paper" src="${art('certificate.webp')}" width="1536" height="1024" alt="">
      <div class="wc wc-receipt" aria-hidden="true">${(m.receipt || []).map((l) => `<span>${esc(l)}</span>`).join('')}</div>
      <div class="wc wc-ribbon" aria-hidden="true">${esc(m.ribbon)}</div>
      <div class="wc wc-big" aria-hidden="true">${esc(m.big)}</div>
      <div class="wc wc-today" aria-hidden="true">worth today</div>
      <div class="wc wc-l1" aria-hidden="true">${esc(m.spent)}</div>
      <div class="wc wc-l2" aria-hidden="true">${esc(m.holding)}</div>
      <div class="wc wc-mult" aria-hidden="true">${esc(m.multiple)}</div>
      ${m.loss ? '<div class="wc wc-strike"></div><div class="wc wc-dodged">dodged</div>' : ''}
      <img class="wc-sticker" src="${art(`doodle-${/^[a-z]+$/.test(m.doodle || '') ? m.doodle : 'box'}.webp`)}" width="384" height="384" alt="">
    </figure>`;
  return { html, rules };
}

// The one sentence under the number: a catalogue item says what it cost and when
// (lib/whatif-seo.js); a list or a period says what it all cost ("3 iPhones cost $2,097.").
export function embedSentence(m, catalog) {
  const hit = catalog ? seoItem(m.command, catalog) : null;
  if (hit) return seoWords(hit, m).fact;
  const spent = /^You spent (\S+)$/.exec(String(m.spent || ''))?.[1];
  const what = String(m.ribbon || 'It');
  const subject = `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
  return spent ? `${subject} cost ${spent}.` : `${subject}, put into stock instead.`;
}

// Embeds are for the catalogue only: a list with your own purchase (MY) gets no embed.
export const isMineCommand = (c) => Boolean(whatifTokens(String(c || ''))?.includes('MY'));

// /embed/whatif for a certificate model (lib/og.js getCert).
export function whatifEmbedHtml(m, { build, nonce, catalog }) {
  const full = `${SITE}/?${new URLSearchParams({ c: m.command })}`;
  const cert = certFigure(m, build);
  const bigLen = Math.max(4, [...String(m.big)].length);
  const css = `${CERT_CSS}
.em-big { font-size: min(40px, ${Math.round((100 / (bigLen * 0.62)) * 10) / 10}cqw); }
${cert.rules}`;
  const body = `<main class="em">
  <div class="em-top"><a class="em-brand" href="${esc(full)}" target="_blank" rel="noopener">BLOOMBROKE</a><span class="em-cmd">&gt; ${esc(m.command)}</span></div>
  <div class="em-main">
    <div class="em-certbox">${cert.html}</div>
    <div class="em-side">
      <p class="em-big${m.loss ? ' is-down' : ''}">${esc(m.big)}</p>
      <p class="em-x">WORTH TODAY &middot; ${esc(m.multiple)}</p>
      <p class="em-line">${esc(embedSentence(m, catalog))}</p>
      <a class="em-open" href="${esc(full)}" target="_blank" rel="noopener">OPEN THE FULL RESULT</a>
    </div>
  </div>
  ${embedFooter(full)}
</main>`;
  return page({ title: `${m.command} | Bloombroke`, canonical: full, nonce, css, body });
}

// /embed/whatif with no result to show: a line and the footer.
export function whatifEmbedMessage(message, { nonce, c = '' }) {
  const full = c ? `${SITE}/?${new URLSearchParams({ c })}` : `${SITE}/?c=WHATIF`;
  const body = `<main class="em">
  <div class="em-top"><a class="em-brand" href="${esc(full)}" target="_blank" rel="noopener">BLOOMBROKE</a><span class="em-cmd">&gt; WHATIF</span></div>
  <p class="em-msg">${esc(message)} <a href="${esc(full)}" target="_blank" rel="noopener">Open it on bloombroke.com</a></p>
  ${embedFooter(full)}
</main>`;
  return page({ title: 'WHATIF | Bloombroke', canonical: `${SITE}/?c=WHATIF`, nonce, css: '', body });
}

const GUESS_CSS = `
.em-top .em-left { margin-left: auto; color: var(--dim); }
.g-chart { flex: 1 1 auto; min-height: 56px; position: relative; overflow: hidden; }
.g-chart > svg { position: absolute; left: 0; top: 0; }
.gs-line { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-linejoin: round; }
.gs-area { fill: var(--accent-tint); stroke: none; }
.gs-grid { stroke: var(--rule); stroke-width: 1; }
.gs-grid.is-zero { stroke: var(--rule-strong); stroke-dasharray: 4 3; }
.gs-mtick { stroke: var(--rule); stroke-width: 1; stroke-dasharray: 1 3; }
.gs-ylab, .gs-xlab { fill: var(--dim); font-family: var(--font); font-size: 10px; }
.gs-tag { fill: var(--accent); }
.gs-tagt { fill: var(--ink); font-family: var(--font); font-size: 10px; font-weight: 800; }
.g-play { flex: 0 0 auto; position: relative; }
.g-form { display: flex; gap: 6px; margin: 0 0 6px; }
.g-field { position: relative; flex: 1 1 auto; min-width: 0; }
.g-in {
  width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--rule-strong); border-radius: 0;
  background: var(--panel); color: var(--text); font-family: var(--font); font-size: 12px;
}
.g-in:focus { outline: 1px solid var(--accent); outline-offset: 0; }
.g-go, .g-btn {
  height: 28px; padding: 0 12px; border: 1px solid var(--accent); background: var(--accent); color: var(--ink);
  font-family: var(--font); font-size: 11px; font-weight: 800; letter-spacing: .1em; cursor: pointer;
}
.g-sug { position: absolute; top: 100%; left: 0; right: 0; z-index: 5; margin: 0; padding: 0; list-style: none; background: var(--panel-2); border: 1px solid var(--rule-strong); }
.g-sug[hidden] { display: none; }
.g-sug button { display: flex; gap: 8px; width: 100%; height: 22px; padding: 0 8px; border: 0; background: transparent; color: var(--text-2); font-family: var(--font); font-size: 11px; text-align: left; cursor: pointer; }
.g-sug li[aria-selected="true"] button, .g-sug button:hover { background: var(--panel-3); color: var(--text); }
.g-sug .tk { min-width: 6ch; color: var(--text); font-weight: 800; }
.g-sug .nm { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; font-variant-numeric: tabular-nums; }
.g-table th, .g-table td { height: 19px; padding: 0 3px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--rule); }
.g-table thead th { height: 16px; font-size: 9px; font-weight: 500; letter-spacing: .06em; color: var(--dim); }
.g-table .i { width: 20px; color: var(--dim); }
.g-table .g { width: 16%; font-weight: 800; color: var(--text); }
.g-table .l { width: 15%; }
.g-table .g.open { color: var(--faint); font-weight: 500; }
.g-cell { border-left: 2px solid var(--bg); font-weight: 800; }
.g-cell .d { margin-left: 3px; }
.g-legend .more { display: none; }
@media (min-width: 420px) { .g-legend .more { display: inline; } }
.g-cell.g-hit { background: var(--up); color: var(--ink); }
.g-cell.g-near { box-shadow: inset 0 0 0 1px var(--accent); color: var(--accent); }
.g-cell.g-miss { color: var(--text-2); }
.g-cell.g-miss .d { color: var(--dim); }
.g-cell.g-none { color: var(--faint); }
.g-legend { margin: 4px 0 0; font-size: 9.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.g-end { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 28px; margin: 0 0 6px; font-size: 12px; }
.g-end b { color: var(--text); }
.g-end a { font-size: 11px; font-weight: 800; letter-spacing: .08em; }
.g-status { min-height: 0; margin: 0; font-size: 10px; color: var(--down); }
.g-status:empty { display: none; }
.offscreen { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

// /embed/guess: the frame; public/embed-guess.js fills it from /api/guess.
export function guessEmbedHtml({ build, nonce }) {
  const full = `${SITE}/?c=GUESS`;
  const body = `<main class="em" id="g-root">
  <div class="em-top"><a class="em-brand" href="${esc(full)}" target="_blank" rel="noopener">BLOOMBROKE</a><span class="em-cmd" id="g-title">GUESS: name the mystery stock</span><span class="em-left" id="g-left"></span></div>
  <div class="g-chart" id="g-chart" role="img" aria-label="The mystery stock over one year, as percent change"></div>
  <div class="g-play" id="g-play"><p class="em-msg">LOADING...</p></div>
  ${embedFooter(full)}
</main>
<noscript><p class="em-msg">GUESS needs JavaScript. <a href="${esc(full)}" target="_blank" rel="noopener">Play it on bloombroke.com</a></p></noscript>`;
  return page({
    title: 'GUESS | Bloombroke',
    canonical: full,
    nonce,
    css: GUESS_CSS,
    body,
    script: `<script type="module" src="/v/${esc(build)}/embed-guess.js"></script>`,
  });
}

// The EMBED screen's live preview frames these pages from bloombroke.com itself: that
// is not another site loading an embed, so BBRK does not count it.
export const ownPreview = (req) => req.get?.('sec-fetch-site') === 'same-origin';

// The routes. getCert(c) -> the certificate model or null (lib/og.js getCert with its deps).
// onLoad(req): an embed page was served (BBRK's embed_load count; server.js gates it).
export function mountEmbeds(app, { build, getCert, catalog, waitMs = EMBED_WAIT_MS, onLoad = () => {} }) {
  const fonts = new Map(Object.entries(FONTS).map(([name, file]) => [name, readFileSync(path.join(root, 'assets', 'fonts', file))]));
  const router = express.Router();
  router.use((req, res, next) => {
    const nonce = randomBytes(16).toString('base64');
    res.locals.nonce = nonce;
    res.removeHeader('X-Frame-Options');
    res.set(embedHeaders(nonce));
    next();
  });
  const send = (res, status, html, cache) => res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache }).send(html);
  const loaded = (req) => { if (ownPreview(req)) return; try { onLoad(req); } catch { /* a count never fails a page */ } };

  router.get('/fonts/:name', (req, res, next) => {
    const body = fonts.get(req.params.name);
    if (!body) return next();
    res.set({ 'Content-Type': 'font/ttf', 'Cache-Control': 'public, max-age=604800' }).send(body);
  });

  router.get('/whatif', async (req, res) => {
    const nonce = res.locals.nonce;
    const c = typeof req.query.c === 'string' ? req.query.c.slice(0, 600) : '';
    if (isMineCommand(c)) return send(res, 404, whatifEmbedMessage(NO_EMBED, { nonce }), PAGE_CACHE);
    const LATE = Symbol('late');
    let model = null;
    let late = false;
    try {
      const timeout = new Promise((resolve) => { setTimeout(resolve, waitMs, LATE).unref?.(); });
      const got = await Promise.race([Promise.resolve(getCert(c)).catch(() => LATE), timeout]);
      if (got === LATE) late = true; else model = got;
    } catch {
      late = true;
    }
    if (model) { loaded(req); return send(res, 200, whatifEmbedHtml(model, { build, nonce, catalog }), PAGE_CACHE); }
    if (late) return send(res, 503, whatifEmbedMessage('The numbers are taking a break. Try again in a minute.', { nonce, c }), 'no-store');
    return send(res, 404, whatifEmbedMessage('That WHATIF list does not look right.', { nonce }), PAGE_CACHE);
  });

  router.get('/guess', (req, res) => { loaded(req); send(res, 200, guessEmbedHtml({ build, nonce: res.locals.nonce }), PAGE_CACHE); });

  router.use((req, res) => send(res, 404, whatifEmbedMessage(NO_EMBED, { nonce: res.locals.nonce }), PAGE_CACHE));
  app.use('/embed', router);
  return router;
}
