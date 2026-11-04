/*---
description: "Control: Math.f16round through a tuple element; node distinguishes each adjacent binary64 value around a half tie without a binary32 double-rounding step."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration]
---*/
// Math.f16round through a tuple element; node distinguishes each adjacent binary64 value around a half tie without a binary32 double-rounding step.
const log: string[] = [];
const rows: [number, number][] = [
  [1.0004882812499998, 1], [1.00048828125, 1], [1.0004882812500002, 1.0009765625],
  [1.0014648437499998, 1.0009765625], [1.00146484375, 1.001953125], [1.0014648437500002, 1.001953125],
  [-1.0004882812500002, -1.0009765625]
];
for (const row of rows) {
  const input = row[0];
  const result = row[1];
  assert.compareArray(log, []);
  assert.sameValue(result, row[1]);
  assert.sameValue(row[0], input);
}
