/*---
description: A defaulted union parameter replaces omission and undefined while preserving null and other falsy values.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-default-parameters, ts-expressions]
---*/
// A union default replaces omission and undefined only; node preserves null and every falsy supplied value and calls the fallback exactly once.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type ArgumentSnapshot = { value: AbsentArgumentValue; count: number; present: boolean; own: boolean; keys: string[]; json: string };
const replacement = { id: 99 }; let fallbackCalls = 0;
function fallback(): AbsentArgumentValue { fallbackCalls++; return replacement; }
function inspect(value: AbsentArgumentValue = fallback()): ArgumentSnapshot {
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
  fallbackCalls = 0;
  const result = present ? inspect(value) : inspect(), expected = value === undefined ? replacement : value;
  same(result.value, expected); same(result.count, present ? 1 : 0);
  same(result.present, present); same(result.own, present);
  assert.compareArray(result.keys, present ? ["0"] : []); same(result.json, json);
  same(fallbackCalls, expected === replacement ? 1 : 0);
}
