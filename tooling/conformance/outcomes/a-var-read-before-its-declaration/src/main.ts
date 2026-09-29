// A `var` read before its declaration runs is `undefined`; nts answers its
// initializer's value. Found by test262's types/boolean/S8.3_A1_T1.js. The
// same defect through a closure is outcomes/a-hoisted-var-read-through-a-
// closure, whose note says annotating `| undefined` makes nts agree; the
// control here does that and differs in the annotation only.
// @ts-expect-error -- JavaScript: a var is undefined before its declaration runs
// **Root, diagnosed 2026-09-29:** a definite-assignment analysis -- does an
// assignment dominate this read. The checker settles `x` to its assigned type
// at every reference, and a global's initial storage is the settled
// representation's zero, where the language says `undefined` (or a TDZ
// throw). Shared with a-var-read-before-its-declaration and a-let-read-
// before-its-declaration. an-undefined-incremented was thought to be a third
// and was not: converting in `step` closed it (1bf78c21d).
observe("inferred", String(x));
observe("annotated", String(y));
var x = true;
var y: boolean | undefined = true;
done();
