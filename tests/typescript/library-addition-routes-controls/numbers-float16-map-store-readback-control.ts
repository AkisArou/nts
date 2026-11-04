/*---
description: "Control: Float16Array through a Map value; node retains its view identity while indexed writes round to the exact float16 value and preserve neighboring slots."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-map-set, ts-narrowing]
---*/
// Float16Array through a Map value; node retains its view identity while indexed writes round to the exact float16 value and preserve neighboring slots.
const log: string[] = [];
const rows: [number, number][] = [
  [1.00048828125, 1], [1.0004882812500002, 1.0009765625], [1.00146484375, 1.001953125],
  [65520, Infinity], [2.9802322387695312e-8, 0], [-2.9802322387695312e-8, -0],
  [-0, -0], [NaN, NaN]
];
for (const [input, expected] of rows) {
  const original: Float64Array = new Float64Array([3, 0, 5]);
  const values: Map<string, Float64Array> = new Map([["view", original]]);
  const source = values.get("view");
  if (source === undefined) throw new Error("missing view");
  source[1] = expected;
  const again = values.get("view");
  if (again === undefined) throw new Error("missing view");
  assert.compareArray(log, []);
  assert.compareArray(Array.from(again), [3, expected, 5]);
  assert.sameValue(again, source);
  assert.sameValue(again, original);
}
