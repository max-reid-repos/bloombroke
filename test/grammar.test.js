import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseTickerFunction, tickerFunctions, suggest, FUNCTION_BAR } from '../public/app.js';

test('grammar: <TICKER> <FUNCTION> runs <FUNCTION> <TICKER>', () => {
  assert.deepEqual(parseCommand('aapl chart 5y').args, { ticker: 'AAPL', range: '5Y' });
  assert.deepEqual(parseCommand('CHART AAPL 5Y').args, { ticker: 'AAPL', range: '5Y' });
  assert.deepEqual(parseCommand('AAPL CHART').args, { ticker: 'AAPL', range: '1Y' });
  assert.deepEqual(parseCommand('EURO STOXX 50 CHART 5Y').args, { ticker: 'STOXX50', range: '5Y' });
  assert.deepEqual(parseCommand('AAPL CHART 2020-01-01 2024-12-31').args, { ticker: 'AAPL', from: '2020-01-01', to: '2024-12-31' });
  const w = parseCommand('GOLD WATCH');
  assert.equal(w.name, 'WATCH');
  assert.deepEqual(w.args.ids, ['GOLD']);
  assert.equal(w.mutates, true);
});

test('grammar: a function that is not built yet says coming soon, not a ticker error', () => {
  for (const fn of ['FINANCIALS', 'PROFILE', 'HISTORY', 'DIVIDENDS', 'COMPARE MSFT']) {
    const r = parseCommand(`AAPL ${fn}`);
    // Once a function ships, it parses to its own screen with the ticker in it.
    if (r.name === 'SOON') {
      assert.equal(r.args.soon.ticker, 'AAPL');
      assert.match(r.args.soon.name, /^AAPL /);
    } else {
      assert.notEqual(r.name, 'UNKNOWN');
      assert.ok(r.input.split(' ').includes('AAPL'));
    }
  }
  assert.equal(parseTickerFunction(['AAPL', '5Y']), null, 'a range is not a function');
  assert.equal(parseTickerFunction(['GOOGLE', 'CHART']), null);
  assert.equal(parseCommand('AAPL 7Y').name, 'UNKNOWN');
  assert.equal(parseCommand('AAPL LOL').name, 'UNKNOWN');
});

test('grammar: commands still win, W is the watchlist only alone or before a WATCH word', () => {
  assert.equal(parseCommand('FX 500 USD THB').name, 'FX');
  assert.equal(parseCommand('W').name, 'WATCH');
  assert.equal(parseCommand('W ADD TSLA').name, 'WATCH');
  assert.equal(parseCommand('W 5Y').name, 'QUOTE');
  assert.equal(parseCommand('W 5Y').args.ticker, 'W');
  assert.equal(parseCommand('W CHART').args.ticker, 'W');
  assert.equal(parseCommand('PF').name, 'PORTFOLIO');
  assert.equal(parseCommand('PORTFOLIO').input, 'PF');
});

test('grammar: commands that change lists put their screen in the URL', () => {
  const add = parseCommand('PF ADD AAPL 10 @ 150');
  assert.equal(add.mutates, true);
  assert.equal(add.view, 'PF');
  assert.equal(parseCommand('PF').mutates, false);
  assert.equal(parseCommand('WATCH REMOVE AAPL').view, 'WATCH');
  assert.equal(parseCommand('WATCH EXPORT').mutates, false);
});

test('function bar: CHART first, the rest marked ready or not', () => {
  const fns = tickerFunctions('AAPL');
  assert.deepEqual(fns.map((f) => f.fn), FUNCTION_BAR);
  assert.deepEqual(fns[0], { fn: 'CHART', cmd: 'AAPL', ready: true, current: true });
  for (const f of fns.slice(1)) {
    assert.equal(f.cmd, `AAPL ${f.fn}`);
    assert.equal(f.ready, parseCommand(f.cmd).name !== 'SOON');
  }
});

test('suggestions: WATCH and PF, with usage lines', () => {
  assert.ok(suggest('WAT').some((s) => s.name === 'WATCH'));
  assert.ok(suggest('PF').some((s) => s.name === 'PORTFOLIO'));
  const u = suggest('PF ADD ');
  assert.equal(u[0].usage, true);
  assert.equal(u[0].value, 'PF ADD AAPL 10 @ 150');
  assert.equal(suggest('WATCH ADD ')[0].usage, true);
  assert.equal(suggest('WATCH ').length, 0);
});
