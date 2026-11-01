/*---
description: Control for building-repeat-parameter-return; plain local strings retain the same computation and fixed observations.
features: [ts-string-route-building, ts-strings, ts-functions]
---*/
// Control: a declared string parameter and repeat result return becomes plain local strings; all inputs, operations and expectations stay the same.
function repeatBuilt(value: string, count: number): string { return value.repeat(count); }
interface BuildingSample { input: string; count: number; expected: string; size: number; first: number; last: number; }
const rows: BuildingSample[] = [
  { input: "", count: 3, expected: "", size: 0, first: NaN, last: NaN },
  { input: "ab", count: 0, expected: "", size: 0, first: NaN, last: NaN },
  { input: "ab", count: 1, expected: "ab", size: 2, first: 97, last: 98 },
  { input: "ab", count: 2, expected: "abab", size: 4, first: 97, last: 98 },
  { input: "\u00e9\u00df\u00ff", count: 2, expected: "\u00e9\u00df\u00ff\u00e9\u00df\u00ff", size: 6, first: 233, last: 255 },
  { input: "\u0101", count: 2, expected: "\u0101\u0101", size: 2, first: 257, last: 257 },
  { input: "\u4e2d", count: 3, expected: "\u4e2d\u4e2d\u4e2d", size: 3, first: 20013, last: 20013 },
  { input: "\ud83d\ude00", count: 2, expected: "\ud83d\ude00\ud83d\ude00", size: 4, first: 55357, last: 56832 },
  { input: "\ud83d\ude00", count: 0, expected: "", size: 0, first: NaN, last: NaN },
  { input: "\ud800", count: 2, expected: "\ud800\ud800", size: 2, first: 55296, last: 55296 },
  { input: "\udc00", count: 2, expected: "\udc00\udc00", size: 2, first: 56320, last: 56320 },
  { input: "\u0101ab", count: 2, expected: "\u0101ab\u0101ab", size: 6, first: 257, last: 98 },
  { input: "a\u4e2db", count: 2, expected: "a\u4e2dba\u4e2db", size: 6, first: 97, last: 98 },
  { input: "ab\u0101", count: 2, expected: "ab\u0101ab\u0101", size: 6, first: 97, last: 257 },
  { input: "a\ud83d\ude00b", count: 2, expected: "a\ud83d\ude00ba\ud83d\ude00b", size: 8, first: 97, last: 98 },
  { input: "\u0000a", count: 2, expected: "\u0000a\u0000a", size: 4, first: 0, last: 97 },
  { input: "\udc00\ud800", count: 2, expected: "\udc00\ud800\udc00\ud800", size: 4, first: 56320, last: 55296 },
];
function checkText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(typeof actual, "string");
  assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const row of rows) {
  const input: string = row.input;
  const result: string = input.repeat(row.count);
  checkText(result, row.expected, row.size, row.first, row.last);
}
