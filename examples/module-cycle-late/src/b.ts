// The legal half of the temporal dead zone. `seed` is imported from a module
// that has not evaluated when this body runs -- and this body does not read
// it. The read is inside a function, and by the time anything calls that
// function `a` has finished.
//
// Node agrees: this program runs. Move the read out of the function and into
// module scope and node throws `ReferenceError: Cannot access 'seed' before
// initialization`, which is the case the compiler refuses instead.
import { seed } from "./a.js";

export function readSeed(): number {
  return seed;
}
