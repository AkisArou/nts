// A closure written to answer a scalar kind, held where a signature answers a
// plain `number`: the admission beside the refusal of a closure answering
// another *kind* of value (`outcomes/a-var-redeclared-at-another-function-type`,
// a string read as a number).
//
// A number is a number at either width, so this is admitted, and it agrees.
// What the fixture shows, and no more: today the closure's result is lowered
// at `f64` -- a written kind narrows a root's boundary, not a closure's
// result -- so no integer-represented answer reaches the comparison. If one
// ever does, the call through the field unerases it at the signature's
// width, and this is the case that says whether that still agrees.

import type { Int32 } from "@nts/scalars";

const held: { answer: () => number } = { answer: (): Int32 => 5 as Int32 };

/** Called through the field, whose signature reads a number. */
export function throughTheField(n: number): number {
  return held.answer() + n;
}
