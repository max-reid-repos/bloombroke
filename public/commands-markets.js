// Registry of the markets and macro commands (OPTIONS, ECONOMY, FEDPATH, BREADTH).
// Same shape as commands.js: the screen. Help text and examples live in registry.js. A screen's parse(args)
// returns args, { error }, or null (not this command). toInput(args) gives the clean URL
// form, so "OPTIONS S&P 500" is saved as OPTIONS SPX.

import * as options from './screens/options.js';
import * as economy from './screens/economy.js';
import * as fedpath from './screens/fedpath.js';
import * as breadth from './screens/breadth.js';
import * as worldmap from './screens/worldmap.js'; // WORLDMAP

export const MARKETS_EXTRA = [
  { name: 'OPTIONS', screen: options, takesArgs: true },
  { name: 'ECONOMY', screen: economy },
  { name: 'BREADTH', screen: breadth },
  { name: 'FEDPATH', screen: fedpath },
  { name: 'WORLDMAP', screen: worldmap }, // WORLDMAP
];

export const MARKETS_SCREENS = Object.fromEntries(MARKETS_EXTRA.map((c) => [c.name, c.screen]));

export const MARKETS_TAKES_ARGS = Object.fromEntries(MARKETS_EXTRA.filter((c) => c.takesArgs).map((c) => [c.name, (args) => c.screen.parse(args)]));

// head + rest -> { name, args, error, input } or null.
export function matchMarkets(head, rest) {
  const c = MARKETS_EXTRA.find((x) => x.name === head);
  if (!c) return null;
  const args = c.screen.parse ? c.screen.parse(rest) : {};
  if (args === null) return null;
  const input = (c.screen.toInput && c.screen.toInput(args)) || [head, ...(c.screen.parse ? rest : [])].join(' ');
  return { name: c.name, args, error: args.error, input };
}
