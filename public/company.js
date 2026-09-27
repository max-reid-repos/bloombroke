// Routing for the company-data commands, in the same shape as commands.js: the screen.
// Help text and examples live in registry.js. An entry may have parse(args) -> args | { error }, and
// inputOf(args) for the words that go in the URL.

import { lazyScreen as lazy } from './lazy.js';
import { parseTicker, parseFilings, filingsInputOf, parseExdiv } from './command-args.js';

// screen: loaded on first use (lazy.js). parse and inputOf: from command-args.js.
export const COMPANY = [
  { name: 'INSIDERS', screen: lazy('screens/insiders.js'), parse: parseTicker, takesArgs: true, fn: true },
  { name: 'OWNERS', screen: lazy('screens/owners.js'), parse: parseTicker, takesArgs: true, fn: true },
  { name: 'FILINGS', screen: lazy('screens/filings.js'), parse: parseFilings, inputOf: filingsInputOf, takesArgs: true, fn: true },
  { name: 'SHORTS', screen: lazy('screens/shorts.js'), parse: parseTicker, takesArgs: true, fn: true },
  { name: 'BEATS', screen: lazy('screens/beats.js'), parse: parseTicker, takesArgs: true, fn: true },
  { name: 'VALUE', screen: lazy('screens/value.js'), parse: parseTicker, takesArgs: true, fn: true },
  { name: 'WHY', screen: lazy('screens/why.js'), parse: parseTicker, takesArgs: true, fn: true }, // WHY: biggest daily moves
  { name: 'IPOS', screen: lazy('screens/ipos.js') },
  { name: 'SPLITS', screen: lazy('screens/splits.js') },
  { name: 'EXDIV', screen: lazy('screens/exdiv.js'), parse: parseExdiv },
];

// Screens (lazy, see lazy.js) by name.
export const COMPANY_SCREENS = Object.fromEntries(COMPANY.map((c) => [c.name, c.screen]));

// Argument parsers for the commands that need a ticker.
export const COMPANY_TAKES_ARGS = Object.fromEntries(COMPANY.filter((c) => c.takesArgs).map((c) => [c.name, (args) => c.parse(args)]));

// The ticker functions: AAPL INSIDERS runs INSIDERS AAPL, and they join the stock function bar.
export const COMPANY_FUNCTIONS = COMPANY.filter((c) => c.fn).map((c) => c.name);

// head + rest -> { name, args, error, input } or null when no company command claims it.
export function matchCompany(head, rest) {
  const c = COMPANY.find((x) => x.name === head);
  if (!c) return null;
  if (!c.parse) return { name: c.name, args: {}, input: c.name };
  const args = c.parse(rest);
  const input = !args.error && c.inputOf ? c.inputOf(args) : [head, ...rest].join(' ');
  return { name: c.name, args, error: args.error, input };
}
