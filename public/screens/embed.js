// EMBED: the code that puts GUESS or a WHATIF result on another site. EMBED alone
// lists what can be embedded; EMBED GUESS or EMBED WHATIF <list> shows the code (the
// frame and a credit line), a COPY button and a live preview of the page it frames.
// The pages are lib/embed-pages.js; the code is public/embed-snippet.js, the same one
// the EMBED buttons on WHATIF and GUESS copy.

import { esc, q, panel, LOADING } from './markets.js';
import { cardButton } from '../kit.js';
import { EMBEDS, embedFor } from '../embed-snippet.js';
import { parseEmbed as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { parse };

const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

// EMBED alone: the list. note: a line above it (a word that has no embed).
export function listHtml(note = '') {
  return `${note ? `<p class="emb-note">${note}</p>` : ''}<table class="grid-table co-table emb-table">
    <thead><tr><th scope="col">Embed</th><th scope="col" class="emb-what">What it shows</th><th scope="col">Type</th></tr></thead>
    <tbody>${EMBEDS.map((e) => `<tr><td class="emb-name">${esc(e.name)}</td><td class="emb-what">${esc(e.what)}</td><td>${code(e.example)}</td></tr>`).join('')}</tbody>
  </table>
  <p class="emb-foot">Each one carries its source and a link back. Other screens have no embed yet.</p>`;
}

// Why a word has no embed.
export function noteFor(args) {
  if (!args?.asked) return '';
  if (args.mine) return 'A list with your own purchase (MY) has no embed. Use a list from the catalogue.';
  if (args.asked === 'WHATIF') return `Add a list: ${code('EMBED WHATIF IPHONE6')}.`;
  if (args.unknownList) return `${esc(args.asked)} has no embed: WHATIF does not know that list. These two do:`;
  return `${esc(args.asked)} has no embed. These two do:`;
}

// Is this a WHATIF list the embed page can draw? The WHATIF parser's rules
// (data/whatif-cert.js whatifTokens and normalizeWhatif, data/whatif.js resolveTokens):
// 1 to 30 catalogue items, each with an optional :spec; no family or shelf word (those
// open the picker), no MY (your own purchase has no embed), nothing unknown.
export function whatifListOk(command, catalog) {
  const tokens = String(command || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (tokens[0] === 'WHATIF') tokens.shift();
  if (!tokens.length || tokens.length > 40 || tokens.some((t) => !/^[A-Z0-9.:-]{1,24}$/.test(t))) return false;
  const ids = new Set([...(catalog?.products || []), ...(catalog?.recurring || [])].map((p) => String(p.id).toUpperCase()));
  const picks = new Set();
  for (const t of tokens) {
    const head = t.split(':')[0];
    if (!ids.has(head)) return false;
    picks.add(head);
  }
  return picks.size > 0 && picks.size <= 30;
}

// One embed: the words, the code, COPY (the page's one action) and the preview.
export function embedHtml(e) {
  return `<div class="emb">
    <div class="emb-text">
      <p class="emb-lead">Paste this into any page that takes HTML: a blog, a newsletter, a site builder.</p>
      <pre class="emb-code"><code id="emb-code">${esc(e.code)}</code></pre>
      <p class="emb-act">${cardButton({ label: 'COPY', primary: true, id: 'emb-copy' })}</p>
    </div>
    <figure class="emb-fig">
      <figcaption class="tag">Preview: what other sites show</figcaption>
      <iframe class="emb-frame" src="${esc(e.path)}" title="${esc(`Preview: ${e.title}`)}" loading="lazy" inert tabindex="-1"></iframe>
    </figure>
  </div>`;
}

// The WHATIF catalogue, once per page (the same answer the WHATIF screen reads).
let catalogCache = null;

export function render(el, cmd, ctx) {
  const args = cmd.args || {};
  const e = embedFor(args);
  const list = (a) => {
    el.innerHTML = panel('1', 'Embed', listHtml(noteFor(a)), { cls: 'panel-solo emb-panel', bodyCls: 'flush' });
    ctx.status(a.asked ? `EMBED: NO EMBED FOR ${a.asked}` : '', a.asked ? 'warn' : undefined);
  };
  if (!e) { list(args); return; }
  const draw = () => {
    el.innerHTML = panel('1', `Embed ${e.title}`, embedHtml(e), { cls: 'panel-solo emb-panel', bodyCls: 'flush' });
    const btn = el.querySelector('#emb-copy');
    btn.addEventListener('click', async () => {
      const ok = await ctx.copy(e.code);
      btn.textContent = ok ? 'COPIED' : 'COPY';
      ctx.status(ok ? 'EMBED CODE COPIED' : 'COPY DID NOT WORK: SELECT THE CODE AND COPY IT', ok ? undefined : 'warn');
    });
    ctx.status('');
  };
  if (args.target !== 'WHATIF') { draw(); return; }
  // A WHATIF list: check it before any code to copy.
  el.innerHTML = panel('1', `Embed ${e.title}`, LOADING, { cls: 'panel-solo emb-panel' });
  return Promise.resolve(catalogCache || ctx.fetchJSON('/api/whatif/catalog', { signal: ctx.signal })).then((catalog) => {
    catalogCache = catalog;
    if (ctx.signal?.aborted) return;
    if (whatifListOk(args.command, catalog)) draw();
    else list({ target: null, asked: args.command, unknownList: true });
  }, (err) => {
    if (err?.name === 'AbortError') return;
    el.innerHTML = panel('1', `Embed ${e.title}`, '<p class="panel-msg">The WHATIF list did not load. Try again in a minute.</p>', { cls: 'panel-solo emb-panel' });
    ctx.status('EMBED: NO DATA', 'warn');
  });
}
