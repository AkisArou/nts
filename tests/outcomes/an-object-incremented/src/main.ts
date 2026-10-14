// `++` on an object is ToNumber(ToPrimitive({})) + 1 = Number("[object
// Object]") + 1: NaN, and nts answers 1. Found by test262's prefix-increment/
// S11.4.4_A4_T5.js and prefix-decrement/S11.4.5_A4_T5.js. `{} * 1` is refused
// (blockers/a-number-times-an-empty-object), so `++` alone converts silently,
// as it does for `undefined` (outcomes/an-undefined-incremented). The control
// increments a number and differs in the operand only.
var obj = {};
// @ts-expect-error -- JavaScript: `++` on an object is NaN, not an error
const inc = ++obj;
var num = 1;
const ctl = ++num;
observe("obj", String(inc));
observe("num", String(ctl));
done();
