/*---
description: Spreading an optional property keeps an earlier default only when the key is absent.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-optional-properties, ts-destructuring, ts-spread]
---*/
// An optional interface is spread over an existing p; Node preserves the fallback for absence but overwrites it with a present undefined.
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
  const source: OptionalProperty = present ? { p: value } : {}, fallback = { id: 99 };
  const target = { p: fallback, ...source }, key: "p" = "p";
  const expected = present ? value : fallback, { p } = target;
  for (const actual of [target.p, target[key], p]) same(actual, expected);
  same("p" in target, true); same(Object.hasOwn(target, key), true);
  assert.compareArray(Object.keys(target), ["p"]);
  same(JSON.stringify(target), present ? json : '{"p":{"id":99}}');
  const { p: original } = source;
  for (const actual of [source.p, source[key], original]) same(actual, present ? value : undefined);
  same("p" in source, present); same(Object.hasOwn(source, key), present);
  assert.compareArray(Object.keys(source), present ? ["p"] : []); same(JSON.stringify(source), json);
}
