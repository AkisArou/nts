/*---
description: Control for parameters-destructured-tuple-default; make argument presence explicit.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-tuples]
---*/
// A required first value and explicit second-slot flag replace the optional tuple; keys and length are recorded before the same default logic.
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
function inspect(input: { first: number; present: boolean; value: AbsentArgumentValue }): AbsentArgumentValue {
  same(input.first, 42); return !input.present || input.value === undefined ? fallback() : input.value;
}
for (const [present, value, expected, json] of rows) {
  calls = 0;
  const input = { first: 42, present, value };
  const result = inspect(input), length = present ? 2 : 1, found = present, own = present;
  const keys = present ? ["0", "1"] : ["0"], encoded = present ? "[42," + (value === undefined ? "null" : JSON.stringify(value)) + "]" : "[42]";
  same(result, expected); same(calls, expected === replacement ? 1 : 0);
  same(length, present ? 2 : 1); same(found, present); same(own, present);
  assert.compareArray(keys, present ? ["0", "1"] : ["0"]); same(encoded, json);
}
