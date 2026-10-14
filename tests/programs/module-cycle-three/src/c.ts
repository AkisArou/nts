// Closes the cycle: c imports a, a imports b, b imports c. Every edge is
// crossed by a *function*, which is hoisted, so the call works whichever
// module the walk happens to evaluate first.
import { fromA } from "./a.js";

export function fromC(): number {
  return 100;
}

export function throughTheCycle(n: number): number {
  return fromA() + n;
}
