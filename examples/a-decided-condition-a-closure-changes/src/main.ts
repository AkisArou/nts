// TypeScript's control-flow analysis does not see an assignment made **inside a
// closure**, so a `let` initialised to `false` and set by a callback still has the
// literal type `false` where the enclosing function reads it. Folding a branch on
// that answer takes the wrong arm, and the program compiles and lies.
//
// `examples/captured-by-reference` has held this shape all along and did not catch
// it, because its own `calledOnce` reads the flag through a *conditional* and only
// the `if` form was folded. It disagreed on 28 cases the moment the conditional
// folded too, which is how this was found -- so the arms here are all three forms
// of the same read, driven through a closure that assigns.

function twice(f: () => void): void {
  f();
  f();
}

/** The `if` form, which folded and was wrong from the day it landed. */
export function viaIf(n: number): number {
  let called = false;
  let hits = 0;
  const guard = (): void => {
    if (called) return;
    called = true;
    hits = hits + n;
  };
  twice(guard);
  if (called) {
    return hits + 1000;
  }
  return hits;
}

/** The conditional form. */
export function viaConditional(n: number): number {
  let called = false;
  let hits = 0;
  const guard = (): void => {
    if (called) return;
    called = true;
    hits = hits + n;
  };
  twice(guard);
  return hits + (called ? 1000 : 0);
}

/** The operator form. */
export function viaAnd(n: number): number {
  let called = false;
  let hits = 0;
  const guard = (): void => {
    if (called) return;
    called = true;
    hits = hits + n;
  };
  twice(guard);
  return hits + (called && n > 0 ? 1000 : 0);
}

/** A `var`, which hoists and is writable for the same reason. */
export function viaVar(n: number): number {
  var seen = false;
  const mark = (): void => {
    seen = true;
  };
  twice(mark);
  return seen ? n + 1 : n;
}

/**
 * **The assignment need not be in a closure.** A plain later assignment is
 * something the checker *does* see, so this arm is correct either way -- it is
 * here because a guard keyed on "assigned inside a closure" rather than on "the
 * binding is writable" would be narrower than the language and would need this
 * case to prove it.
 */
export function assignedInPlace(n: number): number {
  let flag = false;
  if (n > 0) {
    flag = true;
  }
  return flag ? n + 1 : n;
}

/**
 * **Control: a `const` still folds.** This is what the guard must not cost --
 * React's development guard and `Writable#get writable`'s `!!w` are both this
 * shape, and a guard that refused them would take back the reach `7c3fc82f9`
 * bought.
 */
const never = false;

export function constantStillFolds(n: number): number {
  if (never) {
    return Object.getOwnPropertyNames({ a: 1 }).length;
  }
  return n + 1;
}

/**
 * The conditional form of the same control. No refusing construct in the dead arm
 * here, because a conditional's dead arm is still lowered on this commit -- only
 * the `if` form folds. It checks the answer rather than the fold.
 */
export function constantConditional(n: number): number {
  return never ? n + 100 : n + 2;
}

/**
 * **A decided `const` operand beside a mutable one the decision never reads.**
 * `false && anything` is `false` without evaluating the right operand, so whether
 * that operand reads a mutable binding cannot matter -- and a guard applied to the
 * whole condition declined this, leaving the dead branch lowered and refusing.
 * `isDevelopment && !hasLoggedError` is the shape, and the React lane found seven
 * of the ten roots the blunt guard cost them were exactly it.
 *
 * The dead branch holds a construct this compiler refuses by name, so what is
 * tested is the fold rather than the answer.
 */
let logged = false;

export function decidedBesideMutable(n: number): number {
  if (never && !logged) {
    return Object.getOwnPropertyNames({ a: 1 }).length;
  }
  return n + 3;
}

/** The mirror for `||`: `true || x` is `true` without reading `x`. */
const always = true;

export function orDecidedBesideMutable(n: number): number {
  if (always || logged) {
    return n + 4;
  }
  return Object.getOwnPropertyNames({ a: 1 }).length;
}

/** **Control.** The mutable operand decides it alone, so the fold must decline. */
export function mutableDecidesAlone(n: number): number {
  return logged ? n + 100 : n + 5;
}

export function mark(): void {
  logged = true;
}
