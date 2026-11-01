/*---
description: at reads exact single code units through a string field, including missing positions.
features: [ts-string-route-slicing, ts-strings, ts-class, ts-class-fields, ts-arrays, ts-tuples, ts-iteration]
---*/
// Route: field string -> at; node returns one UTF-16 unit or the specified missing value.
type IndexProbe = [number, string | undefined, number, number, number];
interface IndexSample { input: string; size: number; first: number; last: number; probes: IndexProbe[]; }
const samples: IndexSample[] = [
  { input: "", size: 0, first: NaN, last: NaN, probes: [[-99, undefined, 0, NaN, NaN], [-2, undefined, 0, NaN, NaN], [-1, undefined, 0, NaN, NaN], [0, undefined, 0, NaN, NaN], [1, undefined, 0, NaN, NaN], [2, undefined, 0, NaN, NaN], [99, undefined, 0, NaN, NaN]] },
  { input: "ASCII", size: 5, first: 65, last: 73, probes: [[-99, undefined, 0, NaN, NaN], [-2, "I", 1, 73, 73], [-1, "I", 1, 73, 73], [0, "A", 1, 65, 65], [1, "S", 1, 83, 83], [2, "C", 1, 67, 67], [99, undefined, 0, NaN, NaN]] },
  { input: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255, probes: [[-99, undefined, 0, NaN, NaN], [-2, "\u00df", 1, 223, 223], [-1, "\u00ff", 1, 255, 255], [0, "\u00e9", 1, 233, 233], [1, "\u00df", 1, 223, 223], [2, "\u00ff", 1, 255, 255], [99, undefined, 0, NaN, NaN]] },
  { input: "\u0101", size: 1, first: 257, last: 257, probes: [[-99, undefined, 0, NaN, NaN], [-2, undefined, 0, NaN, NaN], [-1, "\u0101", 1, 257, 257], [0, "\u0101", 1, 257, 257], [1, undefined, 0, NaN, NaN], [2, undefined, 0, NaN, NaN], [99, undefined, 0, NaN, NaN]] },
  { input: "\u4e2d", size: 1, first: 20013, last: 20013, probes: [[-99, undefined, 0, NaN, NaN], [-2, undefined, 0, NaN, NaN], [-1, "\u4e2d", 1, 20013, 20013], [0, "\u4e2d", 1, 20013, 20013], [1, undefined, 0, NaN, NaN], [2, undefined, 0, NaN, NaN], [99, undefined, 0, NaN, NaN]] },
  { input: "\ud83d\ude00", size: 2, first: 55357, last: 56832, probes: [[-99, undefined, 0, NaN, NaN], [-2, "\ud83d", 1, 55357, 55357], [-1, "\ude00", 1, 56832, 56832], [0, "\ud83d", 1, 55357, 55357], [1, "\ude00", 1, 56832, 56832], [2, undefined, 0, NaN, NaN], [99, undefined, 0, NaN, NaN]] },
  { input: "\ud800", size: 1, first: 55296, last: 55296, probes: [[-99, undefined, 0, NaN, NaN], [-2, undefined, 0, NaN, NaN], [-1, "\ud800", 1, 55296, 55296], [0, "\ud800", 1, 55296, 55296], [1, undefined, 0, NaN, NaN], [2, undefined, 0, NaN, NaN], [99, undefined, 0, NaN, NaN]] },
  { input: "\udfff", size: 1, first: 57343, last: 57343, probes: [[-99, undefined, 0, NaN, NaN], [-2, undefined, 0, NaN, NaN], [-1, "\udfff", 1, 57343, 57343], [0, "\udfff", 1, 57343, 57343], [1, undefined, 0, NaN, NaN], [2, undefined, 0, NaN, NaN], [99, undefined, 0, NaN, NaN]] },
  { input: "\u0101ab", size: 3, first: 257, last: 98, probes: [[-99, undefined, 0, NaN, NaN], [-2, "a", 1, 97, 97], [-1, "b", 1, 98, 98], [0, "\u0101", 1, 257, 257], [1, "a", 1, 97, 97], [2, "b", 1, 98, 98], [99, undefined, 0, NaN, NaN]] },
  { input: "a\u4e2db", size: 3, first: 97, last: 98, probes: [[-99, undefined, 0, NaN, NaN], [-2, "\u4e2d", 1, 20013, 20013], [-1, "b", 1, 98, 98], [0, "a", 1, 97, 97], [1, "\u4e2d", 1, 20013, 20013], [2, "b", 1, 98, 98], [99, undefined, 0, NaN, NaN]] },
  { input: "ab\u0101", size: 3, first: 97, last: 257, probes: [[-99, undefined, 0, NaN, NaN], [-2, "b", 1, 98, 98], [-1, "\u0101", 1, 257, 257], [0, "a", 1, 97, 97], [1, "b", 1, 98, 98], [2, "\u0101", 1, 257, 257], [99, undefined, 0, NaN, NaN]] },
  { input: "a\ud83d\ude00b", size: 4, first: 97, last: 98, probes: [[-99, undefined, 0, NaN, NaN], [-2, "\ude00", 1, 56832, 56832], [-1, "b", 1, 98, 98], [0, "a", 1, 97, 97], [1, "\ud83d", 1, 55357, 55357], [2, "\ude00", 1, 56832, 56832], [99, undefined, 0, NaN, NaN]] },
  { input: "\udfff\ud800", size: 2, first: 57343, last: 55296, probes: [[-99, undefined, 0, NaN, NaN], [-2, "\udfff", 1, 57343, 57343], [-1, "\ud800", 1, 55296, 55296], [0, "\udfff", 1, 57343, 57343], [1, "\ud800", 1, 55296, 55296], [2, undefined, 0, NaN, NaN], [99, undefined, 0, NaN, NaN]] }
];
class AtCarrier { value: string = ""; }
for (const sample of samples) {
  const carrier = new AtCarrier(); carrier.value = sample.input;
  const raw: string = carrier.value;
  assert.sameValue(raw, sample.input); assert.sameValue(raw.length, sample.size);
  assert.sameValue(raw.charCodeAt(0), sample.first); assert.sameValue(raw.charCodeAt(raw.length - 1), sample.last);
  for (const [position, expected, size, first, last] of sample.probes) {
    const result: string | undefined = carrier.value.at(position);
    assert.sameValue(result, expected);
    if (result !== undefined) {
      assert.sameValue(result.length, size); assert.sameValue(result.charCodeAt(0), first);
      assert.sameValue(result.charCodeAt(result.length - 1), last);
    }
  }
}
