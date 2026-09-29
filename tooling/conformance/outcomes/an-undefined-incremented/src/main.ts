// `++` on `undefined` is ToNumber(undefined) + 1: NaN, and nts answers 1. A
// `var` with no initializer holds `undefined`, so test262's prefix-increment/
// S11.4.4_A3_T4.js and its seven siblings (prefix and postfix, increment and
// decrement) read 1 or -1. Assigning the `undefined` explicitly answers 1
// too, so the missing initializer is not the cause; `x = x + 1` on it is
// refused ("`null` or `undefined` where what it stands in for is not a
// reference"), so `++` alone converts silently. The control starts at 0 and
// differs in that value only.
// **Agrees since 1bf78c21d; a guard.** `step` now converts its operand by
// ToNumber before adding, so `undefined` steps to NaN. It was thought to need
// a definite-assignment analysis, and did not: the read settles to `number`
// either way, and the conversion is what was missing.
var bare;
// @ts-expect-error -- JavaScript: `++` on undefined is NaN, not an error
++bare;
var zero;
zero = 0;
++zero;
observe("bare", String(bare));
observe("zero", String(zero));
done();
