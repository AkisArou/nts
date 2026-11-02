/*---
description: Explicit metadata record control for A typeof-narrowed function union retains original function names and arities.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces, ts-unions, ts-narrowing]
---*/
// Explicit records: A Numeric-or-string parameter narrows before metadata reads; node distinguishes text from declarations, arrows and named expressions.
interface Metadata { label: string; arity: number; }
const unionZero: Metadata = { label: "unionZero", arity: 0 };
const unionArrow: Metadata = { label: "unionArrow", arity: 1 };
const unionExpression: Metadata = { label: "innerUnion", arity: 3 };
function observe(value: Metadata | string): [string, number] { if (typeof value === "object") return [value.label, value.arity]; return [value, -1]; }
const targets: (Metadata | string)[] = [unionZero, "text", unionArrow, "", unionExpression, unionZero];
const expected: [string, number][] = [["unionZero", 0], ["text", -1], ["unionArrow", 1], ["", -1], ["innerUnion", 3], ["unionZero", 0]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 6);
