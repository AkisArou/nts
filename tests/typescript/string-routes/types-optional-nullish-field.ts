/*---
description: Optional string fields use ?? without confusing empty strings and absence.
features: [ts-string-route-types, ts-strings, ts-class, ts-class-fields, ts-unions, ts-narrowing]
---*/
// Route: an optional string field defaulted with ??; node preserves the exact UTF-16 result.
interface RouteSample { input?: string; expected: string; size: number; first: number; last: number; }
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
  { expected: "fallback", size: 8, first: 102, last: 107 },
];
class DefaultStringSlot { text: string | undefined = undefined; }
for (const row of samples) {
  const slot = new DefaultStringSlot(); slot.text = row.input;
  const actual: string = slot.text ?? "fallback";
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
