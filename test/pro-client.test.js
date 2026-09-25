import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseCommand, suggest, COMMANDS, SOON } from '../public/app.js';
import { urlCommand } from '../public/commands.js';
import {
  parseTape, applyTape, cleanTape, tapeSymbol, planPull, planPush, statusActive, loadTapeRows,
  normalizeKey as clientNormalize, DEFAULT_TAPE, MAX_TAPE, SYNC_DOCS, PRO_ONLY,
} from '../public/pro.js';
import { parseLogin, maskKey, keyFileText, statusText, SAVE_LINE, BUY_TERMS, OPERATOR, CONTACT } from '../public/screens/pro.js';
import { normalizeKey as serverNormalize, generateKey } from '../pro/licence.js';

test('client and server read keys the same way', () => {
  for (let i = 0; i < 50; i++) {
    const k = generateKey();
    for (const v of [k, k.toLowerCase(), k.replace(/-/g, ''), k.replace(/-/g, ' '), ` ${k} `]) {
      assert.equal(clientNormalize(v), serverNormalize(v), v);
      assert.equal(clientNormalize(v), k);
    }
  }
  for (const bad of ['', 'BB-0000-0000-0000-0000', 'hello', 'BB-AAAA']) assert.equal(clientNormalize(bad), serverNormalize(bad));
});

test('router: PRO, TAPE, LOGIN, LOGOUT; LOGIN keeps the key out of the URL and title', () => {
  assert.equal(parseCommand('pro').name, 'PRO');
  assert.equal(parseCommand('logout').name, 'LOGOUT');
  const login = parseCommand('login bb-7kq2-m9xd-ht4p-wz3c');
  assert.equal(login.name, 'LOGIN');
  assert.deepEqual(login.args, { key: 'BB-7KQ2-M9XD-HT4P-WZ3C' });
  assert.equal(login.input, 'LOGIN', 'no key in the title');
  assert.equal(parseCommand('LOGIN').args.show, true);
  assert.equal(parseCommand('LOGIN nonsense').error, 'format');
  assert.equal(urlCommand('LOGIN BB-7KQ2-M9XD-HT4P-WZ3C'), 'PRO');
  assert.equal(urlCommand('LOGOUT'), 'PRO');
  assert.equal(urlCommand('TAPE ADD AAPL'), 'TAPE');
  assert.equal(urlCommand('AAPL 5Y'), 'AAPL 5Y');
  assert.equal(urlCommand('PROFILE AAPL'), 'PROFILE AAPL');
  assert.equal(parseCommand('TAPE ADD AAPL').name, 'TAPE');
  assert.equal(suggest('TAPE ADD ')[0].usage, true);
  assert.ok(COMMANDS.some((c) => c.name === 'PRO' && c.group === 'Pro'));
  assert.ok(!SOON.some((s) => s.name === 'PRO'), 'PRO is no longer coming soon');
  assert.ok(SOON.some((s) => s.name === 'ALERTS'));
});

test('TAPE: parse ADD, REMOVE, RESET and bad symbols', () => {
  assert.deepEqual(parseTape([]), { action: 'show' });
  assert.deepEqual(parseTape(['ADD', 'AAPL', 'MSFT', 'AAPL']), { action: 'add', symbols: ['AAPL', 'MSFT'] });
  assert.deepEqual(parseTape(['ADD', 'AAPL,NVDA']), { action: 'add', symbols: ['AAPL', 'NVDA'] });
  assert.deepEqual(parseTape(['ADD', 'GOLD']), { action: 'add', symbols: [tapeSymbol('GOLD')] });
  assert.deepEqual(parseTape(['REMOVE', 'AAPL']), { action: 'remove', symbols: ['AAPL'] });
  assert.deepEqual(parseTape(['RESET']), { action: 'reset' });
  assert.equal(parseTape(['ADD']).error, 'usage');
  assert.equal(parseTape(['RESET', 'NOW']).error, 'usage');
  assert.equal(parseTape(['FLY']).error, 'usage');
  assert.deepEqual(parseTape(['ADD', 'TOOLONGX']), { error: 'symbol', bad: 'TOOLONGX' });
  assert.equal(tapeSymbol('brk.b'), 'BRK.B');
});

test('TAPE: apply starts from the standard tape, caps the length, reset means default', () => {
  const added = applyTape(null, { action: 'add', symbols: ['AAPL'] });
  assert.deepEqual(added, [...DEFAULT_TAPE, 'AAPL'].slice(0, MAX_TAPE));
  const mine = ['AAPL', 'MSFT'];
  assert.deepEqual(applyTape(mine, { action: 'add', symbols: ['MSFT', 'NVDA'] }), ['AAPL', 'MSFT', 'NVDA']);
  assert.deepEqual(applyTape(mine, { action: 'remove', symbols: ['AAPL'] }), ['MSFT']);
  assert.equal(applyTape(mine, { action: 'reset' }), null);
  const many = Array.from({ length: 60 }, (_, i) => `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
  assert.equal(applyTape([], { action: 'add', symbols: many }).length, MAX_TAPE);
  assert.deepEqual(cleanTape(['aapl', 'AAPL', 42, '<script>', 'MSFT']), ['AAPL', 'MSFT']);
  assert.equal(cleanTape('AAPL'), null);
});

test('TAPE: rows come from MARKETS for named instruments, /api/quote for tickers', async () => {
  const urls = [];
  const fetchJSON = async (url) => {
    urls.push(url);
    if (url === '/api/markets') return { instruments: [{ id: 'SPX', name: 'S&P 500', last: 1 }] };
    if (url === '/api/quote?s=AAPL') return { ticker: 'AAPL', name: 'Apple Inc', last: 2, change: 1, changePct: 0.5, decimals: null };
    throw Object.assign(new Error('nope'), { status: 404 });
  };
  const rows = await loadTapeRows(['AAPL', 'SPX', 'ZZZZ'], fetchJSON);
  assert.deepEqual(rows.map((r) => r.id), ['AAPL', 'SPX']);
  assert.equal(rows[0].name, 'AAPL');
  assert.equal(rows[0].decimals, 2);
  assert.ok(!urls.includes('/api/quote?s=SPX'));
});

test('sync planning: pull newer server copies, push local changes once', () => {
  assert.deepEqual(Object.keys(SYNC_DOCS), ['watch', 'pf', 'tape']);
  const meta = { watch: { raw: '["AAPL"]', updatedAt: 100 } };
  // Pull: only newer, only known names.
  const pulls = planPull(meta, {
    watch: { data: ['OLD'], updatedAt: 50 },
    pf: { data: [{ s: 'KO' }], updatedAt: 10 },
    evil: { data: 1, updatedAt: 999 },
  });
  assert.deepEqual(pulls, [{ name: 'pf', data: [{ s: 'KO' }], updatedAt: 10 }]);
  assert.deepEqual(planPull(meta, { watch: { data: ['NEW'], updatedAt: 101 } }).map((p) => p.name), ['watch']);
  // Push: unchanged docs stay quiet, changed ones go with a newer time.
  assert.deepEqual(planPush(meta, { watch: '["AAPL"]', pf: null, tape: null }, 5000), {});
  const push = planPush(meta, { watch: '["AAPL","MSFT"]', pf: '[]', tape: null }, 5000);
  assert.deepEqual(push, { watch: { data: ['AAPL', 'MSFT'], updatedAt: 5000 }, pf: { data: [], updatedAt: 5000 } });
  // A local delete goes up as null; a clock behind the last sync still moves forward.
  assert.deepEqual(planPush({ tape: { raw: '["X"]', updatedAt: 9000 } }, { tape: null }, 5000), { tape: { data: null, updatedAt: 9001 } });
  // Unreadable local JSON is skipped, not sent.
  assert.deepEqual(planPush({}, { watch: '{bad', pf: null, tape: null }, 1), {});
});

test('status: active, trialing, grace, off', () => {
  const now = Date.UTC(2026, 8, 25);
  assert.equal(statusActive({ status: 'active' }, now), true);
  assert.equal(statusActive({ status: 'trialing' }, now), true);
  assert.equal(statusActive({ status: 'past_due', graceUntil: new Date(now + 1000).toISOString() }, now), true);
  assert.equal(statusActive({ status: 'past_due', graceUntil: new Date(now - 1000).toISOString() }, now), false);
  assert.equal(statusActive({ status: 'canceled' }, now), false);
  assert.equal(statusActive(null, now), false);
  assert.equal(statusText({ status: 'active' }), 'ACTIVE');
  assert.equal(statusText({ status: 'canceled' }), 'CANCELED');
  assert.match(statusText({ status: 'past_due', graceUntil: new Date(Date.now() + 86400000).toISOString() }), /^PAYMENT FAILED\. PRO STAYS ON UNTIL /);
});

test('PRO screen copy: the save line, the key file, the mask, the free-user line', () => {
  assert.equal(SAVE_LINE, 'Save this key. It is your login on any device.');
  const txt = keyFileText('BB-7KQ2-M9XD-HT4P-WZ3C');
  assert.ok(txt.includes('BB-7KQ2-M9XD-HT4P-WZ3C') && txt.includes(SAVE_LINE));
  assert.equal(maskKey('WZ3C'), 'BB-XXXX-XXXX-XXXX-WZ3C');
  assert.deepEqual(parseLogin(['BB', '7KQ2', 'M9XD', 'HT4P', 'WZ3C']), { key: 'BB-7KQ2-M9XD-HT4P-WZ3C' });
  assert.match(PRO_ONLY, /\$4\.20 a month/);
  // Before SUBSCRIBE: price, monthly renewal, how to cancel, the shutdown promise.
  const terms = BUY_TERMS.join(' ');
  assert.match(terms, /\$4\.20 USD a month/);
  assert.match(terms, /renews automatically every month/);
  assert.match(terms, /Cancel any time: type PRO and press MANAGE/);
  assert.ok(BUY_TERMS.includes('If we ever shut Bloombroke down, we cancel all subscriptions and refund the unused part of the current month.'));
  assert.equal(OPERATOR, 'Bloombroke is run by Bloombroke, Singapore.');
  assert.equal(CONTACT, 'hello@bloombroke.com');
  assert.ok(txt.includes(CONTACT));
});

test('copy rules for the Pro files: no banned brand word, no em dashes', () => {
  const files = [
    'public/pro.js', 'public/pro.css', 'public/screens/pro.js', 'public/screens/tape.js', 'README.md',
    ...readdirSync('pro').map((f) => `pro/${f}`), 'scripts/stripe-setup.js', 'scripts/shutdown-refunds.js',
    ...readdirSync('migrations').map((f) => `migrations/${f}`),
  ];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /\u2014/, `${f}: em dash`);
  }
});
