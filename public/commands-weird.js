// Router entries for the WEIRD commands: WEIRD (the grid) and one command per gauge
// (CANAL, PIZZA, ...). Help text lives in registry.js; the gauges in
// screens/weird-gauges.js. None take words: anything after the command is ignored.

import * as weird from './screens/weird.js';
import { WEIRD_GAUGES } from './screens/weird-gauges.js';

// --- FISHTANK: the S&P 100 as fish (screens/fishtank.js), a screen of its own ---
import * as fishtank from './screens/fishtank.js';

const OWN_SCREENS = { FISHTANK: fishtank };
// --- end FISHTANK ---

export const WEIRD_COMMANDS = ['WEIRD', ...WEIRD_GAUGES.map((g) => g.command), ...Object.keys(OWN_SCREENS)];

export const WEIRD_SCREENS = { ...Object.fromEntries(WEIRD_COMMANDS.map((n) => [n, weird])), ...OWN_SCREENS };

// head + rest -> { name, args, input, url } or null. url: the address bar (and so the
// SHARE key's link) shows the clean command, ?c=CANAL for SHIPS or CANAL FOO.
export function matchWeird(head) {
  if (!WEIRD_COMMANDS.includes(head)) return null;
  return { name: head, args: {}, input: head, url: head };
}
