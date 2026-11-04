/*---
description: "Control: Math.f16round through a narrowed Map value; node rounds the stored input while preserving its carrier identity, payload and exceptional values."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-interfaces, ts-map-set, ts-narrowing]
---*/
// Math.f16round through a narrowed Map value; node rounds the stored input while preserving its carrier identity, payload and exceptional values.
const log: string[] = [];
interface Sample { input: number; expected: number; }
const rows: [number, number][] = [
  [0.1, 0.0999755859375], [1.0004882812500002, 1.0009765625], [65520, Infinity],
  [-0, -0], [NaN, NaN]
];
for (const [input, expected] of rows) {
  const original: Sample = { input, expected };
  const values: Map<string, Sample> = new Map([["sample", original]]);
  const source = values.get("sample");
  if (source === undefined) throw new Error("missing sample");
  const result = source.expected;
  assert.compareArray(log, []);
  assert.sameValue(result, expected);
  assert.sameValue(values.get("sample"), original);
  assert.sameValue(source.input, input);
}
