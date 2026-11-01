/*---
description: Control for searching-startswith-generic-positions; the same search or split uses plain string locals.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-generics, ts-generic-constraints, ts-functions]
---*/
// Control: ../string-routes/searching-startswith-generic-positions.ts; replace only the string carrier with plain string locals.
function searchCarry<T extends string>(value: T): string { return value; }
const positions: number[] = [-3, -1.8, 0, 1, 1.8, 2, 99, NaN, Infinity, -Infinity];
const samples = [
  { value: "", needle: "", edge: [0, NaN, NaN], needleEdge: [0, NaN, NaN], want: [true, true, true, true, true, true, true, true, true, true] },
  { value: "abcabc", needle: "bc", edge: [6, 97, 99], needleEdge: [2, 98, 99], want: [false, false, false, true, true, false, false, false, false, false] },
  { value: "\u00e9\u00df\u00ff\u00e9", needle: "\u00e9", edge: [4, 233, 233], needleEdge: [1, 233, 233], want: [true, true, true, false, false, false, false, true, false, true] },
  { value: "\u0101x\u0101", needle: "\u0101", edge: [3, 257, 257], needleEdge: [1, 257, 257], want: [true, true, true, false, false, true, false, true, false, true] },
  { value: "\u4e2dx\u4e2d", needle: "\u4e2d", edge: [3, 20013, 20013], needleEdge: [1, 20013, 20013], want: [true, true, true, false, false, true, false, true, false, true] },
  { value: "\ud83d\ude00x\ud83d\ude00", needle: "\ud83d\ude00", edge: [5, 55357, 56832], needleEdge: [2, 55357, 56832], want: [true, true, true, false, false, false, false, true, false, true] },
  { value: "\ud800x\ud800", needle: "\ud800", edge: [3, 55296, 55296], needleEdge: [1, 55296, 55296], want: [true, true, true, false, false, true, false, true, false, true] },
  { value: "\udfffz\udfff", needle: "\udfff", edge: [3, 57343, 57343], needleEdge: [1, 57343, 57343], want: [true, true, true, false, false, true, false, true, false, true] },
  { value: "\u0101ab", needle: "a", edge: [3, 257, 98], needleEdge: [1, 97, 97], want: [false, false, false, true, true, false, false, false, false, false] },
  { value: "a\u0101b", needle: "\u0101", edge: [3, 97, 98], needleEdge: [1, 257, 257], want: [false, false, false, true, true, false, false, false, false, false] },
  { value: "ab\u0101", needle: "\u0101", edge: [3, 97, 257], needleEdge: [1, 257, 257], want: [false, false, false, false, false, true, false, false, false, false] },
  { value: "a\ud83d\ude00b", needle: "\ude00", edge: [4, 97, 98], needleEdge: [1, 56832, 56832], want: [false, false, false, false, false, true, false, false, false, false] },
  { value: "e\u0301\u00e9", needle: "\u00e9", edge: [3, 101, 233], needleEdge: [1, 233, 233], want: [false, false, false, false, false, true, false, false, false, false] },
  { value: "a\u0000b", needle: "\u0000", edge: [3, 97, 98], needleEdge: [1, 0, 0], want: [false, false, false, true, true, false, false, false, false, false] },
  { value: "a\u0100b", needle: "\u0000", edge: [3, 97, 98], needleEdge: [1, 0, 0], want: [false, false, false, false, false, false, false, false, false, false] },
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
  for (let i = 0; i < positions.length; i++) {
    assert.sameValue(observed.startsWith(needle, positions[i]), sample.want[i]);
  }
}
