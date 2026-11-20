// run: check
//
// A generic function calling another with its own type parameter, where the
// argument matches the bound only structurally. `outer<T extends Box>` passes
// its `r: T` to `call<T extends Box>`; in `outer`'s copy for `T = Other` that
// call names `call`'s copy at the bound, `call<Box>`, rather than at `Other`.
// So an `Other` arrives where the copy laid out a `Box`, and `Box#m` runs where
// node runs `Other#m`: the program answers 2 where node answers (n & 7) * 10 + 1,
// a silent wrong answer on 29 of 29 cases on C and LLVM, while the JVM backend
// declines the program.
//
// Found by #888's worker while writing that issue's arms: on main's pin
// c6866e778685 `nts hir` shows `outer<obj6>` calling `call<obj1>` with an
// `obj#6`. It is not a throw: the same shape with `throw` was dropped from
// #888's fixture because the wrong copy is named before any raise.
//
// The control is programs/a-generic-calling-a-generic-pins-the-bound-for-a-structural-argument-control,
// and it differs in one thing: `Other` extends `Box` and overrides `m`, so the
// bound's copy dispatches to `Other#m` through the slot and agrees.

class Box {
  m(): number {
    return 1;
  }
}

class Other {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  m(): number {
    return this.n * 10;
  }
}

function call<T extends Box>(r: T): number {
  return r.m();
}

function outer<T extends Box>(r: T): number {
  return call(r) + 1;
}

export function probe(n: number): number {
  return outer(new Other(n & 7));
}
