// Typechecks fine, and a copy cannot be made for it. Every export here must be
// REFUSED: a generic class is lowered once per *instantiation*, so the shapes
// that have no instantiation to copy from have nothing to lower.
//
// When one of them lands, move it into `examples/generic-classes` rather than
// deleting it -- the fixture starting to compile is what the test is for.
// Two of the original three moved on 2026-09-22, when `hir::instantiate`
// began materialising the instantiations a generic body implies: a generic
// base at the class's own parameter (`Boxed<T> extends Container<T>`) and a
// class instantiating itself at swapped parameters (`Entry<V, K>` inside
// `Entry<K, V>`) are both `examples/generic-classes` now.

// A generic **method** on a generic class. `map` has a type parameter of its
// own, so one copy of the class is not one copy of the method: `U` is decided
// per call site, and the class copy is decided per `new`.
class Cell<T> {
  constructor(public v: T) {}
  map<U>(f: (t: T) => U): U {
    return f(this.v);
  }
}

export function genericMethod(seed: number): number {
  return new Cell<number>(seed).map<number>((n) => n * 2);
}
