// A call to a function declared `never`, used as a statement.
//
// `never` is `void` in a **return** position and has no value spelling at all, so
// the LLVM backend asked for the value type of the call's result and refused --
// "a value of type Never, which this backend does not render yet" -- even where
// nothing reads it. The C backend declares the same call `void` and emits it, so
// one backend rendered `if (bad) fail(msg);` and the other declined the whole
// function. It is how a guard clause is written, and the React lane's port has
// fourteen of them between `throwOnInvalidObjectType` and the hydration claimers.
//
// The arms are chosen so that **every case is compared**, which for a `never` call
// takes some care: a call that actually runs ends the program, and the harness
// counts an ended program as a declined case rather than a compared one. So one arm
// throws into a `catch` beside it, and one has the call in code the values never
// reach -- through a comparison the compiler cannot fold, since a folded branch is
// not lowered at all and would leave the fixture measuring nothing.

function fail(message: string): never {
  throw new Error(message);
}

/// The call is emitted and never taken: nothing folds `n === -1.5e308`, and no
/// value the harness supplies satisfies it.
export function emittedAndNotTaken(n: number): number {
  if (n === -1.5e308) {
    fail("a value the harness does not supply");
  }
  return n * 100 + 6;
}

/// The call runs, and the `catch` beside it is what keeps the case comparable.
export function caughtBeside(n: number): number {
  try {
    if (n < 0) {
      fail("negative");
    }
    return n * 100 + 6;
  } catch {
    return -1;
  }
}

/// The same through a second function, so the raising copy carries it too.
function check(n: number): number {
  if (n < 0) {
    fail("negative");
  }
  return n + 1;
}

export function caughtOneCallAway(n: number): number {
  try {
    return check(n) * 100;
  } catch {
    return -2;
  }
}

/// And the control with no `never` call at all, which has always rendered.
export function withoutTheCall(n: number): number {
  if (n < 0) {
    return -3;
  }
  return n * 100 + 6;
}
