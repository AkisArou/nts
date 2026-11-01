/*---
description: Control for properties-spread-over-default; represent presence explicitly.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces]
---*/
// Use the recorded presence flag to decide whether to overwrite the existing payload, then read explicit slots and key lists.
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
  const source: ExplicitProperty = { present, value, keys: present ? ["p"] : [] }, fallback = { id: 99 };
  const target: ExplicitProperty = { present: true, value: source.present ? source.value : fallback, keys: ["p"] }, key: "p" = "p";
  const expected = present ? value : fallback, p = target.value;
  for (const actual of [target.value, target.keys.includes(key) ? target.value : undefined, p]) same(actual, expected);
  same(target.keys.includes("p"), true); same(target.keys.includes(key), true);
  assert.compareArray(target.keys, ["p"]);
  same(encode(target), present ? json : '{"p":{"id":99}}');
  const original = source.present ? source.value : undefined;
  for (const actual of [source.present ? source.value : undefined, source.keys.includes(key) ? source.value : undefined, original]) same(actual, present ? value : undefined);
  same(source.keys.includes("p"), present); same(source.keys.includes(key), present);
  assert.compareArray(source.keys, present ? ["p"] : []); same(encode(source), json);
}
