// Node's argument validators, `lib/internal/validators.js`.
//
// These exist in the compiled world too, even though a TypeScript caller
// cannot reach them: a module is callable from JavaScript through the Node-API
// wrapper, and JavaScript has no types. `readFileSync(42)` has to throw the
// error node throws, not read a file named "42".

import { ERR_INVALID_ARG_TYPE } from "./errors.ts";

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
