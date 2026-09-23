// Which `try` this compiler can answer, and which one it still refuses.
//
// A `throw` is lowered as an edge to the handler's block, and that edge lives
// inside one function. A callee's `throw` had nowhere to go: the callee ended
// the process through `nts_uncaught` and the caller's `catch` never ran, so the
// call was refused -- this file's name is that limitation.
//
// **It is not the limitation any more.** A callee a `try` reaches is compiled a
// second time as a *raising copy*, which records the thrown value with
// `nts_raise` and returns instead of ending the program; the call names that
// copy and is followed by a test that branches into the handler. Every frame
// between the throw and the handler is left by an ordinary `return`, so the
// releases reference counting put on those edges all run -- which is the leak
// record 0246 priced a `longjmp` at, not taken. Record 0343.
//
// The plain function is untouched and an ordinary call still names it, so a
// throw nobody catches still ends the program, which is what node does.
//
// # The arms, and why they are in one file
//
// Two still refuse, and they are here rather than in `blockers/` because what
// makes them refuse is the *absence* of a copy, and the arms that do get one
// are the only thing that shows the difference is the copy rather than the
// `try`. The four that compile are the ones two successive versions of the old
// refusal broke; record 0300 is about that, and they are asserted by name in
// `compiler/core/tests/throw_across_a_call.rs`.

function raises(n: number): number {
  if (n > 3) {
    throw new RangeError("too deep");
  }
  return n * 2;
}

function pure(n: number): number {
  return n & 7;
}

async function rejecting(n: number): Promise<number> {
  if (n > 3) {
    throw new RangeError("too deep");
  }
  return n * 2;
}

// **Compiles now.** `raises` is a plain function whose every `throw` is its
// own, so it has a raising copy and this call names it.
export function crossing(n: number): number {
  try {
    return raises(n);
  } catch {
    return -1;
  }
}

// Compiles. The throw and the handler are in one function, which is the
// commonest shape there is, and the edge is a branch.
export function sameFunction(n: number): number {
  try {
    if (n > 3) {
      throw new RangeError("too deep");
    }
    return n * 2;
  } catch {
    return -1;
  }
}

// Compiles. A call inside a `try` is no worse than the same call outside one
// when the callee cannot raise, and refusing on "is it compiled code" alone
// took this shape away -- `examples/array-buffer` wraps `new ArrayBuffer(
// bounded(n))` in exactly this and lost six tests to it.
export function callingSomethingPure(n: number): number {
  try {
    return pure(n);
  } catch {
    return -1;
  }
}

// Compiles. An `async` function never raises synchronously: a `throw` in one
// rejects the promise it already returned, and that rejection *is* an edge into
// this handler -- see `examples/async-catch`, which is eight functions of it.
// Treating an async callee as a raise refused all eight.
export async function awaitingARejection(n: number): Promise<number> {
  try {
    return await rejecting(n);
  } catch {
    return -1;
  }
}

// Still refused: a **method** has no raising copy. `function_copies` is
// consulted for `FUNCTION_DECLARATION`s, so a method, a constructor and an
// accessor are all outside it -- the same boundary
// `blockers/an-interface-reached-by-six-routes` records for the structural
// copies, drawn by the same line of code.
class Deeper {
  raise(n: number): number {
    if (n > 3) {
      throw new RangeError("too deep");
    }
    return n * 2;
  }
}

export function crossingAMethod(n: number): number {
  const deeper = new Deeper();
  try {
    return deeper.raise(n);
  } catch {
    return -1;
  }
}

// Still refused: `passesItOn` does not throw, it *calls* something that does.
// A raising copy of it would call the plain `raises`, which ends the program --
// so the copy would be a `try` that still does not catch, which is worse than a
// refusal. What that needs is a copy of a copy, and the fixpoint for it is not
// written; `Throwing::self_contained` is the line that draws the bound.
function passesItOn(n: number): number {
  return raises(n) + 1;
}

export function crossingTwoFrames(n: number): number {
  try {
    return passesItOn(n);
  } catch {
    return -1;
  }
}

// Compiles, and the `finally` runs **before** the handler. A raise reaching a
// `try` with a `finally` between it and the `catch` takes the same path a
// lexical `throw` takes, so the handler edge this feature adds composes with
// the exit stack rather than going around it.
//
// Order-sensitive on purpose: `1` then `2` is 12, a handler that skipped the
// `finally` answers 2, and one that ran it afterwards answers 21. A test that
// only asked "was it caught" agrees with all three.
//
// `trace` is a **local**, so the handler has to carry it as a block parameter --
// the "one parameter for each name the edges disagree about" machinery in
// `lower_try`, exercised by an edge that is not a `throw`.
export function finallyRunsBeforeTheHandler(n: number): number {
  let trace = 0;
  try {
    try {
      return raises(n);
    } finally {
      trace = trace * 10 + 1;
    }
  } catch {
    return trace * 10 + 2;
  }
}

// And two of them, which is 112: each `finally` between the raise and the
// handler runs, innermost first.
export function everyFinallyBetweenRuns(n: number): number {
  let trace = 0;
  try {
    try {
      try {
        return raises(n);
      } finally {
        trace = trace * 10 + 1;
      }
    } finally {
      trace = trace * 10 + 1;
    }
  } catch {
    return trace * 10 + 2;
  }
}
