// `throw` and `catch`.
//
// A handler is a block and a `throw` is a jump to it, so everything here
// compiles to branches: there is no unwinder, no landing pad, and no table.
// What makes that possible is that `catch (e)` is `unknown` -- one static type
// for every thrown thing -- so the value rides the edge as an erased value and
// `typeof e` is a comparison on its tag.

// The ordinary shape. The thrown `Error` never leaves the function, so escape
// analysis keeps it in the frame: this allocates nothing.
export function guarded(n: number): number {
  try {
    if (n < 0) {
      throw new Error("negative");
    }
    return n * 2;
  } catch (e) {
    return -1;
  }
}

// Four things of four types thrown into one handler. They arrive as one
// representation, and telling them apart is a compare on the tag.
export function whatWasThrown(n: number): number {
  try {
    if (n < 0) {
      throw "text";
    }
    if (n > 1000) {
      throw 7;
    }
    if (n === 0) {
      throw true;
    }
    if (n === 1) {
      throw new Error("one");
    }
    return 0;
  } catch (e) {
    if (typeof e === "string") {
      return 1;
    }
    if (typeof e === "number") {
      return 2;
    }
    if (typeof e === "boolean") {
      return 3;
    }
    if (typeof e === "object") {
      return 4;
    }
    return 5;
  }
}

// Two `throw`s that disagree about what `seen` holds. The handler needs a
// parameter for it, and for nothing else.
export function edgesDisagree(n: number): number {
  let seen = 0;
  try {
    seen = 1;
    if (n < 0) {
      throw "a";
    }
    seen = 2;
    if (n > 100) {
      throw "b";
    }
    seen = 3;
    return seen;
  } catch (e) {
    return -seen;
  }
}

// A `throw` inside a `catch` belongs to the *enclosing* `try`, not to its own.
export function nested(n: number): number {
  let depth = 0;
  try {
    try {
      if (n < 0) {
        throw "inner";
      }
      depth = 1;
    } catch (e) {
      depth = 2;
      if (n < -100) {
        throw "outer";
      }
    }
    return depth;
  } catch (e) {
    return -depth;
  }
}

// Out of a loop, from a block that already has parameters of its own.
export function outOfALoop(n: number): number {
  let total = 0;
  try {
    for (let i = 0; i < 4; i = i + 1) {
      total = total + i;
      if (i > n) {
        throw "stop";
      }
    }
    return total;
  } catch (e) {
    return -total;
  }
}

// Nothing in the body can throw, so the handler is unreachable and is not
// emitted. Writing it is not a mistake and does not cost anything.
export function neverThrows(n: number): number {
  try {
    return n + 1;
  } catch (e) {
    return -1;
  }
}

// `catch { }` binds nothing.
export function withoutBinding(n: number): number {
  try {
    if (n < 0) {
      throw new Error("negative");
    }
    return 1;
  } catch {
    return 2;
  }
}

// `break`, `continue` and `return` all leave a `try` from inside it, and each
// one leaves the block terminated -- which is what the merge below the handler
// has to notice rather than assume.
export function abruptExits(n: number): number {
  let total = 0;
  for (let i = 0; i < 5; i = i + 1) {
    try {
      if (i > n) {
        throw "stop";
      }
      total = total + i;
      if (i === 3) {
        break;
      }
      continue;
    } catch (e) {
      total = total + 100;
    }
    total = total + 1000;
  }
  return total;
}

// A `return` from inside the body, and another from the handler: neither path
// reaches the code below the `try`, so there is nothing to merge.
export function returnsFromBothSides(n: number): number {
  try {
    if (n < 0) {
      throw "negative";
    }
    return n * 3;
  } catch (e) {
    return 7;
  }
}

// `finally` runs on every way out, so it is lowered again at each of them: once
// for normal completion, once before each `return`, `break` and `continue` that
// leaves it, and once on the way past for a `throw` it does not catch. That is
// a copy of a usually-small block, against a shared copy needing a variable
// saying where to go afterwards and a switch on it at the bottom.
export function alsoFinally(n: number): number {
  let log = 0;
  try {
    log = 1;
    if (n < 0) {
      throw "negative";
    }
    log = 2;
  } catch (e) {
    log = log + 10;
  } finally {
    log = log + 100;
  }
  return log;
}

// No `catch` at all: the `finally` runs and the `throw` carries on outwards.
// Here the only way out is the `return`, which still goes through it.
export function finallyWithoutCatch(n: number): number {
  let log = 0;
  try {
    if (n < 0) {
      return -1;
    }
    log = 1;
  } finally {
    log = log + 100;
  }
  return log;
}

// A `finally` that returns replaces the completion that was leaving, including
// a `return` already carrying a value.
export function finallyReplacesTheReturn(n: number): number {
  try {
    if (n < 0) {
      return 5;
    }
    return 6;
  } finally {
    return 99;
  }
}

// `break` and `continue` leave every `try` between them and the loop.
export function loopThroughFinally(n: number): number {
  let total = 0;
  for (let i = 0; i < 4; i = i + 1) {
    try {
      if (i > n) {
        break;
      }
      if (i === 1) {
        continue;
      }
      total = total + 1;
    } finally {
      total = total + 10;
    }
  }
  return total;
}

// The inner `finally` runs on the way to the outer `catch`, and the outer
// `finally` runs after it.
export function nestedFinally(n: number): number {
  let log = 0;
  try {
    try {
      if (n < 0) {
        throw "inner";
      }
      log = 1;
    } finally {
      log = log + 10;
    }
  } catch (e) {
    log = log + 100;
  } finally {
    log = log + 1000;
  }
  return log;
}

// An array method compiled as a loop puts the callback's body inside this
// function, and a `return` there means "this element is done". So it leaves the
// `try`s written *inside the callback* and no others -- an enclosing `try`
// around the `forEach` itself is not being left at all.
export function finallyInsideACallback(n: number): number {
  let log = 0;
  const xs = [1, 2, 3];
  xs.forEach((x) => {
    try {
      if (x > n) {
        return;
      }
      log = log + 1;
    } finally {
      log = log + 10;
    }
  });
  return log;
}

// A `throw` inside a `finally` replaces whatever was leaving through it -- the
// `return 1` on one path and the `throw "a"` already on its way to a handler on
// the other. It falls out of the same rule as a `finally` that returns: the
// body terminates the block itself, so the completion it interrupted is never
// emitted.
export function finallyThrowReplacesTheThrow(n: number): number {
  try {
    try {
      if (n < 0) {
        throw "a";
      }
      return 1;
    } finally {
      if (n < 10) {
        throw "b";
      }
    }
  } catch (e) {
    if (typeof e === "string") {
      return e === "b" ? 2 : 3;
    }
    return 4;
  }
}

// `instanceof` is what makes a `catch` binding useful: `e` is `unknown`, and
// this is how a handler asks which error it caught.
//
// It is a comparison, not a walk. The classes that satisfy `e instanceof Error`
// are fixed when the program is built -- `Error` and everything extending it --
// so there is no prototype chain to follow, and a compiled program cannot gain
// a subclass after the fact.
export function whichError(n: number): number {
  try {
    if (n < 0) {
      throw new TypeError("negative");
    }
    if (n === 0) {
      throw new RangeError("zero");
    }
    throw "not an error at all";
  } catch (e) {
    if (e instanceof TypeError) {
      return 1;
    }
    if (e instanceof RangeError) {
      return 2;
    }
    if (e instanceof Error) {
      return 3;
    }
    return 4;
  }
}

// `TypeError` is an `Error`, and the test says so: the provided error classes
// are not declarations in this program, so the relation is one the compiler
// carries rather than one the hierarchy can see.
export function aTypeErrorIsAnError(n: number): number {
  try {
    throw n < 0 ? new TypeError("t") : new Error("e");
  } catch (e) {
    return e instanceof Error ? 1 : 0;
  }
}

// A thrown string is a reference too, and it reaches the same comparison. Its
// descriptor is a string's, which is never a class's, so it answers false by
// the ordinary route rather than by a case of its own.
export function aStringIsNotAnError(n: number): number {
  try {
    throw "text";
  } catch (e) {
    return e instanceof Error ? 1 : 0;
  }
}
