// run: build
//
// `~a` on a bigint is the bigint bitwise not, -(a + 1n), so node prints -6.
// nts lowers `~` as the number operator, which first converts its operand to a
// 32-bit integer, and its own verifier then rejects the program: "invalid HIR:
// OperandType { ... op: \"an integer coercion of something that is not a
// number\", found: BigInt }". test262 language/expressions/bitwise-not/bigint
// stops there in the census of 2026-11-06 on pin e0395d27506b. The control,
// a-bigint-bitwise-not-stops-the-build-control, negates the same bigint with
// unary minus and agrees. The defect stops the build, so the control is a
// fixture of its own.
const a: bigint = 5n;
observe("not", String(~a));
done();
