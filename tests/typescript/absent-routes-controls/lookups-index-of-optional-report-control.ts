/*---
description: Control for lookups-index-of-optional-report; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-lookups, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions]
---*/
// A bounded search loop and explicit result presence/key list replace the lookup builtin and optional report reads.
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
for (const [value, encoded] of samples) for (const which of [0, 1, 2]) {
  const xs: AbsentValue[] = [value, undefined], other = { tag: "other" };
  const query: AbsentValue = which === 0 ? other : which === 1 ? undefined : value;
  let index = -1;
  for (let i = 0; i < xs.length; i++) if (xs[i] === query) { index = i; break; }
  const expectedIndex = which === 0 ? -1 : which === 1 ? (value === undefined ? 0 : 1) : Number.isNaN(value) ? -1 : 0;
  const exists = index >= 0 && index < xs.length, result = exists ? xs[index] : undefined;
  const report = { present: exists, value: result, keys: exists ? ["p"] : [] };
  const expected = expectedIndex === 0 ? value : undefined;
  same(index, expectedIndex); same(report.present ? report.value : undefined, expected);
  same(report.keys.includes("p"), expectedIndex >= 0); same(report.present, expectedIndex >= 0);
  assert.compareArray(report.keys, expectedIndex >= 0 ? ["p"] : []);
  const json = report.present && report.value !== undefined ? '{"p":' + JSON.stringify(report.value) + '}' : '{}';
  same(json, expectedIndex === 0 && value !== undefined ? '{"p":' + encoded + '}' : '{}');
}
