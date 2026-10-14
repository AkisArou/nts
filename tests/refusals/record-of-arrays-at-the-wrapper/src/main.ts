// expect: emit-c --napi -> no wrapper for returnsRecordOfArrays: returns Record<string, f64[]>
//
// A `Record` whose values are arrays cannot be returned across the wrapper. A
// `Record` of scalars can, and so can a bare array, and so can a declared
// interface -- so this is not "index signatures do not cross" and not "arrays do
// not cross". It is the pair.
//
// # The controls are the whole argument
//
//     returnsRecordOfArrays(): Record<string, number[]>  -> REFUSED
//     returnsRecordOfScalars(): Record<string, number>   -> crosses
//     returnsArray(): number[]                           -> crosses
//     returnsInterface(): Named                          -> crosses
//
// Three controls rather than one, because there were three plausible causes and
// each of them is a thing this wrapper is known to do elsewhere. Without the
// scalar `Record` the reading would be "index signatures"; without the bare
// array it would be "arrays in a return position".
//
// # Where it bites
//
// `os.networkInterfaces` is exactly this shape and it is the third of the three
// things between `os` and whole:
//
//     no wrapper for networkInterfaces: returns Record<string, unknown[]>
//
// It costs `os` two test files, `local/core-static.js` and one of the findings
// in `local/export-surface-static.js`. Node's `os.networkInterfaces()` returns
// an object keyed by interface name whose values are arrays of address records,
// so there is no flatter shape to return without changing what the function
// answers.
//
// `unknown` outward is not the problem. `blockers/unknown-return-at-the-boundary`
// already establishes that it crosses, and this file reproduces with `number[]`
// in place of `unknown[]` anyway.
//
// (That sentence originally spelled out the other fixture's state using the
// words this harness looks for to decide a file is a guard. It matched, and this
// blocker printed `guard ok` -- the hazard `blockers-check.mjs` warns about in
// its own comment: a fixture can mention a fix in prose without being one.)

interface Named {
  readonly a: number;
}

/** The reduction: a `Record` of arrays in a return position. */
export function returnsRecordOfArrays(): Record<string, number[]> {
  return { one: [1, 2] };
}

/** Control: the same `Record`, scalar values. */
export function returnsRecordOfScalars(): Record<string, number> {
  return { one: 1 };
}

/** Control: the same array, not inside a `Record`. */
export function returnsArray(): number[] {
  return [1, 2];
}

/** Control: a declared object crosses outward. */
export function returnsInterface(): Named {
  return { a: 1 };
}
