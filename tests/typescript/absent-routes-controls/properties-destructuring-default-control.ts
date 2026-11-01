/*---
description: Control for properties-destructuring-default; represent presence explicitly.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces]
---*/
// Branch on an explicit presence flag and required payload before calling the same initializer; record the source and copy keys explicitly.
type AbsentValue = number | string | boolean | null | undefined | { id: number };
interface ExplicitProperty { present: boolean; value: AbsentValue; keys: string[]; }
function encode(slot: ExplicitProperty): string {
  return slot.present && slot.value !== undefined ? '{"p":' + JSON.stringify(slot.value) + '}' : '{}';
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const point = { id: 7 };
const rows: [boolean, AbsentValue, string][] = [[false, point, '{}'], [true, undefined, '{}'], [true, null, '{"p":null}'],
  [true, 0, '{"p":0}'], [true, -0, '{"p":0}'], [true, "", '{"p":""}'], [true, NaN, '{"p":null}'],
  [true, false, '{"p":false}'], [true, point, '{"p":{"id":7}}']];
for (const [present, value, json] of rows) {
  const source: ExplicitProperty = { present, value, keys: present ? ["p"] : [] };
  const fallback = { id: 99 }; let calls = 0;
  function defaultValue(): AbsentValue { calls++; return fallback; }
  const p = !source.present || source.value === undefined ? defaultValue() : source.value, key: "p" = "p";
  const expected = !present || value === undefined ? fallback : value;
  same(p, expected); same(calls, !present || value === undefined ? 1 : 0);
  same(source.present ? source.value : undefined, present ? value : undefined); same(source.keys.includes(key) ? source.value : undefined, present ? value : undefined);
  same(source.keys.includes("p"), present); same(source.keys.includes(key), present);
  assert.compareArray(source.keys, present ? ["p"] : []); same(encode(source), json);
  const copy = { present: source.present, value: source.value, keys: source.keys.slice() }; same(copy.present ? copy.value : undefined, present ? value : undefined);
  same(copy.keys.includes("p"), present); same(copy.keys.includes(key), present);
  assert.compareArray(copy.keys, present ? ["p"] : []); same(encode(copy), json);
}
