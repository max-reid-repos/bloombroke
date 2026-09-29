// HOLIDAYS: US stock market closures and early closes for the next 12 months, each day
// in the visitor's own time zone. The dates are app.js's (the market clock uses them).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NYSE_HOLIDAYS, NYSE_EARLY_CLOSES, parseCommand, marketStatus } from '../public/app.js';
import { HOLIDAY_NAMES, upcoming, holidaysTable, nextLine, nyDay, lastListed, marketDay } from '../public/screens/holidays.js';
import { findCommand, commandGroups } from '../public/registry.js';
import { screenFor } from '../public/app.js';

const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const NOW = Date.parse('2026-09-29T16:00:00Z'); // a Tuesday, noon in New York

test('HOLIDAYS: every closure and early close is a weekday with a name, and nothing else is named', () => {
  const all = [...NYSE_HOLIDAYS, ...NYSE_EARLY_CLOSES];
  for (const d of all) {
    assert.ok(weekday(d) >= 1 && weekday(d) <= 5, `${d} is a weekday`);
    assert.ok(HOLIDAY_NAMES[d], `${d} has a name`);
  }
  assert.deepEqual(Object.keys(HOLIDAY_NAMES).sort(), all.sort());
  for (const d of NYSE_EARLY_CLOSES) assert.ok(!NYSE_HOLIDAYS.has(d), `${d} is not both`);
  // The fixed ones fall where the calendar says.
  assert.ok(NYSE_HOLIDAYS.has('2026-11-26') && NYSE_HOLIDAYS.has('2026-12-25') && NYSE_HOLIDAYS.has('2027-07-05'));
  assert.ok(NYSE_EARLY_CLOSES.has('2026-11-27') && NYSE_EARLY_CLOSES.has('2026-12-24'));
  assert.equal(marketStatus(new Date('2026-11-26T15:00:00Z')), 'CLOSED', 'the clock agrees');
});

test('HOLIDAYS: the next 12 months, in order, closed or early close', () => {
  const rows = upcoming(NOW, 'America/New_York');
  assert.equal(rows[0].date, '2026-11-26');
  assert.ok(rows.every((r) => r.date >= nyDay(NOW) && r.date <= '2027-09-29'));
  assert.deepEqual(rows.map((r) => r.date), [...rows.map((r) => r.date)].sort());
  assert.deepEqual(rows.filter((r) => r.early).map((r) => r.date), ['2026-11-27', '2026-12-24']);
  assert.ok(!rows.some((r) => r.date === '2027-11-25'), 'past 12 months: not yet');
  assert.equal(rows[0].day, 'THU NOV 26, 2026');
  assert.equal(rows[0].localDay, null);
  // In New York the early close is just 1:00 pm New York.
  assert.equal(rows[1].closeLocal, null);
  const html = holidaysTable(rows);
  assert.match(html, /<td>Closed<\/td>/);
  assert.match(html, /Early close 1:00 pm New York<\/td>/);
  assert.equal(nextLine(rows), 'NEXT CLOSURE: THU NOV 26, 2026, THANKSGIVING DAY');
  assert.match(holidaysTable([]), /No closures listed/);
});

test('HOLIDAYS: the New York date first; the visitor\'s day and time second, dim', () => {
  const bkk = upcoming(NOW, 'Asia/Bangkok');
  assert.equal(bkk[0].day, 'THU NOV 26, 2026', 'the market date');
  assert.equal(bkk[0].localDay, null, '9:30 New York is the same evening in Bangkok: nothing more');
  const eve = bkk.find((r) => r.date === '2026-12-24');
  assert.equal(eve.closeLocal, '1:00 am Fri', '1:00 pm New York is 1:00 am the next day');
  const akl = upcoming(NOW, 'Pacific/Auckland');
  assert.equal(akl[0].day, 'THU NOV 26, 2026');
  assert.equal(akl[0].localDay, 'FRI NOV 27', 'Auckland: already the next day');
  assert.equal(akl.find((r) => r.date === '2026-11-27').closeLocal, '7:00 am Sat');
  assert.match(holidaysTable(akl), /<td class="co-date">THU NOV 26, 2026 <span class="dim hol-local">FRI NOV 27 your time<\/span><\/td>/);
  const la = upcoming(NOW, 'America/Los_Angeles');
  assert.equal(la[0].localDay, null);
  assert.equal(la.find((r) => r.date === '2026-11-27').closeLocal, '10:00 am');
  assert.match(holidaysTable(la), /Early close 1:00 pm New York <span class="dim">\(10:00 am your time\)<\/span>/);
  assert.match(holidaysTable(la), /<th scope="col" class="co-date">New York date<\/th>/);
  assert.equal(marketDay(lastListed()), 'FRI DEC 24, 2027');
  assert.match(readFileSync('public/screens/holidays.js', 'utf8'), /Listed to \$\{esc\(marketDay\(lastListed\(\)\)\)\}\./);
});

// A reminder with a date on it: this fails once the list covers less than the next 12
// months. Add the next year's NYSE dates to app.js (and their names to holidays.js).
test('HOLIDAYS: the dates reach at least 12 months past today', () => {
  const need = nyDay(Date.now() + 365 * 86400000);
  assert.ok(lastListed() >= need, `HOLIDAYS is listed to ${lastListed()}, short of ${need}: add the next year's NYSE holidays`);
});

test('HOLIDAYS: a free command, in the registry, HELP and MENU, lazy', () => {
  assert.equal(parseCommand('holidays').name, 'HOLIDAYS');
  const e = findCommand('HOLIDAYS');
  assert.equal(e.category, 'Economy and calendars');
  assert.ok(commandGroups().find((g) => g.name === 'Economy and calendars').items.some((it) => it.name === 'HOLIDAYS'));
  assert.equal(screenFor('HOLIDAYS').js, 'screens/holidays.js');
  const src = readFileSync('public/screens/holidays.js', 'utf8');
  assert.doesNotMatch(src, /—|pro\b.*only/i);
  assert.match(src, /nyse\.com/, 'the source of the names is named');
});
