// The shell's own card pages (kit.js cardPage), loaded on first use like a screen, so
// they are not in the startup JS: NO SUCH TICKER and an unknown command (didYouMeanHtml),
// a link that wants to change a saved list, BUY renamed, GO LIVE outside a chat, COMING
// SOON, and a screen that did not load. app.js loads this file (lazy.js loadModule) and draws what it returns.

import { cardPage, cardButton, cardLink, cardRows, raw } from './kit.js';
import { dymRows } from './nosuch.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (c) => '?' + new URLSearchParams({ c }).toString();
const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

// ALL COMMANDS on the NO SUCH card (= screens/nosuch.js HELP_LINE, test/speed.test.js).
export const HELP_LINE = '<a class="card-link" href="?c=HELP" data-cmd="HELP">ALL COMMANDS</a>';

// NO SUCH TICKER and an unknown command: one card page. Action: the screen's own (IPO IT,
// PAY RESPECTS), else the best guess (key 1), else HELP; other guesses (keys 2, 3) are links,
// what each is in + Details. extra: slots from screens/nosuch.js; help: false, no ALL COMMANDS.
export function didYouMeanHtml(typed, found = {}, ticker = null, { extra = null } = {}) {
  const rows = dymRows(found, typed, ticker);
  const x = extra || {};
  const tip = (what) => (what ? ` title="${esc(what)}"` : '');
  const lead = !x.act && rows.length ? rows[0] : null;
  const act = x.act || raw(lead
    ? cardButton({ label: lead[0], cmd: lead[0], primary: true, attrs: `data-key="1"${tip(lead[1])}` })
    : cardButton({ label: 'HELP', cmd: 'HELP', primary: true }));
  const guesses = rows.slice(lead ? 1 : 0).map(([cmd, what], i) => cardLink({ label: cmd, cmd, attrs: `data-key="${i + (lead ? 2 : 1)}"${tip(what)}` }));
  const links = [...(x.links || []), ...guesses, ...((x.act || lead) && x.help !== false ? [HELP_LINE] : [])];
  const kicker = x.kicker || (ticker ? 'No such ticker. Yet.' : 'Unknown command');
  const shown = ticker ? `$${ticker}` : typed;
  const sub = x.sub || (lead ? 'Did you mean this?' : 'Check the spelling.');
  const guessRows = rows.filter(([, what]) => what).map(([cmd, what]) => [cmd, what]);
  const more = (guessRows.length ? cardRows(guessRows) : '') + (x.details?.html || '');
  return cardPage({
    ...x,
    cls: `ns-card${x.cls ? ` ${x.cls}` : ''}`, label: x.label || kicker,
    kicker, hero: x.hero || shown, heroSize: x.heroSize || (shown.length <= 7 ? 60 : shown.length <= 16 ? 44 : 32),
    sub, act, links, details: more ? raw(more) : '',
  });
}

// A command the parser does not know, before any lookup: the same card, what a ticker
// looks like in + Details.
export function unknownHtml(typed) {
  return didYouMeanHtml(typed, {}, null, { extra: { details: raw(cardRows([['Tickers', raw(`A ticker is one word, like ${code('AAPL')} or ${code('BRK.B')}.`)]])) } });
}

// A link that would change a saved list, when it reaches the screen itself (app.js asks
// first and never runs it): what it changes, RUN IT, and Esc (or the link) just shows
// the list. title: 'Watchlist'; what: 'watchlist'; input: the command; view: the plain screen.
export function linkConfirmHtml({ title, what, input, view }) {
  return cardPage({
    cls: 'link-card', label: `${title}: confirm`,
    kicker: title,
    hero: `This link wants to change your ${what}.`, heroSize: 32,
    sub: raw(`It runs <span class="code">${esc(input)}</span> on the list saved in this browser.`),
    act: raw(cardButton({ label: 'RUN IT', primary: true, attrs: `data-cmd="${esc(input)}"` })),
    note: raw(`Esc: just show ${code(view)}.`),
  });
}

// BUY typed on its own words: it is AFFORD now.
export function renamedHtml(example = 'AFFORD 1200') {
  return cardPage({
    label: 'Renamed',
    kicker: 'Renamed',
    hero: 'BUY is now AFFORD', heroSize: 44,
    sub: 'It is about things you buy, not investments.',
    act: raw(cardButton({ label: example, cmd: example, primary: true, attrs: 'data-example' })),
  });
}

// GO LIVE typed outside a chat: where it works (CHAT's own hook takes it in a chat).
export function liveHintHtml() {
  return cardPage({
    label: 'GO LIVE',
    kicker: 'GO LIVE',
    hero: 'Open a chat, then type GO LIVE.', heroSize: 32,
    act: raw(cardButton({ label: 'CHAT', cmd: 'CHAT', primary: true })),
  });
}

// Listed or a ticker function, not built yet. s: { name, hint, ticker? }.
export function soonHtml(s) {
  const to = s.ticker || 'HELP';
  return cardPage({
    label: `${s.name}: coming soon`,
    kicker: 'Coming soon',
    hero: s.name, heroSize: String(s.name).length <= 16 ? 44 : 32,
    sub: `${String(s.hint || '').replace(/\.$/, '')}.`,
    act: raw(cardButton({ label: to, cmd: to, primary: true })),
    links: s.ticker ? [cardLink({ label: 'HELP', cmd: 'HELP' })] : [],
  });
}

// A lazy screen whose file did not come in (most likely a deploy since the page opened;
// lazy.js reloads once by itself).
export function notLoadedHtml() {
  return cardPage({
    label: 'Did not load',
    hero: 'This screen did not load.', heroSize: 32,
    sub: 'Reload the page to get the latest version.',
    act: raw(cardButton({ label: 'RELOAD', primary: true, attrs: 'data-reload' })),
  });
}
