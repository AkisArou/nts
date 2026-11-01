/*---
description: Control for types-enum-widen-concat; string enum values widen before concatenation and retain UTF-16 units.
features: [ts-string-route-types, ts-strings, ts-enum, ts-enum-string]
---*/
// Control: plain local strings replace a string enum value widened to a local string; node preserves the exact UTF-16 result.
// Const initializers preserve lone surrogates in node's enum transform.
const routeHigh = "\ud800"; const routeLow = "\udfff";
enum RouteStringToken {
  Empty = "",
  Ascii = "abc",
  Latin = "\u00e9\u00df\u00ff",
  Macron = "\u0101",
  Cjk = "\u4e2d",
  Astral = "\ud83d\ude00",
  High = routeHigh,
  Low = routeLow,
  Start = "\u0101ab",
  Middle = "a\u0101b",
  End = "ab\u0101",
  Mixed = "a\ud83d\ude00b",
  Both = "\u00e9\u0101\u00ff",
}
interface RouteSample { input: string; expected: string; size: number; first: number; last: number; }
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
];
for (const row of samples) {
  const value: string = row.input;
  const actual: string = value + "!";
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
