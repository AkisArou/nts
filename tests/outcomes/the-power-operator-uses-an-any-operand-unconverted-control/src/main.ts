// run: build
//
// The control for the-power-operator-uses-an-any-operand-unconverted: the same
// three `**` operations on operands typed `any`, holding numbers this time. It
// prints what node prints for both programs: 1, 9 and 2.
const flag: any = 1;
const two: any = 2;
observe("flag ** 2", String(flag ** 2));
observe("3 ** two", String(3 ** two));
observe("two ** 1", String(two ** 1));
done();
