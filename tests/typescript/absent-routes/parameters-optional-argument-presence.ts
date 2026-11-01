/*---
description: An optional union parameter preserves its value and distinguishes omitted from supplied undefined arguments.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-optional-parameters, ts-expressions]
---*/
// An optional union argument is omitted or supplied; node reads undefined for both but records only supplied argument keys.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type ArgumentSnapshot = { value: AbsentArgumentValue; count: number; present: boolean; own: boolean; keys: string[]; json: string };
function inspect(value?: AbsentArgumentValue): ArgumentSnapshot {
  return { value, count: arguments.length, present: 0 in arguments, own: Object.hasOwn(arguments, 0),
    keys: Object.keys(arguments), json: JSON.stringify(arguments) };
}
const point = { id: 7 };
const rows: [boolean, AbsentArgumentValue, string][] = [
  [false, undefined, "{}"], [true, undefined, "{}"], [true, null, '{"0":null}'],
  [true, 0, '{"0":0}'], [true, -0, '{"0":0}'], [true, "", '{"0":""}'],
  [true, NaN, '{"0":null}'], [true, false, '{"0":false}'], [true, point, '{"0":{"id":7}}']
];
for (const [present, value, json] of rows) {
  const result = present ? inspect(value) : inspect(), expected = value;
  same(result.value, expected); same(result.count, present ? 1 : 0);
  same(result.present, present); same(result.own, present);
  assert.compareArray(result.keys, present ? ["0"] : []); same(result.json, json);
}
