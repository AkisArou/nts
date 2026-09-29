// invalid HIR: `NotDominated { func: "module#init", ... }`. A `while` whose
// condition is an object literal -- always truthy -- declares a `var` in its
// body and breaks; the read after the loop uses a value no dominating block
// defines. The control, a-loop-whose-condition-is-true, differs in the
// condition only and agrees. Found by test262's statements/while/
// S12.6.2_A11.js, the smallest of 7 NotDominated files at e32be23f8 -- all
// loops (while, for-in, for-of, a continue) reading a `var` their body
// assigns; whether each is this one cause is not yet checked.
let seen = 0;
// @ts-expect-error -- an object is truthy, and JavaScript says so
while ({}) {
  var inner = 1;
  if (inner) break;
}
// @ts-expect-error -- a var assigned in the loop is read after it
seen = inner;
observe("seen", String(seen));
done();
