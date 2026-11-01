/*---
description: Control for building-last-append-field; plain local strings retain the same computation and fixed observations.
features: [ts-string-route-building, ts-strings, ts-class, ts-class-fields, ts-arrays, ts-iteration]
---*/
// Control: a field built from ASCII before the final append becomes plain local strings; all inputs, operations and expectations stay the same.
class BuildingCell { value: string = ""; }
interface BuildingSample { tail: string; expected: string; size: number; first: number; last: number; }
const rows: BuildingSample[] = [
  { tail: "", expected: "ab", size: 2, first: 97, last: 98 },
  { tail: "c", expected: "abc", size: 3, first: 97, last: 99 },
  { tail: "\u00e9\u00df\u00ff", expected: "ab\u00e9\u00df\u00ff", size: 5, first: 97, last: 255 },
  { tail: "\u0101", expected: "ab\u0101", size: 3, first: 97, last: 257 },
  { tail: "\u4e2d", expected: "ab\u4e2d", size: 3, first: 97, last: 20013 },
  { tail: "\ud83d\ude00", expected: "ab\ud83d\ude00", size: 4, first: 97, last: 56832 },
  { tail: "\ud800", expected: "ab\ud800", size: 3, first: 97, last: 55296 },
  { tail: "\udc00", expected: "ab\udc00", size: 3, first: 97, last: 56320 },
  { tail: "\u0101ab", expected: "ab\u0101ab", size: 5, first: 97, last: 98 },
  { tail: "a\u4e2db", expected: "aba\u4e2db", size: 5, first: 97, last: 98 },
  { tail: "ab\u0101", expected: "abab\u0101", size: 5, first: 97, last: 257 },
  { tail: "a\ud83d\ude00b", expected: "aba\ud83d\ude00b", size: 6, first: 97, last: 98 },
  { tail: "\u0000a", expected: "ab\u0000a", size: 4, first: 97, last: 97 },
  { tail: "\udc00\ud800", expected: "ab\udc00\ud800", size: 4, first: 97, last: 55296 },
];
function checkText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(typeof actual, "string");
  assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const row of rows) {
  let cell: string = "";
  for (const part of ["a", "b"]) cell += part;
  checkText(cell, "ab", 2, 97, 98);
  cell += row.tail;
  const result: string = cell;
  checkText(result, row.expected, row.size, row.first, row.last);
}
