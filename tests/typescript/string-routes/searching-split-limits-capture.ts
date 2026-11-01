/*---
description: Split limits truncate pieces read through a captured string, including a split surrogate pair.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-closures, ts-functions]
---*/
// Route: Split limits truncate pieces read through a captured string, including a split surrogate pair. Node preserves UTF-16 contents, lengths, edge units and the exact result.

const samples = [
  { value: "", separator: "|", limit: 0, edge: [0, NaN, NaN], parts: [], pieceEdges: [] },
  { value: "abcabc", separator: "bc", limit: 1, edge: [6, 97, 99], parts: ["a"], pieceEdges: [[1, 97, 97]] },
  { value: "\u00e9\u00df\u00ff", separator: "", limit: 2, edge: [3, 233, 255], parts: ["\u00e9", "\u00df"], pieceEdges: [[1, 233, 233], [1, 223, 223]] },
  { value: "\u0101x\u0101", separator: "\u0101", limit: 2, edge: [3, 257, 257], parts: ["", "x"], pieceEdges: [[0, NaN, NaN], [1, 120, 120]] },
  { value: "\u4e2dx\u4e2d", separator: "\u4e2d", limit: 9, edge: [3, 20013, 20013], parts: ["", "x", ""], pieceEdges: [[0, NaN, NaN], [1, 120, 120], [0, NaN, NaN]] },
  { value: "\ud83d\ude00", separator: "", limit: 1, edge: [2, 55357, 56832], parts: ["\ud83d"], pieceEdges: [[1, 55357, 55357]] },
  { value: "\ud800x\ud800", separator: "\ud800", limit: 0, edge: [3, 55296, 55296], parts: [], pieceEdges: [] },
  { value: "\udfffz\udfff", separator: "\udfff", limit: 2, edge: [3, 57343, 57343], parts: ["", "z"], pieceEdges: [[0, NaN, NaN], [1, 122, 122]] },
  { value: "\u0101ab", separator: "", limit: 2, edge: [3, 257, 98], parts: ["\u0101", "a"], pieceEdges: [[1, 257, 257], [1, 97, 97]] },
  { value: "a\u0101b", separator: "", limit: 2, edge: [3, 97, 98], parts: ["a", "\u0101"], pieceEdges: [[1, 97, 97], [1, 257, 257]] },
  { value: "ab\u0101", separator: "", limit: 99, edge: [3, 97, 257], parts: ["a", "b", "\u0101"], pieceEdges: [[1, 97, 97], [1, 98, 98], [1, 257, 257]] },
  { value: "a\ud83d\ude00b", separator: "", limit: 3, edge: [4, 97, 98], parts: ["a", "\ud83d", "\ude00"], pieceEdges: [[1, 97, 97], [1, 55357, 55357], [1, 56832, 56832]] },
  { value: "ab", separator: "", limit: -1, edge: [2, 97, 98], parts: ["a", "b"], pieceEdges: [[1, 97, 97], [1, 98, 98]] },
  { value: "ab", separator: "", limit: 4294967296, edge: [2, 97, 98], parts: [], pieceEdges: [] },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  let captured: string = ""; const read = (): string => captured;
  captured = sample.value; const observed: string = read();
  const separator: string = sample.separator;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  const pieces: string[] = observed.split(separator, sample.limit);
  assert.compareArray(pieces, sample.parts); assert.sameValue(pieces.length, sample.parts.length);
  for (let i = 0; i < pieces.length; i++) {
    searchCheckText(pieces[i], sample.parts[i], sample.pieceEdges[i][0], sample.pieceEdges[i][1], sample.pieceEdges[i][2]);
  }
}
