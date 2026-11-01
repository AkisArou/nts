// expect: NTS1001 a class extending a cast, whose base its type names something it does not run is not supported by this lowering yet
//
// `Sub` extends the global `Uint8Array`, cast to an own class of the same name, so
// its type's base is the own class while its `extends` runs the builtin. Matched
// by name, the builtin was taken for the own class and `instanceof Own` was 1
// where node answers 0.
// Control: tests/programs/a-class-extending-an-own-class-named-like-a-builtin.
import { Uint8Array as Own } from "./own.ts";
class Sub extends (Uint8Array as unknown as typeof Own) {}
export function probe(n: number): number {
  const made: object = new Sub(n & 7);
  return made instanceof Own ? 1 : 0;
}
