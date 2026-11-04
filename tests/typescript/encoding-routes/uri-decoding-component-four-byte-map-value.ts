/*---
description: "decodeURIComponent through a narrowed Map.get function value: four-byte UTF-8 produces exact surrogate pairs at both scalar boundaries."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-map-set, ts-narrowing, ts-errors, ts-function-types, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// decodeURIComponent; a narrowed Map.get function value; four-byte UTF-8 produces exact surrogate pairs at both scalar boundaries.
// Node prints: 55296,56320|55357,56832|56319,57343
const readers: Map<string, (text: string) => string> = new Map();
readers.set("component", decodeURIComponent);
const convert = readers.get("component");
if (convert === undefined) throw new Error("missing reader");
const rows: [string, string, number[]][] = [
  ["%F0%90%80%80", "\ud800\udc00", [55296, 56320]],
  ["%f0%9f%98%80", "\ud83d\ude00", [55357, 56832]],
  ["%F4%8F%BF%BF", "\udbff\udfff", [56319, 57343]],
];
const log: string[] = [];
for (const [input, expected, expectedUnits] of rows) {
  const result: string = convert(input);
  assert.sameValue(result, expected);
  const actualUnits: number[] = [];
  for (let index = 0; index < result.length; index++) actualUnits.push(result.charCodeAt(index));
  assert.compareArray(actualUnits, expectedUnits);
  log.push(actualUnits.join(","));
}
console.log(log.join("|"));
