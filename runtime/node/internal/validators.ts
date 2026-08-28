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
