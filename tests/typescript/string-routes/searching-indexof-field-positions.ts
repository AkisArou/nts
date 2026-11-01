/*---
description: indexOf searches a declared string field at negative, fractional and out-of-range positions.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-class, ts-class-fields]
---*/
// Route: indexOf searches a declared string field at negative, fractional and out-of-range positions. Node preserves UTF-16 contents, lengths, edge units and the exact result.
class SearchCell { value: string = ""; }
const positions: number[] = [-3, -1.8, 0, 1, 1.8, 2, 99, NaN, Infinity, -Infinity];
const samples = [
  { value: "", needle: "", edge: [0, NaN, NaN], needleEdge: [0, NaN, NaN], want: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { value: "abcabc", needle: "bc", edge: [6, 97, 99], needleEdge: [2, 98, 99], want: [1, 1, 1, 1, 1, 4, -1, 1, -1, 1] },
  { value: "\u00e9\u00df\u00ff\u00e9", needle: "\u00e9", edge: [4, 233, 233], needleEdge: [1, 233, 233], want: [0, 0, 0, 3, 3, 3, -1, 0, -1, 0] },
  { value: "\u0101x\u0101", needle: "\u0101", edge: [3, 257, 257], needleEdge: [1, 257, 257], want: [0, 0, 0, 2, 2, 2, -1, 0, -1, 0] },
  { value: "\u4e2dx\u4e2d", needle: "\u4e2d", edge: [3, 20013, 20013], needleEdge: [1, 20013, 20013], want: [0, 0, 0, 2, 2, 2, -1, 0, -1, 0] },
  { value: "\ud83d\ude00x\ud83d\ude00", needle: "\ud83d\ude00", edge: [5, 55357, 56832], needleEdge: [2, 55357, 56832], want: [0, 0, 0, 3, 3, 3, -1, 0, -1, 0] },
  { value: "\ud800x\ud800", needle: "\ud800", edge: [3, 55296, 55296], needleEdge: [1, 55296, 55296], want: [0, 0, 0, 2, 2, 2, -1, 0, -1, 0] },
  { value: "\udfffz\udfff", needle: "\udfff", edge: [3, 57343, 57343], needleEdge: [1, 57343, 57343], want: [0, 0, 0, 2, 2, 2, -1, 0, -1, 0] },
  { value: "\u0101ab", needle: "a", edge: [3, 257, 98], needleEdge: [1, 97, 97], want: [1, 1, 1, 1, 1, -1, -1, 1, -1, 1] },
  { value: "a\u0101b", needle: "\u0101", edge: [3, 97, 98], needleEdge: [1, 257, 257], want: [1, 1, 1, 1, 1, -1, -1, 1, -1, 1] },
  { value: "ab\u0101", needle: "\u0101", edge: [3, 97, 257], needleEdge: [1, 257, 257], want: [2, 2, 2, 2, 2, 2, -1, 2, -1, 2] },
  { value: "a\ud83d\ude00b", needle: "\ude00", edge: [4, 97, 98], needleEdge: [1, 56832, 56832], want: [2, 2, 2, 2, 2, 2, -1, 2, -1, 2] },
  { value: "e\u0301\u00e9", needle: "\u00e9", edge: [3, 101, 233], needleEdge: [1, 233, 233], want: [2, 2, 2, 2, 2, 2, -1, 2, -1, 2] },
  { value: "a\u0000b", needle: "\u0000", edge: [3, 97, 98], needleEdge: [1, 0, 0], want: [1, 1, 1, 1, 1, -1, -1, 1, -1, 1] },
  { value: "a\u0100b", needle: "\u0000", edge: [3, 97, 98], needleEdge: [1, 0, 0], want: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1] },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  const slot = new SearchCell(); slot.value = sample.value;
  const observed: string = slot.value;
  const needle: string = sample.needle;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  searchCheckText(needle, sample.needle, sample.needleEdge[0], sample.needleEdge[1], sample.needleEdge[2]);
  for (let i = 0; i < positions.length; i++) {
    assert.sameValue(observed.indexOf(needle, positions[i]), sample.want[i]);
  }
}
