// The same dead zone as `module-cycle-tdz`, written the way people actually
// write it: the read is in an *initializer* rather than in a statement of its
// own.
//
// It is a separate fixture because the two reach the read by different paths.
// A module-scope initializer sits under a `VariableDeclarationList`, which the
// encoded AST wraps in a node list -- and a walk that stopped at the first
// list, as this one did, saw the statement form and missed this one entirely.
// The shape that gets missed is the shape that gets written.
import { derived } from "./b.js";

export let seed = 7;

export function readDerived(n: number): number {
  return derived + n;
}
