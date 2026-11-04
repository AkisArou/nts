/*---
description: "Control: Valid surrogate pairs at the four corners and at every text position encode as exact four-byte sequences."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-class, ts-class-fields, ts-static, ts-typeof-type, ts-function-types, ts-tuples]
---*/
// Control: encodeURIComponent through a static typed function field; valid surrogate pairs at the four corners and at every text position encode as exact four-byte sequences.
// Node prints: component-pairs:8
let controlIndex: number = 0;
const controlResults: string[] = ["%F0%90%80%80", "%F0%90%8F%BF", "%F4%8F%B0%80", "%F4%8F%BF%BF", "%F0%90%80%80xy", "x%F4%8F%BF%BFy", "xy%F0%9F%98%80", "%F0%90%80%80%F4%8F%BF%BF"];
function literalEncoding(_value: string): string { return controlResults[controlIndex++]; }
class StaticUriEncoder { static convert: (value: string) => string = literalEncoding; }
const route: typeof StaticUriEncoder = StaticUriEncoder;
const rows: [string, string, number[]][] = [
  ["\ud800\udc00", "%F0%90%80%80", [55296, 56320]],
  ["\ud800\udfff", "%F0%90%8F%BF", [55296, 57343]],
  ["\udbff\udc00", "%F4%8F%B0%80", [56319, 56320]],
  ["\udbff\udfff", "%F4%8F%BF%BF", [56319, 57343]],
  ["\ud800\udc00xy", "%F0%90%80%80xy", [55296, 56320, 120, 121]],
  ["x\udbff\udfffy", "x%F4%8F%BF%BFy", [120, 56319, 57343, 121]],
  ["xy\ud83d\ude00", "xy%F0%9F%98%80", [120, 121, 55357, 56832]],
  ["\ud800\udc00\udbff\udfff", "%F0%90%80%80%F4%8F%BF%BF", [55296, 56320, 56319, 57343]],
];
let checked: number = 0;
for (const [input, expected, expectedUnits] of rows) {
  const units: number[] = [];
  for (let index = 0; index < input.length; index++) units.push(input.charCodeAt(index));
  assert.compareArray(units, expectedUnits);
  assert.sameValue(route.convert(input), expected); checked++;
}
assert.sameValue(checked, 8);
console.log("component-pairs:" + checked);
