/*---
description: Class field initializers infer function names before a function-typed parameter observes them.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-class, ts-class-fields, ts-static, ts-arrow-functions, ts-default-parameters, ts-rest-parameters]
---*/
// A Numeric parameter carries instance and static function fields; node keeps the field names, a named expression inner name, and default or rest cutoffs.
type Numeric = (a: number, b: number, c: number) => number;
class FunctionFields {
  emptyField: Numeric = (): number => 0;
  oneField: Numeric = (a: number): number => a;
  namedField: Numeric = function fieldInner(a: number, b: number, c: number): number { return a + b + c; };
  defaultField: Numeric = (a: number, b = 2, c?: number): number => a + b + (c ?? 0);
  static restField: Numeric = (...values: number[]): number => 0;
}
const first = new FunctionFields(), second = new FunctionFields();
function observe(target: Numeric): [string, number] { return [target.name, target.length]; }
const targets: Numeric[] = [first.emptyField, first.oneField, first.namedField, first.defaultField, FunctionFields.restField, second.oneField];
const expected: [string, number][] = [["emptyField", 0], ["oneField", 1], ["fieldInner", 3], ["defaultField", 1], ["restField", 0], ["oneField", 1]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 6);
