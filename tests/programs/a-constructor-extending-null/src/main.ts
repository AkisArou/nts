// `class C extends null`: a derived class whose `super()` can never succeed, so
// its constructor's `this` is never bound.
//
// A derived constructor's `this` is in its temporal dead zone until `super()`
// returns, and `null` is not a constructor -- so in an `extends null` class every
// read of `this` is a `ReferenceError`, and so is leaving the constructor
// without returning an object: falling off its end, or a bare `return`. This
// compiler allocates the instance before any constructor runs, so `this` was
// simply the object, and test262 answered "nothing was thrown" (four recorded
// cases, three of them staging).
//
// TypeScript rejects a `this` written before `super()` in an ordinary derived
// constructor (TS17009), and does not reject one here, where there is no
// `super()` to have called -- which is why the fix reads the syntax rather than
// the order things run in.
//
// `return undefined` is the same return and is handled the same way, but
// TypeScript rejects it in a constructor (TS2409); test262's plain JavaScript
// (`derivedConstructorTDZReturnUndefined`) is where it is reached.
//
// **Control:** `bound`, the same reads in a constructor whose base is a class,
// after `super()` -- which must not throw.
//
// Transcribed from node (v24): every export answers "ReferenceError" except
// `bound`, which answers "none" -- with the argument appended.

class FromNull extends null {
  constructor() {
    this;
    throw new Error("not reached");
  }
}

class ThroughAnArrow extends null {
  constructor() {
    const read = () => this;
    read();
    throw new Error("not reached");
  }
}

class OffTheEnd extends null {
  constructor() {}
}

class BareReturn extends null {
  constructor() {
    return;
  }
}

class Base {
  x = 1;
}

class Bound extends Base {
  constructor() {
    super();
    const read = () => this.x;
    this.x = read() + 1;
  }
}

// Each construction is made directly inside the `try` rather than through an
// arrow: an arrow whose body can only throw is a separate lowering gap -- its
// raising copy keeps a continuation that uses the `never` value, which every
// backend refuses -- and this example is about the binding, not about closures.
function construct(which: number): string {
  try {
    if (which === 0) {
      new FromNull();
    } else if (which === 1) {
      new ThroughAnArrow();
    } else if (which === 2) {
      new OffTheEnd();
    } else if (which === 3) {
      new BareReturn();
    } else {
      new Bound();
    }
    return "none";
  } catch (e) {
    return e instanceof ReferenceError ? "ReferenceError" : e instanceof Error ? "Error: " + e.message : "other";
  }
}

export function explicitThis(n: number): string {
  return construct(0) + n;
}

export function arrowThis(n: number): string {
  return construct(1) + n;
}

export function offTheEnd(n: number): string {
  return construct(2) + n;
}

export function bareReturn(n: number): string {
  return construct(3) + n;
}

export function bound(n: number): string {
  return construct(4) + n;
}
