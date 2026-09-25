// Data-correctness regressions from the live-site audit (Sep 2026): SCREEN session
// labels and preset form values, and the rest of the list screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeScreen } from '../data/screen.js';
import { createCache } from '../data/cache.js';
import { parseScreenArgs, screenWords } from '../public/screener.js';
import { formValues, wordsFromForm, presetValues, asOfLine, resultsTable } from '../public/screens/screen.js';

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
