/*---
description: Control for searching-wide-needle-parameter; the same search or split uses plain string locals.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-functions]
---*/
// Control: ../string-routes/searching-wide-needle-parameter.ts; replace only the string carrier with plain string locals.
function searchNeedle(value: string): string { return value; }
const samples = [
  { value: "", needle: "", edge: [0, NaN, NaN], needleEdge: [0, NaN, NaN], first: 0, last: 0 },
  { value: "abc", needle: "b", edge: [3, 97, 99], needleEdge: [1, 98, 98], first: 1, last: 1 },
  { value: "\u00e9\u00df\u00ff", needle: "\u00df", edge: [3, 233, 255], needleEdge: [1, 223, 223], first: 1, last: 1 },
  { value: "abc", needle: "\u0101", edge: [3, 97, 99], needleEdge: [1, 257, 257], first: -1, last: -1 },
  { value: "a\u0000b", needle: "\u0100", edge: [3, 97, 98], needleEdge: [1, 256, 256], first: -1, last: -1 },
  { value: "\u00e9", needle: "\u01e9", edge: [1, 233, 233], needleEdge: [1, 489, 489], first: -1, last: -1 },
  { value: "a-b", needle: "\u4e2d", edge: [3, 97, 98], needleEdge: [1, 20013, 20013], first: -1, last: -1 },
  { value: "abc", needle: "\ud83d\ude00", edge: [3, 97, 99], needleEdge: [2, 55357, 56832], first: -1, last: -1 },
  { value: "abc", needle: "\ud800", edge: [3, 97, 99], needleEdge: [1, 55296, 55296], first: -1, last: -1 },
  { value: "abc", needle: "\udfff", edge: [3, 97, 99], needleEdge: [1, 57343, 57343], first: -1, last: -1 },
  { value: "abc", needle: "\u0101a", edge: [3, 97, 99], needleEdge: [2, 257, 97], first: -1, last: -1 },
  { value: "abc", needle: "a\u0101b", edge: [3, 97, 99], needleEdge: [3, 97, 98], first: -1, last: -1 },
  { value: "abc", needle: "ab\u0101", edge: [3, 97, 99], needleEdge: [3, 97, 257], first: -1, last: -1 },
  { value: "abc", needle: "", edge: [3, 97, 99], needleEdge: [0, NaN, NaN], first: 0, last: 3 },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  const observed: string = sample.value;
  const needle: string = sample.needle;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  searchCheckText(needle, sample.needle, sample.needleEdge[0], sample.needleEdge[1], sample.needleEdge[2]);
  assert.sameValue(observed.indexOf(needle), sample.first);
  assert.sameValue(observed.lastIndexOf(needle), sample.last);
}
