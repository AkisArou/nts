/*---
description: Control for slicing-forof-field; the same string operations use plain local strings.
features: [ts-string-route-slicing, ts-strings, ts-class, ts-class-fields, ts-arrays, ts-iteration]
---*/
// Control: ../string-routes/slicing-forof-field.ts; replace only the active string carrier with plain string locals.
interface IterationSample { input: string; size: number; first: number; last: number; points: string[]; sizes: number[]; starts: number[]; ends: number[]; units: string[]; codes: number[]; }
const samples: IterationSample[] = [
  { input: "", size: 0, first: NaN, last: NaN, points: [], sizes: [], starts: [], ends: [], units: [], codes: [] },
  { input: "ASCII", size: 5, first: 65, last: 73, points: ["A", "S", "C", "I", "I"], sizes: [1, 1, 1, 1, 1], starts: [65, 83, 67, 73, 73], ends: [65, 83, 67, 73, 73], units: ["A", "S", "C", "I", "I"], codes: [65, 83, 67, 73, 73] },
  { input: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255, points: ["\u00e9", "\u00df", "\u00ff"], sizes: [1, 1, 1], starts: [233, 223, 255], ends: [233, 223, 255], units: ["\u00e9", "\u00df", "\u00ff"], codes: [233, 223, 255] },
  { input: "\u0101", size: 1, first: 257, last: 257, points: ["\u0101"], sizes: [1], starts: [257], ends: [257], units: ["\u0101"], codes: [257] },
  { input: "\u4e2d", size: 1, first: 20013, last: 20013, points: ["\u4e2d"], sizes: [1], starts: [20013], ends: [20013], units: ["\u4e2d"], codes: [20013] },
  { input: "\ud83d\ude00", size: 2, first: 55357, last: 56832, points: ["\ud83d\ude00"], sizes: [2], starts: [55357], ends: [56832], units: ["\ud83d", "\ude00"], codes: [55357, 56832] },
  { input: "\ud800", size: 1, first: 55296, last: 55296, points: ["\ud800"], sizes: [1], starts: [55296], ends: [55296], units: ["\ud800"], codes: [55296] },
  { input: "\udfff", size: 1, first: 57343, last: 57343, points: ["\udfff"], sizes: [1], starts: [57343], ends: [57343], units: ["\udfff"], codes: [57343] },
  { input: "\u0101ab", size: 3, first: 257, last: 98, points: ["\u0101", "a", "b"], sizes: [1, 1, 1], starts: [257, 97, 98], ends: [257, 97, 98], units: ["\u0101", "a", "b"], codes: [257, 97, 98] },
  { input: "a\u4e2db", size: 3, first: 97, last: 98, points: ["a", "\u4e2d", "b"], sizes: [1, 1, 1], starts: [97, 20013, 98], ends: [97, 20013, 98], units: ["a", "\u4e2d", "b"], codes: [97, 20013, 98] },
  { input: "ab\u0101", size: 3, first: 97, last: 257, points: ["a", "b", "\u0101"], sizes: [1, 1, 1], starts: [97, 98, 257], ends: [97, 98, 257], units: ["a", "b", "\u0101"], codes: [97, 98, 257] },
  { input: "a\ud83d\ude00b", size: 4, first: 97, last: 98, points: ["a", "\ud83d\ude00", "b"], sizes: [1, 2, 1], starts: [97, 55357, 98], ends: [97, 56832, 98], units: ["a", "\ud83d", "\ude00", "b"], codes: [97, 55357, 56832, 98] },
  { input: "\udfff\ud800", size: 2, first: 57343, last: 55296, points: ["\udfff", "\ud800"], sizes: [1, 1], starts: [57343, 55296], ends: [57343, 55296], units: ["\udfff", "\ud800"], codes: [57343, 55296] }
];
class IterationCarrier { value: string = ""; }
for (const sample of samples) {
  let carrier: string = ""; carrier = sample.input;
  const raw: string = carrier;
  assert.sameValue(raw, sample.input); assert.sameValue(raw.length, sample.size);
  assert.sameValue(raw.charCodeAt(0), sample.first); assert.sameValue(raw.charCodeAt(raw.length - 1), sample.last);
  const points: string[] = []; for (const point of carrier) points.push(point);
  const indexed: string[] = []; for (let i = 0; i < raw.length; i++) indexed.push(raw[i]);
  assert.compareArray(points, sample.points); assert.compareArray(indexed, sample.units);
  assert.sameValue(points.length, sample.sizes.length); assert.sameValue(indexed.length, sample.size);
  for (let i = 0; i < points.length; i++) {
    assert.sameValue(points[i].length, sample.sizes[i]); assert.sameValue(points[i].charCodeAt(0), sample.starts[i]);
    assert.sameValue(points[i].charCodeAt(points[i].length - 1), sample.ends[i]);
  }
  for (let i = 0; i < indexed.length; i++) {
    assert.sameValue(indexed[i].length, 1); assert.sameValue(indexed[i].charCodeAt(0), sample.codes[i]);
  }
}
