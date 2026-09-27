// Routing for the extra commands: one line per command and its screen. Help text,
// examples and categories live in registry.js.
// A screen may export parse(args) -> args | { error } | null (null = not this command, so
// NEWS with no ticker falls through to the market-wide NEWS screen). Without parse, extra
// words are ignored, like HOME or MARKETS.
//
// `id` is the internal screen key when it differs from the typed name.

import { ALIASES } from './registry.js';
import * as world from './screens/world.js';
import * as movers from './screens/movers.js';
import * as heatmap from './screens/heatmap.js';
import * as sectors from './screens/sectors.js';
import * as compare from './screens/compare.js';
import * as crypto from './screens/crypto.js';
import * as commodities from './screens/commodities.js';
import * as clock from './screens/clock.js';
import * as profile from './screens/profile.js';
import * as history from './screens/history.js';
import * as dividends from './screens/dividends.js';
import * as tickernews from './screens/tickernews.js';
import * as news from './screens/news.js';
import * as curve from './screens/curve.js';
import * as bonds from './screens/bonds.js';
import * as fxmatrix from './screens/fxmatrix.js';
import * as earnings from './screens/earnings.js';
import * as calendar from './screens/calendar.js';
import * as loan from './screens/loan.js';
import * as compound from './screens/compound.js';
import * as pro from './screens/pro.js';
import * as tape from './screens/tape.js';
import * as legal from './screens/legal.js';
import * as alerts from './screens/alerts.js'; // ALERTS
import * as trending from './screens/trending.js'; // TRENDING
import * as guess from './screens/guess.js'; // GUESS
import * as dataScreen from './screens/data.js'; // Provenance: DATA
import * as statusScreen from './screens/status.js'; // Provenance: STATUS
import * as changesScreen from './screens/changes.js'; // Provenance: CHANGES

export const EXTRA = [
  { name: 'WORLD', screen: world },
  { name: 'MOVERS', screen: movers },
  { name: 'TRENDING', screen: trending }, // TRENDING: most opened tickers here
  { name: 'HEATMAP', screen: heatmap },
  { name: 'SECTORS', screen: sectors },
  { name: 'COMPARE', screen: compare, takesArgs: true },
  { name: 'COMMODITIES', screen: commodities },
  { name: 'CRYPTO', screen: crypto },
  { name: 'CLOCK', screen: clock },
  { name: 'PROFILE', screen: profile, takesArgs: true },
  { name: 'HISTORY', screen: history, takesArgs: true },
  { name: 'DIVIDENDS', screen: dividends, takesArgs: true },
  { name: 'NEWS', screen: news }, // NEWS <tab> (MACRO, SEC, WIRES, WSB); plain NEWS falls through
  { name: 'NEWS', id: 'TICKERNEWS', screen: tickernews },
  { name: 'CURVE', screen: curve },
  { name: 'BONDS', screen: bonds },
  { name: 'FXMATRIX', screen: fxmatrix },
  { name: 'EARNINGS', screen: earnings },
  { name: 'CALENDAR', screen: calendar },
  { name: 'LOAN', screen: loan, takesArgs: true },
  { name: 'COMPOUND', screen: compound, takesArgs: true },
  { name: 'PRO', screen: pro },
  { name: 'TAPE', screen: tape, takesArgs: true, url: 'TAPE' },
  { name: 'LOGIN', screen: pro.loginCommand, takesArgs: true, url: 'PRO', secret: true },
  { name: 'LOGOUT', screen: pro.logoutCommand, url: 'PRO' },
  { name: 'TERMS', screen: legal },
  { name: 'PRIVACY', screen: legal },
  { name: 'DISCLAIMER', screen: legal },
  // ALERTS: changes the saved alerts, so a link only ever opens the list.
  { name: 'ALERTS', screen: alerts, takesArgs: true, url: 'ALERTS' },
  { name: 'GUESS', screen: guess }, // GUESS: one mystery stock a day
  // Provenance: every source in one table, each upstream's state, the change log.
  { name: 'DATA', screen: dataScreen, takesArgs: true },
  { name: 'STATUS', screen: statusScreen },
  { name: 'CHANGES', screen: changesScreen },
];

// Screen modules by internal name.
export const EXTRA_SCREENS = Object.fromEntries(EXTRA.map((c) => [c.id || c.name, c.screen]));

// Argument parsers for commands that need arguments (Tab adds a space, bad input shows usage).
export const EXTRA_TAKES_ARGS = Object.fromEntries(EXTRA.filter((c) => c.takesArgs).map((c) => [c.name, (args) => c.screen.parse(args)]));

// head + rest -> { name, args, error, input } or null when no extra command claims it.
export function matchExtra(head, rest) {
  for (const c of EXTRA) {
    if (c.name !== head) continue;
    const args = c.screen.parse ? c.screen.parse(rest) : {};
    if (args === null) continue;
    const input = c.secret ? head : [head, ...(c.screen.parse ? rest : [])].join(' ');
    return { name: c.id || c.name, args, error: args.error, input };
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
