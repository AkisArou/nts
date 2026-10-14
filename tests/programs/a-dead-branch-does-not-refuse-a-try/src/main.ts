// A `try` around a call whose only unreachable path is what made it refuse.
//
// `if (isDevelopment)` where `isDevelopment` is `export const isDevelopment = false`
// -- a literal-`false` type -- is how every port of a `__DEV__` codebase is written.
// `lower_if` has pruned such a branch since `folded_branch`, so the code was never
// emitted; what walked into it anyway were the two analyses that decide whether a
// `try` can be given a handler edge. So a program was refused for a call it does not
// make.
//
// The React lane measured it: after a `try`'s refusal learned to name its leaf,
// **nine** `try`s in `ReactFiberCommitEffects.ts` plus one in `ReactFiberWorkLoop.ts`
// named `runWithFiberInDEV` -- a variadic generic reached only from inside
// `if (isDevelopment)`, which production never calls. A generic cannot have a raising
// copy (its suffix already names its instantiation), so every one of those `try`s was
// declined for a dead call.
//
// `children_that_run` is the one place that answers "which children of this node can
// run", read by both the throw walk and `calls_in_the_body_of`, and it asks
// `statically_decided` -- the same primitive `folded_branch` reads, so the analyses and
// the lowering cannot disagree about which half of an `if` exists.

export const isDevelopment = false;

/** A generic that throws, so no raising copy can be made of it. */
function inDev<T>(value: T): T {
  if (value !== undefined) {
    throw new Error("dev");
  }
  return value;
}

/** The call to `inDev` is unreachable, so it cannot raise into the `try` below. */
function step(n: number): number {
  if (isDevelopment) {
    return inDev(n);
  }
  return n * 2;
}

/** The subject: this refused before the analyses stopped walking the dead branch. */
export function viaDeadBranch(n: number): number {
  try {
    return step(n);
  } catch {
    return -1;
  }
}

/**
 * **The same dead branch written inline in the `try`'s own body**, which is the
 * shape a `__DEV__` port actually has -- `try { … if (isDevelopment) {
 * runWithFiberInDEV(…) } … }` -- and the one the first version of this fixture did
 * not have. Pruning the *analyses* cleared a dead branch in a **callee** and left
 * this refused, because the walk that refuses the `try` read every child. 49 `try`s
 * in one file of the React port are this form.
 */
export function inlineDeadBranch(n: number): number {
  try {
    let out = n;
    if (isDevelopment) {
      out = inDev(n);
    } else {
      out = n * 3;
    }
    return out;
  } catch {
    return -1;
  }
}

/**
 * The control: the same `try` over a live call to the same generic, which **must**
 * still refuse -- pruning a dead branch must not make a reachable one disappear.
 * Kept in a separate function so the subject above can compile while this one does
 * not, and listed in `tooling/gate/example-refusals`.
 */
function liveStep(n: number): number {
  return inDev(n);
}

export function viaLiveCall(n: number): number {
  try {
    return liveStep(n);
  } catch {
    return -1;
  }
}
