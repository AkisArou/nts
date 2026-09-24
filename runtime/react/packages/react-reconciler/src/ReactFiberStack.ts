// The render phase's context stacks. Each cursor holds a current value;
// pushing saves the previous one on a single shared stack, and popping in
// reverse order restores it.

import { isDevelopment } from "shared/Build.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

export interface StackCursor<T> {
  current: T;
}

const valueStack: unknown[] = [];

// Development only: which fiber pushed each entry, to catch mismatched pops.
const fiberStack: (Fiber | null)[] = [];

let index = -1;

function createCursor<T>(defaultValue: T): StackCursor<T> {
  return { current: defaultValue };
}

function pop<T>(cursor: StackCursor<T>, fiber: Fiber): void {
  if (index < 0) {
    if (isDevelopment) {
      console.error("Unexpected pop.");
    }
    return;
  }
  if (isDevelopment && fiber !== fiberStack[index]) {
    console.error("Unexpected Fiber popped.");
  }
  // The value was pushed through this same cursor, so it has its type.
  cursor.current = valueStack[index] as T;
  valueStack[index] = null;
  if (isDevelopment) {
    fiberStack[index] = null;
  }
  index--;
}

function push<T>(cursor: StackCursor<T>, value: T, fiber: Fiber): void {
  index++;
  valueStack[index] = cursor.current;
  if (isDevelopment) {
    fiberStack[index] = fiber;
  }
  cursor.current = value;
}

export { createCursor, pop, push };
