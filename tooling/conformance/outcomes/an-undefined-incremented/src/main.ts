// `++` on `undefined` is ToNumber(undefined) + 1: NaN, and nts answers 1. A
// `var` with no initializer holds `undefined`, so test262's prefix-increment/
// S11.4.4_A3_T4.js and its seven siblings (prefix and postfix, increment and
// decrement) read 1 or -1. Assigning the `undefined` explicitly answers 1
// too, so the missing initializer is not the cause; `x = x + 1` on it is
// refused ("`null` or `undefined` where what it stands in for is not a
// reference"), so `++` alone converts silently. The control starts at 0 and
// differs in that value only.
// **Root, diagnosed 2026-09-29:** a definite-assignment analysis -- does an
// assignment dominate this read. The checker settles `x` to its assigned type
// at every reference, and a global's initial storage is the settled
// representation's zero, where the language says `undefined` (or a TDZ
// throw). Shared with an-undefined-incremented, a-var-read-before-its-
// declaration and a-let-read-before-its-declaration -- not with
// an-object-incremented, whose read an assignment does dominate.
var bare;
// @ts-expect-error -- JavaScript: `++` on undefined is NaN, not an error
++bare;
var zero;
zero = 0;
++zero;
observe("bare", String(bare));
observe("zero", String(zero));
done();
