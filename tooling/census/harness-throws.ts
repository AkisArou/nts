  // `assert.throws(Ctor, fn)`, spliced into `class assert` by `project.mjs` --
  // **only for a test that calls it**. Pass only if `fn` throws an instance of
  // `Ctor`; transcribed from `harness/assert.js` down to what this stand-in can
  // say (the constructor check is `instanceof`, the messages differ). `expected`
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
  static throws(expected: new (message: string) => unknown, fn: () => void, message?: string): void {
    let threw = false;
    try {
      fn();
    } catch (thrown) {
      threw = true;
      if (!(thrown instanceof expected)) {
        throw new Test262Error(message ?? "throws: a different constructor was thrown");
      }
    }
    if (!threw) throw new Test262Error(message ?? "throws: nothing was thrown");
  }

