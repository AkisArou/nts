// Stepping a generator that can `throw`, inside a `try`.
//
// A generator's resumption is a **call**, so it is a raising boundary like any other: the
// body's `throw` has to reach the handler of the `try` the *step* is inside. It did not.
// `outcomes/a-generator-that-throws-stepped-inside-a-try` recorded what happened instead, and
// the shape of it is why that record is now this file:
//
//     nts   a reached throw=3    an unreached throw=-2   the control=3
//     node  a reached throw=-4   an unreached throw=3    the control=3
//
// **Two arms of one program reported each other's outcome.** The loop header called the
// *raising* resumption -- which records the `throw` with `nts_raise` and answers `done` -- and
// never tested the flag, so the loop exited **normally** and the handler never ran. The flag
// stayed set, and the next `nts_raising()` anywhere in the program read it: the other arm's,
// emitted after its own generator call.
//
// # Why the arms belong together
//
// The interference *is* the finding, so neither arm alone can show it: the same program
// without `aReachedThrow` agreed with node on every case before the fix. That is also why
// this is an example rather than a blocker -- what has to be held is an **answer** per arm,
// on every backend, and a count of refusals could not see the swap at all.
//
// # The arms
//
//   noThrowWithABreak            no `throw` in the generator, and a `break`: the shape that
//                                worked, so a regression in the ordinary walk shows here
//   noThrowInsideATry            the same, one difference: a `try` around it
//   anUnreachedThrowInsideATry   a generator that *can* throw and does not -- the arm that
//                                read the other one's flag
//   aFiniteGeneratorInsideATry   no `break` and no `throw`, so the loop ends by `done`:
//                                the control for "the step tests the flag" not becoming
//                                "the step mistakes `done` for a raise"
//   aReachedThrowInsideATry      the defect: the `throw` happens and the handler must run

function* counting(): Generator<number> {
  let i = 0;
  while (true) {
    yield i;
    i += 1;
  }
}

function* countingToward(limit: number): Generator<number> {
  let i = 0;
  while (true) {
    if (i > limit) {
      throw new RangeError("stepped too far");
    }
    yield i;
    i += 1;
  }
}

function* finite(limit: number): Generator<number> {
  for (let i = 0; i <= limit; i += 1) {
    yield i;
  }
}

/** No `throw` in the generator at all, and a `break` out of the loop. */
export function noThrowWithABreak(n: number): number {
  let seen = 0;
  for (const x of counting()) {
    seen += x;
    if (x >= (n & 7)) {
      break;
    }
  }
  return seen;
}

/** The same inside a `try`, which is the only difference. */
export function noThrowInsideATry(n: number): number {
  let seen = 0;
  try {
    for (const x of counting()) {
      seen += x;
      if (x >= (n & 7)) {
        break;
      }
    }
    return seen;
  } catch {
    return -1;
  }
}

/** A generator that *could* throw but never does: the arm that read the other's flag. */
export function anUnreachedThrowInsideATry(n: number): number {
  let seen = 0;
  try {
    for (const x of countingToward(1000)) {
      seen += x;
      if (x >= (n & 7)) {
        break;
      }
    }
    return seen;
  } catch {
    return -2;
  }
}

/** A finite generator, so the loop ends by `done` rather than by `break`. */
export function aFiniteGeneratorInsideATry(n: number): number {
  let seen = 0;
  try {
    for (const x of finite(n & 7)) {
      seen += x;
    }
    return seen;
  } catch {
    return -3;
  }
}

/** The defect: the generator's `throw` is reached and the handler must run. */
export function aReachedThrowInsideATry(n: number): number {
  let seen = 0;
  try {
    for (const x of countingToward(n & 7)) {
      seen += x;
      if (seen > 100) {
        break;
      }
    }
    return seen;
  } catch {
    return -4;
  }
}
