// Data-correctness regressions from the live-site audit (Sep 2026): SCREEN session
// labels and preset form values, and the rest of the list screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeScreen } from '../data/screen.js';
import { createCache } from '../data/cache.js';
import { parseScreenArgs, screenWords } from '../public/screener.js';
import { formValues, wordsFromForm, presetValues, asOfLine, resultsTable } from '../public/screens/screen.js';
import { parseExDiv, cleanExDiv, exDivProblem, makeSplits } from '../data/splits.js';
import { exdivTable } from '../public/screens/exdiv.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const json = (body) => ({ ok: true, status: 200, json: async () => body });

// ---- SCREEN ---------------------------------------------------------------------
// Real Nasdaq screener answer taken at 12:32 New York time on 2026-09-25: the file
// still says "Last price as of Sep 24, 2026" (AAPL 335.92 was the Sep 24 close).
const SCR = fixture('nasdaq-screener-asof.json');

test('SCREEN: the answer says which session the numbers are from', async () => {
  const fetchImpl = async (url) => json(url.includes('download=true') ? { data: { rows: SCR.data.table.rows } } : SCR);
  const s = makeScreen({ fetchImpl, cache: createCache(), getFundMap: async () => new Map(), now: () => Date.parse('2026-09-25T16:32:00Z') });
  const d = await s.getScreen('GAINERS');
  assert.equal(d.asOf, '2026-09-24');
  assert.equal(d.today, '2026-09-25');
  const line = asOfLine(d.asOf, d.today);
  assert.match(line, /Screener data as of SEP 24 close/);
  assert.match(line, /not today/);
  assert.match(line, /MOVERS/);
  assert.doesNotMatch(asOfLine('2026-09-25', '2026-09-25'), /close|not today/);
  assert.match(asOfLine(null, '2026-09-25'), /date unknown/);
  assert.match(resultsTable(d.rows, parseScreenArgs('GAINERS'), d.asOf), />%Chg SEP 24/);
});

test('SCREEN form: a preset fills its own boxes, and they do not become extra words', () => {
  assert.deepEqual(presetValues('GAINERS'), { CHG_min: '0', MCAP_min: '300M' });
  assert.deepEqual(presetValues('LOSERS'), { CHG_max: '0', MCAP_min: '300M' });
  const v = formValues(parseScreenArgs('GAINERS'));
  assert.equal(v.CHG_min, '0');
  assert.equal(v.MCAP_min, '300M');
  assert.deepEqual(wordsFromForm(v), { words: 'GAINERS' });
  // A typed rule on the same box wins, and stays a word of its own.
  const spec = parseScreenArgs('GAINERS MCAP>10B');
  const w = formValues(spec);
  assert.equal(w.MCAP_min, '10B');
  assert.deepEqual(wordsFromForm(w, spec.sort), { words: screenWords(spec) });
  // Without the preset the same values are ordinary rules.
  assert.deepEqual(wordsFromForm({ ...v, preset: '' }), { words: 'MCAP>300M CHG>0' });
});

// ---- EXDIV ----------------------------------------------------------------------
// Real Nasdaq dividend-calendar rows (Sep 28 and 29, 2026): ERIC lists payment on
// 9/25 for a record date of 9/29; GGAL and BZ list a historical annual dividend of 0.
test('EXDIV: impossible date orders are left out and named, zero annual amounts are "--"', async () => {
  const body = fixture('nasdaq-exdiv-checks.json');
  const rows = parseExDiv(body.data);
  assert.equal(rows.find((r) => r.symbol === 'GGAL').annual, null);
  assert.equal(rows.find((r) => r.symbol === 'BZ').annual, null);
  assert.equal(rows.find((r) => r.symbol === 'GSBC').annual, 1.72);
  assert.equal(exDivProblem(rows.find((r) => r.symbol === 'ERIC')), 'paid before the record date');
  assert.equal(exDivProblem({ record: '2026-09-28', announced: '2026-09-30' }), 'record date before the announcement');
  assert.equal(exDivProblem(rows.find((r) => r.symbol === 'GSBC')), null);
  const c = cleanExDiv(rows);
  assert.deepEqual(c.rows.map((r) => r.symbol), ['BZ', 'GGAL', 'GSBC']);
  assert.deepEqual(c.dropped.map((r) => r.symbol), ['ERIC']);
  const html = exdivTable(c.rows);
  assert.doesNotMatch(html, /\$0\.0000/);
  assert.match(html, />--</);
  const sp = makeSplits({ fetchImpl: async () => json(body), cache: createCache(), now: () => Date.parse('2026-09-26T15:00:00Z') });
  const one = await sp.getExDiv('2026-09-29');
  assert.deepEqual(one.days[0].dropped, [{ symbol: 'ERIC', company: 'Ericsson American Depositary Shares', why: 'paid before the record date' }]);
  assert.ok(one.days[0].rows.every((r) => r.symbol !== 'ERIC'));
});
