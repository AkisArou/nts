// An object whose `valueOf` returns a bigint, divided by a bigint: `/`
// converts the object to 2n first, so node answers 1. nts neither converts
// the object nor refuses it: lowering emits the division with an erased
// operand, and the verifier stops the build with invalid HIR (OperandType,
// found Erased) on C, LLVM and the JVM alike. From test262
// language/expressions/division bigint-toprimitive and bigint-wrapped-values
// (census of 2026-11-06 on pin e0395d27506b: ten no-verdict cases). The
// control, an-object-with-a-bigint-value-divided-by-a-bigint-control, calls
// `valueOf` itself and agrees. The defect stops the build, so the control is a
// fixture of its own.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
