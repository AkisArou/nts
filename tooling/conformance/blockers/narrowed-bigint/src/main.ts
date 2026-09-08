// expect: lowers
//
// **FIXED in ac27dac4-era, kept as a guard.** Nothing refuses. Spelled `lowers` rather than `nothing refused`
// because the latter also requires the wrapper to carry it, and the
// wrapper's limits here are somebody else's blocker.
//
// The filing below is kept because what it argued is why the fix took the
// shape it did.
//
//
// One of the three roots of `internal/errors.ts`'s `determineSpecificType`,
// which is the largest lowering blocker in this profile: it gates eleven of
// `path`'s exports through `validateString` and `ERR_INVALID_ARG_TYPE`, and two
// more in `async_hooks`.
//
// The narrowing is the refusal, not the conversion. `String(v)` refuses exactly
// where the template does, an `if` behaves as a `switch` arm does, and a
// parameter *declared* `bigint` compiles. And node's own
// `lib/internal/errors.js:996` is this function line for line, so there is no
// faithful rewrite that avoids it -- the only place it can be fixed is here.
export function describe(value: unknown): string {
  if (typeof value === "bigint") {
    return `type bigint (${value}n)`;
  }
  return "other";
}
