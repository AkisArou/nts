// expect: emit-c --napi -> publishes takesUnknown
//
// FIXED, kept as a guard. `unknown` crosses inward.
//
// It was filed separately from the return direction because the two came apart
// once before -- `view-parameter-crosses-outward-only` is a case where they
// did -- and this time they did not: both landed together, deliberately, and
// the reason is worth keeping.
//
// `win32.toNamespacedPath` returns its argument. Widening its parameter to
// `unknown` with only the inward crossing built would have taken that export
// from "publishes and throws on a non-string" to "does not publish at all",
// and `path` from 15 published to 11. A number going down for a change
// somebody chose is the trade this ledger exists to refuse, so neither half
// shipped alone.
//
// # What it is for, which is not `unknown` as such
//
// **23 exported functions in the profile validate a parameter at run time with
// a check their own declaration deletes.** `validateString(path, "path")`
// inside a function whose parameter is declared `string` folds to nothing,
// because `typeof path !== "string"` is statically false. `path` alone has 16
// of them.
//
// So the wrapper's arity error is not a wrapper being wrong -- it is standing
// in for a guard the declaration removed. `path.dirname()` answers
// `ERR_MISSING_ARGS` where node answers `ERR_INVALID_ARG_TYPE`, and removing
// the arity check without widening the declaration would not produce node's
// error: it would dereference a null pointer.
//
// # Primitives, and a loud refusal for the rest
//
// A string, number, boolean, `null` and `undefined` cross carrying their tag.
// An object, array, function, symbol or bigint raises a `TypeError` naming the
// limitation, because answering `undefined` for a value the caller really
// passed is the wrong-value failure this compiler refuses everywhere else.
//
// Verified by loading an addon and calling it: nine primitive cases round-trip
// exactly, `{}` and `[]` raise the TypeError.

export function takesNumber(value: number): number {
  return value;
}

export function returnsNumber(flag: boolean): number {
  return flag ? 1 : 0;
}

export function takesUnknown(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

