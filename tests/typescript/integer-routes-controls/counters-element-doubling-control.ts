/*---
description: Direct local constants reproduce the stages of a number array element repeatedly doubled in a loop preserves wide products, fractions and negative zero.
features: [ts-integer-route-counters, ts-numbers, ts-iteration, ts-expressions]
---*/
// Control: local number constants unroll the same operations in the same order.
const expected: number[][] = [
  [1, 0, 0, 0], [1, -0, -0, -0], [1, 1, 2, 4], [1, -1, -2, -4],
  [1, 2147483647, 4294967294, 8589934588], [1, -2147483648, -4294967296, -8589934592], [1, 2147483648, 4294967296, 8589934592], [1, 4294967295, 8589934590, 17179869180],
  [1, 4294967296, 8589934592, 17179869184], [1, 9007199254740991, 18014398509481982, 36028797018963964], [1, 9007199254740992, 18014398509481984, 36028797018963970], [1, 0.5, 1, 2],
  [1, -0.5, -1, -2], [1, NaN, NaN, NaN], [1, Infinity, Infinity, Infinity], [1, 2147483646, 4294967292, 8589934584],
  [1, 4294967294, 8589934588, 17179869176], [1, 9007199254740990, 18014398509481980, 36028797018963960], [1, -Infinity, -Infinity, -Infinity],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? 2147483646 : row === 16 ? 4294967294 : row === 17 ? 9007199254740990 : -Infinity;
  const stage0: number = 1;
  assert.sameValue(Object.is(stage0, expected[row][0]), true); assert.sameValue(typeof stage0, "number");
  const stage1: number = stage0 * input;
  assert.sameValue(Object.is(stage1, expected[row][1]), true); assert.sameValue(typeof stage1, "number");
  const stage2: number = stage1 * 2;
  assert.sameValue(Object.is(stage2, expected[row][2]), true); assert.sameValue(typeof stage2, "number");
  const stage3: number = stage2 * 2;
  assert.sameValue(Object.is(stage3, expected[row][3]), true); assert.sameValue(typeof stage3, "number");
}
