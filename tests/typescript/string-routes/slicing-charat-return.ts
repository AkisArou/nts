/*---
description: charAt reads exact single code units through a string return, including missing positions.
features: [ts-string-route-slicing, ts-strings, ts-functions, ts-arrays, ts-tuples, ts-iteration]
---*/
// Route: return string -> charAt; node returns one UTF-16 unit or the specified missing value.
type IndexProbe = [number, string, number, number, number];
interface IndexSample { input: string; size: number; first: number; last: number; probes: IndexProbe[]; }
const samples: IndexSample[] = [
  { input: "", size: 0, first: NaN, last: NaN, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "", 0, NaN, NaN], [1, "", 0, NaN, NaN], [2, "", 0, NaN, NaN], [99, "", 0, NaN, NaN]] },
  { input: "ASCII", size: 5, first: 65, last: 73, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "A", 1, 65, 65], [1, "S", 1, 83, 83], [2, "C", 1, 67, 67], [99, "", 0, NaN, NaN]] },
  { input: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "\u00e9", 1, 233, 233], [1, "\u00df", 1, 223, 223], [2, "\u00ff", 1, 255, 255], [99, "", 0, NaN, NaN]] },
  { input: "\u0101", size: 1, first: 257, last: 257, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "\u0101", 1, 257, 257], [1, "", 0, NaN, NaN], [2, "", 0, NaN, NaN], [99, "", 0, NaN, NaN]] },
  { input: "\u4e2d", size: 1, first: 20013, last: 20013, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "\u4e2d", 1, 20013, 20013], [1, "", 0, NaN, NaN], [2, "", 0, NaN, NaN], [99, "", 0, NaN, NaN]] },
  { input: "\ud83d\ude00", size: 2, first: 55357, last: 56832, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "\ud83d", 1, 55357, 55357], [1, "\ude00", 1, 56832, 56832], [2, "", 0, NaN, NaN], [99, "", 0, NaN, NaN]] },
  { input: "\ud800", size: 1, first: 55296, last: 55296, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "\ud800", 1, 55296, 55296], [1, "", 0, NaN, NaN], [2, "", 0, NaN, NaN], [99, "", 0, NaN, NaN]] },
  { input: "\udfff", size: 1, first: 57343, last: 57343, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "\udfff", 1, 57343, 57343], [1, "", 0, NaN, NaN], [2, "", 0, NaN, NaN], [99, "", 0, NaN, NaN]] },
  { input: "\u0101ab", size: 3, first: 257, last: 98, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "\u0101", 1, 257, 257], [1, "a", 1, 97, 97], [2, "b", 1, 98, 98], [99, "", 0, NaN, NaN]] },
  { input: "a\u4e2db", size: 3, first: 97, last: 98, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "a", 1, 97, 97], [1, "\u4e2d", 1, 20013, 20013], [2, "b", 1, 98, 98], [99, "", 0, NaN, NaN]] },
  { input: "ab\u0101", size: 3, first: 97, last: 257, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "a", 1, 97, 97], [1, "b", 1, 98, 98], [2, "\u0101", 1, 257, 257], [99, "", 0, NaN, NaN]] },
  { input: "a\ud83d\ude00b", size: 4, first: 97, last: 98, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "a", 1, 97, 97], [1, "\ud83d", 1, 55357, 55357], [2, "\ude00", 1, 56832, 56832], [99, "", 0, NaN, NaN]] },
  { input: "\udfff\ud800", size: 2, first: 57343, last: 55296, probes: [[-99, "", 0, NaN, NaN], [-2, "", 0, NaN, NaN], [-1, "", 0, NaN, NaN], [0, "\udfff", 1, 57343, 57343], [1, "\ud800", 1, 55296, 55296], [2, "", 0, NaN, NaN], [99, "", 0, NaN, NaN]] }
];
function charAtText(value: string): string { return value; }
for (const sample of samples) {
  const raw: string = charAtText(sample.input);
  assert.sameValue(raw, sample.input); assert.sameValue(raw.length, sample.size);
  assert.sameValue(raw.charCodeAt(0), sample.first); assert.sameValue(raw.charCodeAt(raw.length - 1), sample.last);
  for (const [position, expected, size, first, last] of sample.probes) {
    const result: string = raw.charAt(position);
    assert.sameValue(result, expected);
    if (result !== undefined) {
      assert.sameValue(result.length, size); assert.sameValue(result.charCodeAt(0), first);
      assert.sameValue(result.charCodeAt(result.length - 1), last);
    }
  }
}
