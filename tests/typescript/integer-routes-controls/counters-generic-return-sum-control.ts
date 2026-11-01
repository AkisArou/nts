/*---
description: Direct local constants reproduce the stages of a loop accumulator repeatedly crossing a constrained generic return keeps fractions and sums beyond int32 and safe integers.
features: [ts-integer-route-counters, ts-numbers, ts-iteration, ts-expressions]
---*/
// Control: local number constants unroll the same operations in the same order.
const expected: number[][] = [
  [0, 0, 1, 3], [0, 0, 1, 3], [0, 1, 2, 4], [0, -1, 0, 2],
  [0, 2147483647, 2147483648, 2147483650], [0, -2147483648, -2147483647, -2147483645], [0, 2147483648, 2147483649, 2147483651], [0, 4294967295, 4294967296, 4294967298],
  [0, 4294967296, 4294967297, 4294967299], [0, 9007199254740991, 9007199254740992, 9007199254740994], [0, 9007199254740992, 9007199254740992, 9007199254740994], [0, 0.5, 1.5, 3.5],
  [0, -0.5, 0.5, 2.5], [0, NaN, NaN, NaN], [0, Infinity, Infinity, Infinity], [0, 2147483646, 2147483647, 2147483649],
  [0, 4294967294, 4294967295, 4294967297], [0, 9007199254740990, 9007199254740991, 9007199254740992], [0, -Infinity, -Infinity, -Infinity],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? 2147483646 : row === 16 ? 4294967294 : row === 17 ? 9007199254740990 : -Infinity;
  const stage0: number = 0;
  assert.sameValue(Object.is(stage0, expected[row][0]), true); assert.sameValue(typeof stage0, "number");
  const stage1: number = stage0 + input;
  assert.sameValue(Object.is(stage1, expected[row][1]), true); assert.sameValue(typeof stage1, "number");
  const stage2: number = stage1 + 1;
  assert.sameValue(Object.is(stage2, expected[row][2]), true); assert.sameValue(typeof stage2, "number");
  const stage3: number = stage2 + 2;
  assert.sameValue(Object.is(stage3, expected[row][3]), true); assert.sameValue(typeof stage3, "number");
}
