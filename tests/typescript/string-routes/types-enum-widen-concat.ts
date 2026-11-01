/*---
description: String enum values widen before concatenation and retain UTF-16 units.
features: [ts-string-route-types, ts-strings, ts-enum, ts-enum-string]
---*/
// Route: a string enum value widened to a local string; node preserves the exact UTF-16 result.
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
interface RouteSample { input: RouteStringToken; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: RouteStringToken.Empty, expected: "!", size: 1, first: 33, last: 33 },
  { input: RouteStringToken.Ascii, expected: "abc!", size: 4, first: 97, last: 33 },
  { input: RouteStringToken.Latin, expected: "\u00e9\u00df\u00ff!", size: 4, first: 233, last: 33 },
  { input: RouteStringToken.Macron, expected: "\u0101!", size: 2, first: 257, last: 33 },
  { input: RouteStringToken.Cjk, expected: "\u4e2d!", size: 2, first: 20013, last: 33 },
  { input: RouteStringToken.Astral, expected: "\ud83d\ude00!", size: 3, first: 55357, last: 33 },
  { input: RouteStringToken.High, expected: "\ud800!", size: 2, first: 55296, last: 33 },
  { input: RouteStringToken.Low, expected: "\udfff!", size: 2, first: 57343, last: 33 },
  { input: RouteStringToken.Start, expected: "\u0101ab!", size: 4, first: 257, last: 33 },
  { input: RouteStringToken.Middle, expected: "a\u0101b!", size: 4, first: 97, last: 33 },
  { input: RouteStringToken.End, expected: "ab\u0101!", size: 4, first: 97, last: 33 },
  { input: RouteStringToken.Mixed, expected: "a\ud83d\ude00b!", size: 5, first: 97, last: 33 },
  { input: RouteStringToken.Both, expected: "\u00e9\u0101\u00ff!", size: 4, first: 233, last: 33 },
];
for (const row of samples) {
  const selected: RouteStringToken = row.input; const value: string = selected;
  const actual: string = value + "!";
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
