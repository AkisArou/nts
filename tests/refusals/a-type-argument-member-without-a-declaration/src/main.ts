// expect: this call was not resolved to a target
// A mapped member carries no concrete property declaration to resolve.
class Box {
  m(): number { return 1; }
}
type Mapped = { [K in "m"]: () => number };
function call<T extends Box>(r: T): number { return r.m(); }
export function probe(n: number): number {
  const r: Mapped = { m: () => n * 10 };
  return call(r);
}
