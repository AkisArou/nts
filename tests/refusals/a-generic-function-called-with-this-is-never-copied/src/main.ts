// expect: it calls `later@raises`, and a generic function this program calls and never copies
//
// A generic function called with `this` for a rest-tuple type parameter pins
// nothing a copy is made for, so the function is refused as one this program
// calls and never copies -- `runtime/node/stream`'s `nextTick(readZero, this)`
// in `Readable#afterListenerAdded`. The expect line is the raising caller's: a
// function refused whole was recorded only under its ordinary name, so the
// raising copy of its caller said "it calls `later@raises`, which nothing in
// this program defines", a cascade with no root. The control,
// `tests/programs/a-generic-function-called-with-a-typed-binding-of-this`,
// passes the same receiver through a binding typed as its class, which pins the
// copy.

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

export function probe(n: number): number {
  const e = new Emitter();
  return attempt(() => e.added(n & 7));
}
