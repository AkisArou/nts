// Typechecks fine; the HIR lowering does not handle it yet. It must be REFUSED,
// not silently skipped: a lowering that emits nothing for a statement it did not
// understand produces a program that runs and is wrong.
//
// Keep this file to constructs the lowering genuinely does not accept. When one
// of them lands, replace it here rather than deleting the fixture.

export function supported(a: number, b: number): number {
  return a + b;
}

export function hasForLoop(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i = i + 1) {
    total = total + i;
  }
  return total;
}

export function hasSwitch(n: number): number {
  switch (n) {
    case 1:
      return 10;
    default:
      return 0;
  }
}
