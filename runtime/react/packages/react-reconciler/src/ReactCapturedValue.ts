import { getStackByFiberInDevAndProd } from "./ReactFiberComponentStack.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

// A thrown value with the fiber it came from and that fiber's component stack.
export interface CapturedValue {
  readonly value: unknown;
  source: Fiber | null;
  stack: string | null;
}

// An object thrown more than once keeps the stack of its first capture.
const CapturedStacks: WeakMap<object, CapturedValue> = new WeakMap<object, CapturedValue>();

export function createCapturedValueAtFiber(value: unknown, source: Fiber): CapturedValue {
  // If the value is an error, call this function immediately after it is thrown
  // so the stack is accurate.
  if (typeof value === "object" && value !== null) {
    const existing = CapturedStacks.get(value);
    if (existing !== undefined) {
      // It was captured with this same value.
      return existing;
    }
    const captured: CapturedValue = {
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

export function createCapturedValueFromError(value: Error, stack: string | null): CapturedValue {
  const captured: CapturedValue = {
    value,
    source: null,
    stack: stack,
  };
  if (typeof stack === "string") {
    CapturedStacks.set(value, captured);
  }
  return captured;
}
