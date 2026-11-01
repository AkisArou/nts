/*---
description: A Map held in an interface distinguishes absent gets from stored undefined when projecting an optional report.
features: [ts-absent-routes, ts-absent-route-lookups, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-map-set, ts-readonly, ts-optional-properties]
---*/
// A typed cache alternates saved, missing and explicitly undefined keys; node returns undefined for both missing forms but creates a report field only for present keys.
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
interface LookupCache { values: ReadonlyMap<string, AbsentValue> }
for (const [value, encoded] of samples) {
  const cache: LookupCache = { values: new Map([["saved", value], ["empty", undefined]]) };
  for (const key of ["saved", "missing", "empty", "missing", "saved"]) {
    const found = cache.values.has(key), actual = cache.values.get(key);
    const report: { p?: AbsentValue } = found ? { p: actual } : {};
    const expected = key === "saved" ? value : undefined, exists = key !== "missing";
    same(actual, expected); same(report.p, expected); same(found, exists);
    same("p" in report, exists); same(Object.hasOwn(report, "p"), exists);
    assert.compareArray(Object.keys(report), exists ? ["p"] : []);
    same(JSON.stringify(report), key === "saved" && value !== undefined ? '{"p":' + encoded + '}' : '{}');
  }
}
