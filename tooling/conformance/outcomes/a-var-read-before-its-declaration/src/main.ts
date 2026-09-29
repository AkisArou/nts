// A `var` read before its declaration runs is `undefined`; nts answers its
// initializer's value. Found by test262's types/boolean/S8.3_A1_T1.js. The
// same defect through a closure is outcomes/a-hoisted-var-read-through-a-
// closure, whose note says annotating `| undefined` makes nts agree; the
// control here does that and differs in the annotation only.
// @ts-expect-error -- JavaScript: a var is undefined before its declaration runs
observe("inferred", String(x));
observe("annotated", String(y));
var x = true;
var y: boolean | undefined = true;
done();
