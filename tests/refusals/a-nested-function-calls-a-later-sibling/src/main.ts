// expect: nothing refused -- FIXED, kept as a guard
//
// **Fixed 2026-10-07** (MainClaude): `first`'s closure is built after the
// later siblings it captures, at `first`'s own position, where everything
// they capture is already declared (`bind_later_siblings`); `nts check`
// agrees with node on 29 cases. A sibling that captures a `let` declared
// below `first` still stands where it is and is refused, since building it
// early would read the cell before anything wrote it. The report as filed:
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
