// **A read past the end of an array aborts; JavaScript answers `undefined`.**
// `xs[5]` on a `number[]` of length 2 is `undefined` in JavaScript (no `!` here,
// so no assertion is in play). nts refuses at run time --
// `nts: refused: index 5 is outside [0, 2)` -- and ends the program.
//
// This is the question behind a-bounds-check-removed-past-a-closures-shrink's
// eventual verdict: once that bounds check is restored, the read there aborts the
// same way, so that fixture shows CHANGED rather than FIXED until *this* one is
// decided. It is a decision about the read -- what a checked read does when the
// index is out of range and the slot's type is not optional -- separate from both
// length predicates. On the day the read answers `undefined`, this flips to FIXED.
const xs: number[] = [1, 2];
observe("in range", String(xs[1]));
observe("past the end", String(xs[5]));
done();
