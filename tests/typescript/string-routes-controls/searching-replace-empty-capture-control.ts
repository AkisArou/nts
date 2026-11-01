/*---
description: Control for searching-replace-empty-capture; the same search or split uses plain string locals.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-closures, ts-functions]
---*/
// Control: ../string-routes/searching-replace-empty-capture.ts; replace only the string carrier with plain string locals.

const samples = [
  { value: "", pattern: "", replacement: "[$&|$1|$$]", edge: [0, NaN, NaN], want: "[|$1|$]", outEdge: [7, 91, 93] },
  { value: "abc", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 97, 99], want: "[|$1|$]abc", outEdge: [10, 91, 99] },
  { value: "\u00e9\u00df\u00ff", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 233, 255], want: "[|$1|$]\u00e9\u00df\u00ff", outEdge: [10, 91, 255] },
  { value: "\u0101", pattern: "", replacement: "[$&|$1|$$]", edge: [1, 257, 257], want: "[|$1|$]\u0101", outEdge: [8, 91, 257] },
  { value: "\u4e2d", pattern: "", replacement: "[$&|$1|$$]", edge: [1, 20013, 20013], want: "[|$1|$]\u4e2d", outEdge: [8, 91, 20013] },
  { value: "\ud83d\ude00", pattern: "", replacement: "[$&|$1|$$]", edge: [2, 55357, 56832], want: "[|$1|$]\ud83d\ude00", outEdge: [9, 91, 56832] },
  { value: "\ud800", pattern: "", replacement: "[$&|$1|$$]", edge: [1, 55296, 55296], want: "[|$1|$]\ud800", outEdge: [8, 91, 55296] },
  { value: "\udfff", pattern: "", replacement: "[$&|$1|$$]", edge: [1, 57343, 57343], want: "[|$1|$]\udfff", outEdge: [8, 91, 57343] },
  { value: "\u0101ab", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 257, 98], want: "[|$1|$]\u0101ab", outEdge: [10, 91, 98] },
  { value: "a\u0101b", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 97, 98], want: "[|$1|$]a\u0101b", outEdge: [10, 91, 98] },
  { value: "ab\u0101", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 97, 257], want: "[|$1|$]ab\u0101", outEdge: [10, 91, 257] },
  { value: "a\ud83d\ude00b", pattern: "", replacement: "[$&|$1|$$]", edge: [4, 97, 98], want: "[|$1|$]a\ud83d\ude00b", outEdge: [11, 91, 98] },
  { value: "\udfff\ud800", pattern: "", replacement: "[$&|$1|$$]", edge: [2, 57343, 55296], want: "[|$1|$]\udfff\ud800", outEdge: [9, 91, 55296] },
  { value: "a\u0000b", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 97, 98], want: "[|$1|$]a\u0000b", outEdge: [10, 91, 98] },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  let captured: string = "";
  captured = sample.value; const observed: string = captured;
  const pattern: string = sample.pattern; const replacement: string = sample.replacement;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  const result: string = observed.replace(pattern, replacement);
  searchCheckText(result, sample.want, sample.outEdge[0], sample.outEdge[1], sample.outEdge[2]);
}
