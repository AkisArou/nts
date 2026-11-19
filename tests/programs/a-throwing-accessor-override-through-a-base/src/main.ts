// A read or write of an accessor through a base whose accessor cannot throw
// runs whichever accessor the receiver holds, so it can raise what an override
// can. Without an override edge for accessors, `r.v` and `r.v = x` read as
// unable to raise: the closure's raising copy used the ordinary accessor slot,
// and the override's `throw` ended the program inside a `try` where node
// catches it. Main gave the same wrong answer while the closure raising gate
// was on, and refused while a generic method held it off.
//
// The control is the same program with the throwing accessors in the base and
// no override.

class Base {
  stored = 0;
  constructor(readonly n: number) {}
  get v(): number {
    return this.n + 1;
  }
  set w(x: number) {
    this.stored = x;
  }
}

class Sub extends Base {
  override get v(): number {
    if (this.n > 2) {
      throw new RangeError("big " + this.n);
    }
    return this.n * 10;
  }
  override set w(x: number) {
    if (x > 2) {
      throw new RangeError("big " + x);
    }
    this.stored = x * 10;
  }
}

function read(r: Base): number {
  return r.v;
}

function write(r: Base, x: number): number {
  r.w = x;
  return r.stored;
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function pick(k: number): Base {
  return (k & 1) === 0 ? new Base(k) : new Sub(k);
}

/** A getter override read through the base. */
export function getter(n: number): number {
  const r = pick(n & 7);
  return attempt(() => read(r));
}

/** A setter override written through the base. */
export function setter(n: number): number {
  const k = n & 7;
  const r = pick(k);
  return attempt(() => write(r, k));
}
