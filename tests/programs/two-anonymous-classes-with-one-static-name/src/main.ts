// Two anonymous classes, each with a static named `v`, and the names have to
// stay apart all the way down to the emitted symbol.
//
// A `static` on a class expression refused until 2026-09-20 on the grounds that
// "two anonymous classes assigned to two variables would need two storages named
// from a side neither of them has". They do not: `instance_type_of` gives each
// class *expression* its own `TypeId`, so the two globals are named for two
// stand-ins and come out as `Type22___v` and `Type23___v`. This file is the
// arm that would fail if they ever merged -- `A.v` and `B.v` hold different
// values and both are read after both are written, so a single shared storage
// answers 22 or 33 and never 23.
//
// Written because the fixture that closed the refusal
// (`blockers/a-static-on-an-anonymous-class`) constant-folds its static and
// therefore never materialises a global at all. `bump` exists for the same
// reason: a static that is only read folds to a `const` and the name is never
// emitted, so each class writes its own before either is read.

const A = class {
  static v = 1;

  static bump(): number {
    A.v = A.v + 1;
    return A.v;
  }
};

const B = class {
  static v = 10;

  static bump(): number {
    B.v = B.v + 10;
    return B.v;
  }
};

export function both(n: number): number {
  A.v = 1;
  B.v = 10;
  const a = A.bump();
  const b = B.bump();
  return a * 100 + b + n;
}
