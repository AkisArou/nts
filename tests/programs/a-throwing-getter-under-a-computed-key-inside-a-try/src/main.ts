// A throwing accessor under a computed key (`get [kV]`, `set [kW]`), reached
// inside a `try` one call below, plainly and as a throwing override of a quiet
// base getter read through the base.
//
// The throw analysis found an access's accessor through the symbol of the
// access's last child, which for `r[kV]` is the key expression: its symbol is
// the `const kV`, so neither walk saw the read as a call and a throwing getter
// read as one that cannot raise. Lowering resolves the same access by receiver
// type and key, and called it with no raising copy: on #843's gate the program
// printed 0, 10, 20 and then ended with "uncaught RangeError: big" where node
// answers -1, and the control agreed. Main is wrong on all three exports
// here, and on the control's `override` too: a throwing override read through a
// quiet base is #843's other fix. Found by the round-3 review of #843.
//
// The one-difference control is
// programs/a-throwing-getter-under-a-computed-key-inside-a-try-control: the
// keys are the names `v` and `w`.

const kV = Symbol("v");
const kW = Symbol("w");

class Box {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  get [kV](): number {
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
  get [kV](): number {
    return this.n + 1;
  }
}

class Sub extends Base {
  override get [kV](): number {
    if (this.n > 2) {
      throw new RangeError("big");
    }
    return this.n * 10;
  }
}

class Sink {
  s = 0;
  set [kW](x: number) {
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
  return r[kV];
}

function readBase(r: Base): number {
  return r[kV];
}

function write(r: Sink, x: number): number {
  r[kW] = x;
  return r.s;
}

// A plain getter under a computed key, read inside a `try` one call below.
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

// A setter under a computed key.
export function setter(n: number): number {
  const r = new Sink();
  return attempt(() => write(r, n & 7));
}
