// **An explicit `undefined` at a parameter with a default is ignored, where
// JavaScript says it triggers the default.** `f(a, undefined)` and `f(a)` are the
// same call in the language -- `undefined` is exactly the value a defaulted
// parameter tests for -- and nts answers the `undefined`.
//
// The mechanism is the call site's and it only ever looks *past* the arguments
// that were written: `omitted_by_default` iterates the parameter shapes
// `.skip(provided)`, so an argument physically present at that index, whatever its
// value, means the default is never considered. The callee is given no absence
// test either, because the call site is where a default is filled.
//
// **The parameter's representation decides whether this is loud.** With a concrete
// one (`b: number = 5`) the `undefined` cannot be passed at all and the call
// refuses by name -- `` `null` or `undefined` where what it stands in for is not a
// reference `` -- which is honest. With an **erased** one it is an ordinary value
// to pass, nothing tests it, and the program answers it. So the right answer is
// already written, one representation over, which is what makes this a wrong
// answer rather than a gap.
//
// `unknown` reaches it today, and every unannotated JavaScript parameter reaches
// it once `any` represents as an erased value -- which is how it was found:
// `test/language/expressions/function/params-dflt-ref-arguments.js` under the
// JavaScript layout, whose failing assertion is "first parameter". That file's own
// default is `arguments[2]` and the `arguments` read is incidental; this is the
// cause.
//
// Fixing it is a decision rather than a clause, which is why this is a record.
// **Which `undefined`s are decidable:** a written literal is, `void 0` is, a
// variable holding one is not, and the language's rule is a run-time one. So
// either the call site substitutes the default for the syntactic cases and the
// rest still answers wrongly, or the **callee** gains an absence test for a
// defaulted parameter whose representation admits `undefined`, which is right for
// every case and moves where a default is evaluated -- a change to every call in
// the corpus.

function defaulted(a: number, b: unknown = 5): number {
  return a + (typeof b === "number" ? b : -1);
}

// The subject. node answers this exactly as it answers the control below.
observe("explicit undefined", String(defaulted(10, undefined)));

// The control, one difference away: the argument omitted, which the call site
// fills. It agrees, which is what says the defect is the written `undefined` and
// not the default.
observe("omitted", String(defaulted(10)));

// And the control that shows the honest answer exists: the same call at a
// *concrete* default refuses rather than answering, so this arm never reaches a
// wrong value. It is here as a reading of the boundary, not as an observation --
// `concreteOmitted` is what the compiler is allowed to compile.
function concrete(a: number, b: number = 5): number {
  return a + b;
}

observe("concrete, omitted", String(concrete(10)));

done();
