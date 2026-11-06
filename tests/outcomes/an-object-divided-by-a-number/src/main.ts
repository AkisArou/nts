// Dividing an object by a number converts the object first: `/` calls its
// `valueOf`, so node answers 1. nts neither converts the object nor refuses
// it: lowering emits the division with the object as an operand, and the
// verifier stops the build with invalid HIR (OperandsDiffer, Managed(Object)
// against Float) on C, LLVM and the JVM alike. From test262
// language/expressions/division and modulus (census of 2026-11-06 on pin
// e0395d27506b: twelve no-verdict cases with object operands in two invalid-HIR
// groups). The control, an-object-divided-by-a-number-control, calls
// `valueOf` itself and agrees. The defect stops the build, so the control is a
// fixture of its own.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
