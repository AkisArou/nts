// Typechecks, and every export here must be REFUSED. Two different reasons.
// Clock reads live in the clock refusal fixtures: their wall-time results
// cannot be compared across separate Node and compiled executions.

// **The oracle.** `new Date(NaN).toISOString()` throws a RangeError in node, and
// a runtime helper here has no way to throw. Answering with a string instead is
// a divergence the differential cannot see — it scores node's throw as a case
// not reached rather than as a disagreement — so it is refused until a helper
// can throw. Both call sites in `runtime/node` guard it with
// `Number.isNaN(d.getTime())`, and the guard is on the value, which the
// lowering cannot see.
export function formatted(ms: number): number {
  return new Date(ms).toISOString().length;
}

// **A timezone database.** The `getFullYear` family reads a *local* calendar,
// which would make one program answer differently on two machines. Refused by
// name rather than answered in UTC and called close enough.
export function localYear(ms: number): number {
  return new Date(ms).getFullYear();
}

export function localHours(ms: number): number {
  return new Date(ms).getHours();
}

export function theOffset(ms: number): number {
  return new Date(ms).getTimezoneOffset();
}

