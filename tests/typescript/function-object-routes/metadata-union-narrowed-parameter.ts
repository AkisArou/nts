/*---
description: A typeof-narrowed function union retains original function names and arities.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-unions, ts-narrowing, ts-arrow-functions, ts-default-parameters]
---*/
// A Numeric-or-string parameter narrows before metadata reads; node distinguishes text from declarations, arrows and named expressions.
type Numeric = (a: number, b: number, c: number) => number;
function unionZero(): number { return 0; }
const unionArrow = (a: number, b = 1): number => a + b;
const unionExpression = function innerUnion(a: number, b: number, c: number): number { return a + b + c; };
function observe(value: Numeric | string): [string, number] { if (typeof value === "function") return [value.name, value.length]; return [value, -1]; }
const targets: (Numeric | string)[] = [unionZero, "text", unionArrow, "", unionExpression, unionZero];
const expected: [string, number][] = [["unionZero", 0], ["text", -1], ["unionArrow", 1], ["", -1], ["innerUnion", 3], ["unionZero", 0]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 6);
