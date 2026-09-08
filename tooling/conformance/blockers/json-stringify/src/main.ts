// expect: NTS1001 `JSON.stringify`, a global member with no definition here
//
// `JSON` is in §16's **gap** column, not the not-a-goal column, so this is a
// blocker rather than a declared limit — and it had no fixture while it sat
// behind four other refusals in the same function.
//
// It is the current head of the longest chain in this profile.
// `determineSpecificType` in `internal/errors.ts` is a `switch (typeof value)`
// where every arm is its own lowering problem, and clearing one reveals the
// next:
//
//     an `unknown` narrowed to BigInt        errors.ts:34   fixed
//     an `unknown` narrowed to Symbol        (behind it)    fixed
//     `String(symbol)`                       errors.ts:53   fixed
//     `toString` on a number, radix          errors.ts:463  open
//     `JSON.stringify`                       errors.ts:70   **here**
//
// Its cone in `os` is **96 functions** and it gates `getPriority` and
// `setPriority` through `validateInt32` -> `ERR_INVALID_ARG_TYPE`. Every module
// imports `internal/errors.ts`, so the same head sits under every argument
// check in the profile.
//
// The use is not decorative and not avoidable by writing it differently. Node's
// `determineSpecificType` reports a string argument as `type string ('abc')`
// and switches to `JSON.stringify` exactly when the value contains a single
// quote, so that the message stays parseable. Reproducing that without
// `JSON.stringify` means reimplementing JavaScript string escaping, which is
// what `inspectString` two hundred lines below already had to do for the
// control range and is recorded there as a thing that agrees with node "on
// almost nothing".

export function describe(value: unknown): string {
  if (typeof value === "string") {
    if (value.indexOf("'") === -1) {
      return `type string ('${value}')`;
    }
    return `type string (${JSON.stringify(value)})`;
  }
  return "not a string";
}

export function touch(): string {
  return describe("it's");
}
