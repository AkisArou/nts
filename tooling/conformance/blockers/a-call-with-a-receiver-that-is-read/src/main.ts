// expect: a `function` expression that uses its own `this`
//
// `f.call(receiver, ...rest)` lowers by **dropping** the receiver, and
// `examples/a-call-with-an-explicit-receiver` is the guard that it agrees with
// node. That is sound rather than convenient, and this file is why.
//
// Dropping a receiver is only a substitution if nothing can observe one. Three
// separate refusals make that true here, and each was argued on its own terms
// long before `.call` existed:
//
//     function () { this.x }          a `function` expression that uses its
//                                     own `this`, which an arrow function does
//                                     not have
//     function f(this: H) { … }       `this` outside a method
//     const m = c.get                 `get`, declared by `C` with a type that
//                                     has no representation (a function type)
//
// So: a `function` whose body reads `this` does not lower; a declaration that
// does is refused the same way; a *method*, whose `this` is a real parameter
// and would therefore be observable, cannot be taken as a value at all. An
// arrow has no `this` of its own by the language's rule -- it captures the
// enclosing one where it is written, which a call cannot rebind.
//
// **The set of function values that could observe a receiver is empty**, and
// that is what the lowering relies on. Not "listeners tend not to use `this`",
// which would be a guess about a program rather than a fact about this
// compiler.
//
// # Why this is a blocker and not an example
//
// All three cases below refuse, so none of them can be differenced against
// node. What this fixture asserts is that they still do. **Any one of them
// becoming implemented is the day the lowering is wrong**, silently: a body
// that reads `this` would compile, `.call` would hand it nothing, and it would
// read whatever the closure captured instead of the receiver the caller named.
//
// That is the whole reason to write it down. The three refusals are load-bearing
// for a fourth thing that does not mention them, and a reader implementing
// `this` in a function body has no reason to look at `lower_call_with_receiver`
// unless something points there.
//
// # What it would take to lift them
//
// A receiver parameter in the closure calling convention, which was measured
// before being rejected: one extra argument on an indirect closure call costs
// ~0.13 ns, about 0.4 cycles, and ~9% on a loop whose whole body is the
// dispatch. Not free, and not necessary while the set above is empty. When it
// stops being empty the parameter can be added per *signature type* rather than
// globally, so closures of types never used with `.call` keep paying nothing.

interface H {
  v: number;
}

class C {
  v: number;
  constructor(n: number) {
    this.v = n;
  }
  get(): number {
    return this.v;
  }
}

/** Refused: a `function` expression whose body reads its own `this`. */
export function readsOwnThis(n: number): number {
  const f = function (this: H, k: number): number {
    return this.v + k;
  };
  return f.call({ v: n }, 1);
}

/** Refused: a function *declaration* reading `this`. */
export function declarationReadsThis(n: number): number {
  return plain.call({ v: n });
}

function plain(this: H): number {
  return this.v;
}

/** Refused: a method taken as a value, whose `this` is a real parameter. */
export function methodAsAValue(n: number): number {
  const c = new C(n);
  const m = c.get;
  return m();
}
