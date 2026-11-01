/*---
description: Destructuring an optional property uses its default only for absent or undefined values.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-optional-properties, ts-destructuring, ts-spread]
---*/
// An optional field reaches a destructuring initializer; Node calls the fallback only for absence or undefined and leaves source presence intact.
type AbsentValue = number | string | boolean | null | undefined | { id: number };
interface OptionalProperty { p?: AbsentValue; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const point = { id: 7 };
const rows: [boolean, AbsentValue, string][] = [[false, point, '{}'], [true, undefined, '{}'], [true, null, '{"p":null}'],
  [true, 0, '{"p":0}'], [true, -0, '{"p":0}'], [true, "", '{"p":""}'], [true, NaN, '{"p":null}'],
  [true, false, '{"p":false}'], [true, point, '{"p":{"id":7}}']];
for (const [present, value, json] of rows) {
  const source: OptionalProperty = present ? { p: value } : {};
  const fallback = { id: 99 }; let calls = 0;
  function defaultValue(): AbsentValue { calls++; return fallback; }
  const { p = defaultValue() } = source, key: "p" = "p";
  const expected = !present || value === undefined ? fallback : value;
  same(p, expected); same(calls, !present || value === undefined ? 1 : 0);
  same(source.p, present ? value : undefined); same(source[key], present ? value : undefined);
  same("p" in source, present); same(Object.hasOwn(source, key), present);
  assert.compareArray(Object.keys(source), present ? ["p"] : []); same(JSON.stringify(source), json);
  const copy = { ...source }; same(copy.p, present ? value : undefined);
  same("p" in copy, present); same(Object.hasOwn(copy, key), present);
  assert.compareArray(Object.keys(copy), present ? ["p"] : []); same(JSON.stringify(copy), json);
}
