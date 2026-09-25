import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCommand, fromQuery, toQuery, suggest, stepActive, FKEYS, DEFAULT_COMMAND } from '../public/app.js';
import { buildId, versionIndex } from '../lib/assets.js';

// The owner's bug: HOME "did not work". The router was fine; browsers and the edge
// kept an app.js from before HOME existed (4 hour cache), which read HOME as a ticker.
test('HOME: every way in lands on the HOME screen', () => {
  assert.equal(parseCommand('HOME').name, 'HOME');
  assert.equal(parseCommand('home').name, 'HOME');
  assert.equal(parseCommand('  Home  ').name, 'HOME');
  assert.equal(parseCommand('').name, 'HOME');
  assert.equal(fromQuery(''), 'HOME');
  assert.equal(fromQuery('?c=HOME'), 'HOME');
  assert.equal(fromQuery('?c=home'), 'HOME');
  assert.equal(parseCommand(fromQuery(toQuery('home'))).name, 'HOME');
  assert.equal(DEFAULT_COMMAND, 'HOME');
  const f2 = FKEYS.find((k) => k.key === 'F2');
  assert.equal(parseCommand(f2.cmd).name, 'HOME');
  const sug = suggest('ho');
  assert.equal(sug[0].name, 'HOME');
  assert.equal(parseCommand(sug[0].value).name, 'HOME');
  assert.notEqual(parseCommand('HOME').name, 'QUOTE', 'HOME is a command, never a ticker');
});

test('suggestion list: arrows pick an item, and wrap back to what was typed', () => {
  assert.equal(stepActive(-1, 2, 1), 0);
  assert.equal(stepActive(0, 2, 1), 1);
  assert.equal(stepActive(1, 2, 1), -1);
  assert.equal(stepActive(-1, 2, -1), 1);
  assert.equal(stepActive(0, 2, -1), -1);
  assert.equal(stepActive(-1, 0, 1), -1);
  // "h", Down, Enter picks HOME (the first suggestion), not the H alias for HELP.
  const items = suggest('h');
  assert.equal(items[stepActive(-1, items.length, 1)].value, 'HOME');
});

test('assets: the build id follows the files, and the page points at it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-assets-'));
  mkdirSync(path.join(dir, 'screens'));
  writeFileSync(path.join(dir, 'app.js'), 'a');
  writeFileSync(path.join(dir, 'screens', 'home.js'), 'h1');
  const a = buildId(dir);
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(buildId(dir), a, 'stable');
  writeFileSync(path.join(dir, 'screens', 'home.js'), 'h2');
  assert.notEqual(buildId(dir), a, 'a changed screen changes the build');
  const html = versionIndex('<link rel="stylesheet" href="/style.css"><script type="module" src="/app.js"></script><script src="https://datafa.st/js/script.js"></script>', 'abc123');
  assert.match(html, /href="\/v\/abc123\/style\.css"/);
  assert.match(html, /src="\/v\/abc123\/app\.js"/);
  assert.match(html, /src="https:\/\/datafa\.st\/js\/script\.js"/);
});
