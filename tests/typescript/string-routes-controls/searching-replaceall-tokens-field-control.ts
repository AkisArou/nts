/*---
description: Control for searching-replaceall-tokens-field; the same search or split uses plain string locals.
features: [ts-string-route-searching, ts-strings, ts-arrays, ts-iteration, ts-class, ts-class-fields]
---*/
// Control: ../string-routes/searching-replaceall-tokens-field.ts; replace only the string carrier with plain string locals.
class SearchReplace { value: string = ""; }
const samples = [
  { value: "", pattern: "x", replacement: "[$&|$1|$$]", edge: [0, NaN, NaN], want: "", outEdge: [0, NaN, NaN] },
  { value: "abcabc", pattern: "bc", replacement: "[$&|$1|$$]", edge: [6, 97, 99], want: "a[bc|$1|$]a[bc|$1|$]", outEdge: [20, 97, 93] },
  { value: "\u00e9\u00df\u00ff\u00e9", pattern: "\u00e9", replacement: "[$&|$1|$$]", edge: [4, 233, 233], want: "[\u00e9|$1|$]\u00df\u00ff[\u00e9|$1|$]", outEdge: [18, 91, 93] },
  { value: "\u0101x\u0101", pattern: "\u0101", replacement: "[$&|$1|$$]", edge: [3, 257, 257], want: "[\u0101|$1|$]x[\u0101|$1|$]", outEdge: [17, 91, 93] },
  { value: "\u4e2dx\u4e2d", pattern: "\u4e2d", replacement: "[$&|$1|$$]", edge: [3, 20013, 20013], want: "[\u4e2d|$1|$]x[\u4e2d|$1|$]", outEdge: [17, 91, 93] },
  { value: "\ud83d\ude00x\ud83d\ude00", pattern: "\ud83d\ude00", replacement: "[$&|$1|$$]", edge: [5, 55357, 56832], want: "[\ud83d\ude00|$1|$]x[\ud83d\ude00|$1|$]", outEdge: [19, 91, 93] },
  { value: "\ud800x\ud800", pattern: "\ud800", replacement: "[$&|$1|$$]", edge: [3, 55296, 55296], want: "[\ud800|$1|$]x[\ud800|$1|$]", outEdge: [17, 91, 93] },
  { value: "\udfffz\udfff", pattern: "\udfff", replacement: "[$&|$1|$$]", edge: [3, 57343, 57343], want: "[\udfff|$1|$]z[\udfff|$1|$]", outEdge: [17, 91, 93] },
  { value: "\u0101ab", pattern: "a", replacement: "[$&|$1|$$]", edge: [3, 257, 98], want: "\u0101[a|$1|$]b", outEdge: [10, 257, 98] },
  { value: "a\u0101b", pattern: "\u0101", replacement: "[$&|$1|$$]", edge: [3, 97, 98], want: "a[\u0101|$1|$]b", outEdge: [10, 97, 98] },
  { value: "ab\u0101", pattern: "\u0101", replacement: "[$&|$1|$$]", edge: [3, 97, 257], want: "ab[\u0101|$1|$]", outEdge: [10, 97, 93] },
  { value: "a\ud83d\ude00b", pattern: "\ude00", replacement: "[$&|$1|$$]", edge: [4, 97, 98], want: "a\ud83d[\ude00|$1|$]b", outEdge: [11, 97, 98] },
  { value: "abc", pattern: "\u0101", replacement: "[$&|$1|$$]", edge: [3, 97, 99], want: "abc", outEdge: [3, 97, 99] },
  { value: "a\u0000b", pattern: "\u0000", replacement: "[$&|$1|$$]", edge: [3, 97, 98], want: "a[\u0000|$1|$]b", outEdge: [10, 97, 98] },
];
function searchCheckText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first); assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const sample of samples) {
  let slot: string = ""; slot = sample.value;
  const observed: string = slot;
  const pattern: string = sample.pattern; const replacement: string = sample.replacement;
  searchCheckText(observed, sample.value, sample.edge[0], sample.edge[1], sample.edge[2]);
  const result: string = observed.replaceAll(pattern, replacement);
  searchCheckText(result, sample.want, sample.outEdge[0], sample.outEdge[1], sample.outEdge[2]);
}
