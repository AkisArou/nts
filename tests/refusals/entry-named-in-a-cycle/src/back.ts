// The other half of the cycle. It imports the entry, which is what makes the
// entry look like a library module to anything counting import edges.
import { alpha } from "./main.ts";

export function helper(n: number): number {
  return alpha(n) * 2;
}
