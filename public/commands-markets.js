// Registry of the markets and macro commands (OPTIONS, ECONOMY, FEDPATH, BREADTH).
// Same shape as commands.js: help text, examples and the screen. A screen's parse(args)
// returns args, { error }, or null (not this command). toInput(args) gives the clean URL
// form, so "OPTIONS S&P 500" is saved as OPTIONS SPX.

import * as options from './screens/options.js';
import * as economy from './screens/economy.js';
import * as fedpath from './screens/fedpath.js';
import * as breadth from './screens/breadth.js';

export const MARKETS_EXTRA = [
  { name: 'OPTIONS', group: 'Company', hint: 'Option chain: calls and puts by strike, 15 min delayed', usage: 'OPTIONS <ticker> [expiry]', example: 'OPTIONS AAPL', examples: ['OPTIONS AAPL', 'AAPL OPTIONS', 'OPTIONS SPY'], screen: options, takesArgs: true },
  { name: 'ECONOMY', group: 'Markets', hint: 'US economy: jobs, inflation, growth, spending, with charts', usage: 'ECONOMY [indicator]', example: 'ECONOMY', examples: ['ECONOMY', 'ECONOMY UNRATE', 'ECONOMY CPI MAX'], screen: economy },
  { name: 'BREADTH', group: 'Markets', hint: 'How many stocks rose and fell, by exchange and sector', usage: 'BREADTH', example: 'BREADTH', screen: breadth },
  { name: 'FEDPATH', group: 'Rates and FX', hint: 'The Fed funds rate implied by futures, month by month', usage: 'FEDPATH', example: 'FEDPATH', screen: fedpath },
];

export const MARKETS_HELP = MARKETS_EXTRA.map(({ name, group, hint, usage, example, examples }) => ({ name, group, hint, usage, example, examples }));

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
