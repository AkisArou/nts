// Exception handling beyond the single case in `a-throw-across-a-call`. Each
// answers a number.
//
// # The result is a clean split, and it scopes the defect exactly
//
// **Everything within one frame is correct:**
//
//     the catch binds the thrown value                        agrees
//     a rethrow from a catch reaches the outer catch          agrees
//     a thrown number arrives as a number                     agrees
//     finally runs after a caught exception, same frame       agrees
//
// **Everything that crosses a call is not:**
//
//     finally running as an exception passes out of a frame   escapes
//     an exception through two frames                         escapes
//     a catch in the caller of the throwing frame             escapes
//
// So it is not `try`, not `catch`, not `finally`, not the binding, not the
// rethrow and not the thrown value's type. **An exception does not propagate
// across a call frame.** Within one frame the machinery is complete and right.
//
// `finallyOnTheWayOut` escapes with an **empty message** where the others carry
// theirs, which is worth a line: the exception that gets out of a frame with a
// `finally` in it is not the one that went in.

function thrower(): number {
  throw new Error("boom");
}

/** The catch binds the thrown value. */
export function catchBindsTheValue(): number {
  try {
    throw new Error("seven");
  } catch (e) {
    return e instanceof Error ? e.message.length : -1;
  }
}

/** finally runs when an exception passes through, before it continues. */
export function finallyOnTheWayOut(): number {
  let seen = 0;
  const inner = (): number => {
    try {
      throw new Error("x");
    } finally {
      seen = 1;
    }
  };
  try {
    inner();
  } catch {
    return seen + 10;
  }
  return -1;
}

/** A rethrow from a catch reaches the outer catch. */
export function rethrowReachesOuter(): number {
  try {
    try {
      throw new Error("x");
    } catch {
      throw new Error("y");
    }
  } catch (e) {
    return e instanceof Error && e.message === "y" ? 1 : 0;
  }
}

/** A throw of a non-Error value arrives as itself. */
export function throwANumber(): number {
  try {
    // eslint-disable-next-line no-throw-literal
    throw 42;
  } catch (e) {
    return typeof e === "number" ? e : -1;
  }
}

/** An exception through two frames. */
export function throughTwoFrames(): number {
  const middle = (): number => thrower();
  try {
    return middle();
  } catch {
    return 3;
  }
}

/** A catch that does not rethrow stops the exception. */
export function catchStopsIt(): number {
  const inner = (): number => {
    try {
      return thrower();
    } catch {
      return 8;
    }
  };
  return inner();
}

/** finally runs after a caught exception, in the same frame. */
export function finallyAfterCatch(): number {
  let seen = 0;
  try {
    throw new Error("x");
  } catch {
    seen = 1;
  } finally {
    seen = seen * 10 + 2;
  }
  return seen;
}
