/*---
description: Indexed reads of an updated captured string preserve every UTF-16 code unit.
features: [ts-string-route-slicing, ts-strings, ts-closures, ts-functions, ts-arrays, ts-iteration]
---*/
// Route: updated captured string -> indexed reads; node reads the assigned value and keeps surrogate halves separate.
interface CaptureSample { input: string; size: number; first: number; last: number; units: string[]; codes: number[]; }
const samples: CaptureSample[] = [
  { input: "", size: 0, first: NaN, last: NaN, units: [], codes: [] },
  { input: "ASCII", size: 5, first: 65, last: 73, units: ["A", "S", "C", "I", "I"], codes: [65, 83, 67, 73, 73] },
  { input: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255, units: ["\u00e9", "\u00df", "\u00ff"], codes: [233, 223, 255] },
  { input: "\u0101", size: 1, first: 257, last: 257, units: ["\u0101"], codes: [257] },
  { input: "\u4e2d", size: 1, first: 20013, last: 20013, units: ["\u4e2d"], codes: [20013] },
  { input: "\ud83d\ude00", size: 2, first: 55357, last: 56832, units: ["\ud83d", "\ude00"], codes: [55357, 56832] },
  { input: "\ud800", size: 1, first: 55296, last: 55296, units: ["\ud800"], codes: [55296] },
  { input: "\udfff", size: 1, first: 57343, last: 57343, units: ["\udfff"], codes: [57343] },
  { input: "\u0101ab", size: 3, first: 257, last: 98, units: ["\u0101", "a", "b"], codes: [257, 97, 98] },
  { input: "a\u4e2db", size: 3, first: 97, last: 98, units: ["a", "\u4e2d", "b"], codes: [97, 20013, 98] },
  { input: "ab\u0101", size: 3, first: 97, last: 257, units: ["a", "b", "\u0101"], codes: [97, 98, 257] },
  { input: "a\ud83d\ude00b", size: 4, first: 97, last: 98, units: ["a", "\ud83d", "\ude00", "b"], codes: [97, 55357, 56832, 98] },
  { input: "\udfff\ud800", size: 2, first: 57343, last: 55296, units: ["\udfff", "\ud800"], codes: [57343, 55296] }
];
for (const sample of samples) {
  let captured: string = ""; const read = (): string => captured; captured = sample.input;
  const raw: string = read(); const indexed: string[] = [];
  for (let i = 0; i < read().length; i++) indexed.push(read()[i]);
  assert.sameValue(raw, sample.input); assert.sameValue(raw.length, sample.size);
  assert.sameValue(raw.charCodeAt(0), sample.first); assert.sameValue(raw.charCodeAt(raw.length - 1), sample.last);
  assert.compareArray(indexed, sample.units); assert.sameValue(indexed.length, sample.size);
  for (let i = 0; i < indexed.length; i++) {
    assert.sameValue(indexed[i].length, 1); assert.sameValue(indexed[i].charCodeAt(0), sample.codes[i]);
  }
}
