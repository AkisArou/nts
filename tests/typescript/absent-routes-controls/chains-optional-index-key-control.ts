/*---
description: Control for chains-optional-index-key; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions]
---*/
// A required array payload and presence flag guard key evaluation, and a length check guards the actual element read.
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
  const holder = { present: mode !== 0, value: mode < 2 ? undefined : mode === 2 ? null : [value] };
  const keys = holder.present ? ["items"] : [], current = holder.present ? holder.value : undefined;
  let actual: AbsentValue = undefined;
  if (current !== undefined && current !== null) { const index = ++keysRead - 1; if (index >= 0 && index < current.length) actual = current[index]; }
  same(actual, mode === 3 ? value : undefined); same(keysRead, mode === 3 ? 1 : 0);
  same(keys.includes("items"), mode !== 0); same(holder.present, mode !== 0);
  assert.compareArray(keys, mode === 0 ? [] : ["items"]);
  const json = !holder.present || holder.value === undefined ? "{}" : '{"items":' + JSON.stringify(holder.value) + '}';
  same(json, mode < 2 ? "{}" : mode === 2 ? '{"items":null}' : '{"items":[' + encoded + ']}');
}
