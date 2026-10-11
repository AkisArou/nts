// **A `Base` stored through TypeScript's array covariance is called as a
// `Sub`.** `Sub[]` is assignable to `Base[]`, so `addBase(subs)` may push a
// `new Base()` into an array the program still reads as `Sub[]`. Every element
// read through `subs` is typed `Sub`, and `s.v()` on it dispatches `Sub#v`
// without looking at the object: C and LLVM answer 2 for the `Base`, where
// node answers 1 -- `[Sub, Base]` reads as `22`, not `21`.
//
// The JVM declines the program by name (NTS4001 "storing a `Base` where a `Sub`
// is declared") since a7de5cdec's container guard, and before it the store
// would have been an `ArrayStoreException` or a `ClassCastException`. The
// static claim is the same everywhere; only the JVM checks it.
//
// The control is the same program pushing a `Sub`, which agrees.
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
