// Router entries for the WEIRD commands: WEIRD (the grid) and one command per gauge
// (CANAL, PIZZA, ...). Help text lives in registry.js; the gauges in
// screens/weird-gauges.js. The one word they take is a period: CANAL 5Y, WEIRD 10Y,
// PANIC MAX (3M 1Y 5Y 10Y MAX; WEIRD AUTO is plain WEIRD). Any other word is ignored.

import { lazyScreen as lazy } from './lazy.js';
import { WEIRD_GAUGE_COMMANDS, periodWord, parseFishtank } from './command-args.js';

const weird = lazy('screens/weird.js');

// --- FISHTANK: the S&P 100 as fish (screens/fishtank.js), a screen of its own ---
const OWN_SCREENS = { FISHTANK: lazy('screens/fishtank.js') };
const OWN_PARSE = { FISHTANK: parseFishtank };
// --- end FISHTANK ---

export const WEIRD_COMMANDS = ['WEIRD', ...WEIRD_GAUGE_COMMANDS, ...Object.keys(OWN_SCREENS)];

export const WEIRD_SCREENS = { ...Object.fromEntries(WEIRD_COMMANDS.map((n) => [n, weird])), ...OWN_SCREENS };

// head + rest -> { name, args, input, url } or null. url: the address bar (and so the
// SHARE key's link) shows the clean command, ?c=CANAL for SHIPS or CANAL FOO, and
// ?c=CANAL+5Y for SHIPS 5y. args.period: '5Y', or left out.
export function matchWeird(head, rest = []) {
  if (!WEIRD_COMMANDS.includes(head)) return null;
  // FISHTANK TECH: a screen of its own may take words (parse); they go in the URL.
  const own = OWN_PARSE[head]?.(rest);
  if (own?.input) return { name: head, args: own.args, input: own.input, url: own.input };
  const period = OWN_SCREENS[head] ? null : rest.map(periodWord).find(Boolean) || null;
  const input = period ? `${head} ${period}` : head;
  return { name: head, args: period ? { period } : {}, input, url: input };
}
