/*---
description: An optional array field skips a computed index side effect until the array exists.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-optional-properties, ts-optional-chaining]
---*/
// A typed array field is absent, undefined, null or present; node evaluates the incremented index only on the live array.
type AbsentValue = number | string | boolean | null | undefined | { tag: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const point = { tag: "point" };
const samples: [AbsentValue, string, boolean, boolean][] = [
  [undefined, "null", true, true], [null, "null", true, true], [0, "0", false, true], [-0, "0", false, true],
  ["", '""', false, true], [NaN, "null", false, true], [false, "false", false, true],
  [point, '{"tag":"point"}', false, false], [7, "7", false, false], ["live", '"live"', false, false], [true, "true", false, false]
];
for (const [value, encoded] of samples) for (const mode of [0, 1, 2, 3]) {
  let keysRead = 0;
  const holder: { items?: AbsentValue[] | null } = mode === 0 ? {} : { items: mode === 1 ? undefined : mode === 2 ? null : [value] };
  const actual = holder.items?.[++keysRead - 1];
  same(actual, mode === 3 ? value : undefined); same(keysRead, mode === 3 ? 1 : 0);
  same("items" in holder, mode !== 0); same(Object.hasOwn(holder, "items"), mode !== 0);
  assert.compareArray(Object.keys(holder), mode === 0 ? [] : ["items"]);
  same(JSON.stringify(holder), mode < 2 ? "{}" : mode === 2 ? '{"items":null}' : '{"items":[' + encoded + ']}');
}
