// Imports a *function* from the module that imports this one. Hoisted, so node
// resolves it during the cycle without complaint; it is the module-scope
// binding above that would not be.
import { fromA } from "./a.js";

let seen = 0;

seen = 5;

export function fromB(): number {
  return fromA() + 100 + seen;
}
