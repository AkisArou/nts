// `node:assert`, from node v24.20.0 `lib/assert.js`.
//
// Every function here does the same two things: decide whether a condition
// holds, and -- when it does not -- build the most informative failure it can.
// The second half is the larger one, and it lives in `error.ts`.
//
// The module is a callable object: `assert(value)` is `assert.ok(value)`, with
// the rest of the family hung off it. `assert.strict` is the same set with the
// loose comparisons replaced by their strict counterparts, and `Assert` is the
// class an application instantiates when it wants those choices made
// differently -- a full diff, say, or prototypes ignored.

import { inspect } from "../../util/src/inspect.ts";
import {
  isDeepEqual,
  isDeepStrictEqual,
  isPartialStrictEqual,
} from "../../util/src/deep-equal.ts";
import { isPromise, isRegExp } from "../../util/src/types.ts";
import {
  ERR_AMBIGUOUS_ARGUMENT,
  ERR_CONSTRUCT_CALL_REQUIRED,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_RETURN_VALUE,
  ERR_MISSING_ARGS,
} from "../../internal/errors.ts";
import { validateFunction, validateOneOf } from "../../internal/validators.ts";
import { AssertionError, type DiffMode } from "./error.ts";
import { CallTracker } from "./calltracker.ts";

export { AssertionError, CallTracker };
// Re-exported for the tests that reach for node's internal spelling of them.
export { myersDiff, printMyersDiff, printSimpleMyersDiff } from "../../internal/assert/myers-diff.ts";

declare function nts_process_emit_warning(message: string, name: string, code: string): void;

/**
 * How an `Assert` instance was configured.
 *
 * A symbol rather than a private field, and read with optional chaining
 * everywhere below, because these methods are routinely destructured off an
 * instance -- `const { strictEqual } = myAssert` -- and lose their receiver. A
 * private field would throw on the way out; a missing symbol just means the
 * defaults apply, which is what a destructured method should do.
 */
const kOptions: unique symbol = Symbol("options") as never;

export interface AssertOptions {
  /** `'full'` prints the whole diff rather than collapsing unchanged runs. */
  diff?: DiffMode;
  /** When set, the loose comparisons behave like their strict counterparts. */
  strict?: boolean;
  /** When set, deep comparisons ignore prototypes. */
  skipPrototype?: boolean;
}

/** `diff` stays optional: undefined means the `AssertionError` default. */
type ResolvedOptions = AssertOptions & { strict: boolean; skipPrototype: boolean };

interface Configured {
  [kOptions]?: ResolvedOptions;
}

/** Distinguishes "the function returned" from "the function threw undefined". */
const NO_EXCEPTION_SENTINEL: object = {};

type AnyFn = (...args: never[]) => unknown;

/** What `throws` and friends accept as a description of the expected error. */
export type Expectation =
  | RegExp
  | ((err: unknown) => boolean)
  | (new (...args: never[]) => Error)
  | Record<string, unknown>
  | Error;

interface FailArgs {
  actual?: unknown;
  expected?: unknown;
  message?: string | Error | undefined;
  operator: string;
  stackStartFn: unknown;
  diff?: DiffMode | undefined;
}

/** An `Error` given as the message replaces the assertion rather than wrapping it. */
function innerFail(obj: FailArgs): never {
  if (obj.message instanceof Error) throw obj.message;
  throw new AssertionError(obj);
}

/**
 * `assert.ok`'s body, shared by the three spellings of it.
 *
 * `fn` is where the stack should start, which differs between `assert(x)`,
 * `assert.ok(x)` and `myAssert.ok(x)` -- the reader wants the line they wrote.
 */
function innerOk(fn: unknown, argLen: number, value?: unknown, message?: string | Error): void {
  if (!value) {
    let generatedMessage = false;

    if (argLen === 0) {
      generatedMessage = true;
      message = "No value argument passed to `assert.ok()`";
    } else if (message == null) {
      generatedMessage = true;
      // Node reads the failing expression out of the source here and reports
      // "The expression evaluated to a falsy value: assert.ok(x)". That needs
      // V8's structured stack positions and a JavaScript tokenizer, neither of
      // which is reachable from here; without it the generated message is the
      // ordinary `false !== true` diff, which is true but says less.
      message = undefined;
    } else if (message instanceof Error) {
      throw message;
    }

    const err = new AssertionError({
      actual: value,
      expected: true,
      message,
      operator: "==",
      stackStartFn: fn,
    });
    err.generatedMessage = generatedMessage;
    throw err;
  }
}

let failWarned = false;

/**
 * The assertion methods.
 *
 * Written as a class so the methods sit on one prototype and can be taken off
 * it by name -- which is how both the module object and `assert.strict` are
 * assembled below, and how node does it.
 */
class AssertImpl {
  declare AssertionError: typeof AssertionError;
  declare [kOptions]: ResolvedOptions;

  constructor(options?: AssertOptions) {
    const resolved: ResolvedOptions = Object.assign(
      { __proto__: null, strict: true, skipPrototype: false } as ResolvedOptions,
      options,
    );

    if (resolved.diff !== undefined) {
      validateOneOf(resolved.diff, "options.diff", ["simple", "full"]);
    }

    this.AssertionError = AssertionError;
    Object.defineProperty(this, kOptions, {
      __proto__: null,
      value: resolved,
      enumerable: false,
      configurable: false,
      writable: false,
    } as PropertyDescriptor);

    // An instance defaults to strict: the loose comparisons exist for code
    // that predates the strict ones, and new code asking for an instance is
    // not that code.
    if (resolved.strict) {
      const self = this as unknown as Record<string, unknown>;
      self["equal"] = this.strictEqual;
      self["deepEqual"] = this.deepStrictEqual;
      self["notEqual"] = this.notStrictEqual;
      self["notDeepEqual"] = this.notDeepStrictEqual;
    }
  }

  /**
   * Fail unconditionally.
   *
   * The argument handling is historical: one argument is the message, none is
   * "Failed", and more than one is the deprecated form that took an actual and
   * an expected.
   */
  fail(
    this: Configured | void,
    actual?: unknown,
    expected?: unknown,
    message?: string | Error,
    operator?: string,
    stackStartFn?: unknown,
  ): never {
    const argsLen = arguments.length;

    let internalMessage = false;
    if (actual == null && argsLen <= 1) {
      internalMessage = true;
      message = "Failed";
    } else if (argsLen === 1) {
      message = actual as string | Error;
      actual = undefined;
    } else {
      if (failWarned === false) {
        failWarned = true;
        nts_process_emit_warning(
          "assert.fail() with more than one argument is deprecated. " +
            "Please use assert.strictEqual() instead or only pass a message.",
          "DeprecationWarning",
          "DEP0094",
        );
      }
      if (argsLen === 2) {
        operator = "!=";
      }
    }

    if (message instanceof Error) throw message;

    const err = new AssertionError({
      actual,
      expected,
      operator: operator === undefined ? "fail" : operator,
      stackStartFn: stackStartFn || AssertImpl.prototype.fail,
      message,
      diff: this?.[kOptions]?.diff,
    });
    if (internalMessage) {
      err.generatedMessage = true;
    }
    throw err;
  }

  /** Truthiness, as `!!value` decides it. */
  ok(this: Configured | void, ...args: unknown[]): void {
    innerOk(AssertImpl.prototype.ok, args.length, args[0], args[1] as string | Error);
  }

  /** Shallow coercive equality, `==`, with `NaN` equal to itself. */
  equal(this: Configured | void, actual: unknown, expected: unknown, message?: string | Error): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    // eslint-disable-next-line eqeqeq
    if (actual != expected && (!Number.isNaN(actual) || !Number.isNaN(expected))) {
      innerFail({
        actual, expected, message,
        operator: "==",
        stackStartFn: AssertImpl.prototype.equal,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  notEqual(this: Configured | void, actual: unknown, expected: unknown, message?: string | Error): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    // eslint-disable-next-line eqeqeq
    if (actual == expected || (Number.isNaN(actual) && Number.isNaN(expected))) {
      innerFail({
        actual, expected, message,
        operator: "!=",
        stackStartFn: AssertImpl.prototype.notEqual,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  deepEqual(this: Configured | void, actual: unknown, expected: unknown, message?: string | Error): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    if (!isDeepEqual(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "deepEqual",
        stackStartFn: AssertImpl.prototype.deepEqual,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  notDeepEqual(this: Configured | void, actual: unknown, expected: unknown, message?: string | Error): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    if (isDeepEqual(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "notDeepEqual",
        stackStartFn: AssertImpl.prototype.notDeepEqual,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  deepStrictEqual(this: Configured | void, actual: unknown, expected: unknown, message?: string | Error): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    if (!isDeepStrictEqual(actual, expected, this?.[kOptions]?.skipPrototype)) {
      innerFail({
        actual, expected, message,
        operator: "deepStrictEqual",
        stackStartFn: AssertImpl.prototype.deepStrictEqual,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  notDeepStrictEqual(this: Configured | void, actual: unknown, expected: unknown, message?: string | Error): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    if (isDeepStrictEqual(actual, expected, this?.[kOptions]?.skipPrototype)) {
      innerFail({
        actual, expected, message,
        operator: "notDeepStrictEqual",
        stackStartFn: AssertImpl.prototype.notDeepStrictEqual,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  /** `Object.is`, so `NaN` equals itself and `0` does not equal `-0`. */
  strictEqual(this: Configured | void, actual: unknown, expected: unknown, message?: string | Error): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    if (!Object.is(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "strictEqual",
        stackStartFn: AssertImpl.prototype.strictEqual,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  notStrictEqual(this: Configured | void, actual: unknown, expected: unknown, message?: string | Error): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    if (Object.is(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "notStrictEqual",
        stackStartFn: AssertImpl.prototype.notStrictEqual,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  /** Every key in `expected` matches; keys `actual` has beyond them are ignored. */
  partialDeepStrictEqual(
    this: Configured | void,
    actual: unknown,
    expected: unknown,
    message?: string | Error,
  ): void {
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("actual", "expected");
    }
    if (!isPartialStrictEqual(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "partialDeepStrictEqual",
        stackStartFn: AssertImpl.prototype.partialDeepStrictEqual,
        diff: this?.[kOptions]?.diff,
      });
    }
  }

  throws(this: Configured | void, promiseFn: AnyFn, ...args: unknown[]): void {
    expectsError.call(
      this, AssertImpl.prototype.throws, getActual(promiseFn),
      args[0] as Expectation | string | undefined, args[1] as string | undefined,
      args.length,
    );
  }

  async rejects(this: Configured | void, promiseFn: AnyFn | Promise<unknown>, ...args: unknown[]): Promise<void> {
    expectsError.call(
      this, AssertImpl.prototype.rejects, await waitForActual(promiseFn),
      args[0] as Expectation | string | undefined, args[1] as string | undefined,
      args.length,
    );
  }

  doesNotThrow(this: Configured | void, fn: AnyFn, ...args: unknown[]): void {
    expectsNoError.call(
      this, AssertImpl.prototype.doesNotThrow, getActual(fn),
      args[0] as Expectation | string | undefined, args[1] as string | undefined,
    );
  }

  async doesNotReject(this: Configured | void, fn: AnyFn | Promise<unknown>, ...args: unknown[]): Promise<void> {
    expectsNoError.call(
      this, AssertImpl.prototype.doesNotReject, await waitForActual(fn),
      args[0] as Expectation | string | undefined, args[1] as string | undefined,
    );
  }

  /**
   * Fail if `err` is anything but `null` or `undefined`.
   *
   * The stack is spliced: the frames from inside `ifError` are replaced by the
   * original error's, so the reader is pointed at where the error came from
   * rather than at the line that checked for it.
   */
  ifError(this: Configured | void, err: unknown): void {
    if (err !== null && err !== undefined) {
      let message = "ifError got unwanted exception: ";
      if (typeof err === "object" && typeof (err as Error).message === "string") {
        if ((err as Error).message.length === 0 && (err as object).constructor) {
          message += (err as object).constructor.name;
        } else {
          message += (err as Error).message;
        }
      } else {
        message += inspect(err);
      }

      const newErr = new AssertionError({
        actual: err,
        expected: null,
        operator: "ifError",
        message,
        stackStartFn: AssertImpl.prototype.ifError,
        diff: this?.[kOptions]?.diff,
      });

      const origStack = (err as Error).stack;

      if (typeof origStack === "string") {
        const origStackStart = origStack.indexOf("\n    at");
        if (origStackStart !== -1) {
          const originalFrames = origStack.slice(origStackStart + 1).split("\n");
          // Drop the frames the two stacks have in common, so the result reads
          // as one trace rather than two overlapping ones.
          let newFrames = (newErr.stack ?? "").split("\n");
          for (const errFrame of originalFrames) {
            const pos = newFrames.indexOf(errFrame);
            if (pos !== -1) {
              newFrames = newFrames.slice(0, pos);
              break;
            }
          }
          newErr.stack = `${newFrames.join("\n")}\n${originalFrames.join("\n")}`;
        }
      }

      throw newErr;
    }
  }

  match(this: Configured | void, string: string, regexp: RegExp, message?: string | Error): void {
    internalMatch.call(this, string, regexp, message, AssertImpl.prototype.match, true);
  }

  doesNotMatch(this: Configured | void, string: string, regexp: RegExp, message?: string | Error): void {
    internalMatch.call(this, string, regexp, message, AssertImpl.prototype.doesNotMatch, false);
  }
}

/**
 * A stand-in built from the keys a failed comparison looked at.
 *
 * Comparing two errors by a handful of properties would otherwise print both
 * errors in full, stacks included. These carry only the keys under
 * examination, so the diff shows what was compared and nothing else.
 */
function comparisonOf(
  obj: Record<PropertyKey, unknown>,
  keys: readonly string[],
  actual?: Record<PropertyKey, unknown>,
): object {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) {
      // A regular expression that matched is shown as the string it matched:
      // printing the pattern beside the value it accepted reads as a mismatch.
      if (
        actual !== undefined &&
        typeof actual[key] === "string" &&
        isRegExp(obj[key]) &&
        (obj[key] as RegExp).exec(actual[key] as string) !== null
      ) {
        out[key] = actual[key];
      } else {
        out[key] = obj[key];
      }
    }
  }
  return out;
}

function compareExceptionKey(
  this: Configured | void,
  actual: Record<PropertyKey, unknown>,
  expected: Record<PropertyKey, unknown>,
  key: string,
  message: string | Error | undefined,
  keys: readonly string[],
  fn: { name: string },
): void {
  if (!(key in actual) || !isDeepStrictEqual(actual[key], expected[key])) {
    if (!message) {
      const err = new AssertionError({
        actual: comparisonOf(actual, keys),
        expected: comparisonOf(expected, keys, actual),
        operator: "deepStrictEqual",
        stackStartFn: fn,
        diff: this?.[kOptions]?.diff,
      });
      // The diff was built from the stand-ins; the properties report the real
      // values, because that is what a caller inspecting the error wants.
      err.actual = actual;
      err.expected = expected;
      err.operator = fn.name;
      throw err;
    }
    innerFail({
      actual, expected, message,
      operator: fn.name,
      stackStartFn: fn,
      diff: this?.[kOptions]?.diff,
    });
  }
}

/**
 * Does the thrown `actual` satisfy `expected`?
 *
 * `expected` may be a regular expression matched against the error's string
 * form, an error class, a validation function, or an object of properties to
 * compare -- and each of the four fails with its own wording.
 */
function expectedException(
  this: Configured | void,
  actual: unknown,
  expected: Expectation,
  message: string | Error | undefined,
  fn: { name: string },
): void {
  let generatedMessage = false;
  let throwError = false;

  if (typeof expected !== "function") {
    if (isRegExp(expected)) {
      const str = String(actual);
      if ((expected as RegExp).exec(str) !== null) {
        return;
      }

      if (!message) {
        generatedMessage = true;
        message = "The input did not match the regular expression " +
          `${inspect(expected)}. Input:\n\n${inspect(str)}\n`;
      }
      throwError = true;
    } else if (typeof actual !== "object" || actual === null) {
      // A primitive was thrown and an object was expected: there are no keys
      // to compare, so report it as a plain inequality.
      const err = new AssertionError({
        actual, expected, message,
        operator: "deepStrictEqual",
        stackStartFn: fn,
        diff: this?.[kOptions]?.diff,
      });
      err.operator = fn.name;
      throw err;
    } else {
      const keys = Object.keys(expected as object);
      // `name` and `message` are not enumerable on an error, and they are the
      // two a caller most means to compare.
      if (expected instanceof Error) {
        keys.push("name", "message");
      } else if (keys.length === 0) {
        throw new ERR_INVALID_ARG_VALUE("error", expected, "may not be an empty object");
      }
      for (const key of keys) {
        const actualValue = (actual as Record<string, unknown>)[key];
        const expectedValue = (expected as Record<string, unknown>)[key];
        if (
          typeof actualValue === "string" &&
          isRegExp(expectedValue) &&
          (expectedValue as RegExp).exec(actualValue) !== null
        ) {
          continue;
        }
        compareExceptionKey.call(
          this,
          actual as Record<PropertyKey, unknown>,
          expected as Record<PropertyKey, unknown>,
          key, message, keys, fn,
        );
      }
      return;
    }
    // An arrow function has no prototype, so `instanceof` would throw: guard
    // before asking.
  } else if (
    (expected as { prototype?: unknown }).prototype !== undefined &&
    actual instanceof (expected as new () => unknown)
  ) {
    return;
  } else if (Object.prototype.isPrototypeOf.call(Error, expected)) {
    if (!message) {
      generatedMessage = true;
      message = "The error is expected to be an instance of " +
        `"${(expected as { name: string }).name}". Received `;
      if (actual instanceof Error) {
        const name = actual.constructor?.name || actual.name;
        if ((expected as { name: string }).name === name) {
          message += "an error with identical name but a different prototype.";
        } else {
          message += `"${name}"`;
        }
        if (actual.message) {
          message += `\n\nError message:\n\n${actual.message}`;
        }
      } else {
        message += `"${inspect(actual, { depth: -1 })}"`;
      }
    }
    throwError = true;
  } else {
    // A validation function: anything but `true` is a failure, so that a
    // function which forgets to return does not silently pass.
    const res = (expected as (err: unknown) => unknown).call({}, actual);
    if (res !== true) {
      if (!message) {
        generatedMessage = true;
        const name = (expected as { name?: string }).name
          ? `"${(expected as { name: string }).name}" `
          : "";
        message = `The ${name}validation function is expected to return` +
          ` "true". Received ${inspect(res)}`;

        if (actual instanceof Error) {
          message += `\n\nCaught error:\n\n${actual}`;
        }
      }
      throwError = true;
    }
  }

  if (throwError) {
    const err = new AssertionError({
      actual, expected, message,
      operator: fn.name,
      stackStartFn: fn,
      diff: this?.[kOptions]?.diff,
    });
    err.generatedMessage = generatedMessage;
    throw err;
  }
}

function getActual(fn: AnyFn): unknown {
  validateFunction(fn, "fn");
  try {
    (fn as () => unknown)();
  } catch (e) {
    return e;
  }
  return NO_EXCEPTION_SENTINEL;
}

/**
 * A native promise, or something close enough to be awaited safely.
 *
 * A thenable without a `catch` is not accepted: awaiting it could hand control
 * to code that never gives it back, and the assertion would hang rather than
 * fail.
 */
function checkIsPromise(obj: unknown): boolean {
  return isPromise(obj) ||
    (obj !== null && typeof obj === "object" &&
      typeof (obj as { then?: unknown }).then === "function" &&
      typeof (obj as { catch?: unknown }).catch === "function");
}

async function waitForActual(promiseFn: AnyFn | Promise<unknown>): Promise<unknown> {
  let resultPromise: unknown;
  if (typeof promiseFn === "function") {
    resultPromise = (promiseFn as () => unknown)();
    if (!checkIsPromise(resultPromise)) {
      throw new ERR_INVALID_RETURN_VALUE("instance of Promise", "promiseFn", resultPromise);
    }
  } else if (checkIsPromise(promiseFn)) {
    resultPromise = promiseFn;
  } else {
    throw new ERR_INVALID_ARG_TYPE("promiseFn", ["Function", "Promise"], promiseFn);
  }

  try {
    await resultPromise;
  } catch (e) {
    return e;
  }
  return NO_EXCEPTION_SENTINEL;
}

function expectsError(
  this: Configured | void,
  stackStartFn: { name: string },
  actual: unknown,
  error?: Expectation | string,
  message?: string,
  argCount = 0,
): void {
  if (typeof error === "string") {
    if (argCount === 2) {
      throw new ERR_INVALID_ARG_TYPE("error", ["Object", "Error", "Function", "RegExp"], error);
    }
    // A message that happens to equal the error's own message is almost
    // certainly a caller who meant it as the expectation, and the assertion
    // would then pass without checking anything.
    if (typeof actual === "object" && actual !== null) {
      if ((actual as Error).message === error) {
        throw new ERR_AMBIGUOUS_ARGUMENT(
          "error/message",
          `The error message "${(actual as Error).message}" is identical to the message.`,
        );
      }
    } else if (actual === error) {
      throw new ERR_AMBIGUOUS_ARGUMENT(
        "error/message",
        `The error "${actual}" is identical to the message.`,
      );
    }
    message = error;
    error = undefined;
  } else if (error != null && typeof error !== "object" && typeof error !== "function") {
    throw new ERR_INVALID_ARG_TYPE("error", ["Object", "Error", "Function", "RegExp"], error);
  }

  if (actual === NO_EXCEPTION_SENTINEL) {
    let details = "";
    if ((error as { name?: string })?.name) {
      details += ` (${(error as { name: string }).name})`;
    }
    details += message ? `: ${message}` : ".";
    const fnType = stackStartFn === AssertImpl.prototype.rejects ? "rejection" : "exception";
    innerFail({
      actual: undefined,
      expected: error,
      operator: stackStartFn.name,
      message: `Missing expected ${fnType}${details}`,
      stackStartFn,
      diff: this?.[kOptions]?.diff,
    });
  }

  if (!error) return;

  expectedException.call(this, actual, error, message, stackStartFn);
}

function hasMatchingError(actual: unknown, expected: Expectation): boolean {
  if (typeof expected !== "function") {
    if (isRegExp(expected)) {
      return (expected as RegExp).exec(String(actual)) !== null;
    }
    throw new ERR_INVALID_ARG_TYPE("expected", ["Function", "RegExp"], expected);
  }
  if (
    (expected as { prototype?: unknown }).prototype !== undefined &&
    actual instanceof (expected as new () => unknown)
  ) {
    return true;
  }
  // An error *class* that did not match above is simply not the one thrown;
  // calling it as a validation function would construct an error instead.
  if (Object.prototype.isPrototypeOf.call(Error, expected)) {
    return false;
  }
  return (expected as (err: unknown) => unknown).call({}, actual) === true;
}

function expectsNoError(
  this: Configured | void,
  stackStartFn: { name: string },
  actual: unknown,
  error?: Expectation | string,
  message?: string,
): void {
  if (actual === NO_EXCEPTION_SENTINEL) return;

  if (typeof error === "string") {
    message = error;
    error = undefined;
  }

  if (!error || hasMatchingError(actual, error)) {
    const details = message ? `: ${message}` : ".";
    const fnType = stackStartFn === AssertImpl.prototype.doesNotReject ? "rejection" : "exception";
    innerFail({
      actual,
      expected: error,
      operator: stackStartFn.name,
      message: `Got unwanted ${fnType}${details}\n` +
        `Actual message: "${(actual as Error)?.message}"`,
      stackStartFn,
      diff: this?.[kOptions]?.diff,
    });
  }
  // An error that was thrown and was not the unwanted one still happened, and
  // swallowing it here would hide a real failure.
  throw actual;
}

function internalMatch(
  this: Configured | void,
  string: string,
  regexp: RegExp,
  message: string | Error | undefined,
  fn: { name: string },
  shouldMatch: boolean,
): void {
  if (!isRegExp(regexp)) {
    throw new ERR_INVALID_ARG_TYPE("regexp", "RegExp", regexp);
  }
  if (typeof string !== "string" || ((regexp.exec(string) !== null) !== shouldMatch)) {
    if (message instanceof Error) {
      throw message;
    }

    const generatedMessage = !message;

    message ||= typeof string !== "string"
      ? 'The "string" argument must be of type string. Received type ' +
        `${typeof string} (${inspect(string)})`
      : `${shouldMatch
        ? "The input did not match the regular expression "
        : "The input was expected to not match the regular expression "
      }${inspect(regexp)}. Input:\n\n${inspect(string)}\n`;
    const err = new AssertionError({
      actual: string,
      expected: regexp,
      message,
      operator: fn.name,
      stackStartFn: fn,
      diff: this?.[kOptions]?.diff,
    });
    err.generatedMessage = generatedMessage;
    throw err;
  }
}

/**
 * `Assert` throws when called without `new`, so it cannot be the class itself:
 * a class constructor called as a function throws a `TypeError` with no code,
 * and the code is what a caller branches on.
 */
export interface AssertConstructor {
  new (options?: AssertOptions): AssertImpl;
  readonly prototype: AssertImpl;
}

const Assert = function Assert(this: unknown, options?: AssertOptions): AssertImpl {
  if (new.target === undefined) {
    throw new ERR_CONSTRUCT_CALL_REQUIRED("Assert");
  }
  return Reflect.construct(AssertImpl, [options], new.target) as AssertImpl;
} as unknown as AssertConstructor;

Object.defineProperty(Assert, "name", { __proto__: null, value: "Assert" } as PropertyDescriptor);
(Assert as { prototype: AssertImpl }).prototype = AssertImpl.prototype;
Object.setPrototypeOf(Assert, AssertImpl);

export { Assert };

// The module surface. Each is `Assert.prototype`'s method, unbound, exactly as
// node exports it: `const { strictEqual } = require('assert')` has to keep
// working, and these read their configuration through optional chaining so a
// missing receiver means the defaults.
export const fail = AssertImpl.prototype.fail;
export const ok = AssertImpl.prototype.ok;
export const equal = AssertImpl.prototype.equal;
export const notEqual = AssertImpl.prototype.notEqual;
export const deepEqual = AssertImpl.prototype.deepEqual;
export const notDeepEqual = AssertImpl.prototype.notDeepEqual;
export const deepStrictEqual = AssertImpl.prototype.deepStrictEqual;
export const notDeepStrictEqual = AssertImpl.prototype.notDeepStrictEqual;
export const strictEqual = AssertImpl.prototype.strictEqual;
export const notStrictEqual = AssertImpl.prototype.notStrictEqual;
export const partialDeepStrictEqual = AssertImpl.prototype.partialDeepStrictEqual;
export const match = AssertImpl.prototype.match;
export const doesNotMatch = AssertImpl.prototype.doesNotMatch;
export const throws = AssertImpl.prototype.throws;
export const rejects = AssertImpl.prototype.rejects;
export const doesNotThrow = AssertImpl.prototype.doesNotThrow;
export const doesNotReject = AssertImpl.prototype.doesNotReject;
export const ifError = AssertImpl.prototype.ifError;
