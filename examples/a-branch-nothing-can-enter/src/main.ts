// A branch nothing can enter is not lowered.
//
// `if (isDevelopment) { console.error(...) }` is React's development-warning
// idiom, and with `isDevelopment` a `const` bound to `false` it refused **86
// functions** in the React lane's runtime -- every one for a construct on a path
// a production build cannot reach. Folding it is also the only way that code
// leaves the binary.
//
// The condition's *type* is the whole test. `const x = false` has type `false`
// in TypeScript, so the checker has already folded and the lowering reads the
// answer. See `statically_decided` for why the widened spelling is left alone.

import { isDevelopment, isDevelopmentWide } from "./flags.ts";

const localFalse = false;

/** A literal condition. Nothing in the branch is lowered. */
export function literalIf(n: number): number {
  if (false) {
    // `console.error` has no representation here, and that is the point: this
    // used to refuse the whole function for a line that cannot run.
    console.error("unreachable");
  }
  return n;
}

/** A local `const`, which the checker types `false`. */
export function localConst(n: number): number {
  if (localFalse) {
    console.error("unreachable");
  }
  return n;
}

/** The same across a module boundary, which is where a build flag lives. */
export function importedLiteral(n: number): number {
  if (isDevelopment) {
    console.error("unreachable");
  }
  return n;
}

/**
 * **Control: the fold must be observable and not merely quiet.** If the dead
 * arm were lowered and taken, this would answer 1; if the live arm were dropped,
 * 0. It answers `n`.
 */
export function theLiveArmStillRuns(n: number): number {
  let total = 0;
  if (false) {
    total = 1;
  } else {
    total = n;
  }
  return total;
}

/** The same the other way: a `true` condition folds the *else* away. */
export function trueFoldsTheElse(n: number): number {
  if (true) {
    return n;
  }
  console.error("unreachable");
  return 0;
}

/**
 * **Control: a condition the checker did not decide still lowers both arms.**
 * `isDevelopmentWide` is annotated `boolean`, so the type is `boolean` and this
 * is not foldable -- and a fold that guessed from the initialiser would silently
 * drop a branch whose author widened the type in order to change the value.
 * Written so the branch's body is representable, since it really is lowered.
 */
export function notDecided(n: number): number {
  let total = n;
  if (isDevelopmentWide) {
    total = n + 1;
  }
  return total;
}
