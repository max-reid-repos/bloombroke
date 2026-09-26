import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeGuard } from '../public/screens/size-guard.js';

// The owner's bug: on HOME the chart redrew over and over, a scrollbar coming and
// going with it (classic Windows scrollbars take ~15px of the box).

test('size guard: a new size draws, the same size (rounded) does not', () => {
  const g = sizeGuard();
  g.drawn(600, 300, 0);
  assert.equal(g.next(600, 300, 100), null);
  assert.equal(g.next(600.4, 299.6, 150), null, 'rounded before comparing');
  assert.deepEqual(g.next(640, 300, 200), { w: 640, h: 300 });
  assert.equal(g.next(640, 300, 300), null);
  assert.equal(g.next(0, 300, 400), null, 'an empty box draws nothing');
});

test('size guard: A, B, A within a second settles on the larger size', () => {
  const g = sizeGuard();
  g.drawn(542, 129, 0); // A
  assert.deepEqual(g.next(527, 114, 100), { w: 527, h: 114 }); // B: a scrollbar came
  // Back to A: the loop. The larger one is drawn once, and the pair is then ignored.
  assert.deepEqual(g.next(542, 129, 200), { w: 542, h: 129 });
  assert.equal(g.next(527, 114, 300), null);
  assert.equal(g.next(542, 129, 400), null);
  assert.equal(g.next(527, 114, 5000), null, 'still settled later on');
  // A real resize to a third size is followed again.
  assert.deepEqual(g.next(700, 200, 6000), { w: 700, h: 200 });
});

test('size guard: settled on the larger when the loop ends on it', () => {
  const g = sizeGuard();
  g.drawn(527, 114, 0); // small
  assert.deepEqual(g.next(542, 129, 100), { w: 542, h: 129 }); // large
  assert.equal(g.next(527, 114, 200), null, 'back to small: keep the large drawing');
  assert.equal(g.next(542, 129, 300), null);
});

test('size guard: a slow return to an earlier size is a real resize', () => {
  const g = sizeGuard();
  g.drawn(600, 300, 0);
  assert.deepEqual(g.next(500, 300, 100), { w: 500, h: 300 });
  assert.deepEqual(g.next(600, 300, 3000), { w: 600, h: 300 }, 'seconds apart: not a loop');
  assert.deepEqual(g.next(500, 300, 6000), { w: 500, h: 300 });
});

test('size guard: a redraw of new data at the current size counts as drawn', () => {
  const g = sizeGuard();
  g.drawn(600, 300, 0);
  g.drawn(600, 300, 5000); // new data, same box
  assert.deepEqual(g.next(585, 300, 5100), { w: 585, h: 300 });
  // 600 was last drawn at 5000, so this is a fast A, B, A: settle on 600.
  assert.deepEqual(g.next(600, 300, 5200), { w: 600, h: 300 });
  assert.equal(g.next(585, 300, 5300), null);
});
