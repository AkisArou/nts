/*---
description: Control for lookups-find-first-optional-result; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-lookups, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-generics, ts-readonly]
---*/
// A bounded loop records every predicate input, and an explicit result presence flag and recorded report keys replace the builtin missing result.
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
  const result: { present: boolean; value: T | undefined } = { present: false, value: undefined };
  for (let index = 0; index < xs.length; index++) {
    const element = xs[index]; seen.push(element); indices.push(index);
    if (index === target) { result.present = true; result.value = element; break; }
  }
  return result.present ? result.value : undefined;
}
for (const [value, encoded] of samples) for (const target of [0, 2, 1]) {
  const xs: AbsentValue[] = [value, undefined], seen: AbsentValue[] = [], indices: number[] = [];
  const actual = locate(xs, target, seen, indices), exists = target < xs.length;
  const report = { present: exists, value: actual, keys: exists ? ["p"] : [] };
  const expected = target === 0 ? value : undefined, visited = target === 0 ? [0] : [0, 1];
  same(actual, expected); same(report.present ? report.value : undefined, expected); assert.compareArray(indices, visited); same(seen.length, visited.length);
  for (let i = 0; i < visited.length; i++) same(seen[i], visited[i] === 0 ? value : undefined);
  same(report.keys.includes("p"), exists); same(report.present, exists);
  assert.compareArray(report.keys, exists ? ["p"] : []);
  const json = report.present && report.value !== undefined ? '{"p":' + JSON.stringify(report.value) + '}' : '{}';
  same(json, target === 0 && value !== undefined ? '{"p":' + encoded + '}' : '{}');
}
