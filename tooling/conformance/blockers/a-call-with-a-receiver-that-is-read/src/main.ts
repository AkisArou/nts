// expect: a method used as a value whose body reads `this`
//
// What a call's `this` cannot reach yet (`docs/function-receivers.md`).
//
// A call through a function value passes its `this` (step 1); a `function`
// expression that reads its own `this` takes it (step 2,
// `examples/a-function-that-reads-its-own-this`); so does a `function`
// declaration (`examples/a-function-declaration-that-reads-its-own-this`), which
// was this fixture's first case. One shape still reads a `this` no call hands
// it, and it is refused rather than given the wrong object:
//
//     const m = c.get; m()            a method taken as a value whose body
//                                     reads `this`, which a read does not bind
//
// A method value is an unbound closure taking its `this` like any other, where
// today a method value is bound to the object it was read from, which is only
// right while the body cannot tell: in JavaScript `m()` calls `get` with
// `undefined`, and `this.v` throws. When this lands the fixture reports FIXED,
// and the case becomes part of an example.

class C {
  v: number;
  constructor(n: number) {
    this.v = n;
  }
  get(): number {
    return this.v;
  }
}

/** Refused: a method taken as a value, whose body reads `this`. */
export function methodAsAValue(n: number): number {
  const c = new C(n);
  const m = c.get;
  return m();
}
