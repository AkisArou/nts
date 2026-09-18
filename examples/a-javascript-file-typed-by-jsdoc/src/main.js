// A `.js` file carrying its types in JSDoc, compiled like any other source.
//
// This is not a lesser input. `@param {number}` is a type annotation the
// checker enforces exactly as `x: number` does, and npm ships a great deal of
// exactly this shape -- a package that is JavaScript on disk and fully typed to
// anyone reading it through TypeScript.
//
// The frontend already handled it: tsgo resolves `.js` under `allowJs` and the
// snapshot carries the JSDoc types through, so these functions lower to the
// same HIR their `.ts` twins would. What did not handle it was the snapshot
// cache's project listing, which walked `.ts` and `.tsx` only -- so a `.js`
// file *added* to a project was invisible and the cache served a program with a
// function missing. `entry.read` hashes every file tsgo read, which caught an
// edit; nothing caught an addition.
//
// # The control is the absence of the annotations, not a `.ts` twin
//
// The first draft of this example carried a `.ts` twin of each export, on the
// reasoning that a `.js`-only file would pass whether or not the JSDoc types
// were read. Both halves of that were wrong.
//
// The twin was **never driven**. With two source files the differential drives
// one module's exports: `checked 116 cases across 3 function(s)` while the
// prepared HIR exports six, and the case count stayed at 116 rather than
// doubling. An arm that cannot fail is worse than no arm, because it reads as
// coverage.
//
// (The first attempt to show that edited one half and expected a failure. It is
// not a test of anything: the differential's oracle is **node running this same
// source**, so changing the source moves both sides together and they agree by
// construction. The case count is the evidence; the sabotage was not.)
//
// And the control it was there to provide already exists, in the file itself:
// delete the JSDoc and the same source is a **TS7006 typecheck failure**,
// `Parameter 'value' implicitly has an 'any' type`. A JSDoc type that was
// ignored would not make this compile to something wrong; it would stop it
// compiling. So the annotations below are load-bearing, and their absence is
// checkable in one edit.

/**
 * @param {number} value
 * @returns {number}
 */
export function doubled(value) {
  return value * 2;
}

/**
 * @param {number} left
 * @param {number} right
 * @returns {number}
 */
export function larger(left, right) {
  return left > right ? left : right;
}

/**
 * A narrower type than the body needs, so the annotation is doing work: without
 * it `value` would be implicitly `any` and refused.
 *
 * @param {number} value
 * @returns {number}
 */
export function clamped(value) {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}
