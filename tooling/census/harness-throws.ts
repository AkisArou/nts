  // `assert.throws(Ctor, fn)`, spliced into `namespace assert` by `project.ts` --
  // **only for a test that calls it**. Pass only if `fn` throws an instance of
  // `Ctor`; transcribed from `harness/assert.js` down to what this stand-in can
  // say (the constructor check is a closed dispatch, below; the messages differ). `expected`
  // takes a *required* message: `Test262Error`'s constructor requires one, and a
  // constructor whose message is optional is assignable to that, not the reverse.
  //
  // **Why only when called.** Its body calls a function value inside a `try`,
  // which the compiler refuses ("through a function value, which has no raising
  // copy to call") -- and that shape used to *escape the handler silently*, the
  // conformance lane's reduction of 2026-09-26. Placed in the shared stand-in, the
  // refused member made every program unsupported, `throws` or not: the census's
  // control arm, which never calls it, came back `unsupported/lowering`. test262
  // itself includes harness files per test, so this does the same for one member.
  //
  // The 3,229 `test/language` cases that call it are then *refused at a harness
  // line* -- one cause, ranked once -- and the day the raising copy exists they
  // start running with no change here.
  // **The constructor check is a closed dispatch, not `instanceof expected`.**
  // `harness/assert.js` asks `thrown.constructor !== expected`; this stand-in
  // cannot ask either of a constructor *value*. `instanceof` against a value is
  // refused ("an `instanceof` against something this compiler has no class
  // for"), and `.constructor ===` compiles and answers wrongly (there is no
  // constructor slot to read). So `expected` is compared by identity with the
  // constructors test262 passes here -- TypeError 12,214 calls, ReferenceError
  // 2,739, RangeError 2,585, Test262Error 2,031, SyntaxError 1,182, then Error,
  // URIError and EvalError, about 98% of them -- and each answer is an
  // `instanceof` against that class by name, which lowers. Measured on
  // 2026-09-30: with the raising copy built, every one of 7,617 cases reached
  // exactly the refused `instanceof` next.
  //
  // A constructor outside the list (a test's own `MyError`, a cross-realm
  // `other.TypeError`) is **not judged**: `StandInCannotJudge` escapes, and
  // attempt262 records the case as unsupported in the harness, not as a pass
  // and not as a fail. A stand-in that guessed would put its own limit in the
  // test's verdict.
  class StandInCannotJudge {
    readonly message: string;
    constructor(message: string) {
      this.message = message;
    }
  }
  function isInstance(thrown: unknown, expected: new (message: string) => unknown): boolean {
    if (expected === TypeError) return thrown instanceof TypeError;
    if (expected === ReferenceError) return thrown instanceof ReferenceError;
    if (expected === RangeError) return thrown instanceof RangeError;
    if (expected === Test262Error) return thrown instanceof Test262Error;
    if (expected === SyntaxError) return thrown instanceof SyntaxError;
    if (expected === URIError) return thrown instanceof URIError;
    if (expected === EvalError) return thrown instanceof EvalError;
    if (expected === Error) return thrown instanceof Error;
    throw new StandInCannotJudge("assert.throws: a constructor outside the stand-in's list");
  }
  export function throws(expected: new (message: string) => unknown, fn: () => void, message?: string): void {
    let threw = false;
    let thrownValue: unknown;
    try {
      fn();
    } catch (thrown) {
      threw = true;
      thrownValue = thrown;
    }
    if (!threw) throw new Test262Error(message ?? "throws: nothing was thrown");
    if (!isInstance(thrownValue, expected)) {
      throw new Test262Error(message ?? "throws: a different constructor was thrown");
    }
  }
