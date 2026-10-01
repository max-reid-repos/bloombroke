// CHAT never carries a Pro key or a gift code in a message's text (security test, 30 Sep
// 2026): checkText refuses one with a plain message, as DRIVE and cards already refuse
// them (secretIn). Ordinary sentences with numbers and tickers still go through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkText, secretInText, ChatError, NO_KEYS, KEY_MIN_DISTINCT } from '../pro/chat.js';

const refused = (t) => {
  try { checkText(t); return null; } catch (e) { assert.ok(e instanceof ChatError); return e; }
};

test('a key or a gift code in the text is refused, with a clear message', () => {
  assert.equal(NO_KEYS, 'That looks like a Pro key or a gift code. Keys never go in CHAT.');
  for (const t of [
    'here is mine BB-7K2M-ABCD-EFGH-JKMN',
    'bb-7k2m-abcd-efgh-jkmn',
    'BB7K2MABCDEFGHJKMN',
    '7K2MABCDEFGHJKMN',
    '7k2m abcd efgh jkmn',
    'BB 7K2M ABCD EFGH JKMN thanks',
    'try 7K2M.ABCD.EFGH.JKMN',
    'GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345',
    'code: ABCD EFGH JKLM NPQR STUV WXYZ 2345',
    'key=FZ4MWS6CAXXPHT5F!',
    'key:FZ4MWS6CAXXPHT5F',
    'key:FZ4M-WS6C-AXXP-HT5F',
    '(BB-7K2M-ABCD-EFGH-JKMN)',
  ]) {
    const e = refused(t);
    assert.ok(e, t);
    assert.equal(e.code, 'no_keys', t);
    assert.equal(e.message, NO_KEYS);
  }
});

test('ordinary sentences with numbers and tickers still go through', () => {
  assert.equal(KEY_MIN_DISTINCT, 6);
  for (const t of [
    'NVDA up 12% today, told you', 'bought 50 more AAPL at 229.50', 'my GUESS score 4/6 lol', 'BTC 65000 by friday?',
    'TSLA 2026 target 400 per share', 'dca 25 a week since 2019 into VOO', 'WHATIF IPHONE6 LATTE 3Y was brutal',
    'sold 100 SPY 450 calls exp 12 20', 'bought 2 shares NVDA MSFT AAPL each', 'we need 25 more seats for the group',
    'AAPL MSFT NVDA TSLA', 'BBQ at 7 tonight?',
    'AAPL/MSFT/NVDA/TSLA all red', 'AAPL,MSFT,NVDA,TSLA', 'hahahahahahahaha', 'aaaaaaaaaaaaaaaa', '4242 4242 4242 4242',
    'up 2.5% on AAPL.MSFT.NVDA', 'AAPL-MSFT-NVDA-TSLA pair trade',
  ]) {
    assert.equal(refused(t), null, t);
    assert.equal(secretInText(t), false, t);
  }
});

test('the message route runs checkText on every message', () => {
  const routes = readFileSync('pro/chat-routes.js', 'utf8');
  assert.match(routes, /const text = checkText\(req\.body\?\.text, \{ hasCard: Boolean\(card\) \}\);/);
  const chat = readFileSync('pro/chat.js', 'utf8');
  assert.match(chat, /if \(secretInText\(text\)\) throw new ChatError\('no_keys', NO_KEYS\);/);
});
