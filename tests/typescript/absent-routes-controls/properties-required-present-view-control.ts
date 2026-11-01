/*---
description: Control for properties-required-present-view; represent presence explicitly.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces]
---*/
// Use aliases of one explicit presence record in place of Partial and Required views, retaining known-present undefined and every other input.
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
  if (!present) continue;
  const source: ExplicitProperty = { present: true, value, keys: ["p"] };
  const optional: ExplicitProperty = source, required: ExplicitProperty = source;
  same(optional, source); same(required, source); same(optional.present ? optional.value : undefined, value);
  observe(required, true, value, json);
}
