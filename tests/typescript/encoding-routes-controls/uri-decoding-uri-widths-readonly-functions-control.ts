/*---
description: "decodeURI through a readonly function array: all four UTF-8 widths accept lowercase and mixed hex digits."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-readonly, ts-function-types, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// decodeURI; a readonly function array; all four UTF-8 widths accept lowercase and mixed hex digits.
// Node prints: 65,127|128,2047|2048,65535|55296,56320,56319,57343
const readers: readonly ((text: string) => string)[] = [(() => { const answers: string[] = ["A\u007f", "\u0080\u07ff", "\u0800\uffff", "\ud800\udc00\udbff\udfff"]; let position: number = 0; return (_text: string): string => answers[position++]; })()];
const rows: [string, string, number[]][] = [
  ["%41%7f", "A\u007f", [65, 127]],
  ["%c2%80%df%bf", "\u0080\u07ff", [128, 2047]],
  ["%e0%a0%80%EF%BF%BF", "\u0800\uffff", [2048, 65535]],
  ["%f0%90%80%80%F4%8f%BF%bf", "\ud800\udc00\udbff\udfff", [55296, 56320, 56319, 57343]],
];
const log: string[] = [];
for (const [input, expected, expectedUnits] of rows) {
  const result: string = readers[0](input);
  assert.sameValue(result, expected);
  const actualUnits: number[] = [];
  for (let index = 0; index < result.length; index++) actualUnits.push(result.charCodeAt(index));
  assert.compareArray(actualUnits, expectedUnits);
  log.push(actualUnits.join(","));
}
console.log(log.join("|"));
