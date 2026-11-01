/*---
description: A present field including undefined survives Partial and Required views of the same object.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-utility-types, ts-mapped-types, ts-type-operators, ts-unknown, ts-destructuring, ts-spread]
---*/
// Known-present unknown-valued fields pass to Partial and Required views; Node keeps own undefined present, payloads exact and aliases identical.
type AbsentValue = number | string | boolean | null | undefined | { id: number };
interface RequiredInput { p: unknown; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(source: Required<Partial<RequiredInput>>, present: boolean, expected: unknown, json: string): void {
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
  if (!present) continue;
  const source: RequiredInput = { p: value };
  const optional: Partial<RequiredInput> = source;
  const required: Required<Partial<RequiredInput>> = source;
  same(optional, source); same(required, source); same(optional.p, value);
  observe(required, true, value, json);
}
