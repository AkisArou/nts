// A `try`/`catch` does not catch an exception thrown by a function it calls.
//
//     throw in the try's own body        caught, answers 5
//     throw from a called arrow          escapes
//     throw from a called nested function escapes
//     throw from a called top-level function escapes
//
// Node answers 5 for all four. The compiled program answers 5 for the first and
// lets the other three out of the addon entirely.
//
// # Why this is worth more than its four cases
//
// It is not an exotic construct. `internal/validators.ts` throws and every
// caller catches; node's own tests are largely `assert.throws(() => …)`. A
// `catch` that only catches what its own body threw is a different language.
//
// It also means **a passing compiled test does not establish that the module's
// error handling works** -- only that nothing threw across a call inside it.
// The compiled axis is counted in tests that pass, and this is the kind of
// defect that lets a test pass for the wrong reason elsewhere.
//
// # Found by a sweep, once again not by looking for it
//
// `ordering-and-statement-seams` asks ten questions about statement forms --
// labelled break, labelled continue, argument evaluation order, the left side
// of an assignment before the right, a do-while body running once, a for
// update after the body. Nine of them agree exactly. The tenth was this.
//
// The `throwInPlace` control is the one that makes it precise: catching works,
// and the call is what breaks it.

/** Node: 5. Agrees. */
export function throwInPlace(): number {
  try {
    throw new Error("x");
  } catch {
    return 5;
  }
}

/** Node: 5. Escapes. */
export function throwAcrossAnArrow(): number {
  const inner = (): number => {
    throw new Error("x");
  };
  try {
    return inner();
  } catch {
    return 5;
  }
}

/** Node: 5. Escapes. */
export function throwAcrossANestedFunction(): number {
  function inner(): number {
    throw new Error("x");
  }
  try {
    return inner();
  } catch {
    return 5;
  }
}

/** Node: 5. Escapes. */
export function throwAcrossATopLevelFunction(): number {
  try {
    return topLevelThrower();
  } catch {
    return 5;
  }
}

function topLevelThrower(): number {
  throw new Error("x");
}
