// Control for `programs/a-throwing-getter-under-a-computed-key-inside-a-try`:
// the accessors are named `v` and `w` rather than computed from a symbol, and
// read and written as `r.v` and `r.w`.


class Box {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  get v(): number {
    if (this.n > 2) {
      throw new RangeError("big");
    }
    return this.n * 10;
  }
}

class Base {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  get v(): number {
    return this.n + 1;
  }
}

class Sub extends Base {
  override get v(): number {
    if (this.n > 2) {
      throw new RangeError("big");
    }
    return this.n * 10;
  }
}

class Sink {
  s = 0;
  set w(x: number) {
    if (x > 2) {
      throw new RangeError("big");
    }
    this.s = x;
  }
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function read(r: Box): number {
  return r.v;
}

function readBase(r: Base): number {
  return r.v;
}

function write(r: Sink, x: number): number {
  r.w = x;
  return r.s;
}

// A plain getter named `v`, read inside a `try` one call below.
export function getter(n: number): number {
  const r = new Box(n & 7);
  return attempt(() => read(r));
}

// A throwing override of a quiet base getter under the same key, read through
// the base.
export function override(n: number): number {
  const k = n & 7;
  const r: Base = (k & 1) === 0 ? new Base(k) : new Sub(k);
  return attempt(() => readBase(r));
}

// A setter named `w`.
export function setter(n: number): number {
  const r = new Sink();
  return attempt(() => write(r, n & 7));
}
