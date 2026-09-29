// EMBED buttons (WHATIF result, GUESS end): the one line of HTML they copy. The pages
// behind it are lib/embed-pages.js.

export const EMBED_SITE = 'https://bloombroke.com';
const frame = (src, title) => `<iframe src="${src}" width="600" height="420" style="border:0" loading="lazy" title="${title}"></iframe>`;

// command: the canonical WHATIF command, like "WHATIF IPHONE6".
export function whatifEmbedSnippet(command) {
  return frame(`${EMBED_SITE}/embed/whatif?${new URLSearchParams({ c: String(command || '') })}`, 'Bloombroke WHATIF');
}

export function guessEmbedSnippet() {
  return frame(`${EMBED_SITE}/embed/guess`, 'Bloombroke GUESS');
}

// EMBED (screens/embed.js): what can be embedded, one row each. Only these two: the
// /embed/* routes (lib/embed-pages.js) serve nothing else.
export const EMBEDS = [
  { name: 'GUESS', what: "Today's mystery chart, playable on your page", example: 'EMBED GUESS' },
  { name: 'WHATIF <list>', what: 'A WHATIF result: the certificate, the number and one line', example: 'EMBED WHATIF IPHONE6' },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One embed: { title, path (the page here, for the preview), code (the iframe line and a
// credit line under it, linking back) }. target: 'GUESS', or 'WHATIF' with command.
export function embedFor({ target, command = '' }) {
  if (target === 'GUESS') {
    return { title: 'GUESS', path: '/embed/guess', code: `${guessEmbedSnippet()}\n${credit('GUESS', 'GUESS')}` };
  }
  if (target === 'WHATIF' && command) {
    return {
      title: command,
      path: `/embed/whatif?${new URLSearchParams({ c: command })}`,
      code: `${whatifEmbedSnippet(command)}\n${credit(command, command)}`,
    };
  }
  return null;
}

// The credit under the frame: where it came from, a link back.
function credit(cmd, label) {
  return `<p><a href="${EMBED_SITE}/?${esc(new URLSearchParams({ c: cmd }).toString())}">${esc(label)}</a> on Bloombroke</p>`;
}
