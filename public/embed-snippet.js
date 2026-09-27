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
