// run: check
//
// **A closure held by a module-scope `var` reads a stale value of a `var` that
// a block declares a second time.** `var x` in a block is the same binding as
// the module's `var x` -- a `var` has no block scope -- so the block's
// initializer is an assignment to the one `x`, and every closure reading `x`
// reads `'inside'` afterwards. nts answers `'outside'` through the closure
// stored in `probeBefore`, while reading `x` directly answers `'inside'`.
//
// Found by the test262 census of `1cc41dd03` (a module-scope `var` holding a
// closure gets a closure-typed global): two files went from refused to this
// wrong answer, `statements/block/scope-var-none.js` and
// `statements/try/scope-catch-block-var-none.js`, both failing
// "reference preceding statement". Before `1cc41dd03` the program refused at
// `probeBefore`, so the defect was there and unreachable.
//
// **The mechanism, read from the emitted C**: the block's `var x = "inside"`
// is lowered as a fresh local definition rather than a store to the module
// global `x`. A later direct read of `x` resolves to that local and agrees;
// the closure body reads the global, which still holds `"outside"`.
//
// The control differs in one thing: the block **assigns** `y` instead of
// redeclaring it. If the control agrees and the defect arm does not, the
// redeclaration is the cause, not the closure global. Every declaration comes
// before the first `observe`, because a closure-typed global needs no
// statement that can run code ahead of its own declaration -- which is also why
// this is `run: check`: the `build` harness is prepended, and its `class
// Observed extends Error` is such a statement, so no `build` outcome can reach
// a closure-typed global at all.

var x = "outside";
var probeBefore = function (): string {
  return x;
};
var y = "outside";
var probeY = function (): string {
  return y;
};
{
  var x = "inside";
}
{
  y = "inside";
}

/** The length of what the closure reads after the block: 6 is "inside", 7 is "outside". */
export function redeclaredThroughTheClosure(n: number): number {
  return probeBefore().length + n * 0;
}

/** Control: the block assigns instead of redeclaring. */
export function assignedThroughTheClosure(n: number): number {
  return probeY().length + n * 0;
}
