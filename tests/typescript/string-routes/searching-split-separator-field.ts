/*---
description: String separators split a declared string field, preserving empty pieces and lone surrogate pieces.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-class, ts-class-fields]
---*/
// Route: String separators split a declared string field, preserving empty pieces and lone surrogate pieces. Node preserves UTF-16 contents, lengths, edge units and the exact result.
class SearchSplit { value: string = ""; }
const samples = [
  { value: "", separator: "|", edge: [0, NaN, NaN], parts: [""], pieceEdges: [[0, NaN, NaN]] },
  { value: "abcabc", separator: "bc", edge: [6, 97, 99], parts: ["a", "a", ""], pieceEdges: [[1, 97, 97], [1, 97, 97], [0, NaN, NaN]] },
  { value: "\u00e9\u00df\u00ff\u00e9", separator: "\u00e9", edge: [4, 233, 233], parts: ["", "\u00df\u00ff", ""], pieceEdges: [[0, NaN, NaN], [2, 223, 255], [0, NaN, NaN]] },
  { value: "\u0101x\u0101", separator: "\u0101", edge: [3, 257, 257], parts: ["", "x", ""], pieceEdges: [[0, NaN, NaN], [1, 120, 120], [0, NaN, NaN]] },
  { value: "\u4e2dx\u4e2d", separator: "\u4e2d", edge: [3, 20013, 20013], parts: ["", "x", ""], pieceEdges: [[0, NaN, NaN], [1, 120, 120], [0, NaN, NaN]] },
  { value: "\ud83d\ude00x\ud83d\ude00", separator: "\ud83d\ude00", edge: [5, 55357, 56832], parts: ["", "x", ""], pieceEdges: [[0, NaN, NaN], [1, 120, 120], [0, NaN, NaN]] },
  { value: "\ud800x\ud800", separator: "\ud800", edge: [3, 55296, 55296], parts: ["", "x", ""], pieceEdges: [[0, NaN, NaN], [1, 120, 120], [0, NaN, NaN]] },
  { value: "\udfffz\udfff", separator: "\udfff", edge: [3, 57343, 57343], parts: ["", "z", ""], pieceEdges: [[0, NaN, NaN], [1, 122, 122], [0, NaN, NaN]] },
  { value: "\u0101ab", separator: "a", edge: [3, 257, 98], parts: ["\u0101", "b"], pieceEdges: [[1, 257, 257], [1, 98, 98]] },
  { value: "a\u0101b", separator: "\u0101", edge: [3, 97, 98], parts: ["a", "b"], pieceEdges: [[1, 97, 97], [1, 98, 98]] },
  { value: "ab\u0101", separator: "\u0101", edge: [3, 97, 257], parts: ["ab", ""], pieceEdges: [[2, 97, 98], [0, NaN, NaN]] },
  { value: "a\ud83d\ude00b", separator: "\ude00", edge: [4, 97, 98], parts: ["a\ud83d", "b"], pieceEdges: [[2, 97, 55357], [1, 98, 98]] },
  { value: "a\u0000b", separator: "\u0000", edge: [3, 97, 98], parts: ["a", "b"], pieceEdges: [[1, 97, 97], [1, 98, 98]] },
  { value: "abc", separator: "\u0101", edge: [3, 97, 99], parts: ["abc"], pieceEdges: [[3, 97, 99]] },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  const slot = new SearchSplit(); slot.value = sample.value;
  const observed: string = slot.value;
  const separator: string = sample.separator;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  const pieces: string[] = observed.split(separator);
  assert.compareArray(pieces, sample.parts); assert.sameValue(pieces.length, sample.parts.length);
  for (let i = 0; i < pieces.length; i++) {
    searchCheckText(pieces[i], sample.parts[i], sample.pieceEdges[i][0], sample.pieceEdges[i][1], sample.pieceEdges[i][2]);
  }
}
