/*---
description: Control for slicing-codepointat-union-field; the same string operations use plain local strings.
features: [ts-string-route-slicing, ts-strings, ts-interfaces, ts-unions, ts-arrays, ts-tuples, ts-iteration]
---*/
// Control: ../string-routes/slicing-codepointat-union-field.ts; replace only the active string carrier with plain string locals.
interface CodeSample { input: string | number; raw: string; size: number; first: number; last: number; probes: [number, number | undefined][]; }
const samples: CodeSample[] = [
  { input: "", raw: "", size: 0, first: NaN, last: NaN, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, undefined], [1, undefined], [2, undefined], [99, undefined]] },
  { input: "ASCII", raw: "ASCII", size: 5, first: 65, last: 73, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 65], [1, 83], [2, 67], [99, undefined]] },
  { input: "\u00e9\u00df\u00ff", raw: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 233], [1, 223], [2, 255], [99, undefined]] },
  { input: "\u0101", raw: "\u0101", size: 1, first: 257, last: 257, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 257], [1, undefined], [2, undefined], [99, undefined]] },
  { input: "\u4e2d", raw: "\u4e2d", size: 1, first: 20013, last: 20013, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 20013], [1, undefined], [2, undefined], [99, undefined]] },
  { input: "\ud83d\ude00", raw: "\ud83d\ude00", size: 2, first: 55357, last: 56832, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 128512], [1, 56832], [2, undefined], [99, undefined]] },
  { input: "\ud800", raw: "\ud800", size: 1, first: 55296, last: 55296, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 55296], [1, undefined], [2, undefined], [99, undefined]] },
  { input: "\udfff", raw: "\udfff", size: 1, first: 57343, last: 57343, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 57343], [1, undefined], [2, undefined], [99, undefined]] },
  { input: "\u0101ab", raw: "\u0101ab", size: 3, first: 257, last: 98, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 257], [1, 97], [2, 98], [99, undefined]] },
  { input: "a\u4e2db", raw: "a\u4e2db", size: 3, first: 97, last: 98, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 97], [1, 20013], [2, 98], [99, undefined]] },
  { input: "ab\u0101", raw: "ab\u0101", size: 3, first: 97, last: 257, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 97], [1, 98], [2, 257], [99, undefined]] },
  { input: "a\ud83d\ude00b", raw: "a\ud83d\ude00b", size: 4, first: 97, last: 98, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 97], [1, 128512], [2, 56832], [99, undefined]] },
  { input: "\udfff\ud800", raw: "\udfff\ud800", size: 2, first: 57343, last: 55296, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 57343], [1, 55296], [2, undefined], [99, undefined]] },
  { input: 7, raw: "7", size: 1, first: 55, last: 55, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 55], [1, undefined], [2, undefined], [99, undefined]] },
  { input: 101, raw: "101", size: 3, first: 49, last: 49, probes: [[-99, undefined], [-2, undefined], [-1, undefined], [0, 49], [1, 48], [2, 49], [99, undefined]] }
];
interface PointCarrier { value: string | number; }
for (const sample of samples) {
  const raw: string = typeof sample.input === "string" ? sample.input : String(sample.input);
  assert.sameValue(raw, sample.raw); assert.sameValue(raw.length, sample.size);
  assert.sameValue(raw.charCodeAt(0), sample.first); assert.sameValue(raw.charCodeAt(raw.length - 1), sample.last);
  for (const [position, expected] of sample.probes) {
    const result: number | undefined = raw.codePointAt(position);
    assert.sameValue(result, expected);
    assert.sameValue(typeof result, expected === undefined ? "undefined" : "number");
  }
}
