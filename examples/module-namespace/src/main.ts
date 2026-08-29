// `import * as C from "./m"`, which binds a name to a module.
//
// `C` is not a value. It names the module itself, so `C.OK` is a reference to
// `m`'s export `OK` — the checker resolves the member to that export's own
// symbol — and not a field of an object this program allocates. Lowering `C`
// as a receiver asked for the value of something that has none, and reported
// `nts-workspace:///src/constants`, a name from an enclosing scope: a module
// path in the place a variable's name goes.
//
// So a member of a module is a *name*, and it lowers through the same
// alias-following path `import { OK }` already takes. A call through one is a
// plain call, resolved from the checker's target like any other.
//
// A module is recognised by its declaration being a source file. Not by
// `SymbolFlags::MODULE`: the frontend leaves flags at zero for both the local
// binding and the module it aliases, and a predicate reading a field nobody
// fills is a predicate that is always false.

import * as C from "./constants.ts";
import { LEVEL } from "./constants.ts";

export function throughTheNamespace(n: number): number {
  return n + C.OK + C.STREAM_END;
}

export function calledThroughIt(n: number): number {
  return C.scale(n);
}

// The two spellings are the same export, reached two ways.
export function bothSpellings(n: number): number {
  return C.LEVEL + LEVEL + n;
}
