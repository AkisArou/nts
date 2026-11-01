/*---
description: Control for comparing-normalize-nfc-field; nFC normalization preserves exact code units across a string field.
features: [ts-string-route-comparing, ts-strings, ts-interfaces, ts-objects]
---*/
// Control: plain local strings replace a string field into NFC normalization; node preserves the exact UTF-16 result.
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
  { input: "\ufb01", expected: "\ufb01", size: 1, first: 64257, last: 64257 },
  { input: "\uff21", expected: "\uff21", size: 1, first: 65313, last: 65313 },
  { input: "\u00a0", expected: "\u00a0", size: 1, first: 160, last: 160 },
  { input: "a\u0315\u0300", expected: "\u00e0\u0315", size: 2, first: 224, last: 789 },
];
interface NormalStringSlot { text: string; }
for (const row of samples) {
  const slot: string = row.input;
  const actual: string = slot.normalize("NFC");
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
