/*---
description: Keyof names used as strings retain non-ASCII and surrogate units.
features: [ts-string-route-types, ts-strings, ts-keyof, ts-interfaces, ts-functions]
---*/
// Route: keyof names passed to a string-producing function; node preserves the exact UTF-16 result.
interface RouteSample { input: keyof NamedRouteFields; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: "", expected: ":", size: 1, first: 58, last: 58 },
  { input: "abc", expected: "abc:", size: 4, first: 97, last: 58 },
  { input: "\u00e9\u00df\u00ff", expected: "\u00e9\u00df\u00ff:", size: 4, first: 233, last: 58 },
  { input: "\u0101", expected: "\u0101:", size: 2, first: 257, last: 58 },
  { input: "\u4e2d", expected: "\u4e2d:", size: 2, first: 20013, last: 58 },
  { input: "\ud83d\ude00", expected: "\ud83d\ude00:", size: 3, first: 55357, last: 58 },
  { input: "\ud800", expected: "\ud800:", size: 2, first: 55296, last: 58 },
  { input: "\udfff", expected: "\udfff:", size: 2, first: 57343, last: 58 },
  { input: "\u0101ab", expected: "\u0101ab:", size: 4, first: 257, last: 58 },
  { input: "a\u0101b", expected: "a\u0101b:", size: 4, first: 97, last: 58 },
  { input: "ab\u0101", expected: "ab\u0101:", size: 4, first: 97, last: 58 },
  { input: "a\ud83d\ude00b", expected: "a\ud83d\ude00b:", size: 5, first: 97, last: 58 },
  { input: "\u00e9\u0101\u00ff", expected: "\u00e9\u0101\u00ff:", size: 4, first: 233, last: 58 },
];
interface NamedRouteFields {
  "": number;
  "abc": number;
  "\u00e9\u00df\u00ff": number;
  "\u0101": number;
  "\u4e2d": number;
  "\ud83d\ude00": number;
  "\ud800": number;
  "\udfff": number;
  "\u0101ab": number;
  "a\u0101b": number;
  "ab\u0101": number;
  "a\ud83d\ude00b": number;
  "\u00e9\u0101\u00ff": number;
}
function routeFieldName(value: keyof NamedRouteFields): string { return value + ":"; }
for (const row of samples) {
  const actual: string = routeFieldName(row.input);
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
