/*---
description: indexOf failure stays -1 while an undefined match creates a present optional report field.
features: [ts-absent-routes, ts-absent-route-lookups, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-optional-properties]
---*/
// A union-valued array is searched with indexOf; node reports -1 for no match and preserves presence for a matched undefined element.
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
  const index = xs.indexOf(query), expectedIndex = which === 0 ? -1 : which === 1 ? (value === undefined ? 0 : 1) : Number.isNaN(value) ? -1 : 0;
  const report: { p?: AbsentValue } = index < 0 ? {} : { p: xs[index] };
  const expected = expectedIndex === 0 ? value : undefined;
  same(index, expectedIndex); same(report.p, expected);
  same("p" in report, expectedIndex >= 0); same(Object.hasOwn(report, "p"), expectedIndex >= 0);
  assert.compareArray(Object.keys(report), expectedIndex >= 0 ? ["p"] : []);
  same(JSON.stringify(report), expectedIndex === 0 && value !== undefined ? '{"p":' + encoded + '}' : '{}');
}
