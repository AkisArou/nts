// A derived class whose constructor calls `super()` nowhere.
//
// A derived constructor's `this` is unbound until `super()` returns. With no
// `super()` written, it never is: a read of `this` throws a `ReferenceError`, and
// so does leaving the constructor without returning an object. This compiler
// allocates the instance before the constructor runs, so `this` was simply the
// object and `new NoSuper()` answered an instance where node throws. Now it is
// the same fact as `extends null`'s (`examples/a-constructor-extending-null`),
// read by the same predicate: a construction whose `this` nothing binds.
//
// TypeScript refuses the shape in a `.ts` file (TS2377, hence the
// `@ts-expect-error`s) and not in a `.js` one, which is where test262 writes it:
// `class CustomError extends Error { constructor() {} }`.
//
// What each export pins:
//
//   noSuper     falling off the end of the constructor throws a
//               `ReferenceError`, after the body ran
//   readsThis   a read of `this` throws, before the rest of the body
//   bareReturn  `return;` is leaving without an object, the same throw
//   errorBase   a provided base class, `extends Error`
//   implement   `implements` is not a base: `this` is bound on entry
//   callsSuper  the control: a constructor that calls `super()`
//
// Transcribed from node (v24), each export called with 3:
//
//     noSuper "ReferenceError,ran,3"      readsThis "ReferenceError,before,3"
//     bareReturn "ReferenceError,3"       errorBase "ReferenceError,3"
//     implement "made,3"                  callsSuper "made,3"
let log = "";

// What the constructors logged since the last call, emptied: a string a global
// still held after the call would read as a leak to the `--rc` lane.
function taken(): string {
  const logged = log;
  log = "";
  return logged;
}

class Base {
  tag = "base";
}

class NoSuper extends Base {
  // @ts-expect-error TS2377
  constructor() {
    log = "ran";
  }
}

class ReadsThis extends Base {
  // @ts-expect-error TS2377
  constructor() {
    log = "before";
    // @ts-expect-error TS17009
    this.tag = "read";
    log = "after";
  }
}

class BareReturn extends Base {
  // @ts-expect-error TS2377
  constructor() {
    return;
  }
}

class CustomError extends Error {
  // @ts-expect-error TS2377
  constructor() {}
}

interface Tagged {
  tag: string;
}

class Implementor implements Tagged {
  tag = "made";
  constructor() {}
}

class CallsSuper extends Base {
  constructor() {
    super();
    this.tag = "made";
  }
}

function named(e: unknown): string {
  return e instanceof ReferenceError ? "ReferenceError" : "other";
}

export function noSuper(n: number): string {
  try {
    new NoSuper();
    return "made," + taken() + "," + n;
  } catch (e) {
    return named(e) + "," + taken() + "," + n;
  }
}

export function readsThis(n: number): string {
  try {
    new ReadsThis();
    return "made," + taken() + "," + n;
  } catch (e) {
    return named(e) + "," + taken() + "," + n;
  }
}

export function bareReturn(n: number): string {
  try {
    new BareReturn();
    return "made," + n;
  } catch (e) {
    return named(e) + "," + n;
  }
}

export function errorBase(n: number): string {
  try {
    new CustomError();
    return "made," + n;
  } catch (e) {
    return named(e) + "," + n;
  }
}

export function implement(n: number): string {
  return new Implementor().tag + "," + n;
}

export function callsSuper(n: number): string {
  return new CallsSuper().tag + "," + n;
}
