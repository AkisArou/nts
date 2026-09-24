import { getStackByFiberInDevAndProd } from "./ReactFiberComponentStack.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

// A thrown value with the fiber it came from and that fiber's component stack.
export interface CapturedValue<T> {
  readonly value: T;
  source: Fiber | null;
  stack: string | null;
}

// An object thrown more than once keeps the stack of its first capture.
const CapturedStacks: WeakMap<object, CapturedValue<unknown>> = new WeakMap();

export function createCapturedValueAtFiber<T>(value: T, source: Fiber): CapturedValue<T> {
  // If the value is an error, call this function immediately after it is thrown
  // so the stack is accurate.
  if (typeof value === "object" && value !== null) {
    const existing = CapturedStacks.get(value);
    if (existing !== undefined) {
      // It was captured with this same value.
      return existing as CapturedValue<T>;
    }
    const captured: CapturedValue<T> = {
      value,
      source,
      stack: getStackByFiberInDevAndProd(source),
    };
    CapturedStacks.set(value, captured);
    return captured;
  }
  return {
    value,
    source,
    stack: getStackByFiberInDevAndProd(source),
  };
}

export function createCapturedValueFromError(value: Error, stack: string | null): CapturedValue<Error> {
  const captured: CapturedValue<Error> = {
    value,
    source: null,
    stack: stack,
  };
  if (typeof stack === "string") {
    CapturedStacks.set(value, captured);
  }
  return captured;
}
