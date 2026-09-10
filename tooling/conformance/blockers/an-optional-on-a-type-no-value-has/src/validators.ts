// Node's argument validators, `lib/internal/validators.js`.
//
// These exist in the compiled world too, even though a TypeScript caller
// cannot reach them: a module is callable from JavaScript through the Node-API
// wrapper, and JavaScript has no types. `readFileSync(42)` has to throw the
// error node throws, not read a file named "42".

// The four error classes, stood in for rather than imported, so this file is
// frozen and does not follow `runtime/node/internal/errors.ts`. What is under
// test is the *type table* this file's declarations produce, and the throws are
// scaffolding for it.
class ERR_INVALID_ARG_TYPE extends TypeError {
  constructor(name: string, expected: unknown, actual: unknown) {
    super(`${name} ${String(expected)} ${String(actual)}`);
  }
}
class ERR_INVALID_ARG_VALUE extends TypeError {
  constructor(name: string, value: unknown, reason: string) {
    super(`${name} ${String(value)} ${reason}`);
  }
}
class ERR_OUT_OF_RANGE extends RangeError {
  constructor(name: string, range: string, value: unknown) {
    super(`${name} ${range} ${String(value)}`);
  }
}
class ERR_SOCKET_BAD_PORT extends RangeError {
  constructor(name: string, port: unknown, allowZero: boolean) {
    super(`${name} ${String(port)} ${String(allowZero)}`);
  }
}

const LINK_HEADER_VALUE = /^(?:<[^>\r\n]*>)(?:\s*;\s*[^;"\s]+(?:=(")?[^;"\s]*\1)?)*$/;
const LINK_HEADER_EXPECTATION =
  'must be an array or string of format "</styles.css>; rel=preload; as=style"';

export function validateString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") {
    throw new ERR_INVALID_ARG_TYPE(name, "string", value);
  }
}

export function validateObject(value: unknown, name: string): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
  }
}

export function validateNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
}

export function validateBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
  }
}

/** Validate and normalize a TCP/UDP port, from Node's internal validator. */
export function validatePort(value: unknown, name = "Port", allowZero = true): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new ERR_SOCKET_BAD_PORT(name, value, allowZero);
  }
  const port = Number(value);
  if (
    (typeof value === "string" && value.trim().length === 0) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    (port === 0 && !allowZero)
  ) {
    throw new ERR_SOCKET_BAD_PORT(name, value, allowZero);
  }
  return port;
}

export function validateFunction(value: CallableFunction, name: string): void;
export function validateFunction(
  value: unknown,
  name: string,
): asserts value is (...args: unknown[]) => unknown;
export function validateFunction(value: unknown, name: string): void {
  if (typeof value !== "function") {
    throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
  }
}

/** `validateNumber` with an optional lower bound, node's `min` parameter. */
export function validateNumberRange(
  value: unknown,
  name: string,
  min?: number,
): asserts value is number {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (Number.isNaN(value) || (min !== undefined && value < min)) {
    throw new ERR_OUT_OF_RANGE(name, min === undefined ? "a number" : `>= ${min}`, value);
  }
}

export function validateArray(
  value: unknown,
  name: string,
  minLength = 0,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
  }
  if (value.length < minLength) {
    throw new ERR_INVALID_ARG_VALUE(name, value, `must have a length of at least ${minLength}`);
  }
}

export function validateStringArray(
  value: unknown,
  name: string,
): asserts value is string[] {
  validateArray(value, name);
  for (let index = 0; index < value.length; index++) {
    const element: unknown = value[index];
    if (typeof element !== "string") {
      throw new ERR_INVALID_ARG_TYPE(`${name}[${index}]`, "string", element);
    }
  }
}

export function validateBooleanArray(
  value: unknown,
  name: string,
): asserts value is boolean[] {
  validateArray(value, name);
  for (let index = 0; index < value.length; index++) {
    const element: unknown = value[index];
    if (typeof element !== "boolean") {
      throw new ERR_INVALID_ARG_TYPE(`${name}[${index}]`, "boolean", element);
    }
  }
}

export function validateUnion<const Choices extends readonly string[]>(
  value: unknown,
  name: string,
  choices: Choices,
): asserts value is Choices[number] {
  for (const choice of choices) {
    if (value === choice) return;
  }
  throw new ERR_INVALID_ARG_TYPE(name, `('${choices.join("|")}')`, value);
}

export function validateInteger(
  value: unknown,
  name: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): asserts value is number {
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
export function validateOneOf<const Choices extends readonly unknown[]>(
  value: unknown,
  name: string,
  oneOf: Choices,
): asserts value is Choices[number] {
  if (!oneOf.includes(value)) {
    const allowed = oneOf.map((v) => (typeof v === "string" ? `'${v}'` : String(v))).join(", ");
    throw new ERR_INVALID_ARG_VALUE(name, value, `must be one of: ${allowed}`);
  }
}

function validateLinkHeaderFormat(value: unknown): asserts value is string {
  if (typeof value !== "string" || !LINK_HEADER_VALUE.test(value)) {
    throw new ERR_INVALID_ARG_VALUE("hints", value, LINK_HEADER_EXPECTATION);
  }
}

/** Validate and join the RFC 8288 Link values accepted by early hints. */
export function validateLinkHeaderValue(value: unknown): string {
  if (typeof value === "string") {
    validateLinkHeaderFormat(value);
    return value;
  }
  if (!Array.isArray(value)) {
    throw new ERR_INVALID_ARG_VALUE("hints", value, LINK_HEADER_EXPECTATION);
  }

  let result = "";
  for (let index = 0; index < value.length; index++) {
    const link: unknown = value[index];
    validateLinkHeaderFormat(link);
    if (index > 0) result += ", ";
    result += link;
  }
  return result;
}

/** A 32-bit unsigned integer; `positive` makes zero invalid too. */
export function validateUint32(
  value: unknown,
  name: string,
  positive = false,
): asserts value is number {
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
export function validateAbortSignal(
  signal: unknown,
  name: string,
): asserts signal is undefined | { readonly aborted: unknown } {
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== "object" || !("aborted" in signal))
  ) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
}
