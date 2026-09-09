// expect: an `instanceof` against something this compiler has no class for
//
// `WeakMap` and `WeakSet` are the two classes `instanceof` still has no class
// for. `Uint8Array`, `ArrayBuffer`, `DataView`, `Map`, `Set`, `Date`, `Promise`
// and `Error` all lower.
//
// **Every subject gets its own function, and that is the whole design.** The
// lowering reports one refusal per function, so a single function testing all
// ten classes in sequence reports only the first and says nothing about the
// nine behind it. That is not hypothetical: `staticObjectName` in
// `internal/errors.ts` is exactly such a chain, it reported `DataView` for as
// long as `DataView` was refused, and when `DataView`, `Map`, `Set` and `Date`
// were fixed it reported `WeakMap` -- the same one line, the fifth class, with
// nothing in the output to say four had been cleared or that two remained.
//
// `mapControl` and `setControl` must stay clean, or the diagnostic reads as
// "`instanceof` against a collection is refused", which is false and would
// point at collections rather than at the two weak ones.
//
// Where it bites, and it is the widest chain measured in this profile:
//
//   validateString              <- ERR_INVALID_ARG_TYPE#constructor
//     <- determineSpecificType  <- staticObjectName  <- THIS
//
// 22 distinct functions have `validateString` as their immediate refusal cause
// and 67 have `ERR_INVALID_ARG_TYPE#constructor`; all thirteen of `path`'s
// public names are behind it -- join, resolve, normalize, basename, dirname,
// extname, format, parse, relative, isAbsolute, matchesGlob and both
// namespaces. Measured after the four classes landed: `path` is unmoved at 28
// cone roots, 6 own, 13 wrapper declines.

export function mapControl(value: object): boolean {
  return value instanceof Map;
}

export function setControl(value: object): boolean {
  return value instanceof Set;
}

export function weakMapSubject(value: object): boolean {
  return value instanceof WeakMap;
}

export function weakSetSubject(value: object): boolean {
  return value instanceof WeakSet;
}
