// Node's argument validators, `lib/internal/validators.js`.
//
// These exist in the compiled world too, even though a TypeScript caller
// cannot reach them: a module is callable from JavaScript through the Node-API
// wrapper, and JavaScript has no types. `readFileSync(42)` has to throw the
// error node throws, not read a file named "42".

import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE } from "./errors.ts";

export function validateString(value: unknown, name: string): void {
  if (typeof value !== "string") {
    throw new ERR_INVALID_ARG_TYPE(name, "string", value);
  }
}

export function validateObject(value: unknown, name: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
  }
}

export function validateNumber(value: unknown, name: string): void {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
}

export function validateBoolean(value: unknown, name: string): void {
  if (typeof value !== "boolean") {
    throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
  }
}

export function validateFunction(value: unknown, name: string): void {
  if (typeof value !== "function") {
    throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
  }
}

/** `validateNumber` with an optional lower bound, node's `min` parameter. */
export function validateNumberRange(value: unknown, name: string, min?: number): void {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (Number.isNaN(value) || (min !== undefined && value < min)) {
    throw new ERR_OUT_OF_RANGE(name, min === undefined ? "a number" : `>= ${min}`, value);
  }
}

export function validateArray(value: unknown, name: string, minLength = 0): void {
  if (!Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
  }
  if (value.length < minLength) {
    throw new ERR_INVALID_ARG_VALUE(name, value, `must have a length of at least ${minLength}`);
  }
}

export function validateInteger(
  value: unknown,
  name: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!Number.isInteger(value)) {
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  }
  if (value < min || value > max) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }
}

/** Membership by `===`, with the allowed values named in the message. */
export function validateOneOf(value: unknown, name: string, oneOf: readonly unknown[]): void {
  if (!oneOf.includes(value)) {
    const allowed = oneOf.map((v) => (typeof v === "string" ? `'${v}'` : String(v))).join(", ");
    throw new ERR_INVALID_ARG_VALUE(name, value, `must be one of: ${allowed}`);
  }
}

/** A 32-bit unsigned integer; `positive` makes zero invalid too. */
export function validateUint32(value: unknown, name: string, positive = false): void {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!Number.isInteger(value)) {
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  }
  const min = positive ? 1 : 0;
  const max = 4_294_967_295;
  if (value < min || value > max) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }
}

/**
 * An `AbortSignal`, or nothing.
 *
 * Duck-typed on `aborted` rather than tested with `instanceof`, because a
 * signal may come from a different realm -- a worker, or a polyfill -- and the
 * only thing the caller does with it is read `aborted` and add a listener.
 * Refusing a working signal because its constructor is a different object
 * would be a check that only ever rejects valid programs.
 */
export function validateAbortSignal(signal: unknown, name: string): void {
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== "object" || !("aborted" in signal))
  ) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
}

/** An octal string, and nothing else that `parseInt` would half-accept. */
const OCTAL = /^[0-7]+$/;

/**
 * A file mode, given as a number or an octal string.
 *
 * The regular expression is the point. `parseInt("123x", 8)` is 83 and
 * `parseInt("999", 8)` is `NaN`, so parsing first and checking after would
 * accept the first and produce a confusing error for the second. A mode is
 * either entirely octal digits or it is a mistake.
 */
export function parseFileMode(value: unknown, name: string, byDefault?: number): number {
  const given = value ?? byDefault;
  let mode = given;
  if (typeof mode === "string") {
    if (!OCTAL.test(mode)) {
      throw new ERR_INVALID_ARG_VALUE(name, mode, "must be a 32-bit unsigned integer or an octal string");
    }
    mode = Number.parseInt(mode, 8);
  }
  validateUint32(mode, name);
  return mode as number;
}
