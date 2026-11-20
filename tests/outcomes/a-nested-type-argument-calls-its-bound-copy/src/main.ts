// run: check
// Pre-existing lowering defect #896, found in #888 review.
// outer<U extends Box> forwards its U to call<T extends Box>. Lowering the
// outer<Other> copy calls call<Box>, so Box#m runs even without any throw.
// The control in programs/a-nested-type-argument-calls-its-bound-copy-control
// removes only the enclosing generic call, and calls call<Other> directly.
class Box {
  m(): number { return 1; }
}
class Other {
  readonly n: number;
  constructor(n: number) { this.n = n; }
  m(): number { return this.n * 10; }
}
function call<T extends Box>(r: T): number { return r.m(); }
function outer<U extends Box>(u: U): number { return call(u); }
export function probe(n: number): number { return outer(new Other(n & 7)); }
