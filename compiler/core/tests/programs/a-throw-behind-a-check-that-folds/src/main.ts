// A throw behind a check that folds. 8 is a valid array length, so the
// `RangeError` the check throws for any other is never made, and the block
// throwing it goes when the check is decided. That error kept its class's
// `toString` reachable -- the runtime prints an uncaught error by it -- and
// once the throw is gone nothing calls it, so the call graph is pruned again
// after the decision: a C `static` nothing calls is refused under `-Werror`.
// Checked by the C backend's `execute` tests, with the control
// `a-throw-behind-a-check-that-folds-control` beside this one, where the
// count is a parameter and the throw survives.
export function sized(n: number): number {
  const count = 8;
  if (count !== count >>> 0) throw new RangeError("Invalid array length");
  return n + count;
}
