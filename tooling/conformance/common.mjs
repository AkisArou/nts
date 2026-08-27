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
//   allowGlobals, ...      no-ops; they configure node's own leak checker

import { inspect } from "node:util";

/** Raised by `skip`, so the runner can tell "not applicable" from "failed". */
export class Skip extends Error {
  constructor(reason) {
    super(reason);
    this.name = "Skip";
  }
}

/** Calls a test declared as `mustCall` did not make, checked after it returns. */
const pending = [];

export function checkPending() {
  const missed = pending.filter((p) =>
    p.atLeast ? p.actual < p.expected : p.actual !== p.expected);
  pending.length = 0;
  return missed;
}

export function makeCommon() {
  return {
    isWindows: false,
    isMainThread: true,
    hasCrypto: false,
    hasIntl: false,

    skip(reason) {
      throw new Skip(reason ?? "skipped");
    },

    mustCall(fn = () => {}, expected = 1) {
      const record = { expected, actual: 0, name: fn.name || "anonymous" };
      pending.push(record);
      return (...args) => {
        record.actual++;
        return fn(...args);
      };
    },

    mustCallAtLeast(fn = () => {}, minimum = 1) {
      const record = { expected: minimum, actual: 0, atLeast: true, name: fn.name || "anonymous" };
      pending.push(record);
      return (...args) => {
        record.actual++;
        return fn(...args);
      };
    },

    mustNotCall(message = "should not have been called") {
      return () => {
        throw new Error(message);
      };
    },

    mustSucceed(fn = () => {}, expected = 1) {
      return this.mustCall((err, ...rest) => {
        if (err) throw err;
        return fn(...rest);
      }, expected);
    },

    expectsError(fn) {
      return fn;
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
