// A cap on loads that go upstream at once. Same-key requests are already merged by the
// cache (one load per key); this stops a burst of DIFFERENT keys (date ranges, symbols,
// search words) from fanning out into hundreds of upstream calls.
//
// gate(fn): runs fn now when fewer than `concurrency` are running, else queues it. With
// `maxQueue` already waiting it fails at once with a GateBusy error (busy: true), which
// the cache does not remember as a failure (data/cache.js). A queued job still waiting
// after `maxWaitMs` fails the same way, so a slow source cannot hold a request past
// Cloudflare's 100 s (a 524).

export class GateBusy extends Error {
  constructor(message = 'too many loads waiting') {
    super(message);
    this.code = 'busy';
    this.busy = true;
  }
}

export const GATE_MAX_WAIT_MS = 10_000;

export function makeGate({ concurrency = 4, maxQueue = 32, maxWaitMs = GATE_MAX_WAIT_MS } = {}) {
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
      let timer = null;
      const start = () => {
        if (timer) clearTimeout(timer);
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => { running -= 1; next(); });
      };
      queue.push(start);
      next();
      if (queue.includes(start) && maxWaitMs > 0 && Number.isFinite(maxWaitMs)) {
        timer = setTimeout(() => {
          const i = queue.indexOf(start);
          if (i === -1) return;
          queue.splice(i, 1);
          reject(new GateBusy('waited too long for a load slot'));
        }, maxWaitMs);
        timer.unref?.();
      }
    });
  }
  gate.stats = () => ({ running, waiting: queue.length });
  return gate;
}
