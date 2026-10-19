// The other half of an import cycle, for import-cycle.ts.
import { isEven } from "./cycle-a_FIXTURE.js";
export function isOdd(n: number): boolean {
  return n === 0 ? false : isEven(n - 1);
}
