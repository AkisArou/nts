// Typechecks, and every export here must be REFUSED. Two different reasons.

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

// **A clock.** `Date.now()` and `new Date()` read wall time, which this runtime
// has no capability for — and which no differential could check even if it did,
// because node would answer with its instant and this with a later one. The
// same reason `Math.random` is absent.
export function rightNow(n: number): number {
  return Date.now() + n;
}

export function theCurrentInstant(n: number): number {
  return new Date().getTime() + n;
}
