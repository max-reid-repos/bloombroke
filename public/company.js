// Routing for the company-data commands, in the same shape as commands.js: the screen.
// Help text and examples live in registry.js. A screen may export parse(args) -> args | { error }, and
// inputOf(args) for the words that go in the URL.

import * as insiders from './screens/insiders.js';
import * as owners from './screens/owners.js';
import * as filings from './screens/filings.js';
import * as shorts from './screens/shorts.js';
import * as beats from './screens/beats.js';
import * as value from './screens/value.js';
import * as ipos from './screens/ipos.js';
import * as splits from './screens/splits.js';
import * as exdiv from './screens/exdiv.js';
import * as why from './screens/why.js'; // WHY

export const COMPANY = [
  { name: 'INSIDERS', screen: insiders, takesArgs: true, fn: true },
  { name: 'OWNERS', screen: owners, takesArgs: true, fn: true },
  { name: 'FILINGS', screen: filings, takesArgs: true, fn: true },
  { name: 'SHORTS', screen: shorts, takesArgs: true, fn: true },
  { name: 'BEATS', screen: beats, takesArgs: true, fn: true },
  { name: 'VALUE', screen: value, takesArgs: true, fn: true },
  { name: 'WHY', screen: why, takesArgs: true, fn: true }, // WHY: biggest daily moves
  { name: 'IPOS', screen: ipos },
  { name: 'SPLITS', screen: splits },
  { name: 'EXDIV', screen: exdiv },
];

// Screen modules by name.
export const COMPANY_SCREENS = Object.fromEntries(COMPANY.map((c) => [c.name, c.screen]));

// Argument parsers for the commands that need a ticker.
export const COMPANY_TAKES_ARGS = Object.fromEntries(COMPANY.filter((c) => c.takesArgs).map((c) => [c.name, (args) => c.screen.parse(args)]));

// The ticker functions: AAPL INSIDERS runs INSIDERS AAPL, and they join the stock function bar.
export const COMPANY_FUNCTIONS = COMPANY.filter((c) => c.fn).map((c) => c.name);

// head + rest -> { name, args, error, input } or null when no company command claims it.
export function matchCompany(head, rest) {
  const c = COMPANY.find((x) => x.name === head);
  if (!c) return null;
  if (!c.screen.parse) return { name: c.name, args: {}, input: c.name };
  const args = c.screen.parse(rest);
  const input = !args.error && c.screen.inputOf ? c.screen.inputOf(args) : [head, ...rest].join(' ');
  return { name: c.name, args, error: args.error, input };
}
