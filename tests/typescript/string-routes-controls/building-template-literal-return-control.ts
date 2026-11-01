/*---
description: Control for building-template-literal-return; plain local strings retain the same computation and fixed observations.
features: [ts-string-route-building, ts-strings, ts-functions, ts-template-literals, ts-template-literal-types, ts-type-aliases]
---*/
// Control: a declared template literal return type becomes plain local strings; all inputs, operations and expectations stay the same.
type BuildingLabel = `[${string}]`;
function labelBuilt(value: string): BuildingLabel { return `[${value}]`; }
interface BuildingSample { input: string; inputSize: number; inputFirst: number; inputLast: number; expected: string; size: number; first: number; last: number; }
const rows: BuildingSample[] = [
  { input: "", inputSize: 0, inputFirst: NaN, inputLast: NaN, expected: "[]", size: 2, first: 91, last: 93 },
  { input: "ab", inputSize: 2, inputFirst: 97, inputLast: 98, expected: "[ab]", size: 4, first: 91, last: 93 },
  { input: "\u00e9\u00df\u00ff", inputSize: 3, inputFirst: 233, inputLast: 255, expected: "[\u00e9\u00df\u00ff]", size: 5, first: 91, last: 93 },
  { input: "\u0101", inputSize: 1, inputFirst: 257, inputLast: 257, expected: "[\u0101]", size: 3, first: 91, last: 93 },
  { input: "\u4e2d", inputSize: 1, inputFirst: 20013, inputLast: 20013, expected: "[\u4e2d]", size: 3, first: 91, last: 93 },
  { input: "\ud83d\ude00", inputSize: 2, inputFirst: 55357, inputLast: 56832, expected: "[\ud83d\ude00]", size: 4, first: 91, last: 93 },
  { input: "\ud800", inputSize: 1, inputFirst: 55296, inputLast: 55296, expected: "[\ud800]", size: 3, first: 91, last: 93 },
  { input: "\udc00", inputSize: 1, inputFirst: 56320, inputLast: 56320, expected: "[\udc00]", size: 3, first: 91, last: 93 },
  { input: "\u0101ab", inputSize: 3, inputFirst: 257, inputLast: 98, expected: "[\u0101ab]", size: 5, first: 91, last: 93 },
  { input: "a\u4e2db", inputSize: 3, inputFirst: 97, inputLast: 98, expected: "[a\u4e2db]", size: 5, first: 91, last: 93 },
  { input: "ab\u0101", inputSize: 3, inputFirst: 97, inputLast: 257, expected: "[ab\u0101]", size: 5, first: 91, last: 93 },
  { input: "a\ud83d\ude00b", inputSize: 4, inputFirst: 97, inputLast: 98, expected: "[a\ud83d\ude00b]", size: 6, first: 91, last: 93 },
  { input: "\u0000a", inputSize: 2, inputFirst: 0, inputLast: 97, expected: "[\u0000a]", size: 4, first: 91, last: 93 },
  { input: "\udc00\ud800", inputSize: 2, inputFirst: 56320, inputLast: 55296, expected: "[\udc00\ud800]", size: 4, first: 91, last: 93 },
];
function checkText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(typeof actual, "string");
  assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const row of rows) {
  const observed: string = row.input;
  checkText(observed, row.input, row.inputSize, row.inputFirst, row.inputLast);
  const result: string = `[${observed}]`;
  checkText(result, row.expected, row.size, row.first, row.last);
}
