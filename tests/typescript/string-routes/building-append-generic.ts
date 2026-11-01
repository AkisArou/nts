/*---
description: A constrained generic accumulator preserves appended UTF-16 pieces after widening its seed to string.
features: [ts-string-route-building, ts-strings, ts-functions, ts-generics, ts-generic-constraints, ts-readonly, ts-arrays, ts-iteration]
---*/
// Route: an accumulator constrained by T extends string; node retains the exact UTF-16 text, length and endpoint code units.
function accumulateBuilt<T extends string>(seed: T, parts: readonly T[]): string {
  let stored: string = seed; for (const part of parts) stored += part; return stored;
}
interface BuildingSample { seed: string; parts: string[]; expected: string; size: number; first: number; last: number; }
const rows: BuildingSample[] = [
  { seed: "", parts: [], expected: "", size: 0, first: NaN, last: NaN },
  { seed: "ab", parts: [], expected: "ab", size: 2, first: 97, last: 98 },
  { seed: "", parts: ["a", "b"], expected: "ab", size: 2, first: 97, last: 98 },
  { seed: "\u00e9", parts: ["\u00df", "\u00ff"], expected: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255 },
  { seed: "", parts: ["\u0101"], expected: "\u0101", size: 1, first: 257, last: 257 },
  { seed: "", parts: ["\u4e2d"], expected: "\u4e2d", size: 1, first: 20013, last: 20013 },
  { seed: "", parts: ["\ud83d", "\ude00"], expected: "\ud83d\ude00", size: 2, first: 55357, last: 56832 },
  { seed: "", parts: ["\ud800"], expected: "\ud800", size: 1, first: 55296, last: 55296 },
  { seed: "", parts: ["\udc00"], expected: "\udc00", size: 1, first: 56320, last: 56320 },
  { seed: "", parts: ["\u0101", "a", "b"], expected: "\u0101ab", size: 3, first: 257, last: 98 },
  { seed: "", parts: ["a", "\u4e2d", "b"], expected: "a\u4e2db", size: 3, first: 97, last: 98 },
  { seed: "", parts: ["a", "b", "\u0101"], expected: "ab\u0101", size: 3, first: 97, last: 257 },
  { seed: "a", parts: ["\ud83d", "\ude00", "b"], expected: "a\ud83d\ude00b", size: 4, first: 97, last: 98 },
  { seed: "", parts: ["\u0000", "a"], expected: "\u0000a", size: 2, first: 0, last: 97 },
  { seed: "", parts: ["\udc00", "\ud800"], expected: "\udc00\ud800", size: 2, first: 56320, last: 55296 },
];
function checkText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(typeof actual, "string");
  assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const row of rows) {
  const result: string = accumulateBuilt<string>(row.seed, row.parts);
  checkText(result, row.expected, row.size, row.first, row.last);
}
