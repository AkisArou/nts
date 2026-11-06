// Raising an object to an object's power converts both first: `**` calls each
// one's `valueOf`, so node answers 9. nts neither converts the objects nor
// refuses them: it hands both to the C helper for `**` as they are, the
// verifier lets the call through, and C rejects the program ("incompatible type
// for argument 1 of 'nts_math_pow'"). Typed `any`, the same operands compile
// and answer wrongly instead: the-power-operator-uses-an-any-operand-unconverted.
// From test262 language/expressions/exponentiation/exp-operator-evaluation-order
// (census of 2026-11-06 on pin e0395d27506b). The control,
// the-power-operator-on-objects-emits-c-that-does-not-compile-control, calls
// `valueOf` itself and agrees. The defect stops the build, so the control is a
// fixture of its own.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
