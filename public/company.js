// Registry of the company-data commands, in the same shape as commands.js: help text,
// examples and the screen. A screen may export parse(args) -> args | { error }, and
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

export const COMPANY = [
  { name: 'INSIDERS', group: 'Company', hint: 'What officers and directors bought and sold', usage: 'INSIDERS <ticker>', example: 'INSIDERS AAPL', examples: ['INSIDERS AAPL', 'INSIDERS NVDA'], screen: insiders, takesArgs: true, fn: true },
  { name: 'OWNERS', group: 'Company', hint: 'The biggest funds holding a stock, from 13F filings', usage: 'OWNERS <ticker>', example: 'OWNERS AAPL', examples: ['OWNERS AAPL', 'OWNERS KO'], screen: owners, takesArgs: true, fn: true },
  { name: 'FILINGS', group: 'Company', hint: 'Latest SEC filings, with links to sec.gov', usage: 'FILINGS <ticker> [10-K|10-Q|8-K|4]', example: 'FILINGS AAPL', examples: ['FILINGS AAPL', 'FILINGS TSLA 8-K'], screen: filings, takesArgs: true, fn: true },
  { name: 'SHORTS', group: 'Company', hint: 'Short interest and days to cover, twice a month', usage: 'SHORTS <ticker>', example: 'SHORTS AAPL', examples: ['SHORTS AAPL', 'SHORTS TSLA'], screen: shorts, takesArgs: true, fn: true },
  { name: 'BEATS', group: 'Company', hint: 'Reported EPS against the consensus estimate', usage: 'BEATS <ticker>', example: 'BEATS AAPL', examples: ['BEATS AAPL', 'BEATS KO'], screen: beats, takesArgs: true, fn: true },
  { name: 'VALUE', group: 'Company', hint: 'P/E, dividend yield, margins, debt and the 52 week range', usage: 'VALUE <ticker>', example: 'VALUE AAPL', examples: ['VALUE AAPL', 'VALUE JPM'], screen: value, takesArgs: true, fn: true },
  { name: 'IPOS', group: 'Calendars', hint: 'IPOs: upcoming, priced and filed', usage: 'IPOS', example: 'IPOS', screen: ipos },
  { name: 'SPLITS', group: 'Calendars', hint: 'Upcoming stock splits and reverse splits', usage: 'SPLITS', example: 'SPLITS', screen: splits },
  { name: 'EXDIV', group: 'Calendars', hint: 'Ex-dividend dates for the next five weekdays', usage: 'EXDIV [day]', example: 'EXDIV', examples: ['EXDIV', 'EXDIV 2026-10-01'], screen: exdiv },
];

// Help and suggestion entries, in the same shape as the core COMMANDS.
export const COMPANY_HELP = COMPANY.map(({ name, group, hint, usage, example, examples }) => ({ name, group, hint, usage, example, examples }));

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
