// Control for tests/refusals/a-class-extending-a-builtin-cast-to-an-own-namesake:
// `Sub` extends the own class itself.
import { Uint8Array as Own } from "./own.ts";
class Sub extends Own {}
export function probe(n: number): number {
  const made: object = new Sub(n & 7);
  return made instanceof Own ? 1 : 0;
}
