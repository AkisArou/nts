/*---
description: Control for lookups-map-optional-report; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-lookups, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces]
---*/
// A required entry list is searched explicitly; a presence flag, payload and recorded report keys replace Map absence and optional field reads.
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
interface LookupCache { values: [string, AbsentValue][] }
for (const [value, encoded] of samples) {
  const cache: LookupCache = { values: [["saved", value], ["empty", undefined]] };
  for (const key of ["saved", "missing", "empty", "missing", "saved"]) {
    let found = false, actual: AbsentValue = undefined;
    for (const entry of cache.values) if (entry[0] === key) { found = true; actual = entry[1]; break; }
    const report = { present: found, value: actual, keys: found ? ["p"] : [] };
    const expected = key === "saved" ? value : undefined, exists = key !== "missing";
    same(actual, expected); same(report.present ? report.value : undefined, expected); same(found, exists);
    same(report.keys.includes("p"), exists); same(report.present, exists);
    assert.compareArray(report.keys, exists ? ["p"] : []);
    const json = report.present && report.value !== undefined ? '{"p":' + JSON.stringify(report.value) + '}' : '{}';
    same(json, key === "saved" && value !== undefined ? '{"p":' + encoded + '}' : '{}');
  }
}
