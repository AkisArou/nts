// A rest parameter written as a union of tuples, which is how this tree asks
// "was I called with no arguments at all".
//
//     get(...given: [] | [name: string]): string | null
//
// The union is what lets the checker narrow on `given.length === 0`, so the
// `ERR_MISSING_ARGS` branch is reachable without consulting `arguments`. Six
// methods in `runtime/node/url/src/searchparams.ts` are written this way.
//
// What this fixture is for is the **count**, not the lowering. A rest parameter
// is gathered into a real array at the call site, so `given.length` is the
// number of arguments actually supplied. The tempting shortcut -- treat the
// tuple as optional parameters and call `given.length` the number of leading
// non-`undefined` values -- differs from that in exactly one place, and
// `explicitUndefinedStillCounts` is that place.

/** `given.length` must be the number of arguments the call actually passed. */
function arity(...given: [] | [a: string] | [a: string, b: string]): number {
  return given.length;
}

/** An *optional* position. `f("x", undefined)` is legal and is two arguments. */
function optionalTail(...given: [] | [a: string, b?: string]): number {
  return given.length;
}

/** Reading a position, guarded by the count -- `searchparams.ts`'s shape. */
function firstOr(...given: [] | [a: string, b?: string]): string {
  if (given.length === 0) return "none";
  if (given.length < 2) return given[0];
  return given[0] + "/" + (given[1] ?? "nil");
}

export function countsByArity(n: number): number {
  return arity() * 100 + arity("a") * 10 + arity("a", "b") + n * 0;
}

/**
 * The same question through an *optional* tuple position rather than a second
 * arm. `b?: string` and `b: string` reach the same element type here.
 *
 * Passing `undefined` explicitly -- `optionalTail("a", undefined)`, which node
 * counts as two arguments -- is refused, and
 * `blockers/a-rest-parameter-that-is-a-union-of-tuples` says so. It is not in
 * this file because a refused function leaves the differential silently: it
 * would report agreement over the functions that survived and this fixture
 * would go green having stopped testing.
 */
export function optionalPositionArity(n: number): number {
  return optionalTail() * 100 + optionalTail("a") * 10 + optionalTail("a", "b") + n * 0;
}

export function readsAPosition(n: number): string {
  return firstOr() + "|" + firstOr("a") + "|" + firstOr("a", "b") + "|" + String(n * 0);
}

/** Control: the same shape without the union. A plain tuple rest. */
function plainTuple(...given: [string, string]): number {
  return given.length;
}

/** Control: an ordinary rest parameter. */
function ordinary(...given: string[]): number {
  return given.length;
}

export function controls(n: number): number {
  return plainTuple("a", "b") * 100 + ordinary() * 10 + ordinary("a", "b", "c") + n * 0;
}
