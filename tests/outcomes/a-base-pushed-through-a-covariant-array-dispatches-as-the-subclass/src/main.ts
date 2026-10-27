// **A `Base` stored through TypeScript's array covariance is called as a
// `Sub`.** `Sub[]` is assignable to `Base[]`, so `addBase(subs)` may push a
// `new Base()` into an array the program still reads as `Sub[]`. Every element
// read through `subs` is typed `Sub`, and `s.v()` on it dispatches `Sub#v`
// without looking at the object: C and LLVM answer 2 for the `Base`, where
// node answers 1 -- `[Sub, Base]` reads as `22`, not `21`.
//
// Per backend, measured 2026-10-27 on e8699405c (and identically on the
// previous pin, 5daf04bf): C here and LLVM in the `-llvm` twin answer the
// wrong 22. The JVM does **not** decline this shape by name: the store
// crosses a function boundary, so a7de5cdec's container guard never sees
// the `Sub` storage, and the program aborts with a `ClassCastException`
// at the element read (`-jvm` twin). The guard does fire on a local alias
// in one function (`a-base-pushed-through-a-local-covariant-alias-on-the-jvm`).
// Wasm declines the widening by name (NTS5001, `-wasm` twin). So the static
// claim is checked by name on one backend, enforced by a Java exception on
// another, and not at all on C and LLVM.
//
// The control below pushes a `Sub` and agrees; the not-widened control is
// `a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass-control`.
// Where `Sub` is wider than `Base` the widening itself is refused in
// lowering on all four (`...-with-a-wider-subclass`).
//
// Found on 2026-10-11 by the JVM lane, probing the guard for over-refusal.

class Base {
  v(): number {
    return 1;
  }
}

class Sub extends Base {
  v(): number {
    return 2;
  }
}

function addBase(xs: Base[]): void {
  xs.push(new Base());
}

function addSub(xs: Base[]): void {
  xs.push(new Sub());
}

function read(subs: Sub[]): number {
  let t = 0;
  for (const s of subs) t = t * 10 + s.v();
  return t;
}

function throughBase(): number {
  const subs: Sub[] = [new Sub()];
  addBase(subs);
  return read(subs);
}

function throughSub(): number {
  const subs: Sub[] = [new Sub()];
  addSub(subs);
  return read(subs);
}

observe("a Base pushed", String(throughBase()));
observe("a Sub pushed", String(throughSub()));
done();
