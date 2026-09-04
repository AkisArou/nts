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
import { fstatSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import hostProcess from "node:process";

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
    registeredAt: new Error().stack?.split("\n").find((line) =>
      line.includes("third_party/node/test/") || line.includes("<anonymous>")),
  };
  pending.push(record);
  return function (...args) {
    record.actual++;
    return Reflect.apply(fn, this, args);
  };
}

// Pinned Node `test/common/index.js` protects an input recursively with
// mutation-trapping proxies. Freezing is not equivalent: it throws for a
// non-empty typed-array view before the module under test is even called.
const mustNotMutateObjectDeepProxies = new WeakMap();

function mustNotMutateObjectDeep(original) {
  if (original === null || typeof original !== "object") return original;

  const cached = mustNotMutateObjectDeepProxies.get(original);
  if (cached !== undefined) return cached;

  const handler = {
    __proto__: null,
    defineProperty(_target, property) {
      assert.fail(`Expected no side effects, got ${inspect(property)} defined`);
    },
    deleteProperty(_target, property) {
      assert.fail(`Expected no side effects, got ${inspect(property)} deleted`);
    },
    get(target, property, receiver) {
      return mustNotMutateObjectDeep(Reflect.get(target, property, receiver));
    },
    preventExtensions(target) {
      assert.fail(`Expected no side effects, got extensions prevented on ${inspect(target)}`);
    },
    set(_target, property, value) {
      assert.fail(
        `Expected no side effects, got ${inspect(value)} assigned to ${inspect(property)}`,
      );
    },
    setPrototypeOf(_target, prototype) {
      assert.fail(`Expected no side effects, got set prototype to ${prototype}`);
    },
  };

  const proxy = new Proxy(original, handler);
  mustNotMutateObjectDeepProxies.set(original, proxy);
  return proxy;
}

/** Node's helper: find a valid int32 descriptor number the process does not own. */
function runWithInvalidFD(func) {
  let fd = 1 << 30;
  try {
    while (fstatSync(fd--) && fd > 0) {
      // The condition performs the probe; a live descriptor advances to the
      // next candidate until fstat throws for one that is not open.
    }
  } catch {
    return func(fd);
  }
  throw new Skip("Could not generate an invalid fd");
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

export function makeCommon(pipePath) {
  const warningHandlers = new Map();

  function expectedWarning(name, expected, code) {
    let properties;
    if (typeof expected === "string") {
      properties = [[expected, code]];
    } else if (!Array.isArray(expected)) {
      properties = Object.entries(expected).map(([expectedCode, message]) =>
        [message, expectedCode]);
    } else if (expected.length !== 0 && !Array.isArray(expected[0])) {
      properties = [[expected[0], expected[1]]];
    } else {
      properties = expected;
    }

    if (name === "DeprecationWarning") {
      for (const pair of properties) {
        assert(pair[1], `Missing deprecation code: ${inspect(properties)}`);
      }
    }

    return expect((warning) => {
      const pair = properties.shift();
      if (pair === undefined) {
        assert.fail(`Unexpected extra warning received: ${warning}`);
      }
      const [message, expectedCode] = pair;
      assert.strictEqual(warning.name, name);
      if (typeof message === "string") {
        assert.strictEqual(warning.message, message);
      } else {
        assert.match(warning.message, message);
      }
      assert.strictEqual(warning.code, expectedCode);
    }, properties.length, false);
  }

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
    PIPE: pipePath,
    get PORT() {
      if (+hostProcess.env.TEST_PARALLEL) {
        throw new Error("common.PORT cannot be used in a parallelized test");
      }
      return +hostProcess.env.NODE_COMMON_PORT || 12346;
    },
    localhostIPv4: "127.0.0.1",
    getTTYfd,
    runWithInvalidFD,
    isWindows: false,
    isLinux: hostProcess.platform === "linux",
    isMainThread: true,
    // The truth about the process these tests run in, not a conservative
    // default. Reporting `false` makes every `{ skip: !hasIntl }` case skip,
    // and a file whose every case skipped still exits 0 -- which the runner
    // counted as a pass. Four files were passing that way.
    hasCrypto: true,
    // Node's common harness multiplies net's ordinary 250 ms default by ten
    // before networking tests run, to tolerate loaded CI hosts.
    defaultAutoSelectFamilyAttemptTimeout: 2500,
    hasIntl: typeof Intl !== "undefined",
    // These tests bind ::1, so report the host capability instead of letting
    // a missing property coerce to false and silently skip their assertions.
    hasIPv6: Object.values(networkInterfaces()).some((addresses) =>
      addresses?.some((address) => address.internal && address.family === "IPv6") ?? false),

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
      return expect(function (err, ...rest) {
        if (err) throw err;
        return fn.apply(this, rest);
      }, expected, false);
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
      return expect((...args) => {
        const [error] = args;
        assert.throws(() => {
          throw error;
        }, validator);
        return true;
      }, exact, false);
    },

    mustNotMutateObjectDeep(original) {
      return mustNotMutateObjectDeep(original);
    },

    /**
     * The same bytes, seen through every typed-array view that fits.
     *
     * Node's, verbatim in effect. Tests use it to check that a function
     * accepting "a buffer" really accepts any `ArrayBufferView` -- a
     * `Float64Array` over the same memory is the same bytes, and a function
     * that only handles `Uint8Array` will quietly read the wrong length.
     */
    getArrayBufferViews(buf) {
      const { buffer, byteOffset, byteLength } = buf;
      const views = [
        Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
        Int32Array, Uint32Array, Float32Array, Float64Array, DataView,
      ];
      const out = [];
      for (const View of views) {
        const perElement = View.BYTES_PER_ELEMENT ?? 1;
        if (byteLength % perElement === 0) {
          out.push(new View(buffer, byteOffset, byteLength / perElement));
        }
      }
      return out;
    },

    /** Every view, plus the raw `ArrayBuffer`. */
    getBufferSources(buf) {
      return [...this.getArrayBufferViews(buf), new Uint8Array(buf).buffer];
    },

    /** Node quotes for `sh -c`; the tests use it to build a shell command. */
    escapePOSIXShell(strings, ...args) {
      const env = { ...hostProcess.env };
      let command = strings[0];
      for (let i = 0; i < args.length; i++) {
        const name = `ESCAPED_${i}`;
        env[name] = args[i];
        command += '${' + name + '}' + strings[i + 1];
      }
      return [command, { env }];
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

    /** Node's warning oracle: exact name, message, code, order, and count. */
    expectWarning(nameOrMap, expected, code) {
      if (warningHandlers.size === 0) {
        process.on("warning", (warning) => {
          const handler = warningHandlers.get(warning.name);
          if (handler === undefined) {
            throw new TypeError(
              `"${warning.name}" was triggered without being expected.\n${inspect(warning)}`,
            );
          }
          handler(warning);
        });
      }

      if (typeof nameOrMap === "string") {
        warningHandlers.set(nameOrMap, expectedWarning(nameOrMap, expected, code));
        return;
      }
      for (const name of Object.keys(nameOrMap)) {
        warningHandlers.set(name, expectedWarning(name, nameOrMap[name], undefined));
      }
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
