// `node:assert`, from node v24.20.0 `lib/assert.js`.
//
// Every function here is a comparison and a throw. What makes the module worth
// care is the *message*: `assert.deepStrictEqual` on two large objects has to
// say which line differs, not print both and leave the reader to find it. That
// work is in `error.ts`, built on `util.inspect`.

import { isDeepStrictEqual } from "../../util/src/deep-equal.ts";
import { isArrayBufferView, isDate, isMap, isRegExp, isSet } from "../../util/src/types.ts";
import { inspect } from "../../util/src/inspect.ts";
import { AssertionError } from "./error.ts";
import { ERR_INVALID_ARG_TYPE, ERR_MISSING_ARGS } from "../../internal/errors.ts";

export { AssertionError };

type AnyFn = (...args: never[]) => unknown;

function innerFail(
  actual: unknown,
  expected: unknown,
  message: string | Error | undefined,
  operator: string,
  stackStartFn: AnyFn,
): never {
  if (message instanceof Error) {
    throw message;
  }
  throw new AssertionError({ actual, expected, message, operator, stackStartFn });
}

/** `assert(value)` and `assert.ok(value)` are the same function. */
export function ok(value: unknown, message?: string | Error): asserts value {
  if (arguments.length === 0) {
    throw new ERR_MISSING_ARGS("value");
  }
  if (!value) {
    innerFail(value, true, message, "==", ok);
  }
}

export function fail(message?: string | Error): never {
  if (message instanceof Error) {
    throw message;
  }
  // No message means the error *generates* "Failed" rather than being handed
  // it: `generatedMessage` is part of the observable shape, and node's tests
  // check it.
  throw new AssertionError({
    ...(message === undefined ? {} : { message }),
    actual: undefined,
    expected: undefined,
    operator: "fail",
    stackStartFn: fail,
  });
}

// ------------------------------------------------------------- equality

export function equal(actual: unknown, expected: unknown, message?: string | Error): void {
  if (arguments.length < 2) {
    throw new ERR_MISSING_ARGS("actual", "expected");
  }
  // Loose equality on purpose: `assert.equal` is the `==` one, and node keeps
  // it for the code that predates `strictEqual`.
  // eslint-disable-next-line eqeqeq
  if (actual != expected && !(Number.isNaN(actual) && Number.isNaN(expected))) {
    innerFail(actual, expected, message, "==", equal);
  }
}

export function notEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (arguments.length < 2) {
    throw new ERR_MISSING_ARGS("actual", "expected");
  }
  // eslint-disable-next-line eqeqeq
  if (actual == expected) {
    innerFail(actual, expected, message, "!=", notEqual);
  }
}

export function strictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (arguments.length < 2) {
    throw new ERR_MISSING_ARGS("actual", "expected");
  }
  // `Object.is`, so `NaN` equals itself and `-0` does not equal `0`. That is
  // the difference from `===` and it is the point of the strict family.
  if (!Object.is(actual, expected)) {
    innerFail(actual, expected, message, "strictEqual", strictEqual);
  }
}

export function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (arguments.length < 2) {
    throw new ERR_MISSING_ARGS("actual", "expected");
  }
  if (Object.is(actual, expected)) {
    innerFail(actual, expected, message, "notStrictEqual", notStrictEqual);
  }
}

export function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (arguments.length < 2) {
    throw new ERR_MISSING_ARGS("actual", "expected");
  }
  if (!isDeepStrictEqual(actual, expected)) {
    innerFail(actual, expected, message, "deepStrictEqual", deepStrictEqual);
  }
}

export function notDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (arguments.length < 2) {
    throw new ERR_MISSING_ARGS("actual", "expected");
  }
  if (isDeepStrictEqual(actual, expected)) {
    innerFail(actual, expected, message, "notDeepStrictEqual", notDeepStrictEqual);
  }
}

/**
 * Loose deep equality: the same walk as the strict one, with `==` at the
 * leaves and no prototype check. Kept because a great deal of code predates
 * `deepStrictEqual`, and deprecated in node's documentation for the reason
 * that `'1' == 1`.
 */
function looseDeepEqual(a: unknown, b: unknown, seen: Map<object, Set<object>>): boolean {
  if (a === b) {
    return true;
  }

  // `==` applies only when *both* sides are primitives. Comparing a primitive
  // against an object with it would make `'a'` loosely deep-equal to `['a']`,
  // because `['a'] == 'a'` coerces through `toString` -- and node says those
  // are not deep-equal, whatever `==` says about them.
  const aPrimitive = a === null || typeof a !== "object";
  const bPrimitive = b === null || typeof b !== "object";
  if (aPrimitive || bPrimitive) {
    if (aPrimitive && bPrimitive) {
      // eslint-disable-next-line eqeqeq
      return a == b ||
        (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));
    }
    return false;
  }
  const known = seen.get(a);
  if (known?.has(b)) {
    return true;
  }
  seen.set(a, (known ?? new Set()).add(b));

  // A `Date` with no own keys and `{}` both have zero enumerable properties,
  // so the key walk below would call them equal. Every kind whose *identity*
  // lives outside its properties has to be checked for symmetry first.
  // Guards, not answers: two regexps with the same source can still differ in
  // their own properties, and the key walk below is what sees that. Returning
  // early here made `/test/` equal to a `MyRegExp` carrying an extra field.
  if (isDate(a) || isDate(b)) {
    if (!isDate(a) || !isDate(b) || (a as Date).getTime() !== (b as Date).getTime()) {
      return false;
    }
  }
  if (isRegExp(a) || isRegExp(b)) {
    if (
      !isRegExp(a) || !isRegExp(b) ||
      (a as RegExp).source !== (b as RegExp).source ||
      (a as RegExp).flags !== (b as RegExp).flags
    ) {
      return false;
    }
  }
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b) || (a as Map<unknown, unknown>).size !== (b as Map<unknown, unknown>).size) {
      return false;
    }
  }
  if (isSet(a) || isSet(b)) {
    if (!isSet(a) || !isSet(b) || (a as Set<unknown>).size !== (b as Set<unknown>).size) {
      return false;
    }
  }
  if (isArrayBufferView(a) || isArrayBufferView(b)) {
    if (!isArrayBufferView(a) || !isArrayBufferView(b)) {
      return false;
    }
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) return false;
    }
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (isMap(a)) {
    for (const [key, value] of a as Map<unknown, unknown>) {
      if (!(b as Map<unknown, unknown>).has(key)) {
        return false;
      }
      if (!looseDeepEqual(value, (b as Map<unknown, unknown>).get(key), seen)) {
        return false;
      }
    }
  }
  if (isSet(a)) {
    for (const value of a as Set<unknown>) {
      if (!(b as Set<unknown>).has(value)) {
        return false;
      }
    }
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!looseDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], seen)) {
      return false;
    }
  }
  return true;
}

export function deepEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (arguments.length < 2) {
    throw new ERR_MISSING_ARGS("actual", "expected");
  }
  if (!looseDeepEqual(actual, expected, new Map())) {
    innerFail(actual, expected, message, "deepEqual", deepEqual);
  }
}

export function notDeepEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (arguments.length < 2) {
    throw new ERR_MISSING_ARGS("actual", "expected");
  }
  if (looseDeepEqual(actual, expected, new Map())) {
    innerFail(actual, expected, message, "notDeepEqual", notDeepEqual);
  }
}

// --------------------------------------------------------------- throwing

type Expectation =
  | RegExp
  | ((err: unknown) => boolean)
  | (new (...args: never[]) => Error)
  | Record<string, unknown>
  | Error;

/** Does `err` satisfy `expected`? Upstream `expectedException`. */
function matches(err: unknown, expected: Expectation | undefined): boolean {
  if (expected === undefined) {
    return true;
  }
  if (expected instanceof RegExp) {
    return expected.test(String(err));
  }
  if (typeof expected === "function") {
    // A class matches by `instanceof`; a plain predicate by its return value.
    // The two are told apart by whether the value has a prototype object, which
    // is what `new`-ability comes down to here.
    if (expected.prototype !== undefined && err instanceof (expected as new () => Error)) {
      return true;
    }
    if (Object.prototype.isPrototypeOf.call(Error, expected)) {
      return false;
    }
    return (expected as (e: unknown) => boolean).call(undefined, err) === true;
  }
  if (typeof expected === "object" && expected !== null) {
    // Every listed key must match; keys the error has beyond them are ignored,
    // so a caller can assert on `code` without naming `message`.
    for (const key of Object.keys(expected)) {
      const wanted = (expected as Record<string, unknown>)[key];
      const found = (err as Record<string, unknown>)?.[key];
      if (wanted instanceof RegExp) {
        if (!wanted.test(String(found))) return false;
      } else if (!isDeepStrictEqual(found, wanted)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function throws(fn: AnyFn, expected?: Expectation | string, message?: string | Error): void {
  if (typeof fn !== "function") {
    throw new ERR_INVALID_ARG_TYPE("fn", "Function", fn);
  }
  // `throws(fn, 'message')` is the two-argument form where the second is the
  // assertion's own message, not an expectation.
  let expectation: Expectation | undefined;
  let note = message;
  if (typeof expected === "string") {
    note = expected;
  } else {
    expectation = expected;
  }

  let threw = false;
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    threw = true;
    thrown = err;
  }

  if (!threw) {
    innerFail(undefined, expectation, note ?? "Missing expected exception.", "throws", throws);
  }
  if (!matches(thrown, expectation)) {
    if (thrown instanceof Error && expectation !== undefined && typeof expectation === "object" &&
        !(expectation instanceof RegExp)) {
      innerFail(thrown, expectation, note, "throws", throws);
    }
    throw thrown;
  }
}

export function doesNotThrow(fn: AnyFn, expected?: Expectation | string, message?: string | Error): void {
  if (typeof fn !== "function") {
    throw new ERR_INVALID_ARG_TYPE("fn", "Function", fn);
  }
  try {
    fn();
  } catch (err) {
    const expectation = typeof expected === "string" ? undefined : expected;
    const note = typeof expected === "string" ? expected : message;
    if (!matches(err, expectation)) {
      // Something else went wrong; the caller wanted to hear about that rather
      // than about the assertion.
      throw err;
    }
    innerFail(err, expectation, `Got unwanted exception${note ? `: ${note}` : "."}\nActual message: "${
      (err as Error)?.message}"`, "doesNotThrow", doesNotThrow);
  }
}

export async function rejects(
  promiseOrFn: Promise<unknown> | (() => Promise<unknown>),
  expected?: Expectation | string,
  message?: string | Error,
): Promise<void> {
  const expectation = typeof expected === "string" ? undefined : expected;
  const note = typeof expected === "string" ? expected : message;
  let threw = false;
  let thrown: unknown;
  try {
    await (typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn);
  } catch (err) {
    threw = true;
    thrown = err;
  }
  if (!threw) {
    innerFail(undefined, expectation, note ?? "Missing expected rejection.", "rejects", rejects);
  }
  if (!matches(thrown, expectation)) {
    throw thrown;
  }
}

export async function doesNotReject(
  promiseOrFn: Promise<unknown> | (() => Promise<unknown>),
  expected?: Expectation | string,
  message?: string | Error,
): Promise<void> {
  try {
    await (typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn);
  } catch (err) {
    const expectation = typeof expected === "string" ? undefined : expected;
    const note = typeof expected === "string" ? expected : message;
    if (!matches(err, expectation)) {
      throw err;
    }
    innerFail(err, expectation, `Got unwanted rejection${note ? `: ${note}` : "."}`, "doesNotReject", doesNotReject);
  }
}

/** `ifError(err)` throws whatever it was handed, unless that is nothing. */
export function ifError(err: unknown): void {
  if (err !== null && err !== undefined) {
    const message = err instanceof Error
      ? `ifError got unwanted exception: ${err.message}`
      : `ifError got unwanted exception: ${inspect(err)}`;
    throw new AssertionError({
      actual: err, expected: null, operator: "ifError", message, stackStartFn: ifError,
    });
  }
}

// ---------------------------------------------------------------- matching

export function match(str: string, regexp: RegExp, message?: string | Error): void {
  if (!(regexp instanceof RegExp)) {
    throw new ERR_INVALID_ARG_TYPE("regexp", "RegExp", regexp);
  }
  if (typeof str !== "string" || !regexp.test(str)) {
    innerFail(str, regexp,
      message ?? `The input did not match the regular expression ${regexp}. Input:\n\n${inspect(str)}\n`,
      "match", match);
  }
}

export function doesNotMatch(str: string, regexp: RegExp, message?: string | Error): void {
  if (!(regexp instanceof RegExp)) {
    throw new ERR_INVALID_ARG_TYPE("regexp", "RegExp", regexp);
  }
  if (typeof str === "string" && regexp.test(str)) {
    innerFail(str, regexp,
      message ?? `The input was expected to not match the regular expression ${regexp}. Input:\n\n${inspect(str)}\n`,
      "doesNotMatch", doesNotMatch);
  }
}

/**
 * `partialDeepStrictEqual`: every key in `expected` must match, and keys the
 * actual value has beyond them are ignored.
 */
export function partialDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!partialMatch(actual, expected)) {
    innerFail(actual, expected, message, "partialDeepStrictEqual", partialDeepStrictEqual);
  }
}

function partialMatch(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) {
    return true;
  }
  if (typeof expected !== "object" || expected === null ||
      typeof actual !== "object" || actual === null) {
    return false;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return false;
    }
    return expected.every((item, i) => partialMatch(actual[i], item));
  }
  for (const key of Reflect.ownKeys(expected)) {
    if (!partialMatch((actual as Record<PropertyKey, unknown>)[key],
                      (expected as Record<PropertyKey, unknown>)[key])) {
      return false;
    }
  }
  return true;
}
