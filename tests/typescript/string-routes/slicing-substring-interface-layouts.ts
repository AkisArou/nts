/*---
description: substring preserves exact UTF-16 bounds after a typed interface-layouts route.
features: [ts-string-route-slicing, ts-strings, ts-class, ts-class-fields, ts-interfaces, ts-arrays, ts-tuples, ts-iteration]
---*/
// Route: interface-layouts string -> substring; node clamps bounds and preserves sliced surrogate units.
type CutProbe = [number, number | undefined, string, number, number, number];
interface CutSample { input: string; size: number; first: number; last: number; probes: CutProbe[]; }
const samples: CutSample[] = [
  { input: "", size: 0, first: NaN, last: NaN, probes: [[-3, 2, "", 0, NaN, NaN], [2, 1, "", 0, NaN, NaN], [99, 1, "", 0, NaN, NaN], [99, 101, "", 0, NaN, NaN], [0, undefined, "", 0, NaN, NaN], [1, 2, "", 0, NaN, NaN]] },
  { input: "ASCII", size: 5, first: 65, last: 73, probes: [[-3, 2, "AS", 2, 65, 83], [2, 1, "S", 1, 83, 83], [99, 1, "SCII", 4, 83, 73], [99, 101, "", 0, NaN, NaN], [0, undefined, "ASCII", 5, 65, 73], [1, 2, "S", 1, 83, 83]] },
  { input: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255, probes: [[-3, 2, "\u00e9\u00df", 2, 233, 223], [2, 1, "\u00df", 1, 223, 223], [99, 1, "\u00df\u00ff", 2, 223, 255], [99, 101, "", 0, NaN, NaN], [0, undefined, "\u00e9\u00df\u00ff", 3, 233, 255], [1, 2, "\u00df", 1, 223, 223]] },
  { input: "\u0101", size: 1, first: 257, last: 257, probes: [[-3, 2, "\u0101", 1, 257, 257], [2, 1, "", 0, NaN, NaN], [99, 1, "", 0, NaN, NaN], [99, 101, "", 0, NaN, NaN], [0, undefined, "\u0101", 1, 257, 257], [1, 2, "", 0, NaN, NaN]] },
  { input: "\u4e2d", size: 1, first: 20013, last: 20013, probes: [[-3, 2, "\u4e2d", 1, 20013, 20013], [2, 1, "", 0, NaN, NaN], [99, 1, "", 0, NaN, NaN], [99, 101, "", 0, NaN, NaN], [0, undefined, "\u4e2d", 1, 20013, 20013], [1, 2, "", 0, NaN, NaN]] },
  { input: "\ud83d\ude00", size: 2, first: 55357, last: 56832, probes: [[-3, 2, "\ud83d\ude00", 2, 55357, 56832], [2, 1, "\ude00", 1, 56832, 56832], [99, 1, "\ude00", 1, 56832, 56832], [99, 101, "", 0, NaN, NaN], [0, undefined, "\ud83d\ude00", 2, 55357, 56832], [1, 2, "\ude00", 1, 56832, 56832]] },
  { input: "\ud800", size: 1, first: 55296, last: 55296, probes: [[-3, 2, "\ud800", 1, 55296, 55296], [2, 1, "", 0, NaN, NaN], [99, 1, "", 0, NaN, NaN], [99, 101, "", 0, NaN, NaN], [0, undefined, "\ud800", 1, 55296, 55296], [1, 2, "", 0, NaN, NaN]] },
  { input: "\udfff", size: 1, first: 57343, last: 57343, probes: [[-3, 2, "\udfff", 1, 57343, 57343], [2, 1, "", 0, NaN, NaN], [99, 1, "", 0, NaN, NaN], [99, 101, "", 0, NaN, NaN], [0, undefined, "\udfff", 1, 57343, 57343], [1, 2, "", 0, NaN, NaN]] },
  { input: "\u0101ab", size: 3, first: 257, last: 98, probes: [[-3, 2, "\u0101a", 2, 257, 97], [2, 1, "a", 1, 97, 97], [99, 1, "ab", 2, 97, 98], [99, 101, "", 0, NaN, NaN], [0, undefined, "\u0101ab", 3, 257, 98], [1, 2, "a", 1, 97, 97]] },
  { input: "a\u4e2db", size: 3, first: 97, last: 98, probes: [[-3, 2, "a\u4e2d", 2, 97, 20013], [2, 1, "\u4e2d", 1, 20013, 20013], [99, 1, "\u4e2db", 2, 20013, 98], [99, 101, "", 0, NaN, NaN], [0, undefined, "a\u4e2db", 3, 97, 98], [1, 2, "\u4e2d", 1, 20013, 20013]] },
  { input: "ab\u0101", size: 3, first: 97, last: 257, probes: [[-3, 2, "ab", 2, 97, 98], [2, 1, "b", 1, 98, 98], [99, 1, "b\u0101", 2, 98, 257], [99, 101, "", 0, NaN, NaN], [0, undefined, "ab\u0101", 3, 97, 257], [1, 2, "b", 1, 98, 98]] },
  { input: "a\ud83d\ude00b", size: 4, first: 97, last: 98, probes: [[-3, 2, "a\ud83d", 2, 97, 55357], [2, 1, "\ud83d", 1, 55357, 55357], [99, 1, "\ud83d\ude00b", 3, 55357, 98], [99, 101, "", 0, NaN, NaN], [0, undefined, "a\ud83d\ude00b", 4, 97, 98], [1, 2, "\ud83d", 1, 55357, 55357]] },
  { input: "\udfff\ud800", size: 2, first: 57343, last: 55296, probes: [[-3, 2, "\udfff\ud800", 2, 57343, 55296], [2, 1, "\ud800", 1, 55296, 55296], [99, 1, "\ud800", 1, 55296, 55296], [99, 101, "", 0, NaN, NaN], [0, undefined, "\udfff\ud800", 2, 57343, 55296], [1, 2, "\ud800", 1, 55296, 55296]] }
];
interface SliceView { value: string; }
class SliceFirst implements SliceView { value: string = ""; count: number = 3; }
class SliceLast implements SliceView { count: number = 4; value: string = ""; }
for (const sample of samples) for (const alternate of [false, true]) {
  const carrier: SliceView = alternate ? new SliceLast() : new SliceFirst(); carrier.value = sample.input;
  const raw: string = carrier.value;
  assert.sameValue(raw, sample.input); assert.sameValue(raw.length, sample.size);
  assert.sameValue(raw.charCodeAt(0), sample.first); assert.sameValue(raw.charCodeAt(raw.length - 1), sample.last);
  for (const [start, end, expected, size, first, last] of sample.probes) {
    const result: string = carrier.value.substring(start, end);
    assert.sameValue(result, expected); assert.sameValue(result.length, size);
    assert.sameValue(result.charCodeAt(0), first); assert.sameValue(result.charCodeAt(result.length - 1), last);
  }
}
