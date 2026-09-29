// MENU (Ctrl+K) lists every command someone can type: each registry entry is in the menu
// (public/menu.js menuItems), and every command the router knows has a registry entry.
// An entry left out must be in HIDDEN below, with the reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY } from '../public/registry.js';
import { menuItems } from '../public/menu.js';
import { EXTRA } from '../public/commands.js';
import { COMPANY_SCREENS } from '../public/company.js';
import { MARKETS_SCREENS } from '../public/commands-markets.js';
import { WEIRD_SCREENS } from '../public/commands-weird.js';

// Not in the menu, on purpose.
const HIDDEN = {
  MENU: 'the menu itself',
  '<TICKER>': 'a pattern (type a ticker), not a word',
  '<TICKER> <FUNCTION>': 'a pattern (a ticker and a function), not a word',
  420: 'an easter egg (hidden: true)',
  BUY: 'renamed to AFFORD; typed, it says so (hidden: true)',
};

test('MENU lists every registry command, except the few named in HIDDEN', () => {
  const listed = new Set(menuItems().map((c) => c.name));
  const missing = REGISTRY.filter((c) => !listed.has(c.name) && !(c.name in HIDDEN)).map((c) => c.name);
  assert.deepEqual(missing, [], `add these to the menu (or to HIDDEN with a reason): ${missing.join(', ')}`);
  for (const name of Object.keys(HIDDEN)) assert.ok(REGISTRY.some((c) => c.name === name), `${name} is still a registry entry`);
  for (const name of ['BBRK', 'SPONSOR', 'CHANGES', 'DATA', 'STATUS', 'CHAT', 'ME', 'GIFT', 'REDEEM', 'FEEDBACK', 'GRAVEYARD', 'GRID', 'WEIRD', 'WORLDMAP', 'FISHTANK', 'TRENDING', 'GUESS', 'WHATIF', 'LOGIN', 'LOGOUT']) {
    assert.ok(listed.has(name), `${name} is in the menu`);
  }
});

test('every command the router knows has a registry entry, so it can be in the menu', () => {
  const known = new Set(REGISTRY.flatMap((c) => [c.name, ...(c.aliases || [])]));
  const routed = [...EXTRA.map((c) => c.name), ...Object.keys(COMPANY_SCREENS), ...Object.keys(MARKETS_SCREENS), ...Object.keys(WEIRD_SCREENS)];
  const missing = [...new Set(routed)].filter((n) => !known.has(n));
  assert.deepEqual(missing, []);
});
