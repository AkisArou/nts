import { throughB } from "./a.js";

// Deliberately reads no module-scope state. A refused initializer leaves the
// program running *without* its module code rather than failing to build, so
// an export that depended on `armed` or `seen` would disagree with node for a
// second reason and hide the first. Both sides answer from the functions
// alone, and the refusal is what this example is for -- see `nts hir`.
export function value(n: number): number {
  return throughB() + n;
}
