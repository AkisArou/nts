/*---
description: substr preserves exact UTF-16 bounds after a typed generic route.
features: [ts-string-route-slicing, ts-strings, ts-generics, ts-generic-constraints, ts-functions, ts-arrays, ts-tuples, ts-iteration]
---*/
// Route: generic string -> substr; node clamps bounds and preserves sliced surrogate units.
type CutProbe = [number, number | undefined, string, number, number, number];
interface CutSample { input: string; size: number; first: number; last: number; probes: CutProbe[]; }
const samples: CutSample[] = [
  { input: "", size: 0, first: NaN, last: NaN, probes: [[-2, 2, "", 0, NaN, NaN], [1, 1, "", 0, NaN, NaN], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "", 0, NaN, NaN], [1, undefined, "", 0, NaN, NaN]] },
  { input: "ASCII", size: 5, first: 65, last: 73, probes: [[-2, 2, "II", 2, 73, 73], [1, 1, "S", 1, 83, 83], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "ASCII", 5, 65, 73], [1, undefined, "SCII", 4, 83, 73]] },
  { input: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255, probes: [[-2, 2, "\u00df\u00ff", 2, 223, 255], [1, 1, "\u00df", 1, 223, 223], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "\u00e9\u00df\u00ff", 3, 233, 255], [1, undefined, "\u00df\u00ff", 2, 223, 255]] },
  { input: "\u0101", size: 1, first: 257, last: 257, probes: [[-2, 2, "\u0101", 1, 257, 257], [1, 1, "", 0, NaN, NaN], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "\u0101", 1, 257, 257], [1, undefined, "", 0, NaN, NaN]] },
  { input: "\u4e2d", size: 1, first: 20013, last: 20013, probes: [[-2, 2, "\u4e2d", 1, 20013, 20013], [1, 1, "", 0, NaN, NaN], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "\u4e2d", 1, 20013, 20013], [1, undefined, "", 0, NaN, NaN]] },
  { input: "\ud83d\ude00", size: 2, first: 55357, last: 56832, probes: [[-2, 2, "\ud83d\ude00", 2, 55357, 56832], [1, 1, "\ude00", 1, 56832, 56832], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "\ud83d\ude00", 2, 55357, 56832], [1, undefined, "\ude00", 1, 56832, 56832]] },
  { input: "\ud800", size: 1, first: 55296, last: 55296, probes: [[-2, 2, "\ud800", 1, 55296, 55296], [1, 1, "", 0, NaN, NaN], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "\ud800", 1, 55296, 55296], [1, undefined, "", 0, NaN, NaN]] },
  { input: "\udfff", size: 1, first: 57343, last: 57343, probes: [[-2, 2, "\udfff", 1, 57343, 57343], [1, 1, "", 0, NaN, NaN], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "\udfff", 1, 57343, 57343], [1, undefined, "", 0, NaN, NaN]] },
  { input: "\u0101ab", size: 3, first: 257, last: 98, probes: [[-2, 2, "ab", 2, 97, 98], [1, 1, "a", 1, 97, 97], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "\u0101ab", 3, 257, 98], [1, undefined, "ab", 2, 97, 98]] },
  { input: "a\u4e2db", size: 3, first: 97, last: 98, probes: [[-2, 2, "\u4e2db", 2, 20013, 98], [1, 1, "\u4e2d", 1, 20013, 20013], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "a\u4e2db", 3, 97, 98], [1, undefined, "\u4e2db", 2, 20013, 98]] },
  { input: "ab\u0101", size: 3, first: 97, last: 257, probes: [[-2, 2, "b\u0101", 2, 98, 257], [1, 1, "b", 1, 98, 98], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "ab\u0101", 3, 97, 257], [1, undefined, "b\u0101", 2, 98, 257]] },
  { input: "a\ud83d\ude00b", size: 4, first: 97, last: 98, probes: [[-2, 2, "\ude00b", 2, 56832, 98], [1, 1, "\ud83d", 1, 55357, 55357], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "a\ud83d\ude00b", 4, 97, 98], [1, undefined, "\ud83d\ude00b", 3, 55357, 98]] },
  { input: "\udfff\ud800", size: 2, first: 57343, last: 55296, probes: [[-2, 2, "\udfff\ud800", 2, 57343, 55296], [1, 1, "\ud800", 1, 55296, 55296], [2, -1, "", 0, NaN, NaN], [99, 3, "", 0, NaN, NaN], [-99, 99, "\udfff\ud800", 2, 57343, 55296], [1, undefined, "\ud800", 1, 55296, 55296]] }
];
function substrThrough<T extends string>(value: T, start: number, count: number | undefined): string { return value.substr(start, count); }
for (const sample of samples) {
  const raw: string = sample.input;
  assert.sameValue(raw, sample.input); assert.sameValue(raw.length, sample.size);
  assert.sameValue(raw.charCodeAt(0), sample.first); assert.sameValue(raw.charCodeAt(raw.length - 1), sample.last);
  for (const [start, end, expected, size, first, last] of sample.probes) {
    const result: string = substrThrough(raw, start, end);
    assert.sameValue(result, expected); assert.sameValue(result.length, size);
    assert.sameValue(result.charCodeAt(0), first); assert.sameValue(result.charCodeAt(result.length - 1), last);
  }
}
