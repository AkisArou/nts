// expect: NTS1001 an erased value where a concrete representation is wanted
//
// `1 * {}` is NaN in JavaScript (ToNumber through ToPrimitive). Until
// 093733f2d nts compiled it and answered the object's pointer read as a
// double -- a different number every run, with no refusal -- and this was an
// outcomes record of that wrong answer. It refuses now, and this blocker holds
// the refusal, so a return to the silent pointer-as-number fails here by name.
// Found by test262's asi/S7.9_A10_T1, T3 and T5. The control, outcomes/
// a-number-times-the-value-an-object-converts-to, multiplies by NaN and agrees.
// @ts-expect-error -- an object is converted to a number by `*`
const product = 1 * {};
if (!Number.isNaN(product)) throw new Error("1 * {}");
