// Routing for the extra commands: one line per command and its screen. Help text,
// examples and categories live in registry.js.
// An entry may have parse(args) -> args | { error } | null (null = not this command, so
// NEWS with no ticker falls through to the market-wide NEWS screen). Without parse, extra
// words are ignored, like HOME or MARKETS.
//
// `id` is the internal screen key when it differs from the typed name.

import { ALIASES } from './registry.js';
import { lazyScreen as lazy } from './lazy.js';
import {
  parseTicker, parseCompare, parseHistory, parseTickerNews, parseBonds, parseFxMatrix, parseEarnings, parseCalendar,
  parseLoan, parseCompound, parsePro, parseTapeArgs, parseLogin, parseData, parseSectors, sectorsCmd,
  parseGrid, gridCmd, parseEmbed, parseWhatis,
} from './command-args.js';
import { parse as parseNewsTab } from './screens/news.js'; // NEWS is on HOME: loaded at startup anyway
import { parseAlertArgs } from './alerts.js'; // ALERTS: the watcher runs on every page anyway

// screen: the module that draws it, loaded on first use (lazy.js). parse(args) and
// toInput(args): what the words mean, from command-args.js, known at startup.
export const EXTRA = [
  { name: 'WORLD', screen: lazy('screens/world.js') },
  { name: 'MOVERS', screen: lazy('screens/movers.js') },
  { name: 'TRENDING', screen: lazy('screens/trending.js') }, // TRENDING: most opened tickers here
  { name: 'HEATMAP', screen: lazy('screens/heatmap.js') },
  { name: 'SECTORS', screen: lazy('screens/sectors.js'), parse: parseSectors, toInput: sectorsCmd },
  { name: 'COMPARE', screen: lazy('screens/compare.js'), parse: parseCompare, takesArgs: true },
  { name: 'GRID', screen: lazy('screens/grid.js'), parse: parseGrid, takesArgs: true, toInput: gridCmd }, // GRID: up to 16 mini charts
  { name: 'COMMODITIES', screen: lazy('screens/commodities.js') },
  { name: 'CRYPTO', screen: lazy('screens/crypto.js') },
  { name: 'CLOCK', screen: lazy('screens/clock.js') },
  { name: 'PROFILE', screen: lazy('screens/profile.js'), parse: parseTicker, takesArgs: true },
  { name: 'HISTORY', screen: lazy('screens/history.js'), parse: parseHistory, takesArgs: true },
  { name: 'DIVIDENDS', screen: lazy('screens/dividends.js'), parse: parseTicker, takesArgs: true },
  { name: 'NEWS', screen: lazy('screens/news-page.js'), parse: parseNewsTab }, // NEWS <tab> (MACRO, SEC, WIRES, WSB); plain NEWS falls through
  { name: 'NEWS', id: 'TICKERNEWS', screen: lazy('screens/tickernews.js'), parse: parseTickerNews },
  { name: 'CURVE', screen: lazy('screens/curve.js') },
  { name: 'BONDS', screen: lazy('screens/bonds.js'), parse: parseBonds },
  { name: 'FXMATRIX', screen: lazy('screens/fxmatrix.js'), parse: parseFxMatrix },
  { name: 'EARNINGS', screen: lazy('screens/earnings.js'), parse: parseEarnings },
  { name: 'CALENDAR', screen: lazy('screens/calendar.js'), parse: parseCalendar },
  { name: 'LOAN', screen: lazy('screens/loan.js'), parse: parseLoan, takesArgs: true },
  { name: 'COMPOUND', screen: lazy('screens/compound.js'), parse: parseCompound, takesArgs: true },
  { name: 'PRO', screen: lazy('screens/pro.js'), parse: parsePro },
  { name: 'TAPE', screen: lazy('screens/tape.js'), parse: parseTapeArgs, takesArgs: true, url: 'TAPE' },
  { name: 'LOGIN', screen: lazy('screens/pro.js', 'loginCommand'), parse: parseLogin, takesArgs: true, url: 'PRO', secret: true },
  { name: 'LOGOUT', screen: lazy('screens/pro.js', 'logoutCommand'), url: 'PRO' },
  { name: 'TERMS', screen: lazy('screens/legal.js') },
  { name: 'PRIVACY', screen: lazy('screens/legal.js') },
  { name: 'DISCLAIMER', screen: lazy('screens/legal.js') },
  { name: 'FOUNDERS', screen: lazy('screens/legal.js') }, // the /founders page (lib/founders-page.js)
  // ALERTS: changes the saved alerts, so a link only ever opens the list.
  { name: 'ALERTS', screen: lazy('screens/alerts.js'), parse: parseAlertArgs, takesArgs: true, url: 'ALERTS' },
  { name: 'GUESS', screen: lazy('screens/guess.js') }, // GUESS: one mystery stock a day
  // Provenance: every source in one table, each upstream's state, the change log.
  { name: 'DATA', screen: lazy('screens/data.js'), parse: parseData, takesArgs: true },
  { name: 'STATUS', screen: lazy('screens/status.js') },
  { name: 'CHANGES', screen: lazy('screens/changes.js') },
  { name: 'BBRK', screen: lazy('screens/bbrk.js') }, // BBRK: our own site numbers, not a security
  { name: 'MCP', screen: lazy('screens/mcp.js') }, // MCP: hook an AI app up to Bloombroke (lib/mcp/)
  { name: 'HOLIDAYS', screen: lazy('screens/holidays.js') }, // HOLIDAYS: US market closures, next 12 months
  { name: 'EMBED', screen: lazy('screens/embed.js'), parse: parseEmbed, takesArgs: true }, // EMBED: the code for GUESS or a WHATIF on your own site
  { name: 'WHATIS', screen: lazy('screens/whatis.js'), parse: parseWhatis, takesArgs: true }, // WHATIS: market words in plain English
];

// Screens (lazy, see lazy.js) by internal name.
export const EXTRA_SCREENS = Object.fromEntries(EXTRA.map((c) => [c.id || c.name, c.screen]));

// Argument parsers for commands that need arguments (Tab adds a space, bad input shows usage).
export const EXTRA_TAKES_ARGS = Object.fromEntries(EXTRA.filter((c) => c.takesArgs).map((c) => [c.name, (args) => c.parse(args)]));

// head + rest -> { name, args, error, input } or null when no extra command claims it.
export function matchExtra(head, rest) {
  for (const c of EXTRA) {
    if (c.name !== head) continue;
    const args = c.parse ? c.parse(rest) : {};
    if (args === null) continue;
    // toInput(args): a screen that writes its own clean command (SECTORS drops unknown words).
    const input = c.secret ? head : c.toInput ? c.toInput(args) : [head, ...(c.parse ? rest : [])].join(' ');
    return { name: c.id || c.name, args, error: args.error, input, ...(c.toInput ? { url: input } : {}) };
  }
  return null;
}

// What goes in the URL and the command history for a command. LOGIN never puts its key
// there, and commands that change something (LOGIN, LOGOUT, TAPE ADD) are not replayed
// from a link: the URL keeps only the screen they show.
// An alias counts as its command: ALERT AAPL > 350 keeps only ALERTS.
export function urlCommand(clean) {
  const first = String(clean).split(' ')[0];
  const head = ALIASES[first] || first;
  const c = EXTRA.find((x) => x.name === head && x.url);
  return c ? c.url : clean;
}

// Commands whose words must never be kept (LOGIN <key>).
export function isSecret(clean) {
  const first = String(clean).split(' ')[0];
  const head = ALIASES[first] || first;
  return EXTRA.some((x) => x.name === head && x.secret);
}
