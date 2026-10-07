// expect: NTS1001 `second`, a declaration outside every walk
//
// A function declaration nested in a function is hoisted to the top of its
// body, so a sibling declared above it may call it. Here `first` calls
// `second`, declared after it, and `second` is refused as "a declaration
// outside every walk", taking `first`, `go` and their closures down with it
// (NTS1003). Found 2026-10-07 writing the Chromium lane's notes example,
// whose `render` calls `filter`, declared below it: the ordinary way to lay
// out an app's helpers inside its setup function.
//
// Control, one difference -- `second` declared above `first`: nothing
// refused, and with `console.log(go(3))` added `nts check` agrees with node
// (6).
export function go(n: number): number {
  const state = { total: 0 };
  function first(): void {
    state.total += n;
    second();
  }
  function second(): void {
    state.total *= 2;
  }
  first();
  return state.total;
}
