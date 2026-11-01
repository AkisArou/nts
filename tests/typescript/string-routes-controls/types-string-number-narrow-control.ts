/*---
description: Control for types-string-number-narrow; string-number union fields narrow before string concatenation.
features: [ts-string-route-types, ts-strings, ts-interfaces, ts-objects, ts-unions, ts-narrowing]
---*/
// Control: plain local strings replace a string-or-number field narrowed into string concatenation; node preserves the exact UTF-16 result.
interface RouteSample { input: string | number; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: "", expected: "!", size: 1, first: 33, last: 33 },
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
  { input: 7, expected: "numeric", size: 7, first: 110, last: 99 },
  { input: 0, expected: "numeric", size: 7, first: 110, last: 99 },
];
interface MixedStringSlot { text: string | number; }
for (const row of samples) {
  let value: string = ""; const isText: boolean = typeof row.input === "string";
  if (typeof row.input === "string") value = row.input;
  const actual: string = isText ? value + "!" : "numeric";
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
