// Control for `a-throwing-accessor-override-through-a-base`: the throwing
// accessors are the base's own and nothing overrides them, so each accessor's
// own declaration already says the read or write can raise.

class Base {
  stored = 0;
  constructor(readonly n: number) {}
  get v(): number {
    if (this.n > 2) {
      throw new RangeError("big " + this.n);
    }
    return this.n * 10;
  }
  set w(x: number) {
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

/** A throwing getter read. */
export function getter(n: number): number {
  const r = new Base(n & 7);
  return attempt(() => read(r));
}

/** A throwing setter write. */
export function setter(n: number): number {
  const k = n & 7;
  const r = new Base(k);
  return attempt(() => write(r, k));
}
