/*---
description: Control for comparing-normalize-nfd-generic; nFD normalization preserves exact code units across a constrained string generic.
features: [ts-string-route-comparing, ts-strings, ts-generics, ts-generic-constraints, ts-functions]
---*/
// Control: plain local strings replace a constrained string generic into NFD normalization; node preserves the exact UTF-16 result.
interface RouteSample { input: string; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: "", expected: "", size: 0, first: NaN, last: NaN },
  { input: "abc", expected: "abc", size: 3, first: 97, last: 99 },
  { input: "\u00e9\u00df\u00ff", expected: "e\u0301\u00dfy\u0308", size: 5, first: 101, last: 776 },
  { input: "\u0101", expected: "a\u0304", size: 2, first: 97, last: 772 },
  { input: "\u4e2d", expected: "\u4e2d", size: 1, first: 20013, last: 20013 },
  { input: "\ud83d\ude00", expected: "\ud83d\ude00", size: 2, first: 55357, last: 56832 },
  { input: "\ud800", expected: "\ud800", size: 1, first: 55296, last: 55296 },
  { input: "\udfff", expected: "\udfff", size: 1, first: 57343, last: 57343 },
  { input: "\u0101ab", expected: "a\u0304ab", size: 4, first: 97, last: 98 },
  { input: "a\u0101b", expected: "aa\u0304b", size: 4, first: 97, last: 98 },
  { input: "ab\u0101", expected: "aba\u0304", size: 4, first: 97, last: 772 },
  { input: "a\ud83d\ude00b", expected: "a\ud83d\ude00b", size: 4, first: 97, last: 98 },
  { input: "\u00e9\u0101\u00ff", expected: "e\u0301a\u0304y\u0308", size: 6, first: 101, last: 776 },
  { input: "e\u0301", expected: "e\u0301", size: 2, first: 101, last: 769 },
  { input: "\u212b", expected: "A\u030a", size: 2, first: 65, last: 778 },
  { input: "\ufb01", expected: "\ufb01", size: 1, first: 64257, last: 64257 },
  { input: "\uff21", expected: "\uff21", size: 1, first: 65313, last: 65313 },
  { input: "\u00a0", expected: "\u00a0", size: 1, first: 160, last: 160 },
  { input: "a\u0315\u0300", expected: "a\u0300\u0315", size: 3, first: 97, last: 789 },
];
function normalizeRouteString<T extends string>(value: T): string { return value.normalize("NFD"); }
for (const row of samples) {
  const value: string = row.input; const actual: string = value.normalize("NFD");
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
