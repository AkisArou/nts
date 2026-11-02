/*---
description: Explicit metadata record control for Class field initializers infer function names before a function-typed parameter observes them.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces, ts-class, ts-class-fields, ts-static]
---*/
// Explicit records: A Numeric parameter carries instance and static function fields; node keeps the field names, a named expression inner name, and default or rest cutoffs.
interface Metadata { label: string; arity: number; }
class FunctionFields {
  emptyField: Metadata = { label: "emptyField", arity: 0 };
  oneField: Metadata = { label: "oneField", arity: 1 };
  namedField: Metadata = { label: "fieldInner", arity: 3 };
  defaultField: Metadata = { label: "defaultField", arity: 1 };
  static restField: Metadata = { label: "restField", arity: 0 };
}
const first = new FunctionFields(), second = new FunctionFields();
function observe(target: Metadata): [string, number] { return [target.label, target.arity]; }
const targets: Metadata[] = [first.emptyField, first.oneField, first.namedField, first.defaultField, FunctionFields.restField, second.oneField];
const expected: [string, number][] = [["emptyField", 0], ["oneField", 1], ["fieldInner", 3], ["defaultField", 1], ["restField", 0], ["oneField", 1]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 6);
