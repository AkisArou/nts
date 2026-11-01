/*---
description: replaceAll uses an empty string pattern on a string-constrained generic.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-generics, ts-generic-constraints, ts-functions]
---*/
// Route: replaceAll uses an empty string pattern on a string-constrained generic. Node preserves UTF-16 contents, lengths, edge units and the exact result.
function searchReplaceCarry<T extends string>(value: T): string { return value; }
const samples = [
  { value: "", pattern: "", replacement: "[$&|$1|$$]", edge: [0, NaN, NaN], want: "[|$1|$]", outEdge: [7, 91, 93] },
  { value: "abc", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 97, 99], want: "[|$1|$]a[|$1|$]b[|$1|$]c[|$1|$]", outEdge: [31, 91, 93] },
  { value: "\u00e9\u00df\u00ff", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 233, 255], want: "[|$1|$]\u00e9[|$1|$]\u00df[|$1|$]\u00ff[|$1|$]", outEdge: [31, 91, 93] },
  { value: "\u0101", pattern: "", replacement: "[$&|$1|$$]", edge: [1, 257, 257], want: "[|$1|$]\u0101[|$1|$]", outEdge: [15, 91, 93] },
  { value: "\u4e2d", pattern: "", replacement: "[$&|$1|$$]", edge: [1, 20013, 20013], want: "[|$1|$]\u4e2d[|$1|$]", outEdge: [15, 91, 93] },
  { value: "\ud83d\ude00", pattern: "", replacement: "[$&|$1|$$]", edge: [2, 55357, 56832], want: "[|$1|$]\ud83d[|$1|$]\ude00[|$1|$]", outEdge: [23, 91, 93] },
  { value: "\ud800", pattern: "", replacement: "[$&|$1|$$]", edge: [1, 55296, 55296], want: "[|$1|$]\ud800[|$1|$]", outEdge: [15, 91, 93] },
  { value: "\udfff", pattern: "", replacement: "[$&|$1|$$]", edge: [1, 57343, 57343], want: "[|$1|$]\udfff[|$1|$]", outEdge: [15, 91, 93] },
  { value: "\u0101ab", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 257, 98], want: "[|$1|$]\u0101[|$1|$]a[|$1|$]b[|$1|$]", outEdge: [31, 91, 93] },
  { value: "a\u0101b", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 97, 98], want: "[|$1|$]a[|$1|$]\u0101[|$1|$]b[|$1|$]", outEdge: [31, 91, 93] },
  { value: "ab\u0101", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 97, 257], want: "[|$1|$]a[|$1|$]b[|$1|$]\u0101[|$1|$]", outEdge: [31, 91, 93] },
  { value: "a\ud83d\ude00b", pattern: "", replacement: "[$&|$1|$$]", edge: [4, 97, 98], want: "[|$1|$]a[|$1|$]\ud83d[|$1|$]\ude00[|$1|$]b[|$1|$]", outEdge: [39, 91, 93] },
  { value: "\udfff\ud800", pattern: "", replacement: "[$&|$1|$$]", edge: [2, 57343, 55296], want: "[|$1|$]\udfff[|$1|$]\ud800[|$1|$]", outEdge: [23, 91, 93] },
  { value: "a\u0000b", pattern: "", replacement: "[$&|$1|$$]", edge: [3, 97, 98], want: "[|$1|$]a[|$1|$]\u0000[|$1|$]b[|$1|$]", outEdge: [31, 91, 93] },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  const observed: string = searchReplaceCarry(sample.value);
  const pattern: string = sample.pattern; const replacement: string = sample.replacement;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  const result: string = observed.replaceAll(pattern, replacement);
  searchCheckText(result, sample.want, sample.outEdge[0], sample.outEdge[1], sample.outEdge[2]);
}
