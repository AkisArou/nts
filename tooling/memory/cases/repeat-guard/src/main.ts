// `"x".repeat(n)` with a count the guard accepts, in a loop.
//
// The subject is the **guard**, not the repeat. `repeat` throws a `RangeError`
// for a negative or infinite count, and the runtime cannot: a handler is a
// block and a `throw` is a jump the lowering writes. So the test is emitted at
// the call — two comparisons and a branch — and the error is built only on the
// path that throws.
//
// Which is the thing this counts. A lowering that constructed the `RangeError`
// *before* testing, or on every call, would allocate one per iteration and
// still agree with node on every case: the object is thrown away unthrown, and
// nothing in the differential can see an allocation that changes no answer.
export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    total = (total + "ab".repeat(3).length) | 0;
  }
  return total;
}
