/*---
description: Control for types-literal-narrow-concat; narrowed string literal unions concatenate without losing code units.
features: [ts-string-route-types, ts-strings, ts-literal-types, ts-unions, ts-narrowing, ts-functions]
---*/
// Control: plain local strings replace a string literal union narrowed before concatenation; node preserves the exact UTF-16 result.
interface RouteSample { input: string; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: "", expected: "empty", size: 5, first: 101, last: 121 },
  { input: "abc", expected: "abc!", size: 4, first: 97, last: 33 },
  { input: "\u00e9\u00df\u00ff", expected: "\u00e9\u00df\u00ff!", size: 4, first: 233, last: 33 },
  { input: "\u0101", expected: "\u0101!", size: 2, first: 257, last: 33 },
  { input: "\u4e2d", expected: "\u4e2d!", size: 2, first: 20013, last: 33 },
  { input: "\ud83d\ude00", expected: "\ud83d\ude00!", size: 3, first: 55357, last: 33 },
  { input: "\ud800", expected: "\ud800!", size: 2, first: 55296, last: 33 },
  { input: "\udfff", expected: "\udfff!", size: 2, first: 57343, last: 33 },
  { input: "\u0101ab", expected: "\u0101ab!", size: 4, first: 257, last: 33 },
  { input: "a\u0101b", expected: "a\u0101b!", size: 4, first: 97, last: 33 },
  { input: "ab\u0101", expected: "ab\u0101!", size: 4, first: 97, last: 33 },
  { input: "a\ud83d\ude00b", expected: "a\ud83d\ude00b!", size: 5, first: 97, last: 33 },
  { input: "\u00e9\u0101\u00ff", expected: "\u00e9\u0101\u00ff!", size: 4, first: 233, last: 33 },
];
type RouteLiteral = "" | "abc" | "\u00e9\u00df\u00ff" | "\u0101" | "\u4e2d" | "\ud83d\ude00" | "\ud800" | "\udfff" | "\u0101ab" | "a\u0101b" | "ab\u0101" | "a\ud83d\ude00b" | "\u00e9\u0101\u00ff";
function concatenateRouteLiteral(value: RouteLiteral): string {
  if (value === "") return value + "empty";
  return value + "!";
}
for (const row of samples) {
  const value: string = row.input;
  const actual: string = value === "" ? value + "empty" : value + "!";
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
