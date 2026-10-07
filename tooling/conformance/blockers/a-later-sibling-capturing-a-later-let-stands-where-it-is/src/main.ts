// expect: NTS1001 a call of `second`, declared below this function, which captures a name declared after this function's declaration
//
// The arm a-nested-function-calls-a-later-sibling's fix must not take: a
// later sibling that captures a `let` declared below its caller. Built at
// `first`'s position, `second`'s closure would read `factor`'s cell before
// anything wrote it, so it stands where it is, and `first`'s capture of it is
// refused by name, at `first` -- a refusal, not a wrong answer. (Refused
// first as "a declaration outside every walk", which the integrity step read
// as a cascade with no root.) node answers 6: `factor`
// is written before `first()` runs; answering that needs the cell's
// temporal-dead-zone check at the read, which is the feature, and not a
// closure built early.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude.
//
// Control, one difference -- `let factor = 3;` above `first`: nothing refused,
// and nts check agrees with node.
export function go(n: number): number {
  const state = { total: 0 };
  function first(): void {
    state.total += n;
    second();
  }
  let factor = 3;
  function second(): void {
    state.total *= factor;
  }
  first();
  return state.total;
}
