// run: build
//
// `**` on an operand typed `any` uses the value without converting it to a
// number. Node converts each operand first: `flag ** 2` is 1 for `flag = true`,
// and with `two` an object whose `valueOf` answers 2, `3 ** two` is 9 and
// `two ** 1` is 2. nts prints 0, 1 and "[object Object]", which is what taking
// each operand's stored value as a number's bits gives, and `x ** 1` hands back
// `x` itself. `Math.pow` with the same operands converts them, or names the
// object conversion it cannot do yet, so only the operator skips the
// conversion. The control, the-power-operator-uses-an-any-operand-unconverted-control,
// gives the same three operations operands that hold numbers, and agrees.
// Found from test262 language/expressions/exponentiation/exp-operator-evaluation-order,
// whose plain JavaScript form stops with C that does not compile (census of
// 2026-11-06 on pin e0395d27506b).
const flag: any = true;
const two: any = { valueOf(): number { return 2; } };
observe("flag ** 2", String(flag ** 2));
observe("3 ** two", String(3 ** two));
observe("two ** 1", String(two ** 1));
done();
