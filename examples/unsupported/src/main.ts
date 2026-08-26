// Typechecks fine; the HIR lowering does not handle it yet. It must be REFUSED,
// not silently skipped: a lowering that emits nothing for a statement it did not
// understand produces a program that runs and is wrong.

export function supported(a: number, b: number): number {
  return a + b;
}

export function hasLoop(n: number): number {
  while (n > 0) {
    n = n - 1;
  }
  return n;
}
