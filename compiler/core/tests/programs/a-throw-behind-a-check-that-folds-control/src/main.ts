// Control for `a-throw-behind-a-check-that-folds` beside this one: the count
// is a parameter, so the check stays, and with it the throw and the
// `toString` the runtime prints the uncaught error by.
export function sized(n: number, count: number): number {
  if (count !== count >>> 0) throw new RangeError("Invalid array length");
  return n + count;
}
