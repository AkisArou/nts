// The parts of node's `test/common` that its own tests reach for.
//
// Everything this file provides is a place to grade ourselves. A helper that
// builds the *expected* half of an assertion decides whether we pass, so the
// ones that do are transcribed verbatim from node's `test/common/index.js`
// rather than paraphrased -- an approximation compares our output against a
// string node never produces, which manufactures both false passes and false
// failures.
//
// Keep this surface small and keep this list current. Anything added here is a
// claim that node's version behaves the same way.
//
//   isWindows              ours, and always false: we build the posix side
//   skip                   ours; raises so the runner can count it
//   mustCall / mustNotCall ours; the runner checks the tallies at the end
//   invalidArgTypeHelper   node's, verbatim, test/common/index.js:802
//   getTTYfd               node's, verbatim, test/common/index.js
//   allowGlobals, ...      no-ops; they configure node's own leak checker

import assert from "node:assert";
import { inspect } from "node:util";
import { openSync } from "node:fs";
import { createRequire } from "node:module";

/** Raised by `skip`, so the runner can tell "not applicable" from "failed". */
export class Skip extends Error {
  constructor(reason) {
    super(reason);
    this.name = "Skip";
  }
}

/** Calls a test declared as `mustCall` did not make, checked after it returns. */
const pending = [];

/**
 * Record an expectation and return the function that satisfies it.
 *
 * Node lets the count stand in for the callback -- `mustCall(10)` means "some
 * function, called ten times" -- and tests use that form freely. Reading it as
 * the callback instead gives a number where a function should be, and the
 * failure surfaces inside this file rather than in the test.
 *
 * The wrapper forwards `this`, because node's does: a test that writes
 * `emitter.on('x', common.mustCall(function () { this.listeners('x'); }))`
 * depends on it.
 */
function expect(fn, count, atLeast) {
  if (typeof fn === "number") {
    count = fn;
    fn = () => {};
  }
  if (fn === undefined) fn = () => {};
  const record = {
    expected: count === undefined ? 1 : count,
    actual: 0,
    atLeast,
    name: fn.name || "anonymous",
  };
  pending.push(record);
  return function (...args) {
    record.actual++;
    return Reflect.apply(fn, this, args);
  };
}

/** Expectations not yet satisfied, without clearing them. */
export function peekPending() {
  return pending.filter((p) =>
    p.atLeast ? p.actual < p.expected : p.actual !== p.expected);
}

export function checkPending() {
  const missed = peekPending();
  pending.length = 0;
  return missed;
}

export function makeCommon() {
  /**
   * A file descriptor that is a terminal, or -1.
   *
   * Node's own, transcribed: a test that checks colour behaviour needs a real
   * TTY, and the only way to get one is to find a descriptor that already is
   * one or open the controlling terminal.
   */
  function getTTYfd() {
    const tty = createRequire(import.meta.url)("node:tty");
    // Not fd 0: it is not writable on Windows.
    const ttyFd = [1, 2, 4, 5].find(tty.isatty);
    if (ttyFd === undefined) {
      try {
        return openSync("/dev/tty");
      } catch {
        return -1;
      }
    }
    return ttyFd;
  }

  return {
    getTTYfd,
    isWindows: false,
    isMainThread: true,
    // The truth about the process these tests run in, not a conservative
    // default. Reporting `false` makes every `{ skip: !hasIntl }` case skip,
    // and a file whose every case skipped still exits 0 -- which the runner
    // counted as a pass. Four files were passing that way.
    hasCrypto: true,
    hasIntl: typeof Intl !== "undefined",

    skip(reason) {
      throw new Skip(reason ?? "skipped");
    },

    // A regular function, not an arrow: node's listeners are called with the
    // emitter as `this`, and a wrapper that dropped it would make
    // `this.listeners('baz')` inside a test throw. Forwarding `this` is part
    // of the contract, not a detail.
    mustCall(fn, expected) {
      return expect(fn, expected, false);
    },

    mustCallAtLeast(fn, minimum) {
      return expect(fn, minimum, true);
    },

    mustNotCall(message = "should not have been called") {
      return function () {
        throw new Error(message);
      };
    },

    mustSucceed(fn = () => {}, expected = 1) {
      return this.mustCall(function (err, ...rest) {
        if (err) throw err;
        return fn.apply(this, rest);
      }, expected);
    },

    /**
     * A handler that asserts the error it is given matches `validator`.
     *
     * Node builds this on `assert.throws`, so the validator can be anything
     * `assert.throws` accepts -- a constructor, a regular expression, an
     * object of expected properties, or a predicate. Tests pass an object far
     * more often than a function, and returning the argument unchanged (which
     * this used to do) handed an *object* to something expecting a listener.
     *
     * Wrapped in `mustCall`, as node's is: a test that installs an error
     * handler and never sees the error has not passed.
     */
    expectsError(validator, exact) {
      return this.mustCall((...args) => {
        const [error] = args;
        assert.throws(() => {
          throw error;
        }, validator);
        return true;
      }, exact);
    },

    /**
     * Node freezes an options object to catch a callee that mutates it.
     * Freezing is the whole check, so this does it rather than returning the
     * object unchanged -- a stand-in that skipped the freeze would pass a test
     * whose entire subject is whether we mutate.
     */
    mustNotMutateObjectDeep(original) {
      if (original === null || typeof original !== "object") return original;
      for (const value of Object.values(original)) {
        this.mustNotMutateObjectDeep(value);
      }
      return Object.freeze(original);
    },

    /** Node quotes for `sh -c`; the tests use it to build a shell command. */
    escapePOSIXShell(strings, ...args) {
      let command = strings[0];
      for (let i = 0; i < args.length; i++) {
        command += `'${String(args[i]).replaceAll("'", "'\\''")}'${strings[i + 1]}`;
      }
      return [command];
    },

    /** Node skips a few tests that need a 64-bit address space. */
    skipIf32Bits() {},
    skipIfInspectorDisabled() {
      throw new Skip("needs the inspector");
    },
    skipIfWorker() {},

    /** Node skips symlink tests without the privilege; posix always has it. */
    canCreateSymLink() {
      return true;
    },

    /**
     * Node asserts that a `process.emitWarning` happened. Ours records the
     * expectation and checks it the same way `mustCall` does, so a test that
     * expects a warning we never emit fails rather than passes quietly.
     */
    expectWarning(nameOrMap, expected) {
      const names = typeof nameOrMap === "string" ? [nameOrMap] : Object.keys(nameOrMap ?? {});
      const record = { expected: names.length, actual: 0, atLeast: true, name: `warning ${names.join(", ")}` };
      pending.push(record);
      process.on("warning", () => {
        record.actual++;
      });
      void expected;
    },

    // Node's own leak and handle checking. No-ops here: they configure a
    // harness we are not running, and pretending to implement them would be a
    // claim we cannot back.
    allowGlobals() {},
    hasFipsCrypto: false,
    platformTimeout: (ms) => ms,
    printSkipMessage(reason) {
      throw new Skip(reason);
    },

    // Verbatim from node `test/common/index.js:802`. Not ours to approximate:
    // it builds the expected half of every ERR_INVALID_ARG_TYPE assertion.
    invalidArgTypeHelper(input) {
      if (input == null) {
        return ` Received ${input}`;
      }
      if (typeof input === "function") {
        return ` Received function ${input.name}`;
      }
      if (typeof input === "object") {
        if (input.constructor?.name) {
          return ` Received an instance of ${input.constructor.name}`;
        }
        return ` Received ${inspect(input, { depth: -1 })}`;
      }
      let inspected = inspect(input, { colors: false });
      if (inspected.length > 28) {
        inspected = `${inspected.slice(inspected, 0, 25)}...`;
      }
      return ` Received type ${typeof input} (${inspected})`;
    },
  };
}
