/*---
description: Control for parameters-optional-argument-presence; make argument presence explicit.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator]
---*/
// A required flag and payload stand for the optional argument; explicit keys and JSON membership preserve the same observations.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type ArgumentSnapshot = { value: AbsentArgumentValue; count: number; present: boolean; own: boolean; keys: string[]; json: string };
function inspect(input: { present: boolean; value: AbsentArgumentValue }): ArgumentSnapshot {
  return { value: input.present ? input.value : undefined, count: input.present ? 1 : 0, present: input.present, own: input.present,
    keys: input.present ? ["0"] : [], json: !input.present || input.value === undefined ? "{}" : '{"0":' + JSON.stringify(input.value) + '}' };
}
const point = { id: 7 };
const rows: [boolean, AbsentArgumentValue, string][] = [
  [false, undefined, "{}"], [true, undefined, "{}"], [true, null, '{"0":null}'],
  [true, 0, '{"0":0}'], [true, -0, '{"0":0}'], [true, "", '{"0":""}'],
  [true, NaN, '{"0":null}'], [true, false, '{"0":false}'], [true, point, '{"0":{"id":7}}']
];
for (const [present, value, json] of rows) {
  const result = inspect({ present, value }), expected = value;
  same(result.value, expected); same(result.count, present ? 1 : 0);
  same(result.present, present); same(result.own, present);
  assert.compareArray(result.keys, present ? ["0"] : []); same(result.json, json);
}
