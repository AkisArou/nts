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
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_RETURN_VALUE,
  ERR_MISSING_ARGS,
} from "../../internal/errors.ts";
import { validateFunction, validateOneOf } from "../../internal/validators.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import { AssertionError, type DiffMode } from "./error.ts";
import { CallTracker } from "./calltracker.ts";

export { AssertionError, CallTracker };
// Re-exported for the tests that reach for node's internal spelling of them.
export { myersDiff, printMyersDiff, printSimpleMyersDiff } from "../../internal/assert/myers-diff.ts";

export interface AssertOptions {
  /** `'full'` prints the whole diff rather than collapsing unchanged runs. */
  diff?: DiffMode;
  /** When set, the loose comparisons behave like their strict counterparts. */
  strict?: boolean;
  /** When set, deep comparisons ignore prototypes. */
  skipPrototype?: boolean;
}

/** Fully resolved construction state; `diff` stays absent to select the default. */
interface ResolvedOptions {
  readonly diff?: DiffMode;
  readonly strict: boolean;
  readonly skipPrototype: boolean;
}

type Comparison = (
  this: Assert | void,
  actual: unknown,
  expected: unknown,
  message?: string | Error,
) => void;

/** Distinguishes "the function returned" from "the function threw undefined". */
const NO_EXCEPTION_SENTINEL: object = {};

type AnyFn = () => unknown;

type Awaitable = PromiseLike<unknown>;

type ExceptionArguments = [
  error?: Expectation | string,
  message?: string,
];

type ComparisonArguments = [
  actual: unknown,
  expected: unknown,
  message?: string | Error,
];

type FailArguments = [
  actual?: unknown,
  expected?: unknown,
  message?: string | Error,
  operator?: string,
  stackStartFn?: CallableFunction,
];

/** What `throws` and friends accept as a description of the expected error. */
export type SupportedErrorConstructor =
  | ErrorConstructor
  | TypeErrorConstructor
  | RangeErrorConstructor
  | ReferenceErrorConstructor
  | SyntaxErrorConstructor
  | URIErrorConstructor
  | EvalErrorConstructor
  | AggregateErrorConstructor
  | typeof AssertionError;

/**
 * The statically known fields accepted by an object expectation.
 *
 * Node's JavaScript implementation accepts an arbitrary property bag and
 * discovers its keys at run time. NTS objects have a closed layout instead,
 * so the compiled API names the error fields applications can portably ask
 * about. Values remain structural: strings may be matched by a RegExp and all
 * other values use strict deep equality.
 */
export interface ErrorExpectation {
  readonly name?: string | RegExp;
  readonly message?: string | RegExp;
  readonly code?: string | number | RegExp;
  readonly cause?: unknown;
  readonly errno?: string | number;
  readonly syscall?: string | RegExp;
  readonly path?: string | RegExp;
  readonly dest?: string | RegExp;
  readonly address?: string | RegExp;
  readonly port?: number;
  readonly host?: string | RegExp;
  readonly hostname?: string | RegExp;
  readonly status?: number;
  readonly statusCode?: number;
  readonly signal?: string | RegExp;
  readonly errors?: readonly unknown[];
  readonly actual?: unknown;
  readonly expected?: unknown;
  readonly operator?: string | RegExp;
  readonly generatedMessage?: boolean;
  readonly diff?: DiffMode;
  readonly details?: readonly unknown[];
  readonly stack?: string | RegExp;
}

export type Expectation =
  | RegExp
  | ((err: unknown) => boolean)
  | SupportedErrorConstructor
  | ErrorExpectation
  | Error;

interface ErrorField {
  readonly present: boolean;
  readonly value?: unknown;
}

const MISSING_ERROR_FIELD: ErrorField = { present: false };

function readErrorField(value: object, key: string): ErrorField {
  switch (key) {
    case "name":
      return "name" in value
        ? { present: true, value: value.name }
        : MISSING_ERROR_FIELD;
    case "message":
      return "message" in value
        ? { present: true, value: value.message }
        : MISSING_ERROR_FIELD;
    case "code":
      return "code" in value
        ? { present: true, value: value.code }
        : MISSING_ERROR_FIELD;
    case "cause":
      return "cause" in value
        ? { present: true, value: value.cause }
        : MISSING_ERROR_FIELD;
    case "errno":
      return "errno" in value
        ? { present: true, value: value.errno }
        : MISSING_ERROR_FIELD;
    case "syscall":
      return "syscall" in value
        ? { present: true, value: value.syscall }
        : MISSING_ERROR_FIELD;
    case "path":
      return "path" in value
        ? { present: true, value: value.path }
        : MISSING_ERROR_FIELD;
    case "dest":
      return "dest" in value
        ? { present: true, value: value.dest }
        : MISSING_ERROR_FIELD;
    case "address":
      return "address" in value
        ? { present: true, value: value.address }
        : MISSING_ERROR_FIELD;
    case "port":
      return "port" in value
        ? { present: true, value: value.port }
        : MISSING_ERROR_FIELD;
    case "host":
      return "host" in value
        ? { present: true, value: value.host }
        : MISSING_ERROR_FIELD;
    case "hostname":
      return "hostname" in value
        ? { present: true, value: value.hostname }
        : MISSING_ERROR_FIELD;
    case "status":
      return "status" in value
        ? { present: true, value: value.status }
        : MISSING_ERROR_FIELD;
    case "statusCode":
      return "statusCode" in value
        ? { present: true, value: value.statusCode }
        : MISSING_ERROR_FIELD;
    case "signal":
      return "signal" in value
        ? { present: true, value: value.signal }
        : MISSING_ERROR_FIELD;
    case "errors":
      return "errors" in value
        ? { present: true, value: value.errors }
        : MISSING_ERROR_FIELD;
    case "actual":
      return "actual" in value
        ? { present: true, value: value.actual }
        : MISSING_ERROR_FIELD;
    case "expected":
      return "expected" in value
        ? { present: true, value: value.expected }
        : MISSING_ERROR_FIELD;
    case "operator":
      return "operator" in value
        ? { present: true, value: value.operator }
        : MISSING_ERROR_FIELD;
    case "generatedMessage":
      return "generatedMessage" in value
        ? { present: true, value: value.generatedMessage }
        : MISSING_ERROR_FIELD;
    case "diff":
      return "diff" in value
        ? { present: true, value: value.diff }
        : MISSING_ERROR_FIELD;
    case "details":
      return "details" in value
        ? { present: true, value: value.details }
        : MISSING_ERROR_FIELD;
    case "stack":
      return "stack" in value
        ? { present: true, value: value.stack }
        : MISSING_ERROR_FIELD;
    default:
      return MISSING_ERROR_FIELD;
  }
}

interface MessageLike {
  readonly message: string;
}

function hasStringMessage(value: unknown): value is MessageLike {
  return value !== null && typeof value === "object" &&
    "message" in value && typeof value.message === "string";
}

interface StackLike {
  readonly stack: string;
}

function hasStringStack(value: unknown): value is StackLike {
  return value !== null && typeof value === "object" &&
    "stack" in value && typeof value.stack === "string";
}

function failureMessage(value: unknown): string | Error {
  if (value instanceof Error) return value;
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "bigint":
    case "boolean":
    case "symbol":
    case "undefined":
      return String(value);
    default:
      return inspect(value);
  }
}

function isSupportedErrorConstructor(value: unknown): value is SupportedErrorConstructor {
  return value === Error ||
    value === TypeError ||
    value === RangeError ||
    value === ReferenceError ||
    value === SyntaxError ||
    value === URIError ||
    value === EvalError ||
    value === AggregateError ||
    value === AssertionError;
}

function supportedErrorName(expected: SupportedErrorConstructor): string {
  if (expected === TypeError) return "TypeError";
  if (expected === RangeError) return "RangeError";
  if (expected === ReferenceError) return "ReferenceError";
  if (expected === SyntaxError) return "SyntaxError";
  if (expected === URIError) return "URIError";
  if (expected === EvalError) return "EvalError";
  if (expected === AggregateError) return "AggregateError";
  if (expected === AssertionError) return "AssertionError";
  return "Error";
}

function isInstanceOfSupportedError(
  actual: unknown,
  expected: SupportedErrorConstructor,
): boolean {
  if (expected === TypeError) return actual instanceof TypeError;
  if (expected === RangeError) return actual instanceof RangeError;
  if (expected === ReferenceError) return actual instanceof ReferenceError;
  if (expected === SyntaxError) return actual instanceof SyntaxError;
  if (expected === URIError) return actual instanceof URIError;
  if (expected === EvalError) return actual instanceof EvalError;
  if (expected === AggregateError) return actual instanceof AggregateError;
  if (expected === AssertionError) return actual instanceof AssertionError;
  return actual instanceof Error;
}

interface FailArgs {
  actual?: unknown;
  expected?: unknown;
  message?: string | Error | undefined;
  operator: string;
  stackStartFn?: CallableFunction;
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
function innerOk(
  argLen: number,
  value?: unknown,
  message?: string | Error,
): void {
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
export class Assert {
  declare AssertionError: typeof AssertionError;
  readonly #options: ResolvedOptions;
  readonly equal: Comparison;
  readonly notEqual: Comparison;
  readonly deepEqual: Comparison;
  readonly notDeepEqual: Comparison;

  constructor(options?: AssertOptions) {
    const resolved: ResolvedOptions = {
      diff: options?.diff,
      strict: options?.strict ?? true,
      skipPrototype: options?.skipPrototype ?? false,
    };

    if (resolved.diff !== undefined) {
      validateOneOf(resolved.diff, "options.diff", ["simple", "full"]);
    }

    this.AssertionError = AssertionError;
    this.#options = resolved;
    // Node's strict mode aliases the four legacy loose comparisons to their
    // strict counterparts. Store typed function references once: destructuring
    // preserves the selection without a Proxy, rebinding, or a closure.
    this.equal = resolved.strict ? this.strictEqual : this.looseEqual;
    this.notEqual = resolved.strict ? this.notStrictEqual : this.looseNotEqual;
    this.deepEqual = resolved.strict ? this.deepStrictEqual : this.looseDeepEqual;
    this.notDeepEqual = resolved.strict
      ? this.notDeepStrictEqual
      : this.looseNotDeepEqual;
  }

  /**
   * Fail unconditionally.
   *
   * The argument handling is historical: one argument is the message, none is
   * "Failed", and more than one is the deprecated form that took an actual and
   * an expected.
   */
  fail(
    this: Assert | void,
    ...args: FailArguments
  ): never {
    const argsLen = args.length;
    let actual = args[0];
    const expected = args[1];
    let message = args[2];
    let operator = args[3];
    const stackStartFn = args[4];

    let internalMessage = false;
    if (actual == null && argsLen <= 1) {
      internalMessage = true;
      message = "Failed";
    } else if (argsLen === 1) {
      message = failureMessage(actual);
      actual = undefined;
    } else {
      if (failWarned === false) {
        failWarned = true;
        emitWarning(
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
      stackStartFn,
      message,
      diff: this instanceof Assert ? this.#options.diff : undefined,
    });
    if (internalMessage) {
      err.generatedMessage = true;
    }
    throw err;
  }

  /** Truthiness, as `!!value` decides it. */
  ok(this: Assert | void, ...args: unknown[]): void {
    const message = args[1];
    innerOk(
      args.length,
      args[0],
      typeof message === "string" || message instanceof Error ? message : undefined,
    );
  }

  /** Shallow coercive equality, `==`, with `NaN` equal to itself. */
  private looseEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    if (actual != expected && (!Number.isNaN(actual) || !Number.isNaN(expected))) {
      innerFail({
        actual, expected, message,
        operator: "==",
        diff: this instanceof Assert ? this.#options.diff : undefined,
      });
    }
  }

  private looseNotEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    if (actual == expected || (Number.isNaN(actual) && Number.isNaN(expected))) {
      innerFail({
        actual, expected, message,
        operator: "!=",
        diff: this instanceof Assert ? this.#options.diff : undefined,
      });
    }
  }

  private looseDeepEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    if (!isDeepEqual(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "deepEqual",
        diff: this instanceof Assert ? this.#options.diff : undefined,
      });
    }
  }

  private looseNotDeepEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    if (isDeepEqual(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "notDeepEqual",
        diff: this instanceof Assert ? this.#options.diff : undefined,
      });
    }
  }

  deepStrictEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    const options = this instanceof Assert ? this.#options : undefined;
    if (!isDeepStrictEqual(actual, expected, options?.skipPrototype)) {
      innerFail({
        actual, expected, message,
        operator: "deepStrictEqual",
        diff: options?.diff,
      });
    }
  }

  notDeepStrictEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    const options = this instanceof Assert ? this.#options : undefined;
    if (isDeepStrictEqual(actual, expected, options?.skipPrototype)) {
      innerFail({
        actual, expected, message,
        operator: "notDeepStrictEqual",
        diff: options?.diff,
      });
    }
  }

  /** `Object.is`, so `NaN` equals itself and `0` does not equal `-0`. */
  strictEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    if (!Object.is(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "strictEqual",
        diff: this instanceof Assert ? this.#options.diff : undefined,
      });
    }
  }

  notStrictEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    if (Object.is(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "notStrictEqual",
        diff: this instanceof Assert ? this.#options.diff : undefined,
      });
    }
  }

  /** Every key in `expected` matches; keys `actual` has beyond them are ignored. */
  partialDeepStrictEqual(
    this: Assert | void,
    ...args: ComparisonArguments
  ): void {
    if (args.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
    const actual = args[0];
    const expected = args[1];
    const message = args[2];
    if (!isPartialStrictEqual(actual, expected)) {
      innerFail({
        actual, expected, message,
        operator: "partialDeepStrictEqual",
        diff: this instanceof Assert ? this.#options.diff : undefined,
      });
    }
  }

  throws(this: Assert | void, promiseFn: AnyFn, ...args: ExceptionArguments): void {
    expectsError(
      this instanceof Assert ? this.#options : undefined,
      "throws",
      "exception",
      getActual(promiseFn),
      args[0],
      args[1],
      args.length,
    );
  }

  async rejects(
    this: Assert | void,
    promiseFn: AnyFn | Awaitable,
    ...args: ExceptionArguments
  ): Promise<void> {
    expectsError(
      this instanceof Assert ? this.#options : undefined,
      "rejects",
      "rejection",
      await waitForActual(promiseFn),
      args[0],
      args[1],
      args.length,
    );
  }

  doesNotThrow(this: Assert | void, fn: AnyFn, ...args: ExceptionArguments): void {
    expectsNoError(
      this instanceof Assert ? this.#options : undefined,
      "doesNotThrow",
      "exception",
      getActual(fn),
      args[0],
      args[1],
    );
  }

  async doesNotReject(
    this: Assert | void,
    fn: AnyFn | Awaitable,
    ...args: ExceptionArguments
  ): Promise<void> {
    expectsNoError(
      this instanceof Assert ? this.#options : undefined,
      "doesNotReject",
      "rejection",
      await waitForActual(fn),
      args[0],
      args[1],
    );
  }

  /**
   * Fail if `err` is anything but `null` or `undefined`.
   *
   * The stack is spliced: the frames from inside `ifError` are replaced by the
   * original error's, so the reader is pointed at where the error came from
   * rather than at the line that checked for it.
   */
  ifError(this: Assert | void, err: unknown): void {
    if (err !== null && err !== undefined) {
      let message = "ifError got unwanted exception: ";
      if (hasStringMessage(err)) {
        if (err.message.length === 0 && err instanceof Error) {
          message += err.name;
        } else {
          message += err.message;
        }
      } else {
        message += inspect(err);
      }

      const newErr = new AssertionError({
        actual: err,
        expected: null,
        operator: "ifError",
        message,
        diff: this instanceof Assert ? this.#options.diff : undefined,
      });

      const origStack = hasStringStack(err) ? err.stack : undefined;

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

  match(this: Assert | void, string: string, regexp: RegExp, message?: string | Error): void {
    internalMatch(
      this instanceof Assert ? this.#options : undefined,
      string,
      regexp,
      message,
      "match",
      true,
    );
  }

  doesNotMatch(this: Assert | void, string: string, regexp: RegExp, message?: string | Error): void {
    internalMatch(
      this instanceof Assert ? this.#options : undefined,
      string,
      regexp,
      message,
      "doesNotMatch",
      false,
    );
  }
}

function exceptionValuesMatch(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && isRegExp(expected)) {
    return expected.exec(actual) !== null;
  }
  return isDeepStrictEqual(actual, expected);
}

function compareExceptionField(
  options: ResolvedOptions | undefined,
  actual: object,
  expected: object,
  key: string,
  expectedValue: unknown,
  message: string | Error | undefined,
  operation: string,
): void {
  const actualField = readErrorField(actual, key);
  if (!actualField.present || !exceptionValuesMatch(actualField.value, expectedValue)) {
    if (!message) {
      const err = new AssertionError({
        actual,
        expected,
        operator: "deepStrictEqual",
        diff: options?.diff,
      });
      err.operator = operation;
      throw err;
    }
    innerFail({
      actual, expected, message,
      operator: operation,
      diff: options?.diff,
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
  options: ResolvedOptions | undefined,
  actual: unknown,
  expected: Expectation,
  message: string | Error | undefined,
  operation: string,
): void {
  let generatedMessage = false;
  let throwError = false;

  if (typeof expected !== "function") {
    if (isRegExp(expected)) {
      const str = String(actual);
      if (expected.exec(str) !== null) {
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
        diff: options?.diff,
      });
      err.operator = operation;
      throw err;
    } else {
      // `name` and `message` are not enumerable on an Error, but are the two
      // fields an Error expectation always means to compare.
      if (expected instanceof Error) {
        compareExceptionField(
          options, actual, expected, "name", expected.name, message, operation,
        );
        compareExceptionField(
          options, actual, expected, "message", expected.message, message, operation,
        );
      }

      const keys = Object.keys(expected);
      if (!(expected instanceof Error) && keys.length === 0) {
        throw new ERR_INVALID_ARG_VALUE("error", expected, "may not be an empty object");
      }

      for (const key of keys) {
        // Already compared above even if a subclass chose to make either
        // property enumerable.
        if (expected instanceof Error && (key === "name" || key === "message")) {
          continue;
        }
        const expectedField = readErrorField(expected, key);
        if (!expectedField.present) {
          throw new ERR_INVALID_ARG_VALUE(
            "error",
            expected,
            `contains unsupported property ${inspect(key)}`,
          );
        }
        compareExceptionField(
          options,
          actual,
          expected,
          key,
          expectedField.value,
          message,
          operation,
        );
      }
      return;
    }
    // An arrow function has no prototype, so `instanceof` would throw: guard
    // before asking.
  } else if (isSupportedErrorConstructor(expected)) {
    if (isInstanceOfSupportedError(actual, expected)) return;
    if (!message) {
      generatedMessage = true;
      message = "The error is expected to be an instance of " +
        `"${supportedErrorName(expected)}". Received `;
      if (actual instanceof Error) {
        const name = actual.name;
        if (supportedErrorName(expected) === name) {
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
    const res = expected(actual);
    if (res !== true) {
      if (!message) {
        generatedMessage = true;
        message = "The validation function is expected to return" +
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
      operator: operation,
      diff: options?.diff,
    });
    err.generatedMessage = generatedMessage;
    throw err;
  }
}

function getActual(fn: AnyFn): unknown {
  validateFunction(fn, "fn");
  try {
    fn();
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
function checkIsPromise(obj: unknown): obj is Awaitable {
  return isPromise(obj) ||
    (obj !== null && typeof obj === "object" &&
      "then" in obj && typeof obj.then === "function" &&
      "catch" in obj && typeof obj.catch === "function");
}

async function waitForActual(promiseFn: AnyFn | Awaitable): Promise<unknown> {
  let resultPromise: Awaitable;
  if (typeof promiseFn === "function") {
    const result = promiseFn();
    if (!checkIsPromise(result)) {
      throw new ERR_INVALID_RETURN_VALUE("instance of Promise", "promiseFn", result);
    }
    resultPromise = result;
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

function expectationName(expected: Expectation | string | undefined): string | undefined {
  if (expected === undefined || typeof expected === "string") return undefined;
  if (isSupportedErrorConstructor(expected)) return supportedErrorName(expected);
  if (expected instanceof Error) return expected.name;
  if (typeof expected !== "object" || expected === null) return undefined;
  const field = readErrorField(expected, "name");
  return field.present && typeof field.value === "string"
    ? field.value
    : undefined;
}

function expectsError(
  options: ResolvedOptions | undefined,
  operation: string,
  kind: "exception" | "rejection",
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
    if (hasStringMessage(actual)) {
      if (actual.message === error) {
        throw new ERR_AMBIGUOUS_ARGUMENT(
          "error/message",
          `The error message "${actual.message}" is identical to the message.`,
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
    const name = expectationName(error);
    if (name !== undefined && name.length > 0) {
      details += ` (${name})`;
    }
    details += message ? `: ${message}` : ".";
    innerFail({
      actual: undefined,
      expected: error,
      operator: operation,
      message: `Missing expected ${kind}${details}`,
      diff: options?.diff,
    });
  }

  if (!error) return;

  expectedException(options, actual, error, message, operation);
}

function hasMatchingError(actual: unknown, expected: Expectation): boolean {
  if (typeof expected !== "function") {
    if (isRegExp(expected)) {
      return expected.exec(String(actual)) !== null;
    }
    throw new ERR_INVALID_ARG_TYPE("expected", ["Function", "RegExp"], expected);
  }
  if (isSupportedErrorConstructor(expected)) {
    return isInstanceOfSupportedError(actual, expected);
  }
  return expected(actual) === true;
}

function expectsNoError(
  options: ResolvedOptions | undefined,
  operation: string,
  kind: "exception" | "rejection",
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
    const actualMessage = hasStringMessage(actual) ? actual.message : undefined;
    innerFail({
      actual,
      expected: error,
      operator: operation,
      message: `Got unwanted ${kind}${details}\n` +
        `Actual message: "${actualMessage}"`,
      diff: options?.diff,
    });
  }
  // An error that was thrown and was not the unwanted one still happened, and
  // swallowing it here would hide a real failure.
  throw actual;
}

function internalMatch(
  options: ResolvedOptions | undefined,
  string: string,
  regexp: RegExp,
  message: string | Error | undefined,
  operation: "match" | "doesNotMatch",
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
      operator: operation,
      diff: options?.diff,
    });
    err.generatedMessage = generatedMessage;
    throw err;
  }
}

// The module surface is the loose configuration's unbound method set. Reading
// a declared method as a value is a static method-table operation in NTS; it
// does not inspect or mutate a JavaScript prototype.
const looseAssertions = new Assert({ strict: false });

export const fail = looseAssertions.fail;
export const ok = looseAssertions.ok;
export const equal = looseAssertions.equal;
export const notEqual = looseAssertions.notEqual;
export const deepEqual = looseAssertions.deepEqual;
export const notDeepEqual = looseAssertions.notDeepEqual;
export const deepStrictEqual = looseAssertions.deepStrictEqual;
export const notDeepStrictEqual = looseAssertions.notDeepStrictEqual;
export const strictEqual = looseAssertions.strictEqual;
export const notStrictEqual = looseAssertions.notStrictEqual;
export const partialDeepStrictEqual = looseAssertions.partialDeepStrictEqual;
export const match = looseAssertions.match;
export const doesNotMatch = looseAssertions.doesNotMatch;
export const throws = looseAssertions.throws;
export const rejects = looseAssertions.rejects;
export const doesNotThrow = looseAssertions.doesNotThrow;
export const doesNotReject = looseAssertions.doesNotReject;
export const ifError = looseAssertions.ifError;
