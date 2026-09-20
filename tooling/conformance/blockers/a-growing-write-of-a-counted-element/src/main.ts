// expect: nothing refused
//
// **This one compiles cleanly and aborts at run time**, which is why the
// expectation above is `nothing refused` rather than a diagnostic: there is no
// diagnostic. `blockers-check` compiles and does not run, so this fixture
// records the *shape* and the abort is stated here rather than asserted.
//
//     nts: refused: index 0 is outside [0, 0)
//
// `xs[0] = "ab"` on an empty array. The boundary, from ten arms against node:
//
//     number   grows      string   aborts
//     boolean  grows      object   aborts
//                         array    aborts
//
// and it does not depend on anything else that looked like it might — annotated
// (`const xs: string[] = []`) and evolving (`const xs = []`) both abort, and so
// does a non-empty array written one past its end (`const xs = ["q"]; xs[1] =
// "ab"`). `xs.push("ab")` grows a string array correctly, so the runtime can do
// this and only the index-write path cannot.
//
// `hir::array_write_may_grow` is where it is decided, in one place for all three
// backends, and its doc states the reason rather than hiding it: `rc.rs` pairs
// every store of a value that `may_hold_a_reference` with a load of what the
// slot held so the old reference can be released, and at `index == length` there
// is no such slot to load. So "a counted element keeps today's abort".
// `nts_append_slot` says the same from the runtime side: the new slot "is left
// holding whatever the allocation did", sound "for exactly the element types
// that take no reference count".
//
// **The decision is defensible and the failure mode is not.** A limitation that
// arrives as a diagnostic is one a caller can act on; this one arrives as an
// abort in a program that compiled, with nothing naming the construct. Either
// end would be an improvement: zero the appended slot so a counted store loads a
// null and releases nothing, which is what `zero_of` already produces for a
// managed type — or refuse the write by name.
//
// Pre-existing: identical on the binary built at 23666c14. Found on 2026-09-20
// from a *control* arm of `examples/an-array-of-nothing`, written to show that
// an unrelated fix had left the working path alone. It had not been working.

export function growsAStringArray(n: number): number {
  const xs: string[] = [];
  xs[0] = "ab";
  xs[1] = "cde";
  return xs[0].length * 10 + xs[1].length + n * 0;
}

/** The scalar arm beside it, which grows correctly and must keep doing so. */
export function growsANumberArray(n: number): number {
  const xs: number[] = [];
  xs[0] = n;
  xs[1] = n + 1;
  return xs[0] * 10 + xs[1];
}
