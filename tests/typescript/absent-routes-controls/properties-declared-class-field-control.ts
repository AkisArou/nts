/*---
description: Control for properties-declared-class-field; represent presence explicitly.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces]
---*/
// Replace optional storage, property reads, reflection and spread with a presence flag, required payload, recorded keys and an explicit copy; preserve all inputs and observations.
type AbsentValue = number | string | boolean | null | undefined | { id: number };
interface ExplicitProperty { present: boolean; value: AbsentValue; keys: string[]; }
function encode(slot: ExplicitProperty): string {
  return slot.present && slot.value !== undefined ? '{"p":' + JSON.stringify(slot.value) + '}' : '{}';
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(source: ExplicitProperty, present: boolean, expected: AbsentValue, json: string): void {
  const key: "p" = "p", copy = { present: source.present, value: source.value, keys: source.keys.slice() };
  for (const view of [source, copy]) {
    const p = view.present ? view.value : undefined;
    for (const actual of [view.present ? view.value : undefined, view.keys.includes(key) ? view.value : undefined, p]) same(actual, expected);
    same(view.keys.includes("p"), present); same(view.keys.includes(key), present);
    same(view.keys.includes("missing"), false); same(view.keys.includes("missing"), false);
    assert.compareArray(view.keys, present ? ["p"] : []);
    same(encode(view), json);
  }
}
const point = { id: 7 };
const rows: [boolean, AbsentValue, string][] = [[false, point, '{}'], [true, undefined, '{}'], [true, null, '{"p":null}'],
  [true, 0, '{"p":0}'], [true, -0, '{"p":0}'], [true, "", '{"p":""}'], [true, NaN, '{"p":null}'],
  [true, false, '{"p":false}'], [true, point, '{"p":{"id":7}}']];
for (const [present, value, json] of rows) {
  const source: ExplicitProperty = { present, value, keys: present ? ["p"] : [] };
  observe(source, present, present ? value : undefined, json);
}
