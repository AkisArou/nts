// expect: emit-c --napi -> no wrapper for takesRow: takes an object
//
// An object crosses outward and not inward. The same interface, with all-scalar
// fields, is a return the wrapper builds and a parameter it refuses:
//
//     returnsRow(a): Row   -> crosses
//     takesRow(row: Row)   -> REFUSED, "takes an object, which crosses outward only"
//
// `returnsRow` is the control and carries the whole argument. It proves `Row` is
// representable and that the wrapper can construct one, so the refusal on
// `takesRow` is about direction and not about the type --
// `object-return-carries-scalar-fields-only` already establishes that the
// outward half works for scalar fields, and asserts it from the positive side.
// Nothing asserted the inward half.
//
// Where it bites: `timers` declines twenty-seven exports and five of them are
// this one -- `cleanImmediate`, `remove`, `append`, `isEmpty`, `cleanTimer` --
// which is five of the profile's eight `takes an object`. A timer list is an
// object and every operation on it takes one.
//
// 2026-09-10, `path`: this is now the largest single thing between `path` and
// whole. `format` declines on both namespaces -- `no wrapper for format@posix:
// takes an object`, and the same for `@win32` -- and node's `path.format` takes
// a `ParsedPath`, so there is no signature to rewrite into. It costs three of
// the five test files `path` still fails: `test-path-parse-format.js` outright,
// two of 183 cases in `local/edge-inputs-static.js`, and three of the six
// findings in `local/export-surface-static.js`. The module is at 15 passed / 5
// failed compiled and 20 / 0 interpreted, so `format` is not hiding behind
// anything else in it.
//
// It also caught a control in a neighbouring fixture. `in-with-a-computed-key`
// first took its `Row` as a parameter, and its control was declined for this
// reason rather than for anything about `in`; it builds its own now.

interface Row {
  a: number;
  b: number;
}

export function returnsRow(a: number): Row {
  return { a, b: 0 };
}

export function takesRow(row: Row): number {
  return row.a;
}
