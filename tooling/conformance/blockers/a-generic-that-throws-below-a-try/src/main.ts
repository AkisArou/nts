// expect: NTS1001 a call inside a `try` whose `throw` would not reach this handler: a function that itself calls something whose `throw` cannot be carried: `boomGeneric`, a generic, whose copy suffix already names its instantiation
//
// **A leaf that had no name until 2026-09-26.** The refusal said "a function that
// itself calls something whose `throw` cannot be carried" and stopped there, which
// is the sentence the reader has already derived by getting this far. The React lane
// had it on **nine** `try`s in one file and could not bisect any of them.
//
// `the_leaf_that_cannot_be_carried` walks down naming the first callee that cannot
// carry a throw, and it looked only at what each callee *called*. A generic is a
// fact about the callee itself: `raising_copies` cannot make it a copy because a
// generic's suffix already names its instantiation, so the walk found every call in
// its body carryable, fell out of the loop, and answered `None`.
//
// The three reasons a copy cannot be made -- not a plain function, a generic,
// `async` -- are `can_be_copied`'s own conditions, now readable as sentences beside
// it in `why_not_copyable`.
//
// ## Why this stays a blocker rather than becoming an example
//
// Carrying a `throw` out of a *generic* is not what the raising-copy work reaches:
// the copy mechanism identifies a body by `(declaration, suffix)` and a generic's
// suffix is already spoken for by its instantiation. So this is a standing gap, and
// what changed is only that it says which function and why.

/** The leaf. A generic that throws, so no raising copy can be made of it. */
function boomGeneric<T>(value: T): T {
  if (value !== undefined) {
    throw new Error("generic");
  }
  return value;
}

/** One plain hop, so the refusal has to walk rather than read the call in front of it. */
function middle(n: number): number {
  return boomGeneric(n);
}

/** The subject: the `try` cannot be given a handler edge, and says which leaf. */
export function viaGeneric(n: number): number {
  try {
    return middle(n);
  } catch {
    return -1;
  }
}

/**
 * The control, and it compiles: the same hop to a thrower that is **not** generic,
 * so a raising copy exists and the `try` gets its handler. Without this arm a
 * regression that refused every `try` over a hop would read exactly like the
 * blocker.
 */
function boomPlain(n: number): number {
  if (n >= 0) {
    throw new Error("plain");
  }
  return n;
}

function middlePlain(n: number): number {
  return boomPlain(n);
}

export function viaPlain(n: number): number {
  try {
    return middlePlain(n);
  } catch {
    return -1;
  }
}
