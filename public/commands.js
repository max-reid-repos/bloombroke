// Registry of the extra commands. One line per command: help text, examples and its screen.
// A screen may export parse(args) -> args | { error } | null (null = not this command, so
// NEWS with no ticker falls through to the market-wide NEWS screen). Without parse, extra
// words are ignored, like HOME or MARKETS.
//
// `id` is the internal screen key when it differs from the typed name.

import * as world from './screens/world.js';
import * as movers from './screens/movers.js';
import * as heatmap from './screens/heatmap.js';
import * as sectors from './screens/sectors.js';
import * as compare from './screens/compare.js';
import * as crypto from './screens/crypto.js';
import * as commodities from './screens/commodities.js';
import * as clock from './screens/clock.js';
import * as profile from './screens/profile.js';
import * as history from './screens/history.js';
import * as dividends from './screens/dividends.js';
import * as tickernews from './screens/tickernews.js';
import * as curve from './screens/curve.js';
import * as bonds from './screens/bonds.js';
import * as fxmatrix from './screens/fxmatrix.js';
import * as earnings from './screens/earnings.js';
import * as calendar from './screens/calendar.js';
import * as loan from './screens/loan.js';
import * as compound from './screens/compound.js';

export const EXTRA = [
  { name: 'WORLD', group: 'Markets', hint: 'World stock indexes by region, open or closed', usage: 'WORLD', example: 'WORLD', screen: world },
  { name: 'MOVERS', group: 'Markets', hint: 'Biggest gainers, losers and most traded in the S&P 100', usage: 'MOVERS', example: 'MOVERS', screen: movers },
  { name: 'HEATMAP', group: 'Markets', hint: 'The S&P 100 by sector, size and colour', usage: 'HEATMAP', example: 'HEATMAP', screen: heatmap },
  { name: 'SECTORS', group: 'Markets', hint: 'The 11 sectors: today, 1 month and this year', usage: 'SECTORS', example: 'SECTORS', screen: sectors },
  { name: 'COMPARE', group: 'Markets', hint: 'Race 2 to 5 tickers over a range', usage: 'COMPARE <tickers> [1Y]', example: 'COMPARE AAPL MSFT NVDA', examples: ['COMPARE AAPL MSFT NVDA', 'COMPARE KO PEP 5Y'], screen: compare, takesArgs: true },
  { name: 'COMMODITIES', group: 'Markets', hint: 'Oil, gold, wheat and more (delayed)', usage: 'COMMODITIES', example: 'COMMODITIES', screen: commodities },
  { name: 'CRYPTO', group: 'Markets', hint: 'The top 20 coins, 24 hours and 7 days', usage: 'CRYPTO', example: 'CRYPTO', screen: crypto },
  { name: 'CLOCK', group: 'Markets', hint: 'World market clocks: open, closed, time to the bell', usage: 'CLOCK', example: 'CLOCK', screen: clock },
  { name: 'PROFILE', group: 'Company', hint: 'What a company does, where it is, its website', usage: 'PROFILE <ticker>', example: 'PROFILE AAPL', examples: ['PROFILE AAPL', 'PROFILE KO'], screen: profile, takesArgs: true },
  { name: 'HISTORY', group: 'Company', hint: 'Daily prices for any dates, with a CSV download', usage: 'HISTORY <ticker>', example: 'HISTORY AAPL', examples: ['HISTORY AAPL', 'HISTORY TSLA 2024'], screen: history, takesArgs: true },
  { name: 'DIVIDENDS', group: 'Company', hint: 'Dividend yield and every payment', usage: 'DIVIDENDS <ticker>', example: 'DIVIDENDS PEP', examples: ['DIVIDENDS PEP', 'DIVIDENDS AAPL'], screen: dividends, takesArgs: true },
  { name: 'NEWS', id: 'TICKERNEWS', group: 'Company', hint: 'Headlines about one company', usage: 'NEWS <ticker>', example: 'NEWS AAPL', examples: ['NEWS AAPL', 'NEWS TSLA'], screen: tickernews },
  { name: 'CURVE', group: 'Rates and FX', hint: 'US Treasury yield curve: today, 1 month and 1 year ago', usage: 'CURVE', example: 'CURVE', screen: curve },
  { name: 'BONDS', group: 'Rates and FX', hint: 'Government bond yields by country: 2Y to 30Y, spreads, curves', usage: 'BONDS [SPREADS|CURVE]', example: 'BONDS', examples: ['BONDS', 'BONDS SPREADS', 'BONDS CURVE'], screen: bonds },
  { name: 'FXMATRIX', group: 'Rates and FX', hint: 'Cross rates for nine currencies, or HEAT for today\'s moves', usage: 'FXMATRIX [HEAT]', example: 'FXMATRIX', examples: ['FXMATRIX', 'FXMATRIX HEAT'], screen: fxmatrix },
  { name: 'EARNINGS', group: 'Calendars', hint: 'Who reports earnings today, or this week', usage: 'EARNINGS [day|WEEK]', example: 'EARNINGS', examples: ['EARNINGS', 'EARNINGS WEEK', 'EARNINGS TOMORROW'], screen: earnings },
  { name: 'CALENDAR', group: 'Calendars', hint: "This week's economic events: jobs, inflation, central banks", usage: 'CALENDAR [US|ALL]', example: 'CALENDAR', examples: ['CALENDAR', 'CALENDAR ALL'], screen: calendar },
  { name: 'LOAN', group: 'Money tools', hint: "Monthly payment and total interest, at today's mortgage rate or yours", usage: 'LOAN <amount> [years]', example: 'LOAN 400000 30Y', examples: ['LOAN 400000 30Y', 'LOAN 25000 5Y 7.9%'], screen: loan, takesArgs: true },
  { name: 'COMPOUND', group: 'Money tools', hint: 'What saving every month grows to, at a return you pick', usage: 'COMPOUND <plan>', example: 'COMPOUND 500/MO 8% 30Y', examples: ['COMPOUND 500/MO 8% 30Y', 'COMPOUND 10000 7% 20Y'], screen: compound, takesArgs: true },
];

// Help and suggestion entries, in the same shape as the core COMMANDS.
export const EXTRA_HELP = EXTRA.map(({ name, group, hint, usage, example, examples }) => ({ name, group, hint, usage, example, examples }));

// Screen modules by internal name.
export const EXTRA_SCREENS = Object.fromEntries(EXTRA.map((c) => [c.id || c.name, c.screen]));

// Argument parsers for commands that need arguments (Tab adds a space, bad input shows usage).
export const EXTRA_TAKES_ARGS = Object.fromEntries(EXTRA.filter((c) => c.takesArgs).map((c) => [c.name, (args) => c.screen.parse(args)]));

// head + rest -> { name, args, error, input } or null when no extra command claims it.
export function matchExtra(head, rest) {
  for (const c of EXTRA) {
    if (c.name !== head) continue;
    const args = c.screen.parse ? c.screen.parse(rest) : {};
    if (args === null) continue;
    const input = [head, ...(c.screen.parse ? rest : [])].join(' ');
    return { name: c.id || c.name, args, error: args.error, input };
  }
  return null;
}
