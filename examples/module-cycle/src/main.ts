import { throughB } from "./a.js";

// Reads through the cycle on purpose: `throughB()` is `fromB()`, which is
// `fromA() + 100 + seen`, which is `(10 + armed) + 100 + seen`. Both of those
// bindings are set by module-level code inside the cycle, so the answer is
// 116 only if both modules evaluated -- node says 116, and so must this.
export function value(n: number): number {
  return throughB() + n;
}
