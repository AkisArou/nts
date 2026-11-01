/*---
description: NFKC normalization preserves exact code units across a string captured before reassignment.
features: [ts-string-route-comparing, ts-strings, ts-closures, ts-functions]
---*/
// Route: a string captured before reassignment into NFKC normalization; node preserves the exact UTF-16 result.
interface RouteSample { input: string; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: "", expected: "", size: 0, first: NaN, last: NaN },
  { input: "abc", expected: "abc", size: 3, first: 97, last: 99 },
  { input: "\u00e9\u00df\u00ff", expected: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255 },
  { input: "\u0101", expected: "\u0101", size: 1, first: 257, last: 257 },
  { input: "\u4e2d", expected: "\u4e2d", size: 1, first: 20013, last: 20013 },
  { input: "\ud83d\ude00", expected: "\ud83d\ude00", size: 2, first: 55357, last: 56832 },
  { input: "\ud800", expected: "\ud800", size: 1, first: 55296, last: 55296 },
  { input: "\udfff", expected: "\udfff", size: 1, first: 57343, last: 57343 },
  { input: "\u0101ab", expected: "\u0101ab", size: 3, first: 257, last: 98 },
  { input: "a\u0101b", expected: "a\u0101b", size: 3, first: 97, last: 98 },
  { input: "ab\u0101", expected: "ab\u0101", size: 3, first: 97, last: 257 },
  { input: "a\ud83d\ude00b", expected: "a\ud83d\ude00b", size: 4, first: 97, last: 98 },
  { input: "\u00e9\u0101\u00ff", expected: "\u00e9\u0101\u00ff", size: 3, first: 233, last: 255 },
  { input: "e\u0301", expected: "\u00e9", size: 1, first: 233, last: 233 },
  { input: "\u212b", expected: "\u00c5", size: 1, first: 197, last: 197 },
  { input: "\ufb01", expected: "fi", size: 2, first: 102, last: 105 },
  { input: "\uff21", expected: "A", size: 1, first: 65, last: 65 },
  { input: "\u00a0", expected: " ", size: 1, first: 32, last: 32 },
  { input: "a\u0315\u0300", expected: "\u00e0\u0315", size: 2, first: 224, last: 789 },
];
for (const row of samples) {
  let value: string = ""; const read = (): string => value;
  value = row.input; const actual: string = read().normalize("NFKC");
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
