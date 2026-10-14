// expect: NTS1005 this statement, which module evaluation therefore skips, leaving `a`, `c` unwritten
//
// A module-scope destructuring that lowering skips leaves its *bindings*
// unwritten, and the consequence line has to name them: a reader of `c` is
// refused "because it reads `c`", and without `c` here nothing on the page
// says which line left it so -- `integrity`'s `cascade-has-root`. The line
// named nothing for a pattern, since the declaration itself has no name.
// `b` is a property name, not a binding, so it is not named.
//
// **A guard from the day it was written (2026-10-08)**, by MainClaude,
// re-derived from Codex 84711414b.
//
// Control in the same program: `kept` is declared plainly by a statement that
// lowers, and `control` reads it.
interface Pair {
  a: number;
  b: { c: number };
}

function make(): Pair {
  return { a: 1, b: { c: 2 } };
}

const { a, b: { c } }: Pair = Reflect.apply(make, undefined, []);
const kept = 5;

export function readC(n: number): number {
  return a + c + n;
}

export function control(n: number): number {
  return kept + n;
}
