// A re-export inside a cycle: `facade` republishes `base`'s `core`, and `base`
// imports `decorate` back from `facade`. The re-export is what makes this
// worth its own case -- `export { core } from "./base.js"` binds an *alias*
// symbol here, so a reader that does not follow the chain finds a name with
// nothing behind it.
export { core } from "./base.js";

import { core as underlying } from "./base.js";

export function decorate(n: number): number {
  return underlying(n) + 1;
}
