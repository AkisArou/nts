/*---
description: Explicit metadata record control for Named and inferred function expressions retain metadata when a typed field is replaced.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces]
---*/
// Explicit records: A Slot function field receives anonymous and named expressions; node keeps the original binding or inner name and each parameter cutoff.
interface Metadata { label: string; arity: number; }
interface Slot { fn: Metadata; }
const emptyExpression: Metadata = { label: "emptyExpression", arity: 0 };
const singleExpression: Metadata = { label: "singleExpression", arity: 1 };
const renamedExpression: Metadata = { label: "innerExpression", arity: 3 };
const stoppedExpression: Metadata = { label: "stoppedExpression", arity: 1 };
const restExpression: Metadata = { label: "restExpression", arity: 0 };
const slot: Slot = { fn: emptyExpression };
function observe(value: Metadata): [string, number] { slot.fn = value; const target = slot.fn; return [target.label, target.arity]; }
const targets: Metadata[] = [emptyExpression, singleExpression, renamedExpression, stoppedExpression, restExpression, emptyExpression];
const expected: [string, number][] = [["emptyExpression", 0], ["singleExpression", 1], ["innerExpression", 3], ["stoppedExpression", 1], ["restExpression", 0], ["emptyExpression", 0]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 6);
