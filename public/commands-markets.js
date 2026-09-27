// Registry of the markets and macro commands (OPTIONS, ECONOMY, FEDPATH, BREADTH).
// Same shape as commands.js: the screen. Help text and examples live in registry.js. An entry's parse(args)
// returns args, { error }, or null (not this command). toInput(args) gives the clean URL
// form, so "OPTIONS S&P 500" is saved as OPTIONS SPX.

import { lazyScreen as lazy } from './lazy.js';
import { parseOptions, optionsToInput, parseEconomy, economyToInput } from './command-args.js';

export const MARKETS_EXTRA = [
  { name: 'OPTIONS', screen: lazy('screens/options.js'), parse: parseOptions, toInput: optionsToInput, takesArgs: true },
  { name: 'ECONOMY', screen: lazy('screens/economy.js'), parse: parseEconomy, toInput: economyToInput },
  { name: 'BREADTH', screen: lazy('screens/breadth.js') },
  { name: 'FEDPATH', screen: lazy('screens/fedpath.js') },
  { name: 'WORLDMAP', screen: lazy('screens/worldmap.js') }, // WORLDMAP
];

export const MARKETS_SCREENS = Object.fromEntries(MARKETS_EXTRA.map((c) => [c.name, c.screen]));

export const MARKETS_TAKES_ARGS = Object.fromEntries(MARKETS_EXTRA.filter((c) => c.takesArgs).map((c) => [c.name, (args) => c.parse(args)]));

// head + rest -> { name, args, error, input } or null.
export function matchMarkets(head, rest) {
  const c = MARKETS_EXTRA.find((x) => x.name === head);
  if (!c) return null;
  const args = c.parse ? c.parse(rest) : {};
  if (args === null) return null;
  const input = (c.toInput && c.toInput(args)) || [head, ...(c.parse ? rest : [])].join(' ');
  return { name: c.name, args, error: args.error, input };
}
