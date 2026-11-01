/*---
description: findLast through a generic optional result distinguishes matched undefined from no match in its report.
features: [ts-absent-routes, ts-absent-route-lookups, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-generics, ts-readonly, ts-optional-properties, ts-arrow-functions]
---*/
// A generic T | undefined result from findLast reaches an optional field; node preserves every payload and the complete reverse search trace.
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
function locate<T>(xs: readonly T[], target: number, seen: T[], indices: number[]): T | undefined {
  return xs.findLast((element, index) => { seen.push(element); indices.push(index); return index === target; });
}
for (const [value, encoded] of samples) for (const target of [0, 2, 1]) {
  const xs: AbsentValue[] = [value, undefined], seen: AbsentValue[] = [], indices: number[] = [];
  const actual = locate(xs, target, seen, indices), exists = target < xs.length;
  const report: { p?: AbsentValue } = exists ? { p: actual } : {};
  const expected = target === 0 ? value : undefined, visited = target === 1 ? [1] : [1, 0];
  same(actual, expected); same(report.p, expected); assert.compareArray(indices, visited); same(seen.length, visited.length);
  for (let i = 0; i < visited.length; i++) same(seen[i], visited[i] === 0 ? value : undefined);
  same("p" in report, exists); same(Object.hasOwn(report, "p"), exists);
  assert.compareArray(Object.keys(report), exists ? ["p"] : []);
  same(JSON.stringify(report), target === 0 && value !== undefined ? '{"p":' + encoded + '}' : '{}');
}
