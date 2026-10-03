// **FIXED by `abc1564a9` (apply inferred parameter defaults to void arguments)
// and kept as a guard.** The call now fills every default and answers 234599 as
// node does. What it guards is the inferred-concrete case between an erased
// parameter (fixed by `85c062fc9`) and an annotated one.
//
// **An explicit `undefined` at a parameter whose type its default inferred was
// invalid HIR.** `defaulted(undefined, void 0)` where `defaulted(a = 23, b = 45,
// c = 99)`: the checker infers `number` for each parameter from its default, and
// lowering passes the `undefined` as a value to an `f64` slot, which the
// verifier rejects -- `CallArgumentType { callee: "defaulted", at: 1, expected:
// Float { bits: 64 }, found: Void }` -- so nothing is emitted. node answers
// 234599: every default fills.
//
// **A regression of `51bcef99c` (shared call-argument semantics, #32), not an old
// defect.** On a pin of a21b86581 this program was refused by name, "`null` or
// `undefined` where what it stands in for is not a reference", which is honest.
// After #32 the refusal was gone and the verifier caught what lowering built.
// The test262 census of 77b2457c5 shows it six ways: statements/function/
// dflt-params-arg-val-undefined.js as this invalid HIR, and five JavaScript twins
// (expressions/{function,arrow-function,generators} and async-function's named and
// nameless), whose parameters are untyped, as wrong answers where a default
// should have filled.
//
// What it wants is `85c062fc9`'s rule applied here too: a passed `undefined` at a
// parameter with a default takes the default. That fix covered an erased
// parameter (`unknown`) and left an annotated concrete one refusing by name; an
// *inferred* concrete one is the case between them.
//
// **Control, measured separately because invalid HIR erases every arm beside it:**
// the same function called with written values, `defaulted(23, 45)`, compiles and
// agrees (234599). One difference: the arguments are values, not `undefined`.

function defaulted(a = 23, b = 45, c = 99): number {
  return a * 10000 + b * 100 + c;
}

observe("an explicit undefined at an inferred defaulted parameter", String(defaulted(undefined, void 0)));
done();
