/*---
description: Control for slicing-charcodeat-generic; the same string operations use plain local strings.
features: [ts-string-route-slicing, ts-strings, ts-functions, ts-generics, ts-generic-constraints, ts-arrays, ts-tuples, ts-iteration]
---*/
// Control: ../string-routes/slicing-charcodeat-generic.ts; replace only the active string carrier with plain string locals.
interface CodeSample { input: string; raw: string; size: number; first: number; last: number; probes: [number, number][]; }
const samples: CodeSample[] = [
  { input: "", raw: "", size: 0, first: NaN, last: NaN, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, NaN], [1, NaN], [2, NaN], [99, NaN]] },
  { input: "ASCII", raw: "ASCII", size: 5, first: 65, last: 73, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 65], [1, 83], [2, 67], [99, NaN]] },
  { input: "\u00e9\u00df\u00ff", raw: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 233], [1, 223], [2, 255], [99, NaN]] },
  { input: "\u0101", raw: "\u0101", size: 1, first: 257, last: 257, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 257], [1, NaN], [2, NaN], [99, NaN]] },
  { input: "\u4e2d", raw: "\u4e2d", size: 1, first: 20013, last: 20013, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 20013], [1, NaN], [2, NaN], [99, NaN]] },
  { input: "\ud83d\ude00", raw: "\ud83d\ude00", size: 2, first: 55357, last: 56832, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 55357], [1, 56832], [2, NaN], [99, NaN]] },
  { input: "\ud800", raw: "\ud800", size: 1, first: 55296, last: 55296, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 55296], [1, NaN], [2, NaN], [99, NaN]] },
  { input: "\udfff", raw: "\udfff", size: 1, first: 57343, last: 57343, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 57343], [1, NaN], [2, NaN], [99, NaN]] },
  { input: "\u0101ab", raw: "\u0101ab", size: 3, first: 257, last: 98, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 257], [1, 97], [2, 98], [99, NaN]] },
  { input: "a\u4e2db", raw: "a\u4e2db", size: 3, first: 97, last: 98, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 97], [1, 20013], [2, 98], [99, NaN]] },
  { input: "ab\u0101", raw: "ab\u0101", size: 3, first: 97, last: 257, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 97], [1, 98], [2, 257], [99, NaN]] },
  { input: "a\ud83d\ude00b", raw: "a\ud83d\ude00b", size: 4, first: 97, last: 98, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 97], [1, 55357], [2, 56832], [99, NaN]] },
  { input: "\udfff\ud800", raw: "\udfff\ud800", size: 2, first: 57343, last: 55296, probes: [[-99, NaN], [-2, NaN], [-1, NaN], [0, 57343], [1, 55296], [2, NaN], [99, NaN]] }
];
function codeUnitThrough<T extends string>(value: T, position: number): number { return value.charCodeAt(position); }
for (const sample of samples) {
  const raw: string = sample.input;
  assert.sameValue(raw, sample.raw); assert.sameValue(raw.length, sample.size);
  assert.sameValue(raw.charCodeAt(0), sample.first); assert.sameValue(raw.charCodeAt(raw.length - 1), sample.last);
  for (const [position, expected] of sample.probes) {
    const result: number = raw.charCodeAt(position);
    assert.sameValue(result, expected);
    assert.sameValue(typeof result, expected === undefined ? "undefined" : "number");
  }
}
