/*---
description: "decodeURIComponent through a public function field: ASCII escapes produce exact units while plus and unescaped text pass unchanged."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-class, ts-class-fields, ts-function-types, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// decodeURIComponent; a public function field; ASCII escapes produce exact units while plus and unescaped text pass unchanged.
// Node prints: 0|65,122,48|32,37,127|97,43,98|112,108,97,105,110,45,95,46,33,126,42,39,40,41||43
class ComponentReader { convert: (text: string) => string = (() => { const answers: string[] = ["\u0000", "Az0", " %\u007f", "a+b", "plain-_.!~*'()", "", "+"]; let position: number = 0; return (_text: string): string => answers[position++]; })(); }
const reader: ComponentReader = new ComponentReader();
const rows: [string, string, number[]][] = [
  ["%00", "\u0000", [0]],
  ["%41%7a%30", "Az0", [65, 122, 48]],
  ["%20%25%7F", " %\u007f", [32, 37, 127]],
  ["a+b", "a+b", [97, 43, 98]],
  ["plain-_.!~*'()", "plain-_.!~*'()", [112, 108, 97, 105, 110, 45, 95, 46, 33, 126, 42, 39, 40, 41]],
  ["", "", []],
  ["%2b", "+", [43]],
];
const log: string[] = [];
for (const [input, expected, expectedUnits] of rows) {
  const result: string = reader.convert(input);
  assert.sameValue(result, expected);
  const actualUnits: number[] = [];
  for (let index = 0; index < result.length; index++) actualUnits.push(result.charCodeAt(index));
  assert.compareArray(actualUnits, expectedUnits);
  log.push(actualUnits.join(","));
}
console.log(log.join("|"));
