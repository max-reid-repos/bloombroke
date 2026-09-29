// EMBED: the code that puts GUESS or a WHATIF result on another site. EMBED alone
// lists what can be embedded; EMBED GUESS or EMBED WHATIF <list> shows the code (the
// frame and a credit line), a COPY button and a live preview of the page it frames.
// The pages are lib/embed-pages.js; the code is public/embed-snippet.js, the same one
// the EMBED buttons on WHATIF and GUESS copy.

import { esc, q, panel } from './markets.js';
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
  return `${esc(args.asked)} has no embed. These two do:`;
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
      <iframe class="emb-frame" src="${esc(e.path)}" title="${esc(`Preview: ${e.title}`)}" loading="lazy"></iframe>
    </figure>
  </div>`;
}

export function render(el, cmd, ctx) {
  const args = cmd.args || {};
  const e = embedFor(args);
  if (!e) {
    el.innerHTML = panel('1', 'Embed', listHtml(noteFor(args)), { cls: 'panel-solo emb-panel', bodyCls: 'flush' });
    ctx.status(args.asked ? `EMBED: NO EMBED FOR ${args.asked}` : '', args.asked ? 'warn' : undefined);
    return;
  }
  el.innerHTML = panel('1', `Embed ${e.title}`, embedHtml(e), { cls: 'panel-solo emb-panel', bodyCls: 'flush' });
  const btn = el.querySelector('#emb-copy');
  btn.addEventListener('click', async () => {
    const ok = await ctx.copy(e.code);
    btn.textContent = ok ? 'COPIED' : 'COPY';
    ctx.status(ok ? 'EMBED CODE COPIED' : 'COPY DID NOT WORK: SELECT THE CODE AND COPY IT', ok ? undefined : 'warn');
  });
  ctx.status('');
}
