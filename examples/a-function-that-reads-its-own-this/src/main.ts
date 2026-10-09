// A `function` expression that reads its own `this` is given the call's
// (`docs/function-receivers.md`, step 2): `o` for `o.f()`, `r` for `f.call(r)`
// and `f.apply(r, list)`, and `undefined` for a plain `f()`.
//
// Until step 2 such a function was refused, and `f.call(r)` dropped `r`, which
// was sound only because nothing could read it. Each case below is one way a
// call names its `this`, against node. A call where the closure is known names
// its body directly, with the `this`; a call through a value typed by the
// signature goes through the uniform entry, which passes it on. Both have to
// agree, so most cases take both routes.

class Counter {
  count: number;
  constructor(start: number) {
    this.count = start;
  }
}

const bump = function (this: Counter, by: number): number {
  this.count += by;
  return this.count;
};

type Bump = (this: Counter, by: number) => number;

/** `f.call(c, x)`, where the closure is known: the `this` written. */
export function callKnown(n: number): number {
  const c = new Counter(n & 7);
  bump.call(c, 2);
  return bump.call(c, 3);
}

/** `f.apply(c, [x])`. */
export function applyKnown(n: number): number {
  const c = new Counter(n & 7);
  return bump.apply(c, [4]);
}

/** Through a parameter typed by the signature, with two different functions. */
function callThrough(f: Bump, c: Counter, by: number): number {
  return f.call(c, by);
}

export function callThroughASignature(n: number): number {
  const c = new Counter(n & 7);
  const scaled = function (this: Counter, by: number): number {
    return this.count * by;
  };
  return callThrough(bump, c, 5) * 100 + callThrough(scaled, c, 2);
}

class Holder {
  count: number;
  read: (this: Holder, plus: number) => number;
  constructor(count: number) {
    this.count = count;
    this.read = function (this: Holder, plus: number): number {
      return this.count + plus;
    };
  }
}

/**
 * `h.read(x)`, a function stored in a field: `this` is the object it was read
 * from, and it follows the call, not the function -- moved to another object,
 * it reads that one.
 */
export function throughAField(n: number): number {
  const h = new Holder(n & 7);
  const other = new Holder(100);
  other.read = h.read;
  return h.read(1) * 1000 + other.read(2);
}

/** A plain call passes `undefined`. */
export function plainCall(n: number): string {
  const f = function (this: unknown): string {
    return typeof this;
  };
  return f() + String(n & 0);
}

/**
 * `this` passed on and never read, React's `Children.forEach` shape: the
 * function made inside forwards the `this` it was called with to the one it
 * was given.
 */
function forEachWith(
  visit: (this: unknown, by: number) => string,
  context: unknown,
  by: number,
): string {
  const outer = function (this: unknown, k: number): string {
    return visit.call(this, k);
  };
  return outer.call(context, by);
}

export function forwarded(n: number): string {
  const visit = function (this: unknown, by: number): string {
    return (this === undefined ? "none" : "some") + String(by);
  };
  return forEachWith(visit, new Counter(1), n & 3) + "/" + forEachWith(visit, undefined, 1);
}

/** An arrow inside reads the function's `this`, not the one around it. */
export function arrowInside(n: number): number {
  const f = function (this: Counter): number {
    const twice = (): number => this.count * 2;
    return twice();
  };
  return f.call(new Counter(n & 7));
}

/** A named function expression, recursing through its own name. */
export function namedAndRecursive(n: number): number {
  const sum = function walk(this: Counter, k: number): number {
    return k <= 0 ? this.count : walk.call(this, k - 1) + k;
  };
  return sum.call(new Counter(10), n & 7);
}

interface Valued {
  v: number;
}

/**
 * A `this` typed by an interface, given an object literal, and given an
 * instance of a class that declares the interface's members without naming it.
 */
export function anInterfaceThis(n: number): number {
  const read = function (this: Valued, k: number): number {
    return this.v * k;
  };
  class Box {
    v: number;
    constructor(v: number) {
      this.v = v;
    }
  }
  return read.call({ v: n & 7 }, 1) * 100 + read.call(new Box(n & 3), 3);
}

/**
 * Through a parameter given only one function: the call is made direct by a
 * clone of `callOnce` for that closure, which has to name the body that takes
 * the `this`, not the `#call` that passes `undefined`.
 */
function callOnce(f: Bump, c: Counter, by: number): number {
  return f.call(c, by) + f.call(c, 1);
}

export function throughAParameterGivenOne(n: number): number {
  const twice = function (this: Counter, by: number): number {
    this.count += by * 2;
    return this.count;
  };
  return callOnce(twice, new Counter(n & 7), 2);
}

class Optional {
  count: number;
  read?: (this: Optional, plus: number) => number;
  constructor(count: number, reads: boolean) {
    this.count = count;
    if (reads) {
      this.read = function (this: Optional, plus: number): number {
        return this.count + plus;
      };
    }
  }
}

/**
 * `o.f?.(x)` passes `o` as `o.f(x)` does, from the object the read of `o.f`
 * was made on -- with the function there, without it, and through an
 * `o?.` that may itself be absent.
 */
export function throughAnOptionalCall(n: number): number {
  const with_ = new Optional(n & 7, true);
  const without = new Optional(1, false);
  const maybe: Optional | null = (n & 1) === 0 ? with_ : null;
  return (with_.read?.(2) ?? -1) * 100 + (without.read?.(2) ?? -1) * 10 + (maybe?.read?.(1) ?? -2);
}
