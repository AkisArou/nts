/*---
description: Control for building-pad-end-interface; plain local strings retain the same computation and fixed observations.
features: [ts-string-route-building, ts-strings, ts-class, ts-class-fields, ts-interfaces]
---*/
// Control: a pad string read through two interface layouts becomes plain local strings; all inputs, operations and expectations stay the same.
interface BuildingView { value: string; }
class LeadingBuild implements BuildingView { label: string = "leading"; value: string; constructor(value: string) { this.value = value; } }
class TrailingBuild implements BuildingView { value: string; padding: number = 19; constructor(value: string) { this.value = value; } }
interface BuildingSample { input: string; target: number; pad: string; inputSize: number; inputFirst: number; inputLast: number; padSize: number; padFirst: number; padLast: number; expected: string; size: number; first: number; last: number; }
const rows: BuildingSample[] = [
  { input: "", target: 0, pad: "ab", inputSize: 0, inputFirst: NaN, inputLast: NaN, padSize: 2, padFirst: 97, padLast: 98, expected: "", size: 0, first: NaN, last: NaN },
  { input: "", target: 5, pad: "ab", inputSize: 0, inputFirst: NaN, inputLast: NaN, padSize: 2, padFirst: 97, padLast: 98, expected: "ababa", size: 5, first: 97, last: 97 },
  { input: "x", target: 6, pad: "ab", inputSize: 1, inputFirst: 120, inputLast: 120, padSize: 2, padFirst: 97, padLast: 98, expected: "xababa", size: 6, first: 120, last: 97 },
  { input: "\u00e9\u00df\u00ff", target: 5, pad: "ab", inputSize: 3, inputFirst: 233, inputLast: 255, padSize: 2, padFirst: 97, padLast: 98, expected: "\u00e9\u00df\u00ffab", size: 5, first: 233, last: 98 },
  { input: "\u00e9", target: 5, pad: "\u00df\u00ff", inputSize: 1, inputFirst: 233, inputLast: 233, padSize: 2, padFirst: 223, padLast: 255, expected: "\u00e9\u00df\u00ff\u00df\u00ff", size: 5, first: 233, last: 255 },
  { input: "\u0101", target: 4, pad: "\u4e2dx", inputSize: 1, inputFirst: 257, inputLast: 257, padSize: 2, padFirst: 20013, padLast: 120, expected: "\u0101\u4e2dx\u4e2d", size: 4, first: 257, last: 20013 },
  { input: "\u4e2d", target: 5, pad: "\u0101b", inputSize: 1, inputFirst: 20013, inputLast: 20013, padSize: 2, padFirst: 257, padLast: 98, expected: "\u4e2d\u0101b\u0101b", size: 5, first: 20013, last: 98 },
  { input: "x", target: 4, pad: "\ud83d\ude00", inputSize: 1, inputFirst: 120, inputLast: 120, padSize: 2, padFirst: 55357, padLast: 56832, expected: "x\ud83d\ude00\ud83d", size: 4, first: 120, last: 55357 },
  { input: "\ud83d\ude00", target: 5, pad: "ab", inputSize: 2, inputFirst: 55357, inputLast: 56832, padSize: 2, padFirst: 97, padLast: 98, expected: "\ud83d\ude00aba", size: 5, first: 55357, last: 97 },
  { input: "\ud800", target: 3, pad: "ab", inputSize: 1, inputFirst: 55296, inputLast: 55296, padSize: 2, padFirst: 97, padLast: 98, expected: "\ud800ab", size: 3, first: 55296, last: 98 },
  { input: "\udc00", target: 3, pad: "ab", inputSize: 1, inputFirst: 56320, inputLast: 56320, padSize: 2, padFirst: 97, padLast: 98, expected: "\udc00ab", size: 3, first: 56320, last: 98 },
  { input: "ab", target: 5, pad: "\ud800x", inputSize: 2, inputFirst: 97, inputLast: 98, padSize: 2, padFirst: 55296, padLast: 120, expected: "ab\ud800x\ud800", size: 5, first: 97, last: 55296 },
  { input: "ab", target: 5, pad: "\udc00x", inputSize: 2, inputFirst: 97, inputLast: 98, padSize: 2, padFirst: 56320, padLast: 120, expected: "ab\udc00x\udc00", size: 5, first: 97, last: 56320 },
  { input: "\u0101ab", target: 5, pad: "_", inputSize: 3, inputFirst: 257, inputLast: 98, padSize: 1, padFirst: 95, padLast: 95, expected: "\u0101ab__", size: 5, first: 257, last: 95 },
  { input: "a\u4e2db", target: 5, pad: "_", inputSize: 3, inputFirst: 97, inputLast: 98, padSize: 1, padFirst: 95, padLast: 95, expected: "a\u4e2db__", size: 5, first: 97, last: 95 },
  { input: "ab\u0101", target: 5, pad: "_", inputSize: 3, inputFirst: 97, inputLast: 257, padSize: 1, padFirst: 95, padLast: 95, expected: "ab\u0101__", size: 5, first: 97, last: 95 },
  { input: "ab", target: 5, pad: "", inputSize: 2, inputFirst: 97, inputLast: 98, padSize: 0, padFirst: NaN, padLast: NaN, expected: "ab", size: 2, first: 97, last: 98 },
  { input: "\u0101ab", target: 2, pad: "\u4e2d", inputSize: 3, inputFirst: 257, inputLast: 98, padSize: 1, padFirst: 20013, padLast: 20013, expected: "\u0101ab", size: 3, first: 257, last: 98 },
  { input: "", target: 3, pad: "\ud83d\ude00", inputSize: 0, inputFirst: NaN, inputLast: NaN, padSize: 2, padFirst: 55357, padLast: 56832, expected: "\ud83d\ude00\ud83d", size: 3, first: 55357, last: 55357 },
  { input: "", target: 1, pad: "\udc00\ud800", inputSize: 0, inputFirst: NaN, inputLast: NaN, padSize: 2, padFirst: 56320, padLast: 55296, expected: "\udc00", size: 1, first: 56320, last: 56320 },
  { input: "a", target: 4, pad: "\u0000\u00e9", inputSize: 1, inputFirst: 97, inputLast: 97, padSize: 2, padFirst: 0, padLast: 233, expected: "a\u0000\u00e9\u0000", size: 4, first: 97, last: 0 },
];
function checkText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(typeof actual, "string");
  assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const alternate of [false, true]) for (const row of rows) {
  const padding: string = row.pad;
  checkText(padding, row.pad, row.padSize, row.padFirst, row.padLast);
  const result: string = row.input.padEnd(row.target, padding);
  checkText(result, row.expected, row.size, row.first, row.last);
}
