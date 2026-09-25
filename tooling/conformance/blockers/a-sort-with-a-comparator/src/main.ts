// expect: nothing refused

// `xs.sort(cmp)` -- the comparator form, which refused by name until 72605753:
// "a `sort` with a comparator, which would have to call back into it".
//
// This fixture filed three routes. The second was built: the sort is emitted
// as HIR, a stable bottom-up merge (`lower_sort_with`), with no runtime
// surface and all three backends answering. It does not inline the body.
// The merge *calls* the comparator as the function value it is, which is
// what answered "one inside a condition": the call's result is a value the
// branch reads, not a delivery into a loop the callback machinery built. A
// capturing arrow, a named function and anything else holding one work alike.
//
// Now a guard: this compiling again is the claim. The behaviour -- stable,
// NaN as 0, a comparator that mutates the array, `toSorted` -- is
// `examples/a-sort-with-a-comparator`, which node checks.

export function f(n: number): string {
  const xs = ["b", "a", String(n)];
  xs.sort((a, b) => (a < b ? -1 : 1));
  return xs[0]!;
}
