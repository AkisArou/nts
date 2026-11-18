// Control for `tests/refusals/a-generic-function-called-with-this-is-never-copied`:
// the same receiver passed through a binding typed as its class, which pins the
// generic function's copy, so the call compiles and its `throw` reaches the
// `try` around the closure once the queue is full. The refusal is #860.

let queued: Array<() => void> = [];

function later<A extends unknown[]>(callback: (...args: A) => void, ...args: A): void {
  if (queued.length > 3) {
    throw new RangeError("full");
  }
  queued.push(() => callback(...args));
}

function bump(e: Emitter): void {
  e.count += 1;
}

class Emitter {
  count = 0;
  added(n: number): number {
    if (n > 1) {
      const self: Emitter = this;
      later(bump, self);
    }
    return n + this.count;
  }
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function count(k: number): void {
  void k;
}

export function probe(n: number): number {
  queued = [];
  later(count, n);
  const e = new Emitter();
  const first = attempt(() => e.added(n & 7));
  return first * 10 + queued.length;
}
