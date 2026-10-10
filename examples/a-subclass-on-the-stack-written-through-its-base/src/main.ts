// A write through a base class, read back through the subclass, on an object
// in the function's own frame.
//
// `b.level = 200` through a `Base` where `b` is a `Derived` the function made,
// then `d.level` through the `Derived`: node answers 200, and C answered 0,
// the constructor's store, until 2026-10-10. LLVM agreed.
//
// A subclass's struct repeats its base's fields rather than containing the
// base's struct, so `NtsObj_Derived` and `NtsObj_Base` were unrelated types to
// C, and an access through one was assumed never to touch an object accessed
// through the other -- clang's type-based alias analysis, which C's aliasing
// rule (C11 6.5p7) licenses. Every object struct is now `may_alias`
// (`NTS_OBJECT_STRUCT` in `runtime/c/nts_runtime.h`).
//
// It needs the object's own type in view, which is why the objects are frame
// objects here: neither escapes, so both are declared in this function's frame
// as what they are. The join erases them, so no copy of the write knows which
// class it has. An interface is the same shape
// (`tooling/conformance/outcomes/a-field-through-an-interface-its-classes-order-differently`,
// the `Red` half). Found checking Part 0 of `docs/interfaces-by-shape.md`.
//
// The control is `Other`: the same write through the same `Base`, read back
// through `Base`.
class Base {
  level: number = 0;
}

class Derived extends Base {
  tag: number = 1;
}

class Other extends Base {
  extra: number = 2;
}

export function throughTheBase(aDerived: boolean, level: number): string {
  const d = new Derived();
  const o = new Other();
  const b: Base = aDerived ? d : o;
  b.level = level;
  return aDerived ? `${d.level},${d.tag}` : `${b.level},${o.extra}`;
}
