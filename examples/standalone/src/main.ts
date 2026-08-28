// A program, rather than a library: what runs is the module's top-level code.
//
// That is what an executable *is* here, and it is what `node main.js` runs --
// which is also why `--main` makes module evaluation the reachability root
// rather than the exports. Nothing outside the program can call them.
//
// The point of this one is that it has work left when evaluation finishes: two
// timers, still pending. A program that exits before they run has a loop that
// gave up early; one that never exits has an idle handle it forgot to stop, or
// a referenced handle nothing will ever close. Termination *and* exit zero is
// the whole assertion, because a compiled program has nothing to print with.

let ticks = 0;

function record(): void {
  ticks = ticks + 1;
}

setTimeout(() => {
  record();
}, 1);

setTimeout(() => {
  record();
}, 5);

// Cleared before it can run, so shutdown has a dropped task to account for as
// well as two that ran.
//
// `let` with a constant initializer and then an assignment, rather than
// `const cancelled = setTimeout(...)`: a module-scope variable whose
// initializer is not constant is refused, and a refused statement loses the
// whole initializer -- every timer above it included. `nts check` catches that
// as disagreement with node rather than silently, which is how this was found.
let cancelled = 0;
cancelled = setTimeout(() => {
  record();
}, 10);
clearTimeout(cancelled);

export function readTicks(n: number): number {
  return ticks + n;
}
