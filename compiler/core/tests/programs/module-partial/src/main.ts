// One unsupported statement at module scope, with good statements on either
// side of it.
//
// This used to cost the program *every* top-level statement. Eighteen of the
// nineteen node profile modules lost all module evaluation to a single
// `for...of` in `util/inspect` -- and when that one was fixed the number
// stayed at eighteen, because the next unsupported statement in the same file
// took over. It is a queue, and one line of it darkens eighteen modules.
//
// No `nts check` for it: the compiled program answers `0` where node answers
// `10`, which is the point. What is asserted is that `before` and `after` are
// still computed, and that the diagnostic names the line rather than the
// program.
let before = 0;
let between = 0;
let after = 0;

before = 1;

// Refused: destructuring in a `for...of` over an array literal.
for (const [a, b] of [
  [1, 2],
  [3, 4],
]) {
  between = between + a + b;
}

after = 2;

export function readBefore(n: number): number {
  return before + n;
}

export function readBetween(n: number): number {
  return between + n;
}

export function readAfter(n: number): number {
  return after + n;
}
