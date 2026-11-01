/*---
description: A destructured optional tuple parameter defaults an absent or undefined slot without confusing other falsy values.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-tuples, ts-tuple-optional, ts-tuple-labels, ts-destructuring, ts-default-parameters, ts-expressions]
---*/
// An optional tuple slot reaches a destructured parameter; node defaults absent and undefined slots while retaining tuple ownership and null.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const point = { id: 7 }, replacement = { id: 99 };
const rows: [boolean, AbsentArgumentValue, AbsentArgumentValue, string][] = [
  [false, undefined, replacement, "[42]"], [true, undefined, replacement, "[42,null]"], [true, null, null, "[42,null]"],
  [true, 0, 0, "[42,0]"], [true, -0, -0, "[42,0]"], [true, "", "", '[42,""]'],
  [true, NaN, NaN, "[42,null]"], [true, false, false, "[42,false]"], [true, point, point, '[42,{"id":7}]']
];
let calls = 0;
function fallback(): AbsentArgumentValue { calls++; return replacement; }
function inspect([first, value = fallback()]: [first: number, value?: AbsentArgumentValue]): AbsentArgumentValue {
  same(first, 42); return value;
}
for (const [present, value, expected, json] of rows) {
  calls = 0;
  const input: [first: number, value?: AbsentArgumentValue] = present ? [42, value] : [42];
  const result = inspect(input), length = input.length, found = 1 in input, own = Object.hasOwn(input, 1);
  const keys = Object.keys(input), encoded = JSON.stringify(input);
  same(result, expected); same(calls, expected === replacement ? 1 : 0);
  same(length, present ? 2 : 1); same(found, present); same(own, present);
  assert.compareArray(keys, present ? ["0", "1"] : ["0"]); same(encoded, json);
}
