// expect: `this` outside a method
//
// What a call's `this` cannot reach yet (`docs/function-receivers.md`).
//
// A call through a function value passes its `this` (step 1), and a `function`
// expression that reads its own `this` takes it (step 2):
// `examples/a-function-that-reads-its-own-this`. Until then this fixture held
// three refusals that made dropping a receiver at `.call` sound, and the first
// of them is gone. Two shapes still read a `this` no call hands them, and both
// are refused rather than given the wrong object:
//
//     function plain(this: H) { … }   a `function` *declaration* reading
//                                     `this`: `this` outside a method
//     const m = c.get; m()            a method taken as a value whose body
//                                     reads `this`, which a read does not bind
//
// Each is the next piece of the same work. A declaration used as a value is the
// closure step 2 made for an expression. A method value is an unbound closure
// taking its `this` like any other, where today a method value is bound to the
// object it was read from, which is only right while the body cannot tell.
// When either lands this fixture reports FIXED, and that case becomes part of
// the example.

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

/** Refused: a function *declaration* reading `this`. */
export function declarationReadsThis(n: number): number {
  return plain.call({ v: n });
}

function plain(this: H): number {
  return this.v;
}

/** Refused: a method taken as a value, whose body reads `this`. */
export function methodAsAValue(n: number): number {
  const c = new C(n);
  const m = c.get;
  return m();
}
