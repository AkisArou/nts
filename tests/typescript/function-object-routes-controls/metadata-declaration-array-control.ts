/*---
description: Explicit metadata record control for Declared functions retain names and parameter cutoffs through an array of one function type.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces]
---*/
// Explicit records: A Numeric array carries seven declarations; node preserves each declaration name and stops arity at the first default or rest.
interface Metadata { label: string; arity: number; }
function observe(target: Metadata): [string, number] { return [target.label, target.arity]; }
const targets: Metadata[] = [{ label: "metaZero", arity: 0 }, { label: "metaOne", arity: 1 }, { label: "metaThree", arity: 3 }, { label: "metaOptional", arity: 3 }, { label: "metaDefault", arity: 1 }, { label: "metaFirst", arity: 0 }, { label: "metaRest", arity: 1 }];
const expected: [string, number][] = [["metaZero", 0], ["metaOne", 1], ["metaThree", 3], ["metaOptional", 3], ["metaDefault", 1], ["metaFirst", 0], ["metaRest", 1]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 7);
