/*---
description: A Partial view carries a missing or stored field through all reads and spread; Node keeps absence distinct from own undefined.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-utility-types, ts-mapped-types, ts-type-operators, ts-optional-properties, ts-destructuring, ts-spread]
---*/
// A Partial view carries a missing or stored field through all reads and spread; Node keeps absence distinct from own undefined.
type AbsentValue = number | string | boolean | null | undefined | { id: number };
interface CompleteProperty { p: AbsentValue; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(source: Partial<CompleteProperty>, present: boolean, expected: AbsentValue, json: string): void {
  const key: "p" = "p", copy = { ...source };
  for (const view of [source, copy]) {
    const { p } = view;
    for (const actual of [view.p, view[key], p]) same(actual, expected);
    same("p" in view, present); same(Object.hasOwn(view, key), present);
    same("missing" in view, false); same(Object.hasOwn(view, "missing"), false);
    assert.compareArray(Object.keys(view), present ? ["p"] : []);
    same(JSON.stringify(view), json);
  }
}
const point = { id: 7 };
const rows: [boolean, AbsentValue, string][] = [[false, point, '{}'], [true, undefined, '{}'], [true, null, '{"p":null}'],
  [true, 0, '{"p":0}'], [true, -0, '{"p":0}'], [true, "", '{"p":""}'], [true, NaN, '{"p":null}'],
  [true, false, '{"p":false}'], [true, point, '{"p":{"id":7}}']];
for (const [present, value, json] of rows) {
  const source: Partial<CompleteProperty> = present ? { p: value } : {};
  observe(source, present, present ? value : undefined, json);
}
