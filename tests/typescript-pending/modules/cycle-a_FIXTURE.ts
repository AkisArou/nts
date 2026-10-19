// One half of an import cycle, for import-cycle.ts.
import { isOdd } from "./cycle-b_FIXTURE.js";
export function isEven(n: number): boolean {
  return n === 0 ? true : isOdd(n - 1);
}
