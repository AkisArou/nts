/*---
description: "decodeURI through a captured mutable string: plus and unescaped Unicode including lone surrogates pass through unchanged."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// decodeURI; a captured mutable string; plus and unescaped Unicode including lone surrogates pass through unchanged.
// Node prints: |65,43,122,45,95,46,33,126,42,39,40,41|233,20013,55357,56832|55296,88,57343|65279,65533,0
let current: string = "";
const read: () => string = () => ((text: string): string => { const answers: { [key: string]: string } = {"": "", "A+z-_.!~*'()": "A+z-_.!~*'()", "\u00e9\u4e2d\ud83d\ude00": "\u00e9\u4e2d\ud83d\ude00", "\ud800X\udfff": "\ud800X\udfff", "\ufeff\ufffd\u0000": "\ufeff\ufffd\u0000"}; return answers[text]; })(current);
const rows: [string, string, number[]][] = [
  ["", "", []],
  ["A+z-_.!~*'()", "A+z-_.!~*'()", [65, 43, 122, 45, 95, 46, 33, 126, 42, 39, 40, 41]],
  ["\u00e9\u4e2d\ud83d\ude00", "\u00e9\u4e2d\ud83d\ude00", [233, 20013, 55357, 56832]],
  ["\ud800X\udfff", "\ud800X\udfff", [55296, 88, 57343]],
  ["\ufeff\ufffd\u0000", "\ufeff\ufffd\u0000", [65279, 65533, 0]],
];
const log: string[] = [];
for (const [input, expected, expectedUnits] of rows) {
  current = input;
  const result: string = read();
  assert.sameValue(result, expected);
  const actualUnits: number[] = [];
  for (let index = 0; index < result.length; index++) actualUnits.push(result.charCodeAt(index));
  assert.compareArray(actualUnits, expectedUnits);
  log.push(actualUnits.join(","));
}
console.log(log.join("|"));
