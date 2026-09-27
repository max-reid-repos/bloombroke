// A cap on loads that go upstream at once. Same-key requests are already merged by the
// cache (one load per key); this stops a burst of DIFFERENT keys (date ranges, symbols,
// search words) from fanning out into hundreds of upstream calls.
//
// gate(fn): runs fn now when fewer than `concurrency` are running, else queues it. With
// `maxQueue` already waiting it fails at once with a GateBusy error (busy: true), which
// the cache does not remember as a failure (data/cache.js).

export class GateBusy extends Error {
  constructor(message = 'too many loads waiting') {
    super(message);
    this.code = 'busy';
    this.busy = true;
  }
}

export function makeGate({ concurrency = 4, maxQueue = 32 } = {}) {
  let running = 0;
  const queue = [];
  function next() {
    while (running < concurrency && queue.length) {
      running += 1;
      queue.shift()();
    }
  }
  function gate(fn) {
    if (running >= concurrency && queue.length >= maxQueue) return Promise.reject(new GateBusy());
    return new Promise((resolve, reject) => {
      const start = () => {
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => { running -= 1; next(); });
      };
      queue.push(start);
      next();
    });
  }
  gate.stats = () => ({ running, waiting: queue.length });
  return gate;
}
