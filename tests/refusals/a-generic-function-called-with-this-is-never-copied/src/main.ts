// expect: it calls `later@raises`, which this program compiles only as instantiations
//
// A generic function called with `this` for a rest-tuple type parameter pins
// no instance, so the call names the generic itself, which is lowered only as
// the instances other calls pin -- `runtime/node/stream`'s
// `nextTick(readZero, this)` in `Readable#afterListenerAdded`, beside the
// `nextTick` calls that do pin. The ordinary caller said so; the raising caller
// asked for `later@raises` by its whole name, found no instance spelled that
// way, and said "which nothing in this program defines". The wrong call is the
// root and is older than #843. The control,
// `tests/programs/a-generic-function-called-with-a-typed-binding-of-this`,
// passes the same receiver through a binding typed as its class, which pins it.

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
      later(bump, this);
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
  return attempt(() => e.added(n & 7));
}
