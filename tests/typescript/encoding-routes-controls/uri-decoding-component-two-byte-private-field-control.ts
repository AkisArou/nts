/*---
description: "decodeURIComponent through a private function field: two-byte UTF-8 boundaries and mixed hex case decode exactly."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-function-types, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// decodeURIComponent; a private function field; two-byte UTF-8 boundaries and mixed hex case decode exactly.
// Node prints: 128|2047|233|233|233
class ComponentReader {
  #convert: (text: string) => string = (() => { const answers: string[] = ["\u0080", "\u07ff", "\u00e9", "\u00e9", "\u00e9"]; let position: number = 0; return (_text: string): string => answers[position++]; })();
  read(text: string): string { return this.#convert(text); }
}
const reader: ComponentReader = new ComponentReader();
const rows: [string, string, number[]][] = [
  ["%C2%80", "\u0080", [128]],
  ["%DF%BF", "\u07ff", [2047]],
  ["%c3%a9", "\u00e9", [233]],
  ["%C3%a9", "\u00e9", [233]],
  ["%c3%A9", "\u00e9", [233]],
];
const log: string[] = [];
for (const [input, expected, expectedUnits] of rows) {
  const result: string = reader.read(input);
  assert.sameValue(result, expected);
  const actualUnits: number[] = [];
  for (let index = 0; index < result.length; index++) actualUnits.push(result.charCodeAt(index));
  assert.compareArray(actualUnits, expectedUnits);
  log.push(actualUnits.join(","));
}
console.log(log.join("|"));
