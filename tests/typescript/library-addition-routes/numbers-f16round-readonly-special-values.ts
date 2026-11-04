/*---
description: "Math.f16round through a readonly array element; node preserves both zeros, NaN and infinities and the sign of tiny underflows."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-readonly]
---*/
// Math.f16round through a readonly array element; node preserves both zeros, NaN and infinities and the sign of tiny underflows.
const log: string[] = [];
const rows: [number, number][] = [
  [0, 0], [-0, -0], [NaN, NaN],
  [Infinity, Infinity], [-Infinity, -Infinity], [5e-324, 0],
  [-5e-324, -0]
];
const source: readonly [number, number][] = rows;
for (const row of source) {
  const input = row[0];
  const result = Math.f16round(row[0]);
  assert.compareArray(log, []);
  assert.sameValue(result, row[1]);
  assert.sameValue(row[0], input);
}
