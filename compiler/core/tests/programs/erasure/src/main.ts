import { reads } from "./reader.js";

// Nothing reads it. A pointer would do.
let kept: unknown = 0;

export function carries(value: unknown): void {
  kept = value;
}

// The same shape, but the binding it is written to *is* read. Nothing in
// `stashes` looks at its argument either -- what decides it is a read of
// `stashed` three lines further down, and a pass that stopped at the
// assignment would call this carried like the one above.
let stashed: any = 0;

export function stashes(value: any): void {
  stashed = value;
}

export function readsTheStash(): number {
  return stashed.length;
}

// A type test, and what follows happens to the narrowed type.
export function tests(value: unknown): number {
  if (typeof value === "number") {
    return value + 1;
  }
  return 0;
}

// Read directly: a property, which needs the general case.
export function examines(value: any): number {
  return value.length;
}

// The case the whole argument is about. Nothing here reads `value`; it is
// handed to another module, and *that* is what decides its representation.
// Judged on its own uses this parameter looks exactly like `carries`.
export function forwards(value: any): number {
  return reads(value);
}
