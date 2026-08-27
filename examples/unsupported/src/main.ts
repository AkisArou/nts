// Typechecks fine; the HIR lowering does not handle it yet. It must be REFUSED,
// not silently skipped: a lowering that emits nothing for a statement it did not
// understand produces a program that runs and is wrong.
//
// Keep this file to constructs the lowering genuinely does not accept. When one
// of them lands, move it out rather than deleting the fixture. `while` went
// this way, then `for`, then the ternary, then `switch` and `do` -- each time,
// the fixture starting to work was what the failing test was telling us.

export function supported(a: number, b: number): number {
  return a + b;
}

// A label is refused rather than ignored. `break outer` and `break` leave
// different loops, so lowering one as the other would compile and be wrong --
// which is the failure this fixture exists to prevent.
export function hasLabelledBreak(n: number): number {
  let total = 0;
  outer: for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (j > i) {
        break outer;
      }
      total += 1;
    }
  }
  return total;
}

export function hasForIn(xs: number[]): number {
  let count = 0;
  for (const _key in xs) {
    count += 1;
  }
  return count;
}

export function hasTemplateLiteral(n: number): string {
  return `value ${n}`;
}
