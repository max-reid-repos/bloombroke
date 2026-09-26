// Router entries for the WEIRD commands: WEIRD (the grid) and one command per gauge
// (CANAL, PIZZA, ...). Help text lives in registry.js; the gauges in
// screens/weird-gauges.js. None take words: anything after the command is ignored.

import * as weird from './screens/weird.js';
import { WEIRD_GAUGES } from './screens/weird-gauges.js';

export const WEIRD_COMMANDS = ['WEIRD', ...WEIRD_GAUGES.map((g) => g.command)];

export const WEIRD_SCREENS = Object.fromEntries(WEIRD_COMMANDS.map((n) => [n, weird]));

// head + rest -> { name, args, input } or null.
export function matchWeird(head) {
  if (!WEIRD_COMMANDS.includes(head)) return null;
  return { name: head, args: {}, input: head };
}
