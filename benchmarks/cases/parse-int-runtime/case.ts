// parseInt's runtime radix path, with the same runtime strings and loop shape.
// seed 3 makes 131 parse calls per work; the harness passes an opaque seed.
// Complete numeric results are checked against Node, before any timing counts.
import { text } from "./input.ts";

export function work(seed: number): number {
  let total = 0;
  const count = 128 + ((seed | 0) & 15);
  for (let index = 0; index < count; index++) {
    const input = text(index + seed);
    total += parseInt(input, (index & 1) === 0 ? 10 : 16);
  }
  return total;
}

export const seed = 3;
