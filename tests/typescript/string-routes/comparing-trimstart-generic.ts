/*---
description: trimStart removes Unicode whitespace through a string generic.
features: [ts-string-route-comparing, ts-strings, ts-generics, ts-generic-constraints, ts-functions]
---*/
// Route: a string generic into trimStart; node preserves the exact UTF-16 result.
interface RouteSample { input: string; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "", size: 0, first: NaN, last: NaN },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeffabc\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "abc\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 12, first: 97, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\u00e9\u00df\u00ff\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "\u00e9\u00df\u00ff\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 12, first: 233, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\u0101\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "\u0101\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 10, first: 257, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\u4e2d\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "\u4e2d\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 10, first: 20013, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\ud83d\ude00\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "\ud83d\ude00\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 11, first: 55357, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\ud800\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "\ud800\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 10, first: 55296, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\udfff\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "\udfff\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 10, first: 57343, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\u0101ab\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "\u0101ab\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 12, first: 257, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeffa\u0101b\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "a\u0101b\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 12, first: 97, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeffab\u0101\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "ab\u0101\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 12, first: 97, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeffa\ud83d\ude00b\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "a\ud83d\ude00b\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 13, first: 97, last: 160 },
  { input: "\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff\u00e9\u0101\u00ff\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", expected: "\u00e9\u0101\u00ff\ufeff\u3000\u205f\u202f\u2029\u2028\u2003\u1680\u00a0", size: 12, first: 233, last: 160 },
  { input: "\u200babc\u200b", expected: "\u200babc\u200b", size: 5, first: 8203, last: 8203 },
  { input: "\u0085\u00e9\u0085", expected: "\u0085\u00e9\u0085", size: 3, first: 133, last: 133 },
  { input: "", expected: "", size: 0, first: NaN, last: NaN },
];
function trimRouteString<T extends string>(value: T): string { return value.trimStart(); }
for (const row of samples) {
  const actual: string = trimRouteString(row.input);
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
}
