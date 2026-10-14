// An object literal's generator method.
//
// **A guard rather than a measurement, and that is a correction.** `eb008d298`
// carried this shape as an arm on the strength of "`collect_closures` takes it as a
// closure for the same reason an arrow is one -- so it reached the same path". It
// does not: on a compiler built before generator function expressions lowered, this
// program **compiles and agrees with node on all 58 cases**. Whatever route an
// object literal's generator method takes, it is not the one that refused a
// `function*` expression.
//
// Kept because a shape that works is worth a guard and because the claim is worth
// correcting where someone would otherwise re-derive it -- not because it measures
// this change. `run-a-new-fixture-against-the-old-compiler` is what asked the
// question: if it passes on both, it measured nothing.
//
// Its own program, like the others here: `Hierarchy::closure_slot` is one slot for
// the whole program, and two generator closures return two frame classes on it,
// which the JVM refuses by name.

/**
 * An object literal's generator method, which `collect_closures` takes as a
 * closure for the same reason an arrow is one -- so it reached the same path.
 */
const held = {
  *pair(): Generator<number> {
    yield 3;
    yield 4;
  },
};

export function viaLiteralMethod(n: number): number {
  let total = 0;
  for (const value of held.pair()) {
    total += value;
  }
  return total + n;
}

/** The control: the same generator as a declaration, which compiled all along. */
function* declared(): Generator<number> {
  yield 1;
  yield 2;
}

export function viaDeclaration(n: number): number {
  let total = 0;
  for (const value of declared()) {
    total += value;
  }
  return total + n;
}
