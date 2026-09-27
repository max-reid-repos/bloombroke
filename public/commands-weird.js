// Router entries for the WEIRD commands: WEIRD (the grid) and one command per gauge
// (CANAL, PIZZA, ...). Help text lives in registry.js; the gauges in
// screens/weird-gauges.js. The one word they take is a period: CANAL 5Y, WEIRD 10Y,
// PANIC MAX (3M 1Y 5Y 10Y MAX; WEIRD AUTO is plain WEIRD). Any other word is ignored.

import * as weird from './screens/weird.js';
import { WEIRD_GAUGES, periodWord } from './screens/weird-gauges.js';

// --- FISHTANK: the S&P 100 as fish (screens/fishtank.js), a screen of its own ---
import * as fishtank from './screens/fishtank.js';

const OWN_SCREENS = { FISHTANK: fishtank };
// --- end FISHTANK ---

export const WEIRD_COMMANDS = ['WEIRD', ...WEIRD_GAUGES.map((g) => g.command), ...Object.keys(OWN_SCREENS)];

export const WEIRD_SCREENS = { ...Object.fromEntries(WEIRD_COMMANDS.map((n) => [n, weird])), ...OWN_SCREENS };

// head + rest -> { name, args, input, url } or null. url: the address bar (and so the
// SHARE key's link) shows the clean command, ?c=CANAL for SHIPS or CANAL FOO, and
// ?c=CANAL+5Y for SHIPS 5y. args.period: '5Y', or left out.
export function matchWeird(head, rest = []) {
  if (!WEIRD_COMMANDS.includes(head)) return null;
  const period = OWN_SCREENS[head] ? null : rest.map(periodWord).find(Boolean) || null;
  const input = period ? `${head} ${period}` : head;
  return { name: head, args: period ? { period } : {}, input, url: input };
}
