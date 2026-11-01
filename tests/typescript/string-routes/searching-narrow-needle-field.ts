/*---
description: A declared string field carries mixed-width haystacks searched with one-byte needles.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-class, ts-class-fields]
---*/
// Route: A declared string field carries mixed-width haystacks searched with one-byte needles. Node preserves UTF-16 contents, lengths, edge units and the exact result.
class SearchHaystack { value: string = ""; }
const samples = [
  { value: "", needle: "", edge: [0, NaN, NaN], needleEdge: [0, NaN, NaN], first: 0, last: 0 },
  { value: "abc", needle: "b", edge: [3, 97, 99], needleEdge: [1, 98, 98], first: 1, last: 1 },
  { value: "\u00e9\u00df\u00ff", needle: "\u00df", edge: [3, 233, 255], needleEdge: [1, 223, 223], first: 1, last: 1 },
  { value: "\u0101ab", needle: "a", edge: [3, 257, 98], needleEdge: [1, 97, 97], first: 1, last: 1 },
  { value: "a\u0101b", needle: "a", edge: [3, 97, 98], needleEdge: [1, 97, 97], first: 0, last: 0 },
  { value: "ab\u0101", needle: "b", edge: [3, 97, 257], needleEdge: [1, 98, 98], first: 1, last: 1 },
  { value: "\u4e2d\u00e9\u00ff", needle: "\u00e9", edge: [3, 20013, 255], needleEdge: [1, 233, 233], first: 1, last: 1 },
  { value: "\ud83d\ude00a", needle: "a", edge: [3, 55357, 97], needleEdge: [1, 97, 97], first: 2, last: 2 },
  { value: "a\ud800", needle: "a", edge: [2, 97, 55296], needleEdge: [1, 97, 97], first: 0, last: 0 },
  { value: "\udfffz", needle: "z", edge: [2, 57343, 122], needleEdge: [1, 122, 122], first: 1, last: 1 },
  { value: "\u0100b", needle: "\u0000", edge: [2, 256, 98], needleEdge: [1, 0, 0], first: -1, last: -1 },
  { value: "a\u01e9b", needle: "\u00e9", edge: [3, 97, 98], needleEdge: [1, 233, 233], first: -1, last: -1 },
  { value: "a\u0101b", needle: "", edge: [3, 97, 98], needleEdge: [0, NaN, NaN], first: 0, last: 3 },
  { value: "\u0101ab\u0101ab", needle: "ab", edge: [6, 257, 98], needleEdge: [2, 97, 98], first: 1, last: 4 },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  const slot = new SearchHaystack(); slot.value = sample.value;
  const observed: string = slot.value; const needle: string = sample.needle;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  searchCheckText(needle, sample.needle, sample.needleEdge[0], sample.needleEdge[1], sample.needleEdge[2]);
  assert.sameValue(observed.indexOf(needle), sample.first);
  assert.sameValue(observed.lastIndexOf(needle), sample.last);
}
