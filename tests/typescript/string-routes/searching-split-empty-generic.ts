/*---
description: An empty separator splits a string-constrained generic value into UTF-16 code units.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-generics, ts-generic-constraints, ts-functions]
---*/
// Route: An empty separator splits a string-constrained generic value into UTF-16 code units. Node preserves UTF-16 contents, lengths, edge units and the exact result.
function searchSplitCarry<T extends string>(value: T): string { return value; }
const samples = [
  { value: "", separator: "", edge: [0, NaN, NaN], parts: [], pieceEdges: [] },
  { value: "abc", separator: "", edge: [3, 97, 99], parts: ["a", "b", "c"], pieceEdges: [[1, 97, 97], [1, 98, 98], [1, 99, 99]] },
  { value: "\u00e9\u00df\u00ff", separator: "", edge: [3, 233, 255], parts: ["\u00e9", "\u00df", "\u00ff"], pieceEdges: [[1, 233, 233], [1, 223, 223], [1, 255, 255]] },
  { value: "\u0101", separator: "", edge: [1, 257, 257], parts: ["\u0101"], pieceEdges: [[1, 257, 257]] },
  { value: "\u4e2d", separator: "", edge: [1, 20013, 20013], parts: ["\u4e2d"], pieceEdges: [[1, 20013, 20013]] },
  { value: "\ud83d\ude00", separator: "", edge: [2, 55357, 56832], parts: ["\ud83d", "\ude00"], pieceEdges: [[1, 55357, 55357], [1, 56832, 56832]] },
  { value: "\ud800", separator: "", edge: [1, 55296, 55296], parts: ["\ud800"], pieceEdges: [[1, 55296, 55296]] },
  { value: "\udfff", separator: "", edge: [1, 57343, 57343], parts: ["\udfff"], pieceEdges: [[1, 57343, 57343]] },
  { value: "\u0101ab", separator: "", edge: [3, 257, 98], parts: ["\u0101", "a", "b"], pieceEdges: [[1, 257, 257], [1, 97, 97], [1, 98, 98]] },
  { value: "a\u0101b", separator: "", edge: [3, 97, 98], parts: ["a", "\u0101", "b"], pieceEdges: [[1, 97, 97], [1, 257, 257], [1, 98, 98]] },
  { value: "ab\u0101", separator: "", edge: [3, 97, 257], parts: ["a", "b", "\u0101"], pieceEdges: [[1, 97, 97], [1, 98, 98], [1, 257, 257]] },
  { value: "a\ud83d\ude00b", separator: "", edge: [4, 97, 98], parts: ["a", "\ud83d", "\ude00", "b"], pieceEdges: [[1, 97, 97], [1, 55357, 55357], [1, 56832, 56832], [1, 98, 98]] },
  { value: "\udfff\ud800", separator: "", edge: [2, 57343, 55296], parts: ["\udfff", "\ud800"], pieceEdges: [[1, 57343, 57343], [1, 55296, 55296]] },
  { value: "a\u0000b", separator: "", edge: [3, 97, 98], parts: ["a", "\u0000", "b"], pieceEdges: [[1, 97, 97], [1, 0, 0], [1, 98, 98]] },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  const observed: string = searchSplitCarry(sample.value);
  const separator: string = sample.separator;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  const pieces: string[] = observed.split(separator);
  assert.compareArray(pieces, sample.parts); assert.sameValue(pieces.length, sample.parts.length);
  for (let i = 0; i < pieces.length; i++) {
    searchCheckText(pieces[i], sample.parts[i], sample.pieceEdges[i][0], sample.pieceEdges[i][1], sample.pieceEdges[i][2]);
  }
}
