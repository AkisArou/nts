// Typechecks fine; the HIR lowering does not handle it yet. It must be REFUSED,
// not silently skipped: a lowering that emits nothing for a statement it did not
// understand produces a program that runs and is wrong.
//
// Keep this file to constructs the lowering genuinely does not accept. When one
// of them lands, replace it here rather than deleting the fixture. `while` went
// this way, then `for` -- each time, the fixture starting to work was what the
// failing test was telling us.

export function supported(a: number, b: number): number {
  return a + b;
}

export function hasSwitch(n: number): number {
  switch (n) {
    case 1:
      return 10;
    default:
      return 0;
  }
}

export function hasTernary(n: number): number {
  return n > 0 ? 1 : -1;
}

export function hasDoWhile(n: number): number {
  let i = 0;
  do {
    i = i + 1;
  } while (i < n);
  return i;
}
