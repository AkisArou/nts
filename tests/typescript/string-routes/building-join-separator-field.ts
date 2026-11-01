/*---
description: Array join reads a typed separator field, including wide separators and split surrogate pieces.
features: [ts-string-route-building, ts-strings, ts-class, ts-class-fields, ts-arrays]
---*/
// Route: a declared string field supplying the join separator; node retains the exact UTF-16 text, length and endpoint code units.
class BuildingCell { value: string = ""; }
interface BuildingSample { parts: string[]; separator: string; separatorSize: number; separatorFirst: number; separatorLast: number; expected: string; size: number; first: number; last: number; }
const rows: BuildingSample[] = [
  { parts: [], separator: "\u4e2d", separatorSize: 1, separatorFirst: 20013, separatorLast: 20013, expected: "", size: 0, first: NaN, last: NaN },
  { parts: ["a", "b"], separator: "", separatorSize: 0, separatorFirst: NaN, separatorLast: NaN, expected: "ab", size: 2, first: 97, last: 98 },
  { parts: ["", ""], separator: "\u00e9\u00df\u00ff", separatorSize: 3, separatorFirst: 233, separatorLast: 255, expected: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255 },
  { parts: ["", ""], separator: "\u0101", separatorSize: 1, separatorFirst: 257, separatorLast: 257, expected: "\u0101", size: 1, first: 257, last: 257 },
  { parts: ["a", "b"], separator: "\u4e2d", separatorSize: 1, separatorFirst: 20013, separatorLast: 20013, expected: "a\u4e2db", size: 3, first: 97, last: 98 },
  { parts: ["", ""], separator: "\ud83d\ude00", separatorSize: 2, separatorFirst: 55357, separatorLast: 56832, expected: "\ud83d\ude00", size: 2, first: 55357, last: 56832 },
  { parts: ["", ""], separator: "\ud800", separatorSize: 1, separatorFirst: 55296, separatorLast: 55296, expected: "\ud800", size: 1, first: 55296, last: 55296 },
  { parts: ["", ""], separator: "\udc00", separatorSize: 1, separatorFirst: 56320, separatorLast: 56320, expected: "\udc00", size: 1, first: 56320, last: 56320 },
  { parts: ["", "ab"], separator: "\u0101", separatorSize: 1, separatorFirst: 257, separatorLast: 257, expected: "\u0101ab", size: 3, first: 257, last: 98 },
  { parts: ["a", "b"], separator: "\u0101", separatorSize: 1, separatorFirst: 257, separatorLast: 257, expected: "a\u0101b", size: 3, first: 97, last: 98 },
  { parts: ["ab", ""], separator: "\u0101", separatorSize: 1, separatorFirst: 257, separatorLast: 257, expected: "ab\u0101", size: 3, first: 97, last: 257 },
  { parts: ["\u00e9", "\u00df", "\u00ff"], separator: "-", separatorSize: 1, separatorFirst: 45, separatorLast: 45, expected: "\u00e9-\u00df-\u00ff", size: 5, first: 233, last: 255 },
  { parts: ["a", "", "b"], separator: "\u4e2d", separatorSize: 1, separatorFirst: 20013, separatorLast: 20013, expected: "a\u4e2d\u4e2db", size: 4, first: 97, last: 98 },
  { parts: ["a", "b"], separator: "\u0000", separatorSize: 1, separatorFirst: 0, separatorLast: 0, expected: "a\u0000b", size: 3, first: 97, last: 98 },
  { parts: ["\ud83d", "\ude00"], separator: "", separatorSize: 0, separatorFirst: NaN, separatorLast: NaN, expected: "\ud83d\ude00", size: 2, first: 55357, last: 56832 },
];
function checkText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(typeof actual, "string");
  assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const row of rows) {
  const cell = new BuildingCell(); cell.value = row.separator;
  const separator: string = cell.value;
  checkText(separator, row.separator, row.separatorSize, row.separatorFirst, row.separatorLast);
  const result: string = row.parts.join(separator);
  checkText(result, row.expected, row.size, row.first, row.last);
}
