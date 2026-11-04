/*---
description: "Control: Map-selected encoder and plain function values keep distinct targets, with exact escaping of percent and multibyte text."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-map-set, ts-function-types, ts-narrowing, ts-null-undefined, ts-arrow-functions, ts-tuples, ts-errors]
---*/
// Control: encodeURI through typed function values read from Map.get; map-selected encoder and plain function values keep distinct targets, with exact escaping of percent and multibyte text.
// Node prints: uri-map:8
let controlIndex: number = 0;
const controlResults: string[] = ["a%20b+%25", "%C3%A9/?#", "%25E2%2582%25AC", ""];
function literalEncoding(_value: string): string { return controlResults[controlIndex++]; }
const routes: Map<string, (value: string) => string> = new Map();
routes.set("plain", (value: string): string => "plain:" + value);
routes.set("escape", literalEncoding);
const keys: string[] = ["plain", "escape"];
const rows: [string, string, string][] = [
  ["a b+%", "plain:a b+%", "a%20b+%25"],
  ["\u00e9/?#", "plain:\u00e9/?#", "%C3%A9/?#"],
  ["%E2%82%AC", "plain:%E2%82%AC", "%25E2%2582%25AC"],
  ["", "plain:", ""],
];
let checked: number = 0;
for (const row of rows) for (let index = 0; index < keys.length; index++) {
  const convert = routes.get(keys[index]);
  if (convert === undefined) throw new Error("missing converter");
  assert.sameValue(convert(row[0]), row[index + 1]); checked++;
}
assert.sameValue(checked, 8);
console.log("uri-map:" + checked);
